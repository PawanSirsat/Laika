import { and, eq, inArray, sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { activity, projects, tasks, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { can } from '../policy/can.ts';
import { addComment } from './comments.ts';
import { fastFinishCues, type FastFinishCue } from './estimates.ts';
import { latestRounds, recordDecision, type RoundView } from './rounds.ts';
import { assertMayCloseReview, changeStatus, getTask, viewTasks, type TaskView } from './tasks.ts';

/**
 * The review queue and the two decisions a person makes there (SPEC §6.4,
 * §11.4, D-082, LAIKA-478).
 *
 * **Accept** moves a task waiting in review to the project's first visible
 * done status; **send back** moves it to the first visible in-progress status,
 * with a reason that is posted as a comment and read to the next agent first.
 * Both are a person's, on a web session: a token is refused both, whoever's it
 * is, because accepting is the one thing the gate exists to keep from agents.
 *
 * Neither is a new activity verb (CLAUDE.md §4.4): each is the
 * `task.status_changed` row `changeStatus` writes, carrying `via`, and a
 * send-back's reason is the `comment.added` row of its comment.
 */

/** How many tasks the queue returns at most, oldest waiting first. */
export const REVIEW_QUEUE_LIMIT = 200;

/** A send-back's reason: required, and a comment's worth at most. */
export const SEND_BACK_REASON_MAX = 5000;

export interface ReviewQueueItem {
  task: TaskView;
  project: { id: string; slug: string; name: string; prefix: string };
  assignee_name: string | null;
  /** When the task last entered a review status — what "waiting" counts from. */
  waiting_since: number;
  /** The latest round, or null when it reached review without a finish. */
  round: RoundView | null;
  finished_by_name: string | null;
  /** Whether this viewer may accept or send it back (§5, M7). */
  can_decide: boolean;
  /**
   * "Check this one" (LAI-772, the R&D's idea 7): its first round finished in
   * under a quarter of the build-time p50 frozen at the start, and CI has not
   * confirmed it. About the task, never the person; null otherwise.
   */
  cue: FastFinishCue | null;
}

export interface ReviewQueueView {
  tasks: ReviewQueueItem[];
  /** True when more tasks are waiting than the queue returned. */
  truncated: boolean;
}

/** A refusal for a token, said as a session one (D-079's shape). */
function assertSession(actor: ResolvedActor): void {
  if (actor.token === null || actor.token === undefined) return;
  throw new ApiError(
    'forbidden',
    'Accepting and sending back are a person’s decisions, on a signed-in web session',
    { reason: 'session_required' },
  );
}

/**
 * When each task last entered a review status: the newest
 * `task.status_changed` into `review` from another category. A task moved
 * between two review statuses is still waiting from when it arrived.
 */
function enteredReview(db: Db, taskIds: readonly string[]): Map<string, number> {
  if (taskIds.length === 0) return new Map();
  const rows = db
    .select({ taskId: activity.taskId, at: sql<number>`MAX(${activity.createdAt})` })
    .from(activity)
    .where(
      and(
        inArray(activity.taskId, [...taskIds]),
        eq(activity.type, 'task.status_changed'),
        sql`json_extract(${activity.payloadJson}, '$.to') = 'review'`,
        sql`json_extract(${activity.payloadJson}, '$.from') <> 'review'`,
      ),
    )
    .groupBy(activity.taskId)
    .all();
  return new Map(
    rows.flatMap((r) => (r.taskId === null ? [] : [[r.taskId, Number(r.at)] as const])),
  );
}

/**
 * Every task in a review-category status, across every project this person
 * can act on (`task.write`), oldest waiting first (`GET /api/v1/review`).
 * Readable by any credential that can act on those projects; only the
 * decisions are a session's.
 */
export function listReviewQueue(db: Db, actor: ResolvedActor): ReviewQueueView {
  const actable = db
    .select({ id: projects.id, slug: projects.slug, name: projects.name, prefix: projects.prefix })
    .from(projects)
    .all()
    .filter((p) => can(withProject(actor, p.id), 'task.write', { projectId: p.id }));
  if (actable.length === 0) return { tasks: [], truncated: false };

  const rows = db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.projectId,
          actable.map((p) => p.id),
        ),
        eq(tasks.status, 'review'),
      ),
    )
    .all();

  const since = enteredReview(
    db,
    rows.map((r) => r.id),
  );
  const waiting = (row: (typeof rows)[number]) => since.get(row.id) ?? row.updatedAt;
  const ordered = [...rows].sort((a, b) => waiting(a) - waiting(b) || a.id.localeCompare(b.id));
  const page = ordered.slice(0, REVIEW_QUEUE_LIMIT);

  const projectOf = new Map(actable.map((p) => [p.id, p]));
  const views = viewTasks(db, page, new Map(actable.map((p) => [p.id, p.prefix])), actor.userId);
  const rounds = latestRounds(
    db,
    page.map((r) => r.id),
    actor.userId,
  );
  // A round CI confirmed is checked already: the cue is for work nothing has.
  const confirmed = (round: RoundView | undefined) =>
    round?.ci != null && round.ci.total > 0 && round.ci.failed === 0 && round.ci.pending === 0;
  const cues = fastFinishCues(
    db,
    page.map((r) => {
      const round = rounds.get(r.id);
      return {
        id: r.id,
        startedAt: r.startedAt,
        estimateAtStartId: r.estimateAtStartId,
        firstRoundAt: round?.number === 1 && !confirmed(round) ? round.created_at : null,
      };
    }),
  );

  const people = [
    ...new Set(
      [...page.map((r) => r.assigneeId), ...[...rounds.values()].map((r) => r.finished_by)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const names = new Map(
    people.length === 0
      ? []
      : db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, people))
          .all()
          .map((u) => [u.id, u.name] as const),
  );

  const items = page.map((row, i): ReviewQueueItem => {
    const project = projectOf.get(row.projectId)!;
    const round = rounds.get(row.id) ?? null;
    let decide = true;
    try {
      assertMayCloseReview(actor, row, 'done');
    } catch {
      decide = false;
    }
    return {
      task: views[i]!,
      project,
      assignee_name: row.assigneeId === null ? null : (names.get(row.assigneeId) ?? null),
      waiting_since: waiting(row),
      round,
      finished_by_name: round === null ? null : (names.get(round.finished_by) ?? null),
      can_decide: decide && (actor.token === null || actor.token === undefined),
      cue: cues.get(row.id) ?? null,
    };
  });

  return { tasks: items, truncated: ordered.length > page.length };
}

function requireInReview(db: Db, actor: ResolvedActor, taskId: string) {
  // `getTask` asks `project.read`, so a task this person cannot see is a 404
  // here as it is everywhere, not a hint that it exists.
  getTask(db, actor, taskId);
  const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
  if (row.status !== 'review') {
    throw new ApiError('conflict', 'That task is not waiting for review', {
      status: row.status,
      reason: 'not_in_review',
    });
  }
  return row;
}

/**
 * Accept (`POST /api/v1/tasks/:id/accept`): the task moves to its project's
 * first visible done status, and a decision row records who accepted it and
 * which round. Web session only; the permission is moving into done's (§5,
 * M7) — `changeStatus` asks it.
 */
export function acceptTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): TaskView {
  assertSession(actor);

  return immediateTransaction(sqlite, () => {
    requireInReview(db, actor, taskId);
    changeStatus(db, actor, taskId, 'done', now, 'human', 'accept');
    recordDecision(db, {
      taskId,
      decision: 'accepted',
      reasonMd: null,
      commentId: null,
      decidedBy: actor.userId,
      now,
    });
    return getTask(db, actor, taskId);
  });
}

/**
 * Send back (`POST /api/v1/tasks/:id/send-back`): the task moves to its
 * project's first visible in-progress status, the reason is posted as a
 * comment by the person sending it back, and a decision row marks that
 * comment as the send-back. The reason is the task's `send_back` until the
 * next finish (§4.27). Web session only, with accept's permission: who may
 * close a review may also refuse to.
 */
export function sendBackTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  reason: string,
  now: number = Date.now(),
): TaskView {
  assertSession(actor);
  const trimmed = reason.trim();
  if (trimmed === '') {
    throw new ApiError('unprocessable', 'Say why it is going back', { field: 'reason' });
  }
  if (trimmed.length > SEND_BACK_REASON_MAX) {
    throw new ApiError(
      'unprocessable',
      `A reason is at most ${String(SEND_BACK_REASON_MAX)} characters`,
      { field: 'reason' },
    );
  }

  return immediateTransaction(sqlite, () => {
    const row = requireInReview(db, actor, taskId);
    assertMayCloseReview(actor, row, 'done');
    changeStatus(db, actor, taskId, 'in_progress', now, 'human', 'send_back');
    const comment = addComment(db, actor, taskId, trimmed, now);
    recordDecision(db, {
      taskId,
      decision: 'sent_back',
      reasonMd: trimmed,
      commentId: comment.id,
      decidedBy: actor.userId,
      now,
    });
    return getTask(db, actor, taskId);
  });
}
