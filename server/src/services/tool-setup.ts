import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { AGENT_CLIENTS } from '../auth/agent-clients.ts';
import {
  parseDevicePublicKey,
  toolRedeemMessage,
  verifyDeviceSignature,
} from '../auth/device-signature.ts';
import { loadActor, type ResolvedActor } from '../auth/resolve-actor.ts';
import { tokenProjectIds } from '../auth/tokens.ts';
import { type Db } from '../db/client.ts';
import { deviceLabelKey } from '../db/device-label.ts';
import { type ToolSetupPurpose, type ToolSetupState } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  agentClientReports,
  agentSessions,
  agents,
  devices,
  toolSetupExchanges,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, forcedTokenScope } from '../policy/can.ts';
import {
  CLOUD_DEVICE_LABEL,
  CLOUD_TOKEN_MAX_TTL_MS,
  agentView,
  cleanHarness,
  insertDeviceAgent,
  isCloudAgent,
  liveTokens,
  requireActiveAgent,
  type AgentView,
} from './agents.ts';
import { registeredAgent } from './claims.ts';
import { insertToken, revokeTokenRow, type TokenView } from './tokens.ts';

/**
 * Setting a tool up on a paired device (SPEC §4.80, LAI-1056; plan LAI-1042
 * §E.2, §E.3).
 *
 * 1. The owner, **signed in**, adds a tool to one of their paired devices
 *    (`agent.manage_own`). Their one active agent for that device and harness
 *    is reused, or one is registered with no credential and no grants. More
 *    than one active is a conflict the owner resolves — none is ever picked.
 *    The answer is an exchange id and a command, **never a secret**, and the
 *    exchange row holds none either.
 * 2. The device redeems the exchange **once**, signing the exchange's
 *    challenge with the key it paired (§4.79). Only then is a token minted,
 *    straight into that one answer; `tokens` keeps its hash. An agent that
 *    already holds live tokens has them revoked in the same transaction — a
 *    reconnect is a rotation, and the agent's id, grants and history stay.
 *
 * ## Redeeming calls `can()` on the owner
 *
 * Redeeming **yields a credential**, so it is not D-124's proof-of-possession
 * case, whose first condition is that nothing is minted. It authorises as
 * the owner who made the exchange: the signature proves the caller is the
 * device the owner chose, and `can(owner, 'agent.manage_own')` is asked again
 * at redeem — an owner deactivated since, or whose role no longer allows it,
 * mints nothing. The token is the owner's, as every agent token is (§4.63).
 *
 * No §3.1 action and no §4.8 verb (plan §L4, §L5): minting and revoking write
 * the `token.created` / `token.revoked` every token writes, and this table is
 * the record of the rest.
 */

/** How long an exchange lives. */
export const EXCHANGE_TTL_MS = 10 * 60_000;
/** Open exchanges an owner may hold at once. */
export const MAX_OPEN_EXCHANGES = 5;
/** Bad signatures an exchange survives; the next one cancels it. */
export const MAX_FAILED_SIGNATURES = 5;

const NOT_FOUND = 'No such tool setup';
const DEVICE_NOT_FOUND = 'No such device';

type ExchangeRow = typeof toolSetupExchanges.$inferSelect;
type DeviceRow = typeof devices.$inferSelect;
type AgentRow = typeof agents.$inferSelect;

export interface ToolSetupView {
  id: string;
  /** `expired` once ten minutes pass, whatever the stored state says. */
  state: ToolSetupState;
  purpose: ToolSetupPurpose;
  agent_id: string;
  device_id: string;
  created_at: number;
  expires_at: number;
  redeemed_at: number | null;
}

export interface CreatedToolSetupView {
  agent: AgentView;
  exchange: ToolSetupView;
  /** What the owner runs on the device. **No secret is in it.** */
  command: string;
}

export interface ToolRedeemView {
  agent: { id: string; harness: string; display_name: string; device_label: string | null };
  token: TokenView;
  /** The plaintext, returned once, in this answer only (§4.9). */
  secret: string;
  board_origin: string;
}

function effectiveState(row: ExchangeRow, now: number): ToolSetupState {
  return row.state === 'open' && now >= row.expiresAt ? 'expired' : row.state;
}

function view(row: ExchangeRow, now: number): ToolSetupView {
  return {
    id: row.id,
    state: effectiveState(row, now),
    purpose: row.purpose,
    agent_id: row.agentId,
    device_id: row.deviceId,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    redeemed_at: row.redeemedAt,
  };
}

function conflict(message: string, reason: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError('conflict', message, { reason, ...extra });
}

function ownExchange(db: Db, actor: ResolvedActor, id: string): ExchangeRow {
  const row = db
    .select()
    .from(toolSetupExchanges)
    .where(and(eq(toolSetupExchanges.id, id), eq(toolSetupExchanges.ownerUserId, actor.userId)))
    .get();
  if (row === undefined) throw ApiError.notFound(NOT_FOUND);
  return row;
}

/** A cloud device's agent holds tokens of at most 24 h (§4.63, D-122). */
function isCloud(device: DeviceRow): boolean {
  return device.kind === 'cloud' || device.labelKey === deviceLabelKey(CLOUD_DEVICE_LABEL);
}

/**
 * `harness` as an agent may have it, and one a tool can be set up as: `other`
 * names no tool, so nothing could ever show it is the one that connected.
 */
function setupHarness(raw: string): string {
  if (raw === 'other' || !(AGENT_CLIENTS as readonly string[]).includes(raw)) {
    throw new ApiError('unprocessable', 'That tool cannot be set up this way', {
      reason: 'unsupported_harness',
      harness: raw,
      allowed: AGENT_CLIENTS.filter((slug) => slug !== 'other'),
    });
  }
  return cleanHarness(raw);
}

/** Open an exchange for `agent` on `device`, superseding its older open ones. */
function openExchange(
  db: Db,
  actor: ResolvedActor,
  agent: AgentRow,
  device: DeviceRow,
  now: number,
): ExchangeRow {
  // One live exchange per agent: a newer one withdraws the older, so the
  // command the owner copied last is the only one that works.
  db.update(toolSetupExchanges)
    .set({ state: 'cancelled', cancelledAt: now })
    .where(and(eq(toolSetupExchanges.agentId, agent.id), eq(toolSetupExchanges.state, 'open')))
    .run();

  const open = db
    .select({ n: sql<number>`count(*)` })
    .from(toolSetupExchanges)
    .where(
      and(
        eq(toolSetupExchanges.ownerUserId, actor.userId),
        eq(toolSetupExchanges.state, 'open'),
        gt(toolSetupExchanges.expiresAt, now),
      ),
    )
    .get();
  if ((open?.n ?? 0) >= MAX_OPEN_EXCHANGES) {
    throw conflict(
      `You have ${String(MAX_OPEN_EXCHANGES)} tool setups open already`,
      'too_many_open_exchanges',
    );
  }

  const row: ExchangeRow = {
    id: newId(),
    orgId: agent.orgId,
    ownerUserId: actor.userId,
    deviceId: device.id,
    agentId: agent.id,
    purpose: liveTokens(db, agent.id, now).length > 0 ? 'rotate' : 'install',
    challenge: randomBytes(32).toString('base64url'),
    state: 'open',
    mintedTokenId: null,
    failedAttempts: 0,
    createdAt: now,
    expiresAt: now + EXCHANGE_TTL_MS,
    redeemedAt: null,
    cancelledAt: null,
  };
  db.insert(toolSetupExchanges).values(row).run();
  return row;
}

function created(
  db: Db,
  agent: AgentRow,
  exchange: ExchangeRow,
  now: number,
): CreatedToolSetupView {
  return {
    agent: agentView(db, agent),
    exchange: view(exchange, now),
    command: `laika tool add ${agent.harness} --exchange ${exchange.id}`,
  };
}

/** The caller's own active, **paired** device, or the one `404` for anything else. */
function requirePairedDevice(db: Db, actor: ResolvedActor, deviceId: string): DeviceRow {
  const device = db
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, actor.userId)))
    .get();
  if (device?.status !== 'active') throw ApiError.notFound(DEVICE_NOT_FOUND);
  if (device.publicKey === null) {
    throw conflict('Pair this device before adding a tool to it', 'device_not_paired', {
      device_id: device.id,
    });
  }
  return device;
}

/**
 * `POST /devices/:id/tools`: the owner, signed in, adds a tool to a paired
 * device. Reuses the one active agent for (device, harness), registers one
 * when there is none, and refuses — naming them — when there are several.
 */
export function addToolToDevice(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  deviceId: string,
  input: { harness: string; now?: number },
): CreatedToolSetupView {
  assertCan(actor, 'agent.manage_own');
  const now = input.now ?? Date.now();
  const harness = setupHarness(input.harness);

  return immediateTransaction(sqlite, () => {
    const device = requirePairedDevice(db, actor, deviceId);
    // D-120 compares a pair by the label's key; `device_id` follows it.
    const holders = db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.ownerUserId, actor.userId),
          eq(agents.status, 'active'),
          eq(agents.harness, harness),
        ),
      )
      .orderBy(desc(agents.createdAt), desc(agents.id))
      .all()
      .filter((row) => deviceLabelKey(row.deviceLabel) === device.labelKey);
    if (holders.length > 1) {
      throw conflict(
        `You have ${String(holders.length)} active ${harness} agents on this device; keep one before adding it`,
        'agent_duplicates_need_resolution',
        { agent_ids: holders.map((row) => row.id), harness, device_id: device.id },
      );
    }

    let agent = holders[0];
    if (agent === undefined) {
      agent = insertDeviceAgent(db, actor, { harness, device, now });
    } else if (agent.deviceId !== device.id) {
      // An agent an older client registered, not yet linked by the backfill.
      db.update(agents).set({ deviceId: device.id }).where(eq(agents.id, agent.id)).run();
      agent = { ...agent, deviceId: device.id };
    }
    return created(db, agent, openExchange(db, actor, agent, device, now), now);
  });
}

/**
 * `POST /agents/:id/reconnect`: a `rotate` exchange for one of the owner's
 * agents, on the paired device it runs on. Redeeming it replaces the agent's
 * credential without the secret ever reaching the browser.
 */
export function reconnectAgent(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  now: number = Date.now(),
): CreatedToolSetupView {
  assertCan(actor, 'agent.manage_own');
  return immediateTransaction(sqlite, () => {
    const agent = requireActiveAgent(db, actor, agentId);
    const device =
      agent.deviceId === null
        ? undefined
        : db
            .select()
            .from(devices)
            .where(and(eq(devices.id, agent.deviceId), eq(devices.ownerUserId, actor.userId)))
            .get();
    if (device?.status !== 'active' || device.publicKey === null) {
      throw conflict(
        'This agent’s device is not paired; pair it, or rotate the token by hand',
        'device_not_paired',
        { agent_id: agent.id, device_id: agent.deviceId },
      );
    }
    return created(db, agent, openExchange(db, actor, agent, device, now), now);
  });
}

/** `GET /tool-setup/:id`: the owner's own exchange. Never a secret, never the challenge. */
export function getToolSetup(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
): ToolSetupView {
  assertCan(actor, 'agent.read_own');
  return view(ownExchange(db, actor, id), now);
}

/** `DELETE /tool-setup/:id`: the owner withdraws an open exchange. */
export function cancelToolSetup(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
): void {
  assertCan(actor, 'agent.manage_own');
  immediateTransaction(sqlite, () => {
    const row = ownExchange(db, actor, id);
    const state = effectiveState(row, now);
    if (state !== 'open') throw conflict(`This tool setup is ${state}`, `exchange_${state}`);
    db.update(toolSetupExchanges)
      .set({ state: 'cancelled', cancelledAt: now })
      .where(eq(toolSetupExchanges.id, row.id))
      .run();
  });
}

/** What a redeem came to. */
export type RedeemOutcome =
  | { kind: 'challenge'; challenge: string; expires_at: number }
  | { kind: 'bad_signature' }
  | { kind: 'redeemed'; body: ToolRedeemView };

export interface RedeemInput {
  id: string;
  deviceId: string;
  /** Absent asks for the challenge; present redeems. */
  signature?: string | undefined;
  boardOrigin: string;
  now?: number;
}

/**
 * `POST /tool-setup/:id/redeem`, by the paired device.
 *
 * Without a signature it answers the exchange's challenge — not a secret,
 * since only the device's private key can sign it. With one, the signature
 * is checked **before** anything about the exchange's state is said, then
 * the owner is asked again, then the token is minted, the agent's live
 * tokens revoked and the exchange marked redeemed, all in one transaction.
 *
 * An unknown id, another device's id, an unpaired device, and an exchange
 * whose owner may no longer manage agents are one `404`.
 */
export function redeemToolSetup(
  sqlite: Database.Database,
  db: Db,
  input: RedeemInput,
): RedeemOutcome {
  const now = input.now ?? Date.now();
  return immediateTransaction(sqlite, (): RedeemOutcome => {
    const row = db
      .select()
      .from(toolSetupExchanges)
      .where(eq(toolSetupExchanges.id, input.id))
      .get();
    if (row?.deviceId !== input.deviceId) throw ApiError.notFound(NOT_FOUND);
    const device = db.select().from(devices).where(eq(devices.id, row.deviceId)).get();
    const key = device?.publicKey == null ? null : parseDevicePublicKey(device.publicKey);
    if (device === undefined || key === null) throw ApiError.notFound(NOT_FOUND);

    // The owner, asked again at redeem: whatever has changed since they made
    // the exchange is what decides now.
    const owner = loadActor(db, row.ownerUserId);
    if (owner === null || !can(owner, 'agent.manage_own')) throw ApiError.notFound(NOT_FOUND);

    if (input.signature === undefined) {
      return { kind: 'challenge', challenge: row.challenge, expires_at: row.expiresAt };
    }

    const message = toolRedeemMessage(row.id, device.id, row.challenge, input.boardOrigin);
    if (!verifyDeviceSignature(key, message, input.signature)) {
      // Counted only against an open exchange; the fifth cancels it.
      if (effectiveState(row, now) === 'open') {
        const failed = row.failedAttempts + 1;
        db.update(toolSetupExchanges)
          .set(
            failed >= MAX_FAILED_SIGNATURES
              ? { failedAttempts: failed, state: 'cancelled', cancelledAt: now }
              : { failedAttempts: failed },
          )
          .where(eq(toolSetupExchanges.id, row.id))
          .run();
      }
      return { kind: 'bad_signature' };
    }

    const state = effectiveState(row, now);
    if (state !== 'open') throw conflict(`This tool setup is ${state}`, `exchange_${state}`);
    if (device.status !== 'active') throw conflict('That device is revoked', 'device_revoked');

    const agent = db.select().from(agents).where(eq(agents.id, row.agentId)).get();
    if (agent?.status !== 'active' || agent.ownerUserId !== row.ownerUserId) {
      throw conflict('This agent is revoked; add the tool again', 'agent_revoked');
    }

    // Spent first, and only if still open: of two redeems exactly one mints.
    const spent = db
      .update(toolSetupExchanges)
      .set({ state: 'redeemed', redeemedAt: now })
      .where(and(eq(toolSetupExchanges.id, row.id), eq(toolSetupExchanges.state, 'open')))
      .run();
    if (spent.changes !== 1) throw conflict('This tool setup is redeemed', 'exchange_redeemed');

    // A reconnect is a rotation (D-114 item 2): the new token keeps the
    // newest live one's scope and pin, so it never opens more, and every
    // live one is revoked here — no moment with neither, none with both.
    const live = liveTokens(db, agent.id, now).sort(
      (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
    );
    const previous = live[0];
    const carried = previous?.expiresAt ?? null;
    const cloud = isCloud(device) || isCloudAgent(db, agent);
    // A cloud device's token lives at most a day from now (D-122); a local
    // one keeps a rotated token's expiry, or none.
    const expiresAt =
      cloud && (carried === null || carried > now + CLOUD_TOKEN_MAX_TTL_MS)
        ? now + CLOUD_TOKEN_MAX_TTL_MS
        : carried;

    const minted = insertToken(db, owner, {
      name: agent.displayName,
      scope: forcedTokenScope(owner.orgRole, previous?.scope ?? 'full'),
      projectIds: previous === undefined ? null : (tokenProjectIds(previous) ?? null),
      expiresAt,
      agentId: agent.id,
      now,
    });
    for (const old of live) revokeTokenRow(db, owner, old, now);

    db.update(toolSetupExchanges)
      .set({ mintedTokenId: minted.token.id })
      .where(eq(toolSetupExchanges.id, row.id))
      .run();
    db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id)).run();

    return {
      kind: 'redeemed',
      body: {
        agent: {
          id: agent.id,
          harness: agent.harness,
          display_name: agent.displayName,
          device_label: agent.deviceLabel,
        },
        token: minted.token,
        secret: minted.secret,
        board_origin: input.boardOrigin,
      },
    };
  });
}

// ------------------------------------------------------- verification (§E.3)

export type CheckState = 'pass' | 'fail';

export interface VerificationCheck<D = null> {
  state: CheckState;
  /** When the evidence is from; null when there is none. */
  at: number | null;
  detail: D;
}

/**
 * What the board can show about one agent's tool (§4.80, plan §E.3, §H),
 * **from that agent's own credential only**. The status word is the UI's to
 * compute, with the capability table it holds (plan §E.6): this says what
 * the board saw, and `self_reported` marks what a client merely claimed.
 */
export interface AgentVerificationView {
  agent_id: string;
  harness: string;
  status: 'active' | 'revoked';
  /** The board's clock, so "seen 15 minutes ago" is measured by one clock. */
  now: number;
  /** The agent's newest authenticated request, any route (§4.63). */
  last_seen_at: number | null;
  checks: {
    device_paired: VerificationCheck<{ device_id: string | null }>;
    /** A live token: not revoked, not expired. `via_exchange` if redeemed by its device. */
    credential_installed: VerificationCheck<{ token_id: string | null; via_exchange: boolean }>;
    /** A live token has reached the board at all — a `curl` counts here, and only here. */
    credential_used: VerificationCheck;
    /**
     * An MCP `initialize` on a live token of **this** agent, naming a client
     * whose own slug is this agent's harness. Another tool's name fails it.
     */
    tool_request: VerificationCheck<{
      client_slug: string | null;
      client_name: string | null;
      client_version: string | null;
      self_reported: true;
    }>;
    /** A session this agent opened (§4.65): what its hooks start. */
    session_hooks: VerificationCheck<{ harness: string | null }>;
  };
  /** The CLI's own report (§4.81); null is "Version unknown". */
  client_report: {
    cli_version: string | null;
    cli_commit: string | null;
    protocol: number | null;
    capabilities: string[];
    harness_version: string | null;
    reported_at: number | null;
    self_reported: true;
  } | null;
}

/**
 * `GET /agents/:id/verification`: the owner, or the agent's own token.
 * Another agent's token, even the same owner's, is answered as no agent.
 */
export function getAgentVerification(
  db: Db,
  actor: ResolvedActor,
  agentId: string,
  now: number = Date.now(),
): AgentVerificationView {
  assertCan(actor, 'agent.read_own');
  const caller = registeredAgent(actor);
  if (caller !== null && caller.id !== agentId) throw ApiError.agentNotFound();
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.ownerUserId, actor.userId)))
    .get();
  if (agent === undefined) throw ApiError.agentNotFound();

  const device =
    agent.deviceId === null
      ? undefined
      : db.select().from(devices).where(eq(devices.id, agent.deviceId)).get();
  const paired = device?.status === 'active' && device.publicKey !== null;

  // Revoked agents have no live tokens: `liveTokens` reads them as the board
  // would accept them, and a revoked agent's are refused whatever they say.
  const live = agent.status === 'active' ? liveTokens(db, agent.id, now) : [];
  const liveIds = live.map((t) => t.id);
  const newest = [...live].sort((a, b) => b.createdAt - a.createdAt)[0];
  const redeemed =
    newest === undefined
      ? undefined
      : db
          .select({ id: toolSetupExchanges.id })
          .from(toolSetupExchanges)
          .where(
            and(
              eq(toolSetupExchanges.mintedTokenId, newest.id),
              eq(toolSetupExchanges.deviceId, agent.deviceId ?? ''),
            ),
          )
          .get();
  const used = live
    .map((t) => t.lastUsedAt)
    .filter((at): at is number => at !== null)
    .sort((a, b) => b - a)[0];

  const reports = db
    .select()
    .from(agentClientReports)
    .where(eq(agentClientReports.agentId, agent.id))
    .all();
  const mcp = reports.find((r) => r.source === 'mcp_initialize');
  const cli = reports.find((r) => r.source === 'cli');
  // From a live credential of this agent only: a rotated-away token's word
  // says nothing about the credential the tool holds now.
  const mcpTokenId = mcp?.tokenId;
  const mcpLive = mcp !== undefined && mcpTokenId != null && liveIds.includes(mcpTokenId);

  const session =
    liveIds.length === 0
      ? undefined
      : db
          .select({ startedAt: agentSessions.startedAt, harness: agentSessions.harness })
          .from(agentSessions)
          .where(and(eq(agentSessions.agentId, agent.id), inArray(agentSessions.tokenId, liveIds)))
          .orderBy(desc(agentSessions.startedAt))
          .get();

  return {
    agent_id: agent.id,
    harness: agent.harness,
    status: agent.status,
    now,
    last_seen_at: agent.lastSeenAt,
    checks: {
      device_paired: {
        state: paired ? 'pass' : 'fail',
        at: paired ? (device.pairedAt ?? null) : null,
        detail: { device_id: agent.deviceId },
      },
      credential_installed: {
        state: newest === undefined ? 'fail' : 'pass',
        at: newest?.createdAt ?? null,
        detail: { token_id: newest?.id ?? null, via_exchange: redeemed !== undefined },
      },
      credential_used: {
        state: used === undefined ? 'fail' : 'pass',
        at: used ?? null,
        detail: null,
      },
      tool_request: {
        state: mcpLive && mcp.clientSlug === agent.harness ? 'pass' : 'fail',
        at: mcpLive ? mcp.reportedAt : null,
        detail: {
          client_slug: mcpLive ? mcp.clientSlug : null,
          client_name: mcpLive ? mcp.clientName : null,
          client_version: mcpLive ? mcp.clientVersion : null,
          self_reported: true,
        },
      },
      session_hooks: {
        state: session === undefined ? 'fail' : 'pass',
        at: session?.startedAt ?? null,
        detail: { harness: session?.harness ?? null },
      },
    },
    client_report:
      cli === undefined
        ? null
        : {
            cli_version: cli.cliVersion,
            cli_commit: cli.cliCommit,
            protocol: cli.protocol,
            capabilities: parseCapabilities(cli.capabilitiesJson),
            harness_version: cli.harnessVersion,
            reported_at: cli.reportedAt,
            self_reported: true,
          },
  };
}

function parseCapabilities(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}
