import type Database from 'better-sqlite3';
import { and, desc, eq, gt, isNotNull, isNull, lt, type SQL } from 'drizzle-orm';
import {
  activityActor,
  reloadActor,
  type ResolvedActor,
  withProject,
} from '../auth/resolve-actor.ts';
import { TokenAuthError } from '../auth/tokens.ts';
import { appendActivity } from '../db/activity.ts';
import { CAPACITY_PING_OPEN_MS } from '../db/agent-events.ts';
import { type Db } from '../db/client.ts';
import { type AgentStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { presenceEnabled } from '../db/orgs.ts';
import {
  agentEventDeliveries,
  agentLauncherReports,
  agents,
  capacityPings,
  type projects,
  tasks,
} from '../db/schema.ts';
import { ApiError, isApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { registeredAgent } from './claims.ts';
import { mayReceiveFrom } from './handoffs.ts';
import { requireReadableProjectBySlug } from './projects.ts';
import { assertAgentSelectable } from './work-requests.ts';

/**
 * Capacity pings and launcher presence (SPEC §4.83, §4.84, §6.4, D-126,
 * LAI-1038).
 *
 * ## Who may ping
 *
 * **Whoever may delegate to the agent** (D-126 item 1), and the same answer on
 * every path: `can(agent.ping)` on the project — the caller's role, or an
 * agent's owner's narrowed by its grant and token — and then the agent's own
 * facts. A **person** may ping an agent they could select on that project
 * (`assertAgentSelectable`, their own, active, `full`, agents allowed). An
 * **agent** may ping an agent it could offer the project's work to: it holds
 * `task.handoff.offer` there and §4.73's receiver rule accepts the target,
 * `allow_other_owners` included (`mayReceiveFrom`). **Every refusal is the
 * agent `404`** — byte for byte an id that names no agent (D-121 item 7) — so
 * a ping cannot be used to learn that an id is real, and the rate buckets are
 * spent only by somebody who may ping at all.
 *
 * ## How a ping travels
 *
 * A ping is an `agent.capacity_requested` activity row, written with the
 * `capacity_pings` row in one transaction; `appendActivity` delivers it to the
 * pinged agent only (§4.77), and the stream and the durable inbox carry it as
 * they carry a work request. It carries no free text.
 *
 * ## The answer
 *
 * POSTed with **the pinged agent's own token** under `heartbeat.send_own` —
 * its record about itself, like a client report — once, within 60 s, as a
 * closed object the route validates. It is **not** activity: the project's
 * stream reaches every reader, and the answer is only for whoever pinged and
 * the agent's owner.
 *
 * ## Presence is a report, never a command
 *
 * A launcher reports itself per agent with that agent's token. The board
 * says `on` only for a report under {@link LAUNCHER_FRESH_MS} that says
 * enabled. Nothing here starts, stops or configures anything on a device.
 */

/** A ping's clocks (D-126 items 2 and 3, plan §4). */
export const CAPACITY_PING_LIMITS = {
  /** A ping takes an answer for this long after it is made. */
  openMs: CAPACITY_PING_OPEN_MS,
  /** A repeat by the same requester inside this returns the ping still open. */
  repeatMs: 15_000,
  /** The longest a request may be held for its answer. */
  maxWaitMs: 10_000,
  /** Rows older than this are deleted when the next ping is written. */
  retentionMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * D-126 item 2's limits, **per minute**: per requester per agent, and per
 * agent across everyone. Token buckets in `HANDOFF_RATE`'s style — a burst of
 * the limit, refilled continuously.
 */
export const CAPACITY_PING_RATE = { perRequesterAgent: 4, perAgent: 30 } as const;

/** A presence report says `on` only while it is younger than this (D-126 item 4). */
export const LAUNCHER_FRESH_MS = 180_000;

/** What the board shows of a launcher. `unknown`: it said enabled, too long ago to say now. */
export const LAUNCHER_STATES = ['on', 'off', 'unknown'] as const;
export type LauncherState = (typeof LAUNCHER_STATES)[number];

export interface AutoPickup {
  work_requests: boolean;
  handoffs: boolean;
}

/**
 * One agent's launcher as the board shows it (§4.83). Never reported: `off`,
 * every other field null. While the org has presence off (§4.2) the two times
 * are null and an enabled report is `unknown`, whatever is stored.
 */
export interface LauncherView {
  state: LauncherState;
  reported_at: number | null;
  started_at: number | null;
  running: number | null;
  max_concurrent: number | null;
  auto_pickup: AutoPickup | null;
  cli_version: string | null;
}

/** `PUT /agents/me/launcher` (§6.4): the report as stored, and the word it makes now. */
export interface LauncherReportView extends LauncherView {
  agent_id: string;
  enabled: boolean;
}

export const BATTERY_STATES = ['ok', 'low', 'unsupported', 'unavailable'] as const;
export const MEMORY_STATES = ['normal', 'warn', 'critical', 'unsupported', 'unavailable'] as const;
export const ANSWERED_BY = ['launcher', 'session'] as const;

/**
 * The answer a device gives (§4.84, D-126 item 3): **closed and capped** — no
 * path, host name, repository or task text can be put in it, and a reading
 * the device could not take is a word, never a number.
 */
export interface CapacityAnswer {
  launcher:
    | { state: 'on'; auto_pickup: AutoPickup; running: number; max_concurrent: number }
    | { state: 'off' };
  harness_ready: { credential: boolean; argv: boolean; hooks: boolean };
  session_live: boolean;
  battery:
    | { state: 'ok' | 'low'; percent: number; plugged?: boolean | undefined }
    | { state: 'unsupported' | 'unavailable' };
  memory: { state: (typeof MEMORY_STATES)[number] };
  cli_version: string;
  answered_by: (typeof ANSWERED_BY)[number];
}

export const CAPACITY_PING_STATES = ['pending', 'answered', 'expired'] as const;
export type CapacityPingState = (typeof CAPACITY_PING_STATES)[number];

/** One ping as whoever pinged, and the agent's owner, read it (§4.84). */
export interface CapacityPingView {
  id: string;
  agent_id: string;
  project_id: string;
  task_id: string | null;
  state: CapacityPingState;
  requested_by: {
    user_id: string;
    /** The pinging agent — to its own owner only, as an activity row names it (D-121 item 7). */
    agent_id: string | null;
  };
  created_at: number;
  expires_at: number;
  answered_at: number | null;
  answer: CapacityAnswer | null;
}

/** `GET /agents/:id/capacity` (§6.4): presence, and the newest answer this reader may see. */
export interface AgentCapacityView {
  agent_id: string;
  launcher: LauncherView;
  latest_answer: CapacityPingView | null;
  now: number;
}

type PingRow = typeof capacityPings.$inferSelect;
type ReportRow = typeof agentLauncherReports.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

// ----------------------------------------------------------------- refusals

/** One answer for a ping that does not exist and one the caller may not see. */
function noSuchPing(): ApiError {
  return ApiError.notFound('No such capacity ping');
}

function notAnAgent(): ApiError {
  return new ApiError('forbidden', 'Only a registered agent’s token does this', {
    reason: 'not_an_agent',
  });
}

// --------------------------------------------------------------- who may ping

/**
 * May `actor` ping `agentId` in `project`? D-126 item 1, through `can()`
 * first and then the agent's own facts. A plain yes or no: the caller turns a
 * no into the agent `404`, whichever check said it.
 */
function mayPing(db: Db, actor: ResolvedActor, project: ProjectRow, agentId: string): boolean {
  const scoped = withProject(actor, project.id);
  if (!can(scoped, 'agent.ping', { projectId: project.id })) return false;
  if (registeredAgent(actor) === null) {
    // A person: an agent they could select here — every refusal of it alike.
    try {
      assertAgentSelectable(db, actor, project, agentId);
      return true;
    } catch (error) {
      if (isApiError(error)) return false;
      throw error;
    }
  }
  // An agent: one it could hand this project's work to (§4.73).
  if (!can(scoped, 'task.handoff.offer', { projectId: project.id })) return false;
  return mayReceiveFrom(db, project, agentId, actor.userId);
}

/** The project by slug, then the agent — or the agent `404`, whatever failed after the project. */
function requirePingable(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  projectSlug: string,
): ProjectRow {
  const project = requireReadableProjectBySlug(db, actor, projectSlug);
  if (!mayPing(db, actor, project, agentId)) throw ApiError.agentNotFound();
  return project;
}

/** A task of this project, or `404` — a task of another project reads as none. */
function requireTaskOf(db: Db, projectId: string, taskId: string): string {
  const task = db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task?.projectId !== projectId) throw ApiError.notFound('No such task in this project');
  return task.id;
}

// ----------------------------------------------------------------- rate limit

/**
 * The two buckets of D-126 item 2, kept here because the keys are the
 * requester and the agent, which only the service knows, and both transports
 * pass through it. Services import nothing from `http/` (CONVENTIONS §2).
 */
const buckets = new Map<string, { tokens: number; at: number }>();

/** A test starts each case with full buckets. */
export function resetCapacityPingRateLimits(): void {
  buckets.clear();
}

function refilled(key: string, burst: number, now: number): { tokens: number; at: number } {
  const perMs = burst / 60_000;
  const bucket = buckets.get(key) ?? { tokens: burst, at: now };
  return {
    tokens: Math.min(burst, bucket.tokens + Math.max(0, now - bucket.at) * perMs),
    at: now,
  };
}

/** Spend one from both buckets, or neither: `429` naming how long to wait. */
function spendPingTokens(requesterKey: string, agentId: string, now: number): void {
  const pair = [
    { key: `pair:${requesterKey}:${agentId}`, burst: CAPACITY_PING_RATE.perRequesterAgent },
    { key: `agent:${agentId}`, burst: CAPACITY_PING_RATE.perAgent },
  ].map((b) => ({ ...b, bucket: refilled(b.key, b.burst, now) }));
  const short = pair.filter((b) => b.bucket.tokens < 1);
  if (short.length > 0) {
    const waitMs = Math.max(...short.map((b) => ((1 - b.bucket.tokens) * 60_000) / b.burst));
    throw new ApiError('rate_limited', 'Too many capacity pings for this agent', {
      reason: 'capacity_ping_rate',
      // Never below a second (§6.3): `Retry-After: 0` invites a retry that fails.
      retry_after_seconds: Math.max(1, Math.ceil(waitMs / 1000)),
    });
  }
  for (const b of pair) buckets.set(b.key, { tokens: b.bucket.tokens - 1, at: now });
}

// ------------------------------------------------------------------ waiting

/** Requests held open for an answer, by ping id — woken by {@link replyToPing}. */
const waiters = new Map<string, Set<() => void>>();

/**
 * The pings a request is already being held for, by ping and requester: one
 * held request each (LAI-1038 review). A repeat inside the 15 s window spends
 * no bucket, so without this it could hold a connection open per repeat.
 */
const held = new Set<string>();

/**
 * Resolve when the ping is answered or `waitMs` passes, whichever is first.
 * One process holds the database (§11.1), so a wake-up here is every answer.
 */
export function waitForAnswer(pingId: string, waitMs: number): Promise<void> {
  if (waitMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const set = waiters.get(pingId) ?? new Set<() => void>();
    waiters.set(pingId, set);
    const done = (): void => {
      clearTimeout(timer);
      set.delete(done);
      if (set.size === 0) waiters.delete(pingId);
      resolve();
    };
    const timer = setTimeout(done, Math.min(waitMs, CAPACITY_PING_LIMITS.maxWaitMs));
    set.add(done);
  });
}

function wake(pingId: string): void {
  for (const done of [...(waiters.get(pingId) ?? [])]) done();
}

// -------------------------------------------------------------------- views

function stateOf(row: PingRow, now: number): CapacityPingState {
  if (row.answeredAt !== null) return 'answered';
  return now >= row.expiresAt ? 'expired' : 'pending';
}

function pingView(actor: ResolvedActor, row: PingRow, now: number): CapacityPingView {
  return {
    id: row.id,
    agent_id: row.agentId,
    project_id: row.projectId,
    task_id: row.taskId,
    state: stateOf(row, now),
    requested_by: {
      user_id: row.requestedByUserId,
      agent_id: actor.userId === row.requestedByUserId ? row.requestedByAgentId : null,
    },
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    answered_at: row.answeredAt,
    answer: row.replyJson === null ? null : (JSON.parse(row.replyJson) as CapacityAnswer),
  };
}

function ownerOf(db: Db, agentId: string): string | null {
  return (
    db.select({ owner: agents.ownerUserId }).from(agents).where(eq(agents.id, agentId)).get()
      ?.owner ?? null
  );
}

/**
 * May `actor` read this ping? Whoever pinged — the person, or their agent —
 * and the pinged agent's owner (D-126 item 3), while they may still read its
 * project. `project.read` is this read's `can()`.
 */
function mayReadPing(db: Db, actor: ResolvedActor, row: PingRow): boolean {
  if (!can(withProject(actor, row.projectId), 'project.read', { projectId: row.projectId })) {
    return false;
  }
  return actor.userId === row.requestedByUserId || ownerOf(db, row.agentId) === actor.userId;
}

// --------------------------------------------------------------------- ping

export interface PingAgentInput {
  projectSlug: string;
  taskId?: string | null | undefined;
  now?: number;
}

export interface PingAgentResult {
  ping: CapacityPingView;
  /** False when a repeat inside {@link CAPACITY_PING_LIMITS.repeatMs} returned the open ping. */
  created: boolean;
}

/**
 * `POST /agents/:id/capacity-pings`, `ping_agent` (§6.4, §7.1): ask the
 * agent's device for its capacity. Answers at once; {@link pingAndWait} holds
 * it for the answer.
 */
export function pingAgent(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  input: PingAgentInput,
): PingAgentResult {
  const now = input.now ?? Date.now();
  const project = requirePingable(db, actor, agentId, input.projectSlug);
  const taskId =
    input.taskId === undefined || input.taskId === null
      ? null
      : requireTaskOf(db, project.id, input.taskId);
  const byAgent = registeredAgent(actor)?.id ?? null;

  return immediateTransaction(sqlite, () => {
    // Asked again inside the write lock: a ping between the read and the lock
    // must not make this a second one.
    const same: SQL[] = [
      eq(capacityPings.agentId, agentId),
      eq(capacityPings.requestedByUserId, actor.userId),
      byAgent === null
        ? isNull(capacityPings.requestedByAgentId)
        : eq(capacityPings.requestedByAgentId, byAgent),
      eq(capacityPings.projectId, project.id),
      taskId === null ? isNull(capacityPings.taskId) : eq(capacityPings.taskId, taskId),
      isNull(capacityPings.answeredAt),
      gt(capacityPings.createdAt, now - CAPACITY_PING_LIMITS.repeatMs),
      gt(capacityPings.expiresAt, now),
    ];
    const open = db
      .select()
      .from(capacityPings)
      .where(and(...same))
      .orderBy(desc(capacityPings.createdAt))
      .get();
    if (open !== undefined) return { ping: pingView(actor, open, now), created: false };

    spendPingTokens(byAgent ?? `user:${actor.userId}`, agentId, now);
    db.delete(capacityPings)
      .where(lt(capacityPings.createdAt, now - CAPACITY_PING_LIMITS.retentionMs))
      .run();

    const id = newId();
    const expiresAt = now + CAPACITY_PING_LIMITS.openMs;
    const row = appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(actor),
      type: 'agent.capacity_requested',
      payload: { ping_id: id, agent_id: agentId, expires_at: expiresAt },
      now,
    });
    const ping: PingRow = {
      id,
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      agentId,
      requestedByUserId: actor.userId,
      requestedByAgentId: byAgent,
      activityId: row.id,
      createdAt: now,
      expiresAt,
      answeredAt: null,
      replyJson: null,
    };
    db.insert(capacityPings).values(ping).run();
    return { ping: pingView(actor, ping, now), created: true };
  });
}

/**
 * {@link pingAgent}, then hold for the answer up to `waitMs` (at most
 * {@link CAPACITY_PING_LIMITS.maxWaitMs}): `answered`, or `pending` when the
 * wait ran out first. The ping read again is the one the caller may read.
 */
export async function pingAndWait(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  input: PingAgentInput & { waitMs: number; clock?: () => number },
): Promise<PingAgentResult> {
  const clock = input.clock ?? Date.now;
  const first = pingAgent(sqlite, db, actor, agentId, { ...input, now: input.now ?? clock() });
  if (first.ping.state !== 'pending' || input.waitMs <= 0) return first;
  // A repeat while this requester's request for the ping is held answers now,
  // with the ping as it stands: one held request per requester per ping.
  const key = `${first.ping.id}:${registeredAgent(actor)?.id ?? `user:${actor.userId}`}`;
  if (held.has(key)) return first;
  held.add(key);
  try {
    const left = Math.min(input.waitMs, first.ping.expires_at - clock());
    await waitForAnswer(first.ping.id, left);
  } finally {
    held.delete(key);
  }
  return { ping: getPing(db, actor, first.ping.id, clock()), created: first.created };
}

/** `GET /capacity-pings/:id` (§6.4): one ping, to whoever pinged and the agent's owner. */
export function getPing(
  db: Db,
  actor: ResolvedActor,
  pingId: string,
  now: number = Date.now(),
): CapacityPingView {
  const row = db.select().from(capacityPings).where(eq(capacityPings.id, pingId)).get();
  if (row === undefined || !mayReadPing(db, actor, row)) throw noSuchPing();
  return pingView(actor, row, now);
}

// -------------------------------------------------------------------- reply

/**
 * `POST /agents/me/capacity-pings/:id/reply` (§6.4): the pinged agent's own
 * token answers, once, inside the ping's minute. In one transaction, with the
 * credential read again inside it, as an acknowledgement is (§4.77).
 *
 * - A ping not addressed to this agent, or one it may no longer read, is the
 *   `404` a ping that does not exist gets.
 * - A second answer is `409 already_answered`, whenever it comes; a first
 *   answer after the minute is `409 ping_expired`.
 */
export function replyToPing(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  pingId: string,
  answer: CapacityAnswer,
  now: number = Date.now(),
): CapacityPingView {
  assertCan(actor, 'heartbeat.send_own');
  if (registeredAgent(actor) === null) throw notAnAgent();

  const view = immediateTransaction(sqlite, () => {
    const fresh = reloadActor(db, actor, now);
    if (!fresh.ok) throw new TokenAuthError(fresh.reason);
    const current = fresh.actor;
    assertCan(current, 'heartbeat.send_own');
    const agentId = registeredAgent(current)?.id;

    const row = db.select().from(capacityPings).where(eq(capacityPings.id, pingId)).get();
    if (
      row === undefined ||
      agentId === undefined ||
      row.agentId !== agentId ||
      !can(withProject(current, row.projectId), 'project.read', { projectId: row.projectId })
    ) {
      throw noSuchPing();
    }
    if (row.answeredAt !== null) {
      throw new ApiError('conflict', 'This ping was already answered', {
        reason: 'already_answered',
        ping_id: row.id,
      });
    }
    if (now >= row.expiresAt) {
      throw new ApiError('conflict', 'This ping stopped taking an answer', {
        reason: 'ping_expired',
        ping_id: row.id,
        expires_at: row.expiresAt,
      });
    }
    const replyJson = JSON.stringify(answer);
    db.update(capacityPings)
      .set({ answeredAt: now, replyJson })
      .where(and(eq(capacityPings.id, row.id), isNull(capacityPings.answeredAt)))
      .run();
    // The answer is the receipt (§4.77): a device that answered has the
    // event, so it leaves `undelivered` whether or not its helper acks it.
    db.update(agentEventDeliveries)
      .set({ receivedAt: now })
      .where(
        and(
          eq(agentEventDeliveries.activityId, row.activityId),
          eq(agentEventDeliveries.agentId, row.agentId),
          isNull(agentEventDeliveries.receivedAt),
        ),
      )
      .run();
    return pingView(current, { ...row, answeredAt: now, replyJson }, now);
  });
  wake(pingId);
  return view;
}

// --------------------------------------------------------- capacity, read

/**
 * `GET /agents/:id/capacity?project=`, `get_agent_capacity` (§6.4, §7.1):
 * the agent's launcher presence and the newest answer this reader may see
 * **in the project asked**, which it may read (LAI-1038 review) — its owner,
 * anyone's there; anyone else who may ping it, its own there. Refused as a
 * ping is: the agent `404`.
 */
export function getAgentCapacity(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  projectSlug: string,
  now: number = Date.now(),
): AgentCapacityView {
  const project = requirePingable(db, actor, agentId, projectSlug);
  const owner = ownerOf(db, agentId) === actor.userId;
  const conditions: SQL[] = [
    eq(capacityPings.agentId, agentId),
    eq(capacityPings.projectId, project.id),
    isNotNull(capacityPings.answeredAt),
  ];
  if (!owner) conditions.push(eq(capacityPings.requestedByUserId, actor.userId));
  const latest = db
    .select()
    .from(capacityPings)
    .where(and(...conditions))
    .orderBy(desc(capacityPings.answeredAt), desc(capacityPings.id))
    .get();
  const status =
    db.select({ status: agents.status }).from(agents).where(eq(agents.id, agentId)).get()?.status ??
    'revoked';
  return {
    agent_id: agentId,
    launcher: launcherOf(db, agentId, status, now),
    latest_answer: latest === undefined ? null : pingView(actor, latest, now),
    now,
  };
}

// ----------------------------------------------------------------- presence

export interface LauncherReportInput {
  enabled: boolean;
  autoPickup: { workRequests: boolean; handoffs: boolean };
  running: number;
  maxConcurrent: number;
  cliVersion: string;
  startedAt: number | null;
}

/**
 * `PUT /agents/me/launcher` (§6.4, §4.83): a launcher says what it is, with
 * the agent's own token, under `heartbeat.send_own` — at start, every 60 s,
 * on a change, and `enabled: false` on a clean stop. `403 not_an_agent` for
 * anything but a registered agent's token. Replaces the agent's one row.
 */
export function reportLauncher(
  db: Db,
  actor: ResolvedActor,
  input: LauncherReportInput,
  now: number = Date.now(),
): LauncherReportView {
  assertCan(actor, 'heartbeat.send_own');
  const agent = registeredAgent(actor);
  if (agent === null) throw notAnAgent();

  const values = {
    enabled: input.enabled,
    autoPickupWorkRequests: input.autoPickup.workRequests,
    autoPickupHandoffs: input.autoPickup.handoffs,
    running: input.running,
    maxConcurrent: input.maxConcurrent,
    cliVersion: input.cliVersion,
    startedAt: input.startedAt,
    // §4.2: with presence off the report keeps what the launcher is, and says
    // nothing about when.
    reportedAt: presenceEnabled(db) ? now : null,
  };
  db.insert(agentLauncherReports)
    .values({ agentId: agent.id, ...values })
    .onConflictDoUpdate({ target: agentLauncherReports.agentId, set: values })
    .run();
  const row: ReportRow = { agentId: agent.id, ...values };
  return {
    agent_id: agent.id,
    enabled: row.enabled,
    ...launcherViewOf(row, agent.status, now, presenceEnabled(db)),
  };
}

const NEVER_REPORTED: LauncherView = {
  state: 'off',
  reported_at: null,
  started_at: null,
  running: null,
  max_concurrent: null,
  auto_pickup: null,
  cli_version: null,
};

/**
 * The word a report makes now (D-126 item 4): `on` only for an enabled report
 * under {@link LAUNCHER_FRESH_MS} old from an active agent; `off` for one that
 * said disabled, a revoked agent, or none; `unknown` for an enabled report
 * too old — or of unknown age while presence is off — to say.
 */
export function launcherViewOf(
  row: ReportRow | undefined,
  status: AgentStatus,
  now: number,
  presenceOn: boolean,
): LauncherView {
  if (row === undefined) return NEVER_REPORTED;
  const reportedAt = presenceOn ? row.reportedAt : null;
  const fresh = reportedAt !== null && now - reportedAt < LAUNCHER_FRESH_MS;
  return {
    state: !row.enabled || status !== 'active' ? 'off' : fresh ? 'on' : 'unknown',
    reported_at: reportedAt,
    started_at: presenceOn ? row.startedAt : null,
    running: row.running,
    max_concurrent: row.maxConcurrent,
    auto_pickup: { work_requests: row.autoPickupWorkRequests, handoffs: row.autoPickupHandoffs },
    cli_version: row.cliVersion,
  };
}

/** One agent's launcher as the board shows it now. */
export function launcherOf(
  db: Db,
  agentId: string,
  status: AgentStatus,
  now: number,
): LauncherView {
  const row = db
    .select()
    .from(agentLauncherReports)
    .where(eq(agentLauncherReports.agentId, agentId))
    .get();
  return launcherViewOf(row, status, now, presenceEnabled(db));
}

const RANK: Record<LauncherState, number> = { on: 2, unknown: 1, off: 0 };

/**
 * A device's launcher (§4.78, D-126 item 4): **on if any of its active tools'
 * is** — the freshest such report, since one launcher serves every tool on a
 * device — else `unknown` if any is, else `off`. A revoked tool counts for
 * nothing.
 */
export function deviceLauncher(
  tools: readonly { status: AgentStatus; launcher: LauncherView }[],
): LauncherView {
  let best: LauncherView = NEVER_REPORTED;
  for (const tool of tools) {
    if (tool.status !== 'active') continue;
    const l = tool.launcher;
    if (
      RANK[l.state] > RANK[best.state] ||
      (RANK[l.state] === RANK[best.state] && (l.reported_at ?? -1) > (best.reported_at ?? -1))
    ) {
      best = l;
    }
  }
  return best;
}
