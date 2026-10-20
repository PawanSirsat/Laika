import { CATEGORY_COPY, type ProjectStatus } from './statuses.ts';
import type { TaskSummary } from './tasks.ts';

/**
 * Board facts about a project's statuses (LAI-739). Pure, so every rule here
 * has a unit test with a fixture that can break it.
 *
 * **One column is one status**, so most of what LAI-266's multi-status columns
 * needed — a primary status, "a column holding nothing", a status claimed by
 * two columns — has no equivalent. What is left is ordering, hiding, and the
 * one rule the server enforces that the screen should say first: every kind of
 * work keeps at least one column.
 */

function byPosition(statuses: readonly ProjectStatus[]): ProjectStatus[] {
  return [...statuses].sort((a, b) => a.position - b.position);
}

/**
 * The columns the board draws: every status not hidden, by position.
 *
 * **An empty column is drawn.** LAI-617 stopped drawing columns that owned no
 * statuses, which then also hid the columns people had made on purpose and
 * not filled yet. A status is never "empty of statuses", so nothing here hides
 * a column except the reader.
 */
export function visibleColumns(statuses: readonly ProjectStatus[]): ProjectStatus[] {
  return byPosition(statuses).filter((s) => !s.hidden);
}

/** The columns somebody hid, for *Hidden columns (N)*. */
export function hiddenColumns(statuses: readonly ProjectStatus[]): ProjectStatus[] {
  return byPosition(statuses).filter((s) => s.hidden);
}

/**
 * The status a card is filed under on this board: its own, or — when the
 * project does not hold that status yet (made a moment ago elsewhere, before
 * the frame arrived) — the first visible column of the same kind. The board
 * draws the card only if the answer is a visible column, which is how a card
 * in a hidden column is drawn nowhere.
 */
export function laneStatusId(
  task: TaskSummary,
  statuses: readonly ProjectStatus[],
): string | undefined {
  if (statuses.some((s) => s.id === task.status_id)) return task.status_id;
  const sameKind = byPosition(statuses).filter((s) => s.category === task.status);
  return (sameKind.find((s) => !s.hidden) ?? sameKind[0])?.id;
}

/**
 * Why this column cannot be deleted, or `undefined` if it can.
 *
 * The server refuses the last status of a category; saying so **before** the
 * reader picks a destination and presses Delete is the difference between a
 * disabled button with a reason and an error after the fact.
 */
export function deleteBlockedReason(
  status: ProjectStatus,
  statuses: readonly ProjectStatus[],
): string | undefined {
  const siblings = statuses.filter((s) => s.category === status.category);
  if (siblings.length > 1) return undefined;
  const kind = CATEGORY_COPY[status.category].label;
  return `${status.name} is the only ${kind} column. Add another ${kind} column first, then delete this one.`;
}

/** Where a deleted column's tasks go unless the reader picks otherwise. */
export function defaultMoveTarget(
  status: ProjectStatus,
  statuses: readonly ProjectStatus[],
): ProjectStatus | undefined {
  const others = byPosition(statuses).filter((s) => s.id !== status.id);
  return others.find((s) => s.category === status.category) ?? others[0];
}

/**
 * The whole order to send, from the order of the **visible** columns.
 *
 * `PUT /statuses/order` wants every id once; the board can only drag what it
 * draws. Hidden columns keep the slots they hold, and the visible ones fill
 * the rest in the new order — so hiding a column, reordering, and showing it
 * again puts it back where it was.
 */
export function fullOrder(
  statuses: readonly ProjectStatus[],
  visibleIds: readonly string[],
): string[] {
  const shown = new Set(statuses.filter((s) => !s.hidden).map((s) => s.id));
  const queue = visibleIds.filter((id) => shown.has(id));
  const out: string[] = [];
  for (const status of byPosition(statuses)) {
    const next = status.hidden ? status.id : queue.shift();
    if (next !== undefined) out.push(next);
  }
  // A visible column the order did not name (a race with another tab) keeps
  // its place at the end rather than being dropped from the request.
  for (const status of byPosition(statuses)) if (!out.includes(status.id)) out.push(status.id);
  return out;
}

/** Positions as the order says. */
export function applyOrder(
  statuses: readonly ProjectStatus[],
  ids: readonly string[],
): ProjectStatus[] {
  const at = new Map(ids.map((id, index) => [id, index]));
  return statuses.map((s) => ({ ...s, position: at.get(s.id) ?? s.position }));
}

/** `New column`, or `New column 2`… — whichever nobody has, ignoring case. */
export function nextColumnName(statuses: readonly ProjectStatus[]): string {
  const taken = new Set(statuses.map((s) => s.name.trim().toLowerCase()));
  if (!taken.has('new column')) return 'New column';
  let n = 2;
  while (taken.has(`new column ${String(n)}`)) n += 1;
  return `New column ${String(n)}`;
}

/** A card as it will be once moved into `status` — id, name and kind together. */
export function withStatus(task: TaskSummary, status: ProjectStatus): TaskSummary {
  return { ...task, status: status.category, status_id: status.id, status_name: status.name };
}

/**
 * What a task's status is called **now**: the project's current name for it
 * when the board holds it — so a rename reads at once on every card — and the
 * name the server sent with the task otherwise.
 */
export function statusNameOf(
  task: Pick<TaskSummary, 'status_id' | 'status_name'>,
  byId: ReadonlyMap<string, ProjectStatus>,
): string {
  return byId.get(task.status_id)?.name ?? task.status_name;
}
