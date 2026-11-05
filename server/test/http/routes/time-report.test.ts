import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../../src/auth/resolve-actor.ts';
import { newId } from '../../../src/db/ids.ts';
import {
  analyticsViews,
  orgs,
  projectMemberships,
  timeDrafts,
  timeEntries,
  users,
} from '../../../src/db/schema.ts';
import { ApiError } from '../../../src/errors.ts';
import { classify } from '../../../src/http/middleware/rate-limit.ts';
import { LIMITS } from '../../../src/http/rate-limit.ts';
import { getTimeReport } from '../../../src/services/time-report.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /time/report` (D-130, D-135, LAI-1135): the Time report in its three
 * scopes, JSON and CSV — one person's equal to their `GET /me/time/summary`,
 * people logged once each per ten minutes, a space admin's totals confirmed
 * only and under the three-person floor, and every refusal by its code.
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
let laika: { id: string };
let skynet: { id: string };
let lai1: { id: string; key: string };
let sky1: { id: string; key: string };
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

/** The refusal's status, code and reason — never a bare "it failed". */
async function refusal(res: Response): Promise<[number, string, unknown]> {
  const body = (await res.json()) as {
    error: { code: string; details: { reason?: string; action?: string } | null };
  };
  return [res.status, body.error.code, body.error.details?.reason ?? body.error.details?.action];
}

function draft(userId: string, day: string, minutes: number, taskId?: string, projectId?: string) {
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
      taskId: taskId ?? null,
      projectId: projectId ?? null,
      signals: '{}',
      createdAt: start,
      updatedAt: start,
    })
    .run();
}

function entry(
  userId: string,
  day: string,
  minutes: number,
  at: { taskId?: string; projectId?: string; kind?: 'work' | 'meeting' } = {},
) {
  const start = Date.parse(`${day}T10:00:00Z`);
  h.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      taskId: at.taskId ?? null,
      projectId: at.projectId ?? null,
      day,
      tz: 'UTC',
      minutes,
      source: 'manual',
      kind: at.kind ?? 'work',
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
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole: 'member',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return id;
}

function lead(userId: string, projectId: string): void {
  h.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role: 'lead', createdAt: Date.now() })
    .run();
}

async function task(slug: string, title: string): Promise<{ id: string; key: string }> {
  return (await ok(
    await req(
      `/api/v1/projects/${slug}/tasks`,
      { method: 'POST', body: JSON.stringify({ title }) },
      cookie,
    ),
    201,
  )) as { id: string; key: string };
}

const report = (query: string, auth = cookie) => req(`/api/v1/time/report?${query}`, {}, auth);
const looks = () =>
  h.db
    .select()
    .from(analyticsViews)
    .all()
    .map((l) => [l.viewerId, l.subjectId, l.kind, l.day]);

interface Row {
  project: { id: string; slug: string } | null;
  user: { id: string; name: string; deactivated: boolean } | null;
  task: { id: string; key: string } | null;
  untied: boolean;
  kind: string | null;
  confirmed_minutes: number;
  drafted_minutes: number;
}
interface Report {
  from: string;
  to: string;
  days: number;
  scope: string;
  include_drafts: boolean;
  totals: Record<string, number | null>;
  agent_minutes: number | null;
  by_day: { day: string; confirmed_minutes: number | null; drafted_minutes: number }[];
  rows: Row[];
  folded: { tasks: number; spaces: number; days: number; minutes: number | null } | null;
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
  laika = (await ok(await req('/api/v1/projects/laika', {}, cookie))) as { id: string };
  lai1 = await task('laika', 'Search matches keys');
  skynet = (await ok(
    await req(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: 'Skynet', slug: 'skynet', prefix: 'SKY' }) },
      cookie,
    ),
    201,
  )) as { id: string };
  sky1 = await task('skynet', 'Webhook retries');

  // Ada's week, as `time-summary.test.ts` builds it: an hour drafted on
  // LAI-1, a 45-minute meeting typed by hand, 25 minutes drafted on nothing,
  // an hour and a half confirmed on SKY-1.
  draft(ownerId, TUE, 60, lai1.id, laika.id);
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
  draft(ownerId, WED, 25);
  await ok(
    await req(
      '/api/v1/me/time-entries',
      {
        method: 'POST',
        body: JSON.stringify({ day: WED, tz: 'UTC', minutes: 90, kind: 'work', task: sky1.key }),
      },
      cookie,
    ),
    201,
  );

  // Bea, a member: 30 minutes on LAI-1, confirmed.
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
  // `signUp` names everybody alike; the report shows names, so give hers.
  h.db.update(users).set({ name: 'Bea' }).where(eq(users.id, bea.id)).run();
  entry(bea.id, MON, 30, { taskId: lai1.id, projectId: laika.id });
});

afterEach(() => {
  h.close();
});

describe('own — the caller’s own time', () => {
  it('equals GET /me/time/summary for the same stretch: totals, by day, by space, by task', async () => {
    const summary = (await ok(
      await req(`/api/v1/me/time/summary?from=${MON}&to=${SUN}`, {}, cookie),
    )) as {
      confirmed_minutes: number;
      drafted_minutes: number;
      meeting_minutes: number;
      manual_minutes: number;
      active_days: number;
      by_day: unknown[];
      by_project: {
        project: { id: string } | null;
        confirmed_minutes: number;
        drafted_minutes: number;
      }[];
      by_task: {
        task: { id: string } | null;
        project: { id: string } | null;
        untied: boolean;
        confirmed_minutes: number;
        drafted_minutes: number;
      }[];
    };
    const r = (await ok(
      await report(`from=${MON}&to=${SUN}&members=${ownerId}&drafts=include`),
    )) as Report;

    expect(r.scope).toBe('own');
    expect(r.include_drafts).toBe(true);
    expect(r.totals).toEqual({
      confirmed_minutes: summary.confirmed_minutes,
      drafted_minutes: summary.drafted_minutes,
      meeting_minutes: summary.meeting_minutes,
      manual_minutes: summary.manual_minutes,
      active_days: summary.active_days,
      people: 1,
    });
    // The figures are real, not two zeros agreeing.
    expect([r.totals.confirmed_minutes, r.totals.drafted_minutes]).toEqual([135, 85]);
    expect(r.by_day).toEqual(summary.by_day);

    const sum = (key: (row: Row) => string) => {
      const m = new Map<string, [number, number]>();
      for (const row of r.rows) {
        const [c, d] = m.get(key(row)) ?? [0, 0];
        m.set(key(row), [c + row.confirmed_minutes, d + row.drafted_minutes]);
      }
      return [...m.entries()].sort();
    };
    expect(sum((row) => row.project?.id ?? '')).toEqual(
      summary.by_project
        .map((p) => [p.project?.id ?? '', [p.confirmed_minutes, p.drafted_minutes]])
        .sort(),
    );
    expect(
      sum((row) => `${row.task?.id ?? ''}|${row.project?.id ?? ''}|${String(row.untied)}`),
    ).toEqual(
      summary.by_task
        .map((t) => [
          `${t.task?.id ?? ''}|${t.project?.id ?? ''}|${String(t.untied)}`,
          [t.confirmed_minutes, t.drafted_minutes],
        ])
        .sort(),
    );
    // Reading your own is nobody looking.
    expect(looks()).toEqual([]);
  });

  it('leaves drafts out unless asked, and a member reads their own', async () => {
    const r = (await ok(
      await report(`from=${MON}&to=${SUN}&members=${bea.id}`, bea.cookie),
    )) as Report;
    expect([
      r.scope,
      r.include_drafts,
      r.totals.confirmed_minutes,
      r.totals.drafted_minutes,
    ]).toEqual(['own', false, 30, 0]);
    const ada = (await ok(await report(`from=${MON}&to=${SUN}&members=${ownerId}`))) as Report;
    expect([ada.totals.confirmed_minutes, ada.totals.drafted_minutes]).toEqual([135, 0]);
  });
});

describe('people — per person, every one shown logged', () => {
  it('answers the owner with everyone and logs each person shown, once per ten minutes', async () => {
    const r = (await ok(await report(`from=${MON}&to=${SUN}`))) as Report;
    expect(r.scope).toBe('people');
    expect(r.totals.people).toBe(2);
    expect(new Set(r.rows.map((row) => row.user?.name))).toEqual(new Set(['Ada', 'Bea']));
    expect(r.rows.find((row) => row.user?.id === bea.id)).toMatchObject({
      task: { key: lai1.key },
      confirmed_minutes: 30,
      user: { name: 'Bea', deactivated: false },
    });
    // Bea is shown, so she is looked at; Ada is the reader.
    expect(looks()).toEqual([[ownerId, bea.id, 'time', null]]);

    // A filter click inside ten minutes is the same look, JSON or CSV.
    await ok(await report(`from=${TUE}&to=${SUN}&members=${bea.id},${ownerId}`));
    expect((await report(`from=${MON}&to=${SUN}&format=csv`)).status).toBe(200);
    expect(looks()).toEqual([[ownerId, bea.id, 'time', null]]);
  });

  it('logs nothing for a person the stretch shows no time of', async () => {
    const r = (await ok(await report(`from=${TUE}&to=${SUN}`))) as Report;
    expect(r.rows.some((row) => row.user?.id === bea.id)).toBe(false);
    expect(looks()).toEqual([]);
  });

  it('refuses a member asking for anybody else — 403, by the action', async () => {
    expect(await refusal(await report(`from=${MON}&to=${SUN}`, bea.cookie))).toEqual([
      403,
      'forbidden',
      'time.report.read',
    ]);
    expect(
      await refusal(await report(`from=${MON}&to=${SUN}&members=${ownerId}`, bea.cookie)),
    ).toEqual([403, 'forbidden', 'people.analytics.read']);
    expect(looks()).toEqual([]);
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
    expect(await refusal(await report(`from=${MON}&to=${SUN}`, minted.secret))).toEqual([
      403,
      'forbidden',
      'session_required',
    ]);
    expect(
      await refusal(await report(`from=${MON}&to=${SUN}&members=${ownerId}`, minted.secret)),
    ).toEqual([403, 'forbidden', 'session_required']);
    expect((await req(`/api/v1/time/report?from=${MON}&to=${SUN}`)).status).toBe(401);
  });

  it('never names a space or task the reader cannot open', async () => {
    // A member granted *See everyone's analytics*, in no space at all.
    const off = {
      see_people_analytics: false,
      see_org_activity: false,
      open_all_projects: false,
      invite_people: false,
      deactivate_people: false,
      create_archive_projects: false,
      manage_any_tokens: false,
      change_org_settings: false,
    };
    const on = Object.fromEntries(Object.keys(off).map((k) => [k, true]));
    await ok(
      await req(
        '/api/v1/org/permissions',
        {
          method: 'PUT',
          body: JSON.stringify({
            grants: { admin: on, member: { ...off, see_people_analytics: true }, viewer: off },
          }),
        },
        cookie,
      ),
    );
    const res = await report(`from=${MON}&to=${SUN}&drafts=include`, bea.cookie);
    const text = await res.clone().text();
    const r = (await ok(res)) as Report;
    expect(r.scope).toBe('people');
    // Every minute is counted…
    expect([r.totals.confirmed_minutes, r.totals.drafted_minutes]).toEqual([165, 85]);
    // …and nothing about where it was is said.
    expect(r.rows.every((row) => row.project === null && row.task === null)).toBe(true);
    for (const hidden of ['skynet', sky1.key, 'Webhook retries', lai1.key, 'Search matches keys']) {
      expect(text, hidden).not.toContain(hidden);
    }
    // A space they cannot open, asked for by name, is the slug nobody has.
    expect(await refusal(await report(`from=${MON}&to=${SUN}&spaces=skynet`, bea.cookie))).toEqual([
      404,
      'not_found',
      undefined,
    ]);
  });
});

describe('space_totals — a space admin’s', () => {
  let cleo: string;
  let dan: string;
  let eve: string;
  let lai2: { id: string; key: string };

  beforeEach(async () => {
    cleo = person('Cleo');
    dan = person('Dan');
    eve = person('Eve');
    lai2 = await task('laika', 'Two hands only');
    // LAI-1: Bea's 30 on Monday, alone that day, and 3 × 20 on Tuesday.
    for (const id of [cleo, dan, eve]) entry(id, TUE, 20, { taskId: lai1.id, projectId: laika.id });
    // Wednesday: LAI-2 is Cleo's alone, below the floor, so it joins Laika's
    // no-task time — Dan's and Eve's 5 each — which then covers three people.
    entry(cleo, WED, 15, { taskId: lai2.id, projectId: laika.id });
    for (const id of [dan, eve]) entry(id, WED, 5, { projectId: laika.id });
    lead(bea.id, laika.id);
  });

  it('serves confirmed totals with nobody in them, folding a task under three people', async () => {
    const r = (await ok(await report(`from=${MON}&to=${SUN}`, bea.cookie))) as Report;
    expect(r.scope).toBe('space_totals');
    expect(r.include_drafts).toBe(false);
    expect(r.agent_minutes).toBeNull();
    expect(r.rows.every((row) => row.user === null)).toBe(true);
    expect(r.rows.map((row) => [row.task?.key ?? null, row.confirmed_minutes])).toEqual([
      [lai1.key, 90],
      [null, 25],
    ]);
    // Ada's draft on LAI-1 is not confirmed, so it is not here.
    expect(r.totals).toMatchObject({ confirmed_minutes: 115, drafted_minutes: 0, people: 4 });
    expect(JSON.stringify(r)).not.toContain('Two hands only');
    expect(looks()).toEqual([]);
  });

  it('never shows a day fewer than three people worked: one person alone is withheld', async () => {
    const r = (await ok(await report(`from=${MON}&to=${SUN}`, bea.cookie))) as Report;
    const day = (d: string) => r.by_day.find((x) => x.day === d)?.confirmed_minutes;
    // Monday is Bea's 30 alone: withheld. Withheld alone, it would be the
    // total less the days shown — so the smallest shown day, Wednesday's
    // three people, is withheld with it, and the two together cover four.
    expect(day(MON)).toBeNull();
    expect(day(WED)).toBeNull();
    expect(day(TUE)).toBe(60);
    expect(r.by_day.filter((x) => x.confirmed_minutes === null)).toHaveLength(2);
    expect(r.folded).toEqual({ tasks: 1, spaces: 0, days: 2, minutes: 0 });
    expect(r.by_day.some((x) => x.confirmed_minutes === 30)).toBe(false);
  });

  it('folds a space with fewer than three people into one row that names no space', async () => {
    lead(bea.id, skynet.id);
    const r = (await ok(await report(`from=${MON}&to=${SUN}`, bea.cookie))) as Report;
    // Skynet holds Ada's 90 alone. With it in the pool alone the pool would be
    // hers, so the smallest named row joins it: Laika's no-task 25.
    expect(
      r.rows.map((row) => [
        row.project?.slug ?? null,
        row.task?.key ?? null,
        row.confirmed_minutes,
      ]),
    ).toEqual([
      [null, null, 115],
      ['laika', lai1.key, 90],
    ]);
    expect(JSON.stringify(r)).not.toContain(sky1.key);
    expect(r.folded).toMatchObject({ tasks: 1, spaces: 1, minutes: 115 });
  });

  it('withholds every figure when the whole report is under three people', async () => {
    // Bea leads Skynet alone: Ada's 90 is all it holds.
    h.db.delete(projectMemberships).where(eq(projectMemberships.userId, bea.id)).run();
    lead(bea.id, skynet.id);
    const r = (await ok(await report(`from=${MON}&to=${SUN}`, bea.cookie))) as Report;
    expect(r.rows).toEqual([]);
    expect(r.totals).toMatchObject({ confirmed_minutes: null, active_days: null, people: 1 });
    expect(r.by_day.every((d) => d.confirmed_minutes === null || d.confirmed_minutes === 0)).toBe(
      true,
    );
    expect(r.folded).toEqual({ tasks: 0, spaces: 1, days: 1, minutes: null });
    // No figure anywhere is her 90.
    expect(JSON.stringify([r.rows, r.totals, r.by_day, r.folded])).not.toMatch(/\b90\b/);
  });

  it('refuses members, drafts, and a space they do not lead — each by its code', async () => {
    expect(
      await refusal(await report(`from=${MON}&to=${SUN}&members=${cleo}`, bea.cookie)),
    ).toEqual([422, 'unprocessable', 'members_not_allowed']);
    expect(await refusal(await report(`from=${MON}&to=${SUN}&drafts=include`, bea.cookie))).toEqual(
      [422, 'unprocessable', 'drafts_not_allowed'],
    );
    // Bea is a plain member of Skynet: she reads it, and leads only Laika.
    h.db
      .insert(projectMemberships)
      .values({
        id: newId(),
        projectId: skynet.id,
        userId: bea.id,
        role: 'member',
        createdAt: Date.now(),
      })
      .run();
    expect(await refusal(await report(`from=${MON}&to=${SUN}&spaces=skynet`, bea.cookie))).toEqual([
      403,
      'forbidden',
      'time.report.read_project',
    ]);
    expect(await refusal(await report(`from=${MON}&to=${SUN}&spaces=nowhere`, bea.cookie))).toEqual(
      [404, 'not_found', undefined],
    );
  });

  it('writes the file with no person column, and no day fewer than three people worked', async () => {
    const res = await report(`from=${MON}&to=${SUN}&format=csv`, bea.cookie);
    expect(res.status).toBe(200);
    const lines = (await res.text()).split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe('day,space,task_key,task_title,kind,confirmed_minutes,drafted_minutes');
    // LAI-1's Monday is Bea's alone, so its days go out together, with no day;
    // the no-task row's one day, Wednesday, covers three people and is shown.
    expect(lines.slice(1)).toEqual([
      `${WED},Laika,,,work,25,0`,
      `,Laika,${lai1.key},Search matches keys,work,90,0`,
    ]);
  });
});

describe('bounds', () => {
  it('holds a quarter, and refuses longer or backwards — 422 with the reason', async () => {
    expect(await refusal(await report('from=2026-07-01&to=2026-10-01'))).toEqual([
      422,
      'unprocessable',
      'range_too_long',
    ]);
    await ok(await report('from=2026-07-02&to=2026-10-01'));
    expect(await refusal(await report(`from=${WED}&to=${TUE}`))).toEqual([
      422,
      'unprocessable',
      'range_backwards',
    ]);
    expect((await report(`from=${MON}`)).status).toBe(422);
  });

  it('refuses more than 200 members, an unknown kind, an unknown person', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `u${String(i)}`).join(',');
    expect(await refusal(await report(`from=${MON}&to=${SUN}&members=${many}`))).toEqual([
      422,
      'unprocessable',
      'too_many_members',
    ]);
    expect((await report(`from=${MON}&to=${SUN}&kinds=nap`)).status).toBe(422);
    expect(await refusal(await report(`from=${MON}&to=${SUN}&members=nobody`))).toEqual([
      404,
      'not_found',
      undefined,
    ]);
  });

  it('refuses a JSON report past its row cap with report_too_large, and logs nothing', () => {
    const actor = loadActor(h.db, ownerId);
    if (actor === null) throw new Error('no owner');
    let thrown: unknown;
    try {
      getTimeReport(h.db, actor, { from: MON, to: SUN }, Date.now(), 1);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).details).toMatchObject({ reason: 'report_too_large', max_rows: 1 });
    expect(looks()).toEqual([]);
    // The same read under the cap answers, and is a look at Bea.
    expect(getTimeReport(h.db, actor, { from: MON, to: SUN }).rows.length).toBeGreaterThan(1);
    expect(looks()).toEqual([[ownerId, bea.id, 'time', null]]);
  });

  it('keeps the report on a rate-limit bucket of its own', () => {
    const who = { userId: ownerId, tokenId: null };
    expect(classify('/api/v1/time/report', who, 'GET')).toEqual({
      key: `time-report:${ownerId}`,
      policy: LIMITS.timeReport,
    });
    expect(classify('/api/v1/me/time/summary', who, 'GET').key).toBe(`session:${ownerId}`);
  });
});

describe('CSV', () => {
  it('is an attachment with the columns, one line per day and row, formulas defused', async () => {
    const evil = await task('laika', '=HYPERLINK("http://x")');
    entry(bea.id, WED, 10, { taskId: evil.id, projectId: laika.id, kind: 'meeting' });
    const res = await report(`from=${MON}&to=${SUN}`.concat('&format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="laika-time-${MON}-${SUN}.csv"`,
    );
    const lines = (await res.text()).split('\r\n');
    expect(lines[0]).toBe(
      'day,space,task_key,task_title,person,kind,confirmed_minutes,drafted_minutes',
    );
    expect(lines).toContain(`${MON},Laika,${lai1.key},Search matches keys,Bea,work,30,0`);
    expect(lines).toContain(`${WED},Skynet,${sky1.key},Webhook retries,Ada,work,90,0`);
    // The title a spreadsheet would run is prefixed, and its quotes doubled.
    expect(lines).toContain(
      `${WED},Laika,${evil.key},"'=HYPERLINK(""http://x"")",Bea,meeting,10,0`,
    );
    // Viewed as a file is a look as well.
    expect(looks()).toEqual([[ownerId, bea.id, 'time', null]]);
  });
});
