import { request } from './client.ts';
import type { Page } from './tasks.ts';

/**
 * The activity feed (SPEC §4.8, LAI-055).
 *
 * Returned **newest-first** — the opposite of comments. A feed is scanned from
 * the top; a conversation is read forward. Do not "fix" one to match the other.
 */

export interface ActivityEvent {
  readonly id: string;
  /** Monotonic, and the cursor tiebreaker — several rows share a millisecond. */
  readonly seq: number;
  readonly type: string;
  readonly project_id: string;
  readonly task_id: string | null;
  readonly actor_id: string | null;
  /**
   * Who acted. Mirrors `ACTOR_KINDS` in `server/src/db/enums.ts`, which a CHECK
   * constraint enforces — `system` is the cron and the migration runner, added
   * by 0003. This is the badge LAI-049 wanted and could not have.
   */
  readonly actor_kind: 'user' | 'agent' | 'system';
  readonly actor_token_id: string | null;
  readonly payload: unknown;
  readonly created_at: number;
}

export function listTaskActivity(
  slug: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<Page<ActivityEvent>> {
  const params = new URLSearchParams({ task_id: taskId, limit: '50' });
  return request<Page<ActivityEvent>>(
    `/projects/${encodeURIComponent(slug)}/activity?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * The project's recent activity, newest first.
 *
 * The panel is **seeded from here and then extended by the stream**. Without
 * this it would open empty on every load and only fill as things happened —
 * which reads as "nothing has ever happened" rather than "you just got here".
 */
export function listProjectActivity(
  slug: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Page<ActivityEvent>> {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<Page<ActivityEvent>>(
    `/projects/${encodeURIComponent(slug)}/activity?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * Human wording for an event type.
 *
 * A map rather than a formatter so an unknown type degrades to something
 * readable instead of throwing or rendering `task.status_changed` raw. New
 * server-side types will appear here as themselves until someone adds a line,
 * which is the right failure: legible, and obviously incomplete.
 */
const LABELS: Readonly<Record<string, string>> = {
  'task.created': 'created this task',
  'task.updated': 'edited this task',
  'task.status_changed': 'moved this task',
  'task.claimed': 'claimed this task',
  'task.assigned': 'reassigned this task',
  'task.dependency_added': 'added a dependency',
  'task.dependency_removed': 'removed a dependency',
  'comment.added': 'commented',
  'comment.updated': 'edited a comment',
  'comment.deleted': 'deleted a comment',
};

export function describeEvent(event: ActivityEvent): string {
  return LABELS[event.type] ?? event.type;
}

/** `{from, to}` on a status change, when the payload carries it. */
export function statusTransition(event: ActivityEvent): { from: string; to: string } | undefined {
  if (event.type !== 'task.status_changed') return undefined;

  const payload = event.payload as { from?: unknown; to?: unknown } | null;
  if (typeof payload?.from !== 'string' || typeof payload.to !== 'string') return undefined;

  return { from: payload.from, to: payload.to };
}
