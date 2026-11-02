import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import {
  agentClientReports,
  agentProjectGrants,
  agents,
  devices,
  orgs,
  tokens,
  toolSetupExchanges,
  users,
} from '../../../src/db/schema.ts';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { CLOUD_TOKEN_MAX_TTL_MS } from '../../../src/services/agents.ts';
import { MAX_FAILED_SIGNATURES } from '../../../src/services/tool-setup.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
  TEST_ORIGIN,
} from '../../helpers/auth.ts';

/**
 * Tool setup on a paired device (SPEC §4.80, §4.81, LAI-1056; plan LAI-1042
 * §E.2, §E.3, §E.7, §K "One-time secret", "24 h TTL", "Per-tool
 * verification isolation"). The owner adds a tool signed in and gets a
 * command with no secret; the paired device redeems it once by signature,
 * and only that answer carries the token.
 */

const PASSWORD = 'correct-horse-battery-staple';
const ORIGIN = new URL(TEST_ORIGIN).origin;

let h: AuthHarness;
let limiter: RateLimiter;
let ada: { cookie: string; id: string };
let bob: { cookie: string; id: string };

interface Auth {
  cookie?: string;
  bearer?: string;
}

interface Key {
  publicKey: string;
  privateKey: KeyObject;
}

interface Created {
  agent: { id: string; harness: string; device_label: string | null; tokens: unknown[] };
  exchange: { id: string; state: string; purpose: string; device_id: string };
  command: string;
  revokes_on_redeem: string[];
}

interface Redeemed {
  agent: { id: string; harness: string };
  token: { id: string; expires_at: number | null; created_at: number };
  secret: string;
  board_origin: string;
}

interface Verification {
  checks: Record<string, { state: string; at: number | null; detail: Record<string, unknown> }>;
  client_report: Record<string, unknown> | null;
  last_seen_at: number | null;
}

function newKey(): Key {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: pair.privateKey,
  };
}

function signPairing(key: Key, id: string, nonce: string): string {
  const message = `laika-pair-v1\n${id}\n${nonce}\n${ORIGIN}`;
  return sign(null, Buffer.from(message, 'utf8'), key.privateKey).toString('base64url');
}

function signRedeem(key: Key, exchangeId: string, deviceId: string, challenge: string): string {
  const message = `laika-tool-redeem-v1\n${exchangeId}\n${deviceId}\n${challenge}\n${ORIGIN}`;
  return sign(null, Buffer.from(message, 'utf8'), key.privateKey).toString('base64url');
}

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  return h.app.request(path, { ...init, headers: jsonHeaders(headers) });
}

function post(path: string, body: unknown, auth?: Auth): Promise<Response> {
  return req(path, { method: 'POST', body: JSON.stringify(body) }, auth);
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok<T = Record<string, unknown>>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function refusal(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  const body = (await res.json()) as { error: { code: string; details: { reason?: string } } };
  return { code: body.error.code, reason: body.error.details?.reason };
}

async function join(email: string) {
  const orgId = h.db.select().from(orgs).get()?.id ?? '';
  const token = seedInvite(h.db, { orgId, createdBy: ada.id, email, orgRole: 'member' });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

/** Pair a device through the real routes (§4.79), and return its id and key. */
async function pair(
  cookie: string,
  name = 'Strelka',
  kind: 'local' | 'cloud' = 'local',
): Promise<{ id: string; key: Key }> {
  const key = newKey();
  const created = await ok<{ user_code: string }>(
    await post('/api/v1/devices/pairing-requests', { kind, display_name: name }, { cookie }),
    201,
  );
  const claimed = await ok<{ pairing_id: string; nonce: string; key_fingerprint: string }>(
    await post('/api/v1/device-pairing/claim', {
      code: created.user_code,
      public_key: key.publicKey,
    }),
  );
  await ok(
    await post(
      `/api/v1/devices/pairing-requests/${claimed.pairing_id}/approve`,
      { key_fingerprint: claimed.key_fingerprint },
      { cookie },
    ),
  );
  const done = await ok<{ device_id: string }>(
    await post(`/api/v1/device-pairing/${claimed.pairing_id}/complete`, {
      signature: signPairing(key, claimed.pairing_id, claimed.nonce),
    }),
  );
  return { id: done.device_id, key };
}

function addTool(cookie: string, deviceId: string, harness = 'claude-code'): Promise<Response> {
  return post(`/api/v1/devices/${deviceId}/tools`, { harness }, { cookie });
}

async function challengeOf(exchangeId: string, deviceId: string): Promise<string> {
  const body = await ok<{ challenge: string }>(
    await post(`/api/v1/tool-setup/${exchangeId}/redeem`, { device_id: deviceId }),
  );
  return body.challenge;
}

/**
 * A signed redeem. The challenge is read from the row, not asked for: an
 * unsigned request on a setup that is no longer open is a 404 (N4, §6.1), and
 * these tests want the signed answer for that state. `challengeOf` asks.
 */
async function redeem(exchangeId: string, device: { id: string; key: Key }): Promise<Response> {
  const challenge =
    h.db.select().from(toolSetupExchanges).where(eq(toolSetupExchanges.id, exchangeId)).get()
      ?.challenge ?? 'missing';
  return post(`/api/v1/tool-setup/${exchangeId}/redeem`, {
    device_id: device.id,
    signature: signRedeem(device.key, exchangeId, device.id, challenge),
  });
}

/** Add a tool and redeem it: the agent and its one-time answer. */
async function install(cookie: string, device: { id: string; key: Key }, harness = 'claude-code') {
  const created = await ok<Created>(await addTool(cookie, device.id, harness), 201);
  const redeemed = await ok<Redeemed>(await redeem(created.exchange.id, device), 201);
  return { created, redeemed };
}

async function verification(agentId: string, auth: Auth): Promise<Verification> {
  return ok<Verification>(await req(`/api/v1/agents/${agentId}/verification`, {}, auth));
}

/** A raw MCP `initialize`, naming a client, on `bearer`. */
async function initialize(bearer: string, name: string, version = '1.0.0'): Promise<void> {
  const res = await h.app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version } },
    }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

/** Every text value of every row of `table`, for a plaintext search. */
function allText(table: typeof tokens | typeof toolSetupExchanges | typeof agentClientReports) {
  return JSON.stringify(h.db.select().from(table).all());
}

beforeEach(async () => {
  limiter = new RateLimiter();
  h = authHarness({ rateLimiter: limiter });
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(setup.status).toBe(201);
  ada = {
    cookie: cookieFrom(setup),
    id: h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '',
  };
  bob = await join('bob@example.test');
});

afterEach(() => {
  h.close();
});

describe('adding a tool', () => {
  it('registers an agent with no credential and no grants, and answers no secret', async () => {
    const device = await pair(bob.cookie);
    const tokensBefore = h.db.select().from(tokens).all().length;
    const res = await addTool(bob.cookie, device.id);
    const text = await res.clone().text();
    const created = await ok<Created>(res, 201);

    expect(created.agent).toMatchObject({ harness: 'claude-code', device_label: 'Strelka' });
    expect(created.agent.tokens).toEqual([]);
    expect(created.exchange).toMatchObject({ state: 'open', purpose: 'install' });
    expect(created.command).toBe(`laika tool add claude-code --exchange ${created.exchange.id}`);
    expect(text).not.toMatch(/lai_/);
    // Neither the answer nor the row carries the challenge: only the device asks for it.
    const row = h.db.select().from(toolSetupExchanges).get();
    expect(text).not.toContain(row?.challenge ?? 'missing');
    expect(h.db.select().from(tokens).all()).toHaveLength(tokensBefore);
    expect(
      h.db
        .select()
        .from(agentProjectGrants)
        .where(eq(agentProjectGrants.agentId, created.agent.id))
        .all(),
    ).toEqual([]);
  });

  it('reuses the one active agent for the device and harness, and withdraws the older setup', async () => {
    const device = await pair(bob.cookie);
    const first = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const firstChallenge = await challengeOf(first.exchange.id, device.id);
    const second = await ok<Created>(await addTool(bob.cookie, device.id), 201);

    expect(second.agent.id).toBe(first.agent.id);
    expect(h.db.select().from(agents).where(eq(agents.ownerUserId, bob.id)).all()).toHaveLength(1);
    // Even signed with the challenge it was given, the older one is withdrawn.
    expect(
      (
        await refusal(
          await post(`/api/v1/tool-setup/${first.exchange.id}/redeem`, {
            device_id: device.id,
            signature: signRedeem(device.key, first.exchange.id, device.id, firstChallenge),
          }),
          409,
        )
      ).reason,
    ).toBe('exchange_cancelled');
  });

  it('refuses legacy duplicates on the pair with 409, naming them, and picks none', async () => {
    const device = await pair(bob.cookie);
    const orgId = h.db.select().from(orgs).get()?.id ?? '';
    const ids = [newId(), newId()];
    for (const id of ids) {
      // Older rows from before D-120, as only raw SQL can make them now.
      h.db
        .insert(agents)
        .values({
          id,
          orgId,
          ownerUserId: bob.id,
          displayName: `Claude ${id}`,
          harness: 'claude-code',
          deviceLabel: ' strelka ',
          deviceId: device.id,
          status: 'active',
          createdAt: Date.now(),
        })
        .run();
    }
    const res = await addTool(bob.cookie, device.id);
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { details: { reason: string; agent_ids: string[] } };
    };
    expect(body.error.details.reason).toBe('agent_duplicates_need_resolution');
    expect([...body.error.details.agent_ids].sort()).toEqual([...ids].sort());
    expect(h.db.select().from(toolSetupExchanges).all()).toEqual([]);
  });

  it('reuses an agent linked to the device even when its label has drifted (N3)', async () => {
    const device = await pair(bob.cookie);
    const orgId = h.db.select().from(orgs).get()?.id ?? '';
    const id = newId();
    h.db
      .insert(agents)
      .values({
        id,
        orgId,
        ownerUserId: bob.id,
        displayName: 'Claude, old name',
        harness: 'claude-code',
        deviceLabel: 'Strelka (old)',
        deviceId: device.id,
        status: 'active',
        createdAt: Date.now(),
      })
      .run();
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    expect(created.agent.id).toBe(id);
    expect(h.db.select().from(agents).where(eq(agents.ownerUserId, bob.id)).all()).toHaveLength(1);
  });

  it('answers another owner’s device exactly as one that does not exist', async () => {
    const theirs = await pair(bob.cookie);
    const foreign = await addTool(ada.cookie, theirs.id);
    const unknown = await addTool(ada.cookie, newId());
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it('refuses a device that is not paired, a harness that names no tool, and any token', async () => {
    const device = await pair(bob.cookie);
    // An imported device: the one the backfill makes for a label, with no key.
    await ok(
      await post(
        '/api/v1/agents',
        { display_name: 'Codex', harness: 'codex', device_label: 'Belka', grants: [] },
        { cookie: bob.cookie },
      ),
      201,
    );
    const imported = h.db.select().from(devices).where(eq(devices.labelKey, 'belka')).get();
    expect(await refusal(await addTool(bob.cookie, imported?.id ?? ''), 409)).toEqual({
      code: 'conflict',
      reason: 'device_not_paired',
    });
    expect(await refusal(await addTool(bob.cookie, device.id, 'other'), 422)).toEqual({
      code: 'unprocessable',
      reason: 'unsupported_harness',
    });

    const { redeemed } = await install(bob.cookie, device);
    expect(
      await refusal(
        await post(
          `/api/v1/devices/${device.id}/tools`,
          { harness: 'codex' },
          { bearer: redeemed.secret },
        ),
        403,
      ),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('redeeming', () => {
  it('mints the token once, at redemption, and stores no plaintext', async () => {
    const device = await pair(bob.cookie);
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const before = h.db.select().from(tokens).all().length;

    const challenge = await challengeOf(created.exchange.id, device.id);
    expect(h.db.select().from(tokens).all()).toHaveLength(before);
    const signature = signRedeem(device.key, created.exchange.id, device.id, challenge);
    const res = await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, {
      device_id: device.id,
      signature,
    });
    const redeemed = await ok<Redeemed>(res, 201);

    expect(redeemed.secret).toMatch(/^lai_/);
    expect(redeemed.board_origin).toBe(ORIGIN);
    expect(redeemed.agent.id).toBe(created.agent.id);
    expect(allText(tokens)).not.toContain(redeemed.secret);
    expect(allText(toolSetupExchanges)).not.toContain(redeemed.secret);
    expect(h.db.select().from(toolSetupExchanges).get()).toMatchObject({
      state: 'redeemed',
      mintedTokenId: redeemed.token.id,
    });

    // The token is the agent's, and it works.
    await ok(await req('/api/v1/me', {}, { bearer: redeemed.secret }));
    expect(h.db.select().from(tokens).where(eq(tokens.id, redeemed.token.id)).get()?.agentId).toBe(
      created.agent.id,
    );

    // A replay of the very same request mints nothing more.
    const replay = await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, {
      device_id: device.id,
      signature,
    });
    expect(await refusal(replay, 409)).toEqual({ code: 'conflict', reason: 'exchange_redeemed' });
    expect(h.db.select().from(tokens).all()).toHaveLength(before + 1);
  });

  it('the secret is in no answer but the redeem', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed } = await install(bob.cookie, device);
    const reads = [
      await req(`/api/v1/tool-setup/${created.exchange.id}`, {}, { cookie: bob.cookie }),
      await req(`/api/v1/agents/${created.agent.id}`, {}, { cookie: bob.cookie }),
      await req(`/api/v1/agents/${created.agent.id}/verification`, {}, { cookie: bob.cookie }),
      await req('/api/v1/devices', {}, { cookie: bob.cookie }),
      await req('/api/v1/tokens', {}, { cookie: bob.cookie }),
      await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, { device_id: device.id }),
    ];
    // The last is a spent setup asked again: the uniform 404 (N4), no secret.
    expect(reads.map((res) => res.status)).toEqual([200, 200, 200, 200, 200, 404]);
    for (const res of reads) expect(await res.text()).not.toContain(redeemed.secret);
  });

  it('refuses a signature from another key, and cancels the setup after five', async () => {
    const device = await pair(bob.cookie);
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const challenge = await challengeOf(created.exchange.id, device.id);
    const wrong = newKey();
    for (let i = 0; i < MAX_FAILED_SIGNATURES; i++) {
      expect(
        await refusal(
          await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, {
            device_id: device.id,
            signature: signRedeem(wrong, created.exchange.id, device.id, challenge),
          }),
          401,
        ),
      ).toEqual({ code: 'unauthorized', reason: 'device_signature_invalid' });
    }
    expect(h.db.select().from(tokens).where(eq(tokens.userId, bob.id)).all()).toEqual([]);
    expect(await refusal(await redeem(created.exchange.id, device), 409)).toEqual({
      code: 'conflict',
      reason: 'exchange_cancelled',
    });
  });

  it('a signature for another board, or a pairing signature, is refused', async () => {
    const device = await pair(bob.cookie);
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const challenge = await challengeOf(created.exchange.id, device.id);
    const otherBoard = sign(
      null,
      Buffer.from(
        `laika-tool-redeem-v1\n${created.exchange.id}\n${device.id}\n${challenge}\nhttps://other.example`,
      ),
      device.key.privateKey,
    ).toString('base64url');
    const pairingShaped = signPairing(device.key, created.exchange.id, challenge);
    for (const signature of [otherBoard, pairingShaped]) {
      expect(
        (
          await refusal(
            await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, {
              device_id: device.id,
              signature,
            }),
            401,
          )
        ).reason,
      ).toBe('device_signature_invalid');
    }
  });

  it('another device, even the owner’s own, is the same 404 as no exchange', async () => {
    const device = await pair(bob.cookie);
    const other = await pair(bob.cookie, 'Belka');
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const wrongDevice = await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, {
      device_id: other.id,
    });
    const unknown = await post(`/api/v1/tool-setup/${newId()}/redeem`, { device_id: device.id });
    expect(wrongDevice.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await wrongDevice.text()).toBe(await unknown.text());
  });

  it('an unsigned request on a setup no longer open is the uniform 404, never the challenge (N4)', async () => {
    const device = await pair(bob.cookie);
    const { created } = await install(bob.cookie, device);
    const cancelled = await ok<Created>(await addTool(bob.cookie, device.id, 'codex'), 201);
    const withdrawn = await req(
      `/api/v1/tool-setup/${cancelled.exchange.id}`,
      { method: 'DELETE' },
      { cookie: bob.cookie },
    );
    expect(withdrawn.status).toBe(204);
    const expired = await ok<Created>(await addTool(bob.cookie, device.id, 'cursor'), 201);
    h.db
      .update(toolSetupExchanges)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(toolSetupExchanges.id, expired.exchange.id))
      .run();
    const unknownBody = await (
      await post(`/api/v1/tool-setup/${newId()}/redeem`, { device_id: device.id })
    ).text();
    for (const id of [created.exchange.id, cancelled.exchange.id, expired.exchange.id]) {
      const res = await post(`/api/v1/tool-setup/${id}/redeem`, { device_id: device.id });
      expect(res.status, id).toBe(404);
      expect(await res.text()).toBe(unknownBody);
    }
  });

  it('a device revoked since the setup was made mints nothing', async () => {
    const device = await pair(bob.cookie);
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    h.db.update(devices).set({ status: 'revoked', revokedAt: Date.now() }).run();
    expect(await refusal(await redeem(created.exchange.id, device), 409)).toEqual({
      code: 'conflict',
      reason: 'device_revoked',
    });
    expect(h.db.select().from(tokens).where(eq(tokens.userId, bob.id)).all()).toEqual([]);
  });

  it('an agent moved to another device since is the same 404 as no setup (N1)', async () => {
    const device = await pair(bob.cookie);
    const other = await pair(bob.cookie, 'Belka');
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const challenge = await challengeOf(created.exchange.id, device.id);
    h.db.update(agents).set({ deviceId: other.id }).where(eq(agents.id, created.agent.id)).run();
    const moved = await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, {
      device_id: device.id,
      signature: signRedeem(device.key, created.exchange.id, device.id, challenge),
    });
    const unknown = await post(`/api/v1/tool-setup/${newId()}/redeem`, { device_id: device.id });
    expect(moved.status).toBe(404);
    expect(await moved.text()).toBe(await unknown.text());
    expect(h.db.select().from(tokens).where(eq(tokens.userId, bob.id)).all()).toEqual([]);
  });

  it('an expired setup mints nothing', async () => {
    const device = await pair(bob.cookie);
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    h.db
      .update(toolSetupExchanges)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(toolSetupExchanges.id, created.exchange.id))
      .run();
    expect(await refusal(await redeem(created.exchange.id, device), 409)).toEqual({
      code: 'conflict',
      reason: 'exchange_expired',
    });
    expect(h.db.select().from(tokens).where(eq(tokens.userId, bob.id)).all()).toEqual([]);
  });

  it('asks the owner again: a deactivated owner’s setup mints nothing', async () => {
    const device = await pair(bob.cookie);
    const created = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const challenge = await challengeOf(created.exchange.id, device.id);
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, bob.id)).run();
    const res = await post(`/api/v1/tool-setup/${created.exchange.id}/redeem`, {
      device_id: device.id,
      signature: signRedeem(device.key, created.exchange.id, device.id, challenge),
    });
    expect(res.status).toBe(404);
    expect(h.db.select().from(tokens).where(eq(tokens.userId, bob.id)).all()).toEqual([]);
  });

  it('a cloud device’s token lives at most 24 hours', async () => {
    const device = await pair(bob.cookie, 'CI runner', 'cloud');
    const { redeemed } = await install(bob.cookie, device);
    const row = h.db.select().from(tokens).where(eq(tokens.id, redeemed.token.id)).get();
    expect(row?.expiresAt).not.toBeNull();
    expect((row?.expiresAt ?? 0) - (row?.createdAt ?? 0)).toBe(CLOUD_TOKEN_MAX_TTL_MS);
  });

  it('a flood against one setup cannot stop another from redeeming', async () => {
    const device = await pair(bob.cookie);
    const other = await pair(bob.cookie, 'Belka');
    const flooded = await ok<Created>(await addTool(bob.cookie, device.id), 201);
    const spare = await ok<Created>(await addTool(bob.cookie, other.id), 201);

    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const res = await post(`/api/v1/tool-setup/${flooded.exchange.id}/redeem`, {
        device_id: device.id,
      });
      if (res.status === 429) {
        limited = true;
        expect(res.headers.get('Retry-After')).not.toBeNull();
      }
    }
    expect(limited).toBe(true);
    // A made-up id shares one key, never another exchange's.
    for (let i = 0; i < 40; i++) {
      await post('/api/v1/tool-setup/not-a-ulid/redeem', { device_id: device.id });
    }
    await ok(await redeem(spare.exchange.id, other), 201);
  });
});

describe('reconnecting', () => {
  it('rotates in one step: the old token dies as the new one is minted, and the agent stays', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed: first } = await install(bob.cookie, device);
    const project = await ok<{ id: string }>(
      await post(
        '/api/v1/projects',
        { name: 'Web', slug: 'web', prefix: 'WEB' },
        { cookie: ada.cookie },
      ),
      201,
    );
    await ok(
      await post(
        '/api/v1/projects/web/members',
        { user_id: bob.id, role: 'member' },
        { cookie: ada.cookie },
      ),
      201,
    );
    await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/grants`,
        {
          method: 'PUT',
          body: JSON.stringify({ grants: [{ project_id: project.id, scope: 'read_only' }] }),
        },
        { cookie: bob.cookie },
      ),
    );
    const grantsBefore = h.db
      .select()
      .from(agentProjectGrants)
      .where(eq(agentProjectGrants.agentId, created.agent.id))
      .all();

    const again = await ok<Created>(
      await post(`/api/v1/agents/${created.agent.id}/reconnect`, {}, { cookie: bob.cookie }),
      201,
    );
    expect(again.exchange.purpose).toBe('rotate');
    // The answer says, before the command is copied, what redeeming revokes.
    expect(again.revokes_on_redeem).toEqual([first.token.id]);
    expect(created.revokes_on_redeem).toEqual([]);
    expect(again.agent.id).toBe(created.agent.id);
    // Until the device redeems, the old credential still works.
    expect((await req('/api/v1/me', {}, { bearer: first.secret })).status).toBe(200);

    const second = await ok<Redeemed>(await redeem(again.exchange.id, device), 201);
    const old = h.db.select().from(tokens).where(eq(tokens.id, first.token.id)).get();
    const fresh = h.db.select().from(tokens).where(eq(tokens.id, second.token.id)).get();
    expect(old?.revokedAt).not.toBeNull();
    expect(old?.revokedAt).toBe(fresh?.createdAt);
    expect((await req('/api/v1/me', {}, { bearer: first.secret })).status).toBe(401);
    expect((await req('/api/v1/me', {}, { bearer: second.secret })).status).toBe(200);
    expect(second.agent.id).toBe(created.agent.id);
    expect(
      h.db
        .select()
        .from(agentProjectGrants)
        .where(eq(agentProjectGrants.agentId, created.agent.id))
        .all(),
    ).toEqual(grantsBefore);
    expect(grantsBefore).toHaveLength(1);
    expect(
      h.db
        .select()
        .from(tokens)
        .where(eq(tokens.agentId, created.agent.id))
        .all()
        .filter((t) => t.revokedAt === null),
    ).toHaveLength(1);
  });

  it('refuses an agent whose device is not paired', async () => {
    const legacy = await ok<{ agent: { id: string } }>(
      await post(
        '/api/v1/agents',
        { display_name: 'Codex', harness: 'codex', device_label: 'Belka', grants: [] },
        { cookie: bob.cookie },
      ),
      201,
    );
    expect(
      await refusal(
        await post(`/api/v1/agents/${legacy.agent.id}/reconnect`, {}, { cookie: bob.cookie }),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'device_not_paired' });
  });
});

describe('verification evidence', () => {
  it('a curl reaches Connected and never the tool request', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed } = await install(bob.cookie, device);

    let seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.device_paired?.state).toBe('pass');
    expect(seen.checks.credential_installed).toMatchObject({
      state: 'pass',
      detail: { via_exchange: true },
    });
    expect(seen.checks.credential_used?.state).toBe('fail');
    expect(seen.checks.tool_request?.state).toBe('fail');
    expect(seen.client_report).toBeNull();

    await ok(await req('/api/v1/me', {}, { bearer: redeemed.secret }));
    seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.credential_used?.state).toBe('pass');
    expect(seen.checks.tool_request?.state).toBe('fail');
    expect(seen.checks.session_hooks?.state).toBe('fail');
  });

  it('passes the tool request only for this agent’s own credential naming this tool', async () => {
    const device = await pair(bob.cookie);
    const { created: claude, redeemed: claudeToken } = await install(bob.cookie, device);
    const { redeemed: codexToken } = await install(bob.cookie, device, 'codex');
    const personal = await ok<{ secret: string }>(
      await post('/api/v1/tokens', { name: 'mine', scope: 'full' }, { cookie: bob.cookie }),
      201,
    );

    // Another tool's credential announcing itself as Claude Code, and the
    // owner's personal token doing the same, both say nothing about this one.
    await initialize(codexToken.secret, 'claude-code');
    await initialize(personal.secret, 'claude-code');
    let seen = await verification(claude.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request?.state).toBe('fail');

    // This credential, but another tool's name: still not this tool.
    await initialize(claudeToken.secret, 'codex-mcp-client');
    seen = await verification(claude.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request).toMatchObject({
      state: 'fail',
      detail: { client_slug: 'codex', self_reported: true },
    });

    await initialize(claudeToken.secret, 'claude-code', '2.1.280');
    seen = await verification(claude.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request).toMatchObject({
      state: 'pass',
      detail: { client_slug: 'claude-code', client_name: 'claude-code', client_version: '2.1.280' },
    });
    expect(seen.checks.tool_request?.at).not.toBeNull();

    // A reconnect retires the evidence with the credential it came from.
    const again = await ok<Created>(
      await post(`/api/v1/agents/${claude.agent.id}/reconnect`, {}, { cookie: bob.cookie }),
      201,
    );
    await ok(await redeem(again.exchange.id, device), 201);
    seen = await verification(claude.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request?.state).toBe('fail');
  });

  it('the agent’s own token reads its own evidence; another agent’s and another owner are 404', async () => {
    const device = await pair(bob.cookie);
    const { created: claude, redeemed: claudeToken } = await install(bob.cookie, device);
    const { redeemed: codexToken } = await install(bob.cookie, device, 'codex');
    await verification(claude.agent.id, { bearer: claudeToken.secret });
    const sibling = await req(
      `/api/v1/agents/${claude.agent.id}/verification`,
      {},
      { bearer: codexToken.secret },
    );
    const foreign = await req(
      `/api/v1/agents/${claude.agent.id}/verification`,
      {},
      { cookie: ada.cookie },
    );
    const unknown = await req(`/api/v1/agents/${newId()}/verification`, {}, { cookie: ada.cookie });
    expect(sibling.status).toBe(404);
    expect(foreign.status).toBe(404);
    const unknownBody = await unknown.text();
    expect(await foreign.text()).toBe(unknownBody);
    expect(await sibling.text()).toBe(unknownBody);
  });
});

describe('client reports', () => {
  const report = {
    cli_version: '0.9.0',
    cli_commit: 'cea011d6',
    protocol: 2,
    capabilities: ['tool_setup_exchange', 'session_hooks'],
    harness_version: '2.1.280',
  };

  it('keeps the agent’s own report, marked self-reported, and shows it as evidence', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed } = await install(bob.cookie, device);
    const stored = await ok<{
      capabilities: string[];
      self_reported: boolean;
      reported_at: number;
    }>(await post('/api/v1/agents/me/client-report', report, { bearer: redeemed.secret }));
    expect(stored).toMatchObject({
      cli_version: '0.9.0',
      capabilities: ['session_hooks', 'tool_setup_exchange'],
      self_reported: true,
    });
    expect(stored.reported_at).not.toBeNull();
    const seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.client_report).toMatchObject({ cli_version: '0.9.0', protocol: 2 });
  });

  it('is an agent token’s alone', async () => {
    const personal = await ok<{ secret: string }>(
      await post('/api/v1/tokens', { name: 'mine', scope: 'full' }, { cookie: bob.cookie }),
      201,
    );
    expect(
      await refusal(
        await post('/api/v1/agents/me/client-report', report, { bearer: personal.secret }),
        403,
      ),
    ).toEqual({ code: 'forbidden', reason: 'not_an_agent' });
    expect(
      await refusal(
        await post('/api/v1/agents/me/client-report', report, { cookie: bob.cookie }),
        403,
      ),
    ).toEqual({ code: 'forbidden', reason: 'not_an_agent' });
  });

  it('refuses anything outside the schema: unknown fields, capabilities, sizes', async () => {
    const device = await pair(bob.cookie);
    const { redeemed } = await install(bob.cookie, device);
    const bad = [
      { ...report, admin: true },
      { ...report, capabilities: ['root'] },
      { ...report, capabilities: Array.from({ length: 33 }, () => 'claims') },
      { ...report, cli_version: '1'.repeat(65) },
      { ...report, cli_version: '0.9.0 <b>' },
      { ...report, cli_commit: 'not-hex' },
      { ...report, protocol: 0 },
      { ...report, harness_version: '' },
    ];
    for (const body of bad) {
      const res = await post('/api/v1/agents/me/client-report', body, { bearer: redeemed.secret });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(h.db.select().from(agentClientReports).all()).toEqual([]);
  });

  it('keeps no time while the org has presence off', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed } = await install(bob.cookie, device);
    h.db.update(orgs).set({ presenceEnabled: 0 }).run();
    const stored = await ok<{ reported_at: number | null }>(
      await post('/api/v1/agents/me/client-report', report, { bearer: redeemed.secret }),
    );
    expect(stored.reported_at).toBeNull();
    await initialize(redeemed.secret, 'claude-code');
    const seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request).toMatchObject({ state: 'pass', at: null });
  });

  it('a time stamped while presence was on is not shown once it is off (B1)', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed } = await install(bob.cookie, device);
    await initialize(redeemed.secret, 'claude-code');
    await ok(await post('/api/v1/agents/me/client-report', report, { bearer: redeemed.secret }));
    let seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request?.at).not.toBeNull();
    expect(seen.client_report?.reported_at).not.toBeNull();

    h.db.update(orgs).set({ presenceEnabled: 0 }).run();
    // Read at once, before anything is written: the read gates it.
    seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request).toMatchObject({ state: 'pass', at: null });
    expect(seen.client_report?.reported_at).toBeNull();

    // The same name again, inside the throttle: the stored time goes too.
    await initialize(redeemed.secret, 'claude-code');
    const row = h.db
      .select()
      .from(agentClientReports)
      .where(eq(agentClientReports.source, 'mcp_initialize'))
      .get();
    expect(row?.reportedAt).toBeNull();
  });
});

describe('a client whose MCP name is generic (D-125)', () => {
  const omnigentReport = {
    cli_version: '0.9.0',
    protocol: 2,
    harness: 'omnigent',
    capabilities: ['tool_setup_exchange', 'client_report'],
  };

  it('passes only with an MCP request and a report naming the harness, from one token', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed } = await install(bob.cookie, device, 'omnigent');

    // `mcp` alone names no tool.
    await initialize(redeemed.secret, 'mcp');
    let seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request).toMatchObject({
      state: 'fail',
      detail: { mcp_client_name: 'generic', evidence: null, client_slug: 'other' },
    });

    // A report naming another harness is no evidence either.
    await ok(
      await post(
        '/api/v1/agents/me/client-report',
        { ...omnigentReport, harness: 'hermes' },
        { bearer: redeemed.secret },
      ),
    );
    seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request?.state).toBe('fail');

    // Named, but without the capabilities Ready needs.
    await ok(
      await post(
        '/api/v1/agents/me/client-report',
        { ...omnigentReport, capabilities: ['client_report'] },
        { bearer: redeemed.secret },
      ),
    );
    seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request).toMatchObject({
      state: 'pass',
      detail: { evidence: 'client_report', self_reported: true },
    });
    expect(seen.checks.required_capabilities).toMatchObject({
      state: 'fail',
      detail: { missing: ['tool_setup_exchange'] },
    });

    await ok(
      await post('/api/v1/agents/me/client-report', omnigentReport, { bearer: redeemed.secret }),
    );
    seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.required_capabilities?.state).toBe('pass');
  });

  it('a report naming the harness does not pass a specific client without its own name', async () => {
    const device = await pair(bob.cookie);
    const { created, redeemed } = await install(bob.cookie, device);
    await initialize(redeemed.secret, 'mcp');
    await ok(
      await post(
        '/api/v1/agents/me/client-report',
        { ...omnigentReport, harness: 'claude-code' },
        { bearer: redeemed.secret },
      ),
    );
    const seen = await verification(created.agent.id, { cookie: bob.cookie });
    expect(seen.checks.tool_request).toMatchObject({
      state: 'fail',
      detail: { mcp_client_name: 'specific' },
    });
    expect(seen.checks.required_capabilities?.state).toBe('pass');
  });
});
