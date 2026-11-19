import { and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import {
  activityActor,
  isSystemPrincipal,
  type ResolvedActor,
  withProject,
} from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  attachments,
  comments,
  projects,
  taskCheckpoints,
  taskDependencies,
  taskReviews,
  taskRounds,
  tasks,
  taskTags,
  taskWatchers,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, type Principal, systemPrincipal } from '../policy/can.ts';
import { isTokenCaller, noSuchTask } from './task-archive.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a task waits in Trash before it is scrubbed (§4.5, LAI-1354, LAI-1355). */
export const TRASH_KEPT_DAYS = 30;
export const TRASH_KEPT_MS = TRASH_KEPT_DAYS * DAY_MS;

/** What a scrubbed task is called — on its row, so every reader of a title says it. */
export const PURGED_TITLE = 'Deleted task';

/** At most this many tasks a run: the rest wait a day, or the next boot. */
const PURGE_BATCH = 500;

/**
 * **Delete now** (§4.5, §6.4, LAI-1355) — `POST /tasks/:id/purge`: scrub a
 * task in Trash at once, rather than when its 30 days are up. `task.purge`: a
 * space admin, signed in. The task must already be in Trash (`not_in_trash`):
 * this is the second step of a delete, never the first.
 *
 * Its subtasks in Trash go with it — they can only be there while it is, and
 * a subtask can never be restored under a parent that will not come back.
 * Answers the ids it scrubbed; the task is `404` from now on.
 */
export function purgeTask(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): { purged: string[] } {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  // Scrubbed already is gone, to everyone; Trash does not exist to a token.
  if (task?.purgedAt !== null) throw noSuchTask(taskId);
  if (task.deletedAt !== null && isTokenCaller(actor)) throw noSuchTask(taskId);
  if (isTokenCaller(actor)) {
    throw new ApiError(
      'forbidden',
      'Deleting a task for good is a person’s decision, on a signed-in web session',
      { reason: 'session_required' },
    );
  }
  assertCan(withProject(actor, task.projectId), 'task.purge', { projectId: task.projectId });
  const notInTrash = () =>
    new ApiError('conflict', 'Move the task to Trash first.', { reason: 'not_in_trash' });
  if (task.deletedAt === null) throw notInTrash();

  return db.transaction(
    () => {
      // Under the write lock, both again, as the job asks: two people at once
      // scrub once, and a restore that landed first is never undone by this.
      const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
      if (row.purgedAt !== null) throw noSuchTask(taskId);
      if (row.deletedAt === null) throw notInTrash();
      return { purged: scrub(db, actor, row, now) };
    },
    { behavior: 'immediate' },
  );
}

/**
 * **The daily scrub** (§11.6, LAI-1355): every task in Trash for 30 days,
 * scrubbed as the system — the promise the Trash banner's *days left* makes.
 * Daily and once at boot, so a server restarted every night still keeps it.
 *
 * One task to a transaction, at most {@link PURGE_BATCH} a run; a subtask
 * that went with its parent is scrubbed with it and not counted again.
 */
export function purgeExpiredTrash(db: Db, now: number): { changed: number } {
  const system = systemPrincipal();
  assertCan(system, 'system.task.purge');

  const due = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.deletedAt),
        lte(tasks.deletedAt, now - TRASH_KEPT_MS),
        isNull(tasks.purgedAt),
      ),
    )
    .limit(PURGE_BATCH)
    .all();

  let changed = 0;
  for (const { id } of due) {
    changed += db.transaction(
      () => {
        const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
        // Gone with its parent earlier in this run, or brought back meanwhile.
        if (row?.purgedAt !== null || row.deletedAt === null) return 0;
        return scrub(db, system, row, now).length;
      },
      { behavior: 'immediate' },
    );
  }
  return { changed };
}

/**
 * **What a scrub erases, and what it keeps** (§4.5, LAI-1355).
 *
 * Erased — everything written *on* the task: its title (now *Deleted task*),
 * description, acceptance, Ships, solves, unlocks and branch; its comments'
 * bodies, the comments removed; its files removed, their names too, and the
 * stored objects left to §11.6's hourly sweep; the summaries of its review
 * rounds, the reasons of its reviews and its checkpoints' summaries; its
 * tags, watchers and dependencies, both ways; and its outside id, which
 * another card may now take.
 *
 * Kept — the row, so its number is never handed out again and its key still
 * names it; its `activity`, which is append-only (§4.8) — **including the old
 * values earlier `task.updated` rows carry**, the one known limit; its time
 * entries, which keep their own copied text for three years (BCEA s31); and
 * its estimates, which are history too.
 *
 * Runs inside the caller's transaction. Answers the ids it scrubbed: the task
 * and its subtasks in Trash.
 */
function scrub(db: Db, actor: Principal, row: typeof tasks.$inferSelect, now: number): string[] {
  const subtasks = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, row.id), isNotNull(tasks.deletedAt), isNull(tasks.purgedAt)))
    .all()
    .map((t) => t.id);
  const ids = [row.id, ...subtasks];
  const remover = isSystemPrincipal(actor) ? null : actor.userId;

  db.update(tasks)
    .set({
      title: PURGED_TITLE,
      descriptionMd: null,
      acceptanceMd: null,
      deliverables: [],
      solves: [],
      unlocks: [],
      branch: null,
      externalRef: null,
      purgedAt: now,
      updatedAt: now,
    })
    .where(inArray(tasks.id, ids))
    .run();

  const commentIds = db
    .select({ id: comments.id })
    .from(comments)
    .where(inArray(comments.taskId, ids))
    .all()
    .map((c) => c.id);
  db.update(comments)
    .set({ bodyMd: '', updatedAt: now })
    .where(inArray(comments.taskId, ids))
    .run();
  db.update(comments)
    .set({ deletedAt: now })
    .where(and(inArray(comments.taskId, ids), isNull(comments.deletedAt)))
    .run();

  const filesOf = or(
    inArray(attachments.taskId, ids),
    commentIds.length === 0 ? undefined : inArray(attachments.commentId, commentIds),
  );
  db.update(attachments).set({ filename: 'deleted' }).where(filesOf).run();
  db.update(attachments)
    .set({ deletedAt: now, deletedBy: remover })
    .where(and(filesOf, isNull(attachments.deletedAt)))
    .run();

  db.update(taskRounds).set({ summaryMd: '' }).where(inArray(taskRounds.taskId, ids)).run();
  db.update(taskReviews).set({ reasonMd: null }).where(inArray(taskReviews.taskId, ids)).run();
  db.update(taskCheckpoints)
    .set({ summary: null })
    .where(inArray(taskCheckpoints.taskId, ids))
    .run();

  db.delete(taskTags).where(inArray(taskTags.taskId, ids)).run();
  db.delete(taskWatchers).where(inArray(taskWatchers.taskId, ids)).run();
  db.delete(taskDependencies)
    .where(
      or(inArray(taskDependencies.taskId, ids), inArray(taskDependencies.dependsOnTaskId, ids)),
    )
    .run();

  const orgId = db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .get()!.orgId;
  for (const id of ids) {
    appendActivity(db, {
      orgId,
      projectId: row.projectId,
      taskId: id,
      ...activityActor(actor),
      type: 'task.purged',
      // A subtask names the parent it went with, as the shelves' rows do.
      payload: id === row.id ? {} : { with_parent: row.id },
      now,
    });
  }
  return ids;
}
