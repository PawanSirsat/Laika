import { and, asc, desc, eq, inArray, isNull, lte, max } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import {
  activityActor,
  isSystemPrincipal,
  loadActor,
  loadAgent,
  type ResolvedActor,
  type ServiceCaller,
  withProject,
} from '../auth/resolve-actor.ts';
import { tokenProjectIds } from '../auth/tokens.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { LIVE_CLAIM_STATES, type TaskClaimState } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  agents,
  agentSessions,
  handoffOffers,
  projects,
  taskClaims,
  tasks,
  tokens,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, type AgentContext, systemPrincipal } from '../policy/can.ts';
import { assertNoAcceptedOfferFrom, closeLiveOffersOfTask, openRecoveryIfDue } from './handoffs.ts';

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
  /**
   * The underlying harness that ran, its version, and the model — **self-
   * reported** (D-118, LAI-586), shown as such and decide nothing. A
   * manager's session says which worker harness it started here.
   */
  harness: string | null;
  harness_version: string | null;
  /** Self-reported (§4.65); decides nothing. A heartbeat may change it. */
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
   * How old that heartbeat is **by the server's clock, as of this read**
   * (LAI-597 review). A client must not subtract `last_heartbeat_at` from its
   * own clock — a browser five minutes ahead would call every fresh claim
   * lost — so it ages this by its own elapsed time instead.
   */
  heartbeat_age_ms: number;
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
  /**
   * What the holding session said ran (§4.65, D-118, LAI-593) — the drawer's
   * *Polly · Belka · Claude Code · <model>* from a task read alone. Each is
   * self-reported, as the session last sent it (a heartbeat may change the
   * model), null where it reported nothing, and decides nothing.
   */
  harness: string | null;
  harness_version: string | null;
  model: string | null;
}

/** Whether a heartbeat this old is suspect at `now` — one rule for every view. */
function isSuspect(lastHeartbeatAt: number, now: number): boolean {
  return now - lastHeartbeatAt >= settings.timings.suspectMs;
}

export function sessionView(row: SessionRow, now: number): AgentSessionView {
  return {
    id: row.id,
    agent_id: row.agentId,
    started_at: row.startedAt,
    last_heartbeat_at: row.lastHeartbeatAt,
    ended_at: row.endedAt,
    end_reason: row.endReason,
    client_version: row.clientVersion,
    harness: row.harness,
    harness_version: row.harnessVersion,
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

/** How many of an agent's sessions `GET /agents/:id` shows (D-118). */
export const RECENT_SESSIONS = 20;

/**
 * An agent's most recent sessions, newest first — at most
 * {@link RECENT_SESSIONS} — for its owner's `GET /agents/:id` (D-118,
 * LAI-586). The caller has already established the agent is theirs.
 */
export function recentAgentSessions(db: Db, agentId: string, now: number): AgentSessionView[] {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.agentId, agentId))
    .orderBy(desc(agentSessions.startedAt), desc(agentSessions.id))
    .limit(RECENT_SESSIONS)
    .all()
    .map((row) => sessionView(row, now));
}

// ---------------------------------------------------------------- refusals

/** `409 conflict` with the claim reason in `details` (D-079). */
function claimConflict(
  reason: 'stale_claim' | 'claim_held' | 'claim_paused' | 'selected_for_another_agent',
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

export function requireOpenSession(db: Db, agentId: string, sessionId: string): SessionRow {
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

/**
 * The calling agent's own open session (LAI-555): what a context delivery is
 * recorded against. Not an agent's token is `403 not_an_agent`, another
 * agent's session `404`, an ended one `409`, exactly as a heartbeat answers.
 */
export function requireOwnOpenSession(
  db: Db,
  actor: ResolvedActor,
  sessionId: string,
): { id: string; agentId: string } {
  const row = requireOpenSession(db, requireAgent(actor).id, sessionId);
  return { id: row.id, agentId: row.agentId };
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
      harness: agentSessions.harness,
      harnessVersion: agentSessions.harnessVersion,
      model: agentSessions.model,
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
  for (const {
    claim,
    lastHeartbeatAt,
    sessionEndedAt,
    harness,
    harnessVersion,
    model,
    deviceLabel,
  } of found) {
    if (claim.state === 'active' && leaseLapsed(claim.leaseExpiresAt, now)) continue;
    views.set(claim.taskId, {
      generation: claim.generation,
      // The query's predicate: only the live states reach here.
      state: claim.state as TaskLiveClaimView['state'],
      agent_id: claim.agentId,
      session_id: claim.sessionId,
      lease_expires_at: claim.leaseExpiresAt,
      last_heartbeat_at: lastHeartbeatAt,
      heartbeat_age_ms: Math.max(0, now - lastHeartbeatAt),
      connection: sessionEndedAt !== null || isSuspect(lastHeartbeatAt, now) ? 'suspect' : 'live',
      suspect_after_ms: settings.timings.suspectMs,
      device_label: deviceLabel,
      harness,
      harness_version: harnessVersion,
      model,
    });
  }
  return views;
}

/** The task's newest claim of any state — the highest generation. */
export function latestClaim(db: Db, taskId: string): ClaimRow | undefined {
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

/**
 * What a session says about itself (§4.65, D-118). Every field is
 * self-reported and validated for shape only, by the route; none of them is
 * ever read by `can()`, the fence or a claim.
 */
export interface StartSessionInput {
  client_version?: string | undefined;
  harness?: string | undefined;
  harness_version?: string | undefined;
  model?: string | undefined;
}

/**
 * What a heartbeat may report again: the same fields, each changing only when
 * it is sent — the model can change mid-session (D-118), and a heartbeat that
 * omits a field leaves what the session last said.
 */
export type HeartbeatInput = StartSessionInput;

export function openSession(
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
    harness: input.harness ?? null,
    harnessVersion: input.harness_version ?? null,
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
  input: HeartbeatInput = {},
): HeartbeatView {
  assertCan(actor, 'heartbeat.send_own');
  const agent = requireAgent(actor);

  return immediateTransaction(sqlite, () => {
    const found = requireOpenSession(db, agent.id, sessionId);
    const reported = reportedChanges(input);
    db.update(agentSessions)
      .set({ lastHeartbeatAt: now, ...reported })
      .where(eq(agentSessions.id, found.id))
      .run();
    const session: SessionRow = { ...found, ...reported };

    const active = db
      .select()
      .from(taskClaims)
      .where(and(eq(taskClaims.sessionId, session.id), eq(taskClaims.state, 'active')))
      .all();
    for (const claim of active) {
      if (selectedForAnotherAgent(db, claim)) endClaimOfUnselectedAgent(db, claim, now);
      else if (leaseLapsed(claim.leaseExpiresAt, now)) expireClaim(db, claim, now);
      else renewLease(db, claim, now);
    }
    // **A paused claim is leased exactly like an active one** (§4.66,
    // LAI-546): its holder's offer is live, and the heartbeat keeps it — or,
    // too late, expires it by the same rule.
    const paused = db
      .select()
      .from(taskClaims)
      .where(and(eq(taskClaims.sessionId, session.id), eq(taskClaims.state, 'paused')))
      .all();
    for (const claim of paused) {
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

/** Only the self-reported fields a heartbeat actually sent; absent keeps the old value. */
function reportedChanges(
  input: HeartbeatInput,
): Partial<Pick<SessionRow, 'clientVersion' | 'harness' | 'harnessVersion' | 'model'>> {
  return {
    ...(input.client_version === undefined ? {} : { clientVersion: input.client_version }),
    ...(input.harness === undefined ? {} : { harness: input.harness }),
    ...(input.harness_version === undefined ? {} : { harnessVersion: input.harness_version }),
    ...(input.model === undefined ? {} : { model: input.model }),
  };
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
 * The fence (proposal §4.2, SPEC §6.3): may this caller change this task now?
 *
 * Called by every task-mutating service **inside its write**, before it
 * writes — directly or, for a change that reaches tasks indirectly (a sprint
 * deleted, a status deleted, a tag removed, work handed on when someone
 * leaves, a heartbeat's branch), once for every task it would change. `now` is
 * the write's own clock, so a test that injects one fences against it.
 *
 * ## The rule, in order
 *
 * 1. The system and **a person signed in** pass: people keep explicit control.
 * 2. A task with a **live** claim may be changed by its holder's agent with
 *    the live generation and an unlapsed lease, and by nobody else with a
 *    token: another agent — the same person's included — or a legacy token
 *    is `claim_held`; the holder's agent with no, or the wrong, generation is
 *    `stale_claim`.
 * 3. A task whose **newest claim lapsed** — `expired` or `transferred` while
 *    the task stayed in progress — is refused to every token, generation or
 *    not: the agent that held it is `stale_claim` with `reclaim: true`, and
 *    the explicit reclaim is its only way back; anyone else is `claim_held`,
 *    waiting for recovery (LAI-546). **Omitting the generation is not a way
 *    round a lapsed claim.**
 * 4. A task nobody holds (never claimed, or its claim released) may be
 *    changed by a token without a generation; a generation sent there names
 *    no live claim and is `stale_claim`.
 */
export function assertClaimFence(db: Db, actor: ServiceCaller, taskId: string, now: number): void {
  const refusal = claimFenceRefusal(db, actor, taskId, now);
  if (refusal !== null) throw refusal;
}

/** {@link assertClaimFence} for every task a change would touch, before any is touched. */
export function assertClaimFenceAll(
  db: Db,
  actor: ServiceCaller,
  taskIds: readonly string[],
  now: number,
): void {
  for (const id of taskIds) assertClaimFence(db, actor, id, now);
}

/** The fence's answer without throwing: the refusal, or null when the change may go ahead. */
export function claimFenceRefusal(
  db: Db,
  actor: ServiceCaller,
  taskId: string,
  now: number,
): ApiError | null {
  if (isSystemPrincipal(actor)) return null;
  if (actor.token === null || actor.token === undefined) return null;

  const agent = registeredAgent(actor);
  const generation = actor.claimGeneration;
  const live = liveClaim(db, taskId);

  if (live !== undefined) {
    if (agent === null) {
      return claimConflict(
        'claim_held',
        'A registered agent holds this task; a token with no agent cannot change it',
        { task_id: taskId, agent_id: live.agentId },
      );
    }
    if (live.agentId !== agent.id) {
      // **The caller's own claim lapsed** — handed on (`transferred`) or
      // expired and recovered by another agent (§4.73, LAI-546): §6.3 answers
      // `stale_claim`, generation or not. Its generation is invalid for good;
      // the task being held by somebody else is the consequence, not the news.
      const own = newestClaimOfAgent(db, taskId, agent.id);
      if (own?.state === 'transferred' || own?.state === 'expired') {
        return claimConflict('stale_claim', 'Your claim on this task was handed on or lapsed', {
          task_id: taskId,
          claim_generation: own.generation,
          claim_state: own.state,
        });
      }
      return claimConflict('claim_held', 'Another agent session holds this task', {
        task_id: taskId,
        agent_id: live.agentId,
      });
    }
    // D-119: a claim the selection does not back is never usable — it ends at
    // the holder's next heartbeat or its lease ({@link endClaimOfUnselectedAgent}).
    if (selectedForAnotherAgent(db, live)) {
      return claimConflict(
        'selected_for_another_agent',
        'This task is selected for another agent; your claim on it is ending',
        { task_id: taskId, claim_generation: live.generation },
      );
    }
    if (generation === undefined) {
      return claimConflict(
        'stale_claim',
        'This task is claimed; send the claim generation with every change',
        { task_id: taskId, claim_generation: null },
      );
    }
    if (live.generation !== generation) {
      return claimConflict('stale_claim', 'That claim generation is no longer valid', {
        task_id: taskId,
        claim_generation: generation,
      });
    }
    if (live.state === 'paused') {
      return claimConflict('claim_paused', 'This claim is paused while a hand-off is open', {
        task_id: taskId,
        claim_generation: generation,
      });
    }
    if (leaseLapsed(live.leaseExpiresAt, now)) {
      return claimConflict('stale_claim', 'That claim’s lease has lapsed', {
        task_id: taskId,
        claim_generation: generation,
        lease_expires_at: live.leaseExpiresAt,
      });
    }
    return null;
  }

  const lapsed = lapsedClaim(db, taskId);
  if (lapsed !== undefined) {
    if (agent !== null && lapsed.agentId === agent.id) {
      return claimConflict(
        'stale_claim',
        'Your claim on this task lapsed; reclaim it before changing the task',
        { task_id: taskId, claim_generation: lapsed.generation, reclaim: true },
      );
    }
    return claimConflict('claim_held', 'This task’s claim lapsed and is waiting for recovery', {
      task_id: taskId,
      agent_id: lapsed.agentId,
      claim_state: lapsed.state,
    });
  }

  if (generation !== undefined && agent !== null) {
    return claimConflict('stale_claim', 'That claim generation is no longer valid', {
      task_id: taskId,
      claim_generation: generation,
    });
  }
  return null;
}

/** This agent's newest claim on the task, of any state. */
function newestClaimOfAgent(db: Db, taskId: string, agentId: string): ClaimRow | undefined {
  return db
    .select()
    .from(taskClaims)
    .where(and(eq(taskClaims.taskId, taskId), eq(taskClaims.agentId, agentId)))
    .orderBy(desc(taskClaims.generation))
    .limit(1)
    .get();
}

/**
 * The task's newest claim when it **lapsed** — `expired` or `transferred` —
 * while the task stayed in progress, and no claim is live. A person moving the
 * task out of progress ends that state; a release never starts it.
 */
function lapsedClaim(db: Db, taskId: string): ClaimRow | undefined {
  const latest = latestClaim(db, taskId);
  if (latest?.state !== 'expired' && latest?.state !== 'transferred') return undefined;
  const task = db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId)).get();
  return task?.status === 'in_progress' ? latest : undefined;
}

/** Whether this actor's agent holds the task's live claim — the review rule's holder (§5). */
export function holdsLiveClaim(db: Db, actor: ServiceCaller, taskId: string): boolean {
  const agent = registeredAgent(actor);
  if (agent === null) return false;
  return liveClaim(db, taskId)?.agentId === agent.id;
}

/**
 * A task left `in_progress` (§5): whatever claim was live on it is released,
 * inside the status write. The holder finishing into review, a person moving
 * it on — either way nobody is working it under that claim any more, and its
 * generation is refused from here on.
 */
export function releaseLiveClaim(db: Db, taskId: string, now: number): void {
  // A task that leaves progress has no live offer (§4.73 `task_closed`): the
  // system closes each, before the claim it paused is released.
  closeLiveOffersOfTask(db, taskId, 'task_closed', systemPrincipal(), now);
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
  task: Pick<TaskRow, 'id'>,
  input: TakeClaimInput,
): TakenClaim {
  const agent = requireAgent(actor);
  const { now } = input;

  // D-119, before a session is opened for the attempt — and with **no
  // exemption for a holder renewing**: a claim held by an agent that is not
  // the selected one (taken before the rule, or before the selection) is not
  // renewed here, and ends as {@link endClaimOfUnselectedAgent} says.
  assertSelectedAgentMayClaim(db, actor, task.id, agent.id);

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
    // **A paused claim is renewed by its own session** (§4.66, §9.1.1,
    // LAI-546 review): an MCP-only sender renews by `start_working`, and its
    // offer lives longer than one lease. It stays paused — the renewal is the
    // only thing that changes; every write is still `claim_paused`.
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

  const lapsed = lapsedClaim(db, task.id);
  if (lapsed !== undefined) {
    if (lapsed.agentId === agent.id) {
      throw claimConflict('stale_claim', 'Your claim on this task expired; reclaim it explicitly', {
        task_id: task.id,
        claim_generation: lapsed.generation,
        reclaim: true,
      });
    }
    throw claimConflict('claim_held', 'This task’s claim lapsed and is waiting for recovery', {
      task_id: task.id,
      agent_id: lapsed.agentId,
      claim_state: lapsed.state,
    });
  }

  const claim = insertClaim(db, task.id, session.id, agent.id, now);
  acceptWorkRequest(db, task.id, agent.id, now);
  return { claim, resumed: false };
}

export function insertClaim(
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

// ---------------------------------------------------------- the selected agent

/**
 * **D-119: the selected agent owns the claim.** A task that names its agent
 * (`tasks.selected_agent_id`, LAI-535) may be claimed — or reclaimed — only by
 * a session of **that** agent; any other agent is `409 conflict`, `reason:
 * selected_for_another_agent`. A task with no selected agent is anyone
 * eligible's, as before. Only a registered agent's claim passes here: a person
 * and a legacy token claim by assignee, unchanged.
 *
 * Asked **after** the caller's own `task.claim` — so a caller who may not
 * claim hears that, and learns nothing about the selection — and the refusal
 * names the selected agent only when the caller may read the task's project,
 * where `TaskView.selected_agent` already shows it to them. Never more than
 * that read would.
 */
export function assertSelectedAgentMayClaim(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  agentId: string,
): void {
  const task = db
    .select({ projectId: tasks.projectId, selectedAgentId: tasks.selectedAgentId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task?.selectedAgentId === null || task?.selectedAgentId === undefined) return;
  if (task.selectedAgentId === agentId) return;

  const details: Record<string, unknown> = { task_id: taskId };
  // `<harness> · <device>`, the agent's label (D-120), when the caller may see it.
  let named: string | null = null;
  if (can(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId })) {
    const selected = db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        ownerUserId: agents.ownerUserId,
        harness: agents.harness,
        deviceLabel: agents.deviceLabel,
      })
      .from(agents)
      .where(eq(agents.id, task.selectedAgentId))
      .get();
    if (selected !== undefined) {
      details.selected_agent_id = selected.id;
      details.selected_agent = {
        id: selected.id,
        // The registered name is its owner's alone (D-120, LAI-1001).
        display_name: selected.ownerUserId === actor.userId ? selected.displayName : null,
        harness: selected.harness,
        device_label: selected.deviceLabel,
      };
      named = `${selected.harness} · ${selected.deviceLabel ?? 'no device'}`;
    }
  }
  throw claimConflict(
    'selected_for_another_agent',
    named === null
      ? 'This task is selected for another agent; only that agent can claim it'
      : `This task is selected for ${named}; only that agent can claim it`,
    details,
  );
}

/**
 * The one refusal a claim gives for a task it cannot show the caller — **the
 * same bytes whether the task does not exist or the caller may not read its
 * project** (LAI-586 review). No id in it, so a board key resolved to a task
 * the caller cannot see answers exactly as a key that names nothing.
 */
export function noSuchTaskToClaim(): ApiError {
  return ApiError.notFound('No such task');
}

/**
 * The task and its project for a claim or reclaim — or {@link
 * noSuchTaskToClaim} when it does not exist **or** the caller may not read
 * its project. Visibility first, then the caller's own `task.claim`, then
 * D-119: each answer discloses no more than the one before it allowed.
 */
export function requireVisibleTaskToClaim(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
): { task: TaskRow; project: typeof projects.$inferSelect } {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  const project =
    task === undefined
      ? undefined
      : db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (
    task === undefined ||
    project === undefined ||
    !can(withProject(actor, project.id), 'project.read', { projectId: project.id })
  ) {
    throw noSuchTaskToClaim();
  }
  return { task, project };
}

/** Whether the claim's task names a selected agent that is not the claim's (D-119). */
function selectedForAnotherAgent(db: Db, claim: Pick<ClaimRow, 'taskId' | 'agentId'>): boolean {
  const selected = db
    .select({ id: tasks.selectedAgentId })
    .from(tasks)
    .where(eq(tasks.id, claim.taskId))
    .get()?.id;
  return selected !== null && selected !== undefined && selected !== claim.agentId;
}

/**
 * **A claim held by an agent that is not the task's selected agent** (D-119,
 * LAI-586 review). The API cannot make one any more — a claim needs the
 * selection, and the selection cannot change under a live claim — but a claim
 * taken before the rule, or before the selection, can still be live.
 *
 * It is **never renewed and never usable**: `start_working` and the reclaim
 * refuse it `selected_for_another_agent`, and so does the fence for any change
 * made under it. It ends at its holder's next heartbeat, or when its lease
 * would have lapsed, whichever is first — **`released`, not `expired`**: an
 * expired claim waits for its holder to reclaim or for recovery, and this
 * holder may never reclaim, so `expired` would leave the selected agent locked
 * out of its own task. Released, the selected agent can claim at once, and the
 * old generation is refused for good. Recorded as the system (§3.4) — the rule
 * ended it, not a person — as `task.updated`, `field: 'claim'`, the inverse of
 * the row a claim on work under way writes.
 */
function endClaimOfUnselectedAgent(db: Db, claim: ClaimRow, now: number): void {
  const changed = db
    .update(taskClaims)
    .set({ state: 'released', endedAt: now })
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
    type: 'task.updated',
    payload: {
      field: 'claim',
      from: { generation: claim.generation, session_id: claim.sessionId, agent_id: claim.agentId },
      to: null,
      reason: 'selected_for_another_agent',
    },
    now,
  });
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

export type FreshAgentActor = ResolvedActor & {
  token: NonNullable<ResolvedActor['token']> & { agent: AgentContext };
};

/**
 * The reclaiming actor, read again from the database (LAI-541 review): the
 * owner — active, with today's role and memberships — the token — live and
 * `full` — and the agent — active, with today's grants. Each refusal is
 * `403 forbidden` with the reason that names it.
 */
export function reloadAgentActor(
  db: Db,
  actor: ResolvedActor,
  now: number,
  action:
    | 'task.claim'
    | 'task.checkpoint.create'
    | 'task.checkpoint.retag'
    | 'task.handoff.offer'
    | 'task.handoff.accept'
    | 'task.handoff.decline'
    | 'task.handoff.cancel' = 'task.claim',
): FreshAgentActor {
  const refuse = (reason: string, message: string) =>
    new ApiError('forbidden', message, { action, reason });

  const tokenId = actor.token?.id;
  const token =
    tokenId === undefined
      ? undefined
      : db.select().from(tokens).where(eq(tokens.id, tokenId)).get();
  if (token === undefined) throw refuse('token_revoked', 'That token is no longer valid');
  // The agent before the token: revoking an agent revokes its tokens too, and
  // "your agent was revoked" is the answer that says why.
  const agent = token.agentId === null ? null : loadAgent(db, token.agentId);
  if (agent?.status !== 'active') throw refuse('agent_revoked', 'That agent is revoked');
  if (token.revokedAt !== null || (token.expiresAt !== null && token.expiresAt <= now)) {
    throw refuse('token_revoked', 'That token is no longer valid');
  }
  if (token.scope !== 'full') {
    throw refuse('token_read_only', 'This needs a token with full scope');
  }

  const owner = loadActor(db, token.userId);
  if (owner?.isActive !== true) {
    throw refuse('owner_inactive', 'The person this agent acts for is deactivated');
  }

  return {
    ...owner,
    token: { id: token.id, scope: token.scope, projectIds: tokenProjectIds(token), agent },
  };
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
    // **Everything as it is now, read inside this transaction** — not from
    // the actor the request resolved, which was loaded before the lock and
    // may describe a person deactivated, a token revoked or a grant narrowed
    // since. The order is what the caller can fix least first. The caller
    // before the task: those refusals say nothing about which task was named.
    const fresh = reloadAgentActor(db, actor, now);
    // A task the caller cannot read is answered exactly as one that does not
    // exist (LAI-586 review), so the reclaim discloses nothing about either.
    const { task, project } = requireVisibleTaskToClaim(db, fresh, taskId);
    const grant = fresh.token.agent.grants.get(project.id);
    if (grant !== 'full') {
      throw new ApiError('forbidden', 'This agent may not work in that project', {
        action: 'task.claim',
        reason: grant === undefined ? 'agent_not_granted' : 'agent_read_only',
      });
    }
    // The owner's own permission, with the agent step and the space rules,
    // through `can()` as every claim asks it — on the reloaded actor.
    assertCan(withProject(fresh, project.id), 'task.claim', { projectId: project.id });
    // **An accepted offer from the generation being reclaimed** (§9.1.1,
    // LAI-546): the task is somebody else's now — `offer_taken`, asked before
    // D-119 and the live claim: an accept moves the selection and the claim,
    // and the old holder should hear why rather than a bare refusal.
    const mine = newestClaimOfAgent(db, taskId, agent.id);
    if (mine?.state === 'expired') assertNoAcceptedOfferFrom(db, taskId, mine.generation);

    // D-119: the selection may have moved to another agent while the claim was
    // expired (no live claim holds it then); taking it back would be a claim.
    assertSelectedAgentMayClaim(db, fresh, taskId, agent.id);

    // A claim is held only on work in progress (§5): a task a person moved on
    // since the claim expired has nothing to take back.
    if (task.status !== 'in_progress') {
      throw new ApiError('conflict', 'Only a task still in progress can be reclaimed', {
        reason: 'task_not_claimable',
        task_id: taskId,
        status: task.status,
      });
    }

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

    // Every outstanding hand-off and recovery offer is invalidated, before
    // the new claim (§9.1.1): `cancelled`, `reclaimed`, a row each.
    closeLiveOffersOfTask(db, taskId, 'reclaimed', fresh, now);

    const session =
      input.sessionId === undefined
        ? openSession(db, fresh, agent, {}, now)
        : requireOpenSession(db, agent.id, input.sessionId);
    const claim = insertClaim(db, taskId, session.id, agent.id, now);
    // A reclaim is a claim (LAI-586 review round 2): the open work request
    // addressed to this agent — re-issued if the selection moved away and
    // back while the claim was expired — is accepted in the same transaction,
    // exactly as a fresh claim accepts it.
    acceptWorkRequest(db, taskId, agent.id, now);

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(fresh),
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
 * A claim that lapsed opens a recovery offer — never a silent reassignment
 * (§11.6, proposal §4.2) — in the transaction that expired it. The scan and
 * the heartbeat both come here, so every expiry gets it; a task whose claim
 * had a live hand-off gets its recovery when that offer closes unaccepted.
 */
export function afterClaimExpired(db: Db, claim: ClaimRow, now: number): void {
  openRecoveryIfDue(db, claim.taskId, now);
}

/** Mark one claim `expired` and write `task.claim_expired` as the system (§3.4). */
export function expireClaim(db: Db, claim: ClaimRow, now: number): void {
  const changed = db
    .update(taskClaims)
    .set({ state: 'expired', endedAt: now })
    .where(and(eq(taskClaims.id, claim.id), inArray(taskClaims.state, [...LIVE_CLAIM_STATES])))
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
 * §11.6's expiry scan: every live claim — `active` or `paused` — whose lease has lapsed becomes
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
    .where(
      and(inArray(taskClaims.state, [...LIVE_CLAIM_STATES]), lte(taskClaims.leaseExpiresAt, now)),
    )
    .all()
    .filter((claim) => leaseLapsed(claim.leaseExpiresAt, now));

  // One transaction a claim: the state and its `task.claim_expired` row land
  // together or not at all, so a crash between them cannot leave a claim
  // expired with no record, or a record of an expiry that did not happen.
  // `immediate` for the write lock before the read inside `expireClaim`.
  for (const claim of overdue) {
    db.transaction(
      () => {
        if (claim.state === 'active' && selectedForAnotherAgent(db, claim)) {
          endClaimOfUnselectedAgent(db, claim, now);
        } else expireClaim(db, claim, now);
      },
      { behavior: 'immediate' },
    );
  }
  return { changed: overdue.length };
}
