/**
 * The activity types the server names its SSE frames with (§4.8).
 *
 * `EventSource` only fires `onmessage` for **unnamed** frames, and the server
 * names every activity frame with its type — so a client that forgets to
 * subscribe by name silently receives nothing at all while looking connected.
 * Kept in step with `server/src/db/enums.ts`; `use-events.test.ts` asserts it —
 * **in order**, not just membership, because the two lists are one vocabulary
 * and a client subscribing to the right names in the wrong order is not a
 * failure anyone would notice from the outside.
 */
export const STREAM_TYPES: readonly string[] = [
  'org.created',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.dependency_added',
  'task.dependency_removed',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'project.created',
  'project.updated',
  'project.archived',
  'member.added',
  'member.role_changed',
  'member.removed',
  'token.created',
  'token.revoked',
  'heartbeat.session',
  'webhook.commit',
  'webhook.received',
  'meeting.applied',
  'unlisted.logged',
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'sprint.tasks_changed',
  'project.context_updated',
  'unlisted.promoted',
  'unlisted.dismissed',
  'user.deactivated',
  'user.reactivated',
];
