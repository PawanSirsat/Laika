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
 * `GET /me/time/summary` and `GET /people/:id/time/summary` (LAI-526): a
 * person's time over a stretch of days — by day, by project, by task, by
 * kind — read as the day view reads it, bounded to a quarter, and logged as a
 * look when somebody else reads it.
 */

const PASSWORD = 'correct-horse-battery-staple';
const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';
const SUN = '2026-10-25';

let h: AuthHarness;
let cookie: string;
let ownerId: string;
let orgId: string;
let laika: { id: string; slug: string; name: string };
let lai1: { id: string; key: string; title: string };

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

function draft(day: string, minutes: number, task?: { id: string }, projectId?: string): void {
  const start = Date.parse(`${day}T09:00:00Z`);
  h.db
    .insert(timeDrafts)
    .values({
      id: newId(),
      userId: ownerId,
      source: 'collector',
      collectorId: 'c',
      day,
      tz: 'UTC',
      startedAt: start,
      endedAt: start + minutes * 60_000,
      minutes,
      taskId: task?.id ?? null,
      projectId: projectId ?? null,
      signals: '{}',
      createdAt: start,
      updatedAt: start,
    })
    .run();
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
  await ok(await req('/api/v1/org/time', { method: 'PUT', body: '{"mode":"drafts"}' }, cookie));
  const project = (await ok(await req('/api/v1/projects/laika', {}, cookie))) as {
    id: string;
    slug: string;
    name: string;
  };
  laika = { id: project.id, slug: project.slug, name: project.name };
  const task = (await ok(
    await req(
      '/api/v1/projects/laika/tasks',
      { method: 'POST', body: JSON.stringify({ title: 'Search matches keys' }) },
      cookie,
    ),
    201,
  )) as { id: string; key: string; title: string };
  lai1 = { id: task.id, key: task.key, title: task.title };
  await ok(
    await req(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: 'Skynet', slug: 'skynet', prefix: 'SKY' }) },
      cookie,
    ),
    201,
  );

  // Tuesday: an hour drafted on LAI-1, a 45-minute meeting typed by hand.
  draft(TUE, 60, lai1, laika.id);
  await ok(
    await req(
      '/api/v1/me/time-entries',
      {
        method: 'POST',
        body: JSON.stringify({ day: TUE, tz: 'UTC', minutes: 45, kind: 'meeting', title: 'Sync' }),
      },
      cookie,
    ),
    201,
  );
  // Wednesday: 25 minutes drafted on nothing, an hour and a half on SKY-1, confirmed.
  draft(WED, 25);
  const sky = (await ok(
    await req(
      '/api/v1/projects/skynet/tasks',
      { method: 'POST', body: JSON.stringify({ title: 'Webhook retries' }) },
      cookie,
    ),
    201,
  )) as { id: string; key: string };
  await ok(
    await req(
      '/api/v1/me/time-entries',
      {
        method: 'POST',
        body: JSON.stringify({ day: WED, tz: 'UTC', minutes: 90, kind: 'work', task: sky.key }),
      },
      cookie,
    ),
    201,
  );
});

afterEach(() => {
  h.close();
});

const summary = (from: string, to: string, auth = cookie) =>
  req(`/api/v1/me/time/summary?from=${from}&to=${to}`, {}, auth);

interface Summary {
  from: string;
  to: string;
  days: number;
  active_days: number;
  confirmed_minutes: number;
  drafted_minutes: number;
  meeting_minutes: number;
  manual_minutes: number;
  by_day: { day: string; confirmed_minutes: number; drafted_minutes: number }[];
  by_project: {
    project: { slug: string } | null;
    confirmed_minutes: number;
    drafted_minutes: number;
  }[];
  by_task: {
    task: { key: string } | null;
    untied: boolean;
    confirmed_minutes: number;
    drafted_minutes: number;
  }[];
  by_kind: { kind: string | null; minutes: number }[];
}

describe('GET /me/time/summary', () => {
  it('sums a week by day, by project, by task and by kind, the largest first', async () => {
    const s = (await ok(await summary(MON, SUN))) as Summary;
    expect(s.from).toBe(MON);
    expect(s.to).toBe(SUN);
    expect(s.days).toBe(7);
    expect(s.active_days).toBe(2);
    expect(s.confirmed_minutes).toBe(135);
    expect(s.drafted_minutes).toBe(85);
    expect(s.meeting_minutes).toBe(45);
    expect(s.manual_minutes).toBe(135);
    expect(s.by_day).toHaveLength(7);
    expect(s.by_day.find((d) => d.day === TUE)).toEqual({
      day: TUE,
      confirmed_minutes: 45,
      drafted_minutes: 60,
    });
    expect(s.by_day.find((d) => d.day === WED)).toEqual({
      day: WED,
      confirmed_minutes: 90,
      drafted_minutes: 25,
    });
    expect(
      s.by_project.map((p) => [p.project?.slug ?? null, p.confirmed_minutes, p.drafted_minutes]),
    ).toEqual([
      ['skynet', 90, 0],
      [null, 45, 25],
      ['laika', 0, 60],
    ]);
    // Time typed on no task and drafted time on nothing yet are kept apart.
    expect(
      s.by_task.map((t) => [t.task?.key ?? null, t.untied, t.confirmed_minutes, t.drafted_minutes]),
    ).toEqual([
      ['SKY-1', false, 90, 0],
      ['LAI-1', false, 0, 60],
      [null, false, 45, 0],
      [null, true, 0, 25],
    ]);
    expect(s.by_kind).toEqual([
      { kind: 'work', minutes: 90 },
      { kind: null, minutes: 85 },
      { kind: 'meeting', minutes: 45 },
    ]);
  });

  it('a single day is a summary of one', async () => {
    const s = (await ok(await summary(WED, WED))) as Summary;
    expect([s.days, s.active_days, s.confirmed_minutes, s.drafted_minutes]).toEqual([1, 1, 90, 25]);
  });

  it('refuses a stretch backwards, longer than a quarter, or half given — 422', async () => {
    const back = await summary(WED, TUE);
    expect(back.status).toBe(422);
    expect(
      ((await back.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('range_backwards');
    const long = await summary('2026-07-01', '2026-10-01'); // 93 days
    expect(long.status).toBe(422);
    expect(
      ((await long.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('range_too_long');
    await ok(await summary('2026-07-02', '2026-10-01')); // 92 days
    expect((await req(`/api/v1/me/time/summary?from=${MON}`, {}, cookie)).status).toBe(422);
    expect((await summary('monday', SUN)).status).toBe(422);
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
    expect((await summary(MON, SUN, minted.secret)).status).toBe(403);
    expect((await req(`/api/v1/me/time/summary?from=${MON}&to=${SUN}`)).status).toBe(401);
  });
});

describe('GET /people/:id/time/summary', () => {
  it('answers an owner with the person’s own summary, logged as a look at their time', async () => {
    const token = seedInvite(h.db, {
      orgId,
      createdBy: ownerId,
      email: 'bea@example.test',
      orgRole: 'member',
    });
    const res = await signUp(h.app, {
      email: 'bea@example.test',
      password: PASSWORD,
      inviteToken: token,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const bea = {
      cookie: cookieFrom(res),
      id: h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()?.id ?? '',
    };
    const own = await ok(await summary(MON, SUN, bea.cookie));
    const read = await ok(
      await req(`/api/v1/people/${bea.id}/time/summary?from=${MON}&to=${SUN}`, {}, cookie),
    );
    expect(read).toEqual(own);
    const looks = h.db.select().from(analyticsViews).all();
    expect(looks.map((l) => [l.subjectId, l.kind, l.day])).toEqual([[bea.id, 'time', null]]);
    // A member may not read the owner's.
    expect(
      (await req(`/api/v1/people/${ownerId}/time/summary?from=${MON}&to=${SUN}`, {}, bea.cookie))
        .status,
    ).toBe(403);
  });
});
