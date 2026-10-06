import { ALL_STATUSES } from '../../../api/board-derive.ts';
import { ApiError } from '../../../api/errors.ts';
import type { Task, TaskPriority, TaskStatus } from '../../../api/tasks.ts';

/**
 * Acting on many tasks at once (LAI-496).
 *
 * **One request per task, in order.** The server has no bulk endpoint, and
 * §7.2 keeps it that way for the tools; the List is the place the SPEC sends
 * people "when the columns are not enough", so this is where many become one
 * gesture. Sequential rather than fanned out: the server sees the same load a
 * person clicking quickly would make, and a report that says "3 of 12" means
 * what it says.
 */

/**
 * Where a person may move a task from `from`.
 *
 * **Mirrors `transitionsFrom(from, 'human')` in `server/src/services/
 * task-lifecycle.ts`**, and the mirror is asserted against the real thing in
 * `list-bulk.test.ts` — never trusted. The rule it mirrors: a person may move
 * between any two open statuses; `cancelled` is reachable from everywhere
 * but `done`, and leaves only to `backlog`. The server still validates every
 * move; this only decides what the menu offers.
 */
export function statusTargets(from: TaskStatus): readonly TaskStatus[] {
  if (from === 'cancelled') return ['backlog'];
  const open = ALL_STATUSES.filter((s) => s !== 'cancelled' && s !== from);
  return from === 'done' ? open : [...open, 'cancelled'];
}

export interface BulkFailure {
  readonly id: string;
  /** The server's own sentence where there is one (`failureMessage`). */
  readonly message: string;
}

export interface BulkOutcome {
  readonly done: readonly string[];
  readonly failed: readonly BulkFailure[];
}

/**
 * The server's words, or one honest sentence.
 *
 * An `ApiError` carries the reason the server refused — *"Cannot move a task
 * from done to cancelled"* — and that is more useful than anything invented
 * here. Anything else (a dropped connection, a thrown `TypeError`) has no
 * sentence a reader can act on, so it gets one that says what happened
 * without pretending to know why.
 */
export function failureMessage(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'The request did not reach Laika.';
}

/**
 * Run `apply` for every id, **one at a time**, and keep going past a refusal.
 *
 * A refusal in the middle of twelve is the ordinary case — one of them was
 * `done`, and `done` cannot be cancelled — and stopping there would leave the
 * reader guessing which half landed. `onProgress` is called after every task,
 * failures included, so a progress line counts what has been *tried*.
 */
export async function applyToEach(
  ids: readonly string[],
  apply: (id: string) => Promise<unknown>,
  onProgress?: (completed: number) => void,
): Promise<BulkOutcome> {
  const done: string[] = [];
  const failed: BulkFailure[] = [];
  let completed = 0;

  for (const id of ids) {
    try {
      await apply(id);
      done.push(id);
    } catch (cause) {
      failed.push({ id, message: failureMessage(cause) });
    }
    completed += 1;
    onProgress?.(completed);
  }

  return { done, failed };
}

/**
 * `2 updated`, `1 updated, 1 refused`, `0 updated, 3 already there`.
 *
 * `skipped` is how many were already in the asked-for state and were never
 * sent — the server would answer `409` to each, and a refusal the reader
 * could not have avoided is not news.
 */
export function bulkSummary(outcome: BulkOutcome, skipped: number): string {
  const parts = [`${String(outcome.done.length)} updated`];
  if (outcome.failed.length > 0) parts.push(`${String(outcome.failed.length)} refused`);
  if (skipped > 0) parts.push(`${String(skipped)} already there`);
  return parts.join(', ');
}

/* --------------------------------------------------------------- the actions */

/** What the bar can do to every selected task. */
export type BulkAction =
  | { readonly kind: 'status'; readonly status: TaskStatus }
  | { readonly kind: 'priority'; readonly priority: TaskPriority }
  | { readonly kind: 'assignee'; readonly assigneeId: string | null }
  | { readonly kind: 'sprint'; readonly sprintId: string | null }
  /**
   * *Delete* in the owner's screenshot. There is no `DELETE /tasks/:id`
   * (§6.4); `cancelled` is the status the board hides, and the server refuses
   * it from `done`, which the report shows rather than hides.
   */
  | { readonly kind: 'cancel' };

export interface BulkPlan {
  /** The tasks that need a request, in selection order. */
  readonly ids: readonly string[];
  /** Already in the asked-for state; never sent. */
  readonly skipped: number;
}

/** Does this task already have what the action would give it? */
function alreadyThere(action: BulkAction, task: Task): boolean {
  switch (action.kind) {
    case 'status':
      return task.status === action.status;
    case 'cancel':
      return task.status === 'cancelled';
    case 'priority':
      return task.priority === action.priority;
    case 'assignee':
      return task.assignee_id === action.assigneeId;
    case 'sprint':
      return task.sprint_id === action.sprintId;
  }
}

/**
 * Which of the selected tasks the action has to touch.
 *
 * The server answers `409` to a status move that changes nothing and would
 * write a no-op elsewhere; neither is a refusal the reader could have avoided,
 * so those tasks are counted and never sent.
 */
export function bulkPlan(action: BulkAction, tasks: readonly Task[]): BulkPlan {
  const ids: string[] = [];
  let skipped = 0;
  for (const task of tasks) {
    if (alreadyThere(action, task)) skipped += 1;
    else ids.push(task.id);
  }
  return { ids, skipped };
}

/** One refused task, as the report prints it. */
export interface BulkRefusal {
  readonly key: string;
  readonly message: string;
}

/**
 * A bulk action's life, held by `BoardScreen` beside the selection — the
 * board reloads when the run ends, and a reload unmounts the view, so a
 * report kept in the view would vanish the moment it was worth reading.
 */
export type BulkRun =
  | { readonly phase: 'running'; readonly completed: number; readonly total: number }
  | { readonly phase: 'done'; readonly summary: string; readonly refusals: readonly BulkRefusal[] };
