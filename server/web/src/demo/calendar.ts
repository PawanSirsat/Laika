import { DEMO_ENABLED } from './enabled.ts';
import type { Task } from '../api/tasks.ts';

/**
 * Due dates for the Calendar (D-032, D-059).
 *
 * **The endpoint this retires is `tasks.due_date`** — a column that does not
 * exist. `grep -rn due_date server/src` returns nothing: no field, no
 * migration, no route. Until CORE adds one there is no honest way to place a
 * task on a day, and D-059 says the Calendar ships with visible demo data
 * rather than waiting.
 *
 * So: a date derived from the task's own id, stable across renders, spread
 * over the surrounding weeks. It is **not** a guess at when the work is due —
 * it is a placeholder that says so on the screen, and
 * `test/demo/not-in-bundle.test.ts` proves it cannot reach a production build.
 *
 * Delete this file the day `tasks.due_date` lands.
 */

const DAY = 86_400_000;

/** Stable per task, so a calendar does not reshuffle on every render. */
function spread(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 997;
  // −7 … +20 days: a fortnight ahead and a week behind, which is what a board
  // in flight looks like.
  return (h % 28) - 7;
}

export function demoDueDate(task: Pick<Task, 'id' | 'status'>, now: number): number | undefined {
  if (!DEMO_ENABLED) return undefined;
  // Finished work has no due date to keep.
  if (task.status === 'done' || task.status === 'cancelled') return undefined;
  return now + spread(task.id) * DAY;
}
