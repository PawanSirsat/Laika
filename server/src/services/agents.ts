import type Database from 'better-sqlite3';
import { and, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { AGENT_CLIENTS } from '../auth/agent-clients.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { deviceLabelKey } from '../db/device-label.ts';
import { type AgentGrantScope, type AgentStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { requireOrgId } from '../db/orgs.ts';
import { agentProjectGrants, agents, recognisedAgentDevices, tokens, users } from '../db/schema.ts';
import { type AgentSessionView, endSessionsOfRevokedAgent, recentAgentSessions } from './claims.ts';
import { closeOffersOfRevokedAgent } from './handoffs.ts';
import { ApiError } from '../errors.ts';
import { assertCan, forcedTokenScope } from '../policy/can.ts';
import {
  assertReadableProjects,
  insertToken,
  revokeTokenRow,
  tokenView,
  type TokenView,
} from './tokens.ts';

/**
 * Registered agents and their credentials (SPEC §4.63, §4.64, D-114, LAI-534).
 *
 * An agent is a named identity owned by one person, acting through its own
 * tokens and never with more access than its owner. **This module manages
 * them; `can()` enforces them** — the grant step lives in its token narrowing,
 * so every REST route and MCP tool applies it without knowing agents exist.
 *
 * ## Only the owner's own rows, signed in
 *
 * `agent.read_own` and `agent.manage_own` are every role's, as a person's time
 * entries are, and **every query here is filtered to the caller's own
 * agents**: another person's agent is a `404`, never a `403`, so its existence
 * is not disclosed. Managing is session only (§3.1): a token — an agent's own
 * included — cannot register an agent, widen a grant, or rotate a credential.
 *
 * ## The secret, once
 *
 * Registration and rotation each return one secret, in `CreatedAgentToken`,
 * and nothing else ever can — the tokens are minted by `insertToken`, the same
 * function `POST /tokens` uses, so §4.9's guarantee is the same guarantee.
 *
 * ## No new activity verb
 *
 * Minting and revoking an agent's token write the `token.created` and
 * `token.revoked` every token writes; the agent's own rows are the record of
 * its registration and revocation, as `password_resets` is (§4.60). A verb of
 * its own is three owners (CLAUDE.md §4.4) and is LAI-535's to add.
 *
 * ## Cloud agents hold short-lived tokens (LAI-592)
 *
 * An agent whose device label is `Cloud`, in any case, runs somewhere its
 * owner does not sit — a hosted runner — so every token it holds must expire
 * within {@link CLOUD_TOKEN_MAX_TTL_MS}. Registering, rotating and relabelling
 * are the only ways a token comes to belong to a cloud agent, and each
 * refuses one with no expiry or a longer one, `422` with a `reason` naming
 * the rule. Its expired token is refused by `findTokenBySecret` exactly as
 * any expired token is; nothing here touches that path.
 *
 * ## The owner is the session user, always
 *
 * `owner_user_id` is `actor.userId` and no input can name another: no body
 * field carries an owner, and every body is strict. An agent on a
 * colleague's laptop is theirs to register (D-114).
 *
 * ## One active agent per harness per device, per owner (D-120)
 *
 * An agent *is* `<harness> · <device>` (D-118), so an owner holds at most one
 * active agent for each pair, the device compared by the key LAI-590 groups
 * by (an unnamed device is one device too). Registering a second, or renaming
 * or relabelling one onto a pair another active agent of yours holds, is
 * `409` with `reason` `agent_exists_for_harness_device` naming yours. Only
 * your own agents are compared: another owner's on the same label and
 * harness is no conflict and is never mentioned. A revoked agent frees its
 * pair. Checked inside the write transaction, so two racing registrations
 * cannot both land.
 */

/**
 * The longest a cloud agent's token may live: one day. Long enough for a
 * runner's longest job and a daily schedule that mints afresh each run;
 * short enough that a credential copied out of a runner's environment is dead
 * by the next day. One constant, so the decision moves it in one place.
 */
export const CLOUD_TOKEN_MAX_TTL_MS = 24 * 60 * 60 * 1000;

/** The device label that marks an agent as a cloud runner, compared normalised. */
export const CLOUD_DEVICE_LABEL = 'Cloud';

export { AGENT_CLIENTS as AGENT_HARNESSES } from '../auth/agent-clients.ts';
export { AGENT_GRANT_SCOPES } from '../db/enums.ts';

export interface AgentGrantView {
  project_id: string;
  scope: AgentGrantScope;
}

/** One agent as it goes over the wire. No secret, no hash. */
export interface AgentView {
  id: string;
  owner_user_id: string;
  /** The owner's name, shown on every line that names the agent (LAI-592). */
  owner_display_name: string;
  display_name: string;
  /** Self-reported by whoever registered it; decides nothing. */
  harness: string;
  /**
   * Self-reported. Decides one thing: a label that normalises to `cloud`
   * marks a cloud agent, whose tokens must be short-lived (LAI-592).
   */
  device_label: string | null;
  status: AgentStatus;
  grants: AgentGrantView[];
  /** The agent's tokens, revoked ones included, newest first. Never a secret. */
  tokens: TokenView[];
  created_at: number;
  revoked_at: number | null;
  last_seen_at: number | null;
}

/**
 * One agent as `GET /agents/:id` answers it: {@link AgentView} and its most
 * recent sessions, newest first — what each one said ran (D-118, LAI-586).
 */
export interface AgentDetailView extends AgentView {
  sessions: AgentSessionView[];
}

export interface CreatedAgentToken {
  agent: AgentView;
  token: TokenView;
  /** The plaintext, returned once and never recoverable (§4.9). */
  secret: string;
}

export interface GrantInput {
  projectId: string;
  scope: AgentGrantScope;
}

export interface RegisterAgentInput {
  displayName: string;
  harness: string;
  deviceLabel?: string | null | undefined;
  grants: readonly GrantInput[];
  /** The first token's expiry; `null` or absent never expires. */
  expiresAt?: number | null | undefined;
  now?: number;
}

type AgentRow = typeof agents.$inferSelect;

/** Register an agent and mint its first token, in one transaction. */
export function registerAgent(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  input: RegisterAgentInput,
): CreatedAgentToken {
  assertCan(actor, 'agent.manage_own');

  const now = input.now ?? Date.now();
  const displayName = cleanName(input.displayName);
  const harness = cleanHarness(input.harness);
  const deviceLabel = cleanDeviceLabel(input.deviceLabel ?? null);
  const grants = cleanGrants(db, actor, input.grants);
  const requested = input.expiresAt ?? null;
  // The cloud rule first, so a cloud agent's refusal always names it.
  if (isCloudLabel(deviceLabel)) assertCloudExpiry(requested, now);
  const expiresAt = futureExpiry(requested, now);

  const row: AgentRow = {
    id: newId(),
    orgId: requireOrgId(db),
    ownerUserId: actor.userId,
    displayName,
    harness,
    deviceLabel,
    status: 'active',
    createdAt: now,
    revokedAt: null,
    lastSeenAt: null,
  };

  const created = immediateTransaction(sqlite, () => {
    assertHarnessDeviceFree(db, actor, harness, deviceLabel, null);
    db.insert(agents).values(row).run();
    writeGrants(db, row.id, grants, now);
    return insertToken(db, actor, {
      name: displayName,
      // Full, or a viewer's forced `read_only`: the grants narrow it per
      // project, and the owner's role caps both (D-114).
      scope: forcedTokenScope(actor.orgRole, 'full'),
      projectIds: null,
      expiresAt,
      agentId: row.id,
      now,
    });
  });

  return { agent: agentView(db, row), token: created.token, secret: created.secret };
}

export interface ListAgentsOptions {
  limit: number;
  /** Keyset position, `(created_at, id)`, matching the ORDER BY below. */
  cursor: { sortKey: string | number; id: string } | null;
}

/** Your own agents, newest first. */
export function listOwnAgents(
  db: Db,
  actor: ResolvedActor,
  options: ListAgentsOptions,
): AgentView[] {
  assertCan(actor, 'agent.read_own');

  const conditions: SQL[] = [eq(agents.ownerUserId, actor.userId)];
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(agents.createdAt, key),
        and(eq(agents.createdAt, key), lt(agents.id, options.cursor.id)),
      )!,
    );
  }

  return db
    .select()
    .from(agents)
    .where(and(...conditions))
    .orderBy(desc(agents.createdAt), desc(agents.id))
    .limit(options.limit + 1)
    .all()
    .map((row) => agentView(db, row));
}

export function getOwnAgent(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  now: number = Date.now(),
): AgentDetailView {
  assertCan(actor, 'agent.read_own');
  const row = requireOwnAgent(db, actor, agentId);
  return { ...agentView(db, row), sessions: recentAgentSessions(db, row.id, now) };
}

export interface UpdateAgentInput {
  displayName?: string | undefined;
  harness?: string | undefined;
  deviceLabel?: string | null | undefined;
}

/**
 * Rename it, or correct what it says about itself.
 *
 * The agent's tokens are renamed with it, in the same transaction: a token's
 * name is what `created_by_client` shows (§4.9), and an agent renamed while
 * its tokens kept the old name would be two names for one worker.
 */
export function updateAgent(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  input: UpdateAgentInput,
  now: number = Date.now(),
): AgentView {
  assertCan(actor, 'agent.manage_own');
  const row = requireActiveAgent(db, actor, agentId);

  const set: Partial<AgentRow> = {};
  if (input.displayName !== undefined) set.displayName = cleanName(input.displayName);
  if (input.harness !== undefined) set.harness = cleanHarness(input.harness);
  if (input.deviceLabel !== undefined) set.deviceLabel = cleanDeviceLabel(input.deviceLabel);
  // Relabelling into Cloud is a third way a token comes to be a cloud
  // agent's: every live one must already meet the rule.
  if (set.deviceLabel !== undefined && isCloudLabel(set.deviceLabel)) {
    for (const token of liveTokens(db, row.id, now)) assertCloudExpiry(token.expiresAt, now);
  }

  if (Object.keys(set).length > 0) {
    immediateTransaction(sqlite, () => {
      if (set.harness !== undefined || set.deviceLabel !== undefined) {
        assertHarnessDeviceFree(
          db,
          actor,
          set.harness ?? row.harness,
          set.deviceLabel === undefined ? row.deviceLabel : set.deviceLabel,
          row.id,
        );
      }
      db.update(agents).set(set).where(eq(agents.id, row.id)).run();
      if (set.displayName !== undefined) {
        db.update(tokens).set({ name: set.displayName }).where(eq(tokens.agentId, row.id)).run();
      }
    });
  }

  return agentView(db, { ...row, ...set });
}

/**
 * Replace the agent's grants with exactly these. An empty list leaves it
 * reaching nothing — a valid state, and the quickest way to fence one off
 * without revoking it.
 */
export function setAgentGrants(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  grants: readonly GrantInput[],
  now: number = Date.now(),
): AgentView {
  assertCan(actor, 'agent.manage_own');
  const row = requireActiveAgent(db, actor, agentId);
  const cleaned = cleanGrants(db, actor, grants);

  immediateTransaction(sqlite, () => {
    db.delete(agentProjectGrants).where(eq(agentProjectGrants.agentId, row.id)).run();
    writeGrants(db, row.id, cleaned, now);
  });

  return agentView(db, row);
}

export interface RotateAgentTokenInput {
  tokenId: string;
  /** The new token's expiry. Absent carries the old one over while it is still ahead. */
  expiresAt?: number | null | undefined;
  now?: number;
}

/**
 * Mint a new token for the agent and revoke the old one, **in one
 * transaction** (D-114 item 2): there is no moment with neither, and none with
 * both. The agent stays the same agent — same id, same grants, same history —
 * and the owner's other tokens, its other agents' included, are not touched.
 *
 * The new token keeps the old one's scope and project pin: rotating replaces a
 * secret, and must never be a way to widen what it opens.
 */
export function rotateAgentToken(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  input: RotateAgentTokenInput,
): CreatedAgentToken {
  assertCan(actor, 'agent.manage_own');
  const now = input.now ?? Date.now();
  const row = requireActiveAgent(db, actor, agentId);

  const old = db
    .select()
    .from(tokens)
    .where(and(eq(tokens.id, input.tokenId), eq(tokens.agentId, row.id)))
    .get();
  if (old === undefined) {
    throw ApiError.notFound(`No token with id "${input.tokenId}" for that agent`);
  }
  if (old.revokedAt !== null) {
    throw new ApiError('conflict', 'That token is already revoked; rotate a live one', {
      token_id: old.id,
      reason: 'token_revoked',
    });
  }

  const carried = old.expiresAt !== null && old.expiresAt > now ? old.expiresAt : null;
  const requested = input.expiresAt === undefined ? carried : (input.expiresAt ?? null);
  // The cloud rule first, so a cloud agent's refusal always names it.
  if (isCloudLabel(row.deviceLabel)) assertCloudExpiry(requested, now);
  const expiresAt = input.expiresAt === undefined ? carried : futureExpiry(requested, now);

  const created = immediateTransaction(sqlite, () => {
    const minted = insertToken(db, actor, {
      name: row.displayName,
      scope: forcedTokenScope(actor.orgRole, old.scope),
      projectIds: parseIds(old.projectIdsJson),
      expiresAt,
      agentId: row.id,
      now,
    });
    revokeTokenRow(db, actor, old, now);
    return minted;
  });

  return { agent: agentView(db, row), token: created.token, secret: created.secret };
}

/**
 * Revoke the agent: its status, and every live token it holds, in one
 * transaction (D-114 item 2). `resolve-actor.ts` refuses its tokens from then
 * on whatever their own rows say. The owner and their other agents are not
 * touched. Revoking twice is not an error and writes nothing the second time.
 *
 * **Open event streams** on its tokens close when LAI-539 makes an open stream
 * re-check its credential; until then a stream already open keeps running
 * (proposal §2, `routes/events.ts`).
 */
export function revokeAgent(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  now: number = Date.now(),
): AgentView {
  assertCan(actor, 'agent.manage_own');
  const row = requireOwnAgent(db, actor, agentId);
  if (row.status === 'revoked') return agentView(db, row);

  immediateTransaction(sqlite, () => {
    db.update(agents).set({ status: 'revoked', revokedAt: now }).where(eq(agents.id, row.id)).run();

    const live = db
      .select()
      .from(tokens)
      .where(and(eq(tokens.agentId, row.id), isNull(tokens.revokedAt)))
      .all();
    for (const token of live) revokeTokenRow(db, actor, token, now);
    // D-114 item 2: its sessions end with it (LAI-541); its claims lapse.
    endSessionsOfRevokedAgent(db, row.id, now);
    // §4.73: its live offers — to it and from it — close `agent_revoked`.
    closeOffersOfRevokedAgent(db, row.id, now);
  });

  return agentView(db, { ...row, status: 'revoked', revokedAt: now });
}

/** A derived device, scoped to exactly one owner (LAI-590, §4.63). */
export interface AgentDevice {
  /** Normalised label used by confirm/revoke; null is the unnamed group. */
  device_label: string | null;
  display_name: string;
  recognised: boolean;
  last_seen_at: number | null;
  active_count: number;
  revoked_count: number;
  agents: AgentView[];
}

/** All own agents, without pagination: a device must never be split across pages. */
export function listOwnAgentDevices(db: Db, actor: ResolvedActor): AgentDevice[] {
  assertCan(actor, 'agent.read_own');
  const recognised = new Set(
    db
      .select()
      .from(recognisedAgentDevices)
      .where(eq(recognisedAgentDevices.ownerUserId, actor.userId))
      .all()
      .map((row) => row.labelKey),
  );
  const grouped = new Map<string, AgentDevice>();
  for (const row of ownDeviceAgents(db, actor)) {
    const key = deviceLabelKey(row.deviceLabel);
    let device = grouped.get(key);
    if (device === undefined) {
      device = {
        device_label: key === '' ? null : key,
        display_name: key === '' ? 'Unnamed device' : (row.deviceLabel ?? '').trim(),
        recognised: recognised.has(key),
        last_seen_at: null,
        active_count: 0,
        revoked_count: 0,
        agents: [],
      };
      grouped.set(key, device);
    }
    if (row.lastSeenAt !== null) {
      device.last_seen_at = Math.max(device.last_seen_at ?? row.lastSeenAt, row.lastSeenAt);
    }
    if (row.status === 'active') device.active_count += 1;
    else device.revoked_count += 1;
    device.agents.push(agentView(db, row));
  }
  return [...grouped.values()].sort((a, b) =>
    (a.device_label ?? '').localeCompare(b.device_label ?? ''),
  );
}

/** A confirmation is the owner's statement about a label, not a fingerprint. */
export function confirmOwnAgentDevice(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  deviceLabel: string | null,
  now: number = Date.now(),
): { device_label: string | null; recognised: true } {
  assertCan(actor, 'agent.manage_own');
  // The caller sends back the key the list served, which lower-casing may
  // have made longer than a stored label may be ('İ' is two code units
  // lower-cased): look it up, never re-apply the stored label's limit.
  const key = deviceLabelKey(deviceLabel);
  immediateTransaction(sqlite, () => {
    requireOwnDeviceAgents(db, actor, key);
    db.insert(recognisedAgentDevices)
      .values({ ownerUserId: actor.userId, labelKey: key, createdAt: now })
      .onConflictDoNothing()
      .run();
  });
  return { device_label: key === '' ? null : key, recognised: true };
}

/** Reuse single-agent revocation under one outer write lock/transaction. */
export function revokeOwnAgentDevice(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  deviceLabel: string | null,
  now: number = Date.now(),
): { revoked_agent_ids: string[] } {
  assertCan(actor, 'agent.manage_own');
  // The caller sends back the key the list served, which lower-casing may
  // have made longer than a stored label may be ('İ' is two code units
  // lower-cased): look it up, never re-apply the stored label's limit.
  const key = deviceLabelKey(deviceLabel);
  return immediateTransaction(sqlite, () => {
    const active = requireOwnDeviceAgents(db, actor, key).filter((row) => row.status === 'active');
    for (const row of active) revokeAgent(sqlite, db, actor, row.id, now);
    return { revoked_agent_ids: active.map((row) => row.id) };
  });
}

function ownDeviceAgents(db: Db, actor: ResolvedActor): AgentRow[] {
  return db
    .select()
    .from(agents)
    .where(eq(agents.ownerUserId, actor.userId))
    .orderBy(desc(agents.createdAt), desc(agents.id))
    .all();
}

function requireOwnDeviceAgents(db: Db, actor: ResolvedActor, key: string): AgentRow[] {
  const rows = ownDeviceAgents(db, actor).filter((row) => deviceLabelKey(row.deviceLabel) === key);
  if (rows.length === 0) throw ApiError.notFound('Unknown device');
  return rows;
}

// ------------------------------------------------------------------ helpers

function agentView(db: Db, row: AgentRow): AgentView {
  const grants = db
    .select({ projectId: agentProjectGrants.projectId, scope: agentProjectGrants.scope })
    .from(agentProjectGrants)
    .where(eq(agentProjectGrants.agentId, row.id))
    .orderBy(agentProjectGrants.projectId)
    .all();

  const own = db
    .select()
    .from(tokens)
    .where(eq(tokens.agentId, row.id))
    .orderBy(desc(tokens.createdAt), desc(tokens.id))
    .all();

  const owner = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.ownerUserId))
    .get();

  return {
    id: row.id,
    owner_user_id: row.ownerUserId,
    owner_display_name: owner?.name ?? '',
    display_name: row.displayName,
    harness: row.harness,
    device_label: row.deviceLabel,
    status: row.status,
    grants: grants.map((g) => ({ project_id: g.projectId, scope: g.scope })),
    tokens: own.map(tokenView),
    created_at: row.createdAt,
    revoked_at: row.revokedAt,
    last_seen_at: row.lastSeenAt,
  };
}

/** The caller's own agent, or `404` — another person's is not disclosed. */
function requireOwnAgent(db: Db, actor: ResolvedActor, agentId: string): AgentRow {
  const row = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.ownerUserId, actor.userId)))
    .get();
  if (row === undefined) throw ApiError.notFound(`No agent with id "${agentId}"`);
  return row;
}

function requireActiveAgent(db: Db, actor: ResolvedActor, agentId: string): AgentRow {
  const row = requireOwnAgent(db, actor, agentId);
  if (row.status !== 'active') {
    throw new ApiError('conflict', 'This agent is revoked; register a new one', {
      agent_id: row.id,
      reason: 'agent_revoked',
    });
  }
  return row;
}

function writeGrants(db: Db, agentId: string, grants: readonly GrantInput[], now: number): void {
  for (const grant of grants) {
    db.insert(agentProjectGrants)
      .values({ agentId, projectId: grant.projectId, scope: grant.scope, createdAt: now })
      .run();
  }
}

/**
 * Every project must be one the owner can read now — `422` naming the rest,
 * never silently dropped, exactly as a token's whitelist is checked. A project
 * named twice is refused rather than resolved, because "which scope did you
 * mean" has no right answer.
 */
function cleanGrants(db: Db, actor: ResolvedActor, grants: readonly GrantInput[]): GrantInput[] {
  const ids = grants.map((g) => g.projectId);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length > 0) {
    throw new ApiError('unprocessable', 'Each project may be granted once', {
      project_ids: [...new Set(repeated)],
    });
  }
  assertReadableProjects(db, actor, ids);
  return grants.map((g) => ({ projectId: g.projectId, scope: g.scope }));
}

function cleanName(raw: string): string {
  const name = raw.trim();
  if (name === '' || name.length > 80) {
    throw new ApiError('unprocessable', 'An agent needs a name of 1 to 80 characters', {
      display_name: raw,
    });
  }
  return name;
}

function cleanHarness(raw: string): string {
  const harness = AGENT_CLIENTS.find((slug) => slug === raw);
  if (harness === undefined) {
    throw new ApiError('unprocessable', 'harness must be a known agent client, or "other"', {
      harness: raw,
      allowed: AGENT_CLIENTS,
    });
  }
  return harness;
}

function cleanDeviceLabel(raw: string | null): string | null {
  if (raw === null) return null;
  const label = raw.trim();
  if (label.length > 80) {
    throw new ApiError('unprocessable', 'device_label is at most 80 characters', {
      device_label: raw,
    });
  }
  return label === '' ? null : label;
}

function futureExpiry(expiresAt: number | null, now: number): number | null {
  if (expiresAt !== null && expiresAt <= now) {
    throw new ApiError('unprocessable', 'expires_at must be in the future', {
      expires_at: expiresAt,
      now,
    });
  }
  return expiresAt;
}

function isCloudLabel(label: string | null): boolean {
  return deviceLabelKey(label) === deviceLabelKey(CLOUD_DEVICE_LABEL);
}

/**
 * A cloud agent's token must expire, and within the limit (LAI-592). Both
 * refusals are `unprocessable`; the `reason` names which rule was broken.
 * An expiry already past gives the token no life at all, so it breaks the
 * same rule as none: `cloud_token_expiry_required`.
 */
function assertCloudExpiry(expiresAt: number | null, now: number): void {
  if (expiresAt === null || expiresAt <= now) {
    throw new ApiError('unprocessable', 'A cloud agent’s token must have a future expiry', {
      reason: 'cloud_token_expiry_required',
      expires_at: expiresAt,
      max_ttl_ms: CLOUD_TOKEN_MAX_TTL_MS,
    });
  }
  if (expiresAt > now + CLOUD_TOKEN_MAX_TTL_MS) {
    const hours = CLOUD_TOKEN_MAX_TTL_MS / 3_600_000;
    throw new ApiError('unprocessable', `A cloud agent’s token may live at most ${hours} hours`, {
      reason: 'cloud_token_expiry_too_long',
      expires_at: expiresAt,
      max_expires_at: now + CLOUD_TOKEN_MAX_TTL_MS,
      max_ttl_ms: CLOUD_TOKEN_MAX_TTL_MS,
    });
  }
}

/** The agent's tokens still able to act: not revoked, not expired. */
/**
 * D-120: the owner's other active agent on this harness and device, if any,
 * is a `409`. `except` is the agent being changed, which may keep its own pair.
 */
function assertHarnessDeviceFree(
  db: Db,
  actor: ResolvedActor,
  harness: string,
  deviceLabel: string | null,
  except: string | null,
): void {
  const key = deviceLabelKey(deviceLabel);
  const holder = db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.ownerUserId, actor.userId),
        eq(agents.status, 'active'),
        eq(agents.harness, harness),
      ),
    )
    .all()
    .find((row) => row.id !== except && deviceLabelKey(row.deviceLabel) === key);
  if (holder === undefined) return;
  throw new ApiError(
    'conflict',
    `You already have an active ${harness} agent on this device ("${holder.displayName}"); rotate its token or revoke it first`,
    {
      reason: 'agent_exists_for_harness_device',
      agent_id: holder.id,
      harness,
      device_label: key === '' ? null : key,
    },
  );
}

function liveTokens(db: Db, agentId: string, now: number): (typeof tokens.$inferSelect)[] {
  return db
    .select()
    .from(tokens)
    .where(and(eq(tokens.agentId, agentId), isNull(tokens.revokedAt)))
    .all()
    .filter((token) => token.expiresAt === null || token.expiresAt > now);
}

function parseIds(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // An unreadable pin stays a pin — on nothing — rather than widening to all.
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
