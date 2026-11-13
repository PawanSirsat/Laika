import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify } from '../../../src/http/middleware/rate-limit.ts';
import { LIMITS } from '../../../src/http/rate-limit.ts';
import { orgHolidays, orgs, users } from '../../../src/db/schema.ts';
import { newId } from '../../../src/db/ids.ts';
import { hrSyncInFlight } from '../../../src/services/hr-sync.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';
import {
  CLAN_ACCOUNT,
  CLAN_BASE,
  CLAN_EMAIL,
  CLAN_PASSWORD,
  CLAN_TOKEN,
  employee,
  fakeClan,
  type FakeClan,
  leaveRow,
} from '../../helpers/fake-clan.ts';

/**
 * `/api/v1/org/hr*` and `/api/v1/org/holidays*` (§6.4, D-149, LAI-1181).
 *
 * The services own the rules; this is that the routes are mounted, that the
 * codes reach the wire, that a signed-in session — never a token — is
 * required, that the password and the token never come back in a response
 * or go into the log, and that the calls to Clan spend their own bucket.
 * Clan is a fake behind an injected `fetch`: **no test calls a real one**.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let fake: FakeClan;
let cookie: string;
let ownerId: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}

beforeEach(async () => {
  fake = fakeClan({
    employees: [employee(1, 'Ada Lovelace', 'ada@example.test')],
    leave: [leaveRow(100, 1, '2026-11-20')],
    holidays: [{ id: 10, date: '2026-09-24', occassion: 'Heritage Day' }],
  });
  h = authHarness({
    hrSync: {
      // Through a variable, so a test may swap the fake for another.
      fetchImpl: (input, init) => fake.fetchImpl(input, init),
      sleep: () => Promise.resolve(),
      timeoutMs: 50,
    },
  });
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Kvell Dynamics',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
});
afterEach(async () => {
  await settle();
  h.close();
});

/** Let a background sync a connect started finish before anything looks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
    await hrSyncInFlight(h.db);
  }
}

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<string> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
}

function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { Cookie: cookie },
): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/api/v1/org${path}`, {
      method,
      headers: jsonHeaders(headers),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

const PASTE = { base_url: 'https://kvell.clan.biz', token: CLAN_TOKEN };
const SIGN_IN = { base_url: 'https://kvell.clan.biz', email: CLAN_EMAIL, password: CLAN_PASSWORD };

async function connect(): Promise<Response> {
  const res = await call('POST', '/hr/connect', PASTE);
  expect(res.status, await res.clone().text()).toBe(200);
  await settle();
  return res;
}

describe('who may', () => {
  it('is mounted, and reads as off for the owner', async () => {
    const res = await call('GET', '/hr');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'off', sync_every_minutes: 30, people: [] });
  });

  it('answers 401 signed out', async () => {
    expect((await call('GET', '/hr', undefined, {})).status).toBe(401);
  });

  it('answers 403 to a member, on every HR route', async () => {
    const member = await join('member@example.test', 'member');
    for (const [method, path, body] of [
      ['GET', '/hr', undefined],
      ['POST', '/hr/connect', PASTE],
      ['POST', '/hr/connect', SIGN_IN],
      ['POST', '/hr/connect/verify', { method: 'email', code: '1' }],
      ['DELETE', '/hr', undefined],
      ['POST', '/hr/sync', undefined],
      ['PUT', '/hr/people', { people: [{ external_id: '1', user_id: null }] }],
    ] as const) {
      const res = await call(method, path, body, { Cookie: member });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(fake.requests).toEqual([]);
  });

  it('refuses the owner’s own token: a signed-in session only', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'An agent', scope: 'full' }),
    });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    const res = await call('POST', '/hr/connect', PASTE, { Authorization: `Bearer ${secret}` });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).details).toEqual({
      action: 'org.hr.configure',
      reason: 'session_required',
    });
    expect(fake.requests).toEqual([]);
  });
});

describe('connecting', () => {
  it('connects, syncs, and never answers or logs the token', async () => {
    const res = await connect();
    const text = await res.text();

    // A positive control: what is meant to be shown, is.
    expect(text).toContain(CLAN_TOKEN.slice(-4));
    expect(text).toContain(CLAN_ACCOUNT);
    expect(text).toContain(CLAN_BASE);
    expect(text).not.toContain(CLAN_TOKEN);

    const read = await (await call('GET', '/hr')).text();
    expect(JSON.parse(read)).toMatchObject({
      status: 'connected',
      account_name: CLAN_ACCOUNT,
      token_last4: CLAN_TOKEN.slice(-4),
      last_result: { people: 1, matched: 1, leave_days: 1, holidays: 1 },
    });
    expect(read).not.toContain(CLAN_TOKEN);

    const log = JSON.stringify(h.log.records);
    expect(log).toContain('/api/v1/org/hr/connect');
    expect(log).not.toContain(CLAN_TOKEN);
  });

  it('answers a refused token 422 clan_token_refused, without Clan’s words', async () => {
    const res = await call('POST', '/hr/connect', { ...PASTE, token: 'not-the-token-at-all' });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'unprocessable', details: { reason: 'clan_token_refused' } },
    });
    expect(text).not.toContain('CLAN-SECRET-WORDS');
  });

  it('answers an unreachable Clan as unavailable, clan_unreachable', async () => {
    fake.intercept = () => 'hang';
    const res = await call('POST', '/hr/connect', PASTE);
    expect(res.status).toBe(503);
    expect((await errorOf(res)).details).toMatchObject({ reason: 'clan_unreachable' });
  });

  it('answers a non-https address, a bad date, and a body that is neither way 422', async () => {
    const http = await call('POST', '/hr/connect', { ...PASTE, base_url: 'http://kvell.clan.biz' });
    expect(http.status).toBe(422);
    expect((await errorOf(http)).details).toEqual({
      field: 'base_url',
      reason: 'base_url_not_https',
    });

    const date = await call('POST', '/hr/connect', { ...PASTE, expires_on: 'next year' });
    expect(date.status).toBe(422);

    // A sign-in and a token at once is neither body, and neither is a field
    // Laika does not take.
    const both = await call('POST', '/hr/connect', { ...SIGN_IN, token: CLAN_TOKEN });
    expect(both.status).toBe(422);
    const extra = await call('POST', '/hr/connect', { ...PASTE, remember: true });
    expect(extra.status).toBe(422);
    expect(fake.requests).toEqual([]);
  });

  it('signs in with the account, never answering or logging the password', async () => {
    const res = await call('POST', '/hr/connect', SIGN_IN);
    expect(res.status, await res.clone().text()).toBe(200);
    await settle();
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      status: 'connected',
      account_name: CLAN_ACCOUNT,
      account_email: CLAN_EMAIL,
    });
    expect(text).not.toContain(CLAN_PASSWORD);
    expect(text).not.toContain(CLAN_TOKEN);
    const log = JSON.stringify(h.log.records);
    expect(log).toContain('/api/v1/org/hr/connect');
    expect(log).not.toContain(CLAN_PASSWORD);
    expect(log).not.toContain(CLAN_TOKEN);
  });

  it('answers a wrong password 422 clan_login_failed, without Clan’s words', async () => {
    const res = await call('POST', '/hr/connect', { ...SIGN_IN, password: 'wrong' });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'unprocessable', details: { reason: 'clan_login_failed' } },
    });
    expect(text).not.toContain('CLAN-SECRET-WORDS');
  });

  it('waits for a two-factor code, then connects', async () => {
    fake = fakeClan({ twoFactorMethods: ['google_authenticator'], twoFactorCode: '123456' });
    const pending = await call('POST', '/hr/connect', SIGN_IN);
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({
      status: 'pending_2fa',
      two_factor: { methods: ['google_authenticator'] },
    });

    const done = await call('POST', '/hr/connect/verify', {
      method: 'google_authenticator',
      code: '123456',
    });
    expect(done.status, await done.clone().text()).toBe(200);
    expect(await done.json()).toMatchObject({ status: 'connected', two_factor: null });
  });

  it('answers 409 two_factor_expired with nothing waiting', async () => {
    const res = await call('POST', '/hr/connect/verify', { method: 'email', code: '1' });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).details).toEqual({ reason: 'two_factor_expired' });
  });

  it('disconnects with 204, and the read says off', async () => {
    await connect();
    const res = await call('DELETE', '/hr');
    expect(res.status).toBe(204);
    expect(await (await call('GET', '/hr')).json()).toMatchObject({ status: 'off' });
  });
});

describe('sync now and the people map', () => {
  it('answers 409 hr_not_connected, then syncs once connected', async () => {
    const off = await call('POST', '/hr/sync');
    expect(off.status).toBe(409);
    expect((await errorOf(off)).details).toEqual({ reason: 'hr_not_connected' });

    await connect();
    fake.leave = [];
    const res = await call('POST', '/hr/sync');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'connected',
      last_result: { removed: 1, leave_days: 0 },
      last_error: null,
    });
  });

  it('maps a person, and refuses an unknown one 422', async () => {
    await connect();
    const res = await call('PUT', '/hr/people', {
      people: [{ external_id: '1', user_id: null }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { people: unknown[] }).people).toEqual([
      { external_id: '1', name: 'Ada Lovelace', user: null, matched_by: 'owner' },
    ]);

    const unknown = await call('PUT', '/hr/people', {
      people: [{ external_id: '99', user_id: null }],
    });
    expect(unknown.status).toBe(422);
    expect((await errorOf(unknown)).details).toEqual({
      reason: 'unknown_person',
      external_id: '99',
    });
  });

  it('spends a bucket of its own: six calls to Clan a minute, and the session’s untouched', async () => {
    expect(classify('/api/v1/org/hr/sync', { userId: 'u1', tokenId: null }, 'POST')).toEqual({
      key: 'hr:u1',
      policy: LIMITS.hr,
    });
    for (const path of ['/api/v1/org/hr/connect', '/api/v1/org/hr/connect/verify']) {
      expect(classify(path, { userId: 'u1', tokenId: null }, 'POST').key, path).toBe('hr:u1');
    }
    // Reading the connection is an ordinary read.
    expect(classify('/api/v1/org/hr', { userId: 'u1', tokenId: null }, 'GET').key).toBe(
      'session:u1',
    );

    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.hr.perMinute + 1; i += 1) {
      statuses.push((await call('POST', '/hr/sync')).status);
    }
    expect(statuses.slice(0, LIMITS.hr.perMinute).every((s) => s === 409)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await call('GET', '/hr')).status).toBe(200);
  });
});

describe('holidays', () => {
  it('serves any member the year’s holidays, and lets an owner add and remove one', async () => {
    await connect();
    const viewer = await join('viewer@example.test', 'viewer');

    const added = await call('POST', '/holidays', { day: '2026-12-26', label: 'Day of Goodwill' });
    expect(added.status, await added.clone().text()).toBe(201);
    const { id } = (await added.json()) as { id: string };

    const list = await call('GET', '/holidays?from=2026-01-01&to=2026-12-31', undefined, {
      Cookie: viewer,
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      holidays: [
        {
          id: expect.any(String) as unknown,
          day: '2026-09-24',
          label: 'Heritage Day',
          source: 'clan',
          everyone: true,
        },
        { id, day: '2026-12-26', label: 'Day of Goodwill', source: 'manual', everyone: true },
      ],
    });

    const twice = await call('POST', '/holidays', { day: '2026-12-26', label: 'Again' });
    expect(twice.status).toBe(409);
    expect((await errorOf(twice)).details).toMatchObject({ reason: 'holiday_exists' });

    expect((await call('DELETE', `/holidays/${id}`)).status).toBe(204);

    const clanId = h.db.select().from(orgHolidays).where(eq(orgHolidays.source, 'clan')).get()!.id;
    const clan = await call('DELETE', `/holidays/${clanId}`);
    expect(clan.status).toBe(409);
    expect((await errorOf(clan)).details).toEqual({ reason: 'holiday_from_clan' });
  });

  it('refuses a member adding one, and a range past 731 days', async () => {
    const member = await join('member@example.test', 'member');
    const res = await call(
      'POST',
      '/holidays',
      { day: '2026-12-26', label: 'X' },
      { Cookie: member },
    );
    expect(res.status).toBe(403);

    const wide = await call('GET', '/holidays?from=2025-01-01&to=2027-01-02');
    expect(wide.status).toBe(422);
    expect((await call('DELETE', `/holidays/${newId()}`)).status).toBe(404);
  });
});
