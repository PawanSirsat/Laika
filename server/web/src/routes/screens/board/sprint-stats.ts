import { daysLeft } from '../sprints/sprint-derive.ts';
import type { Sprint } from '../../../api/sprints.ts';
import type { Task, TaskFilter } from '../../../api/tasks.ts';

/**
 * The toolbar's DONE / BLK / LEFT (LAI-727) — the figures the sprint strip
 * carried, kept when the owner removed the strip.
 *
 * **The same definitions, not new ones.** `countFor` in `SprintStrip.tsx`
 * counted every task in scope, subtasks included; a task is blocked when it is
 * not `ready` (§4.5, server-computed) and not done; LEFT is the selected
 * sprint's days remaining, and nothing for every sprint. The unit test pins
 * these against a copy of the strip's function.
 */
export interface StatCounts {
  readonly total: number;
  readonly done: number;
  readonly blocked: number;
}

export function countStats(tasks: readonly Pick<Task, 'status' | 'ready'>[]): StatCounts {
  let done = 0;
  let blocked = 0;
  for (const task of tasks) {
    if (task.status === 'done') done += 1;
    else if (!task.ready) blocked += 1;
  }
  return { total: tasks.length, done, blocked };
}

export interface StatsScope {
  /** `S4`, `All sprints`, `No sprint` — what the figures are of. */
  readonly label: string;
  /** The sprint's name, for the group's accessible name and tooltip. */
  readonly name: string | undefined;
  /** Days left in the sprint, inclusive; `undefined` when there is no one sprint. */
  readonly daysLeft: number | undefined;
}

/**
 * Name the scope the way the board names sprints elsewhere: `S<n>` in the
 * order the project lists them, which is what the strip's chips and the
 * Filter popover's options say.
 *
 * `sprints` is `undefined` until the list has been read — a sprint id cannot
 * be called unknown before the answer that would know it.
 */
export function statsScope(
  scope: string | undefined,
  sprints: readonly Sprint[] | undefined,
  now: number,
): StatsScope {
  if (scope === undefined) return { label: 'All sprints', name: undefined, daysLeft: undefined };
  if (scope === 'none') return { label: 'No sprint', name: undefined, daysLeft: undefined };
  if (sprints === undefined) return { label: 'Sprint', name: undefined, daysLeft: undefined };
  const index = sprints.findIndex((s) => s.id === scope);
  const found = sprints[index];
  if (found === undefined) return { label: 'Unknown sprint', name: undefined, daysLeft: undefined };
  return {
    label: `S${String(index + 1)}`,
    name: found.name,
    daysLeft: daysLeft(found.ends_on, now),
  };
}

/**
 * Whether the board's read is narrower than the sprint it is scoped to.
 *
 * When it is not, the board's own task set **is** the set the strip counted
 * for that sprint, and no second read is needed. Search, Blocked, Top-level,
 * Overdue and the agent toggle are applied in the browser after the read, so
 * they never narrow it; these are the ones the server applies.
 */
export function narrowsBeyondSprint(filter: TaskFilter): boolean {
  return (
    filter.status !== undefined ||
    filter.priority !== undefined ||
    filter.assignee !== undefined ||
    filter.ready !== undefined ||
    filter.tag !== undefined ||
    filter.updated_since !== undefined ||
    filter.parent !== undefined
  );
}
