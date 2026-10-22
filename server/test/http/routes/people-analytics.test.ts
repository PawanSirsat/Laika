import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import { analyticsViews, orgs, timeDrafts, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * A person's day and local activity, read for them over HTTP (SPEC §6.4,
 * D-102 rules 1–4, LAI-957): `GET /people/:id/time`, `GET
 * /people/:id/local-activity` and `GET /me/analytics-views`.
 *
 * The door with status, code and `details` for each caller; the owner's grant
 * switched off and on through `PUT /org/permissions`; and **read-only** — no
 * `/me` write reaches another person's drafts, entries or breaks, and the
 * people paths take no write at all.
 */

const PASSWORD = 'correct-horse-battery-staple';
const DAY = '2026-10-21';

let h: AuthHarness;
let ownerCookie: string;
let orgId: string;
let ownerId: string;
let admin: { cookie: string; id: string };
let bea: { cookie: string; id: string };
let vic: { cookie: string; id: string };

async function req(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  const credential =
    auth === undefined
      ? {}
      : auth.startsWith('lai_')
        ? { Authorization: `Bearer ${auth}` }
        : { Cookie: auth };
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function ok(res: Response, status = 200): Promise<unknown> {
  expect(res.status, await res.clone().text()).toBe(status);
  return status === 204 ? null : res.json();
}

async function errorOf(res: Response): Promise<{ code: string; details: unknown }> {
  return ((await res.json()) as { error: { code: string; details: unknown } }).error;
}

async function join(
  email: string,
  orgRole: 'admin' | 'member' | 'viewer',
): Promise<{ cookie: string; id: string }> {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function mint(cookie: string): Promise<string> {
  const res = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Claude Code', scope: 'full' }) },
    cookie,
  );
  return String(((await ok(res, 201)) as { secret: string }).secret);
}

const OFF = {
  see_people_analytics: false,
  see_org_activity: false,
  open_all_projects: false,
  manage_people: false,
  change_org_settings: false,
};
const ON = Object.fromEntries(Object.keys(OFF).map((k) => [k, true]));

async function grant(adminAnalytics: boolean, memberAnalytics = false): Promise<void> {
  const grants = {
    admin: { ...ON, see_people_analytics: adminAnalytics },
    member: { ...OFF, see_people_analytics: memberAnalytics },
    viewer: OFF,
  };
  await ok(
    await req(
      '/api/v1/org/permissions',
      { method: 'PUT', body: JSON.stringify({ grants }) },
      ownerCookie,
    ),
  );
}

let draftId: string;
let entryId: string;
let breakId: string;

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
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  ownerCookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  admin = await join('ari@example.test', 'admin');
  bea = await join('bea@example.test', 'member');
  vic = await join('vic@example.test', 'viewer');

  // Bea's day: a draft her machine made, an entry and a break she made herself.
  await ok(
    await req('/api/v1/org/time', { method: 'PUT', body: '{"mode":"drafts"}' }, ownerCookie),
  );
  draftId = newId();
  const start = Date.parse(`${DAY}T09:00:00Z`);
  h.db
    .insert(timeDrafts)
    .values({
      id: draftId,
      userId: bea.id,
      source: 'collector',
      collectorId: 'c',
      day: DAY,
      tz: 'UTC',
      startedAt: start,
      endedAt: start + 90 * 60_000,
      minutes: 90,
      signals: JSON.stringify({ prompts: 4, replies: 12, sessions: 1, commits: 0, marks: 1 }),
      createdAt: start,
      updatedAt: start,
    })
    .run();
  const entry = await ok(
    await req(
      '/api/v1/me/time-entries',
      { method: 'POST', body: JSON.stringify({ day: DAY, tz: 'UTC', minutes: 45, note: 'Call' }) },
      bea.cookie,
    ),
    201,
  );
  entryId = (entry as { id: string }).id;
  const pause = await ok(
    await req(
      '/api/v1/me/time-breaks',
      {
        method: 'POST',
        body: JSON.stringify({
          day: DAY,
          tz: 'UTC',
          started_at: Date.parse(`${DAY}T12:00:00Z`),
          ended_at: Date.parse(`${DAY}T12:30:00Z`),
        }),
      },
      bea.cookie,
    ),
    201,
  );
  breakId = (pause as { id: string }).id;
});

afterEach(() => {
  h.close();
});

const dayPath = (id: string) => `/api/v1/people/${id}/time?day=${DAY}&tz=UTC`;

describe('GET /people/:id/time and /people/:id/local-activity', () => {
  it("answers an owner and an admin with exactly the person's own /me answers", async () => {
    const ownDay = await ok(await req(`/api/v1/me/time?day=${DAY}&tz=UTC`, {}, bea.cookie));
    const ownLocal = await ok(await req('/api/v1/me/local-activity', {}, bea.cookie));
    expect((ownDay as { drafts: unknown[] }).drafts).toHaveLength(1);
    expect((ownDay as { breaks: unknown[] }).breaks).toHaveLength(1);

    for (const who of [ownerCookie, admin.cookie]) {
      expect(await ok(await req(dayPath(bea.id), {}, who))).toEqual(ownDay);
      expect(await ok(await req(`/api/v1/people/${bea.id}/local-activity`, {}, who))).toEqual(
        ownLocal,
      );
    }
  });

  it('refuses a member and a viewer 403 forbidden', async () => {
    for (const who of [bea.cookie, vic.cookie]) {
      for (const path of [dayPath(admin.id), `/api/v1/people/${admin.id}/local-activity`]) {
        const res = await req(path, {}, who);
        expect(res.status).toBe(403);
        expect(await errorOf(res)).toEqual({
          code: 'forbidden',
          message: expect.any(String) as unknown,
          details: { action: 'people.analytics.read' },
        });
      }
    }
  });

  it('refuses any token 403 session_required, the owner’s included', async () => {
    for (const cookie of [ownerCookie, admin.cookie]) {
      const token = await mint(cookie);
      for (const path of [dayPath(bea.id), `/api/v1/people/${bea.id}/local-activity`]) {
        const res = await req(path, {}, token);
        expect(res.status).toBe(403);
        expect((await errorOf(res)).details).toEqual({
          action: 'people.analytics.read',
          reason: 'session_required',
        });
      }
    }
  });

  it('refuses a read of yourself 403 — your own is /me', async () => {
    const res = await req(dayPath(ownerId), {}, ownerCookie);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('forbidden');
  });

  it('answers 401 with no credential, 404 for nobody, 422 for a bad query', async () => {
    expect((await errorOf(await req(dayPath(bea.id)))).code).toBe('unauthorized');
    const missing = await req(dayPath('nobody'), {}, ownerCookie);
    expect([missing.status, (await errorOf(missing)).code]).toEqual([404, 'not_found']);
    const badDay = await req(`/api/v1/people/${bea.id}/time?day=yesterday`, {}, ownerCookie);
    expect(badDay.status).toBe(422);
    const badDays = await req(`/api/v1/people/${bea.id}/local-activity?days=99`, {}, ownerCookie);
    expect(badDays.status).toBe(422);
    const unknown = await req(`/api/v1/people/${bea.id}/time?who=me`, {}, ownerCookie);
    expect(unknown.status).toBe(422);
  });

  it("follows the owner's grant: the admin loses it, a member is given it", async () => {
    await grant(false);
    const res = await req(dayPath(bea.id), {}, admin.cookie);
    expect([res.status, (await errorOf(res)).code]).toEqual([403, 'forbidden']);
    const heatmap = await req(`/api/v1/people/${bea.id}/activity`, {}, admin.cookie);
    expect(heatmap.status).toBe(403);
    const usage = await req(`/api/v1/users/${bea.id}/usage`, {}, admin.cookie);
    expect(usage.status).toBe(403);
    // The owner is never a column that can change.
    await ok(await req(dayPath(bea.id), {}, ownerCookie));

    await grant(true, true);
    await ok(await req(dayPath(bea.id), {}, admin.cookie));
    await ok(await req(dayPath(admin.id), {}, bea.cookie));
    expect((await req(dayPath(bea.id), {}, vic.cookie)).status).toBe(403);
  });
});

describe('GET /me/analytics-views', () => {
  it('lists who looked at the caller, newest first, paginated', async () => {
    await ok(await req(dayPath(bea.id), {}, admin.cookie));
    await ok(await req(`/api/v1/people/${bea.id}/local-activity`, {}, ownerCookie));
    await ok(await req(`/api/v1/people/${bea.id}/activity`, {}, ownerCookie));
    await ok(await req(`/api/v1/users/${bea.id}/usage`, {}, admin.cookie));
    // Refused reads look at nothing.
    await req(dayPath(bea.id), {}, vic.cookie);
    expect(h.db.select().from(analyticsViews).all()).toHaveLength(4);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? '' : `&cursor=${cursor}`;
      const page = (await ok(
        await req(`/api/v1/me/analytics-views?limit=3${query}`, {}, bea.cookie),
      )) as {
        data: { viewer: { name: string }; kind: string; day: string | null; viewed_at: number }[];
        next_cursor: string | null;
      };
      expect(page.data.length).toBeLessThanOrEqual(3);
      for (const row of page.data) seen.push(`${row.viewer.name} ${row.kind} ${row.day ?? '-'}`);
      cursor = page.next_cursor;
    } while (cursor !== null);
    expect(seen.sort()).toEqual(
      [
        'Ada activity -',
        'Ada local_activity -',
        'Test User time 2026-10-21',
        'Test User usage -',
      ].sort(),
    );

    const all = (await ok(await req('/api/v1/me/analytics-views', {}, bea.cookie))) as {
      data: { viewed_at: number }[];
    };
    const times = all.data.map((r) => r.viewed_at);
    expect(times).toEqual([...times].sort((a, b) => b - a));

    // Nobody looked at Ari.
    expect(await ok(await req('/api/v1/me/analytics-views', {}, admin.cookie))).toEqual({
      data: [],
      next_cursor: null,
    });
  });

  it('is a web session’s: a token is refused 403 session_required', async () => {
    const res = await req('/api/v1/me/analytics-views', {}, await mint(bea.cookie));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).details).toEqual({
      action: 'local_activity.read_own',
      reason: 'session_required',
    });
  });
});

describe('read-only (D-102 rule 4)', () => {
  it("no /me write reaches another person's draft, entry or break", async () => {
    const attempts: [string, string, unknown][] = [
      ['PATCH', `/api/v1/me/time-drafts/${draftId}`, { minutes: 10 }],
      ['POST', `/api/v1/me/time-drafts/${draftId}/split`, { at: Date.parse(`${DAY}T09:30:00Z`) }],
      ['POST', `/api/v1/me/time-drafts/${draftId}/dismiss`, undefined],
      ['POST', `/api/v1/me/time-drafts/${draftId}/confirm`, undefined],
      ['PATCH', `/api/v1/me/time-entries/${entryId}`, { minutes: 10 }],
      ['DELETE', `/api/v1/me/time-entries/${entryId}`, undefined],
      ['DELETE', `/api/v1/me/time-breaks/${breakId}`, undefined],
    ];
    const before = await ok(await req(`/api/v1/me/time?day=${DAY}&tz=UTC`, {}, bea.cookie));
    for (const who of [ownerCookie, admin.cookie]) {
      for (const [method, path, body] of attempts) {
        const res = await req(
          path,
          { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
          who,
        );
        expect([method, path, res.status, (await errorOf(res)).code]).toEqual([
          method,
          path,
          404,
          'not_found',
        ]);
      }
      // Clearing "every draft I have not confirmed" clears the caller's own.
      await ok(await req('/api/v1/me/time-drafts', { method: 'DELETE' }, who), 204);
      await ok(await req(`/api/v1/me/time/days/${DAY}/confirm`, { method: 'POST' }, who));
    }
    expect(await ok(await req(`/api/v1/me/time?day=${DAY}&tz=UTC`, {}, bea.cookie))).toEqual(
      before,
    );
  });

  it('the people paths take no write at all: 405', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of [
        `/api/v1/people/${bea.id}/time`,
        `/api/v1/people/${bea.id}/local-activity`,
        '/api/v1/me/analytics-views',
      ]) {
        const res = await req(path, { method, body: '{}' }, ownerCookie);
        // Known path, wrong method (§6.3).
        expect([method, path, res.status]).toEqual([method, path, 405]);
      }
    }
  });
});
