import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../../src/auth/resolve-actor.ts';
import { newId } from '../../../src/db/ids.ts';
import {
  agentTimeDays,
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
 * people logged once each per ten minutes, a space admin's one figure a
 * week (D-136), and every refusal by its code.
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
  totals: Record<string, number>;
  agent_minutes: number | null;
  by_day: { day: string; confirmed_minutes: number; drafted_minutes: number }[];
  rows: Row[];
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

describe('link — by what the time is on (D-142, LAI-1163)', () => {
  // Ada's week: 90 confirmed on SKY-1 and 60 drafted on LAI-1 (on a task);
  // the 45-minute meeting typed on nothing, and 15 drafted marked general
  // (general); 25 drafted on nothing, not marked (not on a task yet).
  const general = () => {
    draft(ownerId, MON, 15);
    h.db
      .update(timeDrafts)
      .set({ general: 1 })
      .where(and(eq(timeDrafts.userId, ownerId), eq(timeDrafts.day, MON)))
      .run();
  };
  const at = async (link: string) =>
    (await ok(
      await report(`from=${MON}&to=${SUN}&members=${ownerId}&drafts=include${link}`),
    )) as Report;
  const pair = (r: Report) => [r.totals.confirmed_minutes, r.totals.drafted_minutes];
  const byDay = (r: Report) =>
    r.by_day.map((d) => d.confirmed_minutes + d.drafted_minutes).reduce((a, b) => a + b, 0);

  it('splits the figures, the bars and the rows three ways that add up to all', async () => {
    general();
    const all = await at('');
    const task = await at('&link=task');
    const gen = await at('&link=general');
    const untied = await at('&link=untied');
    expect(pair(all)).toEqual([135, 100]);
    expect(pair(task)).toEqual([90, 60]);
    expect(pair(gen)).toEqual([45, 15]);
    expect(pair(untied)).toEqual([0, 25]);
    expect([byDay(task), byDay(gen), byDay(untied)]).toEqual([150, 60, 25]);
    expect(task.rows.every((r) => r.task !== null)).toBe(true);
    expect(gen.rows.every((r) => r.task === null && !r.untied)).toBe(true);
    expect(untied.rows.map((r) => [r.untied, r.drafted_minutes])).toEqual([[true, 25]]);
  });

  it('holds back agent minutes when narrowed, as a space or a kind does', async () => {
    const owner = async (q: string) =>
      (await ok(await report(`from=${MON}&to=${SUN}${q}`))) as Report;
    expect((await owner('')).agent_minutes).not.toBeNull();
    expect((await owner('&link=task')).agent_minutes).toBeNull();
  });

  it('narrows the file the same way', async () => {
    const csv = async (link: string) =>
      (
        await (
          await report(`from=${MON}&to=${SUN}&members=${ownerId}&drafts=include&format=csv${link}`)
        ).text()
      )
        .trim()
        .split('\r\n')
        .slice(1);
    const untied = await csv('&link=untied');
    expect(untied).toHaveLength(1);
    expect(untied[0]).toMatch(/,0,25$/);
    expect((await csv('&link=task')).some((l) => l.includes('SKY-1'))).toBe(true);
    expect((await csv('&link=general')).some((l) => l.includes('SKY-1'))).toBe(false);
  });

  it('refuses an unknown link', async () => {
    const [status, code] = await refusal(await report(`from=${MON}&to=${SUN}&link=other`));
    expect([status, code]).toEqual([422, 'unprocessable']);
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

  it('logs a person named even when the stretch shows no time of theirs', async () => {
    // Asked for everyone, Bea is not shown in Tuesday to Sunday: nobody looked at her.
    const all = (await ok(await report(`from=${TUE}&to=${SUN}`))) as Report;
    expect(all.rows.some((row) => row.user?.id === bea.id)).toBe(false);
    expect(looks()).toEqual([]);
    // Named, she is looked at — an empty answer about her is still about her.
    const named = (await ok(await report(`from=${TUE}&to=${SUN}&members=${bea.id}`))) as Report;
    expect(named.rows).toEqual([]);
    expect(looks()).toEqual([[ownerId, bea.id, 'time', null]]);
  });

  it('logs everybody whose agent time is in agent_minutes, named or not', async () => {
    const cleo = person('Cleo');
    h.db
      .insert(agentTimeDays)
      .values({
        userId: cleo,
        day: TUE,
        sessionKey: 's',
        kind: 'cli',
        seconds: 1200,
        updatedAt: Date.now(),
      })
      .run();
    // Everyone, Tuesday to Sunday: Bea is not shown; Cleo has no rows, only
    // her agent's 20 minutes — which the answer serves, so she is a look.
    const r = (await ok(await report(`from=${TUE}&to=${SUN}`))) as Report;
    expect(r.rows.some((row) => row.user?.id === cleo)).toBe(false);
    expect(r.agent_minutes).toBe(20);
    expect(looks()).toEqual([[ownerId, cleo, 'time', null]]);
  });

  it('logs a person named whose only time is their agent’s', async () => {
    const cleo = person('Cleo');
    h.db
      .insert(agentTimeDays)
      .values({
        userId: cleo,
        day: TUE,
        sessionKey: 's',
        kind: 'cli',
        seconds: 1200,
        updatedAt: Date.now(),
      })
      .run();
    const r = (await ok(await report(`from=${MON}&to=${SUN}&members=${cleo}`))) as Report;
    expect([r.rows, r.agent_minutes]).toEqual([[], 20]);
    expect(looks()).toEqual([[ownerId, cleo, 'time', null]]);
    // A refused read is not a look: a member asking for Cleo.
    expect((await report(`from=${MON}&to=${SUN}&members=${cleo}`, bea.cookie)).status).toBe(403);
    expect(looks()).toEqual([[ownerId, cleo, 'time', null]]);
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

describe('space_totals — a space admin’s weeks (D-136)', () => {
  const PREV_MON = '2026-10-12';
  const PREV_TUE = '2026-10-13';
  const PREV_SUN = '2026-10-18';
  let cleo: string;
  let dan: string;
  let eve: string;

  interface Weeks {
    from: string;
    to: string;
    scope: string;
    project: { slug: string };
    weeks: { from: string; to: string; confirmed_minutes: number | null; people: number }[];
  }

  beforeEach(() => {
    cleo = person('Cleo');
    dan = person('Dan');
    eve = person('Eve');
    // This week: Bea's 30 on Monday and 3 × 20 on Tuesday — four people.
    for (const id of [cleo, dan, eve]) entry(id, TUE, 20, { taskId: lai1.id, projectId: laika.id });
    // Last week: Cleo's 15 alone.
    entry(cleo, PREV_TUE, 15, { taskId: lai1.id, projectId: laika.id });
    lead(bea.id, laika.id);
  });

  it('answers one figure a week and nothing else; a week under three people is null', async () => {
    const res = await report(`from=${PREV_MON}&to=${SUN}`, bea.cookie);
    const r = (await ok(res)) as Weeks;
    expect(Object.keys(r).sort()).toEqual(['from', 'project', 'scope', 'to', 'weeks']);
    expect([r.scope, r.project.slug]).toEqual(['space_totals', 'laika']);
    expect(r.weeks).toEqual([
      { from: PREV_MON, to: PREV_SUN, confirmed_minutes: null, people: 1 },
      { from: MON, to: SUN, confirmed_minutes: 90, people: 4 },
    ]);
    // Ada's drafts, her meeting on no space and her Skynet time are not here;
    // nobody is named, so nobody is looked at.
    expect(looks()).toEqual([]);
  });

  it('refuses anything but one space over whole weeks — each by its code', async () => {
    const refused = async (q: string) => refusal(await report(q, bea.cookie));
    expect(await refused(`from=${MON}&to=${SUN}&members=${cleo}`)).toEqual([
      422,
      'unprocessable',
      'members_not_allowed',
    ]);
    expect(await refused(`from=${MON}&to=${SUN}&drafts=include`)).toEqual([
      422,
      'unprocessable',
      'drafts_not_allowed',
    ]);
    expect(await refused(`from=${MON}&to=${SUN}&kinds=work`)).toEqual([
      422,
      'unprocessable',
      'kinds_not_allowed',
    ]);
    expect(await refused(`from=${MON}&to=${SUN}&link=task`)).toEqual([
      422,
      'unprocessable',
      'link_not_allowed',
    ]);
    // Not Monday to Sunday: a part of a week, or a week starting midweek.
    for (const q of [`from=${MON}&to=${WED}`, `from=${TUE}&to=2026-10-26`]) {
      expect(await refused(q)).toEqual([422, 'unprocessable', 'range_not_whole_weeks']);
    }
    // Fourteen weeks is past the quarter.
    expect(await refused('from=2026-07-20&to=2026-10-25')).toEqual([
      422,
      'unprocessable',
      'range_too_long',
    ]);
    await ok(await report('from=2026-07-27&to=2026-10-25', bea.cookie)); // thirteen weeks
    // Two spaces, asked for or led, are not one.
    lead(bea.id, skynet.id);
    expect(await refused(`from=${MON}&to=${SUN}&spaces=laika,skynet`)).toEqual([
      422,
      'unprocessable',
      'one_space_only',
    ]);
    expect(await refused(`from=${MON}&to=${SUN}`)).toEqual([
      422,
      'unprocessable',
      'one_space_only',
    ]);
    // Skynet holds Ada's 90 alone: a week of one person is withheld.
    const sky = (await ok(
      await report(`from=${MON}&to=${SUN}&spaces=skynet`, bea.cookie),
    )) as Weeks;
    expect(sky.weeks).toEqual([{ from: MON, to: SUN, confirmed_minutes: null, people: 1 }]);
  });

  it('refuses a space they do not lead, and one they cannot open', async () => {
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

  it('writes the same weeks as a file, and nothing else', async () => {
    const res = await report(`from=${PREV_MON}&to=${SUN}&format=csv`, bea.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="laika-time-${PREV_MON}-${SUN}.csv"`,
    );
    expect((await res.text()).split('\r\n')).toEqual([
      'week_start,week_end,space,people,confirmed_minutes',
      `${PREV_MON},${PREV_SUN},Laika,1,`,
      `${MON},${SUN},Laika,4,90`,
      '',
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
    const read = getTimeReport(h.db, actor, { from: MON, to: SUN });
    expect('rows' in read && read.rows.length).toBeGreaterThan(1);
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
