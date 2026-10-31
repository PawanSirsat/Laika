import { desc, eq, inArray } from 'drizzle-orm';
import { type ResolvedActor, type ServiceCaller, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type EvidenceKind, type EvidenceState, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import {
  agents,
  projects,
  taskEvidence,
  taskReviews,
  taskRounds,
  tasks,
  tokens,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { type AgentReader, agentLens, agentReader } from './agent-visibility.ts';
import { type RoundCi, confirmRound, roundSummaries } from './github-proof.ts';

/**
 * The proof an agent hands back with `finish_task`, kept as rounds (SPEC
 * §4.25–§4.27, D-082, LAI-758).
 *
 * A **round** is one finish; its **evidence** is one row per item — each
 * commit, the branch, the pull request, each test run — and each item carries
 * a `state`: `claimed` is what the agent said, and step 2 (D-083, LAI-766)
 * flips it to `confirmed` or `failed` from GitHub's own deliveries
 * (`github-proof.ts`), which is why the state is per item and not per round.
 *
 * This module writes rounds and reads them back. It imports nothing from
 * `services/tasks.ts`, which calls it from `finishTask`, so the two never form
 * a cycle; `services/review.ts` is the half that moves tasks.
 */

/**
 * The bounds on one round's proof, shared by the REST body, the MCP schema and
 * the service — one set of numbers, so the two surfaces cannot disagree about
 * what is too much.
 */
export const EVIDENCE_LIMITS = {
  commits: 50,
  tests: 50,
  /** A full sha is 40 hex characters; 7 is git's shortest abbreviation. */
  shaMin: 7,
  shaMax: 40,
  /** A commit's first line. */
  message: 200,
  branch: 200,
  url: 500,
  command: 500,
} as const;

export interface EvidenceInput {
  commits?: readonly { sha: string; message?: string | undefined }[] | undefined;
  branch?: string | undefined;
  pull_request?: string | undefined;
  tests?: readonly { command: string; exit_code: number }[] | undefined;
}

export interface EvidenceItem {
  id: string;
  /** `claimed` until something other than the agent checks it (§4.26). */
  state: EvidenceState;
  /** What checked it — `github` in step 2. Null while `claimed`. */
  state_source: string | null;
  state_at: number | null;
}

export interface CommitEvidence extends EvidenceItem {
  sha: string;
  /** The commit's first line, or null. */
  message: string | null;
}

export interface BranchEvidence extends EvidenceItem {
  name: string;
}

export interface PullRequestEvidence extends EvidenceItem {
  url: string;
  /**
   * Whether GitHub reported it merged (D-083): null until a delivery named
   * this pull request.
   */
  merged: boolean | null;
}

export interface TestEvidence extends EvidenceItem {
  command: string;
  exit_code: number;
}

export interface RoundView {
  id: string;
  task_id: string;
  /** 1 for the task's first finish. */
  number: number;
  finished_by: string;
  /**
   * The agent's own name for itself when it finished (D-076), or null. For a
   * registered agent this is usually its token's name — its registered name
   * — so it is **its owner's alone** (D-120, Belka, LAI-1001): null for any
   * other reader, even where `agent` is shown. Kept for unregistered legacy
   * tokens.
   */
  client_name: string | null;
  /**
   * The registered agent whose token finished the round, so a screen can name
   * it `<harness> · <device>` (D-120, LAI-1001) instead of the client's own
   * word. Read through the round's token. **Only an agent the reader may
   * already see** (§4.63: another person's agent is not disclosed): their own,
   * or the task's selected agent or live claim holder, which the task view
   * shows them anyway. Null otherwise — and for a person, a legacy token, or
   * a round whose token has since been deleted. Decides nothing.
   */
  agent: RoundAgentView | null;
  /**
   * A registered agent finished this round — true even when `agent` is null
   * because the reader may not see which one, so a screen says *an agent*
   * rather than nothing. Identifies no agent.
   */
  by_registered_agent: boolean;
  summary_md: string;
  commits: CommitEvidence[];
  branch: BranchEvidence | null;
  pull_request: PullRequestEvidence | null;
  tests: TestEvidence[];
  /**
   * CI for the round's head commit, as GitHub reported it (D-083), or null
   * when no CI result was reported for it. The test items' states follow it.
   */
  ci: RoundCi | null;
  created_at: number;
}

/** Which registered agent finished a round: what naming it takes, and nothing else. */
export interface RoundAgentView {
  id: string;
  harness: string;
  device_label: string | null;
}

/** The send-back a task currently carries (§4.27): who, when and why. */
export interface SendBackView {
  id: string;
  reason_md: string;
  decided_by: string;
  /** The comment the reason was posted as, or null if it is gone. */
  comment_id: string | null;
  /** The round that was sent back, or null when the task had none. */
  round_number: number | null;
  created_at: number;
}

/** Unicode `Other` (controls, format, surrogates, private use) and line breaks. */
const UNPRINTABLE = /[\p{C}\u2028\u2029]/u;
const SHA = /^[0-9a-f]+$/;

function refuse(field: string, message: string): ApiError {
  return new ApiError('unprocessable', message, { field });
}

/** One line of text, trimmed, within `max`, with nothing unprintable in it. */
function line(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed === '') throw refuse(field, `${field} must not be empty`);
  if (trimmed.length > max)
    throw refuse(field, `${field} is longer than ${String(max)} characters`);
  if (UNPRINTABLE.test(trimmed)) throw refuse(field, `${field} must be a single printable line`);
  return trimmed;
}

/**
 * A pull request is a link a reviewer will click, so it is held to `http:` or
 * `https:` here as well as at render time — a `javascript:` URL is refused
 * before it is stored, not merely drawn as text.
 */
function pullRequestUrl(value: string): string {
  const trimmed = line(value, 'pull_request', EVIDENCE_LIMITS.url);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw refuse('pull_request', 'pull_request must be an http(s) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw refuse('pull_request', 'pull_request must be an http(s) URL');
  }
  return trimmed;
}

interface NewItem {
  kind: EvidenceKind;
  value: string;
  detail: string | null;
  exitCode: number | null;
}

/**
 * The items one round stores, in the order the agent sent them, or a `422`
 * naming the field that was wrong. The surfaces validate the shape first; this
 * is the rule, so a caller that skipped them is held to it too.
 */
export function evidenceItems(input: EvidenceInput): NewItem[] {
  const commits = input.commits ?? [];
  const tests = input.tests ?? [];
  if (commits.length > EVIDENCE_LIMITS.commits) {
    throw refuse('commits', `At most ${String(EVIDENCE_LIMITS.commits)} commits per finish`);
  }
  if (tests.length > EVIDENCE_LIMITS.tests) {
    throw refuse('tests', `At most ${String(EVIDENCE_LIMITS.tests)} test runs per finish`);
  }

  const items: NewItem[] = [];
  for (const commit of commits) {
    const sha = commit.sha.trim().toLowerCase();
    if (
      !SHA.test(sha) ||
      sha.length < EVIDENCE_LIMITS.shaMin ||
      sha.length > EVIDENCE_LIMITS.shaMax
    ) {
      throw refuse('commits', `"${commit.sha.slice(0, 50)}" is not a commit sha (7–40 hex)`);
    }
    // The first line only: a message body is the commit's business, and the
    // panel draws one line per commit.
    const first = commit.message?.split(/\r?\n/, 1)[0]?.trim() ?? '';
    items.push({
      kind: 'commit',
      value: sha,
      detail: first === '' ? null : line(first, 'commits.message', EVIDENCE_LIMITS.message),
      exitCode: null,
    });
  }
  if (input.branch !== undefined) {
    items.push({
      kind: 'branch',
      value: line(input.branch, 'branch', EVIDENCE_LIMITS.branch),
      detail: null,
      exitCode: null,
    });
  }
  if (input.pull_request !== undefined) {
    items.push({
      kind: 'pull_request',
      value: pullRequestUrl(input.pull_request),
      detail: null,
      exitCode: null,
    });
  }
  for (const test of tests) {
    if (!Number.isInteger(test.exit_code)) {
      throw refuse('tests.exit_code', 'exit_code must be an integer');
    }
    items.push({
      kind: 'test_run',
      value: line(test.command, 'tests.command', EVIDENCE_LIMITS.command),
      detail: null,
      exitCode: test.exit_code,
    });
  }
  return items;
}

/**
 * Store one finish as the task's next round. Called by `finishTask` inside its
 * transaction, after the move to review, so a round never exists for a finish
 * that did not happen. `items` is `evidenceItems`'s answer, checked before the
 * move so a bad item refuses the whole finish.
 */
export function recordRound(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  summaryMd: string,
  items: readonly NewItem[],
  now: number,
): string {
  const last = db
    .select({ number: taskRounds.number })
    .from(taskRounds)
    .where(eq(taskRounds.taskId, taskId))
    .orderBy(desc(taskRounds.number))
    .limit(1)
    .get();

  const tokenId = actor.token?.id ?? null;
  // D-076's name for the client, falling back to the token's own name — a
  // REST-only agent never sends `initialize`, and its token's name is what the
  // Connect screen set to the agent.
  const token =
    tokenId === null
      ? undefined
      : db
          .select({ client: tokens.lastClientName, name: tokens.name })
          .from(tokens)
          .where(eq(tokens.id, tokenId))
          .get();

  const roundId = newId();
  db.insert(taskRounds)
    .values({
      id: roundId,
      taskId,
      number: (last?.number ?? 0) + 1,
      finishedBy: actor.userId,
      tokenId,
      clientName: token === undefined ? null : (token.client ?? token.name),
      summaryMd,
      createdAt: now,
    })
    .run();

  items.forEach((item, position) => {
    db.insert(taskEvidence)
      .values({
        id: newId(),
        roundId,
        kind: item.kind,
        position,
        value: item.value,
        detail: item.detail,
        exitCode: item.exitCode,
        createdAt: now,
      })
      .run();
  });

  // What GitHub already reported counts now (D-083): a push or a CI run that
  // arrived before the finish confirms the proof the moment it is stored.
  confirmRound(db, roundId, now);
  return roundId;
}

/**
 * Whom the agents behind rounds may be shown to: the reader's user id, or
 * `null` for a principal with no user (a delivery), who is shown none.
 */
type RoundReader = AgentReader;

export const roundReader: (caller: ServiceCaller) => RoundReader = agentReader;

function toRoundViews(
  db: Db,
  rows: (typeof taskRounds.$inferSelect)[],
  reader: RoundReader,
): RoundView[] {
  if (rows.length === 0) return [];
  const github = roundSummaries(
    db,
    rows.map((r) => r.id),
  );
  const items = db
    .select()
    .from(taskEvidence)
    .where(
      inArray(
        taskEvidence.roundId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(taskEvidence.roundId, taskEvidence.position)
    .all();
  // The agent behind each round's token (D-120), in one query whatever the count.
  const tokenIds = [...new Set(rows.flatMap((r) => (r.tokenId === null ? [] : [r.tokenId])))];
  const agentByToken = new Map(
    tokenIds.length === 0
      ? []
      : db
          .select({
            tokenId: tokens.id,
            id: agents.id,
            ownerUserId: agents.ownerUserId,
            harness: agents.harness,
            deviceLabel: agents.deviceLabel,
          })
          .from(tokens)
          .innerJoin(agents, eq(agents.id, tokens.agentId))
          .where(inArray(tokens.id, tokenIds))
          .all()
          .map((a) => [a.tokenId, a] as const),
  );
  // What each task already shows its reader names the agent there; nothing
  // else does (D-121 item 7). The one gate every agent-naming read asks.
  const lens = agentLens(
    db,
    reader,
    rows.map((r) => r.taskId),
    [...agentByToken.values()].map((a) => a.id),
  );
  const visibleAgent = (row: (typeof rows)[number]): RoundAgentView | null => {
    const a = row.tokenId === null ? undefined : agentByToken.get(row.tokenId);
    if (a === undefined) return null;
    return lens.visible(row.taskId, a.id)
      ? { id: a.id, harness: a.harness, device_label: a.deviceLabel }
      : null;
  };

  return rows.map((row) => {
    const mine = items.filter((i) => i.roundId === row.id);
    const state = (i: (typeof mine)[number]): EvidenceItem => ({
      id: i.id,
      state: i.state,
      state_source: i.stateSource,
      state_at: i.stateAt,
    });
    const branch = mine.find((i) => i.kind === 'branch');
    const pr = mine.find((i) => i.kind === 'pull_request');
    const said = github.get(row.id);
    const agent = visibleAgent(row);
    const finisher = row.tokenId === null ? undefined : agentByToken.get(row.tokenId);
    const registered = finisher !== undefined;
    // The token's name is the agent's registered name, its owner's alone
    // (D-120, Belka): withheld from everyone else, even where `agent` is shown.
    const ownName = registered && reader !== null && finisher.ownerUserId === reader;
    return {
      id: row.id,
      task_id: row.taskId,
      number: row.number,
      finished_by: row.finishedBy,
      // A withheld agent's name is withheld with it.
      client_name: registered && !ownName ? null : row.clientName,
      agent,
      by_registered_agent: registered,
      summary_md: row.summaryMd,
      commits: mine
        .filter((i) => i.kind === 'commit')
        .map((i) => ({ ...state(i), sha: i.value, message: i.detail })),
      branch: branch === undefined ? null : { ...state(branch), name: branch.value },
      pull_request:
        pr === undefined ? null : { ...state(pr), url: pr.value, merged: said?.merged ?? null },
      tests: mine
        .filter((i) => i.kind === 'test_run')
        .map((i) => ({ ...state(i), command: i.value, exit_code: i.exitCode ?? 0 })),
      ci: said?.ci ?? null,
      created_at: row.createdAt,
    };
  });
}

/**
 * The latest round of each task asked about, in two queries whatever the
 * count. A task never finished has no entry.
 */
export function latestRounds(
  db: Db,
  taskIds: readonly string[],
  reader: RoundReader,
): Map<string, RoundView> {
  if (taskIds.length === 0) return new Map();
  const rows = db
    .select()
    .from(taskRounds)
    .where(inArray(taskRounds.taskId, [...taskIds]))
    .orderBy(desc(taskRounds.number))
    .all();

  const newest = new Map<string, typeof taskRounds.$inferSelect>();
  for (const row of rows) if (!newest.has(row.taskId)) newest.set(row.taskId, row);

  return new Map(
    toRoundViews(db, [...newest.values()], reader).map((view) => [view.task_id, view]),
  );
}

/**
 * The send-back each task currently carries (§4.27, D-082): its latest
 * decision is a send-back, no round has been finished since, and the task is
 * not done or cancelled. Two queries whatever the count.
 *
 * **"Since" is the round, not the clock.** A send-back records the round it
 * sent back; the next finish makes a newer one, and that is what retires it —
 * two writes in one millisecond cannot reorder it.
 */
export function activeSendBacks(
  db: Db,
  tasksAsked: readonly { id: string; status: TaskStatus }[],
): Map<string, SendBackView> {
  const open = tasksAsked.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  if (open.length === 0) return new Map();
  const ids = open.map((t) => t.id);

  const decisions = db
    .select()
    .from(taskReviews)
    .where(inArray(taskReviews.taskId, ids))
    .orderBy(desc(taskReviews.createdAt), desc(taskReviews.id))
    .all();
  const latestDecision = new Map<string, typeof taskReviews.$inferSelect>();
  for (const row of decisions)
    if (!latestDecision.has(row.taskId)) latestDecision.set(row.taskId, row);

  const sentBack = [...latestDecision.values()].filter((d) => d.decision === 'sent_back');
  if (sentBack.length === 0) return new Map();

  const rounds = db
    .select({ id: taskRounds.id, taskId: taskRounds.taskId, number: taskRounds.number })
    .from(taskRounds)
    .where(
      inArray(
        taskRounds.taskId,
        sentBack.map((d) => d.taskId),
      ),
    )
    .orderBy(desc(taskRounds.number))
    .all();
  const latestRound = new Map<string, { id: string; number: number }>();
  for (const row of rounds) if (!latestRound.has(row.taskId)) latestRound.set(row.taskId, row);
  const numberOf = new Map(rounds.map((r) => [r.id, r.number]));

  const active = new Map<string, SendBackView>();
  for (const d of sentBack) {
    if ((latestRound.get(d.taskId)?.id ?? null) !== d.roundId) continue;
    active.set(d.taskId, {
      id: d.id,
      reason_md: d.reasonMd ?? '',
      decided_by: d.decidedBy,
      comment_id: d.commentId,
      round_number: d.roundId === null ? null : (numberOf.get(d.roundId) ?? null),
      created_at: d.createdAt,
    });
  }
  return active;
}

/** Comment ids that were posted as a send-back's reason, among those asked about. */
export function sendBackCommentIds(db: Db, commentIds: readonly string[]): Set<string> {
  if (commentIds.length === 0) return new Set();
  return new Set(
    db
      .select({ commentId: taskReviews.commentId })
      .from(taskReviews)
      .where(inArray(taskReviews.commentId, [...commentIds]))
      .all()
      .map((r) => r.commentId)
      .filter((id): id is string => id !== null),
  );
}

export interface TaskRoundsView {
  /** Newest first. */
  rounds: RoundView[];
  send_back: SendBackView | null;
}

/**
 * Every round of one task, newest first, and the send-back it carries
 * (`GET /api/v1/tasks/:id/rounds`, §6.4). Anyone who can read the task can
 * read its proof: it is what the reviewer is shown, and what the agent said.
 */
export function listTaskRounds(db: Db, actor: ServiceCaller, taskId: string): TaskRoundsView {
  const task = db
    .select({ id: tasks.id, projectId: tasks.projectId, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .get();
  if (project === undefined) throw ApiError.notFound('That task belongs to no project');
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const rows = db
    .select()
    .from(taskRounds)
    .where(eq(taskRounds.taskId, taskId))
    .orderBy(desc(taskRounds.number))
    .all();

  return {
    rounds: toRoundViews(db, rows, roundReader(actor)),
    send_back: activeSendBacks(db, [task]).get(taskId) ?? null,
  };
}

/** The task's latest round, or null — what a decision is recorded against. */
export function latestRoundId(db: Db, taskId: string): string | null {
  return (
    db
      .select({ id: taskRounds.id })
      .from(taskRounds)
      .where(eq(taskRounds.taskId, taskId))
      .orderBy(desc(taskRounds.number))
      .limit(1)
      .get()?.id ?? null
  );
}

/** Write one review decision (§4.27). The caller has already moved the task. */
export function recordDecision(
  db: Db,
  input: {
    taskId: string;
    decision: 'accepted' | 'sent_back';
    reasonMd: string | null;
    commentId: string | null;
    decidedBy: string;
    now: number;
  },
): void {
  db.insert(taskReviews)
    .values({
      id: newId(),
      taskId: input.taskId,
      roundId: latestRoundId(db, input.taskId),
      decision: input.decision,
      reasonMd: input.reasonMd,
      commentId: input.commentId,
      decidedBy: input.decidedBy,
      createdAt: input.now,
    })
    .run();
}
