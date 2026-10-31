import type Database from 'better-sqlite3';
import { and, asc, eq, getTableColumns, gt, inArray, isNull, type SQL } from 'drizzle-orm';
import { reloadActor, withProject, type ResolvedActor } from '../auth/resolve-actor.ts';
import { TokenAuthError } from '../auth/tokens.ts';
import { latestActivitySeq, type ActivityEvent } from '../db/activity.ts';
import { type AgentEventDetail, type AgentEventType } from '../db/agent-events.ts';

import { type Db } from '../db/client.ts';
import { type ActorKind } from '../db/enums.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  activity,
  agentEventDeliveries,
  agentEvents,
  agentSessions,
  handoffOffers,
  projects,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { registeredAgent, requireOwnOpenSession } from './claims.ts';
import { insidePin, visibleTo } from './events.ts';
import { noSuchProjectForAgent } from './work-requests.ts';

/** Is this §4.8 verb an agent event (§4.76)? Re-exported so routes stay on services/. */
export { isAgentEventType } from '../db/agent-events.ts';

/**
 * An agent's hand-off events and where each stands (SPEC §4.76, §4.77, §6.4,
 * §11.5, proposal §4.6, LAI-553).
 *
 * **The durable record is the delivery row**; the stream is a notice. An
 * agent's helper polls {@link listAgentEvents} at session start, at each
 * prompt and every few tool calls, acknowledges with {@link ackAgentEvents},
 * and listens on `/api/v1/events` in between — where the same rows arrive,
 * filtered to it by {@link deliveryFor}. Every read asks again whether the
 * agent may see the event **now**: its token, its grant, its owner's role.
 */

/** Where one event stands for one agent (§4.77). None claims the model understood it. */
export const DELIVERY_STATES = ['available', 'received', 'presented', 'accepted'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export interface AgentEventDelivery {
  state: DeliveryState;
  available_at: number;
  received_at: number | null;
  presented_at: number | null;
  /** From the offer (§4.73): when this agent accepted it, or null. */
  accepted_at: number | null;
}

/** The versioned envelope (§4.76): the activity row's facts, the frozen detail, the delivery. */
export interface AgentEventEnvelope extends AgentEventDetail {
  schema_version: number;
  /** The activity row's id — what a client de-duplicates by. */
  event_id: string;
  /** The activity row's sequence — the ordering cursor, and the SSE `id:`. */
  cursor: number;
  type: AgentEventType;
  occurred_at: number;
  project_id: string | null;
  task_id: string | null;
  actor: {
    kind: ActorKind;
    user_id: string | null;
    agent_id: string | null;
    session_id: string | null;
  };
  delivery: AgentEventDelivery;
}

/** `GET /agents/me/events` (§6.4). */
export interface AgentEventsPage {
  data: AgentEventEnvelope[];
  /** Pass back as `after`: the last event returned, or `after` itself when none was. */
  cursor: number;
  has_more: boolean;
  /** `after` is ahead of the log — another database: the page starts again from 0. */
  gap: { reason: 'unknown_cursor' } | null;
}

export const AGENT_EVENTS_DEFAULT_LIMIT = 100;
export const AGENT_EVENTS_MAX_LIMIT = 100;
export const AGENT_EVENTS_MAX_ACK = 100;

type DeliveryRow = typeof agentEventDeliveries.$inferSelect;
type EventRow = typeof agentEvents.$inferSelect;

interface Joined {
  row: ActivityEvent;
  event: EventRow;
  delivery: DeliveryRow;
}

function requireAgentToken(actor: ResolvedActor): string {
  const agent = registeredAgent(actor);
  if (agent === null) {
    throw new ApiError('forbidden', 'Only a registered agent’s token has hand-off events', {
      reason: 'not_an_agent',
    });
  }
  return agent.id;
}

/** May this agent's actor see this event now? The stream's question, asked on every read. */
function mayRead(actor: ResolvedActor, row: ActivityEvent): boolean {
  return insidePin(actor, row.projectId) && visibleTo(actor, row);
}

function joined(db: Db, conditions: SQL[], limit?: number): Joined[] {
  const query = db
    .select({
      row: { ...getTableColumns(activity), seq: agentEvents.seq },
      event: agentEvents,
      delivery: agentEventDeliveries,
    })
    .from(agentEventDeliveries)
    .innerJoin(agentEvents, eq(agentEvents.activityId, agentEventDeliveries.activityId))
    .innerJoin(activity, eq(activity.id, agentEventDeliveries.activityId))
    .where(and(...conditions))
    .orderBy(asc(agentEventDeliveries.seq));
  return (limit === undefined ? query : query.limit(limit)).all();
}

/** When this agent accepted the event's offer, or null (§4.73: `accepted` is the offer's). */
function acceptedAt(db: Db, offerIds: string[], agentId: string): Map<string, number> {
  if (offerIds.length === 0) return new Map();
  const offers = db
    .select({
      id: handoffOffers.id,
      kind: handoffOffers.kind,
      toAgentId: handoffOffers.toAgentId,
      closedAt: handoffOffers.closedAt,
      sessionAgentId: agentSessions.agentId,
    })
    .from(handoffOffers)
    .leftJoin(agentSessions, eq(agentSessions.id, handoffOffers.acceptedSessionId))
    .where(and(inArray(handoffOffers.id, offerIds), eq(handoffOffers.state, 'accepted')))
    .all();
  const out = new Map<string, number>();
  for (const o of offers) {
    // A work request is accepted by claiming it, which names no session.
    const by = o.kind === 'work_request' ? o.toAgentId : o.sessionAgentId;
    if (by === agentId && o.closedAt !== null) out.set(o.id, o.closedAt);
  }
  return out;
}

function envelopes(db: Db, rows: Joined[], agentId: string): AgentEventEnvelope[] {
  const accepted = acceptedAt(
    db,
    [...new Set(rows.map((r) => r.event.offerId).filter((id): id is string => id !== null))],
    agentId,
  );
  return rows.map(({ row, event, delivery }) => {
    const acceptedOn = event.offerId === null ? null : (accepted.get(event.offerId) ?? null);
    const state: DeliveryState =
      acceptedOn !== null
        ? 'accepted'
        : delivery.presentedAt !== null
          ? 'presented'
          : delivery.receivedAt !== null
            ? 'received'
            : 'available';
    return {
      schema_version: event.schemaVersion,
      event_id: row.id,
      cursor: event.seq,
      type: row.type as AgentEventType,
      occurred_at: row.createdAt,
      project_id: row.projectId,
      task_id: row.taskId,
      actor: {
        kind: row.actorKind,
        user_id: row.actorId,
        agent_id: row.agentId,
        session_id: row.agentSessionId,
      },
      ...(JSON.parse(event.detailJson) as AgentEventDetail),
      delivery: {
        state,
        available_at: delivery.availableAt,
        received_at: delivery.receivedAt,
        presented_at: delivery.presentedAt,
        accepted_at: acceptedOn,
      },
    };
  });
}

export interface ListAgentEventsOptions {
  /** Events after this cursor (an activity sequence). 0 is the start. */
  after: number;
  /** `undelivered` (default): not yet `received`. `all`: every state. */
  state: 'undelivered' | 'all';
  limit: number;
  /** Only this project's events: a slug the agent may read now (`agent_sync`'s `project`). */
  projectSlug?: string | null | undefined;
}

/**
 * The projects whose events this agent may read **now** (§11.5's question,
 * asked once per project rather than once per row): those its deliveries
 * name, kept where {@link mayRead} holds — the token's pin, the agent's
 * grant, the owner's role. An agent event always names a project, so an
 * org-level row is never among them.
 */
function readableProjects(db: Db, actor: ResolvedActor, agentId: string): string[] {
  const named = db
    .selectDistinct({ projectId: activity.projectId })
    .from(agentEventDeliveries)
    .innerJoin(activity, eq(activity.id, agentEventDeliveries.activityId))
    .where(eq(agentEventDeliveries.agentId, agentId))
    .all();
  return named
    .map((n) => n.projectId)
    .filter((id): id is string => id !== null)
    .filter(
      (projectId) =>
        insidePin(actor, projectId) &&
        can(withProject(actor, projectId), 'project.read', { projectId }),
    );
}

/**
 * `GET /agents/me/events`, `agent_sync`'s `events` (§6.4, §7.1): the events
 * addressed to the calling agent after `after`, oldest first, each with its
 * delivery state — **at least once**: an event stays `undelivered` until the
 * helper acknowledges it, whatever the stream did.
 *
 * **Only what the agent may read now is answered, and the filter is in the
 * query** (LAI-553 review): one page is one query plus one row of look-ahead,
 * however many deliveries it may no longer read, and `has_more` counts only
 * rows it may read — a hidden event is indistinguishable from a missing one.
 * A grant given back returns its events, still undelivered.
 */
export function listAgentEvents(
  db: Db,
  actor: ResolvedActor,
  options: ListAgentEventsOptions,
): AgentEventsPage {
  assertCan(actor, 'agent.read_own');
  const agentId = requireAgentToken(actor);

  let after = options.after;
  let gap: AgentEventsPage['gap'] = null;
  if (after > latestActivitySeq(db)) {
    gap = { reason: 'unknown_cursor' };
    after = 0;
  }

  let readable = readableProjects(db, actor, agentId);
  if (options.projectSlug !== undefined && options.projectSlug !== null) {
    // A slug the agent may not read and one that names nothing answer alike.
    const found = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, options.projectSlug))
      .get();
    if (
      found === undefined ||
      !insidePin(actor, found.id) ||
      !can(withProject(actor, found.id), 'project.read', { projectId: found.id })
    ) {
      throw noSuchProjectForAgent();
    }
    readable = readable.filter((id) => id === found.id);
  }
  if (readable.length === 0) return { data: [], cursor: after, has_more: false, gap };

  const conditions: SQL[] = [
    eq(agentEventDeliveries.agentId, agentId),
    gt(agentEventDeliveries.seq, after),
    inArray(activity.projectId, readable),
  ];
  if (options.state === 'undelivered') conditions.push(isNull(agentEventDeliveries.receivedAt));

  const page = joined(db, conditions, options.limit + 1);
  const out = page.slice(0, options.limit);
  return {
    data: envelopes(db, out, agentId),
    cursor: out.at(-1)?.event.seq ?? after,
    has_more: page.length > options.limit,
    gap,
  };
}

export interface AckAgentEventsInput {
  eventIds: string[];
  state: 'received' | 'presented';
  sessionId?: string | undefined;
}

/**
 * `POST /agents/me/events/ack`, `agent_sync`'s `ack` (§6.4): record that the
 * helper received these events, or that a hook presented them. One
 * transaction, all or nothing.
 *
 * - **Idempotent**: acknowledging again keeps the first time — a replayed
 *   delivery records one `received`.
 * - **`presented` cannot precede `received`**: `409 conflict`, `reason:
 *   not_received`, naming the events. The CHECK on §4.77 says the same.
 * - An event not addressed to this agent, or one it may no longer read, is
 *   `404`, as another agent's session is.
 * - `session_id`, when sent, must be the agent's own open session (§4.65).
 *
 * Presence, as a heartbeat is (§9.1): `heartbeat.send_own`, and no activity
 * row.
 */
export function ackAgentEvents(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  input: AckAgentEventsInput,
  now = Date.now(),
): AgentEventEnvelope[] {
  assertCan(actor, 'heartbeat.send_own');
  requireAgentToken(actor);
  const ids = [...new Set(input.eventIds)];

  return immediateTransaction(sqlite, () => {
    // Read again inside the transaction (LAI-553 review): the route resolved
    // the actor before it waited for the body, and a token revoked or
    // narrowed, an agent revoked or ungranted, or an owner demoted in that
    // wait must not acknowledge — nor be answered an envelope. The refusal is
    // the one a fresh request on that token would get.
    const fresh = reloadActor(db, actor, now);
    if (!fresh.ok) throw new TokenAuthError(fresh.reason);
    const current = fresh.actor;
    assertCan(current, 'heartbeat.send_own');
    const agentId = requireAgentToken(current);
    const session =
      input.sessionId === undefined ? null : requireOwnOpenSession(db, current, input.sessionId).id;
    const found = joined(db, [
      eq(agentEventDeliveries.agentId, agentId),
      inArray(agentEventDeliveries.activityId, ids),
    ]).filter((item) => mayRead(current, item.row));
    const known = new Set(found.map((f) => f.row.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw ApiError.notFound('No such event for this agent', { event_ids: missing });
    }

    if (input.state === 'presented') {
      const unreceived = found.filter((f) => f.delivery.receivedAt === null).map((f) => f.row.id);
      if (unreceived.length > 0) {
        throw new ApiError('conflict', 'An event is presented only after it was received', {
          reason: 'not_received',
          event_ids: unreceived,
        });
      }
      db.update(agentEventDeliveries)
        .set({ presentedAt: now, presentedSessionId: session })
        .where(
          and(
            eq(agentEventDeliveries.agentId, agentId),
            inArray(agentEventDeliveries.activityId, ids),
            isNull(agentEventDeliveries.presentedAt),
          ),
        )
        .run();
    } else {
      db.update(agentEventDeliveries)
        .set({ receivedAt: now, receivedSessionId: session })
        .where(
          and(
            eq(agentEventDeliveries.agentId, agentId),
            inArray(agentEventDeliveries.activityId, ids),
            isNull(agentEventDeliveries.receivedAt),
          ),
        )
        .run();
    }

    return envelopes(
      db,
      joined(db, [
        eq(agentEventDeliveries.agentId, agentId),
        inArray(agentEventDeliveries.activityId, ids),
      ]),
      agentId,
    );
  });
}

/**
 * The envelope of `row` for the agent behind `actor`, when it is addressed to
 * it — or null. The stream's filter for an agent's token (§11.5): an agent
 * event reaches an agent only through its own delivery row.
 */
export function deliveryFor(
  db: Db,
  actor: ResolvedActor,
  row: ActivityEvent,
): AgentEventEnvelope | null {
  const agentId = registeredAgent(actor)?.id;
  if (agentId === undefined) return null;
  const found = joined(db, [
    eq(agentEventDeliveries.agentId, agentId),
    eq(agentEventDeliveries.activityId, row.id),
  ]);
  return found.length === 0 ? null : envelopes(db, found, agentId)[0]!;
}

/** The delivery of every offer's newest event for this agent, keyed by offer id — the inbox's. */
export function inboxDeliveries(
  db: Db,
  agentId: string,
  offerIds: string[],
): Map<string, AgentEventDelivery> {
  if (offerIds.length === 0) return new Map();
  const rows = joined(db, [
    eq(agentEventDeliveries.agentId, agentId),
    inArray(agentEvents.offerId, offerIds),
  ]);
  const out = new Map<string, AgentEventDelivery>();
  for (const env of envelopes(db, rows, agentId)) {
    if (env.offer !== null) out.set(env.offer.id, env.delivery);
  }
  return out;
}
