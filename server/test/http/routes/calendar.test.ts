import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify } from '../../../src/http/middleware/rate-limit.ts';
import { LIMITS } from '../../../src/http/rate-limit.ts';
import { orgs, orgTimeSettings, timeEntries, users } from '../../../src/db/schema.ts';
import { calendarSyncInFlight } from '../../../src/services/calendar-sync.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';
import {
  fakeGraph,
  type FakeGraph,
  GRAPH_CLIENT,
  GRAPH_SECRET,
  GRAPH_TENANT,
  graphEvent,
} from '../../helpers/fake-graph.ts';

/**
 * `/api/v1/org/calendar*` (§6.4, D-157, LAI-1316).
 *
 * The services own the rules; this is that the routes are mounted, that the
 * codes reach the wire, that a signed-in session — never a token — is
 * required, that the client secret never comes back in a response or goes
 * into the log, and that the calls to Microsoft spend their own bucket.
 * Microsoft is a fake behind an injected `fetch`: **no test calls the real
 * one**.
 */

const PASSWORD = 'correct-horse-battery-staple';
const NOW = Date.UTC(2026, 10, 18, 12);

let h: AuthHarness;
let fake: FakeGraph;
let cookie: string;
let ownerId: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}

const SAVE = {
  tenant_id: GRAPH_TENANT,
  client_id: GRAPH_CLIENT,
  client_secret: GRAPH_SECRET,
  enabled: false,
  rules: [{ kind: 'title', text: 'Sprint', project: 'laika' }],
};

beforeEach(async () => {
  fake = fakeGraph({ calendars: { 'ada@example.test': [graphEvent(Date.UTC(2026, 10, 18, 9))] } });
  h = authHarness({
    calendarSync: {
      // Through a variable, so a test may change the fake's answers.
      fetchImpl: (input, init) => fake.fetchImpl(input, init),
      sleep: () => Promise.resolve(),
      timeoutMs: 50,
      now: () => NOW,
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
  const orgId = h.db.select().from(orgs).get()!.id;
  h.db
    .insert(orgTimeSettings)
    .values({ orgId, mode: 'manual', updatedAt: NOW })
    .onConflictDoUpdate({ target: orgTimeSettings.orgId, set: { mode: 'manual' } })
    .run();
  // A space for the rules to name.
  const made = await h.app.request('/api/v1/projects', {
    method: 'POST',
    headers: jsonHeaders({ Cookie: cookie }),
    body: JSON.stringify({ name: 'Laika', slug: 'laika', prefix: 'LAI' }),
  });
  expect(made.status, await made.clone().text()).toBe(201);
});
afterEach(async () => {
  await settle();
  h.close();
});

/** Let a background sync a save started finish before anything looks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((done) => setTimeout(done, 0));
    await calendarSyncInFlight(h.db);
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

describe('who may', () => {
  it('is mounted, and reads as not configured and off for the owner', async () => {
    const res = await call('GET', '/calendar');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      configured: false,
      enabled: false,
      sync_every_minutes: 15,
      rules: [],
    });
  });

  it('answers 401 signed out', async () => {
    expect((await call('GET', '/calendar', undefined, {})).status).toBe(401);
  });

  it('answers 403 to a member and a viewer, on every calendar route', async () => {
    for (const role of ['member', 'viewer'] as const) {
      const other = await join(`${role}@example.test`, role);
      for (const [method, path, body] of [
        ['GET', '/calendar', undefined],
        ['PUT', '/calendar', SAVE],
        ['POST', '/calendar/test', undefined],
        ['POST', '/calendar/sync', undefined],
        ['POST', '/calendar/backfill', { days: 7 }],
        ['DELETE', '/calendar', undefined],
      ] as const) {
        const res = await call(method, path, body, { Cookie: other });
        expect(res.status, `${role} ${method} ${path}`).toBe(403);
      }
    }
    expect(fake.requests).toEqual([]);
  });

  it('lets an admin in', async () => {
    const admin = await join('admin@example.test', 'admin');
    const res = await call('PUT', '/calendar', SAVE, { Cookie: admin });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('refuses the owner’s own token: a signed-in session only', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'An agent', scope: 'full' }),
    });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    for (const [method, path, body] of [
      ['GET', '/calendar', undefined],
      ['PUT', '/calendar', SAVE],
      ['POST', '/calendar/test', undefined],
      ['POST', '/calendar/backfill', { days: 7 }],
    ] as const) {
      const res = await call(method, path, body, { Authorization: `Bearer ${secret}` });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await errorOf(res)).details).toEqual({
        action: 'org.calendar.configure',
        reason: 'session_required',
      });
    }
    expect(fake.requests).toEqual([]);
  });
});

describe('the connection', () => {
  it('saves, tests and syncs, and never answers or logs the secret', async () => {
    const saved = await call('PUT', '/calendar', SAVE);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const text = await saved.text();
    // A positive control: what is meant to be shown, is.
    expect(text).toContain(GRAPH_SECRET.slice(-4));
    expect(text).toContain(GRAPH_TENANT);
    expect(text).not.toContain(GRAPH_SECRET);
    expect(JSON.parse(text)).toMatchObject({
      configured: true,
      enabled: false,
      rules: [{ kind: 'title', text: 'Sprint', project: { slug: 'laika', name: 'Laika' } }],
    });

    // Tested while the switch is off.
    const tested = await call('POST', '/calendar/test');
    expect(tested.status, await tested.clone().text()).toBe(200);
    expect(((await tested.json()) as { last_test: unknown }).last_test).toEqual({
      at: NOW,
      calendars_read: true,
      roles: ['Calendars.Read'],
    });

    expect((await errorOf(await call('POST', '/calendar/sync'))).details).toEqual({
      reason: 'calendar_off',
    });
    const on = await call('PUT', '/calendar', {
      ...SAVE,
      client_secret: undefined,
      enabled: true,
    });
    expect(on.status, await on.clone().text()).toBe(200);
    await settle();
    const synced = await call('POST', '/calendar/sync');
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({
      enabled: true,
      last_success_at: NOW,
      last_result: { people: 1, meetings: 1 },
    });
    expect(h.db.select().from(timeEntries).all()).toEqual([
      expect.objectContaining({ userId: ownerId, source: 'calendar', kind: 'meeting' }),
    ]);

    const read = await (await call('GET', '/calendar')).text();
    expect(read).not.toContain(GRAPH_SECRET);
    const log = JSON.stringify(h.log.records);
    expect(log).toContain('/api/v1/org/calendar');
    expect(log).not.toContain(GRAPH_SECRET);
  });

  it('says what is wrong with a body, a tenant or a refused secret, without Microsoft’s words', async () => {
    const extra = await call('PUT', '/calendar', { ...SAVE, password: 'x' });
    expect(extra.status).toBe(422);
    const tenant = await call('PUT', '/calendar', { ...SAVE, tenant_id: 'common' });
    expect((await errorOf(tenant)).details).toMatchObject({ reason: 'tenant_invalid' });
    const kind = await call('PUT', '/calendar', {
      ...SAVE,
      rules: [{ kind: 'attendee', text: 'x', project: 'laika' }],
    });
    expect(kind.status).toBe(422);
    // The service's own limit reaches the wire, saying what it is.
    const many = await call('PUT', '/calendar', {
      ...SAVE,
      rules: Array.from({ length: 51 }, () => ({ kind: 'title', text: 'x', project: 'laika' })),
    });
    expect((await errorOf(many)).details).toEqual({
      field: 'rules',
      reason: 'too_many_rules',
      max: 50,
    });

    expect((await call('PUT', '/calendar', { ...SAVE, client_secret: 'wrong' })).status).toBe(200);
    const refused = await call('POST', '/calendar/test');
    expect(refused.status).toBe(422);
    const body = await refused.text();
    expect(JSON.parse(body)).toMatchObject({
      error: { details: { reason: 'graph_credentials_refused' } },
    });
    expect(body).not.toMatch(/AADSTS|MS-SECRET-WORDS/);
  });

  it('disconnects, and the meetings already logged stay', async () => {
    expect((await call('PUT', '/calendar', { ...SAVE, enabled: true })).status).toBe(200);
    await settle();
    expect((await call('DELETE', '/calendar')).status).toBe(204);
    expect(await (await call('GET', '/calendar')).json()).toMatchObject({ configured: false });
    expect(h.db.select().from(timeEntries).all()).toHaveLength(1);
  });

  it('spends a bucket of its own: six calls to Microsoft a minute, and the session’s untouched', async () => {
    expect(classify('/api/v1/org/calendar/sync', { userId: 'u1', tokenId: null }, 'POST')).toEqual({
      key: 'calendar:u1',
      policy: LIMITS.calendar,
    });
    expect(classify('/api/v1/org/calendar/test', { userId: 'u1', tokenId: null }, 'POST').key).toBe(
      'calendar:u1',
    );
    expect(
      classify('/api/v1/org/calendar/backfill', { userId: 'u1', tokenId: null }, 'POST').key,
    ).toBe('calendar:u1');
    // Reading and saving are ordinary requests.
    expect(classify('/api/v1/org/calendar', { userId: 'u1', tokenId: null }, 'GET').key).toBe(
      'session:u1',
    );
    expect(classify('/api/v1/org/calendar', { userId: 'u1', tokenId: null }, 'PUT').key).toBe(
      'session:u1',
    );

    const statuses: number[] = [];
    for (let i = 0; i < LIMITS.calendar.perMinute + 1; i += 1) {
      statuses.push((await call('POST', '/calendar/sync')).status);
    }
    expect(statuses.slice(0, LIMITS.calendar.perMinute).every((s) => s === 409)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await call('GET', '/calendar')).status).toBe(200);
  });
});

describe('the backfill (LAI-1335)', () => {
  it('refuses days out of 1 to 90, a fraction and a body that is not one, by code, before calling Microsoft', async () => {
    expect((await call('PUT', '/calendar', { ...SAVE, enabled: true })).status).toBe(200);
    await settle();
    const asked = fake.requests.length;
    for (const days of [0, 91, 1.5]) {
      const res = await call('POST', '/calendar/backfill', { days });
      expect(res.status, String(days)).toBe(422);
      expect(await errorOf(res), String(days)).toMatchObject({
        code: 'unprocessable',
        details: { field: 'days', reason: 'days_out_of_range', min: 1, max: 90 },
      });
    }
    for (const body of [{ days: '7' }, { days: 7, members: ['x'] }, {}]) {
      const res = await call('POST', '/calendar/backfill', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await errorOf(res)).details, JSON.stringify(body)).toHaveProperty('issues');
    }
    expect(fake.requests).toHaveLength(asked);
  });

  it('answers 409 calendar_off while the switch is off, and 403 time_off while Time is off', async () => {
    expect((await call('PUT', '/calendar', SAVE)).status).toBe(200);
    const off = await call('POST', '/calendar/backfill', { days: 7 });
    expect(off.status).toBe(409);
    expect((await errorOf(off)).details).toEqual({ reason: 'calendar_off' });
    expect((await call('PUT', '/calendar', { ...SAVE, enabled: true })).status).toBe(200);
    await settle();
    h.db.update(orgTimeSettings).set({ mode: 'off' }).run();
    const timeOff = await call('POST', '/calendar/backfill', { days: 7 });
    expect(timeOff.status).toBe(403);
    expect((await errorOf(timeOff)).details).toMatchObject({ reason: 'time_off' });
  });

  it('backfills the days asked for and answers the counts and the connection', async () => {
    // 2 November, two weeks before NOW: in a 30-day backfill, not in the regular window.
    fake.calendars.set('ada@example.test', [
      graphEvent(Date.UTC(2026, 10, 2, 9), {
        subject: 'Not answered',
        responseStatus: { response: 'notResponded' },
        showAs: 'tentative',
      }),
    ]);
    expect((await call('PUT', '/calendar', { ...SAVE, enabled: true })).status).toBe(200);
    await settle();
    expect(h.db.select().from(timeEntries).all()).toEqual([]);

    const res = await call('POST', '/calendar/backfill', { days: 30 });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      days: number;
      result: Record<string, number> | null;
      connection: { last_result: unknown; enabled: boolean };
    };
    expect(body.days).toBe(30);
    expect(body.result).toMatchObject({ people: 1, meetings: 1, created: 1 });
    expect(body.connection).toMatchObject({ enabled: true, last_result: body.result });
    expect(h.db.select().from(timeEntries).all()).toEqual([
      expect.objectContaining({ userId: ownerId, source: 'calendar', day: '2026-11-02' }),
    ]);
    // Again: nothing more.
    const again = await call('POST', '/calendar/backfill', { days: 30 });
    expect(((await again.json()) as { result: unknown }).result).toMatchObject({
      created: 0,
      unchanged: 1,
    });
    expect(h.db.select().from(timeEntries).all()).toHaveLength(1);
  });

  it('a second request while one runs joins it — one run, both answered — and GET says it is running (review F1)', async () => {
    fake.calendars.set('ada@example.test', [graphEvent(Date.UTC(2026, 10, 2, 9))]);
    expect((await call('PUT', '/calendar', { ...SAVE, enabled: true })).status).toBe(200);
    await settle();
    const reads = fake.of('calendarView').length;
    const release = fake.hold();
    const first = call('POST', '/calendar/backfill', { days: 30 });
    const running = async (): Promise<unknown> =>
      ((await (await call('GET', '/calendar')).json()) as { backfill_running: unknown })
        .backfill_running;
    for (let i = 0; i < 50 && (await running()) === null; i += 1) {
      await new Promise((done) => setTimeout(done, 0));
    }
    expect(await running()).toEqual({ days: 30, started_at: NOW });
    const retry = call('POST', '/calendar/backfill', { days: 30 });
    // Held until the retry has reached the service, which takes a few turns.
    for (let i = 0; i < 20; i += 1) await new Promise((done) => setTimeout(done, 0));
    release();
    const [a, b] = await Promise.all([first, retry]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const [one, two] = (await Promise.all([a.json(), b.json()])) as {
      days: number;
      result: unknown;
      connection: { backfill_running: unknown };
    }[];
    expect(two?.result).toEqual(one?.result);
    expect(one?.result).toMatchObject({ created: 1 });
    expect(two?.connection.backfill_running).toBeNull();
    expect(fake.of('calendarView')).toHaveLength(reads + 1);
    expect(await running()).toBeNull();
  });
});
