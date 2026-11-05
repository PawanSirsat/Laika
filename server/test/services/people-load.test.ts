import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { analyticsViews, orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { type OrgGrants } from '../../src/policy/grants.ts';
import { addAwayPeriod, setMyAvailability } from '../../src/services/availability.ts';
import {
  type AvailabilityRowView,
  getPersonLoad,
  listPeopleAvailability,
} from '../../src/services/people-load.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { createTask } from '../../src/services/tasks.ts';
import { createEntry } from '../../src/services/time-entries.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import { summaryOf } from '../../src/services/time-summary.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Who has room (SPEC §6.4, D-131, LAI-1130): one person's load, read by an
 * owner or admin and logged, and the availability list in its three reader
 * shapes — A–Z, deactivated people and org viewers left out, hours only with
 * *See everyone's analytics*, no hours for a space's lead.
 */

const DAY = 86_400_000;
// Wednesday 21 October 2026, 15:00 UTC.
const NOW = Date.UTC(2026, 9, 21, 15);
const TODAY_MS = Date.UTC(2026, 9, 21);

let t: TestDb;
let ada: string; // owner
let ari: string; // admin
let bea: string; // member, lead of Laika, member of Orbit — the person read
let cal: string; // member of Laika
let dee: string; // member of Orbit only
let vic: string; // org viewer, in Laika
let zed: string; // deactivated, in Laika

function makeUser(name: string, orgRole: OrgRole, isActive = 1): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      isActive,
      createdAt: new Date(NOW - 30 * DAY),
      updatedAt: new Date(NOW - 30 * DAY),
    })
    .run();
  return id;
}

function actor(userId: string, extra: Partial<ResolvedActor> = {}): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return { ...loaded, ...extra };
}

function refusal(fn: () => unknown): { code: string; details: unknown } | string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return { code: err.code, details: err.details };
    throw err;
  }
  return 'no error';
}

function views() {
  return t.db.select().from(analyticsViews).all();
}

function card(slug: string, status: string, dueOn?: number): void {
  createTask(t.sqlite, t.db, actor(ada), slug, {
    title: `${slug} ${status}`,
    status: status as 'todo',
    assignee_id: bea,
    ...(dueOn === undefined ? {} : { due_on: dueOn }),
  });
}

/** An admin who sees analytics but does not open every space. */
const ANALYTICS_ONLY: OrgGrants = { admin: ['see_people_analytics'], member: [], viewer: [] };

beforeEach(() => {
  t = freshDb();
  ada = makeUser('Ada', 'owner');
  // Made out of order, so A–Z is the service's doing.
  dee = makeUser('Dee', 'member');
  cal = makeUser('Cal', 'member');
  bea = makeUser('Bea', 'member');
  ari = makeUser('Ari', 'admin');
  vic = makeUser('Vic', 'viewer');
  zed = makeUser('Zed', 'member', 0);
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: ada, createdAt: NOW, updatedAt: NOW })
    .run();
  createProject(t.sqlite, t.db, actor(ada), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
  createProject(t.sqlite, t.db, actor(ada), { name: 'Orbit', slug: 'orbit', prefix: 'ORB' });
  addMember(t.db, actor(ada), 'laika', bea, 'lead');
  addMember(t.db, actor(ada), 'orbit', bea, 'member');
  addMember(t.db, actor(ada), 'laika', cal, 'member');
  addMember(t.db, actor(ada), 'orbit', dee, 'member');
  addMember(t.db, actor(ada), 'laika', vic, 'viewer');
  addMember(t.db, actor(ada), 'laika', zed, 'member');
  addMember(t.db, actor(ada), 'laika', ari, 'member');
  setOrgTimeMode(t.db, actor(ada), 'manual');
});
afterEach(() => {
  t.close();
});

describe('GET /people/:id/load', () => {
  beforeEach(() => {
    const me = actor(bea);
    // Two days ago on Laika, today on Orbit, today on no space, and one outside
    // the 14-day window that must not count.
    createEntry(t.db, me, { day: '2026-10-19', tz: 'UTC', minutes: 90, project: 'laika' }, NOW);
    createEntry(t.db, me, { day: '2026-10-21', tz: 'UTC', minutes: 30, project: 'orbit' }, NOW);
    createEntry(t.db, me, { day: '2026-10-21', tz: 'UTC', minutes: 15 }, NOW);
    createEntry(t.db, me, { day: '2026-10-01', tz: 'UTC', minutes: 600, project: 'laika' }, NOW);
  });

  it('gives 14-day minutes by space equal to summaryOf’s by_project, and logs one look', () => {
    const load = getPersonLoad(t.db, actor(ada), bea, NOW);
    const summary = summaryOf(t.db, bea, { from: '2026-10-08', to: '2026-10-21' });
    const byId = (rows: { project: { id: string } | null; confirmed_minutes: number }[]) =>
      Object.fromEntries(rows.map((r) => [r.project?.id ?? '', r.confirmed_minutes]));
    expect(byId(load.projects)).toEqual(byId(summary.by_project));
    expect(load.projects).toEqual([
      expect.objectContaining({
        project: expect.objectContaining({ slug: 'laika' }) as unknown,
        role: 'lead',
        confirmed_minutes: 90,
        hidden: false,
      }),
      expect.objectContaining({
        project: expect.objectContaining({ slug: 'orbit' }) as unknown,
        role: 'member',
        confirmed_minutes: 30,
        hidden: false,
      }),
      { project: null, hidden: false, role: null, confirmed_minutes: 15, drafted_minutes: 0 },
    ]);
    expect(views()).toEqual([
      expect.objectContaining({ viewerId: ada, subjectId: bea, kind: 'time', day: null }),
    ]);
  });

  it('folds the spaces the reader cannot open into one hidden row', () => {
    const reader = actor(ari, { orgGrants: ANALYTICS_ONLY });
    const load = getPersonLoad(t.db, reader, bea, NOW);
    expect(
      load.projects.map((p) => [p.project?.slug ?? null, p.hidden, p.confirmed_minutes]),
    ).toEqual([
      ['laika', false, 90],
      [null, false, 15],
      [null, true, 30],
    ]);
    expect(JSON.stringify(load)).not.toContain('Orbit');
  });

  it('counts cards in spaces the reader opens, due_7d from the reader’s UTC day', () => {
    card('laika', 'in_progress');
    card('laika', 'review');
    card('laika', 'todo', TODAY_MS); // due today: counted
    card('laika', 'todo', TODAY_MS + 6 * DAY); // the seventh day: counted
    card('laika', 'todo', TODAY_MS + 7 * DAY); // the eighth: not
    card('laika', 'todo', TODAY_MS - DAY); // overdue: not
    card('laika', 'done', TODAY_MS + DAY); // done: not
    card('orbit', 'in_progress');

    expect(getPersonLoad(t.db, actor(ada), bea, NOW).cards).toEqual({
      in_progress: 2,
      in_review: 1,
      due_7d: 2,
    });
    // Ari opens Laika only.
    expect(
      getPersonLoad(t.db, actor(ari, { orgGrants: ANALYTICS_ONLY }), bea, NOW).cards.in_progress,
    ).toBe(1);
  });

  it('puts this week beside the set working minutes, two numbers and no free hours', () => {
    setMyAvailability(
      t.db,
      actor(bea),
      { status: 'open', work_week: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } },
      NOW,
    );
    addAwayPeriod(t.db, actor(bea), { from: '2026-11-02', to: '2026-11-06' }, NOW);
    const load = getPersonLoad(t.db, actor(ada), bea, NOW);
    // Monday 19 to Sunday 25 October: 90 + 30 + 15.
    expect(load.week).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
      confirmed_minutes: 135,
      drafted_minutes: 0,
      set_minutes: 2400,
    });
    expect(load.away).toEqual([{ from: '2026-11-02', to: '2026-11-06' }]);
    expect(JSON.stringify(load)).not.toMatch(/free/i);
  });

  it('refuses yourself, a member and a token, and 404s nobody — writing no look', () => {
    expect(refusal(() => getPersonLoad(t.db, actor(ada), ada, NOW))).toMatchObject({
      code: 'forbidden',
    });
    expect(refusal(() => getPersonLoad(t.db, actor(cal), bea, NOW))).toMatchObject({
      code: 'forbidden',
      details: expect.objectContaining({ action: 'people.analytics.read' }) as unknown,
    });
    const token = actor(ada, { token: { id: 'tok', scope: 'full', projectIds: null } });
    expect(refusal(() => getPersonLoad(t.db, token, bea, NOW))).toMatchObject({
      code: 'forbidden',
      details: expect.objectContaining({ reason: 'session_required' }) as unknown,
    });
    expect(refusal(() => getPersonLoad(t.db, actor(ada), 'nobody', NOW))).toMatchObject({
      code: 'not_found',
    });
    expect(views()).toEqual([]);
  });

  it('answers a person who set nothing with nulls and empty lists', () => {
    const load = getPersonLoad(t.db, actor(ada), cal, NOW);
    expect(load.availability).toBeNull();
    expect(load.away).toEqual([]);
    expect(load.week.set_minutes).toBeNull();
    expect(load.cards).toEqual({ in_progress: 0, in_review: 0, due_7d: 0 });
    expect(load.projects).toEqual([
      expect.objectContaining({ role: 'member', confirmed_minutes: 0, drafted_minutes: 0 }),
    ]);
  });
});

describe('GET /people/availability', () => {
  const names = (rows: AvailabilityRowView[]) => rows.map((r) => r.user.name);

  beforeEach(() => {
    createEntry(
      t.db,
      actor(bea),
      { day: '2026-10-20', tz: 'UTC', minutes: 120, project: 'laika' },
      NOW,
    );
    card('laika', 'in_progress');
    card('orbit', 'in_progress');
  });

  it('gives an owner every active non-viewer, A–Z, with hours — and logs each look', () => {
    const { data } = listPeopleAvailability(t.db, actor(ada), {}, NOW);
    expect(names(data)).toEqual(['Ada', 'Ari', 'Bea', 'Cal', 'Dee']);
    const beaRow = data.find((r) => r.user.id === bea);
    expect(beaRow).toMatchObject({ in_progress: 2, last_2_weeks_minutes: 120 });
    expect(beaRow?.spaces.map((s) => s.slug)).toEqual(['laika', 'orbit']);
    // Every person listed but the reader, once each.
    expect(
      views()
        .map((v) => v.subjectId)
        .sort(),
    ).toEqual([ari, bea, cal, dee].sort());
    expect(views().every((v) => v.viewerId === ada && v.kind === 'time')).toBe(true);
  });

  it('gives a space’s lead the people of their spaces, card counts only, no hours field', () => {
    const { data } = listPeopleAvailability(t.db, actor(bea), {}, NOW);
    expect(names(data)).toEqual(['Ada', 'Ari', 'Bea', 'Cal']);
    for (const row of data) {
      expect('last_2_weeks_minutes' in row, row.user.name).toBe(false);
      expect(typeof row.in_progress).toBe('number');
    }
    // Counted in Laika only, which Bea leads — not her Orbit card.
    expect(data.find((r) => r.user.id === bea)?.in_progress).toBe(1);
    expect(views()).toEqual([]);
  });

  it('gives anyone else the people who share a space, status and spaces only', () => {
    const cals = listPeopleAvailability(t.db, actor(cal), {}, NOW).data;
    expect(names(cals)).toEqual(['Ada', 'Ari', 'Bea', 'Cal']);
    for (const row of cals)
      expect(Object.keys(row).sort()).toEqual(['availability', 'spaces', 'user']);
    // Dee shares only Orbit, which Cal is not in.
    expect(names(listPeopleAvailability(t.db, actor(dee), {}, NOW).data)).toEqual([
      'Ada',
      'Bea',
      'Dee',
    ]);
    expect(views()).toEqual([]);
  });

  it('never lists a deactivated person or an org viewer', () => {
    const ids = listPeopleAvailability(t.db, actor(ada), {}, NOW).data.map((r) => r.user.id);
    expect(ids).not.toContain(zed);
    expect(ids).not.toContain(vic);
  });

  it('filters by space, tag and open_only — away people are not open', () => {
    setMyAvailability(t.db, actor(bea), { status: 'open', tags: ['Payments'] }, NOW);
    setMyAvailability(t.db, actor(cal), { status: 'open', tags: ['payments'] }, NOW);
    setMyAvailability(t.db, actor(dee), { status: 'capacity', tags: ['ios'] }, NOW);
    addAwayPeriod(t.db, actor(cal), { from: '2026-10-20', to: '2026-10-22' }, NOW);

    const list = (q: Parameters<typeof listPeopleAvailability>[2]) =>
      names(listPeopleAvailability(t.db, actor(ada), q, NOW).data);
    expect(list({ space: 'orbit' })).toEqual(['Ada', 'Bea', 'Dee']);
    expect(list({ tag: 'PAYMENTS' })).toEqual(['Bea', 'Cal']);
    expect(list({ open_only: true })).toEqual(['Bea']);
    expect(refusal(() => list({ space: 'nope' }))).toMatchObject({ code: 'not_found' });
    // A space the reader cannot open is the same 404.
    expect(
      refusal(() => listPeopleAvailability(t.db, actor(cal), { space: 'orbit' }, NOW)),
    ).toMatchObject({ code: 'not_found' });
  });

  it('is refused to a token', () => {
    const token = actor(cal, { token: { id: 'tok', scope: 'read_only', projectIds: null } });
    expect(refusal(() => listPeopleAvailability(t.db, token, {}, NOW))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('answers a fresh space with availability null on every row', () => {
    const { data } = listPeopleAvailability(t.db, actor(cal), {}, NOW);
    expect(data.every((r) => r.availability === null)).toBe(true);
    expect(t.db.select().from(users).where(eq(users.id, cal)).get()?.name).toBe('Cal');
  });
});
