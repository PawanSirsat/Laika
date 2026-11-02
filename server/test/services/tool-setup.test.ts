import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toolRedeemMessage } from '../../src/auth/device-signature.ts';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  agentClientReports,
  agents,
  devices,
  tokens,
  toolSetupExchanges,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { CLOUD_TOKEN_MAX_TTL_MS } from '../../src/services/agents.ts';
import { recordMcpClientReport } from '../../src/services/client-reports.ts';
import { insertToken } from '../../src/services/tokens.ts';
import {
  EXCHANGE_TTL_MS,
  getAgentVerification,
  MAX_OPEN_EXCHANGES,
  addToolToDevice,
  cancelToolSetup,
  getToolSetup,
  redeemToolSetup,
} from '../../src/services/tool-setup.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/tool-setup.ts` (SPEC §4.80, LAI-1056) on a clock of its own. The
 * HTTP half — 404 bodies, rate limits, the MCP evidence — is
 * `test/http/routes/tool-setup.test.ts`.
 */

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://board.example';

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
  owner = loadActor(t.db, s.userId)!;
});

afterEach(() => {
  t.close();
});

function refusal(fn: () => unknown): { code: string; reason: unknown } {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    return { code: e.code, reason: (e.details as { reason?: unknown } | null)?.reason };
  }
  throw new Error('expected a refusal');
}

/** A paired device of the owner's, with the private half of its key. */
function pairedDevice(name: string, kind: 'local' | 'cloud' = 'local') {
  const pair = generateKeyPairSync('ed25519');
  const id = newId();
  t.db
    .insert(devices)
    .values({
      id,
      orgId: s.orgId,
      ownerUserId: s.userId,
      displayName: name,
      labelKey: name.toLowerCase(),
      kind,
      origin: 'paired',
      publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      keyFingerprint: 'f'.repeat(16),
      confirmedAt: NOW,
      pairedAt: NOW,
      status: 'active',
      createdAt: NOW,
    })
    .run();
  return { id, privateKey: pair.privateKey };
}

function redeem(exchangeId: string, device: { id: string; privateKey: KeyObject }, now = NOW) {
  const first = redeemToolSetup(t.sqlite, t.db, {
    id: exchangeId,
    deviceId: device.id,
    boardOrigin: ORIGIN,
    now,
  });
  if (first.kind !== 'challenge') throw new Error(`expected a challenge, got ${first.kind}`);
  return redeemToolSetup(t.sqlite, t.db, {
    id: exchangeId,
    deviceId: device.id,
    signature: sign(
      null,
      toolRedeemMessage(exchangeId, device.id, first.challenge, ORIGIN),
      device.privateKey,
    ).toString('base64url'),
    boardOrigin: ORIGIN,
    now,
  });
}

describe('the exchange', () => {
  it('expires ten minutes after it is made, by the clock it is read with', () => {
    const device = pairedDevice('Strelka');
    const created = addToolToDevice(t.sqlite, t.db, owner, device.id, {
      harness: 'claude-code',
      now: NOW,
    });
    expect(created.exchange.expires_at).toBe(NOW + EXCHANGE_TTL_MS);
    expect(getToolSetup(t.db, owner, created.exchange.id, NOW + EXCHANGE_TTL_MS).state).toBe(
      'expired',
    );
    expect(refusal(() => redeem(created.exchange.id, device, NOW + EXCHANGE_TTL_MS))).toEqual({
      code: 'conflict',
      reason: 'exchange_expired',
    });
    expect(redeem(created.exchange.id, device, NOW + EXCHANGE_TTL_MS - 1).kind).toBe('redeemed');
  });

  it('is never a token’s business: a token cannot add a tool, even its owner’s', () => {
    const device = pairedDevice('Strelka');
    const created = addToolToDevice(t.sqlite, t.db, owner, device.id, {
      harness: 'codex',
      now: NOW,
    });
    const outcome = redeem(created.exchange.id, device);
    if (outcome.kind !== 'redeemed') throw new Error('expected a redeem');
    const asToken: ResolvedActor = {
      ...owner,
      token: {
        id: outcome.body.token.id,
        scope: 'full',
        projectIds: null,
        expiresAt: null,
        agent: null,
      },
    };
    expect(
      refusal(() => addToolToDevice(t.sqlite, t.db, asToken, device.id, { harness: 'claude-code' }))
        .code,
    ).toBe('forbidden');
  });

  it('caps open setups per owner, and a newer one for the same agent replaces the older', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    const made = names.map((name) => pairedDevice(name));
    for (const device of made.slice(0, MAX_OPEN_EXCHANGES)) {
      addToolToDevice(t.sqlite, t.db, owner, device.id, { harness: 'claude-code', now: NOW });
    }
    expect(
      refusal(() =>
        addToolToDevice(t.sqlite, t.db, owner, made[MAX_OPEN_EXCHANGES]!.id, {
          harness: 'claude-code',
          now: NOW,
        }),
      ),
    ).toEqual({ code: 'conflict', reason: 'too_many_open_exchanges' });
    // The refused add left no agent behind: it is one transaction.
    expect(t.db.select().from(agents).all()).toHaveLength(MAX_OPEN_EXCHANGES);
    // Again on a device that has one: replaces, so the cap is not hit.
    addToolToDevice(t.sqlite, t.db, owner, made[0]!.id, { harness: 'claude-code', now: NOW });
    expect(
      t.db.select().from(toolSetupExchanges).where(eq(toolSetupExchanges.state, 'open')).all(),
    ).toHaveLength(MAX_OPEN_EXCHANGES);
  });

  it('the owner cancels an open one once; a cancelled one redeems nothing', () => {
    const device = pairedDevice('Strelka');
    const created = addToolToDevice(t.sqlite, t.db, owner, device.id, {
      harness: 'claude-code',
      now: NOW,
    });
    cancelToolSetup(t.sqlite, t.db, owner, created.exchange.id, NOW);
    expect(refusal(() => cancelToolSetup(t.sqlite, t.db, owner, created.exchange.id, NOW))).toEqual(
      { code: 'conflict', reason: 'exchange_cancelled' },
    );
    expect(refusal(() => redeem(created.exchange.id, device))).toEqual({
      code: 'conflict',
      reason: 'exchange_cancelled',
    });
    expect(t.db.select().from(tokens).all()).toEqual([]);
  });

  it('a revoked agent’s setup mints nothing', () => {
    const device = pairedDevice('Strelka');
    const created = addToolToDevice(t.sqlite, t.db, owner, device.id, {
      harness: 'claude-code',
      now: NOW,
    });
    t.db.update(agents).set({ status: 'revoked', revokedAt: NOW }).run();
    expect(refusal(() => redeem(created.exchange.id, device))).toEqual({
      code: 'conflict',
      reason: 'agent_revoked',
    });
    expect(t.db.select().from(tokens).all()).toEqual([]);
  });
});

describe('cloud', () => {
  it('a device named Cloud is a cloud device, and its token lives exactly a day from redeem', () => {
    const device = pairedDevice('Cloud');
    const created = addToolToDevice(t.sqlite, t.db, owner, device.id, {
      harness: 'claude-code',
      now: NOW,
    });
    const later = NOW + 5 * 60_000;
    const outcome = redeem(created.exchange.id, device, later);
    if (outcome.kind !== 'redeemed') throw new Error('expected a redeem');
    expect(outcome.body.token.expires_at).toBe(later + CLOUD_TOKEN_MAX_TTL_MS);
  });

  it('a local device’s first token does not expire', () => {
    const device = pairedDevice('Strelka');
    const created = addToolToDevice(t.sqlite, t.db, owner, device.id, {
      harness: 'claude-code',
      now: NOW,
    });
    const outcome = redeem(created.exchange.id, device);
    if (outcome.kind !== 'redeemed') throw new Error('expected a redeem');
    expect(outcome.body.token.expires_at).toBeNull();
  });
});

describe('a generic MCP client (D-125)', () => {
  it('needs the MCP request and the report naming the harness from the same live token', () => {
    const agentId = newId();
    t.db
      .insert(agents)
      .values({
        id: agentId,
        orgId: s.orgId,
        ownerUserId: s.userId,
        displayName: 'Polly',
        harness: 'omnigent',
        status: 'active',
        createdAt: NOW,
      })
      .run();
    const mint = () =>
      insertToken(t.db, owner, {
        name: 'Polly',
        scope: 'full',
        projectIds: null,
        expiresAt: null,
        agentId,
        now: NOW,
      }).token.id;
    const a = mint();
    const b = mint();
    const cliFrom = (tokenId: string) =>
      t.db
        .insert(agentClientReports)
        .values({
          agentId,
          source: 'cli',
          tokenId,
          cliVersion: '0.9.0',
          protocol: 2,
          capabilitiesJson: JSON.stringify(['client_report', 'tool_setup_exchange']),
          harness: 'omnigent',
          reportedAt: NOW,
        })
        .onConflictDoUpdate({
          target: [agentClientReports.agentId, agentClientReports.source],
          set: { tokenId },
        })
        .run();

    expect(recordMcpClientReport(t.db, a, NOW, 'mcp', '1.0')).toBe(true);
    cliFrom(b);
    const fromTwo = getAgentVerification(t.db, owner, agentId, NOW);
    expect(fromTwo.checks.tool_request.state).toBe('fail');

    cliFrom(a);
    const fromOne = getAgentVerification(t.db, owner, agentId, NOW);
    expect(fromOne.checks.tool_request).toMatchObject({
      state: 'pass',
      detail: { evidence: 'client_report', mcp_client_name: 'generic' },
    });
    expect(fromOne.checks.required_capabilities.state).toBe('pass');

    // Once that token is revoked, its word is no evidence for the tool now.
    t.db.update(tokens).set({ revokedAt: NOW }).where(eq(tokens.id, a)).run();
    const revoked = getAgentVerification(t.db, owner, agentId, NOW);
    expect(revoked.checks.tool_request.state).toBe('fail');
    expect(revoked.checks.required_capabilities.state).toBe('fail');
  });
});
