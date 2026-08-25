/**
 * The activity types the server names its SSE frames with (§4.8).
 *
 * `EventSource` only fires `onmessage` for **unnamed** frames, and the server
 * names every activity frame with its type — so a client that forgets to
 * subscribe by name silently receives nothing at all while looking connected.
 * Kept in step with `server/src/db/enums.ts`; `use-events.test.ts` asserts it.
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
];
