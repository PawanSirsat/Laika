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

/** What to call a status on screen, ignoring how the board is arranged. */
export function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

/**
 * What to call a status **on this board** (LAI-617).
 *
 * A column can be renamed. A status cannot — `TASK_STATUSES` is a fixed enum
 * that the REST API, the policy layer and the MCP tools all depend on by
 * literal value: `laika_finish_task` moves a task to `review` and tells the
 * agent a person takes it from here. Renaming a column must not rewrite that.
 *
 * So the column name is the **label** and the status stays the **value**. A
 * board with its `Review` column renamed to `Testing` showed cards reading
 * "Review" under a header reading "TESTING", which is what made people ask
 * whether renaming was broken.
 *
 * **Only when the column owns exactly one status.** Then the name identifies
 * it exactly and the substitution is lossless. A column holding several —
 * the shipped default merges `todo` and `backlog` — cannot stand in for any
 * one of them, so those keep their own names and stay distinguishable.
 */
export function boardStatusLabel(
  status: TaskStatus,
  columns: readonly { readonly name: string; readonly statuses: readonly TaskStatus[] }[],
): string {
  const owner = columns.find((c) => c.statuses.includes(status));
  if (owner?.statuses.length !== 1) return STATUS_LABELS[status];
  return owner.name;
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
/**
 * Days without a change before open work reads as stale — the design's
 * threshold, **one number** for the Activity rail's Stale panel and the List's
 * amber (LAI-486). They used to be two constants with two comparisons (`>=`
 * against `>`), and so disagreed at exactly five days.
 */
export const STALE_DAYS = 5;

/** Whole days since `at`, floored — the unit `STALE_DAYS` is counted in. */
export function ageDays(at: number, now: number): number {
  return Math.floor((now - at) / 86_400_000);
}

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
/**
 * A card move the server has not answered yet (LAI-473): where the reader
 * dropped it, by the card it went below (`afterId`) or above (`beforeId`).
 */
export interface PendingMove {
  readonly taskId: string;
  readonly afterId?: string | undefined;
  readonly beforeId?: string | undefined;
}

/** Byte-wise, as SQLite's BINARY collation and the server compare keys. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The lane order (LAI-473, D-070): the project's **manual order**, compared
 * byte-wise; a task the server has not placed sorts after every placed one,
 * by number. A move in flight sorts its card **directly beside its anchor** —
 * the same position, nudged a half-step — so the drop shows at once without
 * the client computing a key of its own, and the server's answer replaces it.
 */
function laneOrder(tasks: readonly Task[], pending: PendingMove | undefined) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const anchor = (() => {
    if (pending === undefined) return undefined;
    const after = pending.afterId === undefined ? undefined : byId.get(pending.afterId);
    if (after?.position != null) return { position: after.position, nudge: 1 };
    const before = pending.beforeId === undefined ? undefined : byId.get(pending.beforeId);
    if (before?.position != null) return { position: before.position, nudge: -1 };
    return undefined;
  })();
  const key = (t: Task) =>
    anchor !== undefined && t.id === pending?.taskId ? anchor : { position: t.position, nudge: 0 };

  return (a: Task, b: Task): number => {
    const ka = key(a);
    const kb = key(b);
    if (ka.position === null || kb.position === null) {
      if (ka.position !== kb.position) return ka.position === null ? 1 : -1;
      return a.number - b.number;
    }
    return compareKeys(ka.position, kb.position) || ka.nudge - kb.nudge || a.number - b.number;
  };
}

/**
 * What a drop at `index` asks the server (LAI-473): the card above the gap and
 * the card below it, in a lane whose current order is `ids`, with the dragged
 * card left out — it is not its own neighbour. `undefined` when the drop puts
 * the card back exactly where it was, which is no move at all. An index past
 * either end is clamped.
 */
export function dropNeighbours(
  ids: readonly string[],
  draggedId: string,
  index: number,
): { afterId?: string; beforeId?: string } | undefined {
  const others = ids.filter((id) => id !== draggedId);
  const at = Math.max(0, Math.min(index, others.length));
  if (ids.indexOf(draggedId) === at) return undefined;
  const afterId = others[at - 1];
  const beforeId = others[at];
  return {
    ...(afterId === undefined ? {} : { afterId }),
    ...(beforeId === undefined ? {} : { beforeId }),
  };
}

export function groupByColumn(
  tasks: readonly Task[],
  columns: readonly BoardColumn[],
  pending?: PendingMove,
): Lane[] {
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

  // **The reader's order, not priority's** (LAI-473, D-070). This sorted by
  // priority then number, in the browser, after the fetch — so a stored order
  // would have been ignored and every drop would have snapped back. Priority
  // is shown by its icon now, not by its place.
  const compare = laneOrder(tasks, pending);
  for (const lane of lanes) {
    lane.tasks.sort(compare);
  }

  return lanes;
}
