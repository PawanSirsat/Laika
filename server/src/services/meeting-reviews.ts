import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { and, eq, inArray } from 'drizzle-orm';
import { activityActor, withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type MeetingReviewStatus,
  type TaskPriority,
  type TaskStatus,
} from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { meetingReviews, projects, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { updateProjectContext } from './projects.ts';
import { type ProviderClient, ProviderResponseError } from './provider.ts';
import {
  changeStatus,
  createTask,
  resolveTaskRef,
  updateTask,
  type UpdateTaskInput,
} from './tasks.ts';

/**
 * A meeting transcript becomes a **reviewable proposal set** (SPEC §10.2,
 * LAI-450).
 *
 * ## What this does not do
 *
 * **Nothing applies without explicit human acceptance.** This module stores a
 * proposal set and changes nothing else — no task moves, no comment appears, no
 * context is written. `POST /meeting-reviews/:id/apply` is the half that mutates
 * and it is LAI-451, deliberately separate so it can be reviewed as the half
 * that mutates.
 *
 * ## The transcript is not stored
 *
 * §4.12 keeps a `transcript_hash`, and D-005 is why: *"transcripts are never
 * stored"*. The hash is enough to notice the same meeting arriving twice and
 * carries none of what was said.
 */

/** §10.2's four kinds. A proposal outside them is not storable. */
const PROPOSAL_KINDS = ['new', 'change', 'dead', 'decision'] as const;
type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface StoredProposal {
  /** Assigned here, at store time. Opaque to the model (D-024). */
  id: string;
  kind: ProposalKind;
  /** The task key this concerns, for `change` and `dead`. */
  task: string | null;
  title: string | null;
  description: string | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
  /** §10.2: every proposal renders with the quote it was reacting to. */
  quote: string;
}

/** Unreviewed proposals expire after 7 days (§4.12, §11.6). */
export const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Everything §10.2 says the provider receives, and **nothing else**.
 *
 * Built as its own function so a test can assert its contents exactly. §10.2
 * lists three things — the transcript, the project's open tasks (key, title,
 * status, assignee) and the current `context_md` — and this is the one place in
 * Laika where data leaves the instance, so *"and nothing else"* is the property
 * rather than a nicety.
 *
 * Not the whole board, not other projects, not `activity`, and not a task's
 * description: §10.2 names four fields per task and four is what goes.
 */
export function buildPrompt(db: Db, projectId: string, prefix: string, transcript: string): string {
  const open = db
    .select({
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.status, OPEN_STATUSES)))
    .all();

  const project = db
    .select({ context: projects.contextMd })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  const lines = open.map(
    (t) =>
      `${prefix}-${String(t.number)} | ${t.title} | ${t.status} | ${t.assigneeId ?? 'unassigned'}`,
  );

  return [
    'You are given a meeting transcript, a project context document, and the',
    "project's open tasks. Return STRICT JSON and nothing else, in this shape:",
    '{"proposals":[{"kind":"new|change|dead|decision","task":"KEY-1","title":"",',
    '"description":"","changes":{},"reason":"","quote":""}]}',
    'Every proposal must carry a `quote` taken verbatim from the transcript.',
    '',
    '## Context document',
    project?.context ?? '(none)',
    '',
    '## Open tasks (key | title | status | assignee)',
    ...lines,
    '',
    '## Transcript',
    transcript,
  ].join('\n');
}

/** §5's statuses that are not finished. `cancelled` and `done` are not open. */
const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'review'] as const;

/**
 * Parse what the model returned, strictly.
 *
 * **The model is untrusted input** (LAI-450's Notes): everything here is
 * attacker-influenced if anybody can get text into a meeting, so it is treated
 * the way a request body is. Nothing is coerced, nothing is defaulted into
 * existence, and a shape §10.2 does not describe is refused rather than
 * salvaged.
 */
export function parseProposals(text: string): StoredProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // **Not salvaged.** A model that wraps JSON in prose has not followed the
    // instruction, and digging the object out of the surrounding text is how a
    // parser starts accepting things nobody specified.
    throw new ProviderResponseError('the response was not JSON');
  }

  const root = parsed as { proposals?: unknown };
  if (!Array.isArray(root.proposals)) {
    throw new ProviderResponseError('the response has no `proposals` array');
  }

  return root.proposals.map((raw, index) => toProposal(raw, index));
}

function toProposal(raw: unknown, index: number): StoredProposal {
  /**
   * The fields §10.2 names, all optional, all `unknown`.
   *
   * A shape rather than `Record<string, unknown>` so the reads below are dot
   * notation the linter is happy with — and, more usefully, so a field this
   * function reads that §10.2 does not name is a compile error rather than a
   * string somebody typed.
   */
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    kind?: unknown;
    task?: unknown;
    title?: unknown;
    description?: unknown;
    changes?: unknown;
    reason?: unknown;
    quote?: unknown;
  };
  const kind = p.kind;

  if (typeof kind !== 'string' || !(PROPOSAL_KINDS as readonly string[]).includes(kind)) {
    throw new ProviderResponseError(
      `proposal ${String(index)} has an unknown kind ${JSON.stringify(kind)}`,
    );
  }

  const quote = p.quote;
  if (typeof quote !== 'string' || quote.trim() === '') {
    // §10.2: every proposal renders with the quote it was reacting to, "so a
    // human can see what the model was reacting to". One without a quote cannot
    // be reviewed, so it is not storable.
    throw new ProviderResponseError(`proposal ${String(index)} has no quote`);
  }

  return {
    // **Assigned here, once, at store time** (D-024). Not from the model, which
    // has no reason to make one unique or stable, and not from the array index,
    // which shifts the moment a set is regenerated.
    id: newId(),
    kind: kind as ProposalKind,
    task: str(p.task),
    title: str(p.title),
    description: str(p.description),
    changes:
      typeof p.changes === 'object' && p.changes !== null
        ? (p.changes as Record<string, unknown>)
        : null,
    reason: str(p.reason),
    quote,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export interface StoreTranscriptInput {
  projectSlug: string;
  transcript: string;
  source: string;
}

/**
 * Transcript in, `meeting_reviews` row out. **Nothing else changes.**
 */
export async function storeTranscriptReview(
  db: Db,
  client: ProviderClient,
  input: StoreTranscriptInput,
  now: number,
): Promise<{ id: string; proposals: number }> {
  const project = db
    .select({ id: projects.id, prefix: projects.prefix })
    .from(projects)
    .where(eq(projects.slug, input.projectSlug))
    .get();
  if (project === undefined) throw ApiError.notFound(`No project with slug "${input.projectSlug}"`);

  const prompt = buildPrompt(db, project.id, project.prefix, input.transcript);
  const proposals = parseProposals(await client.complete({ prompt }));

  const id = newId();
  db.insert(meetingReviews)
    .values({
      id,
      projectId: project.id,
      source: input.source,
      // D-005: the hash, never the transcript.
      transcriptHash: createHash('sha256').update(input.transcript, 'utf8').digest('hex'),
      proposalsJson: JSON.stringify(proposals),
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      expiresAt: now + REVIEW_TTL_MS,
      createdAt: now,
    })
    .run();

  return { id, proposals: proposals.length };
}

// ------------------------------------------ applying an accepted set (§10.2)

/**
 * The one place an LLM writes to the board, and it is gated by a human
 * (SPEC §10.2, LAI-451).
 *
 * ## The design is "call the service a person would have called"
 *
 * Every proposal maps onto something someone can already do by hand —
 * `createTask`, `changeStatus`, `updateTask`, `updateProjectContext` — and this
 * module calls those, rather than writing rows itself. That is the task's
 * instruction, and it buys the criterion that matters:
 *
 * **`can()` is per proposal, and it is not a table kept here.** Each service
 * runs its own `assertCan` against the applying human, so §3.2's rows decide
 * each change and there is no second opinion in this file to fall out of step
 * with them. The concrete case: `meeting_proposal.apply` is member-and-up, but
 * a `decision` proposal writes `context_md`, and §3.2 makes that lead-only. **A
 * member applying a decision is refused by `updateProjectContext`**, not by
 * anything written here — so the day §3.2's row changes, this changes with it.
 *
 * That is the same reasoning `finishTask` gives for not re-checking its halves,
 * and the same reasoning §3.4 gives for the webhook performing `task.write`
 * rather than an action of its own: *the principal is what differs, not the
 * operation.*
 *
 * ## What a partial failure does
 *
 * Nothing. The whole apply is one `IMMEDIATE` transaction, so a proposal
 * refused at position three takes one and two down with it. §10.2's promise is
 * that a human accepted **this set**; landing half of it would be a board state
 * nobody accepted, and the caller cannot tell which half from an error body.
 */

/**
 * What applying one proposal did.
 *
 * **`task_id`, not `taskId`.** This shape goes two places a person reads — the
 * response body and the `meeting.applied` payload — and §6.3 is snake_case
 * everywhere. LAI-045's guard caught this as a Drizzle property leaking into an
 * audit row, which is what that guard is for and it was right.
 */
export type ProposalOutcome =
  | { effect: 'task.created'; task_id: string }
  | { effect: 'task.updated'; task_id: string }
  | { effect: 'task.status_changed'; task_id: string; to: TaskStatus }
  | { effect: 'context.appended' };

export interface AppliedProposal {
  id: string;
  kind: ProposalKind;
  outcome: ProposalOutcome;
}

export interface ApplyReviewInput {
  accepted_proposal_ids: readonly string[];
  now?: number;
}

export interface ApplyReviewResult {
  id: string;
  status: MeetingReviewStatus;
  applied: AppliedProposal[];
  /** Ids accepted again on a repeat call, which changed nothing. */
  already_applied: string[];
}

/**
 * The fields a `change` proposal may carry, and the only ones.
 *
 * `changes` reaches here as `Record<string, unknown>` straight off the model —
 * `parseProposals` stores the object without inspecting it, because §10.2 does
 * not say what may be in it. So it is validated **here**, at the moment it
 * would be applied, and an unrecognised key is refused rather than dropped.
 *
 * **Dropping it would be the whole bug in miniature.** A human accepted a
 * proposal whose rendered form said *"set priority to p1 and reassign"*; an
 * apply that silently performed one of those has applied something nobody
 * accepted, which is the sentence this endpoint exists to make true.
 */
const CHANGEABLE = ['status', 'title', 'description', 'priority'] as const;

/**
 * Turn one accepted proposal into the service call a person would have made.
 *
 * Throws rather than returning a failure: it runs inside the transaction, and
 * §10.2's promise is all-or-nothing.
 */
function applyProposal(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  project: typeof projects.$inferSelect,
  proposal: StoredProposal,
  now: number,
): ProposalOutcome {
  switch (proposal.kind) {
    case 'new': {
      if (proposal.title === null) {
        throw unusable(proposal, 'a `new` proposal with no title creates nothing');
      }

      const created = createTask(sqlite, db, actor, project.slug, {
        title: proposal.title,
        ...(proposal.description === null ? {} : { description_md: proposal.description }),
        // §10.2: applied changes land "as normal activity with
        // `created_via: 'meeting'`" — which is what makes a task that came out
        // of a meeting distinguishable from one somebody typed, for ever.
        created_via: 'meeting',
        now,
      });

      return { effect: 'task.created', task_id: created.id };
    }

    case 'dead': {
      // §5 has no `dead`; the transition a person makes to kill a task is
      // `cancelled`, and `assertTransition` decides whether this task can take
      // it. A `dead` proposal against a task already `done` is refused there
      // rather than here — one table, not two opinions about it.
      const taskId = requireProposalTask(db, proposal);

      changeStatus(db, actor, taskId, 'cancelled', now);
      return { effect: 'task.status_changed', task_id: taskId, to: 'cancelled' };
    }

    case 'change': {
      const taskId = requireProposalTask(db, proposal);
      const changes = proposal.changes ?? {};
      const keys = Object.keys(changes);

      if (keys.length === 0) {
        throw unusable(proposal, 'a `change` proposal with no `changes` changes nothing');
      }

      const unknown = keys.filter((k) => !(CHANGEABLE as readonly string[]).includes(k));
      if (unknown.length > 0) {
        throw unusable(
          proposal,
          `a \`change\` proposal names fields Laika cannot set: ${unknown.join(', ')}`,
        );
      }

      // Status first and separately: §5 makes a transition a validated
      // operation with its own table, and `updateTask` deliberately refuses to
      // carry one. Routing it through the field update would be the exact
      // route-around that comment warns about.
      let last: ProposalOutcome = { effect: 'task.updated', task_id: taskId };

      if ('status' in changes) {
        const to = asStatus(proposal, changes.status);
        changeStatus(db, actor, taskId, to, now);
        last = { effect: 'task.status_changed', task_id: taskId, to };
      }

      const fields: UpdateTaskInput = { now };
      let anyField = false;
      if ('title' in changes) {
        fields.title = asText(proposal, 'title', changes.title);
        anyField = true;
      }
      if ('description' in changes) {
        fields.description_md = asText(proposal, 'description', changes.description);
        anyField = true;
      }
      if ('priority' in changes) {
        fields.priority = asPriority(proposal, changes.priority);
        anyField = true;
      }

      if (anyField) {
        updateTask(db, actor, taskId, fields);
        last = { effect: 'task.updated', task_id: taskId };
      }

      return last;
    }

    case 'decision': {
      // §11.4.2: "Accepted `decision` proposals from a meeting diff append to
      // it with the date. That is the mechanism that keeps it current instead
      // of stale." So a decision is **not** a no-op, and the task file's note
      // wondering whether it might be is answered by the spec rather than by a
      // choice made here.
      const text = proposal.description ?? proposal.title ?? proposal.reason;
      if (text === null) {
        throw unusable(proposal, 'a `decision` proposal with nothing to record appends nothing');
      }

      const current = db
        .select({ context: projects.contextMd })
        .from(projects)
        .where(eq(projects.id, project.id))
        .get();

      updateProjectContext(db, actor, project.slug, {
        context_md: appendDecision(current?.context ?? '', text, now),
        now,
      });

      return { effect: 'context.appended' };
    }

    default:
      // Exhaustive over `PROPOSAL_KINDS`. A fifth kind added to §10.2 is a
      // compile error here rather than a proposal that silently does nothing —
      // which is the failure the task's Notes name: "a proposal kind that
      // silently does nothing is worse than one that is refused".
      return unreachable(proposal.kind);
  }
}

function unreachable(kind: never): never {
  throw new ApiError('internal', `unhandled proposal kind ${JSON.stringify(kind)}`);
}

function unusable(proposal: StoredProposal, why: string): ApiError {
  return new ApiError('unprocessable', why, { proposal_id: proposal.id, kind: proposal.kind });
}

/** `change` and `dead` concern an existing task, so a missing one is refused. */
function requireProposalTask(db: Db, proposal: StoredProposal): string {
  if (proposal.task === null) {
    throw unusable(proposal, `a \`${proposal.kind}\` proposal names no task`);
  }

  const taskId = resolveTaskRef(db, proposal.task);
  const row = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();

  // `resolveTaskRef` hands back the original string when nothing matches, so
  // this is where "the model referred to a task that does not exist" becomes an
  // error rather than a lookup failure three frames down.
  if (row === undefined) {
    throw unusable(proposal, `no task ${proposal.task}`);
  }

  return row.id;
}

function asStatus(proposal: StoredProposal, value: unknown): TaskStatus {
  if (typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus;
  }
  throw unusable(proposal, `\`${JSON.stringify(value)}\` is not a status`);
}

function asPriority(proposal: StoredProposal, value: unknown): TaskPriority {
  if (typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as TaskPriority;
  }
  throw unusable(proposal, `\`${JSON.stringify(value)}\` is not a priority`);
}

function asText(proposal: StoredProposal, field: string, value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value;
  throw unusable(proposal, `\`${field}\` must be text`);
}

/**
 * §11.4.2: decisions live *inside* `context_md`, "appended with their date".
 *
 * The date and not the time: this is a document a person reads, and a decision
 * belongs to the day it was taken. `toISOString().slice(0, 10)` rather than a
 * locale format, because the document is shared across whoever opens it.
 */
export function appendDecision(context: string, text: string, now: number): string {
  const date = new Date(now).toISOString().slice(0, 10);
  const entry = `- ${date} — ${text.trim()}`;

  // A heading only if there is not one already, so repeated meetings collect
  // under one list rather than stacking a heading per decision.
  if (context.includes(DECISIONS_HEADING)) return `${context.trimEnd()}\n${entry}\n`;

  const body = context.trimEnd();
  return `${body === '' ? '' : `${body}\n\n`}${DECISIONS_HEADING}\n\n${entry}\n`;
}

const DECISIONS_HEADING = '## Decisions';

/**
 * Apply exactly the proposals a human accepted, and nothing else.
 *
 * ## Idempotence is per proposal, stored on the proposal
 *
 * `applied_at` is stamped into `proposals_json` as each one lands, and an id
 * already carrying one is skipped and reported back in `already_applied`. The
 * review's `status` cannot carry this: it is one column for a set, so a client
 * that posted, lost the connection, and retried would either double every
 * change or be refused wholesale — and a retry after a dropped response is the
 * ordinary case this criterion exists for, not an exotic one.
 */
export function applyMeetingReview(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  reviewId: string,
  input: ApplyReviewInput,
): ApplyReviewResult {
  const now = input.now ?? Date.now();

  const review = db.select().from(meetingReviews).where(eq(meetingReviews.id, reviewId)).get();
  if (review === undefined) throw ApiError.notFound(`No meeting review ${reviewId}`);

  const project = db.select().from(projects).where(eq(projects.id, review.projectId)).get();
  if (project === undefined) throw ApiError.notFound(`No meeting review ${reviewId}`);

  const scoped = withProject(actor, project.id);
  // The right to use this endpoint at all. Every individual change is decided
  // again, by the service that performs it, against §3.2's own row.
  assertCan(scoped, 'meeting_proposal.apply', { projectId: project.id });

  // §11.6's expiry, and **distinctly from not-found** — a review that existed
  // and lapsed is a different thing to tell a person than one that never was,
  // and `404` for both would have the review screen say "no such meeting" about
  // a meeting they attended.
  //
  // Read from the row's own `expires_at` as well as its status, because the
  // cron that flips `status` runs on a schedule and the truth is the timestamp:
  // between lapse and sweep, `status` still says `pending`.
  if (review.status === 'expired' || now >= review.expiresAt) {
    throw new ApiError('conflict', 'That meeting review has expired and can no longer be applied', {
      review_id: reviewId,
      expires_at: review.expiresAt,
    });
  }

  const stored = JSON.parse(review.proposalsJson) as AppliedRecord[];
  const byId = new Map(stored.map((p) => [p.id, p]));

  // Every accepted id must be **in this review**. An id from a different review
  // is a real shape — the review screen holds one set at a time, but a stale
  // tab or a replayed request carries the previous one — and a stable id is
  // only worth having if it is checked.
  const strangers = input.accepted_proposal_ids.filter((id) => !byId.has(id));
  if (strangers.length > 0) {
    throw new ApiError('unprocessable', 'Those proposals are not in this review', {
      review_id: reviewId,
      unknown_proposal_ids: strangers,
    });
  }

  const alreadyApplied: string[] = [];
  const toApply: AppliedRecord[] = [];
  for (const id of new Set(input.accepted_proposal_ids)) {
    const proposal = byId.get(id)!;
    if (proposal.applied_at === undefined) toApply.push(proposal);
    else alreadyApplied.push(id);
  }

  if (toApply.length === 0) {
    return {
      id: reviewId,
      status: review.status,
      applied: [],
      already_applied: alreadyApplied,
    };
  }

  // One transaction for the whole set: a proposal refused at position three
  // takes one and two with it. A test forces exactly that.
  const applied = immediateTransaction(sqlite, () => {
    const results: AppliedProposal[] = [];

    for (const proposal of toApply) {
      const outcome = applyProposal(sqlite, db, actor, project, proposal, now);
      proposal.applied_at = now;
      results.push({ id: proposal.id, kind: proposal.kind, outcome });
    }

    db.update(meetingReviews)
      .set({
        // `applied` once anything has landed. The unaccepted proposals are not
        // applied and never will be — that is the human gate, not an omission.
        status: 'applied',
        proposalsJson: JSON.stringify(stored),
        reviewedBy: actor.userId,
        reviewedAt: now,
      })
      .where(eq(meetingReviews.id, reviewId))
      .run();

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      ...activityActor(actor),
      type: 'meeting.applied',
      // **Which proposals**, not that a meeting was applied. An audit row
      // saying only the latter is the one §4.8's vocabulary exists to prevent,
      // and it is the row somebody reads when asking why a task moved.
      payload: {
        review_id: reviewId,
        applied: results.map((r) => ({ proposal_id: r.id, kind: r.kind, ...r.outcome })),
        proposals_total: stored.length,
      },
      now,
    });

    return results;
  });

  return { id: reviewId, status: 'applied', applied, already_applied: alreadyApplied };
}

/** A stored proposal plus the stamp that makes a repeat apply a no-op. */
interface AppliedRecord extends StoredProposal {
  applied_at?: number;
}
