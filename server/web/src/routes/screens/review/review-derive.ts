import {
  filterQueue,
  type QueueFilter,
  type ReviewQueueItem,
  type ReviewProject,
} from '../../../api/review.ts';
import type { BulkOutcome } from '../list/list-bulk.ts';

/**
 * The Review tab as a decision queue (D-146, LAI-1168).
 *
 * **A derive module, not a renderer** (CONVENTIONS §4): which rows the page
 * shows, how they group and what a bulk Accept reports are decided here,
 * where each rule can be pinned without a browser. `ReviewScreen` places them.
 *
 * `GET /review` is the organisation's pile — every review task on the spaces
 * the reader holds `task.write` on, oldest first, at most 200 — and the
 * server marks each row `can_decide`. The page opens on the rows that wait
 * on *this* reader; everything else is one toggle away, read-only.
 */

/** What the page lists: the decision queue, the whole queue, or — LAI-1169 — the hand-offs. */
export type ReviewView = 'mine' | 'all' | 'handoffs';

/** The default view is not in the address; `?view=all` and `?view=handoffs` are. */
export function reviewView(params: URLSearchParams): ReviewView {
  const asked = params.get('view');
  return asked === 'all' || asked === 'handoffs' ? asked : 'mine';
}

/** The address for a view: `mine` leaves `view` out, the others set it. */
export function withView(params: URLSearchParams, view: ReviewView): URLSearchParams {
  const next = new URLSearchParams(params);
  if (view === 'mine') next.delete('view');
  else next.set('view', view);
  return next;
}

export interface VisibleOptions {
  /** Only the rows the reader may decide (`can_decide`). */
  readonly decidable: boolean;
  readonly filter: QueueFilter;
}

/**
 * The rows the page shows: the filters first, then — on the decision view —
 * only what the reader may decide. The server's order (oldest waiting first)
 * is kept; nothing here sorts.
 */
export function visibleQueue(
  items: readonly ReviewQueueItem[],
  { decidable, filter }: VisibleOptions,
): ReviewQueueItem[] {
  const filtered = filterQueue(items, filter);
  return decidable ? filtered.filter((item) => item.can_decide) : filtered;
}

export interface SpaceGroup {
  readonly project: ReviewProject;
  /** The group's rows, in the order the queue had them. */
  readonly items: readonly ReviewQueueItem[];
  /** The ids a group's select-all reaches: the rows the reader may decide. */
  readonly decidable: readonly string[];
}

/**
 * Rows by space, **in order of first appearance**: the queue is oldest-first,
 * so the space with the longest-waiting task heads the page, and within a
 * group the rows keep that order. No alphabetical sort — the point of the
 * page is what has waited longest.
 */
export function groupBySpace(items: readonly ReviewQueueItem[]): SpaceGroup[] {
  const groups = new Map<string, { project: ReviewProject; items: ReviewQueueItem[] }>();
  for (const item of items) {
    const group = groups.get(item.project.id);
    if (group === undefined) groups.set(item.project.id, { project: item.project, items: [item] });
    else group.items.push(item);
  }
  return [...groups.values()].map((group) => ({
    project: group.project,
    items: group.items,
    decidable: group.items.filter((item) => item.can_decide).map((item) => item.task.id),
  }));
}

/** Every row's task id, groups flattened, in the order the page draws them. */
export function flatOrder(groups: readonly SpaceGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.task.id));
}

/**
 * `3 accepted`, `2 accepted, 1 refused`, `0 accepted, 2 refused`. Unlike the
 * List's `bulkSummary` there is no "already there": a row in the queue is by
 * definition still waiting, so every selected id is sent.
 */
export function acceptSummary(outcome: BulkOutcome): string {
  const parts = [`${String(outcome.done.length)} accepted`];
  if (outcome.failed.length > 0) parts.push(`${String(outcome.failed.length)} refused`);
  return parts.join(', ');
}

/* ------------------------------------------------------- the dialog (LAI-1169) */

/** The open item: `?item=<taskId>`, or none. */
export function itemParam(params: URLSearchParams): string | null {
  const asked = params.get('item');
  return asked === null || asked === '' ? null : asked;
}

/** The address with `item` set, or without it. Other params survive. */
export function withItem(params: URLSearchParams, id: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (id === null) next.delete('item');
  else next.set('item', id);
  return next;
}

export interface ItemPosition {
  /** Zero-based, as the page draws the rows. */
  readonly index: number;
  readonly total: number;
  readonly prev: string | null;
  readonly next: string | null;
}

/** Where `id` sits in the drawn order, with its neighbours; `null` when it is not drawn. */
export function positionOf(order: readonly string[], id: string): ItemPosition | null {
  const index = order.indexOf(id);
  if (index === -1) return null;
  return {
    index,
    total: order.length,
    prev: index === 0 ? null : (order[index - 1] ?? null),
    next: index === order.length - 1 ? null : (order[index + 1] ?? null),
  };
}

/**
 * Where the dialog goes once `id` is decided: the next row after it in the
 * order **captured before the decision**, or `null` at the end — close. A row
 * no longer `present` (a poll took it meanwhile) is skipped, never shown as
 * vanished the moment it opens.
 */
export function advanceAfterDecide(
  order: readonly string[],
  id: string,
  present?: ReadonlySet<string>,
): string | null {
  const at = order.indexOf(id);
  if (at === -1) return null;
  for (const candidate of order.slice(at + 1)) {
    if (candidate !== id && (present === undefined || present.has(candidate))) return candidate;
  }
  return null;
}

export type DialogCommand = 'next' | 'prev' | 'accept' | 'send_back' | 'close';

/** What of a key event the dialog reads — a real one, or a test's. */
export interface DialogKey {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly defaultPrevented?: boolean;
}

/**
 * The dialog's keys: `j` / `↓` next, `k` / `↑` previous, `a` accept, `s`
 * send back, Escape close. **Nothing while typing** — a reason being written
 * says "as" — except Escape, which is the one key a field expects to give up;
 * and nothing with a modifier held, so ⌘A still selects text. Escape a control
 * inside has already spent (`defaultPrevented`) is left to it.
 */
export function dialogCommand(event: DialogKey, typing: boolean): DialogCommand | null {
  if (event.key === 'Escape') return event.defaultPrevented === true ? null : 'close';
  if (typing) return null;
  if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) return null;
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      return 'next';
    case 'k':
    case 'ArrowUp':
      return 'prev';
    case 'a':
      return 'accept';
    case 's':
      return 'send_back';
    default:
      return null;
  }
}
