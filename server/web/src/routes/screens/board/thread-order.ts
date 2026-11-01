import type { ActivityEvent } from '../../../api/activity.ts';
import type { Comment } from '../../../api/comments.ts';

/** One row of the task panel's **All** tab — a comment or an activity event. */
export type ThreadItem =
  | { readonly kind: 'comment'; readonly at: number; readonly comment: Comment }
  | { readonly kind: 'event'; readonly at: number; readonly event: ActivityEvent };

/**
 * The **All** tab's order: oldest first, a comment before an event on a tie,
 * and two events in one millisecond by `seq` — the server's write order.
 *
 * The `seq` step is LAI-575. The feed arrives **newest first** (`created_at
 * DESC, seq DESC`), and a stable sort keeps input order on a tie, so without it
 * a claim's `task.status_changed` and `task.updated` show reversed inside an
 * otherwise oldest-first thread.
 */
export function threadOrder(a: ThreadItem, b: ThreadItem): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.kind === 'event' && b.kind === 'event') return a.event.seq - b.event.seq;
  if (a.kind === b.kind) return 0;
  return a.kind === 'comment' ? -1 : 1;
}
