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

/**
 * Who is asking — because the answer differs (LAI-266).
 *
 * `agent` gets the table above, unchanged. `human` gets the widened one below.
 * The caller decides which by asking `isAgentPrincipal`; this module stays pure
 * and knows nothing about principals.
 */
export type TransitionRule = 'human' | 'agent';

/**
 * The same rules, for a person dragging a card.
 *
 * Board columns are configuration now, so a project can put `todo` and `done`
 * side by side and dragging between them is the obvious gesture. The table above
 * refuses it, and SPEC §11.4.1's *"an illegal drag snaps back and surfaces the
 * error"* is an honest answer to a question the board should not have been
 * asking. So a person may move a task between any two non-`cancelled` statuses.
 *
 * **What does not widen, and why each one holds:**
 *
 *  - **Cancellation is untouched.** `done → cancelled` stays refused — the
 *    argument above still stands, cancelling something already finished is
 *    meaningless — and `cancelled → backlog` stays the only way out.
 *  - **A no-op is still a conflict**, for the same reason as before: it would
 *    write an `activity` row claiming a change happened.
 *  - **Permission is a different question and is unchanged.** Moving to `review`
 *    still requires the assignee, a project lead or org Admin/Owner
 *    (`services/tasks.ts`). Widening *reachability* does not widen *authority*.
 *
 * **Derived from `ALLOWED_TRANSITIONS`, never written out by hand.** Two literal
 * tables would be two places to remember the cancellation rules, and the second
 * one is the one that drifts.
 */
function humanTransitions(from: TaskStatus): readonly TaskStatus[] {
  // Leaving `cancelled` is the one case where the agent table is already the
  // whole answer: a cancelled task is reinstated to `backlog` or not at all.
  if (from === 'cancelled') return ALLOWED_TRANSITIONS.cancelled;

  const open = (Object.keys(ALLOWED_TRANSITIONS) as TaskStatus[]).filter(
    (s) => s !== 'cancelled' && s !== from,
  );

  // `cancelled` is reachable only where it already was — which is everywhere
  // except from `done`.
  return ALLOWED_TRANSITIONS[from].includes('cancelled') ? [...open, 'cancelled'] : open;
}

/** The legal targets from `from`, for this kind of caller. */
export function transitionsFrom(from: TaskStatus, rule: TransitionRule): readonly TaskStatus[] {
  return rule === 'agent' ? ALLOWED_TRANSITIONS[from] : humanTransitions(from);
}

export function canTransition(from: TaskStatus, to: TaskStatus, rule: TransitionRule): boolean {
  return transitionsFrom(from, rule).includes(to);
}

/**
 * `rule` is **required rather than defaulted**, deliberately.
 *
 * A default would keep this diff small and let the next call site inherit a rule
 * nobody chose — and the rule is the difference between an agent being able to
 * mark its own work done and not. Five call sites is few enough that making the
 * compiler ask each one is worth the noise. Same posture as `withProject`'s
 * overloads: *"Three signatures say it and the compiler checks it."*
 */
export function assertTransition(from: TaskStatus, to: TaskStatus, rule: TransitionRule): void {
  if (from === to) {
    throw new ApiError('conflict', `That task is already ${to}`, { from, to });
  }

  if (!canTransition(from, to, rule)) {
    throw new ApiError('unprocessable', `Cannot move a task from ${from} to ${to}`, {
      from,
      to,
      // The list must come from the table that produced the refusal, or the
      // error body contradicts the error.
      allowed: transitionsFrom(from, rule),
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
