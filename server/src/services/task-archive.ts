import { eq } from 'drizzle-orm';
import { type ServiceCaller } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';

/**
 * **An archived task, or one in Trash, is read-only** (§4.5, LAI-1353,
 * LAI-1354): every write to it but its restore — its fields, its status, a
 * claim, a dependency, its place, a sprint, a comment — is refused `409
 * conflict` with `details.reason` `archived` or `deleted`, so a person, an
 * agent or the webhook gets one answer that says what to do. §6.3's
 * vocabulary is closed (D-021), so the reason names it, as
 * `agent_cannot_mark_done` does.
 *
 * **A task in Trash does not exist to a token** (LAI-1354): an agent, a CLI
 * or a script is answered `404`, exactly as for an id that names nothing, so
 * no work is offered from Trash and nothing there is confirmed to exist.
 *
 * Its own module so `comments.ts`, which `tasks.ts` imports, can ask it too.
 */
export const TASK_ARCHIVED = 'archived';
export const TASK_DELETED = 'deleted';

/** A credential acting, rather than a person signed in to the web app. */
export function isTokenCaller(actor: ServiceCaller | undefined): boolean {
  return (
    actor !== undefined && 'token' in actor && actor.token !== null && actor.token !== undefined
  );
}

/** The `404` a token gets for a task in Trash: the one a missing id gets. */
export function noSuchTask(taskId: string): ApiError {
  return ApiError.notFound(`No task with id "${taskId}"`);
}

export function assertTaskLive(
  task: { id: string; archivedAt: number | null; deletedAt: number | null },
  actor?: ServiceCaller,
): void {
  if (task.deletedAt !== null) {
    if (isTokenCaller(actor)) throw noSuchTask(task.id);
    throw new ApiError('conflict', 'This task is in Trash. Restore it before changing it.', {
      reason: TASK_DELETED,
    });
  }
  if (task.archivedAt === null) return;
  throw new ApiError('conflict', 'This task is archived. Restore it before changing it.', {
    reason: TASK_ARCHIVED,
  });
}

/**
 * **The whole of `/tasks/:id` answers a token `404` for a task in Trash**
 * (LAI-1354 review): its comments, files, rounds, checkpoints, offers,
 * watchers, estimate, time and usage, read or written — not only the task
 * itself. Asked once, ahead of every route under it (`trashGate`), so no
 * route can be the one that forgot. A person, and an id that names nothing,
 * pass through to the route's own answer.
 */
export function assertTaskReachable(
  db: Db,
  actor: ServiceCaller | null | undefined,
  taskId: string,
): void {
  if (!isTokenCaller(actor ?? undefined)) return;
  const row = db
    .select({ deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (row !== undefined && row.deletedAt !== null) throw noSuchTask(taskId);
}
