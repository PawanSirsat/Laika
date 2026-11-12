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
 * `GET /me/time/days` and `GET /people/:id/time/days` (LAI-1173): a person's
 * days over a stretch, one row each — My day's Week, Month and Year views —
 * read as the day view reads them, bounded as the summary is, and logged as a
 * look when somebody else reads them.
 */

const PASSWORD = 'correct-horse-battery-staple';
const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';
const THU = '2026-10-22';
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

const days = (from: string, to: string, auth = cookie, extra = '') =>
  req(`/api/v1/me/time/days?from=${from}&to=${to}&tz=UTC${extra}`, {}, auth);

interface Days {
  from: string;
  to: string;
  tz: string;
  today: string;
  days: {
    day: string;
    state: string;
    confirmed_minutes: number;
    drafted_minutes: number;
    untied_minutes: number;
    top_tasks: {
      task: { key: string } | null;
      untied: boolean;
      confirmed_minutes: number;
      drafted_minutes: number;
    }[];
  }[];
}

const tops = (d: Days['days'][number]) =>
  d.top_tasks.map((t) => [t.task?.key ?? null, t.untied, t.confirmed_minutes, t.drafted_minutes]);

async function newTask(title: string): Promise<{ id: string; key: string }> {
  return (await ok(
    await req(
      '/api/v1/projects/laika/tasks',
      { method: 'POST', body: JSON.stringify({ title }) },
      cookie,
    ),
    201,
  )) as { id: string; key: string };
}

describe('GET /me/time/days', () => {
  it('answers one row per day, with its state, its minutes and its largest tasks', async () => {
    const d = (await ok(await days(MON, SUN))) as Days;
    expect([d.from, d.to, d.tz]).toEqual([MON, SUN, 'UTC']);
    expect(d.days.map((r) => r.day)).toEqual([MON, TUE, WED, THU, '2026-10-23', '2026-10-24', SUN]);
    const [mon, tue, wed] = d.days;
    // A day with nothing is no signal, never zero hours of work.
    expect(mon).toEqual({
      day: MON,
      state: 'no_signal',
      confirmed_minutes: 0,
      drafted_minutes: 0,
      untied_minutes: 0,
      top_tasks: [],
    });
    expect([tue?.state, tue?.confirmed_minutes, tue?.drafted_minutes, tue?.untied_minutes]).toEqual(
      ['drafted', 45, 60, 0],
    );
    expect(tops(tue!)).toEqual([
      ['LAI-1', false, 0, 60],
      [null, false, 45, 0],
    ]);
    // Drafted time on nothing yet is counted apart, and named as untied.
    expect([wed?.state, wed?.confirmed_minutes, wed?.drafted_minutes, wed?.untied_minutes]).toEqual(
      ['drafted', 90, 25, 25],
    );
    expect(tops(wed!)).toEqual([
      ['SKY-1', false, 90, 0],
      [null, true, 0, 25],
    ]);
  });

  it('a day with only confirmed time is confirmed', async () => {
    await ok(
      await req(
        '/api/v1/me/time-entries',
        {
          method: 'POST',
          body: JSON.stringify({ day: THU, tz: 'UTC', minutes: 30, kind: 'work', task: lai1.key }),
        },
        cookie,
      ),
      201,
    );
    const d = (await ok(await days(THU, THU))) as Days;
    expect(d.days.map((r) => [r.state, r.confirmed_minutes, r.drafted_minutes])).toEqual([
      ['confirmed', 30, 0],
    ]);
  });

  it('names at most three tasks a day, the largest first', async () => {
    const two = await newTask('Second');
    const three = await newTask('Third');
    draft(THU, 40, lai1, laika.id);
    draft(THU, 30);
    draft(THU, 20, two, laika.id);
    draft(THU, 10, three, laika.id);
    const d = (await ok(await days(THU, THU))) as Days;
    const thu = d.days[0]!;
    expect([thu.drafted_minutes, thu.untied_minutes]).toEqual([100, 30]);
    expect(tops(thu)).toEqual([
      ['LAI-1', false, 0, 40],
      [null, true, 0, 30],
      [two.key, false, 0, 20],
    ]);
  });

  it('a day after today is future, not no signal', async () => {
    const d = (await ok(await days('2099-01-05', '2099-01-06'))) as Days;
    expect(d.days.map((r) => r.state)).toEqual(['future', 'future']);
    expect(d.today < '2099-01-05').toBe(true);
  });

  it('agrees with the summary, day by day', async () => {
    const d = (await ok(await days(MON, SUN))) as Days;
    const s = (await ok(
      await req(`/api/v1/me/time/summary?from=${MON}&to=${SUN}`, {}, cookie),
    )) as { by_day: { day: string; confirmed_minutes: number; drafted_minutes: number }[] };
    expect(
      d.days.map((r) => ({
        day: r.day,
        confirmed_minutes: r.confirmed_minutes,
        drafted_minutes: r.drafted_minutes,
      })),
    ).toEqual(s.by_day);
  });

  it('refuses a stretch backwards, longer than a quarter, half given, or an unknown zone — 422', async () => {
    const reason = async (res: Response) =>
      ((await res.json()) as { error: { details: { reason?: string } } }).error.details.reason;
    const back = await days(WED, TUE);
    expect(back.status).toBe(422);
    expect(await reason(back)).toBe('range_backwards');
    const long = await days('2026-07-01', '2026-10-01'); // 93 days
    expect(long.status).toBe(422);
    expect(await reason(long)).toBe('range_too_long');
    await ok(await days('2026-07-02', '2026-10-01')); // 92 days
    expect((await req(`/api/v1/me/time/days?from=${MON}`, {}, cookie)).status).toBe(422);
    expect((await days('monday', SUN)).status).toBe(422);
    const zone = await req(
      `/api/v1/me/time/days?from=${MON}&to=${SUN}&tz=Mars/Olympus`,
      {},
      cookie,
    );
    expect(zone.status).toBe(422);
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
    expect((await days(MON, SUN, minted.secret)).status).toBe(403);
    expect((await req(`/api/v1/me/time/days?from=${MON}&to=${SUN}`)).status).toBe(401);
  });
});

describe('GET /people/:id/time/days', () => {
  it('answers an owner with the person’s own days, logged as a look at their time', async () => {
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
    const own = await ok(await days(MON, SUN, bea.cookie));
    const read = await ok(
      await req(`/api/v1/people/${bea.id}/time/days?from=${MON}&to=${SUN}&tz=UTC`, {}, cookie),
    );
    expect(read).toEqual(own);
    const looks = h.db.select().from(analyticsViews).all();
    expect(looks.map((l) => [l.subjectId, l.kind, l.day])).toEqual([[bea.id, 'time', null]]);
    // A member may not read the owner's.
    expect(
      (await req(`/api/v1/people/${ownerId}/time/days?from=${MON}&to=${SUN}`, {}, bea.cookie))
        .status,
    ).toBe(403);
  });
});
