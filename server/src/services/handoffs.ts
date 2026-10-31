import { createHash } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type Database from 'better-sqlite3';
import {
  activityActor,
  isSystemPrincipal,
  loadActor,
  loadActors,
  type ResolvedActor,
  withProject,
} from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  type HandoffClosedReason,
  type HandoffOfferKind,
  type HandoffOfferState,
  LIVE_OFFER_STATES,
} from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  agentProjectGrants,
  agents,
  agentSessions,
  handoffOffers,
  projectHandoffPolicies,
  projectMemberships,
  projects,
  taskCheckpoints,
  taskClaims,
  tasks,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, systemPrincipal, type AgentContext } from '../policy/can.ts';
import {
  type AgentSessionView,
  claimFenceRefusal,
  claimView,
  expireClaim,
  insertClaim,
  latestClaim,
  leaseLapsed,
  liveClaim,
  openSession,
  registeredAgent,
  reloadAgentActor,
  requireOpenSession,
  requireVisibleTaskToClaim,
  sessionView,
  type TaskClaimView,
} from './claims.ts';
import { type AgentReader, agentLens, agentReader } from './agent-visibility.ts';
import { inboxDeliveries, type AgentEventDelivery } from './agent-events.ts';
import { assertCheckpointAcceptable } from './checkpoints.ts';
import { canSeeProject, requireProjectBySlug } from './projects.ts';
import {
  namedFor,
  noSuchProjectForAgent,
  type SelectedAgentView,
  type WorkRequestView,
} from './work-requests.ts';

/**
 * Hand-off offers, approvals, acceptance and recovery (SPEC §4.73, §4.74,
 * §6.3, §6.4, §11.6, proposal §4.4, §4.5, D-114 – D-116, LAI-546).
 *
 * ## The one rule everything here serves
 *
 * **Acceptance moves the claim atomically**: in one `BEGIN IMMEDIATE`
 * transaction the claim the work moves from ends — a paused sender's becomes
 * `transferred`, an expired one stays `expired` — and the receiver's session
 * gets a new claim at the next generation. From that commit on the old
 * session's generation is refused by the fence (§6.3), on REST and MCP alike,
 * because both ask the same service.
 *
 * ## Reading everything again
 *
 * Every write re-reads, inside its transaction, the caller's token, agent and
 * owner ({@link reloadAgentActor}), the owner's permission narrowed by the
 * agent's grant, the policy, the offer's state and expiry and the checkpoint's
 * `verification`. Nothing a request resolved before the lock is trusted.
 *
 * ## Untrusted data
 *
 * A sender's `reason` and the checkpoint's note are stored and served as data
 * — never executed, never read as instructions (D-115 item 7). `note_hash` lets
 * the receiver see whether the note it reads is the note that was offered.
 *
 * ## Hidden is missing
 *
 * An offer on a task the caller cannot read is answered exactly as an offer
 * that does not exist (`404`, the same bytes), as a task is (LAI-586).
 */

// ------------------------------------------------------------------ policy

/** §4.74's defaults: what a project that never set a policy reads as. */
export const DEFAULT_HANDOFF_POLICY = {
  allow_other_owners: false,
  cross_owner_requires_approval: true,
  max_handoffs: 3,
  offer_ttl_minutes: 30,
} as const;

/** §4.74's bounds, shared by the route and the service. */
export const HANDOFF_POLICY_LIMITS = {
  maxHandoffs: { min: 0, max: 20 },
  offerTtlMinutes: { min: 5, max: 1440 },
} as const;

/** §4.73's bounds. */
export const HANDOFF_LIMITS = {
  reason: 500,
  idempotencyKey: 200,
  declineReason: 500,
} as const;

/** A project's hand-off policy as `GET /projects/:slug/handoff-policy` answers it. */
export interface HandoffPolicyView {
  project_id: string;
  allow_other_owners: boolean;
  cross_owner_requires_approval: boolean;
  max_handoffs: number;
  offer_ttl_minutes: number;
  updated_by: string | null;
  /** `false` when no row exists and these are the defaults (§4.74). */
  is_set: boolean;
}

function readPolicy(db: Db, projectId: string): HandoffPolicyView {
  const row = db
    .select()
    .from(projectHandoffPolicies)
    .where(eq(projectHandoffPolicies.projectId, projectId))
    .get();
  return policyView(projectId, row);
}

/** Every policy of these projects in one read; a project with none reads as the defaults. */
function readPolicies(db: Db, projectIds: readonly string[]): Map<string, HandoffPolicyView> {
  const rows =
    projectIds.length === 0
      ? []
      : db
          .select()
          .from(projectHandoffPolicies)
          .where(inArray(projectHandoffPolicies.projectId, [...projectIds]))
          .all();
  const byProject = new Map(rows.map((r) => [r.projectId, r]));
  return new Map(projectIds.map((id) => [id, policyView(id, byProject.get(id))]));
}

function policyView(
  projectId: string,
  row: typeof projectHandoffPolicies.$inferSelect | undefined,
): HandoffPolicyView {
  if (row === undefined) {
    return { project_id: projectId, ...DEFAULT_HANDOFF_POLICY, updated_by: null, is_set: false };
  }
  return {
    project_id: projectId,
    allow_other_owners: row.allowOtherOwners,
    cross_owner_requires_approval: row.crossOwnerRequiresApproval,
    max_handoffs: row.maxHandoffs,
    offer_ttl_minutes: row.offerTtlMinutes,
    updated_by: row.updatedBy,
    is_set: true,
  };
}

/** `GET /projects/:slug/handoff-policy` (§6.4): under *Read tasks*. */
export function getHandoffPolicy(db: Db, actor: ResolvedActor, slug: string): HandoffPolicyView {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });
  return readPolicy(db, project.id);
}

export interface HandoffPolicyInput {
  allow_other_owners?: boolean | undefined;
  cross_owner_requires_approval?: boolean | undefined;
  max_handoffs?: number | undefined;
  offer_ttl_minutes?: number | undefined;
}

function bounded(field: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError('unprocessable', `${field} is an integer from ${min} to ${max}`, { field });
  }
  return value;
}

/**
 * `PUT /projects/:slug/handoff-policy` (§6.4, §4.74): a lead's. Writes **the
 * whole row** from the defaults plus what it was sent — not from the row
 * before it — and `project.updated` with `{ field: 'handoff_policy', from, to
 * }`, a settings change as every other is. A body that changes nothing writes
 * nothing.
 */
export function putHandoffPolicy(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: HandoffPolicyInput,
  now = Date.now(),
): HandoffPolicyView {
  const next = {
    allow_other_owners: input.allow_other_owners ?? DEFAULT_HANDOFF_POLICY.allow_other_owners,
    cross_owner_requires_approval:
      input.cross_owner_requires_approval ?? DEFAULT_HANDOFF_POLICY.cross_owner_requires_approval,
    max_handoffs: bounded(
      'max_handoffs',
      input.max_handoffs ?? DEFAULT_HANDOFF_POLICY.max_handoffs,
      HANDOFF_POLICY_LIMITS.maxHandoffs.min,
      HANDOFF_POLICY_LIMITS.maxHandoffs.max,
    ),
    offer_ttl_minutes: bounded(
      'offer_ttl_minutes',
      input.offer_ttl_minutes ?? DEFAULT_HANDOFF_POLICY.offer_ttl_minutes,
      HANDOFF_POLICY_LIMITS.offerTtlMinutes.min,
      HANDOFF_POLICY_LIMITS.offerTtlMinutes.max,
    ),
  };

  return immediateTransaction(sqlite, (): HandoffPolicyView => {
    const person = reloadPerson(db, actor);
    const project = requireProjectBySlug(db, slug);
    assertCan(withProject(person, project.id), 'project.handoff_policy.edit', {
      projectId: project.id,
    });
    const before = readPolicy(db, project.id);
    const from = {
      allow_other_owners: before.allow_other_owners,
      cross_owner_requires_approval: before.cross_owner_requires_approval,
      max_handoffs: before.max_handoffs,
      offer_ttl_minutes: before.offer_ttl_minutes,
    };
    if (before.is_set && JSON.stringify(from) === JSON.stringify(next)) return before;

    const values = {
      allowOtherOwners: next.allow_other_owners,
      crossOwnerRequiresApproval: next.cross_owner_requires_approval,
      maxHandoffs: next.max_handoffs,
      offerTtlMinutes: next.offer_ttl_minutes,
      updatedBy: person.userId,
    };
    db.insert(projectHandoffPolicies)
      .values({ id: newId(), projectId: project.id, ...values })
      .onConflictDoUpdate({ target: projectHandoffPolicies.projectId, set: values })
      .run();

    if (JSON.stringify(from) !== JSON.stringify(next)) {
      appendActivity(db, {
        orgId: project.orgId,
        projectId: project.id,
        ...activityActor(person),
        type: 'project.updated',
        payload: { field: 'handoff_policy', from, to: next },
        now,
      });
    }
    return readPolicy(db, project.id);
  });
}

// -------------------------------------------------------------- rate limit

/**
 * §6.3's offer bucket: **10 a burst, refilled one a minute, per agent across
 * its tokens**, beside the general budget — making, accepting, declining or
 * cancelling an offer. A repeated idempotency key still spends a token, so a
 * retry loop cannot spam. Approving is a person's and is not counted here.
 */
export const HANDOFF_RATE = { perMinute: 1, burst: 10 } as const;

/**
 * One bucket per agent, refilled continuously — the same token bucket
 * `http/rate-limit.ts` keeps for §6.3's general budget, kept here because the
 * key is the agent, which only the service knows, and both transports pass
 * through it. Services import nothing from `http/` (CONVENTIONS §2).
 */
const buckets = new Map<string, { tokens: number; at: number }>();

/** A test starts each case with full buckets. */
export function resetHandoffRateLimits(): void {
  buckets.clear();
}

function spendOfferToken(agentId: string, now: number): void {
  const perMs = HANDOFF_RATE.perMinute / 60_000;
  const bucket = buckets.get(agentId) ?? { tokens: HANDOFF_RATE.burst, at: now };
  bucket.tokens = Math.min(
    HANDOFF_RATE.burst,
    bucket.tokens + Math.max(0, now - bucket.at) * perMs,
  );
  bucket.at = now;
  buckets.set(agentId, bucket);
  if (bucket.tokens < 1) {
    throw new ApiError('rate_limited', 'Too many hand-off requests from this agent', {
      reason: 'handoff_rate',
      // Never below a second (§6.3): `Retry-After: 0` invites a retry that fails.
      retry_after_seconds: Math.max(1, Math.ceil((1 - bucket.tokens) / perMs / 1000)),
    });
  }
  bucket.tokens -= 1;
}

// ------------------------------------------------------------------- views

type OfferRow = typeof handoffOffers.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

/** One offer on the wire (§6.4): the column names, unchanged, and a few derived. */
export interface HandoffOfferView {
  id: string;
  task_id: string;
  kind: HandoffOfferKind;
  state: HandoffOfferState;
  from_session_id: string | null;
  /** The sending session's agent; null when nobody sent it. */
  from_agent_id: string | null;
  from_claim_generation: number | null;
  to_agent_id: string | null;
  checkpoint_id: string | null;
  checkpoint_commit_sha: string | null;
  /** The checkpoint as it is now — untrusted data — or null once retention removed it. */
  checkpoint: {
    commit_sha: string;
    verification: string;
    summary: unknown;
    summary_commit_sha: string | null;
  } | null;
  /** The sender's reason. Untrusted data (D-115 item 7). */
  reason: string | null;
  note_hash: string | null;
  requires_approval: boolean;
  approved_by_user_id: string | null;
  approved_at: number | null;
  expires_at: number | null;
  accepted_session_id: string | null;
  accepted_claim_id: string | null;
  /**
   * The sender's agent is one this reader may not see (D-121 item 7,
   * LAI-1012): `from_agent_id` and `from_session_id` are null, and it reads
   * as *an agent*.
   */
  from_agent_redacted: boolean;
  /**
   * The receiver is one this reader may not see (D-121 item 7, LAI-1012):
   * `to_agent_id` is null — *an agent*, **not** "any eligible agent" — and so
   * are `accepted_session_id` and `accepted_claim_id` when it accepted.
   */
  to_agent_redacted: boolean;
  /** The receiver's acknowledgement, not proof (D-116 item 8). */
  receiver_commit_sha: string | null;
  closed_reason: HandoffClosedReason | null;
  created_by_user_id: string;
  created_at: number;
  closed_at: number | null;
}

/**
 * Offers as `reader` may see them. Each agent an offer names — the sender's,
 * the receiver, the session that accepted — asks the one gate (`agentLens`,
 * D-121 item 7, LAI-1012): another person's agent is named only beside a task
 * that shows it as selected or as its live claim's holder.
 */
function offerViews(db: Db, reader: AgentReader, rows: readonly OfferRow[]): HandoffOfferView[] {
  if (rows.length === 0) return [];
  const sessionIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.fromSessionId, r.acceptedSessionId])
        .filter((id): id is string => id !== null),
    ),
  ];
  const agentOfSession = new Map(
    sessionIds.length === 0
      ? []
      : db
          .select({ id: agentSessions.id, agentId: agentSessions.agentId })
          .from(agentSessions)
          .where(inArray(agentSessions.id, sessionIds))
          .all()
          .map((s) => [s.id, s.agentId]),
  );
  const checkpointIds = [
    ...new Set(rows.map((r) => r.checkpointId).filter((id): id is string => id !== null)),
  ];
  const checkpoints = new Map(
    checkpointIds.length === 0
      ? []
      : db
          .select()
          .from(taskCheckpoints)
          .where(inArray(taskCheckpoints.id, checkpointIds))
          .all()
          .map((c) => [c.id, c]),
  );

  const sessionAgent = (id: string | null): string | null =>
    id === null ? null : (agentOfSession.get(id) ?? null);
  const lens = agentLens(
    db,
    reader,
    rows.map((r) => r.taskId),
    rows
      .flatMap((r) => [
        sessionAgent(r.fromSessionId),
        r.toAgentId,
        sessionAgent(r.acceptedSessionId),
      ])
      .filter((id): id is string => id !== null),
  );

  return rows.map((row) => {
    const checkpoint = row.checkpointId === null ? undefined : checkpoints.get(row.checkpointId);
    const withheld = (agentId: string | null): boolean =>
      agentId !== null && !lens.visible(row.taskId, agentId);
    const from = sessionAgent(row.fromSessionId);
    const fromHidden = withheld(from);
    const acceptedHidden = withheld(sessionAgent(row.acceptedSessionId));
    const toHidden = withheld(row.toAgentId) || acceptedHidden;
    return {
      id: row.id,
      task_id: row.taskId,
      kind: row.kind,
      state: row.state,
      from_session_id: fromHidden ? null : row.fromSessionId,
      from_agent_id: fromHidden ? null : from,
      from_claim_generation: row.fromClaimGeneration,
      to_agent_id: toHidden ? null : row.toAgentId,
      checkpoint_id: row.checkpointId,
      checkpoint_commit_sha: row.checkpointCommitSha,
      checkpoint:
        checkpoint === undefined
          ? null
          : {
              commit_sha: checkpoint.commitSha,
              verification: checkpoint.verification,
              summary: checkpoint.summary ?? null,
              summary_commit_sha: checkpoint.summaryCommitSha,
            },
      reason: row.reason,
      note_hash: row.noteHash,
      requires_approval: row.requiresApproval,
      approved_by_user_id: row.approvedByUserId,
      approved_at: row.approvedAt,
      expires_at: row.expiresAt,
      accepted_session_id: toHidden ? null : row.acceptedSessionId,
      accepted_claim_id: toHidden ? null : row.acceptedClaimId,
      from_agent_redacted: fromHidden,
      to_agent_redacted: toHidden,
      receiver_commit_sha: row.receiverCommitSha,
      closed_reason: row.closedReason,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt,
      closed_at: row.closedAt,
    };
  });
}

function offerView(db: Db, reader: AgentReader, row: OfferRow): HandoffOfferView {
  return offerViews(db, reader, [row])[0]!;
}

function reloadOffer(db: Db, id: string): OfferRow {
  return db.select().from(handoffOffers).where(eq(handoffOffers.id, id)).get()!;
}

// ---------------------------------------------------------------- refusals

function notAnAgent(action: string): ApiError {
  return new ApiError('forbidden', 'Only a registered agent does this', {
    action,
    reason: 'not_an_agent',
  });
}

/** One answer for an offer that does not exist and one the caller cannot see. */
function noSuchOffer(): ApiError {
  return ApiError.notFound('No such offer');
}

/**
 * **The person, read again inside the write's transaction** (§4.73: every
 * write "reads everything again from the database — the owner's
 * permission"). The actor a request resolved was loaded before the lock: a
 * person demoted, removed from the space or deactivated since must be refused
 * by what is true now. The credential travels unchanged — an agent's is read
 * again by {@link reloadAgentActor}, and a session has none.
 */
function reloadPerson(db: Db, actor: ResolvedActor): ResolvedActor {
  const now = loadActor(db, actor.userId);
  if (now?.isActive !== true) {
    throw new ApiError('forbidden', 'This account is deactivated', { reason: 'user_inactive' });
  }
  return { ...now, token: actor.token ?? null, claimGeneration: actor.claimGeneration };
}

function conflict(reason: string, message: string, details: Record<string, unknown> = {}) {
  return new ApiError('conflict', message, { reason, ...details });
}

function unprocessable(
  field: string,
  reason: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return new ApiError('unprocessable', message, { field, reason, ...details });
}

function isLive(state: HandoffOfferState): boolean {
  return (LIVE_OFFER_STATES as readonly string[]).includes(state);
}

/** `409 offer_taken` for an accepted offer, `409 offer_closed` for any other closed one. */
function closedRefusal(offer: OfferRow): ApiError {
  if (offer.state === 'accepted') {
    return conflict('offer_taken', 'Another receiver accepted this offer first', {
      offer_id: offer.id,
    });
  }
  return conflict('offer_closed', 'This offer is no longer live', {
    offer_id: offer.id,
    state: offer.state,
  });
}

/**
 * Refuse an offer that is not live **now**: closed, or live but past its
 * `expires_at` while the scan has not caught it yet — it answers as
 * `expired`, and the scan writes it (§11.6).
 */
function assertOfferLive(offer: OfferRow, now: number): void {
  if (!isLive(offer.state)) throw closedRefusal(offer);
  if (offer.expiresAt !== null && offer.expiresAt <= now) {
    throw conflict('offer_closed', 'This offer has expired', {
      offer_id: offer.id,
      state: 'expired',
    });
  }
}

/** The offer and its task and project, when the caller may read the task — else {@link noSuchOffer}. */
function requireVisibleOffer(
  db: Db,
  actor: ResolvedActor,
  offerId: string,
): { offer: OfferRow; task: TaskRow; project: ProjectRow } {
  const offer = db.select().from(handoffOffers).where(eq(handoffOffers.id, offerId)).get();
  const task =
    offer === undefined
      ? undefined
      : db.select().from(tasks).where(eq(tasks.id, offer.taskId)).get();
  const project =
    task === undefined
      ? undefined
      : db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (
    offer === undefined ||
    task === undefined ||
    project === undefined ||
    !can(withProject(actor, project.id), 'project.read', { projectId: project.id })
  ) {
    throw noSuchOffer();
  }
  return { offer, task, project };
}

// -------------------------------------------------------------- eligibility

/** The owner of the agent the work moves from: the sender's, or the expired claim's. */
function ownerOfGeneration(db: Db, taskId: string, generation: number | null): string | null {
  if (generation === null) return null;
  return (
    db
      .select({ ownerUserId: agents.ownerUserId })
      .from(taskClaims)
      .innerJoin(agents, eq(agents.id, taskClaims.agentId))
      .where(and(eq(taskClaims.taskId, taskId), eq(taskClaims.generation, generation)))
      .get()?.ownerUserId ?? null
  );
}

function ownerOfAgent(db: Db, agentId: string | null): string | null {
  if (agentId === null) return null;
  return (
    db.select({ owner: agents.ownerUserId }).from(agents).where(eq(agents.id, agentId)).get()
      ?.owner ?? null
  );
}

/**
 * Everything §4.73's receiver rules read, for any number of agents at once:
 * the agents, their grants, and their owners as `can()` sees them. A fixed
 * number of reads whatever the count (LAI-1009), so the accept route — one
 * agent — and the inbox — a page of them — load it the same way.
 */
interface ReceiverFacts {
  agents: Map<string, { orgId: string; status: string; ownerUserId: string }>;
  /** `${agentId}:${projectId}` → the grant's scope. */
  grants: Map<string, string>;
  owners: Map<string, ResolvedActor>;
}

function loadReceiverFacts(db: Db, agentIds: readonly string[]): ReceiverFacts {
  const ids = [...new Set(agentIds)];
  if (ids.length === 0) return { agents: new Map(), grants: new Map(), owners: new Map() };
  const rows = db
    .select({
      id: agents.id,
      orgId: agents.orgId,
      status: agents.status,
      ownerUserId: agents.ownerUserId,
    })
    .from(agents)
    .where(inArray(agents.id, ids))
    .all();
  const grants = db
    .select({
      agentId: agentProjectGrants.agentId,
      projectId: agentProjectGrants.projectId,
      scope: agentProjectGrants.scope,
    })
    .from(agentProjectGrants)
    .where(inArray(agentProjectGrants.agentId, ids))
    .all();
  return {
    agents: new Map(rows.map((r) => [r.id, r])),
    grants: new Map(grants.map((g) => [`${g.agentId}:${g.projectId}`, g.scope])),
    owners: loadActors(
      db,
      rows.map((r) => r.ownerUserId),
    ),
  };
}

/**
 * **Who may receive** (§4.73) — the rule itself, reading only `facts`: an
 * active agent of this organisation with a `full` grant on the project, whose
 * owner is active and may accept there, in a space that lets agents write —
 * and, unless the policy has `allow_other_owners`, an agent of **the same
 * owner** as the agent the work moves from. Answers whether the transfer then
 * waits for an approver, or `null` where it may not receive at all.
 *
 * The one rule: {@link receiverEligibility} (the writes) and the inbox's
 * `next_action` both ask it, so a hint cannot promise what the accept refuses.
 */
function receiverRule(
  facts: ReceiverFacts,
  project: ProjectRow,
  policy: HandoffPolicyView,
  agentId: string,
  fromOwnerId: string | null,
): { ownerUserId: string; requiresApproval: boolean } | null {
  const agent = facts.agents.get(agentId);
  if (agent?.orgId !== project.orgId || agent.status !== 'active') return null;
  if (facts.grants.get(`${agentId}:${project.id}`) !== 'full' || !project.agentsAllowed) {
    return null;
  }
  const owner = facts.owners.get(agent.ownerUserId);
  if (
    owner?.isActive !== true ||
    !can(withProject(owner, project.id), 'task.handoff.accept', { projectId: project.id })
  ) {
    return null;
  }
  const otherOwner = fromOwnerId !== null && fromOwnerId !== agent.ownerUserId;
  if (otherOwner && !policy.allow_other_owners) return null;
  return {
    ownerUserId: agent.ownerUserId,
    requiresApproval: otherOwner && policy.cross_owner_requires_approval,
  };
}

/**
 * {@link receiverRule} for one agent, as a write asks it: every refusal is the
 * one `422 receiver_not_eligible`, whichever check failed — an agent id that
 * names nothing included — so the answer names no more than the caller sent.
 */
function receiverEligibility(
  db: Db,
  project: ProjectRow,
  policy: HandoffPolicyView,
  agentId: string,
  fromOwnerId: string | null,
): { ownerUserId: string; requiresApproval: boolean } {
  const answer = receiverRule(
    loadReceiverFacts(db, [agentId]),
    project,
    policy,
    agentId,
    fromOwnerId,
  );
  if (answer === null) {
    throw unprocessable(
      'to_agent_id',
      'receiver_not_eligible',
      'That agent may not receive this task: it must be active, granted full access here, and — unless the space allows other owners — the same owner’s',
      { to_agent_id: agentId },
    );
  }
  return answer;
}

/** SHA-256 of the note as offered, so a receiver can tell it is the same note. */
function noteHash(summary: unknown): string | null {
  if (summary === null || summary === undefined) return null;
  return createHash('sha256').update(JSON.stringify(summary)).digest('hex');
}

// ------------------------------------------------------------ the sender

/**
 * A live offer closed **unaccepted** — declined, cancelled, expired, or closed
 * by a reclaim, a revoke or the task closing. The sender's claim, if it is
 * still `paused`, is `active` again (§4.73); a claim that lapsed meanwhile
 * stays `expired`, and the task then gets its recovery offer as any expiry
 * does (§11.6) — in this same transaction.
 */
function afterOfferClosedUnaccepted(db: Db, offer: OfferRow, now: number): void {
  const paused = pausedSender(db, offer);
  if (paused !== undefined) {
    // **An elapsed lease is not resumed** (LAI-546 review): the sender stopped
    // renewing while its offer was live, so the claim expires here — with its
    // `task.claim_expired` row, as the scan would have written it — rather
    // than coming back `active` on a lease nobody holds.
    if (leaseLapsed(paused.leaseExpiresAt, now)) expireClaim(db, paused, now);
    else db.update(taskClaims).set({ state: 'active' }).where(eq(taskClaims.id, paused.id)).run();
  }
  openRecoveryIfDue(db, offer.taskId, now);
}

/** A hand-off's sender claim while it is still `paused`, or undefined. */
function pausedSender(db: Db, offer: OfferRow) {
  if (offer.kind !== 'handoff' || offer.fromClaimGeneration === null) return undefined;
  return db
    .select()
    .from(taskClaims)
    .where(
      and(
        eq(taskClaims.taskId, offer.taskId),
        eq(taskClaims.generation, offer.fromClaimGeneration),
        eq(taskClaims.state, 'paused'),
      ),
    )
    .get();
}

/** Close one live offer: the state, `closed_at`, and the reason when it is not the receiver's or the clock's. */
function closeOffer(
  db: Db,
  offer: OfferRow,
  state: 'declined' | 'cancelled' | 'expired',
  closedReason: HandoffClosedReason | null,
  now: number,
): boolean {
  const changed = db
    .update(handoffOffers)
    .set({ state, closedReason, closedAt: now })
    .where(
      and(eq(handoffOffers.id, offer.id), inArray(handoffOffers.state, [...LIVE_OFFER_STATES])),
    )
    .run().changes;
  return changed > 0;
}

type Principal = ResolvedActor | ReturnType<typeof systemPrincipal>;

function orgOfTask(db: Db, taskId: string): { orgId: string; projectId: string } {
  return db
    .select({ orgId: projects.orgId, projectId: tasks.projectId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId))
    .get()!;
}

/**
 * Close every live hand-off and recovery offer on a task with `closedReason`,
 * one `task.handoff_cancelled` row each — a reclaim (§9.1.1), the task
 * leaving progress (`task_closed`). The caller replaces the claim itself —
 * the reclaim inserts a new one, the task closing releases it — so neither
 * the paused claim nor a recovery is touched here.
 */
export function closeLiveOffersOfTask(
  db: Db,
  taskId: string,
  closedReason: 'reclaimed' | 'task_closed',
  by: Principal,
  now: number,
): number {
  const live = db
    .select()
    .from(handoffOffers)
    .where(
      and(
        eq(handoffOffers.taskId, taskId),
        inArray(handoffOffers.kind, ['handoff', 'recovery']),
        inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
      ),
    )
    .all();
  if (live.length === 0) return 0;
  const where = orgOfTask(db, taskId);
  for (const offer of live) {
    if (!closeOffer(db, offer, 'cancelled', closedReason, now)) continue;
    appendActivity(db, {
      orgId: where.orgId,
      projectId: where.projectId,
      taskId,
      ...activityActor(by),
      type: 'task.handoff_cancelled',
      payload: { offer_id: offer.id, closed_reason: closedReason },
      now,
    });
  }
  return live.length;
}

/**
 * Revoking an agent closes its live offers `agent_revoked` (§4.73) — the ones
 * offered **to** it and the ones its sessions **sent** — as the system, in
 * the revoke's transaction. The sender's paused claim resumes, so it lapses
 * and recovers like any other claim of a revoked agent (LAI-541).
 */
export function closeOffersOfRevokedAgent(db: Db, agentId: string, now: number): void {
  const sentBy = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(eq(agentSessions.agentId, agentId));
  const live = db
    .select()
    .from(handoffOffers)
    .where(
      and(
        inArray(handoffOffers.kind, ['handoff', 'recovery']),
        inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
        or(eq(handoffOffers.toAgentId, agentId), inArray(handoffOffers.fromSessionId, sentBy)),
      ),
    )
    .all();
  const system = systemPrincipal();
  for (const offer of live) {
    if (!closeOffer(db, offer, 'cancelled', 'agent_revoked', now)) continue;
    const where = orgOfTask(db, offer.taskId);
    appendActivity(db, {
      orgId: where.orgId,
      projectId: where.projectId,
      taskId: offer.taskId,
      ...activityActor(system),
      type: 'task.handoff_cancelled',
      payload: { offer_id: offer.id, closed_reason: 'agent_revoked' },
      now,
    });
    afterOfferClosedUnaccepted(db, offer, now);
  }
}

// ---------------------------------------------------------------- recovery

/** The task's latest `verified` checkpoint, newest by `created_at`. */
function latestVerifiedCheckpoint(db: Db, taskId: string) {
  return db
    .select()
    .from(taskCheckpoints)
    .where(and(eq(taskCheckpoints.taskId, taskId), eq(taskCheckpoints.verification, 'verified')))
    .orderBy(desc(taskCheckpoints.createdAt), desc(taskCheckpoints.id))
    .limit(1)
    .get();
}

/** The person behind a recovery (§4.73): the task's assignee, else the project's first lead. */
function recoveryCreator(db: Db, task: TaskRow, expiredAgentId: string): string {
  if (task.assigneeId !== null) return task.assigneeId;
  const lead = db
    .select({ userId: projectMemberships.userId })
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, task.projectId), eq(projectMemberships.role, 'lead')),
    )
    .orderBy(asc(projectMemberships.createdAt))
    .limit(1)
    .get();
  if (lead !== undefined) return lead.userId;
  // A space with no lead at all: the person whose agent's claim expired.
  return ownerOfAgent(db, expiredAgentId)!;
}

/**
 * **Recovery is part of every expiry** (§11.6, §3.4 `system.handoff.recover`):
 * called in the transaction that marks a claim `expired` — the scan's or a
 * late heartbeat's — and in the one that closes a live offer unaccepted. A
 * task still in progress whose newest claim is `expired`, with a `verified`
 * checkpoint and **no live hand-off or recovery offer**, gets one recovery
 * offer, unnamed, from the **latest verified** checkpoint — a newer one still
 * `pending` is passed over — and one `task.recovered` row. **Offered, never
 * assigned.** No verified checkpoint, no offer: the task shows *Automatic
 * recovery unavailable* and a person decides.
 */
export function openRecoveryIfDue(db: Db, taskId: string, now: number): HandoffOfferView | null {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (task?.status !== 'in_progress') return null;
  const newest = latestClaim(db, taskId);
  if (newest?.state !== 'expired') return null;
  const live = db
    .select({ id: handoffOffers.id })
    .from(handoffOffers)
    .where(
      and(
        eq(handoffOffers.taskId, taskId),
        inArray(handoffOffers.kind, ['handoff', 'recovery']),
        inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
      ),
    )
    .get();
  if (live !== undefined) return null;
  const checkpoint = latestVerifiedCheckpoint(db, taskId);
  if (checkpoint === undefined) return null;

  const system = systemPrincipal(task.projectId);
  assertCan(system, 'system.handoff.recover');
  const policy = readPolicy(db, task.projectId);
  const row: OfferRow = {
    id: newId(),
    taskId,
    kind: 'recovery',
    idempotencyKey: null,
    fromSessionId: null,
    fromClaimGeneration: newest.generation,
    toAgentId: null,
    checkpointId: checkpoint.id,
    checkpointCommitSha: checkpoint.commitSha,
    reason: null,
    noteHash: noteHash(checkpoint.summary),
    requiresApproval: false,
    approvedByUserId: null,
    approvedAt: null,
    state: 'open',
    expiresAt: now + policy.offer_ttl_minutes * 60_000,
    acceptedSessionId: null,
    acceptedClaimId: null,
    receiverCommitSha: null,
    closedReason: null,
    createdByUserId: recoveryCreator(db, task, newest.agentId),
    createdAt: now,
    closedAt: null,
  };
  db.insert(handoffOffers).values(row).run();
  const where = orgOfTask(db, taskId);
  appendActivity(db, {
    orgId: where.orgId,
    projectId: where.projectId,
    taskId,
    ...activityActor(system),
    type: 'task.recovered',
    payload: {
      offer_id: row.id,
      checkpoint_id: checkpoint.id,
      commit_sha: checkpoint.commitSha,
      from_generation: newest.generation,
    },
    now,
  });
  // Its callers serve nothing from it, so it names no agent (`null` reader).
  return offerView(db, null, row);
}

/**
 * §11.6's offer expiry, on the claim scan's schedule, under
 * `system.handoff.expire`: each live hand-off or recovery past `expires_at`
 * becomes `expired`, one `task.handoff_expired` row each, a claim it paused
 * resumes — and, where the task's newest claim is still `expired`, a fresh
 * recovery replaces it. One transaction an offer: its state, its row and the
 * recovery land together or not at all.
 */
export function expireOffers(db: Db, now: number): { changed: number } {
  assertCan(systemPrincipal(), 'system.handoff.expire');
  const overdue = db
    .select()
    .from(handoffOffers)
    .where(
      and(
        inArray(handoffOffers.kind, ['handoff', 'recovery']),
        inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
        lte(handoffOffers.expiresAt, now),
      ),
    )
    .all();

  let changed = 0;
  for (const offer of overdue) {
    db.transaction(
      () => {
        if (!closeOffer(db, offer, 'expired', null, now)) return;
        changed += 1;
        const where = orgOfTask(db, offer.taskId);
        appendActivity(db, {
          orgId: where.orgId,
          projectId: where.projectId,
          taskId: offer.taskId,
          ...activityActor(systemPrincipal()),
          type: 'task.handoff_expired',
          payload: { offer_id: offer.id, expires_at: offer.expiresAt },
          now,
        });
        afterOfferClosedUnaccepted(db, offer, now);
      },
      { behavior: 'immediate' },
    );
  }
  return { changed };
}

/**
 * The reclaim's offer steps (§9.1.1), inside its transaction, **before** the
 * new claim: refuse `409 offer_taken` when a hand-off or recovery offer moving
 * on from **the generation being reclaimed** was accepted — a work request
 * never counts, and an older generation's accepted hand-off is history —
 * and otherwise cancel every live hand-off and recovery offer, `reclaimed`.
 */
export function assertNoAcceptedOfferFrom(db: Db, taskId: string, generation: number): void {
  const taken = db
    .select({ id: handoffOffers.id })
    .from(handoffOffers)
    .where(
      and(
        eq(handoffOffers.taskId, taskId),
        inArray(handoffOffers.kind, ['handoff', 'recovery']),
        eq(handoffOffers.state, 'accepted'),
        eq(handoffOffers.fromClaimGeneration, generation),
      ),
    )
    .get();
  if (taken !== undefined) {
    throw conflict('offer_taken', 'Somebody accepted this task’s offer; it is theirs now', {
      task_id: taskId,
      offer_id: taken.id,
      from_generation: generation,
    });
  }
}

// ------------------------------------------------------------------ offer

export interface OfferHandoffInput {
  idempotencyKey: string;
  toAgentId: string;
  checkpointId?: string | null | undefined;
  reason: string;
  now?: number;
}

export interface OfferedHandoff {
  offer: HandoffOfferView;
  /** `false` when the key was offered already and this is that offer. */
  created: boolean;
}

/** Whether a retried offer carries the body the first one did (§4.73). */
function sameOffer(
  row: OfferRow,
  taskId: string,
  agentId: string,
  db: Db,
  input: OfferHandoffInput,
) {
  const fromAgent =
    row.fromSessionId === null
      ? null
      : db
          .select({ agentId: agentSessions.agentId })
          .from(agentSessions)
          .where(eq(agentSessions.id, row.fromSessionId))
          .get()?.agentId;
  return (
    row.kind === 'handoff' &&
    row.taskId === taskId &&
    fromAgent === agentId &&
    row.toAgentId === input.toAgentId &&
    row.checkpointId === (input.checkpointId ?? null) &&
    row.reason === input.reason.trim()
  );
}

/**
 * `POST /tasks/:id/handoff-offers`, `offer_handoff` (§4.73, §6.4): the
 * session holding the task's **live, `active`** claim offers it to a named
 * agent, from a `verified` checkpoint of this task saved under that claim's
 * generation, with a reason. Its claim is **paused** in the same transaction.
 *
 * A retry with the same `idempotency_key` and the same body answers the offer
 * already made (`created: false`) — matched after the caller's own checks and
 * **before** the fence, which the first attempt has just paused.
 */
export function offerHandoff(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  input: OfferHandoffInput,
): OfferedHandoff {
  const now = input.now ?? Date.now();
  const agent = registeredAgent(actor);
  if (agent === null) throw notAnAgent('task.handoff.offer');

  const key = input.idempotencyKey.trim();
  if (key === '' || key.length > HANDOFF_LIMITS.idempotencyKey) {
    throw new ApiError('unprocessable', 'An idempotency key is 1–200 characters', {
      field: 'idempotency_key',
    });
  }
  const reason = input.reason.trim();
  if (reason === '' || reason.length > HANDOFF_LIMITS.reason) {
    throw new ApiError('unprocessable', 'A hand-off needs a reason of at most 500 characters', {
      field: 'reason',
    });
  }
  spendOfferToken(agent.id, now);

  return immediateTransaction(sqlite, () => {
    const fresh = {
      ...reloadAgentActor(db, actor, now, 'task.handoff.offer'),
      claimGeneration: actor.claimGeneration,
    };
    const { task, project } = requireVisibleTaskToClaim(db, fresh, taskId);
    assertCan(withProject(fresh, project.id), 'task.handoff.offer', { projectId: project.id });

    const seen = db.select().from(handoffOffers).where(eq(handoffOffers.idempotencyKey, key)).get();
    if (seen !== undefined) {
      if (!sameOffer(seen, taskId, agent.id, db, { ...input, reason })) {
        throw new ApiError('conflict', 'That idempotency key was used with a different body', {
          reason: 'idempotency_key_reused',
          field: 'idempotency_key',
        });
      }
      return { offer: offerView(db, agentReader(actor), seen), created: false };
    }

    // The fence (§6.3): a paused, stale or other session's offer is refused.
    const refusal = claimFenceRefusal(db, fresh, taskId, now);
    if (refusal !== null) throw refusal;
    const live = liveClaim(db, taskId);
    if (live?.agentId !== agent.id || live.state !== 'active') {
      throw conflict('stale_claim', 'Offering a task needs its live claim', {
        task_id: taskId,
        claim_generation: fresh.claimGeneration ?? null,
      });
    }

    const existing = db
      .select({ id: handoffOffers.id })
      .from(handoffOffers)
      .where(
        and(
          eq(handoffOffers.taskId, taskId),
          inArray(handoffOffers.kind, ['handoff', 'recovery']),
          inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
        ),
      )
      .get();
    if (existing !== undefined) {
      throw conflict('offer_live', 'This task already has a live hand-off offer', {
        task_id: taskId,
        offer_id: existing.id,
      });
    }

    const checkpointId = input.checkpointId?.trim() ?? '';
    if (checkpointId === '') {
      throw unprocessable('checkpoint_id', 'checkpoint_required', 'A hand-off needs a checkpoint');
    }
    const checkpoint = db
      .select()
      .from(taskCheckpoints)
      .where(eq(taskCheckpoints.id, checkpointId))
      .get();
    if (checkpoint?.taskId !== taskId || checkpoint.claimGeneration !== live.generation) {
      throw unprocessable(
        'checkpoint_id',
        'checkpoint_not_this_claim',
        'Offer a checkpoint of this task saved under your live claim',
        { checkpoint_id: checkpointId },
      );
    }
    if (checkpoint.verification !== 'verified') {
      throw conflict('checkpoint_unverified', 'That checkpoint is not verified', {
        checkpoint_id: checkpoint.id,
        verification: checkpoint.verification,
      });
    }

    const policy = readPolicy(db, project.id);
    const receiver = receiverEligibility(db, project, policy, input.toAgentId, fresh.userId);
    // Refused at the offer as well as at the accept: an offer that can never
    // be accepted would only pause the sender for nothing.
    if (task.handoffCount >= policy.max_handoffs) {
      throw conflict('handoff_limit', 'This task has had as many hand-offs as the space allows', {
        task_id: taskId,
        handoff_count: task.handoffCount,
        max_handoffs: policy.max_handoffs,
      });
    }

    const row: OfferRow = {
      id: newId(),
      taskId,
      kind: 'handoff',
      idempotencyKey: key,
      fromSessionId: live.sessionId,
      fromClaimGeneration: live.generation,
      toAgentId: input.toAgentId,
      checkpointId: checkpoint.id,
      checkpointCommitSha: checkpoint.commitSha,
      reason,
      noteHash: noteHash(checkpoint.summary),
      requiresApproval: receiver.requiresApproval,
      approvedByUserId: null,
      approvedAt: null,
      state: receiver.requiresApproval ? 'pending_approval' : 'open',
      expiresAt: now + policy.offer_ttl_minutes * 60_000,
      acceptedSessionId: null,
      acceptedClaimId: null,
      receiverCommitSha: null,
      closedReason: null,
      createdByUserId: fresh.userId,
      createdAt: now,
      closedAt: null,
    };
    db.insert(handoffOffers).values(row).run();
    db.update(taskClaims).set({ state: 'paused' }).where(eq(taskClaims.id, live.id)).run();

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(fresh),
      agentSessionId: live.sessionId,
      type: 'task.handoff_offered',
      payload: {
        offer_id: row.id,
        kind: 'handoff',
        to_agent_id: row.toAgentId,
        checkpoint_id: checkpoint.id,
        commit_sha: checkpoint.commitSha,
        requires_approval: row.requiresApproval,
        expires_at: row.expiresAt,
        from_generation: live.generation,
      },
      now,
    });
    return { offer: offerView(db, agentReader(actor), row), created: true };
  });
}

// ---------------------------------------------------------------- approve

/**
 * `POST /handoff-offers/:id/approve` (§4.73, §6.4): a person, signed in —
 * the task's assignee or a lead, **never the owner of the receiving agent**
 * (`403 approver_is_receiver`). A named offer `pending_approval` becomes
 * `open`. An unnamed recovery is named and approved in one step with
 * `to_agent_id`, which the approver may not own either. Approving writes
 * `task.handoff_approved`; approving an open named offer again changes
 * nothing.
 */
export function approveHandoff(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  offerId: string,
  input: { toAgentId?: string | null | undefined; now?: number } = {},
): HandoffOfferView {
  const now = input.now ?? Date.now();
  return immediateTransaction(sqlite, () => {
    const person = reloadPerson(db, actor);
    const { offer, task, project } = requireVisibleOffer(db, person, offerId);
    assertCan(withProject(person, project.id), 'task.handoff.approve', {
      projectId: project.id,
      ownerId: task.assigneeId,
    });
    if (offer.kind === 'work_request') throw workRequestRefusal(offer);
    assertOfferLive(offer, now);

    const toAgentId = input.toAgentId ?? null;
    if (offer.toAgentId === null) {
      if (toAgentId === null) {
        throw unprocessable(
          'to_agent_id',
          'receiver_not_eligible',
          'An unnamed recovery is approved by naming its receiver',
        );
      }
      const policy = readPolicy(db, project.id);
      const fromOwner = ownerOfGeneration(db, task.id, offer.fromClaimGeneration);
      const receiver = receiverEligibility(db, project, policy, toAgentId, fromOwner);
      if (receiver.ownerUserId === person.userId) throw approverIsReceiver(offer);
      db.update(handoffOffers)
        .set({
          toAgentId,
          requiresApproval: receiver.requiresApproval,
          approvedByUserId: person.userId,
          approvedAt: now,
          state: 'open',
        })
        .where(eq(handoffOffers.id, offer.id))
        .run();
      appendApproved(db, person, project, task.id, offer.id, toAgentId, true, now);
      return offerView(db, agentReader(actor), reloadOffer(db, offer.id));
    }

    if (toAgentId !== null && toAgentId !== offer.toAgentId) {
      throw unprocessable(
        'to_agent_id',
        'receiver_not_eligible',
        'This offer already names its receiver',
        { to_agent_id: toAgentId },
      );
    }
    if (ownerOfAgent(db, offer.toAgentId) === person.userId) throw approverIsReceiver(offer);
    if (offer.state !== 'pending_approval') return offerView(db, agentReader(actor), offer);

    db.update(handoffOffers)
      .set({ approvedByUserId: person.userId, approvedAt: now, state: 'open' })
      .where(eq(handoffOffers.id, offer.id))
      .run();
    appendApproved(db, person, project, task.id, offer.id, offer.toAgentId, false, now);
    return offerView(db, agentReader(actor), reloadOffer(db, offer.id));
  });
}

function approverIsReceiver(offer: OfferRow): ApiError {
  return new ApiError('forbidden', 'You own the receiving agent; another person approves', {
    action: 'task.handoff.approve',
    reason: 'approver_is_receiver',
    offer_id: offer.id,
  });
}

function appendApproved(
  db: Db,
  actor: ResolvedActor,
  project: ProjectRow,
  taskId: string,
  offerId: string,
  toAgentId: string,
  named: boolean,
  now: number,
): void {
  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    ...activityActor(actor),
    type: 'task.handoff_approved',
    payload: { offer_id: offerId, to_agent_id: toAgentId, named },
    now,
  });
}

/** A work request is answered by claiming it (`start_working`) and withdrawn by the selection, not here. */
function workRequestRefusal(offer: OfferRow): ApiError {
  return unprocessable(
    'offer',
    'work_request',
    'A work request is accepted by claiming the task and withdrawn by changing its agent',
    { offer_id: offer.id },
  );
}

// ----------------------------------------------------------------- accept

export interface AcceptHandoffInput {
  verifiedCommitSha: string;
  sessionId?: string | undefined;
  now?: number;
}

export interface AcceptedHandoff {
  offer: HandoffOfferView;
  claim: TaskClaimView;
  session: AgentSessionView;
}

/** Whether the calling agent is the offer's receiver, or may take an unnamed recovery. */
function addressedTo(offer: OfferRow, agentId: string): boolean {
  return offer.toAgentId === agentId || (offer.toAgentId === null && offer.kind === 'recovery');
}

/**
 * `POST /handoff-offers/:id/accept`, `respond_handoff` `accept` (§4.73): the
 * receiving agent's session, with `verified_commit_sha`. Everything is asked
 * again inside the transaction — the receiver's token, agent and owner, the
 * owner's permission and the agent's grant, the approval, the expiry, the
 * policy's `max_handoffs`, that the checkpoint is **still `verified`** and
 * that the SHA is its commit — and then the claim moves:
 *
 * - a hand-off's sender claim, still `paused`, becomes `transferred`; an
 *   expired one stays `expired`;
 * - a new claim for the receiver's session at the next generation;
 * - `tasks.selected_agent_id` becomes the receiver (D-119), with its own
 *   `task.agent_selected`, and the old selection's open work request closes;
 * - `tasks.handoff_count` + 1, the offer `accepted`, `task.handoff_accepted`.
 *
 * **Two receivers: the first commit wins**, the second is `409 offer_taken`.
 * The same agent asking again after its accept answers that accept — a lost
 * answer is found, not refused. `assignee_id` never moves.
 */
export function acceptHandoff(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  offerId: string,
  input: AcceptHandoffInput,
): AcceptedHandoff {
  const now = input.now ?? Date.now();
  const agent = registeredAgent(actor);
  if (agent === null) throw notAnAgent('task.handoff.accept');
  spendOfferToken(agent.id, now);

  return immediateTransaction(sqlite, () => {
    const fresh = reloadAgentActor(db, actor, now, 'task.handoff.accept');
    const { offer, task, project } = requireVisibleOffer(db, fresh, offerId);
    assertCan(withProject(fresh, project.id), 'task.handoff.accept', { projectId: project.id });
    if (offer.kind === 'work_request') throw workRequestRefusal(offer);

    // A replay of this agent's own accept, before any other check: the
    // answer it lost, not a refusal.
    if (offer.state === 'accepted' && offer.acceptedClaimId !== null) {
      const claim = db
        .select()
        .from(taskClaims)
        .where(eq(taskClaims.id, offer.acceptedClaimId))
        .get();
      if (
        claim?.agentId === agent.id &&
        offer.receiverCommitSha === input.verifiedCommitSha.trim().toLowerCase()
      ) {
        const session = db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.id, claim.sessionId))
          .get()!;
        return {
          offer: offerView(db, agentReader(actor), offer),
          claim: claimView(claim),
          session: sessionView(session, now),
        };
      }
    }
    // Closed before addressed: an unnamed recovery names its receiver when it
    // is accepted, and the agent that lost the race must hear `offer_taken`.
    assertOfferLive(offer, now);
    if (!addressedTo(offer, agent.id)) throw notTheReceiver(offer);
    if (offer.state === 'pending_approval') {
      throw conflict('approval_pending', 'This offer is waiting for a person to approve it', {
        offer_id: offer.id,
      });
    }

    const policy = readPolicy(db, project.id);
    const fromOwner = ownerOfGeneration(db, task.id, offer.fromClaimGeneration);
    const receiver = receiverEligibility(db, project, policy, agent.id, fromOwner);
    if (offer.toAgentId === null && receiver.requiresApproval) {
      throw conflict(
        'approval_pending',
        'Another owner’s agent takes this recovery only when a person names and approves it',
        { offer_id: offer.id },
      );
    }
    if (task.status !== 'in_progress') {
      throw conflict('offer_closed', 'This task is no longer in progress', {
        offer_id: offer.id,
        state: offer.state,
      });
    }
    if (task.handoffCount >= policy.max_handoffs) {
      throw conflict('handoff_limit', 'This task has had as many hand-offs as the space allows', {
        task_id: task.id,
        handoff_count: task.handoffCount,
        max_handoffs: policy.max_handoffs,
      });
    }
    if (offer.checkpointId === null) {
      throw conflict('checkpoint_unverified', 'This offer’s checkpoint no longer exists', {
        offer_id: offer.id,
        verification: null,
      });
    }
    assertCheckpointAcceptable(db, offer.checkpointId, input.verifiedCommitSha);

    // The claim the work moves from. A paused sender's is transferred; an
    // expired one — a recovery's, or a sender that lapsed — stays expired.
    const from =
      offer.fromClaimGeneration === null
        ? undefined
        : db
            .select()
            .from(taskClaims)
            .where(
              and(
                eq(taskClaims.taskId, task.id),
                eq(taskClaims.generation, offer.fromClaimGeneration),
              ),
            )
            .get();
    let fromState = from?.state ?? 'expired';
    // A paused sender whose lease elapsed before the scan noticed: its expiry
    // is history and is recorded first (`task.claim_expired`), then the
    // receiver takes the task from an expired claim (LAI-546 review). The
    // offer is still live here, so no recovery opens beside it.
    if (from?.state === 'paused' && leaseLapsed(from.leaseExpiresAt, now)) {
      expireClaim(db, from, now);
      fromState = 'expired';
    } else if (from?.state === 'paused') {
      db.update(taskClaims)
        .set({ state: 'transferred', endedAt: now })
        .where(eq(taskClaims.id, from.id))
        .run();
      fromState = 'transferred';
    }
    const other = liveClaim(db, task.id);
    if (other !== undefined) {
      // Nothing makes this — a reclaim cancels live offers — but a second
      // live claim is the one state the partial index forbids; say so.
      throw conflict('claim_held', 'Another session holds this task', {
        task_id: task.id,
        agent_id: other.agentId,
      });
    }

    const session =
      input.sessionId === undefined
        ? openSession(db, fresh, fresh.token.agent, {}, now)
        : requireOpenSession(db, agent.id, input.sessionId);
    const claim = insertClaim(db, task.id, session.id, agent.id, now);

    const sha = input.verifiedCommitSha.trim().toLowerCase();
    db.update(handoffOffers)
      .set({
        state: 'accepted',
        acceptedSessionId: session.id,
        acceptedClaimId: claim.id,
        receiverCommitSha: sha,
        toAgentId: offer.toAgentId ?? agent.id,
        closedAt: now,
      })
      .where(eq(handoffOffers.id, offer.id))
      .run();

    const handoffCount = task.handoffCount + 1;
    db.update(tasks)
      .set({ handoffCount, selectedAgentId: agent.id, updatedAt: now })
      .where(eq(tasks.id, task.id))
      .run();
    // D-119: the receiver's claim is backed by the selection. The old
    // selection's open work request closes; the receiver's own, if any, is
    // answered by this claim.
    db.update(handoffOffers)
      .set({ state: 'cancelled', closedReason: 'selection_changed', closedAt: now })
      .where(
        and(
          eq(handoffOffers.taskId, task.id),
          eq(handoffOffers.kind, 'work_request'),
          eq(handoffOffers.state, 'open'),
          sql`${handoffOffers.toAgentId} IS NOT ${agent.id}`,
        ),
      )
      .run();
    db.update(handoffOffers)
      .set({ state: 'accepted', closedAt: now })
      .where(
        and(
          eq(handoffOffers.taskId, task.id),
          eq(handoffOffers.kind, 'work_request'),
          eq(handoffOffers.state, 'open'),
          eq(handoffOffers.toAgentId, agent.id),
        ),
      )
      .run();

    if (task.selectedAgentId !== agent.id) {
      appendActivity(db, {
        orgId: project.orgId,
        projectId: project.id,
        taskId: task.id,
        ...activityActor(fresh),
        agentSessionId: session.id,
        type: 'task.agent_selected',
        payload: { from: task.selectedAgentId, to: agent.id },
        now,
      });
    }
    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId: task.id,
      ...activityActor(fresh),
      agentSessionId: session.id,
      type: 'task.handoff_accepted',
      payload: {
        offer_id: offer.id,
        kind: offer.kind,
        checkpoint_id: offer.checkpointId,
        receiver_commit_sha: sha,
        from_generation: offer.fromClaimGeneration,
        from_claim_state: fromState,
        generation: claim.generation,
        claim_id: claim.id,
        session_id: session.id,
        agent_id: agent.id,
        handoff_count: handoffCount,
      },
      now,
    });

    return {
      offer: offerView(db, agentReader(actor), reloadOffer(db, offer.id)),
      claim: claimView(claim),
      session: sessionView(session, now),
    };
  });
}

function notTheReceiver(offer: OfferRow): ApiError {
  return new ApiError('forbidden', 'This offer is addressed to another agent', {
    action: 'task.handoff.accept',
    reason: 'not_the_receiver',
    offer_id: offer.id,
  });
}

// ---------------------------------------------------------------- decline

/**
 * `POST /handoff-offers/:id/decline`, `respond_handoff` `decline` (§4.73):
 * the named receiver says no. The sender's claim resumes if it is still
 * paused; a claim that lapsed meanwhile stays expired and the task gets its
 * recovery offer here. **An unnamed recovery cannot be declined** — an agent
 * that does not want it simply does not accept.
 */
export function declineHandoff(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  offerId: string,
  input: { reason?: string | null | undefined; now?: number } = {},
): HandoffOfferView {
  const now = input.now ?? Date.now();
  const agent = registeredAgent(actor);
  if (agent === null) throw notAnAgent('task.handoff.decline');
  const reason = input.reason?.trim() ?? '';
  if (reason.length > HANDOFF_LIMITS.declineReason) {
    throw new ApiError('unprocessable', 'A reason is at most 500 characters', { field: 'reason' });
  }
  spendOfferToken(agent.id, now);

  return immediateTransaction(sqlite, () => {
    const fresh = reloadAgentActor(db, actor, now, 'task.handoff.decline');
    const { offer, task, project } = requireVisibleOffer(db, fresh, offerId);
    assertCan(withProject(fresh, project.id), 'task.handoff.decline', { projectId: project.id });
    if (offer.kind === 'work_request') throw workRequestRefusal(offer);
    if (offer.toAgentId === null) {
      throw unprocessable(
        'offer',
        'recovery_unnamed',
        'An unnamed recovery is not declined; an agent that does not want it does not accept it',
        { offer_id: offer.id },
      );
    }
    if (offer.toAgentId !== agent.id) throw notTheReceiver(offer);
    assertOfferLive(offer, now);

    closeOffer(db, offer, 'declined', null, now);
    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId: task.id,
      ...activityActor(fresh),
      type: 'task.handoff_declined',
      payload: { offer_id: offer.id, reason: reason === '' ? null : reason },
      now,
    });
    afterOfferClosedUnaccepted(db, offer, now);
    return offerView(db, agentReader(actor), reloadOffer(db, offer.id));
  });
}

// ----------------------------------------------------------------- cancel

/**
 * `POST /handoff-offers/:id/cancel`, `respond_handoff` `cancel` (§3.2,
 * §4.73): the sender — any of its owner's credentials — the task's assignee,
 * or a lead closes a live offer, `withdrawn`. The sender's claim resumes if
 * it is still paused; a lapsed one stays expired and the task gets its
 * recovery offer here.
 */
export function cancelHandoff(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  offerId: string,
  now = Date.now(),
): HandoffOfferView {
  const agent = registeredAgent(actor);
  if (agent !== null) spendOfferToken(agent.id, now);

  return immediateTransaction(sqlite, () => {
    // An agent's credentials are read again, as every hand-off write's are.
    const caller =
      agent === null
        ? reloadPerson(db, actor)
        : reloadAgentActor(db, actor, now, 'task.handoff.cancel');
    const { offer, task, project } = requireVisibleOffer(db, caller, offerId);
    if (offer.kind === 'work_request') throw workRequestRefusal(offer);

    // `ownerId` is the sending agent's owner (§3.2 *own agent's*). §4.73 also
    // lets the task's assignee cancel, so for them the row is asked as theirs.
    const senderOwner = ownerOfGeneration(db, task.id, offer.fromClaimGeneration);
    const ownerId =
      offer.kind === 'handoff' && senderOwner === caller.userId
        ? senderOwner
        : task.assigneeId === caller.userId
          ? caller.userId
          : (senderOwner ?? undefined);
    assertCan(withProject(caller, project.id), 'task.handoff.cancel', {
      projectId: project.id,
      ownerId,
    });
    assertOfferLive(offer, now);

    closeOffer(db, offer, 'cancelled', 'withdrawn', now);
    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId: task.id,
      ...activityActor(caller),
      type: 'task.handoff_cancelled',
      payload: { offer_id: offer.id, closed_reason: 'withdrawn' },
      now,
    });
    afterOfferClosedUnaccepted(db, offer, now);
    return offerView(db, agentReader(actor), reloadOffer(db, offer.id));
  });
}

// ---------------------------------------------------------------- reading

/** `GET /tasks/:id/handoff-offers` (§6.4): every offer on the task, newest first, under *Read tasks*. */
export function listTaskOffers(db: Db, actor: ResolvedActor, taskId: string): HandoffOfferView[] {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (
    task === undefined ||
    !can(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId })
  ) {
    throw ApiError.notFound(`No task with id "${taskId}"`);
  }
  return offerViews(
    db,
    agentReader(actor),
    db
      .select()
      .from(handoffOffers)
      .where(eq(handoffOffers.taskId, taskId))
      .orderBy(desc(handoffOffers.createdAt), desc(handoffOffers.id))
      .all(),
  );
}

export type InboxItem = (
  | WorkRequestView
  | (HandoffOfferView & { task_key: string; task_title: string; project_id: string })
) & {
  /**
   * Where the offer's newest event stands for this agent (§4.77, LAI-553):
   * `available`, `received`, `presented` or `accepted`. Null for an offer
   * made before deliveries were recorded.
   */
  delivery: AgentEventDelivery | null;
};

export interface InboxOptions {
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  projectSlug?: string | null | undefined;
}

/**
 * `GET /agents/me/inbox`, `agent_sync` (§6.4, §7.1): the calling agent's
 * **live** work requests and the hand-off and recovery offers it may accept,
 * newest first, paged — limited to the projects it may read now. An unnamed
 * recovery is on it where the agent could take it: its owner's expired
 * claim, or a space that lets other owners' agents receive. Reads, and
 * records nothing; each item carries its delivery state (§4.77, LAI-553).
 */
export function listInbox(db: Db, actor: ResolvedActor, options: InboxOptions): InboxItem[] {
  assertCan(actor, 'agent.read_own');
  const agent: AgentContext | null = isSystemPrincipal(actor) ? null : (actor.token?.agent ?? null);
  if (agent === null) {
    throw new ApiError('forbidden', 'Only a registered agent’s token has an inbox', {
      reason: 'not_an_agent',
    });
  }

  let readable = [...agent.grants.keys()].filter((projectId) =>
    can(withProject(actor, projectId), 'project.read', { projectId }),
  );
  if (options.projectSlug !== undefined && options.projectSlug !== null) {
    const found =
      readable.length === 0
        ? undefined
        : db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.slug, options.projectSlug), inArray(projects.id, readable)))
            .get();
    if (found === undefined) throw noSuchProjectForAgent();
    readable = [found.id];
  }
  if (readable.length === 0) return [];
  const full = readable.filter((p) => agent.grants.get(p) === 'full');

  const sameOwnerExpired = exists(
    db
      .select({ id: taskClaims.id })
      .from(taskClaims)
      .innerJoin(agents, eq(agents.id, taskClaims.agentId))
      .where(
        and(
          eq(taskClaims.taskId, handoffOffers.taskId),
          eq(taskClaims.generation, handoffOffers.fromClaimGeneration),
          eq(agents.ownerUserId, actor.userId),
        ),
      ),
  );
  const otherOwnersAllowed = exists(
    db
      .select({ id: projectHandoffPolicies.id })
      .from(projectHandoffPolicies)
      .where(
        and(
          eq(projectHandoffPolicies.projectId, tasks.projectId),
          eq(projectHandoffPolicies.allowOtherOwners, true),
        ),
      ),
  );

  const conditions: SQL[] = [
    inArray(tasks.projectId, readable),
    or(
      and(
        eq(handoffOffers.kind, 'work_request'),
        eq(handoffOffers.state, 'open'),
        eq(handoffOffers.toAgentId, agent.id),
      ),
      and(
        inArray(handoffOffers.kind, ['handoff', 'recovery']),
        inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
        eq(handoffOffers.toAgentId, agent.id),
      ),
      full.length === 0
        ? sql`0`
        : and(
            eq(handoffOffers.kind, 'recovery'),
            eq(handoffOffers.state, 'open'),
            isNull(handoffOffers.toAgentId),
            inArray(tasks.projectId, full),
            or(sameOwnerExpired, otherOwnersAllowed),
          ),
    )!,
  ];
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(handoffOffers.createdAt, key),
        and(eq(handoffOffers.createdAt, key), lt(handoffOffers.id, options.cursor.id)),
      )!,
    );
  }

  const found = db
    .select({
      offer: handoffOffers,
      number: tasks.number,
      title: tasks.title,
      projectId: tasks.projectId,
      prefix: projects.prefix,
    })
    .from(handoffOffers)
    .innerJoin(tasks, eq(tasks.id, handoffOffers.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(...conditions))
    .orderBy(desc(handoffOffers.createdAt), desc(handoffOffers.id))
    .limit(options.limit + 1)
    .all();

  const views = new Map(
    offerViews(
      db,
      agentReader(actor),
      found.filter((f) => f.offer.kind !== 'work_request').map((f) => f.offer),
    ).map((v) => [v.id, v]),
  );
  const deliveries = inboxDeliveries(
    db,
    agent.id,
    found.map((f) => f.offer.id),
  );
  return found.map((f): InboxItem => {
    const taskKey = `${f.prefix}-${String(f.number)}`;
    const delivery = deliveries.get(f.offer.id) ?? null;
    if (f.offer.kind === 'work_request') {
      return {
        id: f.offer.id,
        kind: 'work_request',
        state: 'open',
        task_id: f.offer.taskId,
        task_key: taskKey,
        task_title: f.title,
        project_id: f.projectId,
        agent_id: agent.id,
        requested_by: f.offer.createdByUserId,
        created_at: f.offer.createdAt,
        delivery,
      };
    }
    return {
      ...views.get(f.offer.id)!,
      task_key: taskKey,
      task_title: f.title,
      project_id: f.projectId,
      delivery,
    };
  });
}

// ------------------------------------------------------- a person's inbox

/** The four filters of a person's hand-off inbox (§6.4, LAI-1009). */
export const PERSON_INBOX_VIEWS = ['received', 'sent', 'needs_approval', 'recovery'] as const;
export type PersonInboxFilter = (typeof PERSON_INBOX_VIEWS)[number];

/**
 * What the caller can do about an offer now. A hint for the screen, never a
 * permission: every write asks `can()` again, inside its own transaction.
 */
export type HandoffNextAction =
  | 'approve'
  | 'name_receiver'
  | 'accept_with_your_agent'
  | 'cancel'
  | 'wait_for_approval'
  | 'wait_for_receiver'
  | 'none';

/** One hand-off or recovery offer, as a signed-in person's inbox reads it. */
export interface PersonHandoffView {
  id: string;
  kind: 'handoff' | 'recovery';
  /** A live offer past `expires_at` reads `expired`, as every write answers it (§11.6). */
  state: HandoffOfferState;
  task_id: string;
  task_key: string;
  task_title: string;
  project_id: string;
  project_slug: string;
  /** The agent whose claim the work moves from: the sender's, or the expired one. */
  from_agent: SelectedAgentView | null;
  /**
   * Null for an unnamed recovery, which any eligible agent may take — unless
   * `to_agent_redacted`.
   */
  to_agent: SelectedAgentView | null;
  /**
   * `from_agent` is another person's agent this reader may not see (D-121
   * item 7, LAI-1012): null, and it reads as *an agent* — no id, harness,
   * device or owner.
   */
  from_agent_redacted: boolean;
  /** As `from_agent_redacted`, for `to_agent`: *an agent*, not "any eligible agent". */
  to_agent_redacted: boolean;
  checkpoint_id: string | null;
  /** The checkpoint as it is now, or null once retention removed it. */
  checkpoint: { commit_sha: string; verification: string; saved_at: number } | null;
  /** The sender's reason. Untrusted data (D-115 item 7). */
  reason: string | null;
  requires_approval: boolean;
  approved: boolean;
  approved_at: number | null;
  expires_at: number | null;
  closed_reason: HandoffClosedReason | null;
  created_at: number;
  closed_at: number | null;
  next_action: HandoffNextAction;
}

export type PersonInboxCounts = Record<PersonInboxFilter, number>;

/** `GET /handoff-offers` (§6.4): a page of one view, and every view's count. */
export interface PersonHandoffInbox {
  data: PersonHandoffView[];
  next_cursor: string | null;
  counts: PersonInboxCounts;
}

export interface PersonInboxOptions {
  view: PersonInboxFilter;
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  projectSlug?: string | null | undefined;
  /** Closed and expired offers too. The counts never include them. */
  includeClosed?: boolean | undefined;
  now?: number | undefined;
}

/**
 * `GET /handoff-offers` (§6.4, LAI-1009): the hand-off and recovery offers
 * that concern a **signed-in person**, one view at a time, newest first, with
 * every view's count for the Inbox badge.
 *
 * - `received` — addressed to an agent the caller owns;
 * - `sent` — a hand-off from an agent the caller owns;
 * - `needs_approval` — `pending_approval`, the caller may approve it
 *   (`task.handoff.approve`), and **never where the caller owns the
 *   receiver** (`approver_is_receiver`);
 * - `recovery` — every recovery offer.
 *
 * Only on projects the caller may read now (`project.read`): an unreadable
 * project contributes nothing, and an unreadable `project` filter is the
 * missing slug's `404`. Live and unexpired only, unless `includeClosed`; the
 * counts are live and unexpired always. An agent's token is refused — its
 * inbox is `GET /agents/me/inbox`. Reads, and records nothing.
 */
export function listPersonInbox(
  db: Db,
  actor: ResolvedActor,
  options: PersonInboxOptions,
): { rows: PersonHandoffView[]; counts: PersonInboxCounts } {
  if (registeredAgent(actor) !== null) {
    throw new ApiError('forbidden', 'An agent reads its own inbox at GET /agents/me/inbox', {
      reason: 'use_agent_inbox',
    });
  }
  assertCan(actor, 'agent.read_own');
  const now = options.now ?? Date.now();

  let readable = db
    .select({ id: projects.id })
    .from(projects)
    .all()
    .map((p) => p.id)
    .filter((projectId) => canSeeProject(actor, projectId));
  if (options.projectSlug !== undefined && options.projectSlug !== null) {
    // One body for a slug that names nothing and one the caller cannot read:
    // no slug in the message, so the two cannot be told apart (LAI-1009).
    const slug = options.projectSlug;
    const found = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .get();
    if (found === undefined || !readable.includes(found.id)) {
      throw ApiError.notFound('No such project');
    }
    readable = [found.id];
  }
  const counts: PersonInboxCounts = { received: 0, sent: 0, needs_approval: 0, recovery: 0 };
  if (readable.length === 0) return { rows: [], counts };

  // Asked of `can()` once per project: a lead approves any task's offer, a
  // member only on a task they are the assignee of (§3.2).
  const approveAny = readable.filter((projectId) =>
    can(withProject(actor, projectId), 'task.handoff.approve', { projectId }),
  );
  const approveAssigned = readable.filter((projectId) =>
    can(withProject(actor, projectId), 'task.handoff.approve', {
      projectId,
      ownerId: actor.userId,
    }),
  );

  const mine = db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.ownerUserId, actor.userId));
  const fromMine = exists(
    db
      .select({ id: taskClaims.id })
      .from(taskClaims)
      .where(
        and(
          eq(taskClaims.taskId, handoffOffers.taskId),
          eq(taskClaims.generation, handoffOffers.fromClaimGeneration),
          inArray(taskClaims.agentId, mine),
        ),
      ),
  );
  const receiverMine = inArray(handoffOffers.toAgentId, mine);

  const viewCondition: Record<PersonInboxFilter, SQL> = {
    received: receiverMine,
    sent: and(eq(handoffOffers.kind, 'handoff'), fromMine)!,
    needs_approval: and(
      eq(handoffOffers.state, 'pending_approval'),
      sql`${handoffOffers.toAgentId} IS NOT NULL`,
      sql`NOT (${receiverMine})`,
      or(
        approveAny.length === 0 ? sql`0` : inArray(tasks.projectId, approveAny),
        approveAssigned.length === 0
          ? sql`0`
          : and(inArray(tasks.projectId, approveAssigned), eq(tasks.assigneeId, actor.userId)),
      ),
    )!,
    recovery: eq(handoffOffers.kind, 'recovery'),
  };
  const live = and(
    inArray(handoffOffers.state, [...LIVE_OFFER_STATES]),
    or(isNull(handoffOffers.expiresAt), sql`${handoffOffers.expiresAt} > ${now}`),
  )!;
  const base = [
    inArray(tasks.projectId, readable),
    inArray(handoffOffers.kind, ['handoff', 'recovery']),
  ];

  for (const view of PERSON_INBOX_VIEWS) {
    counts[view] =
      db
        .select({ n: sql<number>`count(*)` })
        .from(handoffOffers)
        .innerJoin(tasks, eq(tasks.id, handoffOffers.taskId))
        .where(and(...base, live, viewCondition[view]))
        .get()?.n ?? 0;
  }

  const conditions: SQL[] = [...base, viewCondition[options.view]];
  if (options.includeClosed !== true) conditions.push(live);
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(handoffOffers.createdAt, key),
        and(eq(handoffOffers.createdAt, key), lt(handoffOffers.id, options.cursor.id)),
      )!,
    );
  }
  const found = db
    .select({
      offer: handoffOffers,
      number: tasks.number,
      title: tasks.title,
      assigneeId: tasks.assigneeId,
      status: tasks.status,
      handoffCount: tasks.handoffCount,
      projectId: tasks.projectId,
      prefix: projects.prefix,
      slug: projects.slug,
    })
    .from(handoffOffers)
    .innerJoin(tasks, eq(tasks.id, handoffOffers.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(...conditions))
    .orderBy(desc(handoffOffers.createdAt), desc(handoffOffers.id))
    .limit(options.limit + 1)
    .all();

  return { rows: personHandoffViews(db, actor, found, now), counts };
}

interface FoundOffer {
  offer: OfferRow;
  number: number;
  title: string;
  assigneeId: string | null;
  status: TaskRow['status'];
  handoffCount: number;
  projectId: string;
  prefix: string;
  slug: string;
}

function personHandoffViews(
  db: Db,
  actor: ResolvedActor,
  found: readonly FoundOffer[],
  now: number,
): PersonHandoffView[] {
  if (found.length === 0) return [];
  // Only the claims the offers name — `(task_id, generation)` pairs — not
  // every claim those tasks ever had.
  const pairs = [
    ...new Map(
      found
        .filter((f) => f.offer.fromClaimGeneration !== null)
        .map((f) => [
          `${f.offer.taskId}:${String(f.offer.fromClaimGeneration)}`,
          { taskId: f.offer.taskId, generation: f.offer.fromClaimGeneration! },
        ]),
    ).values(),
  ];
  const claims =
    pairs.length === 0
      ? []
      : db
          .select({
            taskId: taskClaims.taskId,
            generation: taskClaims.generation,
            agentId: taskClaims.agentId,
          })
          .from(taskClaims)
          .where(
            or(
              ...pairs.map((p) =>
                and(eq(taskClaims.taskId, p.taskId), eq(taskClaims.generation, p.generation)),
              ),
            ),
          )
          .all();
  const fromAgentOf = new Map(
    claims.map((c) => [`${c.taskId}:${String(c.generation)}`, c.agentId]),
  );
  const fromAgentId = (offer: OfferRow) =>
    offer.fromClaimGeneration === null
      ? null
      : (fromAgentOf.get(`${offer.taskId}:${String(offer.fromClaimGeneration)}`) ?? null);

  const agentIds = [
    ...new Set(
      found
        .flatMap((f) => [fromAgentId(f.offer), f.offer.toAgentId])
        .filter((id): id is string => id !== null),
    ),
  ];
  const agentLines = new Map(
    agentIds.length === 0
      ? []
      : db
          .select({
            id: agents.id,
            displayName: agents.displayName,
            harness: agents.harness,
            deviceLabel: agents.deviceLabel,
            status: agents.status,
            ownerId: users.id,
            ownerName: users.name,
          })
          .from(agents)
          .innerJoin(users, eq(users.id, agents.ownerUserId))
          .where(inArray(agents.id, agentIds))
          .all()
          .map((a): [string, SelectedAgentView] => [
            a.id,
            {
              id: a.id,
              display_name: a.displayName,
              harness: a.harness,
              device_label: a.deviceLabel,
              status: a.status,
              owner: { id: a.ownerId, name: a.ownerName },
            },
          ]),
  );

  const checkpointIds = [
    ...new Set(found.map((f) => f.offer.checkpointId).filter((id): id is string => id !== null)),
  ];
  const checkpoints = new Map(
    checkpointIds.length === 0
      ? []
      : db
          .select({
            id: taskCheckpoints.id,
            commitSha: taskCheckpoints.commitSha,
            verification: taskCheckpoints.verification,
            createdAt: taskCheckpoints.createdAt,
          })
          .from(taskCheckpoints)
          .where(inArray(taskCheckpoints.id, checkpointIds))
          .all()
          .map((c) => [c.id, c]),
  );

  // Another person's agent is missing unless the task shows it, selected or
  // holding the live claim (D-121 item 7, LAI-1012): the one gate.
  const lens = agentLens(
    db,
    agentReader(actor),
    found.map((f) => f.offer.taskId),
    agentIds,
  );
  const actions = new NextActions(db, actor, found);
  return found.map((f): PersonHandoffView => {
    const offer = f.offer;
    const from = fromAgentId(offer);
    const hidden = (id: string | null): boolean => id !== null && !lens.visible(offer.taskId, id);
    // Each agent's registered name is its owner's alone (D-120, LAI-1001).
    const line = (id: string | null): SelectedAgentView | null => {
      const view = id === null || hidden(id) ? undefined : agentLines.get(id);
      return view === undefined ? null : namedFor(view, actor.userId);
    };
    const fromAgent = line(from);
    const toAgent = line(offer.toAgentId);
    const checkpoint =
      offer.checkpointId === null ? undefined : checkpoints.get(offer.checkpointId);
    const expired = isLive(offer.state) && offer.expiresAt !== null && offer.expiresAt <= now;
    const state: HandoffOfferState = expired ? 'expired' : offer.state;
    return {
      id: offer.id,
      kind: offer.kind as 'handoff' | 'recovery',
      state,
      task_id: offer.taskId,
      task_key: `${f.prefix}-${String(f.number)}`,
      task_title: f.title,
      project_id: f.projectId,
      project_slug: f.slug,
      from_agent: fromAgent,
      to_agent: toAgent,
      from_agent_redacted: hidden(from),
      to_agent_redacted: hidden(offer.toAgentId),
      checkpoint_id: offer.checkpointId,
      checkpoint:
        checkpoint === undefined
          ? null
          : {
              commit_sha: checkpoint.commitSha,
              verification: checkpoint.verification,
              saved_at: checkpoint.createdAt,
            },
      reason: offer.reason,
      requires_approval: offer.requiresApproval,
      approved: offer.approvedAt !== null,
      approved_at: offer.approvedAt,
      expires_at: offer.expiresAt,
      closed_reason: offer.closedReason,
      created_at: offer.createdAt,
      closed_at: offer.closedAt,
      // Asked of the agents themselves, never of what this reader is shown:
      // a withheld receiver is still one this reader may approve.
      next_action: actions.for(
        f,
        state,
        from === null ? null : (agentLines.get(from) ?? null),
        offer.toAgentId === null ? null : (agentLines.get(offer.toAgentId) ?? null),
        checkpoint?.verification ?? null,
      ),
    };
  });
}

/**
 * What the caller can do next — **only what would succeed now**, asked the way
 * each write asks it (LAI-1009 review). A hint for the screen, never a
 * permission: the write asks everything again inside its transaction.
 *
 * - `approve`: a named offer waiting for approval, which the caller may
 *   approve (`task.handoff.approve`) and whose receiver they do not own.
 * - `accept_with_your_agent`: one of the caller's agents would be accepted —
 *   {@link receiverEligibility} passes for it (active, `full` grant, its owner
 *   may `task.handoff.accept` there, the policy's owner rule), no approval is
 *   waiting, the task is in progress under its hand-off limit, and the
 *   checkpoint is `verified`. For an unnamed recovery, any of the caller's
 *   agents may be the one.
 * - `name_receiver`: an unnamed recovery the caller may approve, where some
 *   eligible agent of **another** owner exists — approving names a receiver,
 *   and naming one's own is `approver_is_receiver`.
 * - `cancel`: a hand-off from the caller's agent that they may cancel.
 */
class NextActions {
  private readonly actor: ResolvedActor;
  private readonly projectsById: Map<string, ProjectRow>;
  private readonly policies: Map<string, HandoffPolicyView>;
  /** Active agents with a `full` grant, by project: the only ones that could receive. */
  private readonly candidates: Map<string, { id: string; ownerUserId: string }[]>;
  private readonly facts: ReceiverFacts;

  // Plain fields, not parameter properties: Node's type stripping, which the
  // concurrency tests' worker processes load this file with, refuses those.
  /**
   * Everything the page's answers need, read up front in a fixed number of
   * queries whatever the page's size (LAI-1009): its projects, their
   * policies, the agents that could receive there, and those agents' and the
   * named receivers' {@link ReceiverFacts}. Every answer after is in memory.
   */
  constructor(db: Db, actor: ResolvedActor, rows: readonly FoundOffer[]) {
    this.actor = actor;
    const projectIds = [...new Set(rows.map((r) => r.projectId))];
    this.projectsById = new Map(
      db
        .select()
        .from(projects)
        .where(inArray(projects.id, projectIds))
        .all()
        .map((p) => [p.id, p]),
    );
    this.policies = readPolicies(db, projectIds);
    const onProjects = db
      .select({
        id: agents.id,
        ownerUserId: agents.ownerUserId,
        projectId: agentProjectGrants.projectId,
      })
      .from(agents)
      .innerJoin(agentProjectGrants, eq(agentProjectGrants.agentId, agents.id))
      .where(
        and(
          inArray(agentProjectGrants.projectId, projectIds),
          eq(agentProjectGrants.scope, 'full'),
          eq(agents.status, 'active'),
        ),
      )
      .all();
    this.candidates = new Map(
      projectIds.map((id) => [id, onProjects.filter((a) => a.projectId === id)]),
    );
    this.facts = loadReceiverFacts(db, [
      ...onProjects.map((a) => a.id),
      ...rows.map((r) => r.offer.toAgentId).filter((id): id is string => id !== null),
    ]);
  }

  for(
    row: FoundOffer,
    state: HandoffOfferState,
    fromAgent: SelectedAgentView | null,
    toAgent: SelectedAgentView | null,
    verification: string | null,
  ): HandoffNextAction {
    if (!isLive(state)) return 'none';
    const { offer } = row;
    const scoped = withProject(this.actor, row.projectId);
    const mayApprove = can(scoped, 'task.handoff.approve', {
      projectId: row.projectId,
      ownerId: row.assigneeId,
    });
    const receiverMine = toAgent?.owner.id === this.actor.userId;
    const senderMine = fromAgent?.owner.id === this.actor.userId;
    const fromOwner = fromAgent?.owner.id ?? null;

    if (state === 'pending_approval' && toAgent !== null && mayApprove && !receiverMine) {
      return 'approve';
    }
    if (state === 'open') {
      const takeable =
        row.status === 'in_progress' &&
        verification === 'verified' &&
        row.handoffCount < this.policy(row.projectId).max_handoffs;
      const candidates = this.candidates.get(row.projectId) ?? [];
      if (offer.toAgentId === null) {
        const mine = candidates.filter((a) => a.ownerUserId === this.actor.userId);
        if (
          takeable &&
          mine.some(
            (a) => this.eligibility(row.projectId, a.id, fromOwner)?.requiresApproval === false,
          )
        ) {
          return 'accept_with_your_agent';
        }
        const others = candidates.filter((a) => a.ownerUserId !== this.actor.userId);
        if (mayApprove && others.some((a) => this.eligibility(row.projectId, a.id, fromOwner))) {
          return 'name_receiver';
        }
      } else if (
        receiverMine &&
        takeable &&
        this.eligibility(row.projectId, offer.toAgentId, fromOwner) !== null
      ) {
        return 'accept_with_your_agent';
      }
    }
    if (
      offer.kind === 'handoff' &&
      senderMine &&
      can(scoped, 'task.handoff.cancel', { projectId: row.projectId, ownerId: this.actor.userId })
    ) {
      return 'cancel';
    }
    return state === 'pending_approval' ? 'wait_for_approval' : 'wait_for_receiver';
  }

  private policy(projectId: string): HandoffPolicyView {
    return this.policies.get(projectId)!;
  }

  /** {@link receiverRule}'s answer, from the facts already loaded. */
  private eligibility(
    projectId: string,
    agentId: string,
    fromOwner: string | null,
  ): { requiresApproval: boolean } | null {
    const project = this.projectsById.get(projectId);
    if (project === undefined) return null;
    return receiverRule(this.facts, project, this.policy(projectId), agentId, fromOwner);
  }
}
