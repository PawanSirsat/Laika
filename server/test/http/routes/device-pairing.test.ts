import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  agentSessions,
  agents,
  devicePairingRequests,
  devices,
  orgs,
  tokens,
  users,
} from '../../../src/db/schema.ts';
import { LIMITS, RateLimiter } from '../../../src/http/rate-limit.ts';
import { MAX_FAILED_SIGNATURES, MAX_OPEN_PAIRINGS } from '../../../src/services/device-pairing.ts';
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
 * Device pairing (SPEC §4.79, LAI-1050; plan LAI-1042 §E.1, §K "Pairing
 * security"). The owner asks for a code signed in; the device claims it once
 * with a fresh Ed25519 key; the owner approves the fingerprint they saw; the
 * device signs the challenge. **No step mints a credential.**
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let clock: number;
let limiter: RateLimiter;
let ada: { cookie: string; id: string };
let bob: { cookie: string; id: string };

interface Auth {
  cookie?: string;
  bearer?: string;
}

interface Pairing {
  id: string;
  state: string;
  kind: string;
  display_name: string;
  device_id: string | null;
  claimed: { key_fingerprint: string; os: string | null; cli_version: string | null } | null;
  expires_at: number;
}

interface Key {
  publicKey: string;
  privateKey: KeyObject;
}

function newKey(): Key {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKey: pair.privateKey,
  };
}

function signFor(key: Key, pairingId: string, nonce: string, origin = TEST_ORIGIN): string {
  const message = `laika-pair-v1\n${pairingId}\n${nonce}\n${new URL(origin).origin}`;
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

async function create(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<{ pairing: Pairing; user_code: string; command: string }> {
  return ok(
    await post(
      '/api/v1/devices/pairing-requests',
      { kind: 'local', display_name: 'Strelka', ...body },
      { cookie },
    ),
    201,
  );
}

async function claim(code: string, key: Key) {
  return ok<{ pairing_id: string; nonce: string; key_fingerprint: string }>(
    await post('/api/v1/device-pairing/claim', {
      code,
      public_key: key.publicKey,
      os: 'darwin',
      cli_version: '0.9.0',
    }),
  );
}

function complete(id: string, signature: string): Promise<Response> {
  return post(`/api/v1/device-pairing/${id}/complete`, { signature });
}

function approve(cookie: string, id: string, fingerprint: string): Promise<Response> {
  return post(
    `/api/v1/devices/pairing-requests/${id}/approve`,
    { key_fingerprint: fingerprint },
    { cookie },
  );
}

function count(table: typeof tokens | typeof agents | typeof activity | typeof agentSessions) {
  return (
    h.db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .get()?.n ?? -1
  );
}

async function register(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return post(
    '/api/v1/agents',
    { display_name: 'Claude', harness: 'claude-code', grants: [], ...body },
    { cookie },
  );
}

beforeEach(async () => {
  clock = Date.now();
  limiter = new RateLimiter(() => clock);
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

describe('a pairing, start to finish', () => {
  it('pairs a new device and mints no credential at any step', async () => {
    const before = {
      tokens: count(tokens),
      agents: count(agents),
      sessions: count(agentSessions),
      activity: count(activity),
    };
    const key = newKey();

    const created = await create(bob.cookie);
    expect(created.user_code).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
    );
    expect(created.command).toBe(
      `laika device pair --board ${TEST_ORIGIN} --code ${created.user_code}`,
    );
    expect(created.pairing).toMatchObject({ state: 'open', kind: 'local', claimed: null });

    // The code is never stored, in any column, in any spelling.
    const row = h.db.select().from(devicePairingRequests).get();
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(created.user_code);
    expect(stored).not.toContain(created.user_code.replaceAll('-', ''));
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);

    // Reading it back never returns the code.
    const read = await ok<Pairing>(
      await req(
        `/api/v1/devices/pairing-requests/${created.pairing.id}`,
        {},
        { cookie: bob.cookie },
      ),
    );
    expect(JSON.stringify(read)).not.toContain(created.user_code);

    // Typed in lower case, without the hyphen: the same code.
    const claimed = await claim(created.user_code.replaceAll('-', '').toLowerCase(), key);
    expect(claimed.pairing_id).toBe(created.pairing.id);
    expect(claimed.key_fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // The claim answer holds no secret beyond its own challenge.
    expect(Object.keys(claimed).sort()).toEqual([
      'expires_at',
      'key_fingerprint',
      'nonce',
      'pairing_id',
    ]);

    const shown = await ok<Pairing>(
      await req(
        `/api/v1/devices/pairing-requests/${created.pairing.id}`,
        {},
        { cookie: bob.cookie },
      ),
    );
    expect(shown.state).toBe('claimed');
    expect(shown.claimed).toMatchObject({
      key_fingerprint: claimed.key_fingerprint,
      os: 'darwin',
      cli_version: '0.9.0',
    });

    // Before the owner decides, a correct signature is told to wait.
    const signature = signFor(key, claimed.pairing_id, claimed.nonce);
    expect(await ok(await complete(claimed.pairing_id, signature), 202)).toEqual({
      state: 'claimed',
    });
    expect(h.db.select().from(devices).where(eq(devices.ownerUserId, bob.id)).all()).toEqual([]);

    expect(
      (await ok<Pairing>(await approve(bob.cookie, claimed.pairing_id, claimed.key_fingerprint)))
        .state,
    ).toBe('approved');

    const done = await ok<{ device_id: string; display_name: string; kind: string }>(
      await complete(claimed.pairing_id, signature),
    );
    expect(done.device_id).toMatch(/^[0-9A-Z]{26}$/);
    expect(done).toEqual({
      device_id: done.device_id,
      display_name: 'Strelka',
      kind: 'local',
      board_origin: TEST_ORIGIN,
    });

    const device = await ok<Record<string, unknown>>(
      await req(`/api/v1/devices/${done.device_id}`, {}, { cookie: bob.cookie }),
    );
    expect(device).toMatchObject({
      display_name: 'Strelka',
      origin: 'paired',
      status: 'active',
      confirmed: true,
      key_fingerprint: claimed.key_fingerprint,
      agents: [],
    });
    expect(h.db.select().from(devices).where(eq(devices.id, done.device_id)).get()?.publicKey).toBe(
      key.publicKey,
    );

    // A replay of the completing signature is refused, and changes nothing.
    expect(await refusal(await complete(claimed.pairing_id, signature), 409)).toEqual({
      code: 'conflict',
      reason: 'pairing_completed',
    });

    // Nothing a pairing does is a credential, an agent, a session or a verb.
    expect({
      tokens: count(tokens),
      agents: count(agents),
      sessions: count(agentSessions),
      activity: count(activity),
    }).toEqual(before);
    // And no response along the way carried a token's shape.
    expect(JSON.stringify([created, read, claimed, shown, done, device])).not.toMatch(/lai_/);
  });

  it('attaches the key to an imported device of the owner’s, by explicit choice', async () => {
    await ok(await register(bob.cookie, { device_label: 'Belka' }), 201);
    const imported = h.db.select().from(devices).where(eq(devices.ownerUserId, bob.id)).get();
    expect(imported?.origin).toBe('imported');

    const created = await create(bob.cookie, { display_name: 'ignored', device_id: imported?.id });
    expect(created.pairing).toMatchObject({ display_name: 'Belka', device_id: imported?.id });

    const key = newKey();
    const claimed = await claim(created.user_code, key);
    await ok(await approve(bob.cookie, claimed.pairing_id, claimed.key_fingerprint));
    const done = await ok<{ device_id: string }>(
      await complete(claimed.pairing_id, signFor(key, claimed.pairing_id, claimed.nonce)),
    );

    expect(done.device_id).toBe(imported?.id);
    const rows = h.db.select().from(devices).where(eq(devices.ownerUserId, bob.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      origin: 'paired',
      publicKey: key.publicKey,
      keyFingerprint: claimed.key_fingerprint,
    });
    // Its agent is still on it, untouched.
    expect(h.db.select().from(agents).where(eq(agents.ownerUserId, bob.id)).get()?.deviceId).toBe(
      imported?.id,
    );

    // Paired once: a second request for it is refused.
    expect(
      await refusal(
        await post(
          '/api/v1/devices/pairing-requests',
          { kind: 'local', display_name: 'x', device_id: imported?.id },
          { cookie: bob.cookie },
        ),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'device_already_paired' });
  });

  it('never changes an existing device’s kind', async () => {
    await ok(await register(bob.cookie, { device_label: 'Belka' }), 201);
    const imported = h.db.select().from(devices).where(eq(devices.ownerUserId, bob.id)).get();
    expect(
      await refusal(
        await post(
          '/api/v1/devices/pairing-requests',
          { kind: 'cloud', display_name: 'Belka', device_id: imported?.id },
          { cookie: bob.cookie },
        ),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'device_kind_mismatch' });
  });

  it('a paired cloud device puts the agents registered on it under the 24 h rule', async () => {
    const created = await create(bob.cookie, { kind: 'cloud', display_name: 'CI runner' });
    const key = newKey();
    const claimed = await claim(created.user_code, key);
    await ok(await approve(bob.cookie, claimed.pairing_id, claimed.key_fingerprint));
    const done = await ok<{ device_id: string; kind: string }>(
      await complete(claimed.pairing_id, signFor(key, claimed.pairing_id, claimed.nonce)),
    );
    expect(done.kind).toBe('cloud');

    expect(await refusal(await register(bob.cookie, { device_label: 'ci runner' }), 422)).toEqual({
      code: 'unprocessable',
      reason: 'cloud_token_expiry_required',
    });
    const agent = await ok<{ agent: { id: string } }>(
      await register(bob.cookie, {
        device_label: 'CI runner',
        expires_at: Date.now() + 60 * 60_000,
      }),
      201,
    );
    expect(h.db.select().from(agents).where(eq(agents.id, agent.agent.id)).get()?.deviceId).toBe(
      done.device_id,
    );
  });
});

describe('the code', () => {
  it('is claimed once; a second claim is told it was used', async () => {
    const created = await create(bob.cookie);
    await claim(created.user_code, newKey());
    expect(
      await refusal(
        await post('/api/v1/device-pairing/claim', {
          code: created.user_code,
          public_key: newKey().publicKey,
        }),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'pairing_already_claimed' });
  });

  // The race itself is proved in test/services/device-pairing.test.ts, by a
  // stale read: requests here run one at a time on one connection.
  it('of two claims sent at once, exactly one wins', async () => {
    const created = await create(bob.cookie);
    const [a, b] = await Promise.all(
      [newKey(), newKey()].map((key) =>
        post('/api/v1/device-pairing/claim', {
          code: created.user_code,
          public_key: key.publicKey,
        }),
      ),
    );
    expect([a?.status, b?.status].sort()).toEqual([200, 409]);
    const row = h.db.select().from(devicePairingRequests).get();
    expect(row?.state).toBe('claimed');
  });

  it('unknown, expired and finished codes are the same 404', async () => {
    const unknown = await post('/api/v1/device-pairing/claim', {
      code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ',
      public_key: newKey().publicKey,
    });
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.text();

    const malformed = await post('/api/v1/device-pairing/claim', {
      code: 'not a code',
      public_key: newKey().publicKey,
    });
    expect(malformed.status).toBe(404);
    expect(await malformed.text()).toBe(unknownBody);

    const stale = await create(bob.cookie);
    h.db
      .update(devicePairingRequests)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(devicePairingRequests.id, stale.pairing.id))
      .run();
    const expired = await post('/api/v1/device-pairing/claim', {
      code: stale.user_code,
      public_key: newKey().publicKey,
    });
    expect(expired.status).toBe(404);
    expect(await expired.text()).toBe(unknownBody);
    expect(
      (
        await ok<Pairing>(
          await req(
            `/api/v1/devices/pairing-requests/${stale.pairing.id}`,
            {},
            {
              cookie: bob.cookie,
            },
          ),
        )
      ).state,
    ).toBe('expired');

    const cancelled = await create(bob.cookie, { display_name: 'Other' });
    expect(
      (
        await req(
          `/api/v1/devices/pairing-requests/${cancelled.pairing.id}`,
          { method: 'DELETE' },
          { cookie: bob.cookie },
        )
      ).status,
    ).toBe(204);
    const finished = await post('/api/v1/device-pairing/claim', {
      code: cancelled.user_code,
      public_key: newKey().publicKey,
    });
    expect(finished.status).toBe(404);
    expect(await finished.text()).toBe(unknownBody);
  });

  it('refuses a key that is not Ed25519 SPKI, and one a device already holds', async () => {
    const created = await create(bob.cookie);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 })
      .publicKey.export({ format: 'der', type: 'spki' })
      .toString('base64url');
    for (const publicKey of [rsa, 'AAAA', `${newKey().publicKey}=`]) {
      expect(
        await refusal(
          await post('/api/v1/device-pairing/claim', {
            code: created.user_code,
            public_key: publicKey,
          }),
          422,
        ),
      ).toEqual({ code: 'unprocessable', reason: 'invalid_public_key' });
    }

    const key = newKey();
    const claimed = await claim(created.user_code, key);
    await ok(await approve(bob.cookie, claimed.pairing_id, claimed.key_fingerprint));
    await ok(await complete(claimed.pairing_id, signFor(key, claimed.pairing_id, claimed.nonce)));

    const again = await create(bob.cookie, { display_name: 'Other' });
    expect(
      await refusal(
        await post('/api/v1/device-pairing/claim', {
          code: again.user_code,
          public_key: key.publicKey,
        }),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'device_key_in_use' });
  });
});

describe('completing', () => {
  async function claimedRequest() {
    const created = await create(bob.cookie);
    const key = newKey();
    return { key, claimed: await claim(created.user_code, key) };
  }

  it('refuses a wrong signature, and five cancel the request', async () => {
    const { key, claimed } = await claimedRequest();
    const impostor = newKey();
    const wrong = [
      signFor(impostor, claimed.pairing_id, claimed.nonce),
      signFor(key, claimed.pairing_id, 'another-nonce'),
      signFor(key, claimed.pairing_id, claimed.nonce, 'https://evil.example'),
      'not-a-signature',
    ];
    for (const signature of wrong) {
      expect(await refusal(await complete(claimed.pairing_id, signature), 401)).toEqual({
        code: 'unauthorized',
        reason: 'device_signature_invalid',
      });
    }
    expect(h.db.select().from(devicePairingRequests).get()?.failedAttempts).toBe(4);
    expect(MAX_FAILED_SIGNATURES).toBe(5);
    await refusal(await complete(claimed.pairing_id, wrong[0] ?? ''), 401);

    // Cancelled now: even the right key cannot finish it.
    await ok(await approve(bob.cookie, claimed.pairing_id, claimed.key_fingerprint), 409);
    expect(
      await refusal(
        await complete(claimed.pairing_id, signFor(key, claimed.pairing_id, claimed.nonce)),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'pairing_cancelled' });
    expect(h.db.select().from(devices).where(eq(devices.ownerUserId, bob.id)).all()).toEqual([]);
  });

  it('a denied request never completes', async () => {
    const { key, claimed } = await claimedRequest();
    const denied = await ok<Pairing>(
      await post(
        `/api/v1/devices/pairing-requests/${claimed.pairing_id}/deny`,
        { key_fingerprint: claimed.key_fingerprint },
        { cookie: bob.cookie },
      ),
    );
    expect(denied.state).toBe('denied');
    expect(
      await refusal(
        await complete(claimed.pairing_id, signFor(key, claimed.pairing_id, claimed.nonce)),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'pairing_denied' });
  });

  it('an approval past the expiry does not complete', async () => {
    const { key, claimed } = await claimedRequest();
    await ok(await approve(bob.cookie, claimed.pairing_id, claimed.key_fingerprint));
    h.db
      .update(devicePairingRequests)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(devicePairingRequests.id, claimed.pairing_id))
      .run();
    expect(
      await refusal(
        await complete(claimed.pairing_id, signFor(key, claimed.pairing_id, claimed.nonce)),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'pairing_expired' });
  });
});

describe('the owner’s side', () => {
  it('approving needs the fingerprint the owner was shown', async () => {
    const created = await create(bob.cookie);
    const claimed = await claim(created.user_code, newKey());
    expect(
      await refusal(await approve(bob.cookie, claimed.pairing_id, '0000000000000000'), 409),
    ).toEqual({ code: 'conflict', reason: 'pairing_key_changed' });
    // Not before a device has claimed it, either.
    const open = await create(bob.cookie, { display_name: 'Other' });
    expect(await refusal(await approve(bob.cookie, open.pairing.id, 'x'), 409)).toEqual({
      code: 'conflict',
      reason: 'pairing_open',
    });
  });

  it('another owner’s request is the same 404 as one that does not exist', async () => {
    const created = await create(bob.cookie);
    const claimed = await claim(created.user_code, newKey());
    const missing = '01M00000000000000000000000';
    const calls: [string, RequestInit][] = [
      ['', {}],
      [
        '/approve',
        { method: 'POST', body: JSON.stringify({ key_fingerprint: claimed.key_fingerprint }) },
      ],
      [
        '/deny',
        { method: 'POST', body: JSON.stringify({ key_fingerprint: claimed.key_fingerprint }) },
      ],
      ['', { method: 'DELETE' }],
    ];
    for (const [suffix, init] of calls) {
      const theirs = await req(
        `/api/v1/devices/pairing-requests/${created.pairing.id}${suffix}`,
        init,
        { cookie: ada.cookie },
      );
      const none = await req(`/api/v1/devices/pairing-requests/${missing}${suffix}`, init, {
        cookie: ada.cookie,
      });
      expect(theirs.status).toBe(404);
      expect(await theirs.text()).toBe(await none.text());
    }
    // Untouched by any of it.
    expect(h.db.select().from(devicePairingRequests).get()?.state).toBe('claimed');

    // Another owner's device cannot be named in a request either.
    await ok(await register(bob.cookie, { device_label: 'Belka' }), 201);
    const bobs = h.db.select().from(devices).where(eq(devices.ownerUserId, bob.id)).get();
    const viaTheirs = await post(
      '/api/v1/devices/pairing-requests',
      { kind: 'local', display_name: 'x', device_id: bobs?.id },
      { cookie: ada.cookie },
    );
    const viaNone = await post(
      '/api/v1/devices/pairing-requests',
      { kind: 'local', display_name: 'x', device_id: missing },
      { cookie: ada.cookie },
    );
    expect(viaTheirs.status).toBe(404);
    expect(await viaTheirs.text()).toBe(await viaNone.text());
  });

  it('a token is refused session_required: pairing is a person, signed in', async () => {
    const agent = await ok<{ secret: string }>(await register(bob.cookie, {}), 201);
    expect(
      await refusal(
        await post(
          '/api/v1/devices/pairing-requests',
          { kind: 'local', display_name: 'Strelka' },
          { bearer: agent.secret },
        ),
        403,
      ),
    ).toEqual({ code: 'forbidden', reason: 'session_required' });

    const created = await create(bob.cookie);
    const claimed = await claim(created.user_code, newKey());
    for (const verb of ['approve', 'deny']) {
      expect(
        await refusal(
          await post(
            `/api/v1/devices/pairing-requests/${claimed.pairing_id}/${verb}`,
            { key_fingerprint: claimed.key_fingerprint },
            { bearer: agent.secret },
          ),
          403,
        ),
      ).toEqual({ code: 'forbidden', reason: 'session_required' });
    }
    expect(
      await refusal(
        await req(
          `/api/v1/devices/pairing-requests/${claimed.pairing_id}`,
          { method: 'DELETE' },
          { bearer: agent.secret },
        ),
        403,
      ),
    ).toEqual({ code: 'forbidden', reason: 'session_required' });
    expect(h.db.select().from(devicePairingRequests).get()?.state).toBe('claimed');
    // And nobody signed out may ask at all.
    expect(
      (await post('/api/v1/devices/pairing-requests', { kind: 'local', display_name: 'x' })).status,
    ).toBe(401);
  });

  it('refuses a name the owner already has, and a sixth open request', async () => {
    await ok(await register(bob.cookie, { device_label: 'Belka' }), 201);
    expect(
      await refusal(
        await post(
          '/api/v1/devices/pairing-requests',
          { kind: 'local', display_name: ' BELKA ' },
          { cookie: bob.cookie },
        ),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'device_name_taken' });
    expect(
      await refusal(
        await post(
          '/api/v1/devices/pairing-requests',
          { kind: 'local', display_name: '   ' },
          { cookie: bob.cookie },
        ),
        422,
      ),
    ).toEqual({ code: 'unprocessable', reason: 'invalid_device_name' });

    for (let i = 0; i < MAX_OPEN_PAIRINGS; i++)
      await create(bob.cookie, { display_name: `D${String(i)}` });
    expect(
      await refusal(
        await post(
          '/api/v1/devices/pairing-requests',
          { kind: 'local', display_name: 'One more' },
          { cookie: bob.cookie },
        ),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'too_many_open_pairings' });
  });
});

describe('what an anonymous caller cannot lock out', () => {
  async function pairForReal(): Promise<void> {
    const created = await create(bob.cookie, { display_name: `Real ${String(clock)}` });
    const key = newKey();
    const claimed = await claim(created.user_code, key);
    await ok(await approve(bob.cookie, claimed.pairing_id, claimed.key_fingerprint));
    const done = await ok<{ device_id: string }>(
      await complete(claimed.pairing_id, signFor(key, claimed.pairing_id, claimed.nonce)),
    );
    expect(done.device_id).toMatch(/^[0-9A-Z]{26}$/);
  }

  it('a junk loop at one request a second for twenty minutes blocks no real pairing', async () => {
    // Every shape of junk, one a second on the simulated clock: unknown
    // codes, malformed codes, malformed bodies, made-up and junk request ids.
    const junk = [
      () =>
        post('/api/v1/device-pairing/claim', {
          code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ',
          public_key: newKey().publicKey,
        }),
      () => post('/api/v1/device-pairing/claim', { code: 'nope', public_key: 'AAAA' }),
      () => post('/api/v1/device-pairing/claim', { unexpected: true }),
      () => complete('01M00000000000000000000000', 'AAAA'),
      () => complete('junk', 'AAAA'),
    ];
    const seen = new Set<number>();
    for (let second = 0; second < 20 * 60; second++) {
      clock += 1000;
      const res = await (junk[second % junk.length] ?? junk[0]!)();
      seen.add(res.status);
    }
    // The loop was refused for what it was, and never rate-limited.
    expect([...seen].sort()).toEqual([404, 422]);
    await pairForReal();
  });

  it('every claim spends one bucket of 6,000 a minute, malformed ones included', async () => {
    expect(LIMITS.pairing).toEqual({ perMinute: 6000, burst: 6000 });
    // A malformed body is refused 422, and spends the bucket all the same:
    // there is no free way to send claims.
    const statuses = new Map<number, number>();
    let last: Response | undefined;
    for (let i = 0; i < 6001; i++) {
      last = await post(
        '/api/v1/device-pairing/claim',
        i % 2 === 0 ? { code: 'x', public_key: 'AAAA' } : {},
      );
      statuses.set(last.status, (statuses.get(last.status) ?? 0) + 1);
    }
    expect(Object.fromEntries(statuses)).toEqual({ 422: 6000, 429: 1 });
    expect(Number(last?.headers.get('Retry-After'))).toBeGreaterThan(0);
    // Holding it empty takes 100 a second: a hundredth of a second refills one.
    clock += 10;
    expect((await post('/api/v1/device-pairing/claim', {})).status).toBe(422);
    // Not the session's: a signed-in person is not slowed by it.
    expect((await req('/api/v1/devices', {}, { cookie: bob.cookie })).status).toBe(200);
  });

  it('a flood of bogus completes blocks no real claim and no real completion', async () => {
    const junk: number[] = [];
    for (let i = 0; i < 150; i++) {
      const id = `01M${String(i).padStart(23, '0')}`;
      expect((await complete(id, 'AAAA')).status).toBe(404);
      junk.push((await complete(`junk-${String(i)}`, 'AAAA')).status);
    }
    // Ids no request could have share one bucket, which they exhaust — and
    // which no real device's request id ever reaches.
    expect(junk).toEqual([...Array<number>(10).fill(404), ...Array<number>(140).fill(429)]);
    await pairForReal();
  });

  it('a thousand distinct paths leave the limiter bounded', async () => {
    // Junk ids share one key: a thousand of them add one bucket.
    const before = limiter.size;
    for (let i = 0; i < 1000; i++) await complete(`x${String(i)}`, 'AAAA');
    expect(limiter.size - before).toBeLessThanOrEqual(1);

    // ULID-shaped ids do key per request, and the cap holds them.
    const small = new RateLimiter(() => clock, 200);
    h.close();
    h = authHarness({ rateLimiter: small });
    await ok(
      await h.app.request('/api/v1/setup', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          org_name: 'Laika',
          owner_name: 'Ada',
          owner_email: 'ada@example.test',
          owner_password: PASSWORD,
        }),
      }),
      201,
    );
    for (let i = 0; i < 1000; i++) {
      await complete(`01M${String(i).padStart(23, '0')}`, 'AAAA');
    }
    expect(small.size).toBeLessThanOrEqual(200);
  });
});

describe('one key, one device; and a board that knows its address', () => {
  it('two requests may claim one key, but only the first to finish keeps it', async () => {
    const key = newKey();
    const first = await create(bob.cookie, { display_name: 'One' });
    const second = await create(bob.cookie, { display_name: 'Two' });
    const a = await claim(first.user_code, key);
    const b = await claim(second.user_code, key);
    await ok(await approve(bob.cookie, a.pairing_id, a.key_fingerprint));
    await ok(await approve(bob.cookie, b.pairing_id, b.key_fingerprint));
    await ok(await complete(a.pairing_id, signFor(key, a.pairing_id, a.nonce)));
    expect(
      await refusal(await complete(b.pairing_id, signFor(key, b.pairing_id, b.nonce)), 409),
    ).toEqual({ code: 'conflict', reason: 'device_key_in_use' });
    expect(
      h.db.select().from(devices).where(eq(devices.publicKey, key.publicKey)).all(),
    ).toHaveLength(1);
  });

  it('the database refuses a second device with the same key', async () => {
    const key = newKey();
    const first = await create(bob.cookie, { display_name: 'One' });
    const a = await claim(first.user_code, key);
    await ok(await approve(bob.cookie, a.pairing_id, a.key_fingerprint));
    await ok(await complete(a.pairing_id, signFor(key, a.pairing_id, a.nonce)));
    const paired = h.db.select().from(devices).where(eq(devices.publicKey, key.publicKey)).get();
    expect(() =>
      h.db
        .insert(devices)
        .values({ ...paired!, id: '01M00000000000000000000099', labelKey: 'other' })
        .run(),
    ).toThrow(/UNIQUE constraint failed: devices\.public_key/);
  });

  it('without LAIKA_PUBLIC_URL, pairing is refused rather than signed against a guess', async () => {
    h.close();
    h = authHarness({ rateLimiter: limiter, publicUrl: '' });
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
    const cookie = cookieFrom(setup);
    expect(
      await refusal(
        await post(
          '/api/v1/devices/pairing-requests',
          { kind: 'local', display_name: 'Strelka' },
          { cookie },
        ),
        409,
      ),
    ).toEqual({ code: 'conflict', reason: 'public_url_unset' });
    expect(h.db.select().from(devicePairingRequests).all()).toEqual([]);
    expect(await refusal(await complete('01M00000000000000000000000', 'AAAA'), 409)).toEqual({
      code: 'conflict',
      reason: 'public_url_unset',
    });
  });
});
