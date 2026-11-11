import { generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  analyticsViews,
  devicePairingRequests,
  orgs,
  users,
} from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * Your own developer setup's two reads (SPEC §3.1, §6.4, D-139, LAI-1151):
 * `GET /devices/pairing-requests`, the requests still waiting, and
 * `GET /me/developer-setup/activity`, the last 30 days. Both are
 * `developer_setup.read_own`, session only. The properties they must never
 * lose — no pairing code, nobody else's rows, no look — are asserted on the
 * response text and the stored rows themselves.
 */

const PASSWORD = 'correct-horse-battery-staple';
const PAIRINGS = '/api/v1/devices/pairing-requests';
const ACTIVITY = '/api/v1/me/developer-setup/activity';
const DAY_MS = 86_400_000;

let h: AuthHarness;
let ada: { cookie: string; id: string };
let bob: { cookie: string; id: string };
let vi: { cookie: string; id: string };

interface Auth {
  cookie?: string;
  bearer?: string;
}

interface Pairing {
  id: string;
  state: string;
  display_name: string;
  claimed: { key_fingerprint: string; os: string | null } | null;
  created_at: number;
}

interface Activity {
  at: number;
  kind: string;
  subject: string;
  by: { id: string } | null;
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

/** A refusal, by status and by the code and reason only the real path gives. */
async function refused(res: Response, status: number, code: string, reason?: string) {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  const body = JSON.parse(text) as { error: { code: string; details?: { reason?: string } } };
  expect(body.error.code).toBe(code);
  if (reason !== undefined) expect(body.error.details?.reason).toBe(reason);
}

async function join(email: string, orgRole: 'member' | 'viewer') {
  const orgId = h.db.select().from(orgs).get()?.id ?? '';
  const token = seedInvite(h.db, { orgId, createdBy: ada.id, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function create(cookie: string, displayName: string) {
  return ok<{ pairing: Pairing; user_code: string }>(
    await post(PAIRINGS, { kind: 'local', display_name: displayName }, { cookie }),
    201,
  );
}

/** The device's half: claim the code with a fresh key, as `laika device pair` does. */
async function claim(code: string) {
  const pair = generateKeyPairSync('ed25519');
  return ok<{ pairing_id: string; key_fingerprint: string }>(
    await post('/api/v1/device-pairing/claim', {
      code,
      public_key: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      os: 'darwin',
      cli_version: '0.9.0',
    }),
  );
}

async function register(cookie: string, displayName: string, deviceLabel = 'Belka') {
  return ok<{ agent: { id: string }; secret: string }>(
    await post(
      '/api/v1/agents',
      { display_name: displayName, harness: 'claude-code', device_label: deviceLabel, grants: [] },
      { cookie },
    ),
    201,
  );
}

async function pendingOf(cookie: string): Promise<Pairing[]> {
  return (await ok<{ data: Pairing[] }>(await req(PAIRINGS, {}, { cookie }))).data;
}

beforeEach(async () => {
  h = authHarness();
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
  bob = await join('bob@example.test', 'member');
  vi = await join('vi@example.test', 'viewer');
});

afterEach(() => {
  h.close();
});

describe('GET /devices/pairing-requests — your own requests still waiting', () => {
  it('lists only yours, newest first, with the fingerprint and never the code', async () => {
    const first = await create(bob.cookie, 'Strelka');
    const second = await create(bob.cookie, 'Laptop');
    const claimed = await claim(second.user_code);
    const theirs = await create(ada.cookie, 'Ada’s Mac');

    const res = await req(PAIRINGS, {}, { cookie: bob.cookie });
    const text = await res.clone().text();
    const list = (await ok<{ data: Pairing[] }>(res)).data;

    expect(list.map((p) => p.id)).toEqual([second.pairing.id, first.pairing.id]);
    expect(list[0]?.state).toBe('claimed');
    expect(list[0]?.claimed).toMatchObject({
      key_fingerprint: claimed.key_fingerprint,
      os: 'darwin',
    });
    expect(list[1]?.claimed).toBeNull();

    // Another person's request is nowhere, not even its id.
    expect(text.includes(theirs.pairing.id)).toBe(false);
    // The codes, and what they are stored as, are nowhere either.
    for (const created of [first, second, theirs]) {
      const stored = h.db
        .select()
        .from(devicePairingRequests)
        .where(eq(devicePairingRequests.id, created.pairing.id))
        .get();
      expect(stored?.codeHash.length).toBeGreaterThan(10);
      for (const needle of [
        created.user_code,
        created.user_code.replace(/-/g, ''),
        stored?.codeHash ?? 'missing',
      ]) {
        expect(text.includes(needle), `response carries ${needle.slice(0, 6)}…`).toBe(false);
      }
    }
    expect(text).not.toMatch(/user_code|code_hash|claim_nonce|public_key/);

    expect((await pendingOf(ada.cookie)).map((p) => p.id)).toEqual([theirs.pairing.id]);
  });

  it('serves what the approve call needs: the fingerprint it lists approves the request', async () => {
    const created = await create(bob.cookie, 'Strelka');
    await claim(created.user_code);
    const [listed] = await pendingOf(bob.cookie);
    const approved = await ok<Pairing>(
      await post(
        `${PAIRINGS}/${listed?.id ?? ''}/approve`,
        { key_fingerprint: listed?.claimed?.key_fingerprint ?? '' },
        { cookie: bob.cookie },
      ),
    );
    expect(approved.state).toBe('approved');
  });

  it('drops a denied, a cancelled and an expired request', async () => {
    const denied = await create(bob.cookie, 'Denied');
    const deniedClaim = await claim(denied.user_code);
    await ok(
      await post(
        `${PAIRINGS}/${denied.pairing.id}/deny`,
        { key_fingerprint: deniedClaim.key_fingerprint },
        { cookie: bob.cookie },
      ),
    );
    const cancelled = await create(bob.cookie, 'Cancelled');
    expect(
      (
        await req(
          `${PAIRINGS}/${cancelled.pairing.id}`,
          { method: 'DELETE' },
          { cookie: bob.cookie },
        )
      ).status,
    ).toBe(204);
    const expired = await create(bob.cookie, 'Expired');
    h.db
      .update(devicePairingRequests)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(devicePairingRequests.id, expired.pairing.id))
      .run();
    const waiting = await create(bob.cookie, 'Waiting');

    expect((await pendingOf(bob.cookie)).map((p) => p.display_name)).toEqual(['Waiting']);
    // The single read still answers each one: the list narrows, nothing is removed.
    expect(
      (await ok<Pairing>(await req(`${PAIRINGS}/${denied.pairing.id}`, {}, { cookie: bob.cookie })))
        .state,
    ).toBe('denied');
    expect(waiting.pairing.state).toBe('open');
  });

  it('every role reads its own; a token or no session is refused', async () => {
    expect(await pendingOf(vi.cookie)).toEqual([]);

    const personal = await ok<{ secret: string }>(
      await post('/api/v1/tokens', { name: 'cli', scope: 'full' }, { cookie: bob.cookie }),
      201,
    );
    await refused(
      await req(PAIRINGS, {}, { bearer: personal.secret }),
      403,
      'forbidden',
      'session_required',
    );
    const agent = await register(bob.cookie, 'Claude');
    await refused(
      await req(PAIRINGS, {}, { bearer: agent.secret }),
      403,
      'forbidden',
      'session_required',
    );
    await refused(await req(PAIRINGS), 401, 'unauthorized');
  });
});

describe('GET /me/developer-setup/activity — your own last 30 days', () => {
  it('lists the items the admin read lists for you, nobody else’s, and writes no look', async () => {
    const tool = await register(bob.cookie, 'Claude');
    await ok(await post(`/api/v1/agents/${tool.agent.id}/revoke`, {}, { cookie: bob.cookie }));
    await register(ada.cookie, 'Ada’s Codex');

    const mine = await ok<{ now: number; data: Activity[] }>(
      await req(ACTIVITY, {}, { cookie: bob.cookie }),
    );
    expect(mine.data.map((a) => [a.kind, a.subject]).sort()).toEqual(
      [
        ['tool_added', 'Claude'],
        ['tool_revoked', 'Claude'],
        ['token_revoked', 'Claude'],
      ].sort(),
    );
    expect(mine.data.every((a) => a.by?.id === bob.id)).toBe(true);
    expect(JSON.stringify(mine)).not.toContain('Ada’s Codex');

    // The owner's read of Bob's setup lists the same items.
    const asAdmin = await ok<{ activity: Activity[] }>(
      await req(`/api/v1/people/${bob.id}/developer-setup`, {}, { cookie: ada.cookie }),
    );
    expect(mine.data).toEqual(asAdmin.activity);

    // Bob's own read wrote nothing; only the owner's read is a look.
    expect(
      h.db
        .select()
        .from(analyticsViews)
        .all()
        .map((r) => [r.viewerId, r.subjectId, r.kind]),
    ).toEqual([[ada.id, bob.id, 'developer_setup']]);
  });

  it('leaves out what happened more than 30 days ago', async () => {
    const old = await register(bob.cookie, 'Old tool');
    await register(bob.cookie, 'New tool', 'Strelka');
    h.db
      .update(agents)
      .set({ createdAt: Date.now() - 31 * DAY_MS })
      .where(eq(agents.id, old.agent.id))
      .run();
    const mine = await ok<{ data: Activity[] }>(await req(ACTIVITY, {}, { cookie: bob.cookie }));
    expect(mine.data.map((a) => a.subject)).toEqual(['New tool']);
  });

  it('every role reads its own; a token or no session is refused', async () => {
    expect(
      (await ok<{ data: Activity[] }>(await req(ACTIVITY, {}, { cookie: vi.cookie }))).data,
    ).toEqual([]);

    const personal = await ok<{ secret: string }>(
      await post('/api/v1/tokens', { name: 'cli', scope: 'full' }, { cookie: bob.cookie }),
      201,
    );
    await refused(
      await req(ACTIVITY, {}, { bearer: personal.secret }),
      403,
      'forbidden',
      'session_required',
    );
    const agent = await register(bob.cookie, 'Claude');
    await refused(
      await req(ACTIVITY, {}, { bearer: agent.secret }),
      403,
      'forbidden',
      'session_required',
    );
    await refused(await req(ACTIVITY), 401, 'unauthorized');
  });
});
