import type { Task } from './tasks.ts';

/**
 * Board-level facts that are **not** on the wire, derived from a task list.
 *
 * Kept separate from `tasks.ts` and pure, so it can be unit-tested without a
 * transport, and so the boundary is obvious: everything here is a client-side
 * derivation and everything in `tasks.ts` is the server's word.
 *
 * `ready` is deliberately absent — the server computes it (§4.5) and the UI
 * displays it. Recomputing it here would create a second definition that drifts.
 */

export const BOARD_COLUMNS = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const COLUMN_LABELS: Readonly<Record<BoardColumn, string>> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
};

/**
 * Does this task have a dependency that is not finished?
 *
 * Resolved against the tasks we hold, because the API returns dependency **ids**
 * and not their statuses. That means a dependency outside the fetched set cannot
 * be judged — and `undefined` says so rather than guessing. Guessing `false`
 * would draw an unblocked card over a blocked task, which is the more damaging
 * error: it invites someone to start work that cannot proceed.
 */
export function blockedState(task: Task, byId: ReadonlyMap<string, Task>): boolean | undefined {
  if (task.blocked_by.length === 0) return false;

  let unknown = false;
  for (const id of task.blocked_by) {
    const dependency = byId.get(id);
    if (dependency === undefined) {
      unknown = true;
      continue;
    }
    if (dependency.status !== 'done' && dependency.status !== 'cancelled') return true;
  }

  return unknown ? undefined : false;
}

/**
 * The entries in `blocked_by` that are actually holding a task up.
 *
 * `blockedState` answers *whether* — this answers *which*, because LAI-066 asks
 * the card to **name the blocker**: a bare "blocked" badge tells someone they
 * are stuck and then makes them go hunting for what by.
 *
 * Only unmet ones, and only those loaded on this board. A dependency the board
 * has not loaded cannot be named, which is the same `undefined` case
 * `blockedState` reports — the card says the count is unknown rather than
 * naming a subset and implying it is the whole story.
 */
export function blockers(task: Task, byId: ReadonlyMap<string, Task>): readonly Task[] {
  const found: Task[] = [];
  for (const id of task.blocked_by) {
    const dependency = byId.get(id);
    if (dependency === undefined) continue;
    if (dependency.status !== 'done' && dependency.status !== 'cancelled') found.push(dependency);
  }
  return found;
}

/**
 * How long this task has been flagged stale, compactly — `9d`, `5h`, `12m`.
 *
 * **This formats a timestamp; it does not decide anything.** Whether a task is
 * stale is three conditions evaluated by the nightly job (§11.6), and the only
 * question here is what to print next to the marker. `ready` is absent from this
 * module for the same reason and it is worth keeping the distinction sharp: a
 * second *definition* drifts, a second *rendering* of a served value does not.
 *
 * Coarse, because the signal is: the job runs nightly against a three-day
 * window, so a minute-accurate figure would imply a precision the number does
 * not have. Days once it has been a day.
 *
 * `stale_flagged_at` is the *server's* clock and `now` is the *browser's*; they
 * disagree routinely, and a few seconds is enough for `now - flaggedAt` to go
 * negative.
 *
 * **The clamp does not change today's output, and the comment here said it did
 * until a mutation proved otherwise.** A negative `elapsed` gives a negative
 * `minutes`, which is `< 1`, so the first branch already returns `now` — the
 * branch order is what prevents `-1m`, not `Math.max`. The clamp earns its place
 * against the obvious tidy-up: the moment somebody guards that branch as
 * `elapsed >= 0 && minutes < 1`, an unclamped negative falls straight through to
 * the `d` case and renders `-8999d`.
 *
 * `relativeTime` in `dashboard-derive.ts` carries the same pair and says so in
 * the same terms. **Removing either alone leaves the tests green; that is the
 * point of keeping both**, and it is why the test below says which one it is
 * really covering.
 */
export function staleFor(flaggedAt: number, now: number): string {
  const elapsed = Math.max(0, now - flaggedAt);

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${String(minutes)}m`;

  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${String(hours)}h`;

  return `${String(Math.floor(elapsed / 86_400_000))}d`;
}

export function byIdIndex(tasks: readonly Task[]): ReadonlyMap<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** Tasks per column, in the order the board draws them. */
export function groupByColumn(tasks: readonly Task[]): Record<BoardColumn, Task[]> {
  const groups = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, [] as Task[]])) as Record<
    BoardColumn,
    Task[]
  >;

  for (const task of tasks) {
    // `cancelled` is behind a filter, not a column (§11.4.1) — it is dropped
    // here rather than given a home.
    if (task.status === 'cancelled') continue;
    groups[task.status].push(task);
  }

  // p1 before p2 before p3, then oldest first — the order someone picking up
  // work would want, and stable so a re-render never reshuffles the board.
  for (const column of BOARD_COLUMNS) {
    groups[column].sort((a, b) => a.priority.localeCompare(b.priority) || a.number - b.number);
  }

  return groups;
}
