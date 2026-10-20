import type { ReviewQueueItem } from '../../../api/review.ts';
import type { TaskSummary } from '../../../api/tasks.ts';

/**
 * *On your plate* (LAI-796, the owner's reference): beside the reader's day,
 * the work that is theirs right now — **in progress**, **waiting on their
 * review**, and **blocked** — from what the board already serves: their own
 * open tasks, the review queue, and each blocker's status. Nothing here is
 * computed that the board does not already show somewhere.
 */

export interface PlateItem {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  /** The space it lives in, so it opens there rather than in the last one. */
  readonly slug: string | undefined;
  readonly note?: string;
  readonly tone?: 'ok' | 'bad' | 'wait';
}

export interface Plate {
  readonly inProgress: readonly PlateItem[];
  /** `undefined` until the queue has been read. */
  readonly review: readonly PlateItem[] | undefined;
  readonly blocked: readonly PlateItem[];
}

/** A task of the reader's, with the space it was listed from. */
export interface MineTask {
  readonly task: TaskSummary;
  readonly slug: string;
}

/** What is known of a blocker that is not one of the reader's own tasks. */
export interface Blocker {
  readonly key: string;
  readonly status: string;
}

const finished = (status: string): boolean => status === 'done' || status === 'cancelled';

/** Blockers to look up: those of open tasks that are not the reader's own, once each. */
export function blockerIds(mine: readonly MineTask[]): readonly string[] {
  const own = new Set(mine.map((m) => m.task.id));
  const ids = new Set<string>();
  for (const { task } of mine) {
    if (finished(task.status)) continue;
    for (const id of task.blocked_by) if (!own.has(id)) ids.add(id);
  }
  return [...ids];
}

function ciNote(item: ReviewQueueItem): Pick<PlateItem, 'note' | 'tone'> {
  const ci = item.round?.ci;
  if (ci === null || ci === undefined || ci.total === 0) return {};
  if (ci.failed > 0) return { note: 'CI failed', tone: 'bad' };
  if (ci.pending > 0) return { note: 'CI pending', tone: 'wait' };
  return { note: 'CI passed', tone: 'ok' };
}

export function plateOf(
  mine: readonly MineTask[],
  blockers: ReadonlyMap<string, Blocker>,
  queue: readonly ReviewQueueItem[] | undefined,
): Plate {
  const own = new Map<string, Blocker>(
    mine.map(({ task }) => [task.id, { key: task.key, status: task.status }]),
  );
  const open = mine.filter(({ task }) => !finished(task.status));

  const holding = (task: TaskSummary): readonly (Blocker | undefined)[] =>
    task.blocked_by
      .map((id) => own.get(id) ?? blockers.get(id) ?? (undefined as Blocker | undefined))
      .filter((b) => b === undefined || !finished(b.status));

  const blocked: PlateItem[] = [];
  const inProgress: PlateItem[] = [];
  for (const { task, slug } of [...open].sort((a, b) => b.task.updated_at - a.task.updated_at)) {
    const item = { id: task.id, key: task.key, title: task.title, slug };
    const held = holding(task);
    if (held.length > 0) {
      const named = held.filter((b): b is Blocker => b !== undefined).map((b) => b.key);
      blocked.push({
        ...item,
        note: named.length === 0 ? 'Waiting on another task' : `Waiting on ${named.join(', ')}`,
        tone: 'bad',
      });
    } else if (task.status === 'in_progress') {
      inProgress.push(item);
    }
  }

  const review = queue
    ?.filter((entry) => entry.can_decide)
    .map((entry) => ({
      id: entry.task.id,
      key: entry.task.key,
      title: entry.task.title,
      slug: entry.project.slug,
      ...ciNote(entry),
    }));

  return { inProgress, review, blocked };
}

/**
 * At most this many items a group (LAI-810): a column beside the day, not a
 * second inbox. The owner's live review queue was 200 long, drawn whole.
 */
export const PLATE_CAP = 5;

export type PlateGroup = 'progress' | 'review' | 'blocked';

/** The first `cap` items, and how many more there are. */
export function capped<T>(
  items: readonly T[],
  cap: number = PLATE_CAP,
): { readonly shown: readonly T[]; readonly more: number } {
  return { shown: items.slice(0, cap), more: Math.max(0, items.length - cap) };
}

/**
 * Where *+N more* leads: the review tab of the Inbox for what waits on the
 * reader, and otherwise the List of the space the first hidden item is in,
 * filtered to the reader — in progress, or all their open work for what is
 * blocked (no URL filter says *blocked*; `?ready=false` means something
 * else, SPEC §4.5).
 */
export function moreHref(
  group: PlateGroup,
  hidden: readonly PlateItem[],
  meId: string | undefined,
): string {
  if (group === 'review') return '/inbox?tab=review';
  const params = new URLSearchParams();
  const slug = hidden[0]?.slug;
  if (slug !== undefined) params.set('project', slug);
  if (meId !== undefined) params.set('assignee', meId);
  if (group === 'progress') params.set('status', 'in_progress');
  const query = params.toString();
  return query === '' ? '/list' : `/list?${query}`;
}
