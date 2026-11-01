import { and, desc, eq, inArray } from 'drizzle-orm';
import { type Db } from './client.ts';
import { type ActivityType } from './enums.ts';
import {
  agentEventDeliveries,
  agentEvents,
  agentProjectGrants,
  agentSessions,
  agents,
  checkpointRefs,
  handoffOffers,
  projectHandoffPolicies,
  projects,
  taskClaims,
  type Activity,
} from './schema.ts';

/**
 * The agent half of the activity log (SPEC §4.76, §4.77, proposal §4.6,
 * LAI-553): one versioned envelope per hand-off, work-request, recovery or
 * context event, and one delivery row per agent it is addressed to.
 *
 * Called by `appendActivity` and by nothing else, inside the transaction that
 * writes the activity row — so an envelope and its deliveries exist exactly
 * when the row does, and a rolled-back hand-off leaves neither. This module
 * exports no update of `agent_events`: an envelope says what was true when it
 * was written, as the activity row beside it does.
 */

/** The envelope's shape version. A change to {@link AgentEventDetail} bumps it. */
export const AGENT_EVENT_SCHEMA_VERSION = 1;

/** The §4.8 verbs that are agent events (§4.76). */
export const AGENT_EVENT_TYPES = [
  'task.agent_selected',
  'task.handoff_offered',
  'task.handoff_approved',
  'task.handoff_accepted',
  'task.handoff_declined',
  'task.handoff_cancelled',
  'task.handoff_expired',
  'task.recovered',
  'project.context_updated',
] as const satisfies readonly ActivityType[];

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export function isAgentEventType(type: ActivityType): type is AgentEventType {
  return (AGENT_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * An agent as an envelope names it: harness and device (D-120), never the
 * registered name, which only its owner sees.
 */
export interface AgentIdentity {
  agent_id: string;
  harness: string;
  device: string | null;
}

/** The part of the envelope frozen at append time (§4.76 `detail_json`). */
export interface AgentEventDetail {
  offer: { id: string; kind: 'work_request' | 'handoff' | 'recovery' } | null;
  from: AgentIdentity | null;
  to: AgentIdentity | null;
  /** The sender's reason, or a decline's: untrusted data (D-115 item 7). */
  reason: string | null;
  closed_reason: string | null;
  checkpoint: { id: string | null; commit_sha: string | null; ref: string | null } | null;
  /** SHA-256 of the continuation note as offered — never the note itself. */
  note_hash: string | null;
  context_revision: number | null;
  approval: {
    required: boolean;
    approved_by_user_id: string | null;
    approved_at: number | null;
  } | null;
  state: { before: string | null; after: string | null };
  claim_generation: { from: number | null; to: number | null };
}

interface Payload {
  offer_id?: string;
  from?: string | null;
  to?: string | null;
  reason?: string | null;
  closed_reason?: string;
  named?: boolean;
  generation?: number;
  revision?: number;
}

type OfferRow = typeof handoffOffers.$inferSelect;

/**
 * Write the envelope and its deliveries for `row`, if it is an agent event.
 * `seq` is the row's rowid, just assigned.
 */
export function recordAgentEvent(db: Db, row: Activity, seq: number): void {
  if (!isAgentEventType(row.type)) return;
  const payload = JSON.parse(row.payloadJson) as Payload;

  const offer = offerOf(db, row, payload);
  const detail = detailOf(db, row, payload, offer);
  const recipients = recipientsOf(db, row, payload, offer, detail);

  db.insert(agentEvents)
    .values({
      activityId: row.id,
      seq,
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      offerId: offer?.id ?? null,
      detailJson: JSON.stringify(detail),
    })
    .run();

  // The writer does not deliver to itself: it already knows what it did.
  const to = [...recipients].filter((id) => id !== row.agentId);
  // Every agent-event verb is a project's; a row without one reaches nobody.
  const projectId = row.projectId;
  if (to.length === 0 || projectId === null) return;
  db.insert(agentEventDeliveries)
    .values(
      to.map((agentId) => ({
        activityId: row.id,
        agentId,
        projectId,
        seq,
        availableAt: row.createdAt,
      })),
    )
    .onConflictDoNothing()
    .run();
}

function offerOf(db: Db, row: Activity, payload: Payload): OfferRow | null {
  if (payload.offer_id !== undefined) {
    return (
      db.select().from(handoffOffers).where(eq(handoffOffers.id, payload.offer_id)).get() ?? null
    );
  }
  // A selection opens a work request for the new agent in the same
  // transaction, and names no offer in its payload (LAI-535).
  if (row.type === 'task.agent_selected' && row.taskId !== null && typeof payload.to === 'string') {
    return (
      db
        .select()
        .from(handoffOffers)
        .where(
          and(
            eq(handoffOffers.taskId, row.taskId),
            eq(handoffOffers.kind, 'work_request'),
            eq(handoffOffers.state, 'open'),
            eq(handoffOffers.toAgentId, payload.to),
          ),
        )
        .get() ?? null
    );
  }
  return null;
}

function identity(db: Db, agentId: string | null | undefined): AgentIdentity | null {
  if (agentId === null || agentId === undefined) return null;
  const agent = db
    .select({ id: agents.id, harness: agents.harness, deviceLabel: agents.deviceLabel })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (agent === undefined) return null;
  return { agent_id: agent.id, harness: agent.harness, device: agent.deviceLabel };
}

/** The agent the work moves from: the sending session's, or the expired claim's. */
function fromAgentOf(db: Db, offer: OfferRow): string | null {
  if (offer.fromSessionId !== null) {
    const session = db
      .select({ agentId: agentSessions.agentId })
      .from(agentSessions)
      .where(eq(agentSessions.id, offer.fromSessionId))
      .get();
    if (session !== undefined) return session.agentId;
  }
  if (offer.fromClaimGeneration !== null) {
    const claim = db
      .select({ agentId: taskClaims.agentId })
      .from(taskClaims)
      .where(
        and(
          eq(taskClaims.taskId, offer.taskId),
          eq(taskClaims.generation, offer.fromClaimGeneration),
        ),
      )
      .get();
    if (claim !== undefined) return claim.agentId;
  }
  return null;
}

/** The state an offer left: an unapproved offer that needed approval was `pending_approval`. */
function liveStateOf(offer: OfferRow): 'pending_approval' | 'open' {
  return offer.requiresApproval && offer.approvedAt === null ? 'pending_approval' : 'open';
}

function stateOf(
  type: AgentEventType,
  payload: Payload,
  offer: OfferRow | null,
): AgentEventDetail['state'] {
  if (offer === null) return { before: null, after: null };
  switch (type) {
    case 'task.handoff_offered':
    case 'task.recovered':
    case 'task.agent_selected':
      return { before: null, after: offer.state };
    case 'task.handoff_approved':
      return { before: payload.named === true ? 'open' : 'pending_approval', after: offer.state };
    case 'task.handoff_accepted':
      return { before: 'open', after: offer.state };
    default:
      return { before: liveStateOf(offer), after: offer.state };
  }
}

function detailOf(
  db: Db,
  row: Activity,
  payload: Payload,
  offer: OfferRow | null,
): AgentEventDetail {
  const type = row.type as AgentEventType;
  const contextRevision =
    type === 'project.context_updated' && typeof payload.revision === 'number'
      ? payload.revision
      : row.projectId === null
        ? null
        : (db
            .select({ revision: projects.contextRevision })
            .from(projects)
            .where(eq(projects.id, row.projectId))
            .get()?.revision ?? null);

  if (offer === null) {
    return {
      offer: null,
      from: type === 'task.agent_selected' ? identity(db, payload.from) : null,
      to: type === 'task.agent_selected' ? identity(db, payload.to) : null,
      reason: null,
      closed_reason: null,
      checkpoint: null,
      note_hash: null,
      context_revision: contextRevision,
      approval: null,
      state: { before: null, after: null },
      claim_generation: { from: null, to: null },
    };
  }

  const ref =
    offer.checkpointId === null
      ? null
      : (db
          .select({ ref: checkpointRefs.ref })
          .from(checkpointRefs)
          .where(eq(checkpointRefs.checkpointId, offer.checkpointId))
          .orderBy(desc(checkpointRefs.revision))
          .limit(1)
          .get()?.ref ?? null);
  const isWorkRequest = offer.kind === 'work_request';
  const fromAgent =
    type === 'task.agent_selected' ? (payload.from ?? null) : fromAgentOf(db, offer);

  return {
    offer: { id: offer.id, kind: offer.kind },
    from: identity(db, fromAgent),
    to: identity(db, offer.toAgentId),
    reason:
      type === 'task.handoff_declined'
        ? (payload.reason ?? null)
        : isWorkRequest
          ? null
          : offer.reason,
    closed_reason: offer.closedReason,
    checkpoint: isWorkRequest
      ? null
      : { id: offer.checkpointId, commit_sha: offer.checkpointCommitSha, ref },
    note_hash: offer.noteHash,
    context_revision: contextRevision,
    approval: isWorkRequest
      ? null
      : {
          required: offer.requiresApproval,
          approved_by_user_id: offer.approvedByUserId,
          approved_at: offer.approvedAt,
        },
    state: stateOf(type, payload, offer),
    claim_generation: {
      from: offer.fromClaimGeneration,
      to: typeof payload.generation === 'number' ? payload.generation : null,
    },
  };
}

/**
 * Who an event is addressed to (§4.77). **Only the agents it concerns** —
 * never every agent that can read the project, which is what keeps one
 * agent's offer off another's stream:
 *
 * - a selection: the agent selected and the one it replaced;
 * - an offer or recovery made: its named receiver, or for an unnamed
 *   recovery every agent that could take it now — active, a `full` grant,
 *   and the expired claim's owner's unless the space lets other owners
 *   receive (§4.73);
 * - an offer answered, approved or closed: everyone an earlier event of the
 *   same offer reached, and the agents it moves between;
 * - a context change: every active agent granted the project.
 *
 * Revoked agents get nothing. What may actually reach an agent is asked
 * again when it is read or streamed.
 */
function recipientsOf(
  db: Db,
  row: Activity,
  payload: Payload,
  offer: OfferRow | null,
  detail: AgentEventDetail,
): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined): void => {
    if (typeof id === 'string') ids.add(id);
  };
  const type = row.type as AgentEventType;

  if (type === 'project.context_updated') {
    if (row.projectId !== null) {
      for (const g of db
        .select({ agentId: agentProjectGrants.agentId })
        .from(agentProjectGrants)
        .where(eq(agentProjectGrants.projectId, row.projectId))
        .all()) {
        add(g.agentId);
      }
    }
  } else if (type === 'task.agent_selected') {
    add(payload.from);
    add(payload.to);
  } else if (offer !== null) {
    add(detail.from?.agent_id);
    add(offer.toAgentId);
    if (offer.toAgentId === null && offer.kind === 'recovery' && row.projectId !== null) {
      for (const id of recoveryCandidates(db, row.projectId, detail.from?.agent_id ?? null))
        add(id);
    }
    if (type !== 'task.handoff_offered' && type !== 'task.recovered') {
      for (const d of db
        .select({ agentId: agentEventDeliveries.agentId })
        .from(agentEventDeliveries)
        .innerJoin(agentEvents, eq(agentEvents.activityId, agentEventDeliveries.activityId))
        .where(eq(agentEvents.offerId, offer.id))
        .all()) {
        add(d.agentId);
      }
    }
  }

  if (ids.size === 0) return ids;
  const active = db
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.id, [...ids]), eq(agents.status, 'active')))
    .all();
  return new Set(active.map((a) => a.id));
}

/** Agents that could take an unnamed recovery in this project now (§4.73). */
function recoveryCandidates(db: Db, projectId: string, expiredAgentId: string | null): string[] {
  const owner =
    expiredAgentId === null
      ? undefined
      : db
          .select({ ownerUserId: agents.ownerUserId })
          .from(agents)
          .where(eq(agents.id, expiredAgentId))
          .get()?.ownerUserId;
  const otherOwners =
    db
      .select({ allow: projectHandoffPolicies.allowOtherOwners })
      .from(projectHandoffPolicies)
      .where(eq(projectHandoffPolicies.projectId, projectId))
      .get()?.allow ?? false;
  if (owner === undefined && !otherOwners) return [];

  return db
    .select({ id: agents.id, ownerUserId: agents.ownerUserId })
    .from(agentProjectGrants)
    .innerJoin(agents, eq(agents.id, agentProjectGrants.agentId))
    .where(
      and(
        eq(agentProjectGrants.projectId, projectId),
        eq(agentProjectGrants.scope, 'full'),
        eq(agents.status, 'active'),
      ),
    )
    .all()
    .filter((a) => otherOwners || a.ownerUserId === owner)
    .map((a) => a.id);
}
