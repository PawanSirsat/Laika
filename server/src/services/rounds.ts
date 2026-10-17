import { desc, eq, inArray } from 'drizzle-orm';
import { type ResolvedActor, type ServiceCaller, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type EvidenceKind, type EvidenceState, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { projects, taskEvidence, taskReviews, taskRounds, tasks, tokens } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

/**
 * The proof an agent hands back with `finish_task`, kept as rounds (SPEC
 * §4.25–§4.27, D-081, LAI-758).
 *
 * A **round** is one finish; its **evidence** is one row per item — each
 * commit, the branch, the pull request, each test run — and each item carries
 * a `state`. Today every item is `claimed`: the agent said so, and nothing has
 * checked. Step 2 (LAIKA-477) confirms items from GitHub by flipping `state` on
 * the row, which is why the state is per item and not per round.
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
  /** The agent's own name for itself when it finished (D-076), or null. */
  client_name: string | null;
  summary_md: string;
  commits: CommitEvidence[];
  branch: BranchEvidence | null;
  pull_request: PullRequestEvidence | null;
  tests: TestEvidence[];
  created_at: number;
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
): void {
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
}

function toRoundViews(db: Db, rows: (typeof taskRounds.$inferSelect)[]): RoundView[] {
  if (rows.length === 0) return [];
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
    return {
      id: row.id,
      task_id: row.taskId,
      number: row.number,
      finished_by: row.finishedBy,
      client_name: row.clientName,
      summary_md: row.summaryMd,
      commits: mine
        .filter((i) => i.kind === 'commit')
        .map((i) => ({ ...state(i), sha: i.value, message: i.detail })),
      branch: branch === undefined ? null : { ...state(branch), name: branch.value },
      pull_request: pr === undefined ? null : { ...state(pr), url: pr.value },
      tests: mine
        .filter((i) => i.kind === 'test_run')
        .map((i) => ({ ...state(i), command: i.value, exit_code: i.exitCode ?? 0 })),
      created_at: row.createdAt,
    };
  });
}

/**
 * The latest round of each task asked about, in two queries whatever the
 * count. A task never finished has no entry.
 */
export function latestRounds(db: Db, taskIds: readonly string[]): Map<string, RoundView> {
  if (taskIds.length === 0) return new Map();
  const rows = db
    .select()
    .from(taskRounds)
    .where(inArray(taskRounds.taskId, [...taskIds]))
    .orderBy(desc(taskRounds.number))
    .all();

  const newest = new Map<string, typeof taskRounds.$inferSelect>();
  for (const row of rows) if (!newest.has(row.taskId)) newest.set(row.taskId, row);

  return new Map(toRoundViews(db, [...newest.values()]).map((view) => [view.task_id, view]));
}

/**
 * The send-back each task currently carries (§4.27, D-081): its latest
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
    rounds: toRoundViews(db, rows),
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
