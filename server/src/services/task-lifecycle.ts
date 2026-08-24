import { type TaskStatus } from '../db/enums.ts';
import { ApiError } from '../errors.ts';

/**
 * The §5 transition rules, as data.
 *
 * §5 draws the forward path — `backlog → todo → in_progress → review → done` —
 * and states the constraints around it, but does not enumerate the reverse edges
 * a real board needs. The table below fills those in; each choice is argued
 * because the spec does not make it:
 *
 * - **Grooming moves both ways.** `backlog ⇄ todo` is refinement, not progress.
 * - **Work can go back.** `in_progress → todo`/`backlog` is what happens when a
 *   task turns out to be blocked or misunderstood, and `review → in_progress`
 *   is a rejected review. Forbidding these would push people to cancel and
 *   recreate, which loses the history the `activity` table exists to keep.
 * - **`done` can be reopened**, to `in_progress` only. A task found incomplete
 *   after the fact is common; the alternative is a duplicate task and a broken
 *   trail. Reopening is deliberately not a route back to `backlog` — a finished
 *   thing that needs more work is in progress, not unrefined.
 * - **`cancelled` is reachable from anywhere except `done`**, and can be undone
 *   back to `backlog`. Cancelling something already finished is meaningless;
 *   reopening it is the operation that was wanted.
 *
 * Everything not listed is refused, and a no-op transition to the same status is
 * refused too — it would write an `activity` row claiming a change happened.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  backlog: ['todo', 'in_progress', 'cancelled'],
  todo: ['backlog', 'in_progress', 'cancelled'],
  in_progress: ['backlog', 'todo', 'review', 'cancelled'],
  review: ['in_progress', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: ['backlog'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) {
    throw new ApiError('conflict', `That task is already ${to}`, { from, to });
  }

  if (!canTransition(from, to)) {
    throw new ApiError('unprocessable', `Cannot move a task from ${from} to ${to}`, {
      from,
      to,
      allowed: ALLOWED_TRANSITIONS[from],
    });
  }
}

/**
 * Statuses that count as ready (SPEC §4.5).
 *
 * **Both** `backlog` and `todo`. §4.5 is explicit that the distinction is for
 * humans triaging, not for the readiness computation: `backlog` is unrefined and
 * `todo` is groomed, and an unassigned unblocked task in either is something an
 * agent may pick up. Earlier task text omitted `todo`, which would have made
 * `list_ready_tasks` (§7.1) silently miss the very tasks most ready to start.
 */
export const READY_STATUSES: readonly TaskStatus[] = ['backlog', 'todo'];

export interface ReadinessInput {
  status: TaskStatus;
  assigneeId: string | null;
  /** Statuses of everything this task depends on. */
  dependencyStatuses: readonly TaskStatus[];
}

/**
 * `ready` is **derived, never stored** (§4.5). Computing it means it cannot go
 * stale — the alternative is a column that has to be recalculated every time any
 * dependency moves, which is exactly the kind of denormalisation that ends up
 * wrong without anyone noticing.
 */
export function isReady(task: ReadinessInput): boolean {
  if (!READY_STATUSES.includes(task.status)) return false;
  if (task.assigneeId !== null) return false;

  return task.dependencyStatuses.every((status) => status === 'done');
}
