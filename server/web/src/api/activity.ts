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
 * Human wording for every event type the server can emit (LAI-225).
 *
 * **All of them, named.** The map covered ten of the thirty-seven in
 * `ACTIVITY_TYPES`, so a sprint change read as `sprint.tasks_changed` on the
 * board's rail and in the task drawer — a database value shown to a person.
 * Two of those ten (`task.claimed`, `comment.updated`) were never in the enum
 * at all: wording for events that cannot happen, which is how a map with no
 * guard rots in both directions at once.
 *
 * `activity-labels.test.ts` asserts **names from both sides** against the
 * server's own enum: every type has a line here, and every line here names a
 * real type. Never a count — a count is what let two phantom entries sit beside
 * twenty-seven missing ones and still look plausible.
 *
 * Each line completes *"<who> …"*, so it is a verb phrase and never a noun.
 */
const LABELS: Readonly<Record<string, string>> = {
  'org.created': 'created this organisation',

  'task.created': 'created this task',
  'task.updated': 'edited this task',
  'task.status_changed': 'moved this task',
  'task.assigned': 'reassigned this task',
  'task.dependency_added': 'added a dependency',
  'task.dependency_removed': 'removed a dependency',
  'task.stale_flagged': 'flagged this task as stale',

  'comment.added': 'commented',
  'comment.edited': 'edited a comment',
  'comment.deleted': 'deleted a comment',

  'project.created': 'created this space',
  'project.updated': 'changed space settings',
  'project.archived': 'archived this space',
  'project.context_updated': 'updated the space context',

  'member.added': 'added a member',
  'member.role_changed': 'changed a member’s role',
  'member.removed': 'removed a member',

  'token.created': 'created an agent token',
  'token.revoked': 'revoked an agent token',

  'sprint.created': 'created a sprint',
  'sprint.updated': 'edited a sprint',
  'sprint.deleted': 'deleted a sprint',
  'sprint.tasks_changed': 'changed which tasks are in a sprint',

  'heartbeat.session': 'started a session',
  'heartbeat.pruned': 'expired old sessions',

  'webhook.commit': 'pushed a commit',
  'webhook.received': 'received a webhook',

  'meeting.applied': 'applied a meeting review',
  'meeting_review.discarded': 'discarded a meeting review',
  'meeting_review.expired': 'let a meeting review expire',

  'unlisted.logged': 'logged unlisted work',
  'unlisted.promoted': 'promoted unlisted work to a task',
  'unlisted.dismissed': 'dismissed unlisted work',

  'user.deactivated': 'deactivated a user',
  'user.reactivated': 'reactivated a user',

  'invite.expired': 'let an invite expire',
};

/**
 * The map, for the guard that checks it covers the server's vocabulary.
 *
 * Exported rather than re-derived in the test: a test that rebuilt this list
 * would be checking its own copy.
 */
export const ACTIVITY_LABELS = LABELS;

export function describeEvent(event: ActivityEvent): string {
  /*
   * The fallback stays. A type added on the server before a line is added here
   * still renders — as itself, which is legible and obviously incomplete — and
   * the guard is what makes sure that state does not survive a gate.
   */
  return LABELS[event.type] ?? event.type;
}

/** `{from, to}` on a status change, when the payload carries it. */
export function statusTransition(event: ActivityEvent): { from: string; to: string } | undefined {
  if (event.type !== 'task.status_changed') return undefined;

  const payload = event.payload as { from?: unknown; to?: unknown } | null;
  if (typeof payload?.from !== 'string' || typeof payload.to !== 'string') return undefined;

  return { from: payload.from, to: payload.to };
}
