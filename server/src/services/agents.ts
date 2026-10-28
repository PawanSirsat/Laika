import type Database from 'better-sqlite3';
import { and, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { AGENT_CLIENTS } from '../auth/agent-clients.ts';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type AgentGrantScope, type AgentStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { requireOrgId } from '../db/orgs.ts';
import { agentProjectGrants, agents, tokens } from '../db/schema.ts';
import { endSessionsOfRevokedAgent } from './claims.ts';
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
 */

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
  display_name: string;
  /** Self-reported by whoever registered it; decides nothing. */
  harness: string;
  /** Self-reported; decides nothing. */
  device_label: string | null;
  status: AgentStatus;
  grants: AgentGrantView[];
  /** The agent's tokens, revoked ones included, newest first. Never a secret. */
  tokens: TokenView[];
  created_at: number;
  revoked_at: number | null;
  last_seen_at: number | null;
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
  const expiresAt = futureExpiry(input.expiresAt ?? null, now);

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

export function getOwnAgent(db: Db, actor: ResolvedActor, agentId: string): AgentView {
  assertCan(actor, 'agent.read_own');
  return agentView(db, requireOwnAgent(db, actor, agentId));
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
): AgentView {
  assertCan(actor, 'agent.manage_own');
  const row = requireActiveAgent(db, actor, agentId);

  const set: Partial<AgentRow> = {};
  if (input.displayName !== undefined) set.displayName = cleanName(input.displayName);
  if (input.harness !== undefined) set.harness = cleanHarness(input.harness);
  if (input.deviceLabel !== undefined) set.deviceLabel = cleanDeviceLabel(input.deviceLabel);

  if (Object.keys(set).length > 0) {
    immediateTransaction(sqlite, () => {
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
  const expiresAt =
    input.expiresAt === undefined ? carried : futureExpiry(input.expiresAt ?? null, now);

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
  });

  return agentView(db, { ...row, status: 'revoked', revokedAt: now });
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

  return {
    id: row.id,
    owner_user_id: row.ownerUserId,
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
