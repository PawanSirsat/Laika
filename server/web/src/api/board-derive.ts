import type { BoardColumn } from './columns.ts';
import { STATUSES, type Task, type TaskStatus } from './tasks.ts';

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

/**
 * The statuses a card can be moved between.
 *
 * **Renamed from `BOARD_COLUMNS` (LAI-266), and the rename is the point.** A
 * column is now a row in `board_columns` — named, ordered, holding one or more
 * statuses — so the word was needed for the thing it actually describes. What
 * this list has always been is the set of statuses `changeStatus` accepts.
 *
 * It is a **re-export rather than a copy**. The identical array was declared
 * twice, here and in `tasks.ts`, which is the drift shape CONVENTIONS §5.1
 * exists for; the rename was the moment to collapse it.
 */
export const MOVABLE_STATUSES = STATUSES;
export type MovableStatus = (typeof STATUSES)[number];

/**
 * Every status's display name, `cancelled` included.
 *
 * The old `COLUMN_LABELS` omitted `cancelled` because it was not a board column,
 * which left five call sites each writing the same
 * `status === 'cancelled' ? 'Cancelled' : COLUMN_LABELS[status]`. One key
 * deletes all five — see `statusLabel`.
 */
export const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * Every status, including `cancelled`.
 *
 * Distinct from `MOVABLE_STATUSES` on purpose. A **drag** can never produce
 * `cancelled` — a mis-drag must not cancel somebody's work — so the board's
 * types say `MovableStatus`. The drawer's status control is the deliberate act
 * that can, and it needs all six. Before LAI-266 it listed five, which meant
 * cancelling a task was unreachable from the whole UI.
 */
export const ALL_STATUSES = [...MOVABLE_STATUSES, 'cancelled'] as const;

/** What to call a status on screen. */
export function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

/**
 * What a drop on this column sets — its first status, or `undefined` if it has
 * none.
 *
 * **The order of a column's statuses is configuration, not a heuristic.** A lead
 * who puts `todo` above `backlog` in "To do" has decided that dropping there
 * means *to do*; deriving the answer from the canonical status order instead
 * would take that decision away and hard-code it here.
 *
 * `cancelled` is skipped whatever its position. A lane that resolved to it would
 * cancel work on a mis-drag, silently, and the drawer's status control is the
 * place where cancelling should take a deliberate act.
 */
export function primaryStatus(column: BoardColumn): MovableStatus | undefined {
  return column.statuses.find((s): s is MovableStatus => s !== 'cancelled');
}

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

/**
 * How long ago a task last changed, for the card footer (LAI-263).
 *
 * **Delegates to {@link staleFor}** rather than repeating its units. The two
 * neighbouring copies of this arithmetic in this codebase are deliberate — each
 * guards its own caller and the file above says why — but a third would guard
 * nothing: this is the same question in the same units, asked about
 * `updated_at` instead of a stale flag.
 *
 * The one difference is wording. `staleFor` says `now` because it completes
 * "flagged stale …"; a footer stands alone and the design writes "just now".
 */
export function updatedAge(updatedAt: number, now: number): string {
  const compact = staleFor(updatedAt, now);
  return compact === 'now' ? 'just now' : compact;
}

export function byIdIndex(tasks: readonly Task[]): ReadonlyMap<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/**
 * Drop finished work the board has been told to stop showing (LAI-266).
 *
 * **Only `done`, and only when `completed_at` says so.** `cancelled` is not
 * "finished", and a `done` task with no `completed_at` is one whose history
 * predates the stamping (`db/backfill.ts` recovers what it can) — hiding it
 * because a column is missing would be guessing at an age nobody recorded.
 *
 * `days === null` is "never", the default, and returns the list untouched.
 *
 * Returns the tasks **and** how many went, because the board has to say so: a
 * filter nobody can see is worse than no filter, and this one removes work
 * rather than restyling it.
 */
export function hideOldDone(
  tasks: readonly Task[],
  days: number | null,
  now: number,
): { readonly kept: readonly Task[]; readonly hidden: number } {
  if (days === null) return { kept: tasks, hidden: 0 };

  const cutoff = now - days * 86_400_000;
  const kept = tasks.filter(
    (task) => !(task.status === 'done' && task.completed_at !== null && task.completed_at < cutoff),
  );

  return { kept, hidden: tasks.length - kept.length };
}

/** A column and the cards in it. */
export interface Lane {
  readonly column: BoardColumn;
  readonly tasks: Task[];
}

/**
 * Cards into lanes, in the order the board draws them.
 *
 * **An array, not a record keyed by column id.** Order is data now — it lives in
 * `position` — and in an array the order *is* the value, rather than something
 * every consumer has to remember to re-sort.
 *
 * Three rules, each of which has a test with a fixture that can violate it:
 *
 *  - **Lanes come out in `position` order**, whatever order the columns arrived
 *    in.
 *  - **A status no column lists is not drawn.** This is the general form of the
 *    old `if (task.status === 'cancelled') continue`: with `cancelled` in a
 *    hidden column, it disappears exactly as it always did — and if a project
 *    puts it in a visible one, it appears, which is now a choice somebody made.
 *  - **A status listed by two columns files into the earlier one, once.** The
 *    server forbids it with a primary key; this is what stops the board drawing
 *    the same card twice if it ever happened anyway.
 */
export function groupByColumn(tasks: readonly Task[], columns: readonly BoardColumn[]): Lane[] {
  const ordered = [...columns].sort((a, b) => a.position - b.position);

  // First column claiming a status wins, so a duplicate cannot draw twice.
  const home = new Map<TaskStatus, string>();
  for (const column of ordered) {
    for (const status of column.statuses) {
      if (!home.has(status)) home.set(status, column.id);
    }
  }

  const lanes: Lane[] = ordered.map((column) => ({ column, tasks: [] }));
  const byId = new Map(lanes.map((lane) => [lane.column.id, lane]));

  for (const task of tasks) {
    const columnId = home.get(task.status);
    // A status no column claims is drawn nowhere.
    if (columnId === undefined) continue;
    byId.get(columnId)?.tasks.push(task);
  }

  // p1 before p2 before p3, then oldest first — the order someone picking up
  // work would want, and stable so a re-render never reshuffles the board.
  for (const lane of lanes) {
    lane.tasks.sort((a, b) => a.priority.localeCompare(b.priority) || a.number - b.number);
  }

  return lanes;
}
