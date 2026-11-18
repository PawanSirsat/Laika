import { ApiError } from '../errors.ts';

/**
 * **An archived task is read-only** (§4.5, LAI-1353): every write to it but
 * the restore — its fields, its status, a claim, a dependency, its place, a
 * sprint, a comment — is refused `409 conflict` with `details.reason:
 * archived`, so a person, an agent or the webhook gets one answer that says
 * what to do. §6.3's vocabulary is closed (D-021), so the reason names it, as
 * `agent_cannot_mark_done` does.
 *
 * Its own module so `comments.ts`, which `tasks.ts` imports, can ask it too.
 */
export const TASK_ARCHIVED = 'archived';

export function assertTaskLive(task: { archivedAt: number | null }): void {
  if (task.archivedAt === null) return;
  throw new ApiError('conflict', 'This task is archived. Restore it before changing it.', {
    reason: TASK_ARCHIVED,
  });
}
