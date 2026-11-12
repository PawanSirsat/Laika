import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor, withProject } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  analyticsViews,
  orgRoleGrants,
  projectMemberships,
  projects,
  timeDrafts,
  timeEntries,
  userAvailability,
  users,
  userTimeSettings,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { can } from '../../src/policy/can.ts';
import {
  getTimeLogging,
  TIME_LOGGING_THRESHOLD_MINUTES,
  type TimeLoggingView,
} from '../../src/services/time-logging.ts';
import { REPORT_MAX_MEMBERS } from '../../src/services/time-report.ts';
import { summaryOf } from '../../src/services/time-summary.ts';
import { freshDb, queryPlansOf, seed, type TestDb } from '../helpers/db.ts';

/**
 * The Time logging grid's assembly (D-148, LAI-1175), below the route: one
 * person's cells are their summary's days; what a cell counts and what it
 * leaves out; each person's zone, joining day and working days as served;
 * who is listed, in what order, and where the list is cut; which readers get
 * which scope; and the read on an index.
 */

/** 13:00 UTC on 12 November 2026 — already the 13th in Auckland. */
const NOW = Date.UTC(2026, 10, 12, 13);
const FROM = '2026-11-01';
const TO = '2026-11-30';

let t: TestDb;
let owner: string;
let orgId: string;
let laika: string;
let skynet: string;

function person(name: string, opts: { active?: boolean; createdAt?: number } = {}): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id.toLowerCase()}@example.test`,
      name,
      orgRole: 'member',
      isActive: opts.active === false ? 0 : 1,
      createdAt: new Date(opts.createdAt ?? Date.UTC(2026, 0, 1)),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function entry(userId: string, day: string, minutes: number, deleted = false): void {
  t.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      projectId: null,
      day,
      tz: 'UTC',
      minutes,
      source: 'manual',
      kind: 'work',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: deleted ? NOW : null,
    })
    .run();
}

function draft(
  userId: string,
  day: string,
  minutes: number,
  state: 'pending' | 'confirmed' | 'dismissed' = 'pending',
): void {
  const start = Date.parse(`${day}T09:00:00Z`);
  t.db
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
      state,
      signals: '{}',
      createdAt: start,
      updatedAt: start,
    })
    .run();
}

function member(userId: string, projectId: string, role: 'lead' | 'member' = 'member'): void {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role, createdAt: NOW })
    .run();
}

const grid = (reader: string, from = FROM, to = TO): TimeLoggingView =>
  getTimeLogging(t.db, actor(reader), { from, to }, NOW);

const row = (view: TimeLoggingView, userId: string) => {
  const p = view.people.find((x) => x.user.id === userId);
  if (p === undefined) throw new Error(`${userId} is not on the grid`);
  return p;
};

const looks = () =>
  t.db
    .select({ viewer: analyticsViews.viewerId, subject: analyticsViews.subjectId })
    .from(analyticsViews)
    .all();

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  owner = s.userId;
  orgId = s.orgId;
  laika = s.projectId;
  skynet = newId();
  t.db
    .insert(projects)
    .values({
      id: skynet,
      orgId: s.orgId,
      name: 'Skynet',
      slug: 'skynet',
      prefix: 'SKY',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
});

afterEach(() => {
  t.close();
});

describe('the cells', () => {
  it('are one person’s summary days — confirmed and drafted apart, only days with time', () => {
    const bea = person('Bea');
    entry(bea, '2026-11-03', 300);
    entry(bea, '2026-11-03', 180);
    draft(bea, '2026-11-03', 45);
    draft(bea, '2026-11-05', 90);
    entry(bea, '2026-11-20', 30);

    const s = summaryOf(t.db, bea, { from: FROM, to: TO });
    const cells = row(grid(owner), bea).days;
    expect(cells).toEqual(s.by_day.filter((d) => d.confirmed_minutes + d.drafted_minutes > 0));
    expect(cells).toEqual([
      { day: '2026-11-03', confirmed_minutes: 480, drafted_minutes: 45 },
      { day: '2026-11-05', confirmed_minutes: 0, drafted_minutes: 90 },
      { day: '2026-11-20', confirmed_minutes: 30, drafted_minutes: 0 },
    ]);
  });

  it('count a draft only while it is pending, and never a deleted entry', () => {
    const bea = person('Bea');
    draft(bea, '2026-11-03', 60, 'pending');
    draft(bea, '2026-11-03', 70, 'confirmed');
    draft(bea, '2026-11-03', 80, 'dismissed');
    entry(bea, '2026-11-04', 100, true);
    entry(bea, '2026-11-04', 20);
    expect(row(grid(owner), bea).days).toEqual([
      { day: '2026-11-03', confirmed_minutes: 0, drafted_minutes: 60 },
      { day: '2026-11-04', confirmed_minutes: 20, drafted_minutes: 0 },
    ]);
  });

  it('hold from and to, both counted, and nothing past either', () => {
    const bea = person('Bea');
    entry(bea, '2026-11-09', 10);
    entry(bea, '2026-11-10', 20);
    entry(bea, '2026-11-16', 30);
    entry(bea, '2026-11-17', 40);
    const v = grid(owner, '2026-11-10', '2026-11-16');
    expect([v.from, v.to]).toEqual(['2026-11-10', '2026-11-16']);
    expect(row(v, bea).days.map((d) => [d.day, d.confirmed_minutes])).toEqual([
      ['2026-11-10', 20],
      ['2026-11-16', 30],
    ]);
  });
});

describe('each person’s facts', () => {
  it('serves the threshold, the role, the zone, and today and the joining day in that zone', () => {
    // Joined at this very moment: already the 13th in Auckland, still the 12th in UTC.
    const kiri = person('Kiri', { createdAt: NOW });
    t.db
      .insert(userTimeSettings)
      .values({ userId: kiri, place: 'Pacific/Auckland', updatedAt: NOW })
      .run();
    // Filed on her own 13th: the cell is hers, untouched by anybody's zone.
    entry(kiri, '2026-11-13', 60);
    const v = grid(owner);
    expect(v.threshold_minutes).toBe(TIME_LOGGING_THRESHOLD_MINUTES);
    expect(v.threshold_minutes).toBe(480);
    expect(row(v, kiri)).toMatchObject({
      user: { name: 'Kiri', org_role: 'member', deactivated: false },
      zone: 'Pacific/Auckland',
      joined_day: '2026-11-13',
      today_day: '2026-11-13',
      days: [{ day: '2026-11-13', confirmed_minutes: 60, drafted_minutes: 0 }],
    });
    // No place: UTC, where it is still the 12th.
    expect(row(v, owner)).toMatchObject({
      user: { org_role: 'owner' },
      zone: 'UTC',
      today_day: '2026-11-12',
    });
  });

  it('serves the person’s working days, Monday to Friday when they set none or an empty list', () => {
    const none = person('None');
    const empty = person('Empty');
    const three = person('Three');
    t.db.insert(userAvailability).values({ userId: empty, workDays: [], updatedAt: NOW }).run();
    t.db
      .insert(userAvailability)
      .values({ userId: three, workDays: [1, 2, 3], updatedAt: NOW })
      .run();
    const v = grid(owner);
    expect(row(v, none).work_days).toEqual([1, 2, 3, 4, 5]);
    expect(row(v, empty).work_days).toEqual([1, 2, 3, 4, 5]);
    expect(row(v, three).work_days).toEqual([1, 2, 3]);
  });
});

describe('who is listed', () => {
  it('leaves a deactivated person out unless they have minutes in the stretch, then flags them', () => {
    const gone = person('Gone', { active: false });
    const was = person('Was here', { active: false });
    entry(was, '2026-11-03', 15);
    entry(gone, '2026-10-30', 15); // before the stretch
    const v = grid(owner);
    expect(v.people.some((p) => p.user.id === gone)).toBe(false);
    expect(row(v, was).user.deactivated).toBe(true);
  });

  it('lists an active person with no time at all, with no days', () => {
    const quiet = person('Quiet');
    expect(row(grid(owner), quiet).days).toEqual([]);
  });

  it('orders A–Z by name, then by id', () => {
    const c = person('Cleo');
    const a2 = person('Ada');
    const a1 = person('Ada');
    const b = person('bea');
    const [lo, hi] = [a1, a2].sort();
    // Case does not order: 'bea' sits between Ada and Cleo, before Owner.
    expect(grid(owner).people.map((p) => p.user.id)).toEqual([lo, hi, b, c, owner]);
  });

  it(`cuts the list at ${String(REPORT_MAX_MEMBERS)} A–Z, says so, and logs nobody past the cut`, () => {
    const ids = Array.from({ length: REPORT_MAX_MEMBERS + 1 }, (_, i) =>
      person(`P${String(i).padStart(3, '0')}`),
    );
    const v = grid(owner);
    expect(v.people).toHaveLength(REPORT_MAX_MEMBERS);
    expect(v.truncated).toBe(true);
    // 'Owner' sorts before every 'P…', so the last two P's are the ones cut.
    const cut = ids.slice(-2);
    expect(v.people.some((p) => cut.includes(p.user.id))).toBe(false);
    const logged = new Set(looks().map((l) => l.subject));
    expect(logged.size).toBe(REPORT_MAX_MEMBERS - 1);
    expect(cut.some((id) => logged.has(id))).toBe(false);
    expect(logged.has(owner)).toBe(false);
  });
});

describe('scope', () => {
  it('a space admin: the people of the spaces they lead and themselves, nobody else', () => {
    const lead = person('Lead');
    const inLaika = person('In Laika');
    const inSkynet = person('In Skynet');
    const nowhere = person('Nowhere');
    member(lead, laika, 'lead');
    member(inLaika, laika);
    member(inSkynet, skynet);
    entry(nowhere, '2026-11-03', 480);
    const v = grid(lead);
    expect(v.scope).toBe('lead');
    expect(v.people.map((p) => p.user.id).sort()).toEqual([inLaika, lead].sort());
    // The owner is an implicit lead, not a member row: not listed to a lead.
    expect(v.people.some((p) => p.user.id === owner)).toBe(false);
    expect(looks()).toEqual([{ viewer: lead, subject: inLaika }]);
  });

  it('a space admin sees each person’s whole day, whichever spaces the time was on', () => {
    const lead = person('Lead');
    const cleo = person('Cleo');
    member(lead, laika, 'lead');
    member(cleo, laika);
    member(cleo, skynet);
    // Cleo's Monday: three hours on Laika, five on Skynet, which Lead does not lead.
    t.db
      .insert(timeEntries)
      .values([
        {
          id: newId(),
          userId: cleo,
          projectId: laika,
          day: '2026-11-02',
          tz: 'UTC',
          minutes: 180,
          source: 'manual',
          kind: 'work',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: newId(),
          userId: cleo,
          projectId: skynet,
          day: '2026-11-02',
          tz: 'UTC',
          minutes: 300,
          source: 'manual',
          kind: 'work',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ])
      .run();
    const v = grid(lead);
    expect(v.scope).toBe('lead');
    expect(row(v, cleo).days).toEqual([
      { day: '2026-11-02', confirmed_minutes: 480, drafted_minutes: 0 },
    ]);
  });

  it('an implicit lead is not a space admin here: an admin without analytics who leads nothing by row is 403', () => {
    // An admin holds implicit lead over every space through `open_all_projects`,
    // and *See everyone's analytics* by default. Take the second away.
    const admin = person('Admin');
    t.db.update(users).set({ orgRole: 'admin' }).where(eq(users.id, admin)).run();
    t.db
      .insert(orgRoleGrants)
      .values({
        orgId,
        orgRole: 'admin',
        capability: 'see_people_analytics',
        granted: 0,
        setBy: owner,
        updatedAt: NOW,
      })
      .run();
    const other = person('Other');
    member(other, laika);
    expect(can(actor(admin), 'time.report.read')).toBe(false);
    expect(
      can(withProject(actor(admin), laika), 'time.days.read_project', { projectId: laika }),
    ).toBe(true);
    let thrown: unknown;
    try {
      grid(admin);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).details).toMatchObject({ action: 'time.report.read' });
    expect(looks()).toEqual([]);
    // A lead membership row on Laika opens Laika's people, and nobody else's.
    member(admin, laika, 'lead');
    const elsewhere = person('Elsewhere');
    member(elsewhere, skynet);
    const v = grid(admin);
    expect(v.scope).toBe('lead');
    expect(v.people.map((p) => p.user.id).sort()).toEqual([admin, other].sort());
  });

  it('an owner who also leads a space reads everyone', () => {
    member(owner, laika, 'lead');
    const elsewhere = person('Elsewhere');
    const v = grid(owner);
    expect(v.scope).toBe('people');
    expect(v.people.some((p) => p.user.id === elsewhere)).toBe(true);
  });

  it('a member who leads nothing is 403 by time.report.read, and nothing is logged', () => {
    const bea = person('Bea');
    member(bea, laika);
    let thrown: unknown;
    try {
      grid(bea);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).code).toBe('forbidden');
    expect((thrown as ApiError).details).toMatchObject({ action: 'time.report.read' });
    expect(looks()).toEqual([]);
  });
});

describe('the read', () => {
  it('reads entries and drafts on an index, never a scan: the day index for everyone, (user, day) for a space’s people', () => {
    entry(owner, '2026-11-03', 30);
    draft(owner, '2026-11-03', 30);
    const lead = person('Lead');
    member(lead, laika, 'lead');
    for (const table of ['time_entries', 'time_drafts'] as const) {
      const everyone = queryPlansOf(t.sqlite, table, () => grid(owner));
      expect(everyone.length).toBeGreaterThan(0);
      for (const plan of everyone) {
        expect(plan).toMatch(new RegExp(`USING (COVERING )?INDEX ${table}_day_idx`));
        expect(plan).not.toMatch(new RegExp(`SCAN ${table}(?! USING)`));
      }
      const led = queryPlansOf(t.sqlite, table, () => grid(lead));
      expect(led.length).toBeGreaterThan(0);
      for (const plan of led) {
        expect(plan).toMatch(new RegExp(`USING (COVERING )?INDEX ${table}_user_day_idx`));
        expect(plan).not.toMatch(new RegExp(`SCAN ${table}(?! USING)`));
      }
    }
  });
});
