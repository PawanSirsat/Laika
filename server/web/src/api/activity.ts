import { STATUS_LABELS } from './board-derive.ts';
import { withPage, type PageQuery } from './every-page.ts';
import { API_BASE, request } from './client.ts';
import { projectRoleLabel } from './members.ts';
import { describeAgentSelected, type AgentNaming } from './selected-agent.ts';
import type { Page } from './tasks.ts';

const NO_AGENTS: ReadonlyMap<string, AgentNaming> = new Map();

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
  /** `null` on an organisation row — `token.created`, `member.role_changed` (§4.8). */
  readonly project_id: string | null;
  readonly task_id: string | null;
  readonly actor_id: string | null;
  /**
   * Who acted. Mirrors `ACTOR_KINDS` in `server/src/db/enums.ts`, which a CHECK
   * constraint enforces — `system` is the cron and the migration runner, added
   * by 0003. This is the badge LAI-049 wanted and could not have.
   */
  readonly actor_kind: 'user' | 'agent' | 'system';
  readonly actor_token_id: string | null;
  /**
   * The registered agent that wrote the row (D-114 item 4, LAI-535), read from
   * the token at write time. Null for a person, Laika, a **legacy** token and
   * every row older than the column — never back-filled. Optional because a
   * row served before LAI-535 has none (`agentVia` reads both as null).
   */
  readonly agent_id?: string | null;
  /**
   * The agent session the row was written under, and what it said ran **then**
   * (D-118, LAI-586) — self-reported, a snapshot a later heartbeat does not
   * change. Null for a row no agent session wrote and every row older than the
   * columns, never back-filled; optional because a row served before LAI-586
   * has no key at all. Read through `agentLine` (`agent-session.ts`).
   */
  readonly agent_session?: ActivitySession | null;
  /**
   * The server withheld an agent this reader may not see (D-121 item 7,
   * LAI-1011): the row's agent, an agent id in the payload, or an agent
   * token's name. A null `agent_id` with this set is *an agent*, never a
   * legacy token; a null `to` is not a withdrawal. Optional because a row
   * served before LAI-1011 has no key.
   */
  readonly agent_redacted?: boolean;
  readonly payload: unknown;
  readonly created_at: number;
}

/** `ActivitySessionView` in `server/src/services/events.ts`. Self-reported; decides nothing. */
export interface ActivitySession {
  readonly id: string;
  /** The underlying harness's slug, as the session sent it: `codex`, `claude-code`. */
  readonly harness: string | null;
  readonly harness_version: string | null;
  /** `gpt-5.5`, `claude-opus-5-5`. */
  readonly model: string | null;
}

export function listTaskActivity(
  slug: string,
  taskId: string,
  signal?: AbortSignal,
  page: PageQuery = {},
): Promise<Page<ActivityEvent>> {
  const params = withPage(new URLSearchParams({ task_id: taskId, limit: '50' }), page);
  return request<Page<ActivityEvent>>(
    `/projects/${encodeURIComponent(slug)}/activity?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * One page of the project feed, newest first, at most 200 (§6.3) — from
 * `since` (inclusive) and before `cursor` when given. The Dashboard's window
 * (`activity-store.ts`) walks it; a `Page` function so the LAI-703 census in
 * `one-page-reads.test.ts` can see every caller (LAI-724 review).
 */
export function listProjectActivityPage(
  slug: string,
  query: { readonly since?: number | undefined; readonly cursor?: string | undefined },
  signal?: AbortSignal,
): Promise<Page<ActivityEvent>> {
  const params = new URLSearchParams({ limit: '200' });
  if (query.since !== undefined) params.set('since', String(query.since));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
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

/** `GET /activity/history`'s filters (LAI-886), each optional, all combinable. */
export interface HistoryQuery {
  /** A user id. */
  readonly actor?: string;
  /** A space's slug. */
  readonly project?: string;
  /** One §4.8 verb. */
  readonly type?: string;
  /** Unix-ms, inclusive. */
  readonly since?: number;
  /** Unix-ms, inclusive. */
  readonly until?: number;
}

/**
 * One page of the organisation's whole history, newest first — owner and admin
 * only (`audit_log.export`). Organisation → Activity walks it a page at a time,
 * on *Load more* (LAI-951).
 */
export function listOrgHistory(
  query: HistoryQuery,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<Page<ActivityEvent>> {
  const params = new URLSearchParams({ limit: '50' });
  if (query.actor !== undefined) params.set('actor', query.actor);
  if (query.project !== undefined) params.set('project', query.project);
  if (query.type !== undefined) params.set('type', query.type);
  if (query.since !== undefined) params.set('since', String(query.since));
  if (query.until !== undefined) params.set('until', String(query.until));
  if (cursor !== undefined) params.set('cursor', cursor);
  return request<Page<ActivityEvent>>(
    `/activity/history?${params.toString()}`,
    signal === undefined ? {} : { signal },
  );
}

/**
 * The organisation's history as a CSV file, with the filters on screen
 * (LAI-989; the server's half is LAI-984). An address, not a `request()`: the
 * browser downloads it with the session cookie, and the server streams every
 * matching row. Never `limit` or `cursor` — the server refuses both beside
 * `format=csv`, since the file is every row.
 */
export function historyCsvHref(query: HistoryQuery): string {
  const params = new URLSearchParams({ format: 'csv' });
  if (query.actor !== undefined) params.set('actor', query.actor);
  if (query.project !== undefined) params.set('project', query.project);
  if (query.type !== undefined) params.set('type', query.type);
  if (query.since !== undefined) params.set('since', String(query.since));
  if (query.until !== undefined) params.set('until', String(query.until));
  return `${API_BASE}/activity/history?${params.toString()}`;
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
  // A work request, not a claim (LAI-535): `describeEvent` names the agent
  // when the reader can; this is the line when it cannot.
  'task.agent_selected': 'changed the agent for this task',
  // An agent session's claim lost its lease (LAI-541). Written by the system:
  // nobody did it, and nothing gives the claim back by itself (proposal §4.2).
  'task.claim_expired':
    'expired an agent’s claim — the agent must reclaim explicitly; nothing was restored automatically',
  // The same agent took the task back on purpose, at the next generation.
  'task.claim_reclaimed': 'reclaimed this task after its claim expired',
  // A save registered on purpose (LAI-545). Registered, not proved: GitHub's
  // push notice verifies it later, and that writes no row.
  'task.checkpoint_saved': 'saved a checkpoint',
  // The hand-off's seven verbs (LAI-546, LAI-549). An offer is not a move:
  // only the receiver's accept moves the claim, and the words never say
  // "handed over" for an offer.
  'task.handoff_offered': 'offered this task to another agent',
  'task.handoff_approved': 'approved a hand-off',
  'task.handoff_accepted': 'accepted a hand-off of this task',
  'task.handoff_declined': 'declined a hand-off of this task',
  'task.handoff_cancelled': 'withdrew a hand-off of this task',
  'task.handoff_expired': 'expired a hand-off nobody accepted',
  // Written by the system when a claim expired with a verified save: an
  // offer, never an assignment (§4.73).
  'task.recovered': 'offered this task for recovery from its last verified save',

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
  'user.signed_out': 'signed a user out everywhere',
  'org.ownership_transferred': 'transferred ownership of the organisation',

  'invite.expired': 'let an invite expire',
};

/**
 * The map, for the guard that checks it covers the server's vocabulary.
 *
 * Exported rather than re-derived in the test: a test that rebuilt this list
 * would be checking its own copy.
 */
export const ACTIVITY_LABELS = LABELS;

/**
 * The owner changing who can do what (LAI-958) writes `member.role_changed`
 * with `scope: "org_permissions"` rather than a new verb, so the row is told
 * apart by its payload. Without this it would read as *changed a member's
 * role* when no member's role changed.
 */
export function isGrantsChange(event: Pick<ActivityEvent, 'type' | 'payload'>): boolean {
  if (event.type !== 'member.role_changed') return false;
  const payload = event.payload as { scope?: unknown } | null;
  return payload?.scope === 'org_permissions';
}

/** An organisation role as the organisation screens name it: `admin` is *Admin*. */
function orgRoleName(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * A membership row that says who and which roles (LAI-989): *added Mia as
 * Member*, *changed Adam's role: Space admin → Member*. The payloads carry
 * `user_name` and the roles since LAI-993. A row without a name — written
 * before then — answers `undefined`, and keeps the generic line rather than
 * reading *added undefined*.
 *
 * A row with `scope: "org"` or an `org_role` is an organisation role; the rest
 * are a space's, where `lead` is *Space admin* (D-103 item 2). `via` tells a
 * person acting on themselves — joining, accepting an invite, leaving — from
 * someone acting on them.
 */
function describeMembership(event: Pick<ActivityEvent, 'type' | 'payload'>): string | undefined {
  const payload = event.payload as
    | {
        user_name?: unknown;
        role?: unknown;
        org_role?: unknown;
        from?: unknown;
        to?: unknown;
        via?: unknown;
        scope?: unknown;
      }
    | null
    | undefined;
  // Absent as well as null: a row built without a payload has none at all.
  if (payload === null || payload === undefined) return undefined;
  if (typeof payload.user_name !== 'string' || payload.user_name === '') return undefined;
  const who = payload.user_name;
  const org = payload.scope === 'org';
  const name = (role: unknown): string | undefined =>
    typeof role !== 'string' ? undefined : org ? orgRoleName(role) : projectRoleLabel(role);

  if (event.type === 'member.role_changed') {
    const from = name(payload.from);
    const to = name(payload.to);
    return from === undefined || to === undefined
      ? undefined
      : `changed ${who}’s role: ${from} → ${to}`;
  }

  if (event.type === 'member.added') {
    if (typeof payload.org_role === 'string') {
      return `joined the organisation as ${orgRoleName(payload.org_role)}`;
    }
    const role = name(payload.role);
    if (role === undefined) return undefined;
    return payload.via === 'join' || payload.via === 'invite'
      ? `joined as ${role}`
      : `added ${who} as ${role}`;
  }

  if (event.type === 'member.removed') {
    const role = name(payload.role);
    if (role === undefined) return undefined;
    if (payload.via === 'leave') return `left the space as ${role}`;
    if (payload.via === 'deactivation') return `removed ${who} (${role}) on deactivation`;
    return `removed ${who} (${role})`;
  }

  return undefined;
}

export function describeEvent(
  event: ActivityEvent,
  agents: ReadonlyMap<string, AgentNaming> | undefined = NO_AGENTS,
): string {
  if (isGrantsChange(event)) return 'changed who can do what';
  // The agent by name where this reader can name it (LAI-538).
  if (event.type === 'task.agent_selected') {
    const line = describeAgentSelected(event.payload, agents, event.agent_redacted === true);
    if (line !== undefined) return line;
  }
  const membership = describeMembership(event);
  if (membership !== undefined) return membership;
  // A reorder is `task.updated` too, and *edited this task* says something
  // changed that did not. Feeds drop it (`shownInFeed`); the organisation's
  // full history (LAI-951) shows every row, so it reads as what it was.
  if (isReorder(event)) return 'reordered this task';
  /*
   * The fallback stays. A type added on the server before a line is added here
   * still renders — as itself, which is legible and obviously incomplete — and
   * the guard is what makes sure that state does not survive a gate.
   */
  return LABELS[event.type] ?? event.type;
}

/**
 * A push as the task panel's *Changes* tab prints it (LAI-753): *3 commits to
 * lai-12-work · 1a2b3c4, 5d6e7f8 …*, from the `webhook.commit` payload §10.1
 * now stores. Undefined for anything else, and for an older row that carries
 * only repo and branch — that one reads as *pushed a commit*, as it did.
 */
export function pushSummary(event: Pick<ActivityEvent, 'type' | 'payload'>): string | undefined {
  if (event.type !== 'webhook.commit') return undefined;
  const payload = event.payload as {
    branch?: unknown;
    count?: unknown;
    shas?: unknown;
    default_branch?: unknown;
  } | null;
  if (typeof payload?.count !== 'number' || typeof payload.branch !== 'string') return undefined;
  const shas = Array.isArray(payload.shas)
    ? payload.shas.filter((sha): sha is string => typeof sha === 'string')
    : [];
  const what = `${String(payload.count)} ${payload.count === 1 ? 'commit' : 'commits'} to ${
    payload.branch
  }${payload.default_branch === true ? ' (default branch)' : ''}`;
  if (shas.length === 0) return what;
  const listed = shas.slice(0, 3).map((sha) => sha.slice(0, 7));
  return `${what} · ${listed.join(', ')}${shas.length > 3 ? ' …' : ''}`;
}

/** `{from, to}` on a status change, when the payload carries it. */
export function statusTransition(event: ActivityEvent): { from: string; to: string } | undefined {
  if (event.type !== 'task.status_changed') return undefined;

  const payload = event.payload as { from?: unknown; to?: unknown } | null;
  if (typeof payload?.from !== 'string' || typeof payload.to !== 'string') return undefined;

  return { from: payload.from, to: payload.to };
}

/**
 * A status change as a feed prints it (LAI-739): the **names** of the
 * statuses, from the payload when the server put them there, and the kinds in
 * words for an older event that carries only categories. Two columns of one
 * kind — *QA* and *Code review* — are the same category, so without the names
 * a move between them reads as `review → review`.
 */
export function statusMoveNames(event: ActivityEvent): { from: string; to: string } | undefined {
  const move = statusTransition(event);
  if (move === undefined) return undefined;
  const payload = event.payload as { from_status_name?: unknown; to_status_name?: unknown };
  const name = (given: unknown, category: string): string =>
    typeof given === 'string' && given !== ''
      ? given
      : ((STATUS_LABELS as Readonly<Record<string, string>>)[category] ?? category);
  return {
    from: name(payload.from_status_name, move.from),
    to: name(payload.to_status_name, move.to),
  };
}

/**
 * A card reorder (LAI-473, D-060.4): `task.updated` naming `position`.
 *
 * **Written and streamed, never shown.** The server records every drag — the
 * audit trail keeps it, and the SSE frame is what tells a second viewer's
 * board to redraw — but a feed reading *"edited this task"* forty times for
 * one afternoon of tidying a backlog says nothing anyone needs.
 */
export function isReorder(event: Pick<ActivityEvent, 'type' | 'payload'>): boolean {
  if (event.type !== 'task.updated') return false;
  const payload = event.payload as { field?: unknown } | null;
  return payload?.field === 'position';
}

/** The events a person reads — every feed filters through this one rule. */
export function shownInFeed<T extends Pick<ActivityEvent, 'type' | 'payload'>>(
  events: readonly T[],
): T[] {
  return events.filter((event) => !isReorder(event));
}
