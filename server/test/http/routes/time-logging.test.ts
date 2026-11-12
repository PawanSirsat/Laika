import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import {
  analyticsViews,
  orgs,
  projectMemberships,
  timeDrafts,
  timeEntries,
  users,
} from '../../../src/db/schema.ts';
import { classify } from '../../../src/http/middleware/rate-limit.ts';
import { LIMITS } from '../../../src/http/rate-limit.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /time/days` (D-148, LAI-1175): the Time logging grid over HTTP — the
 * owner's exact answer, a space admin's narrowed one, every refusal by its
 * code, the people shown logged once each per ten minutes, and the route's
 * own rate-limit bucket.
 */

const PASSWORD = 'correct-horse-battery-staple';
const FROM = '2026-11-01';
const TO = '2026-11-30';

let h: AuthHarness;
let cookie: string;
let ownerId: string;
let orgId: string;
let laika: { id: string };
let bea: { id: string; cookie: string };

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
  return res.json();
}

/** The refusal's status, code and reason or action — never a bare "it failed". */
async function refusal(res: Response): Promise<[number, string, unknown]> {
  const body = (await res.json()) as {
    error: { code: string; details: { reason?: string; action?: string } | null };
  };
  return [res.status, body.error.code, body.error.details?.reason ?? body.error.details?.action];
}

function entry(userId: string, day: string, minutes: number): void {
  h.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      day,
      tz: 'UTC',
      minutes,
      source: 'manual',
      kind: 'work',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function draft(userId: string, day: string, minutes: number): void {
  const start = Date.parse(`${day}T09:00:00Z`);
  h.db
    .insert(timeDrafts)
    .values({
      id: newId(),
      userId,
      source: 'collector',
      collectorId: 'c',
      day,
      tz: 'UTC',
      startedAt: start,
      endedAt: start + minutes * 60_000,
      minutes,
      signals: '{}',
      createdAt: start,
      updatedAt: start,
    })
    .run();
}

function person(name: string): string {
  const id = newId();
  h.db
    .insert(users)
    .values({
      id,
      email: `${id.toLowerCase()}@example.test`,
      name,
      orgRole: 'member',
      createdAt: new Date(Date.UTC(2026, 0, 1)),
      updatedAt: new Date(),
    })
    .run();
  return id;
}

function member(userId: string, projectId: string, role: 'lead' | 'member'): void {
  h.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role, createdAt: Date.now() })
    .run();
}

const days = (query: string, auth = cookie) => req(`/api/v1/time/days?${query}`, {}, auth);
const looks = () =>
  h.db
    .select()
    .from(analyticsViews)
    .all()
    .map((l) => [l.viewerId, l.subjectId, l.kind, l.day]);

interface Grid {
  from: string;
  to: string;
  scope: string;
  threshold_minutes: number;
  people: {
    user: { id: string; name: string; org_role: string; deactivated: boolean };
    zone: string;
    joined_day: string;
    today_day: string;
    work_days: number[];
    days: { day: string; confirmed_minutes: number; drafted_minutes: number }[];
  }[];
  truncated: boolean;
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
  cookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  laika = (await ok(await req('/api/v1/projects/laika', {}, cookie))) as { id: string };

  const invite = seedInvite(h.db, {
    orgId,
    createdBy: ownerId,
    email: 'bea@example.test',
    orgRole: 'member',
  });
  const res = await signUp(h.app, {
    email: 'bea@example.test',
    password: PASSWORD,
    inviteToken: invite,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  bea = {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()?.id ?? '',
  };
  h.db.update(users).set({ name: 'Bea' }).where(eq(users.id, bea.id)).run();
  entry(bea.id, '2026-11-03', 480);
  draft(bea.id, '2026-11-04', 90);
  entry(ownerId, '2026-11-03', 60);
});

afterEach(() => {
  h.close();
});

describe('an owner', () => {
  it('reads everyone: the exact shape, the threshold served, each person’s role', async () => {
    const g = (await ok(await days(`from=${FROM}&to=${TO}`))) as Grid;
    expect(Object.keys(g).sort()).toEqual([
      'from',
      'people',
      'scope',
      'threshold_minutes',
      'to',
      'truncated',
    ]);
    expect([g.from, g.to, g.scope, g.threshold_minutes, g.truncated]).toEqual([
      FROM,
      TO,
      'people',
      480,
      false,
    ]);
    expect(g.people.map((p) => p.user.name)).toEqual(['Ada', 'Bea']);
    const beaRow = g.people[1];
    expect(beaRow).toBeDefined();
    expect(Object.keys(beaRow ?? {}).sort()).toEqual([
      'days',
      'joined_day',
      'today_day',
      'user',
      'work_days',
      'zone',
    ]);
    expect(beaRow).toMatchObject({
      user: { id: bea.id, name: 'Bea', org_role: 'member', deactivated: false },
      zone: 'UTC',
      work_days: [1, 2, 3, 4, 5],
      days: [
        { day: '2026-11-03', confirmed_minutes: 480, drafted_minutes: 0 },
        { day: '2026-11-04', confirmed_minutes: 0, drafted_minutes: 90 },
      ],
    });
    expect(beaRow?.joined_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(beaRow?.today_day).toBe(new Date().toISOString().slice(0, 10));
    expect(g.people[0]?.user.org_role).toBe('owner');
  });

  it('logs each person shown once per ten minutes, and never the reader', async () => {
    await ok(await days(`from=${FROM}&to=${TO}`));
    expect(looks()).toEqual([[ownerId, bea.id, 'time', null]]);
    // Another month inside ten minutes: the same look.
    await ok(await days('from=2026-10-01&to=2026-10-31'));
    expect(looks()).toEqual([[ownerId, bea.id, 'time', null]]);
  });

  it('is a web session’s, never a token’s', async () => {
    const minted = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'Collector', scope: 'full' }) },
        cookie,
      ),
      201,
    )) as { secret: string };
    expect(await refusal(await days(`from=${FROM}&to=${TO}`, minted.secret))).toEqual([
      403,
      'forbidden',
      'session_required',
    ]);
    expect((await req(`/api/v1/time/days?from=${FROM}&to=${TO}`)).status).toBe(401);
    expect(looks()).toEqual([]);
  });
});

describe('a space admin', () => {
  it('reads the people of the spaces they lead and themselves, scope lead, each a look', async () => {
    const cleo = person('Cleo');
    member(cleo, laika.id, 'member');
    // Bea leads Laika, which Ada set up and is a member of; Dan is in no
    // space and is not shown to her, however much he logged.
    member(bea.id, laika.id, 'lead');
    const dan = person('Dan');
    entry(dan, '2026-11-03', 480);
    const g = (await ok(await days(`from=${FROM}&to=${TO}`, bea.cookie))) as Grid;
    expect(g.scope).toBe('lead');
    expect(g.people.map((p) => p.user.name)).toEqual(['Ada', 'Bea', 'Cleo']);
    expect(looks().sort()).toEqual(
      [
        [bea.id, ownerId, 'time', null],
        [bea.id, cleo, 'time', null],
      ].sort(),
    );
  });

  it('a member leading nothing is refused by the action, and nothing is logged', async () => {
    expect(await refusal(await days(`from=${FROM}&to=${TO}`, bea.cookie))).toEqual([
      403,
      'forbidden',
      'time.report.read',
    ]);
    expect(looks()).toEqual([]);
  });

  it('a space admin’s token is refused session_required, not forbidden', async () => {
    member(bea.id, laika.id, 'lead');
    const minted = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'Collector', scope: 'full' }) },
        bea.cookie,
      ),
      201,
    )) as { secret: string };
    expect(await refusal(await days(`from=${FROM}&to=${TO}`, minted.secret))).toEqual([
      403,
      'forbidden',
      'session_required',
    ]);
  });
});

describe('bounds', () => {
  it('holds 92 days, and refuses longer, backwards, a bad date or a stray parameter — 422', async () => {
    expect(await refusal(await days('from=2026-07-01&to=2026-10-01'))).toEqual([
      422,
      'unprocessable',
      'range_too_long',
    ]);
    await ok(await days('from=2026-07-02&to=2026-10-01'));
    expect(await refusal(await days('from=2026-11-10&to=2026-11-09'))).toEqual([
      422,
      'unprocessable',
      'range_backwards',
    ]);
    expect((await days('from=2026-11-1&to=2026-11-30')).status).toBe(422);
    expect((await days(`from=${FROM}`)).status).toBe(422);
    expect((await days(`from=${FROM}&to=${TO}&members=${bea.id}`)).status).toBe(422);
  });

  it('keeps the grid on a rate-limit bucket of its own, beside the report’s', () => {
    const who = { userId: ownerId, tokenId: null };
    expect(classify('/api/v1/time/days', who, 'GET')).toEqual({
      key: `time-days:${ownerId}`,
      policy: LIMITS.timeReport,
    });
    expect(classify('/api/v1/time/report', who, 'GET').key).toBe(`time-report:${ownerId}`);
    expect(classify('/api/v1/me/time/days', who, 'GET').key).toBe(`session:${ownerId}`);
  });
});
