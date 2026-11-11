import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyticsViews, orgs, userAvailability, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * Availability and load over HTTP (SPEC §6.4, D-131, LAI-1130): status, code
 * and `details` for each caller. Only the person writes their own — there is
 * no path that names anybody else; a member cannot read anybody's load; the
 * list is A–Z with no sort parameter; a space admin's answer has no hours.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
let bea: { cookie: string; id: string };
let cal: { cookie: string; id: string };

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

async function errorOf(
  res: Response,
  status: number,
): Promise<{ code: string; details: Record<string, unknown> | null }> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (
    (await res.json()) as { error: { code: string; details: Record<string, unknown> | null } }
  ).error;
}

async function join(name: string, orgRole: 'admin' | 'member' | 'viewer') {
  const email = `${name.toLowerCase()}@example.test`;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  // `signUp` names everyone alike; A–Z needs names of their own.
  h.db.update(users).set({ name }).where(eq(users.email, email)).run();
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

async function addToLaika(userId: string, role: 'lead' | 'member'): Promise<void> {
  await ok(
    await req(
      '/api/v1/projects/laika/members',
      { method: 'POST', body: JSON.stringify({ user_id: userId, role }) },
      ownerCookie,
    ),
    201,
  );
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
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  ownerCookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  // Joined out of order: Cal, then Bea.
  cal = await join('Cal', 'member');
  bea = await join('Bea', 'member');
  await addToLaika(bea.id, 'lead');
  await addToLaika(cal.id, 'member');
});
afterEach(() => {
  h.close();
});

describe('/me/availability', () => {
  it('reads empty, then writes only the caller’s own row', async () => {
    expect(await ok(await req('/api/v1/me/availability', {}, bea.cookie))).toMatchObject({
      status: null,
      away: null,
      tags: [],
      work_week: null,
      away_periods: [],
      updated_at: null,
    });
    const put = await ok(
      await req(
        '/api/v1/me/availability',
        {
          method: 'PUT',
          body: JSON.stringify({
            status: 'open',
            hours_per_week: 6,
            work_week: { days: [1, 2, 3], start: '10:00', end: '14:00' },
          }),
        },
        bea.cookie,
      ),
    );
    expect(put).toMatchObject({
      status: 'open',
      hours_per_week: 6,
      work_week: { days: [1, 2, 3], start: '10:00', end: '14:00', minutes: 720 },
    });
    expect(h.db.select({ id: userAvailability.userId }).from(userAvailability).all()).toEqual([
      { id: bea.id },
    ]);
  });

  it('has no way to write somebody else’s: a user_id in the body is refused', async () => {
    const error = await errorOf(
      await req(
        '/api/v1/me/availability',
        { method: 'PUT', body: JSON.stringify({ status: 'open', user_id: bea.id }) },
        ownerCookie,
      ),
      422,
    );
    expect(error.code).toBe('unprocessable');
    expect(h.db.select().from(userAvailability).all()).toEqual([]);
    // And no route takes a person's id for a write.
    const res = await req(
      `/api/v1/people/${bea.id}/availability`,
      { method: 'PUT', body: JSON.stringify({ status: 'capacity' }) },
      ownerCookie,
    );
    expect([404, 405]).toContain(res.status);
    expect(h.db.select().from(userAvailability).all()).toEqual([]);
  });

  it('answers each limit with a 422 naming the field', async () => {
    const put = async (body: unknown) =>
      errorOf(
        await req(
          '/api/v1/me/availability',
          { method: 'PUT', body: JSON.stringify(body) },
          bea.cookie,
        ),
        422,
      );
    expect((await put({ hours_per_week: 81 })).details).toEqual({
      field: 'hours_per_week',
      reason: 'out_of_range',
    });
    expect((await put({ note: 'n'.repeat(141) })).details).toEqual({
      field: 'note',
      reason: 'too_long',
    });
    expect((await put({ tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] })).details).toEqual({
      field: 'tags',
      reason: 'too_many',
    });
    expect((await put({ work_week: { days: [1], start: '18:00', end: '09:00' } })).details).toEqual(
      { field: 'work_week.end', reason: 'end_before_start' },
    );
  });

  it('adds an away period 201, refuses one in the past, and deletes only one’s own', async () => {
    const past = await errorOf(
      await req(
        '/api/v1/me/availability/away',
        { method: 'POST', body: JSON.stringify({ from: '2020-01-01', to: '2020-01-02' }) },
        bea.cookie,
      ),
      422,
    );
    expect(past.details).toEqual({ field: 'to', reason: 'away_in_past' });

    const added = (await ok(
      await req(
        '/api/v1/me/availability/away',
        { method: 'POST', body: JSON.stringify({ from: '2099-01-01', to: '2099-01-05' }) },
        bea.cookie,
      ),
      201,
    )) as { away_periods: { id: string }[] };
    const id = added.away_periods[0]?.id ?? '';
    expect(
      (
        await errorOf(
          await req(`/api/v1/me/availability/away/${id}`, { method: 'DELETE' }, cal.cookie),
          404,
        )
      ).code,
    ).toBe('not_found');
    await ok(
      await req(`/api/v1/me/availability/away/${id}`, { method: 'DELETE' }, bea.cookie),
      204,
    );
  });

  it('refuses a token, the person’s own included, as session_required', async () => {
    const token = await mint(bea.cookie);
    for (const [method, path, body] of [
      ['GET', '/api/v1/me/availability', undefined],
      ['PUT', '/api/v1/me/availability', '{"status":"open"}'],
      ['GET', '/api/v1/people/availability', undefined],
    ] as const) {
      const error = await errorOf(
        await req(path, { method, ...(body === undefined ? {} : { body }) }, token),
        403,
      );
      expect(error, `${method} ${path}`).toMatchObject({
        code: 'forbidden',
        details: { reason: 'session_required' },
      });
    }
    expect(h.db.select().from(userAvailability).all()).toEqual([]);
  });

  it('refuses no one signed in', async () => {
    expect((await errorOf(await req('/api/v1/me/availability'), 401)).code).toBe('unauthorized');
  });
});

describe('GET /people/:id/load', () => {
  it('answers the owner and logs a look; refuses a member and yourself', async () => {
    const load = (await ok(await req(`/api/v1/people/${bea.id}/load`, {}, ownerCookie))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(load).sort()).toEqual(['availability', 'away', 'cards', 'projects', 'week']);
    expect(h.db.select().from(analyticsViews).all()).toEqual([
      expect.objectContaining({ viewerId: ownerId, subjectId: bea.id, kind: 'time' }),
    ]);

    const member = await errorOf(await req(`/api/v1/people/${cal.id}/load`, {}, bea.cookie), 403);
    expect(member).toMatchObject({
      code: 'forbidden',
      details: { action: 'people.analytics.read' },
    });
    const self = await errorOf(await req(`/api/v1/people/${ownerId}/load`, {}, ownerCookie), 403);
    expect(self.code).toBe('forbidden');
    expect(h.db.select().from(analyticsViews).all()).toHaveLength(1);
  });
});

describe('GET /people/availability', () => {
  it('is A–Z for the owner, with hours, and has no sort parameter', async () => {
    const { data } = (await ok(await req('/api/v1/people/availability', {}, ownerCookie))) as {
      data: { user: { name: string }; last_2_weeks_minutes?: number }[];
    };
    expect(data.map((r) => r.user.name)).toEqual(['Ada', 'Bea', 'Cal']);
    expect(data.every((r) => typeof r.last_2_weeks_minutes === 'number')).toBe(true);

    for (const sort of ['sort=load', 'order=load', 'sort=name']) {
      const error = await errorOf(
        await req(`/api/v1/people/availability?${sort}`, {}, ownerCookie),
        422,
      );
      expect(error.code, sort).toBe('unprocessable');
      expect(JSON.stringify(error.details), sort).toContain(sort.split('=')[0] ?? '');
    }
  });

  it('gives a space admin card counts and no hours field', async () => {
    const res = await req('/api/v1/people/availability', {}, bea.cookie);
    const text = await res.clone().text();
    expect(res.status, text).toBe(200);
    expect(text).not.toContain('last_2_weeks_minutes');
    const { data } = (await res.json()) as { data: { in_progress?: number }[] };
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((r) => r.in_progress === 0)).toBe(true);
    expect(h.db.select().from(analyticsViews).all()).toEqual([]);
  });

  it('gives a member the people of their spaces, status and spaces only', async () => {
    const { data } = (await ok(await req('/api/v1/people/availability', {}, cal.cookie))) as {
      data: Record<string, unknown>[];
    };
    expect(data.map((r) => Object.keys(r).sort())).toEqual([
      ['availability', 'spaces', 'user'],
      ['availability', 'spaces', 'user'],
      ['availability', 'spaces', 'user'],
    ]);
  });

  it('narrows Ada’s whole record to each reader’s allow-list (D-137)', async () => {
    await ok(
      await req(
        '/api/v1/me/availability',
        {
          method: 'PUT',
          body: JSON.stringify({
            status: 'open',
            hours_per_week: 5,
            note: 'Ask me about billing',
            tags: ['billing'],
            work_week: { days: [1, 2], start: '08:00', end: '12:00' },
          }),
        },
        ownerCookie,
      ),
    );
    await ok(
      await req(
        '/api/v1/me/availability/away',
        { method: 'POST', body: JSON.stringify({ from: '2099-02-01', to: '2099-02-03' }) },
        ownerCookie,
      ),
      201,
    );
    interface Row {
      user: { id: string };
      availability: Record<string, unknown> | null;
    }
    const adaFor = async (cookie: string): Promise<Row | undefined> =>
      (
        (await ok(await req('/api/v1/people/availability', {}, cookie))) as { data: Row[] }
      ).data.find((r) => r.user.id === ownerId);

    // Cal, a member: status, note, tags, and the current away's end only.
    const member = await adaFor(cal.cookie);
    expect(Object.keys(member?.availability ?? {}).sort()).toEqual([
      'away',
      'note',
      'status',
      'tags',
    ]);
    expect(member?.availability).toEqual({
      status: 'open',
      note: 'Ask me about billing',
      tags: ['billing'],
      away: null,
    });

    // Bea, a space admin: plus hours a week and away dates, never a working week or an id.
    const lead = await adaFor(bea.cookie);
    expect(Object.keys(lead ?? {}).sort()).toEqual([
      'availability',
      'in_progress',
      'spaces',
      'user',
    ]);
    expect(Object.keys(lead?.availability ?? {}).sort()).toEqual([
      'away',
      'away_periods',
      'hours_per_week',
      'note',
      'status',
      'tags',
    ]);
    expect(lead?.availability?.away_periods).toEqual([{ from: '2099-02-01', to: '2099-02-03' }]);
  });

  it('takes open_only only as true or false', async () => {
    await ok(await req('/api/v1/people/availability?open_only=true', {}, cal.cookie));
    expect(
      (await errorOf(await req('/api/v1/people/availability?open_only=yes', {}, cal.cookie), 422))
        .code,
    ).toBe('unprocessable');
  });
});
