import {
  activityAtSeq,
  apiPayload,
  countActivityAfter,
  latestActivitySeq,
} from '../db/activity.ts';
import { type ActivityEvent } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type ActivityType, type ActorKind } from '../db/enums.ts';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { can } from '../policy/can.ts';
import { type AgentLens, type AgentReader, agentLens } from './agent-visibility.ts';
import { tokens } from '../db/schema.ts';
import { inArray } from 'drizzle-orm';

/**
 * What a client is allowed to see on the live stream, and where a reconnect
 * resumes from (SPEC §11.5, §6.3, §4.8).
 *
 * The route is transport; every decision about *who sees what* is here, so the
 * MCP side (§7) and any future consumer of the same feed cannot get a different
 * answer from the one the HTTP stream gives.
 */

/** One activity row as it goes over the wire. §4.8's columns, renamed to §6.3 style. */
export interface EventView {
  id: string;
  /** The SSE event id: monotonic, and what `Last-Event-ID` carries back. */
  seq: number;
  type: ActivityType;
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  /**
   * `user` | `agent` | `system` — on every row (§4.8), so a UI can badge an
   * agent-authored change without a second lookup.
   */
  actor_kind: ActorKind;
  actor_token_id: string | null;
  /**
   * The registered agent that wrote it (D-114 item 4, LAI-535), read from the
   * token at write time. Null for a person, a legacy token, the system, and
   * every row older than the column — never back-filled. **Also null when the
   * reader may not see that agent** (D-121 item 7, LAI-1011): only its owner,
   * or a reader whose task shows it as selected or claiming, is told which.
   */
  agent_id: string | null;
  /**
   * The agent session the row was written under and what it reported about
   * itself **then** — self-reported (D-118, LAI-586), a snapshot a later
   * heartbeat does not change. Null for a row not written by an agent session
   * and every row older than the columns — never back-filled — and withheld
   * with `agent_id` (LAI-1011): its harness is half the agent's label.
   */
  agent_session: ActivitySessionView | null;
  /**
   * True when this reader was withheld an agent the row names (LAI-1011): the
   * row's own agent, an agent id in the payload, or the registered name on an
   * agent token's `token.created` / `token.revoked`. A client reads it to say
   * *an agent* rather than guess from a null — a null alone also means a person,
   * a legacy token, or a selection really withdrawn.
   */
  agent_redacted: boolean;
  payload: unknown;
  created_at: number;
}

/** An activity row's session snapshot (D-118). Self-reported; decides nothing. */
export interface ActivitySessionView {
  id: string;
  harness: string | null;
  harness_version: string | null;
  model: string | null;
}

/**
 * The payload keys that hold a registered agent's id, at any depth (LAI-1011).
 * `task.agent_selected` names it as `from` and `to`, so those two count there.
 * A new verb that carries an agent id under another key must be added here:
 * nothing finds it for you. `test/services/agent-visibility.test.ts` writes
 * rows carrying each key listed and checks the raw body; it cannot see a key
 * that is not listed.
 */
const AGENT_ID_KEYS: ReadonlySet<string> = new Set([
  'agent_id',
  'to_agent_id',
  'from_agent_id',
  'selected_agent_id',
]);
const AGENT_ID_KEYS_BY_TYPE: Partial<Record<ActivityType, ReadonlySet<string>>> = {
  'task.agent_selected': new Set(['from', 'to']),
};

/** The verbs whose payload names a token, and with it, for an agent token, the agent's registered name. */
const TOKEN_VERBS: ReadonlySet<ActivityType> = new Set(['token.created', 'token.revoked']);

function tokenIdOf(row: ActivityEvent, payload: unknown): string | null {
  if (!TOKEN_VERBS.has(row.type) || payload === null || typeof payload !== 'object') return null;
  const id = (payload as Record<string, unknown>).token_id;
  return typeof id === 'string' ? id : null;
}

function isAgentKey(type: ActivityType, key: string, depth: number): boolean {
  return AGENT_ID_KEYS.has(key) || (depth === 0 && AGENT_ID_KEYS_BY_TYPE[type]?.has(key) === true);
}

/** Every agent id a payload names, for building the lens before any row is shown. */
function payloadAgentIds(
  type: ActivityType,
  value: unknown,
  depth = 0,
  out: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    for (const v of value) payloadAgentIds(type, v, depth + 1, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && isAgentKey(type, k, depth)) out.push(v);
      else payloadAgentIds(type, v, depth + 1, out);
    }
  }
  return out;
}

/** The payload with every agent id the reader may not see set to null — the key kept, the id gone. */
function withheldPayload(
  type: ActivityType,
  value: unknown,
  keep: (agentId: string) => boolean,
  depth = 0,
): unknown {
  if (Array.isArray(value)) return value.map((v) => withheldPayload(type, v, keep, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) =>
      typeof v === 'string' && isAgentKey(type, k, depth)
        ? [k, keep(v) ? v : null]
        : [k, withheldPayload(type, v, keep, depth + 1)],
    ),
  );
}

/**
 * The gate for activity: `agentLens`, plus which agent each token a token row
 * names belongs to — an agent token carries its agent's registered name.
 */
export interface ActivityLens extends AgentLens {
  /** The token's agent; `null` for a person's own token; `undefined` for a token not looked up. */
  agentOfToken(tokenId: string): string | null | undefined;
}

/** Names nothing: every agent withheld, every token treated as an unknown agent's. */
export const BLIND_ACTIVITY_LENS: ActivityLens = {
  visible: () => false,
  agentOfToken: () => undefined,
};

/**
 * The lens for one batch of rows: every agent the rows name, on the rows'
 * tasks (`agentLens`), and the agents behind the tokens they name. A constant
 * number of queries whatever the batch holds; build it once per batch.
 */
export function activityLens(
  db: Db,
  reader: AgentReader,
  rows: readonly ActivityEvent[],
): ActivityLens {
  const tokenIds = [
    ...new Set(rows.flatMap((r) => tokenIdOf(r, apiPayload(r)) ?? [])),
  ];
  const agentByToken = new Map<string, string | null>(
    tokenIds.length === 0
      ? []
      : db
          .select({ id: tokens.id, agentId: tokens.agentId })
          .from(tokens)
          .where(inArray(tokens.id, tokenIds))
          .all()
          .map((t) => [t.id, t.agentId] as const),
  );
  const lens = agentLens(
    db,
    reader,
    rows.map((r) => r.taskId),
    [
      ...rows.flatMap((r) => [
        ...(r.agentId === null ? [] : [r.agentId]),
        ...payloadAgentIds(r.type, apiPayload(r)),
      ]),
      ...[...agentByToken.values()].flatMap((a) => (a === null ? [] : [a])),
    ],
  );
  return {
    visible: (taskId, agentId) => lens.visible(taskId, agentId),
    agentOfToken: (tokenId) => agentByToken.get(tokenId),
  };
}

/**
 * One row on the wire. **The lens is required**: every surface that serves
 * activity passes through here, and there is no default that names an agent.
 */
export function eventView(row: ActivityEvent, lens: ActivityLens): EventView {
  let redacted = false;
  const keep = (agentId: string): boolean => {
    const shown = lens.visible(row.taskId, agentId);
    if (!shown) redacted = true;
    return shown;
  };
  const agentShown = row.agentId !== null && keep(row.agentId);
  const raw = apiPayload(row);
  let payload = withheldPayload(row.type, raw, keep);
  // An agent token's name is its agent's registered name (D-120): withheld
  // with the agent. A token not looked up is withheld too, never guessed.
  const tokenId = tokenIdOf(row, raw);
  if (tokenId !== null) {
    const agentId = lens.agentOfToken(tokenId);
    if (agentId === undefined || (agentId !== null && !keep(agentId))) {
      redacted = true;
      payload = { ...(payload as Record<string, unknown>), name: null };
    }
  }
  return {
    id: row.id,
    seq: row.seq,
    type: row.type,
    project_id: row.projectId,
    task_id: row.taskId,
    actor_id: row.actorId,
    actor_kind: row.actorKind,
    actor_token_id: row.actorTokenId,
    agent_id: agentShown ? row.agentId : null,
    // A person's row has no agent and keeps its session as before; an agent's
    // row shows its session snapshot only with the agent.
    agent_session:
      row.agentSessionId === null || (row.agentId !== null && !agentShown)
        ? null
        : {
            id: row.agentSessionId,
            harness: row.sessionHarness,
            harness_version: row.sessionHarnessVersion,
            model: row.sessionModel,
          },
    agent_redacted: redacted,
    // `apiPayload`, not `readPayload`: rows written before LAI-045 name Drizzle
    // properties, and this is the one boundary every client passes through.
    payload,
    created_at: row.createdAt,
  };
}

/** A page of rows on the wire, through one lens for the page. */
export function eventViews(
  db: Db,
  reader: AgentReader,
  rows: readonly ActivityEvent[],
): EventView[] {
  const lens = activityLens(db, reader, rows);
  return rows.map((row) => eventView(row, lens));
}

/**
 * May this actor see this row?
 *
 * Two cases, because §4.8 has two kinds of row:
 *
 * **Project-scoped** — decided by `project.read` against that project, which is
 * exactly the rule that governs reading the same events through
 * `GET /projects/:slug/tasks`. A stream that showed more than the REST API would
 * be a second, weaker permission system.
 *
 * **Org-scoped** (`project_id IS NULL`: `token.created`, `member.role_changed`,
 * `unlisted.logged`, `org.created`) — restricted to org Owner and Admin. There is
 * no §3.1 cell for "read the org activity feed"; the nearest thing the matrix
 * describes is **Export audit log**, ✓ for Owner and Admin only — and these rows
 * *are* the audit log. Reusing that cell keeps the policy surface closed, and
 * errs narrow: the cost of being wrong here is a member not seeing that someone
 * else minted a token, not a member seeing it. The gap is filed as LAI-111.
 *
 * Single-org deployment (§4.2), so `org_id` is the same on every row and is not
 * filtered on; if Laika ever holds more than one org, this is the function that
 * has to learn about it.
 */
export function visibleTo(actor: ResolvedActor, row: ActivityEvent): boolean {
  if (row.projectId === null) return can(actor, 'audit_log.export');

  return can(withProject(actor, row.projectId), 'project.read', { projectId: row.projectId });
}

/**
 * How far behind a reconnecting client may be before the server refuses to
 * replay (§11.5).
 *
 * 500 rows: a client offline for a coffee break on a busy board is inside it, a
 * tab left open over a weekend is not. The number is a memory bound as much as a
 * policy one — every replayed row is serialised into a socket buffer the client
 * has not read yet, so an unbounded replay is an unbounded allocation triggered
 * by a header the client controls.
 */
export const MAX_REPLAY = 500;

export type GapReason = 'replay_too_large' | 'unknown_last_event_id';

/** Sent to the client instead of a silent skip (§11.5). */
export interface GapNotice {
  reason: GapReason;
  /** How many rows were skipped, or -1 when the id was not ours to count from. */
  missed: number;
  limit: number;
  /**
   * The `?updated_since=` value that covers the hole (§6.3), when the server can
   * work it out. Null means the client must fall back to its own watermark.
   */
  updated_since: number | null;
}

export interface ResumePoint {
  /** Deliver rows after this sequence. */
  from: number;
  gap: GapNotice | null;
}

/**
 * Where this connection starts.
 *
 * No `Last-Event-ID` is a fresh client: it starts at the head and gets nothing
 * historical, because a page that has just loaded its state over REST does not
 * want that state replayed at it.
 */
export function resumeFrom(db: Db, lastEventId: number | null): ResumePoint {
  const latest = latestActivitySeq(db);

  if (lastEventId === null) return { from: latest, gap: null };

  // Ahead of us. A different database — a restore from backup, or a client that
  // kept an id across a `laika.db` replacement. Replaying nothing and saying so
  // beats pretending the client is up to date.
  if (lastEventId > latest) {
    return {
      from: latest,
      gap: { reason: 'unknown_last_event_id', missed: -1, limit: MAX_REPLAY, updated_since: null },
    };
  }

  const missed = countActivityAfter(db, lastEventId);
  if (missed <= MAX_REPLAY) return { from: lastEventId, gap: null };

  return {
    from: latest,
    gap: {
      reason: 'replay_too_large',
      missed,
      limit: MAX_REPLAY,
      // The client's last confirmed event is the exact watermark for the REST
      // catch-up, so it does not have to guess one.
      updated_since: activityAtSeq(db, lastEventId)?.createdAt ?? null,
    },
  };
}

/** `Last-Event-ID` as a sequence, or null when absent or not one of ours. */
export function parseLastEventId(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;

  const seq = Number(raw);
  if (!Number.isSafeInteger(seq) || seq < 0) return null;

  return seq;
}
