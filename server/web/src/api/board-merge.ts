import type { Task } from './tasks.ts';

/**
 * Fold a fresh read of the board into what is on screen (LAI-707).
 *
 * A refresh used to replace every task with a freshly parsed object, so React
 * could not tell an unchanged card from a changed one, and the board was
 * rebuilt wholesale on every live frame. This keeps the **old object** for
 * every task whose content did not change — and returns the old array itself
 * when nothing did — so an echo of your own move, or a frame about a comment,
 * costs nothing on screen.
 *
 * **Never by `updated_at`.** `ready`, `blocked_by`, `blocks`, `comment_count`
 * and `stale_flagged_at` change without it: a task becomes ready when *another*
 * task's blocker finishes. A full structural compare is the only rule that
 * cannot miss a field added later — the hand-listed version is how `sprint`
 * went missing in LAI-069.
 */

/** Deep equality for JSON values; key order and `undefined` members are ignored. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

export interface MergedTasks {
  /** The server's order; unchanged tasks are the old objects. */
  readonly tasks: readonly Task[];
  /** Ids that are new or whose content changed. */
  readonly changed: ReadonlySet<string>;
  /** Ids on screen that the server no longer lists (and that are not kept). */
  readonly removed: ReadonlySet<string>;
}

/**
 * @param keep ids whose local version wins — a write in flight, or one made
 *   after this read began. The server's answer about them is older than what
 *   the screen already shows, and drawing it would snap the card back.
 */
export function mergeTasks(
  prev: readonly Task[],
  incoming: readonly Task[],
  keep: ReadonlySet<string>,
): MergedTasks {
  const before = new Map(prev.map((t) => [t.id, t]));
  const changed = new Set<string>();
  const seen = new Set<string>();

  const tasks: Task[] = incoming.map((fresh) => {
    seen.add(fresh.id);
    const old = before.get(fresh.id);
    if (old !== undefined && keep.has(fresh.id)) return old;
    if (old !== undefined && sameValue(old, fresh)) return old;
    changed.add(fresh.id);
    return fresh;
  });

  // A kept task the server did not list is still kept until its write settles.
  for (const old of prev) {
    if (!seen.has(old.id) && keep.has(old.id)) tasks.push(old);
  }

  const removed = new Set(prev.filter((t) => !seen.has(t.id) && !keep.has(t.id)).map((t) => t.id));

  const identical =
    changed.size === 0 &&
    removed.size === 0 &&
    tasks.length === prev.length &&
    tasks.every((t, i) => t === prev[i]);

  return { tasks: identical ? prev : tasks, changed, removed };
}
