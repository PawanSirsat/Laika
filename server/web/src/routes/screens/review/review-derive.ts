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

/** What the page lists. `handoffs` is reserved for LAI-1169's fold. */
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
