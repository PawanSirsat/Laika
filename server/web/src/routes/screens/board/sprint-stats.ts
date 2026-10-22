import { heldByBlocker } from '../../../api/board-derive.ts';
import { daysLeft, daysUntilStart } from '../sprints/sprint-derive.ts';
import type { Sprint } from '../../../api/sprints.ts';
import type { TaskSummary } from '../../../api/tasks.ts';

/**
 * The toolbar's DONE / BLK / LEFT (LAI-727) — the figures the sprint strip
 * carried, kept when the owner removed the strip.
 *
 * DONE is the strip's: every task in scope, subtasks included, and those of
 * them done. **BLK is not the strip's any more** (LAI-819): the strip counted
 * every task that was not `ready` and not done, and `ready` is also false for
 * every assigned task, so a 99-task sprint read BLK 95 where 9 were blocked.
 * BLK is now open work waiting on an unfinished dependency — `heldByBlocker`,
 * the server's rule — judged against the whole project, so a blocker in
 * another sprint still counts. LEFT is the selected sprint's days remaining,
 * or how soon it starts when its first day is still ahead.
 */
export interface StatCounts {
  readonly total: number;
  readonly done: number;
  readonly blocked: number;
}

export function countStats(
  tasks: readonly Pick<TaskSummary, 'status' | 'ready' | 'blocked_by'>[],
  byId: ReadonlyMap<string, Pick<TaskSummary, 'status'>>,
): StatCounts {
  let done = 0;
  let blocked = 0;
  for (const task of tasks) {
    if (task.status === 'done') done += 1;
    else if (heldByBlocker(task, byId)) blocked += 1;
  }
  return { total: tasks.length, done, blocked };
}

export interface StatsScope {
  /** `S4`, `All sprints`, `No sprint` — what the figures are of. */
  readonly label: string;
  /** The sprint's name, for the group's accessible name and tooltip. */
  readonly name: string | undefined;
  /**
   * Days left in the sprint, inclusive; `undefined` when there is no one
   * sprint, or when it has not started — LEFT 26 on a sprint that starts in a
   * fortnight counted days nobody can work yet (LAI-819).
   */
  readonly daysLeft: number | undefined;
  /** Whole days until the sprint's first day, when that is still ahead. */
  readonly startsIn: number | undefined;
}

const NO_SPRINT = { name: undefined, daysLeft: undefined, startsIn: undefined } as const;

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
  if (scope === undefined) return { label: 'All sprints', ...NO_SPRINT };
  if (scope === 'none') return { label: 'No sprint', ...NO_SPRINT };
  if (sprints === undefined) return { label: 'Sprint', ...NO_SPRINT };
  const index = sprints.findIndex((s) => s.id === scope);
  const found = sprints[index];
  if (found === undefined) return { label: 'Unknown sprint', ...NO_SPRINT };
  const startsIn = daysUntilStart(found.starts_on, now);
  return {
    label: `S${String(index + 1)}`,
    name: found.name,
    daysLeft: startsIn > 0 ? undefined : daysLeft(found.ends_on, now),
    startsIn: startsIn > 0 ? startsIn : undefined,
  };
}
