import { and, asc, desc, eq, inArray, isNull, lte, max } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import {
  activityActor,
  isSystemPrincipal,
  type ResolvedActor,
  type ServiceCaller,
  withProject,
} from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { LIVE_CLAIM_STATES, type TaskClaimState } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  agentProjectGrants,
  agentSessions,
  agents,
  handoffOffers,
  projects,
  taskClaims,
  tasks,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, type AgentContext, systemPrincipal } from '../policy/can.ts';

/**
 * Agent sessions and exclusive task claims (proposal §4.2, SPEC §4.65, §4.66,
 * §5, §9.1, LAI-541).
 *
 * ## Three facts, still apart
 *
 * The assignee is the person accountable; the selected agent is who the work
 * is asked of; **the claim is which running session holds the task now**. A
 * claim is taken by a registered agent's `start_working`, renewed by its
 * session's heartbeats, and lost when the lease lapses — and a lapsed claim
 * is **never** live again. Only an explicit reclaim gives the same agent a new
 * claim, at the next generation, and the old generation stays refused for good.
 *
 * ## The fence
 *
 * {@link assertClaimFence} is called by every task-mutating service, inside
 * its write, so REST and MCP are fenced identically — the generation arrives
 * on the actor (`X-Laika-Claim-Generation`, `claim_generation`) and nowhere
 * else. Every refusal is `409 conflict` with `details.reason` naming which,
 * because §6.3's codes are closed and a finer reason travels in `reason`
 * (D-021, D-079): `stale_claim`, `claim_held`, `claim_paused`.
 *
 * ## Who is fenced
 *
 * - A **registered agent's** token: when the task has a live claim, only its
 *   holder's agent with the live generation may change it. Two agents of the
 *   same person are fenced from each other exactly as two people's are.
 * - A **legacy** token (no agent): it cannot bypass a claim (D-114 item 6) —
 *   refused `claim_held` while one is live.
 * - A person **signed in**: never fenced. Humans keep explicit controls; their
 *   change is recorded as theirs, as any change is (§4.8). Reads and comments
 *   are never fenced for anyone.
 * - The **system** (the webhook, §10.1): not fenced; it is evidence, not work.
 */

// ------------------------------------------------------------------ timing

/** Proposal §4.2's defaults (SPEC §9.1). Each is configurable per deployment (§11.7). */
export interface ClaimTimings {
  /** How often a session is expected to heartbeat; also the boot grace. */
  heartbeatMs: number;
  /** A session silent this long is shown as suspect. Decides nothing. */
  suspectMs: number;
  /** A claim's lease: how long after its last renewal it lapses. */
  expireMs: number;
  /** How often the expiry scan runs (§11.6). */
  scanMs: number;
}

export const DEFAULT_CLAIM_TIMINGS: ClaimTimings = {
  heartbeatMs: 30_000,
  suspectMs: 90_000,
  expireMs: 5 * 60_000,
  scanMs: 30_000,
};

interface ClaimSettings {
  timings: ClaimTimings;
  /**
   * When this server process started serving (§9.1). For one heartbeat
   * interval after it, **no lease lapses** — a server that was down did not
   * hear the heartbeats it was sent, and its sessions get one interval to be
   * heard again. `0` — a test that never booted — is no grace at all.
   */
  bootedAt: number;
}

let settings: ClaimSettings = { timings: DEFAULT_CLAIM_TIMINGS, bootedAt: 0 };

/** Set at boot from §11.7's variables (`index.ts`); a test sets its own. */
export function configureClaims(next: Partial<ClaimSettings>): void {
  settings = {
    timings: next.timings ?? settings.timings,
    bootedAt: next.bootedAt ?? settings.bootedAt,
  };
}

export function claimSettings(): Readonly<ClaimSettings> {
  return settings;
}

/**
 * Whether a lease has lapsed at `now` — **the one definition**, used by the
 * fence, the heartbeat and the scan alike, so no two of them can disagree
 * about the same claim. During the boot grace nothing lapses.
 */
export function leaseLapsed(leaseExpiresAt: number, now: number): boolean {
  const graceEnds = settings.bootedAt === 0 ? 0 : settings.bootedAt + settings.timings.heartbeatMs;
  return Math.max(leaseExpiresAt, graceEnds) <= now;
}

// ------------------------------------------------------------------- views

type SessionRow = typeof agentSessions.$inferSelect;
type ClaimRow = typeof taskClaims.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

/** One agent session (§4.65). Never a token. */
export interface AgentSessionView {
  id: string;
  agent_id: string;
  started_at: number;
  last_heartbeat_at: number;
  ended_at: number | null;
  end_reason: 'ended' | 'agent_revoked' | null;
  /** Self-reported (§4.65); decides nothing. */
  client_version: string | null;
  /** Self-reported (§4.65); decides nothing. */
  model: string | null;
  /** `suspect` past §9.1's suspect interval without a heartbeat. Shown, decides nothing. */
  connection: 'live' | 'suspect' | 'ended';
}

/** One claim (§4.66), as its holder reads it. */
export interface TaskClaimView {
  id: string;
  task_id: string;
  session_id: string;
  agent_id: string;
  generation: number;
  state: TaskClaimState;
  lease_expires_at: number;
  created_at: number;
  ended_at: number | null;
}

/** What a heartbeat answers: the claims it renewed, and the ones this session has lost. */
export interface HeartbeatView {
  session: AgentSessionView;
  claims: TaskClaimView[];
  lost: TaskClaimView[];
}

/**
 * A task's live claim as every reader of the task sees it (§4.5, LAI-568) —
 * the board's *Working* and *Connection lost*. Null on the task when nothing
 * live holds it: an expired, released or transferred claim is history, and
 * its record is the task's activity.
 */
export interface TaskLiveClaimView {
  generation: number;
  state: 'active' | 'paused';
  agent_id: string;
  session_id: string;
  lease_expires_at: number;
  /** The holding session's. */
  last_heartbeat_at: number;
  /**
   * `suspect` once `last_heartbeat_at` is `suspect_after_ms` old, as
   * {@link AgentSessionView} computes it — and for a session that ended while
   * the claim stayed live (a revoked agent's, left to lapse), which nothing
   * will renew. Shown, decides nothing.
   */
  connection: 'live' | 'suspect';
  /**
   * §9.1's suspect interval, so a client can move `live` to `suspect` on its
   * own clock: heartbeats write no activity, so no event re-reads the task.
   */
  suspect_after_ms: number;
  /** The holding agent's, for "Claude Code · laptop-1". */
  device_label: string | null;
}

/** Whether a heartbeat this old is suspect at `now` — one rule for every view. */
function isSuspect(lastHeartbeatAt: number, now: number): boolean {
  return now - lastHeartbeatAt >= settings.timings.suspectMs;
}

function sessionView(row: SessionRow, now: number): AgentSessionView {
  return {
    id: row.id,
    agent_id: row.agentId,
    started_at: row.startedAt,
    last_heartbeat_at: row.lastHeartbeatAt,
    ended_at: row.endedAt,
    end_reason: row.endReason,
    client_version: row.clientVersion,
    model: row.model,
    connection:
      row.endedAt !== null ? 'ended' : isSuspect(row.lastHeartbeatAt, now) ? 'suspect' : 'live',
  };
}

export function claimView(row: ClaimRow): TaskClaimView {
  return {
    id: row.id,
    task_id: row.taskId,
    session_id: row.sessionId,
    agent_id: row.agentId,
    generation: row.generation,
    state: row.state,
    lease_expires_at: row.leaseExpiresAt,
    created_at: row.createdAt,
    ended_at: row.endedAt,
  };
}

// ---------------------------------------------------------------- refusals

/** `409 conflict` with the claim reason in `details` (D-079). */
function claimConflict(
  reason: 'stale_claim' | 'claim_held' | 'claim_paused',
  message: string,
  details: Record<string, unknown> = {},
): ApiError {
  return new ApiError('conflict', message, { reason, ...details });
}

/** The registered agent this actor's token is the credential of, or null (D-114). */
export function registeredAgent(actor: ServiceCaller): AgentContext | null {
  if (isSystemPrincipal(actor)) return null;
  return actor.token?.agent ?? null;
}

function requireAgent(actor: ResolvedActor): AgentContext {
  const agent = registeredAgent(actor);
  if (agent === null) {
    // The shape `GET /agents/me/work-requests` uses (LAI-535): only an
    // agent's own token has sessions.
    throw new ApiError('forbidden', 'Only a registered agent’s token has sessions', {
      reason: 'not_an_agent',
    });
  }
  return agent;
}

/** Another agent's session is a 404, as another person's agent is (§4.63). */
function requireOwnSession(db: Db, agentId: string, sessionId: string): SessionRow {
  const row = db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.agentId, agentId)))
    .get();
  if (row === undefined) throw ApiError.notFound(`No session with id "${sessionId}"`);
  return row;
}

function requireOpenSession(db: Db, agentId: string, sessionId: string): SessionRow {
  const row = requireOwnSession(db, agentId, sessionId);
  if (row.endedAt !== null) {
    throw claimConflict('stale_claim', 'That session has ended; start a new one', {
      session_id: row.id,
      session_state: 'ended',
      end_reason: row.endReason,
    });
  }
  return row;
}

// ---------------------------------------------------------------- reading

/** The task's live claim — `active` or `paused` — or undefined. */
export function liveClaim(db: Db, taskId: string): ClaimRow | undefined {
  return db
    .select()
    .from(taskClaims)
    .where(and(eq(taskClaims.taskId, taskId), inArray(taskClaims.state, [...LIVE_CLAIM_STATES])))
    .get();
}

/**
 * The live claim of each task on a page, keyed by task id — **one query
 * whatever the page size**, as LAI-091 keeps every other part of a task view.
 *
 * An `active` claim whose lease has lapsed is left out before the scan
 * catches it ({@link leaseLapsed}, so the boot grace holds here too): the
 * fence already refuses its generation, and a card must not say *Working*
 * for a claim nobody can use.
 */
export function liveClaimViews(
  db: Db,
  taskIds: readonly string[],
  now: number,
): Map<string, TaskLiveClaimView> {
  if (taskIds.length === 0) return new Map();

  const found = db
    .select({
      claim: taskClaims,
      lastHeartbeatAt: agentSessions.lastHeartbeatAt,
      sessionEndedAt: agentSessions.endedAt,
      deviceLabel: agents.deviceLabel,
    })
    .from(taskClaims)
    .innerJoin(agentSessions, eq(agentSessions.id, taskClaims.sessionId))
    .innerJoin(agents, eq(agents.id, taskClaims.agentId))
    .where(
      and(
        inArray(taskClaims.taskId, [...taskIds]),
        inArray(taskClaims.state, [...LIVE_CLAIM_STATES]),
      ),
    )
    .all();

  const views = new Map<string, TaskLiveClaimView>();
  for (const { claim, lastHeartbeatAt, sessionEndedAt, deviceLabel } of found) {
    if (claim.state === 'active' && leaseLapsed(claim.leaseExpiresAt, now)) continue;
    views.set(claim.taskId, {
      generation: claim.generation,
      // The query's predicate: only the live states reach here.
      state: claim.state as TaskLiveClaimView['state'],
      agent_id: claim.agentId,
      session_id: claim.sessionId,
      lease_expires_at: claim.leaseExpiresAt,
      last_heartbeat_at: lastHeartbeatAt,
      connection: sessionEndedAt !== null || isSuspect(lastHeartbeatAt, now) ? 'suspect' : 'live',
      suspect_after_ms: settings.timings.suspectMs,
      device_label: deviceLabel,
    });
  }
  return views;
}

/** The task's newest claim of any state — the highest generation. */
function latestClaim(db: Db, taskId: string): ClaimRow | undefined {
  return db
    .select()
    .from(taskClaims)
    .where(eq(taskClaims.taskId, taskId))
    .orderBy(desc(taskClaims.generation))
    .limit(1)
    .get();
}

function nextGeneration(db: Db, taskId: string): number {
  const row = db
    .select({ top: max(taskClaims.generation) })
    .from(taskClaims)
    .where(eq(taskClaims.taskId, taskId))
    .get();
  return (row?.top ?? 0) + 1;
}

// ---------------------------------------------------------------- sessions

export interface StartSessionInput {
  client_version?: string | undefined;
  model?: string | undefined;
}

function openSession(
  db: Db,
  actor: ResolvedActor,
  agent: AgentContext,
  input: StartSessionInput,
  now: number,
): SessionRow {
  const row: SessionRow = {
    id: newId(),
    agentId: agent.id,
    // The credential that opened it; a request without one never reaches here.
    tokenId: actor.token!.id,
    startedAt: now,
    lastHeartbeatAt: now,
    endedAt: null,
    endReason: null,
    clientVersion: input.client_version ?? null,
    model: input.model ?? null,
    contextRevisionSeen: null,
  };
  db.insert(agentSessions).values(row).run();
  return row;
}

/**
 * `POST /agent-sessions` (§6.4): open a session for the calling agent. Under
 * `heartbeat.send_own` — a session is §9.1's heartbeat, given a name — and an
 * agent's token only. Writes no activity: a session is presence, not history,
 * and its claims are what §4.8 records.
 */
export function startAgentSession(
  db: Db,
  actor: ResolvedActor,
  input: StartSessionInput,
  now: number = Date.now(),
): AgentSessionView {
  assertCan(actor, 'heartbeat.send_own');
  const agent = requireAgent(actor);
  return sessionView(openSession(db, actor, agent, input, now), now);
}

/**
 * A heartbeat (`POST /agent-sessions/:id/heartbeat`, §9.1): stamps the session
 * and renews the lease of each of its active claims — **unless that lease has
 * already lapsed**, in which case the claim is expired here and now, exactly
 * as the scan would have, and is reported in `lost`. A heartbeat never brings
 * a claim back: the scan and this agree through {@link leaseLapsed}.
 */
export function heartbeatAgentSession(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  sessionId: string,
  now: number = Date.now(),
): HeartbeatView {
  assertCan(actor, 'heartbeat.send_own');
  const agent = requireAgent(actor);

  return immediateTransaction(sqlite, () => {
    const session = requireOpenSession(db, agent.id, sessionId);
    db.update(agentSessions)
      .set({ lastHeartbeatAt: now })
      .where(eq(agentSessions.id, session.id))
      .run();

    const active = db
      .select()
      .from(taskClaims)
      .where(and(eq(taskClaims.sessionId, session.id), eq(taskClaims.state, 'active')))
      .all();
    for (const claim of active) {
      if (leaseLapsed(claim.leaseExpiresAt, now)) expireClaim(db, claim, now);
      else renewLease(db, claim, now);
    }

    const mine = db
      .select()
      .from(taskClaims)
      .where(eq(taskClaims.sessionId, session.id))
      .orderBy(asc(taskClaims.createdAt), asc(taskClaims.id))
      .all();
    return {
      session: sessionView({ ...session, lastHeartbeatAt: now }, now),
      claims: mine.filter((c) => isLive(c.state)).map(claimView),
      lost: mine.filter((c) => !isLive(c.state)).map(claimView),
    };
  });
}

/**
 * `POST /agent-sessions/:id/end`: the agent is done. Its live claims are
 * **released** — given up, not lost — so the task is free for the next
 * claim without a reclaim. Ending an ended session answers it unchanged.
 */
export function endAgentSession(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  sessionId: string,
  now: number = Date.now(),
): AgentSessionView {
  assertCan(actor, 'heartbeat.send_own');
  const agent = requireAgent(actor);

  return immediateTransaction(sqlite, () => {
    const session = requireOwnSession(db, agent.id, sessionId);
    if (session.endedAt !== null) return sessionView(session, now);

    db.update(agentSessions)
      .set({ endedAt: now, endReason: 'ended' })
      .where(eq(agentSessions.id, session.id))
      .run();
    db.update(taskClaims)
      .set({ state: 'released', endedAt: now })
      .where(
        and(
          eq(taskClaims.sessionId, session.id),
          inArray(taskClaims.state, [...LIVE_CLAIM_STATES]),
        ),
      )
      .run();
    return sessionView({ ...session, endedAt: now, endReason: 'ended' }, now);
  });
}

/**
 * Revoking an agent ends its sessions (D-114 item 2), inside the revoke's
 * transaction. **Its claims are left to lapse**: a revoked agent's token is
 * refused before any handler (`resolve-actor.ts`), so nothing can renew them,
 * and a lapse is what opens recovery (LAI-546) — releasing them here would
 * free the task with no record of why the work stopped.
 */
export function endSessionsOfRevokedAgent(db: Db, agentId: string, now: number): void {
  db.update(agentSessions)
    .set({ endedAt: now, endReason: 'agent_revoked' })
    .where(and(eq(agentSessions.agentId, agentId), isNull(agentSessions.endedAt)))
    .run();
}

function isLive(state: TaskClaimState): boolean {
  return (LIVE_CLAIM_STATES as readonly string[]).includes(state);
}

function renewLease(db: Db, claim: ClaimRow, now: number): void {
  db.update(taskClaims)
    .set({ leaseExpiresAt: now + settings.timings.expireMs })
    .where(eq(taskClaims.id, claim.id))
    .run();
}

// ------------------------------------------------------------------ fence

/**
 * The fence (proposal §4.2): may this caller change this task now?
 *
 * Called by every task-mutating service **inside its write**, before it
 * writes. See the module comment for who is fenced and why. `now` is the
 * write's own clock, so a test that injects one fences against it.
 */
export function assertClaimFence(db: Db, actor: ServiceCaller, taskId: string, now: number): void {
  if (isSystemPrincipal(actor)) return;

  const agent = registeredAgent(actor);
  const generation = actor.claimGeneration;
  const live = liveClaim(db, taskId);

  if (agent === null) {
    // A person signed in keeps explicit control; a legacy token does not.
    if (actor.token === null || actor.token === undefined) return;
    if (live !== undefined) {
      throw claimConflict(
        'claim_held',
        'A registered agent holds this task; a token with no agent cannot change it',
        { task_id: taskId, agent_id: live.agentId },
      );
    }
    return;
  }

  if (generation === undefined) {
    if (live === undefined) return;
    if (live.agentId === agent.id) {
      throw claimConflict(
        'stale_claim',
        'This task is claimed; send the claim generation with every change',
        { task_id: taskId, claim_generation: null },
      );
    }
    throw claimConflict('claim_held', 'Another agent session holds this task', {
      task_id: taskId,
      agent_id: live.agentId,
    });
  }

  // A generation was sent: it must be the live claim's, held by this agent.
  const stale = () =>
    claimConflict('stale_claim', 'That claim generation is no longer valid', {
      task_id: taskId,
      claim_generation: generation,
    });
  if (live === undefined) throw stale();
  if (live.agentId !== agent.id) {
    throw claimConflict('claim_held', 'Another agent session holds this task', {
      task_id: taskId,
      agent_id: live.agentId,
    });
  }
  if (live.generation !== generation) throw stale();
  if (live.state === 'paused') {
    throw claimConflict('claim_paused', 'This claim is paused while a hand-off is open', {
      task_id: taskId,
      claim_generation: generation,
    });
  }
  if (leaseLapsed(live.leaseExpiresAt, now)) {
    throw claimConflict('stale_claim', 'That claim’s lease has lapsed', {
      task_id: taskId,
      claim_generation: generation,
      lease_expires_at: live.leaseExpiresAt,
    });
  }
}

/**
 * A task left `in_progress` (§5): whatever claim was live on it is released,
 * inside the status write. The holder finishing into review, a person moving
 * it on — either way nobody is working it under that claim any more, and its
 * generation is refused from here on.
 */
export function releaseLiveClaim(db: Db, taskId: string, now: number): void {
  db.update(taskClaims)
    .set({ state: 'released', endedAt: now })
    .where(and(eq(taskClaims.taskId, taskId), inArray(taskClaims.state, [...LIVE_CLAIM_STATES])))
    .run();
}

// ------------------------------------------------------------------ taking

export interface TakeClaimInput {
  /** The session to claim under; absent opens one for the calling agent. */
  sessionId?: string | undefined;
  now: number;
}

export interface TakenClaim {
  claim: ClaimRow;
  /** True when this session already held it: a renewal, not a new claim. */
  resumed: boolean;
}

/**
 * A registered agent's `start_working`: take the task's exclusive claim, or
 * resume the one this session already holds. **Inside the caller's `BEGIN
 * IMMEDIATE`**, so the read of the live claim and the insert cannot be split
 * by another writer — and the partial unique index refuses a second live row
 * even if they could.
 *
 * - Held by another session — this agent's, or another's — is `claim_held`.
 * - The newest claim **expired** while the task stayed in progress: this
 *   agent must reclaim explicitly (`stale_claim`, `reclaim: true`); any other
 *   agent waits for recovery (LAI-546), `claim_held`. An expired claim is
 *   never taken over by a plain claim.
 * - Otherwise a new claim at the next generation, and the open work request
 *   addressed to this agent, if any, is `accepted`.
 */
export function takeClaim(
  db: Db,
  actor: ResolvedActor,
  task: Pick<TaskRow, 'id' | 'status'>,
  input: TakeClaimInput,
): TakenClaim {
  const agent = requireAgent(actor);
  const { now } = input;
  const session =
    input.sessionId === undefined
      ? openSession(db, actor, agent, {}, now)
      : requireOpenSession(db, agent.id, input.sessionId);

  const live = liveClaim(db, task.id);
  if (live !== undefined) {
    if (live.sessionId !== session.id) {
      throw claimConflict('claim_held', 'Another agent session holds this task', {
        task_id: task.id,
        agent_id: live.agentId,
      });
    }
    if (live.state === 'paused') {
      throw claimConflict('claim_paused', 'This claim is paused while a hand-off is open', {
        task_id: task.id,
        claim_generation: live.generation,
      });
    }
    if (leaseLapsed(live.leaseExpiresAt, now)) {
      expireClaim(db, live, now);
      throw claimConflict('stale_claim', 'Your claim on this task expired; reclaim it explicitly', {
        task_id: task.id,
        claim_generation: live.generation,
        reclaim: true,
      });
    }
    renewLease(db, live, now);
    db.update(agentSessions)
      .set({ lastHeartbeatAt: now })
      .where(eq(agentSessions.id, session.id))
      .run();
    return { claim: { ...live, leaseExpiresAt: now + settings.timings.expireMs }, resumed: true };
  }

  const latest = latestClaim(db, task.id);
  if (latest?.state === 'expired' && task.status === 'in_progress') {
    if (latest.agentId === agent.id) {
      throw claimConflict('stale_claim', 'Your claim on this task expired; reclaim it explicitly', {
        task_id: task.id,
        claim_generation: latest.generation,
        reclaim: true,
      });
    }
    throw claimConflict('claim_held', 'This task’s claim expired and is waiting for recovery', {
      task_id: task.id,
      agent_id: latest.agentId,
      claim_state: 'expired',
    });
  }

  const claim = insertClaim(db, task.id, session.id, agent.id, now);
  acceptWorkRequest(db, task.id, agent.id, now);
  return { claim, resumed: false };
}

function insertClaim(
  db: Db,
  taskId: string,
  sessionId: string,
  agentId: string,
  now: number,
): ClaimRow {
  const row: ClaimRow = {
    id: newId(),
    taskId,
    sessionId,
    agentId,
    generation: nextGeneration(db, taskId),
    leaseExpiresAt: now + settings.timings.expireMs,
    state: 'active',
    createdAt: now,
    endedAt: null,
  };
  db.insert(taskClaims).values(row).run();
  return row;
}

/** The open work request for this agent on this task, if any (LAI-535). */
export function hasOpenWorkRequest(db: Db, taskId: string, agentId: string): boolean {
  return (
    db
      .select({ id: handoffOffers.id })
      .from(handoffOffers)
      .where(
        and(
          eq(handoffOffers.taskId, taskId),
          eq(handoffOffers.kind, 'work_request'),
          eq(handoffOffers.state, 'open'),
          eq(handoffOffers.toAgentId, agentId),
        ),
      )
      .get() !== undefined
  );
}

/** Claiming answers the request (proposal §4.4): `open` → `accepted`. */
function acceptWorkRequest(db: Db, taskId: string, agentId: string, now: number): void {
  db.update(handoffOffers)
    .set({ state: 'accepted', closedAt: now })
    .where(
      and(
        eq(handoffOffers.taskId, taskId),
        eq(handoffOffers.kind, 'work_request'),
        eq(handoffOffers.state, 'open'),
        eq(handoffOffers.toAgentId, agentId),
      ),
    )
    .run();
}

// ----------------------------------------------------------------- reclaim

export interface ReclaimInput {
  sessionId?: string | undefined;
  now?: number;
}

export interface ReclaimView {
  claim: TaskClaimView;
  session: AgentSessionView;
  /** The generation that expired, and stays refused. */
  from_generation: number;
}

/**
 * **The seam for LAI-546.** Reclaiming must refuse `409` (`offer_taken`) when
 * a recovery or hand-off offer for the task was already accepted, and cancel
 * every open or pending-approval one with reason `reclaimed`. Those offers do
 * not exist yet — LAI-535 writes only work requests, which reclaiming leaves
 * alone — so this returns. A test pins it and names LAI-546.
 */
export function reclaimOfferSteps(_db: Db, _taskId: string, _now: number): void {
  // TODO(LAI-546): refuse `offer_taken`; cancel open and pending-approval offers.
}

/**
 * The explicit reclaim (`POST /tasks/:id/claim/reclaim`, `start_working`
 * with `reclaim: true`; proposal §4.2). One `BEGIN IMMEDIATE` operation that
 * asks everything again — the owner's permission, the agent's status and
 * grant, the token's scope — because the claim expired a while ago and any of
 * them may have changed since. Then a **new** claim at `generation + 1` and
 * `task.claim_reclaimed`. The old generation is never valid again.
 *
 * Only the agent whose claim expired may reclaim; anyone else waits for
 * recovery (LAI-546).
 */
export function reclaimTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  input: ReclaimInput = {},
): ReclaimView {
  const now = input.now ?? Date.now();
  const agent = requireAgent(actor);

  return immediateTransaction(sqlite, () => {
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
    const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get()!;

    // The token's scope first: a read-only credential is told so, whatever
    // the grant says.
    if (actor.token?.scope !== 'full') {
      throw new ApiError('forbidden', 'Reclaiming needs a token with full scope', {
        action: 'task.claim',
        reason: 'token_read_only',
      });
    }
    // The agent's row and grant as they are **now**, not as the request's
    // token context loaded them.
    const row = db
      .select({ status: agents.status })
      .from(agents)
      .where(eq(agents.id, agent.id))
      .get();
    if (row?.status !== 'active') {
      throw new ApiError('forbidden', 'That agent is revoked', {
        action: 'task.claim',
        reason: 'agent_revoked',
      });
    }
    const grant = db
      .select({ scope: agentProjectGrants.scope })
      .from(agentProjectGrants)
      .where(
        and(eq(agentProjectGrants.agentId, agent.id), eq(agentProjectGrants.projectId, project.id)),
      )
      .get();
    if (grant?.scope !== 'full') {
      throw new ApiError('forbidden', 'This agent may not work in that project', {
        action: 'task.claim',
        reason: grant === undefined ? 'agent_not_granted' : 'agent_read_only',
      });
    }
    // The owner's own permission, with the agent step and the space rules,
    // through `can()` as every claim asks it.
    assertCan(withProject(actor, project.id), 'task.claim', { projectId: project.id });

    const live = liveClaim(db, taskId);
    if (live !== undefined) {
      throw claimConflict('claim_held', 'This task is held; there is nothing to reclaim', {
        task_id: taskId,
        agent_id: live.agentId,
      });
    }
    const latest = latestClaim(db, taskId);
    if (latest?.state !== 'expired' || latest.agentId !== agent.id) {
      throw new ApiError('conflict', 'There is no expired claim of this agent to reclaim', {
        reason: 'nothing_to_reclaim',
        task_id: taskId,
      });
    }

    reclaimOfferSteps(db, taskId, now);

    const session =
      input.sessionId === undefined
        ? openSession(db, actor, agent, {}, now)
        : requireOpenSession(db, agent.id, input.sessionId);
    const claim = insertClaim(db, taskId, session.id, agent.id, now);

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(actor),
      type: 'task.claim_reclaimed',
      payload: {
        from_generation: latest.generation,
        generation: claim.generation,
        session_id: session.id,
        agent_id: agent.id,
      },
      now,
    });

    return {
      claim: claimView(claim),
      session: sessionView(session, now),
      from_generation: latest.generation,
    };
  });
}

// ------------------------------------------------------------------ expiry

/**
 * **The seam for LAI-546.** A claim that lapsed opens a recovery offer —
 * never a silent reassignment (proposal §4.2). Offers of that kind do not
 * exist yet, so this returns; the scan and the heartbeat both call it, so
 * the day it does something, every expiry gets it.
 */
export function afterClaimExpired(_db: Db, _claim: ClaimRow, _now: number): void {
  // TODO(LAI-546): open a `recovery` offer for the task.
}

/** Mark one claim `expired` and write `task.claim_expired` as the system (§3.4). */
function expireClaim(db: Db, claim: ClaimRow, now: number): void {
  const changed = db
    .update(taskClaims)
    .set({ state: 'expired', endedAt: now })
    .where(and(eq(taskClaims.id, claim.id), eq(taskClaims.state, 'active')))
    .run().changes;
  if (changed === 0) return;

  const where = db
    .select({ projectId: tasks.projectId, orgId: projects.orgId })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, claim.taskId))
    .get()!;
  appendActivity(db, {
    orgId: where.orgId,
    projectId: where.projectId,
    taskId: claim.taskId,
    actorId: null,
    actorKind: 'system',
    type: 'task.claim_expired',
    payload: {
      generation: claim.generation,
      session_id: claim.sessionId,
      agent_id: claim.agentId,
      lease_expires_at: claim.leaseExpiresAt,
    },
    now,
  });
  afterClaimExpired(db, claim, now);
}

const SYSTEM = systemPrincipal();

/**
 * §11.6's expiry scan: every `active` claim whose lease has lapsed becomes
 * `expired`, one `task.claim_expired` row each — each is a different task's
 * history, unlike retention's one row a run. Nothing lapses during the boot
 * grace ({@link leaseLapsed}); after it, the first scan catches everything
 * overdue, because leases are timestamps and survive a restart.
 */
export function expireClaims(db: Db, now: number): { changed: number } {
  assertCan(SYSTEM, 'system.claim.expire');

  const overdue = db
    .select()
    .from(taskClaims)
    .where(and(eq(taskClaims.state, 'active'), lte(taskClaims.leaseExpiresAt, now)))
    .all()
    .filter((claim) => leaseLapsed(claim.leaseExpiresAt, now));

  for (const claim of overdue) expireClaim(db, claim, now);
  return { changed: overdue.length };
}
