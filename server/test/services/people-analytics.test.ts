import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { analyticsViews, localActivityDays, timeDrafts, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { type OrgGrants } from '../../src/policy/grants.ts';
import { getOwnLocalActivity } from '../../src/services/local-activity.ts';
import { getMyDay } from '../../src/services/my-day.ts';
import { getPeopleActivity } from '../../src/services/people-activity.ts';
import { getPersonDay, getPersonLocalActivity } from '../../src/services/people-analytics.ts';
import { createEntry } from '../../src/services/time-entries.ts';
import { setOrgTimeMode, setTimeSettings } from '../../src/services/time-settings.ts';
import { getPersonUsage } from '../../src/services/token-usage.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * An owner or admin reading a person's analytics the way the person reads
 * them (D-102 rules 1–4, LAI-957): the same shape from the same assembly,
 * `can()` first, one view-log row per read. The log itself — its
 * transaction, the person's list, retention — is `analytics-views.test.ts`.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Wednesday 21 October 2026, 15:00 UTC.
const NOW = Date.UTC(2026, 9, 21, 15);
const TODAY = '2026-10-21';

let t: TestDb;
let owner: string;
let admin: string;
let bea: string;
let vic: string;

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
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

function withToken(userId: string): ResolvedActor {
  return actor(userId, { token: { id: 'tok_x', scope: 'full', projectIds: null } });
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

function draft(userId: string, day: string, minutes: number, startHour: number): void {
  const start = Date.parse(`${day}T00:00:00Z`) + startHour * HOUR;
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
      signals: JSON.stringify({ prompts: 4, replies: 12, sessions: 1, commits: 0, marks: 1 }),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function localDay(userId: string, day: string, sessions: number): void {
  t.db
    .insert(localActivityDays)
    .values({ userId, day, collectorId: 'c', sessions, commitsLocal: 2, tz: 'UTC', updatedAt: NOW })
    .run();
}

const NO_GRANTS: OrgGrants = { admin: [], member: [], viewer: [] };
const MEMBER_ANALYTICS: OrgGrants = {
  admin: ['see_people_analytics'],
  member: ['see_people_analytics'],
  viewer: [],
};

beforeEach(() => {
  t = freshDb();
  owner = seed(t.db, NOW - 30 * DAY).userId;
  admin = makeUser('Ari', 'admin');
  bea = makeUser('Bea', 'member');
  vic = makeUser('Vic', 'viewer');
  setOrgTimeMode(t.db, actor(owner), 'drafts', NOW);
  setTimeSettings(t.db, actor(bea), { draft_my_time: true }, NOW);
  draft(bea, TODAY, 90, 9);
  draft(bea, '2026-10-20', 30, 13);
  createEntry(t.db, actor(bea), { day: TODAY, tz: 'UTC', minutes: 45, note: 'Client call' }, NOW);
  localDay(bea, TODAY, 3);
  localDay(bea, '2026-10-19', 1);
});

afterEach(() => {
  t.close();
});

describe('the same shape the person reads (D-102 rule 1)', () => {
  it("answers an owner and an admin with the person's own My day, drafts included", () => {
    const own = getMyDay(t.db, actor(bea), { day: TODAY, tz: 'UTC' }, NOW);
    expect(own.drafts.map((d) => d.minutes)).toEqual([90]);
    expect(own.entries.map((e) => e.minutes)).toEqual([45]);
    for (const reader of [owner, admin]) {
      expect(getPersonDay(t.db, actor(reader), bea, { day: TODAY, tz: 'UTC' }, NOW)).toEqual(own);
    }
  });

  it("defaults the zone and the day to the person's, as /me/time does", () => {
    expect(getPersonDay(t.db, actor(owner), bea, {}, NOW)).toEqual(
      getMyDay(t.db, actor(bea), {}, NOW),
    );
  });

  it('answers their held local activity exactly as /me/local-activity does', () => {
    const own = getOwnLocalActivity(t.db, actor(bea), 14, NOW);
    expect(own.days.map((d) => [d.day, d.sessions])).toEqual([
      [TODAY, 3],
      ['2026-10-19', 1],
    ]);
    expect(getPersonLocalActivity(t.db, actor(admin), bea, 14, NOW)).toEqual(own);
  });
});

describe('who may ask (§3.1 "View a member\'s day, time and shared activity")', () => {
  it('refuses a member and a viewer, about anyone', () => {
    for (const reader of [bea, vic]) {
      expect(refusal(() => getPersonDay(t.db, actor(reader), admin, {}, NOW))).toEqual({
        code: 'forbidden',
        details: { action: 'people.analytics.read' },
      });
      expect(refusal(() => getPersonLocalActivity(t.db, actor(reader), admin, 14, NOW))).toEqual({
        code: 'forbidden',
        details: { action: 'people.analytics.read' },
      });
    }
  });

  it('refuses every token, an owner’s included, and says a session is what is missing', () => {
    expect(refusal(() => getPersonDay(t.db, withToken(owner), bea, {}, NOW))).toEqual({
      code: 'forbidden',
      details: { action: 'people.analytics.read', reason: 'session_required' },
    });
  });

  it('refuses a read of themselves — their own is /me', () => {
    for (const reader of [owner, admin]) {
      expect(refusal(() => getPersonDay(t.db, actor(reader), reader, {}, NOW))).toEqual({
        code: 'forbidden',
        details: { action: 'people.analytics.read' },
      });
    }
  });

  it('asks before it looks: an unknown id is not_found only to someone who may ask', () => {
    expect(refusal(() => getPersonDay(t.db, actor(owner), 'nobody', {}, NOW))).toMatchObject({
      code: 'not_found',
    });
    expect(refusal(() => getPersonDay(t.db, actor(bea), 'nobody', {}, NOW))).toMatchObject({
      code: 'forbidden',
    });
  });

  it("follows the owner's grants: an admin without the grant is refused, a granted member is answered", () => {
    expect(
      refusal(() => getPersonDay(t.db, actor(admin, { orgGrants: NO_GRANTS }), bea, {}, NOW)),
    ).toEqual({ code: 'forbidden', details: { action: 'people.analytics.read' } });
    expect(
      refusal(() =>
        getPersonLocalActivity(t.db, actor(admin, { orgGrants: NO_GRANTS }), bea, 14, NOW),
      ),
    ).toEqual({ code: 'forbidden', details: { action: 'people.analytics.read' } });
    // The owner holds it whatever the matrix says.
    expect(
      getPersonDay(t.db, actor(owner, { orgGrants: NO_GRANTS }), bea, { day: TODAY }, NOW).day,
    ).toBe(TODAY);

    const granted = actor(bea, { orgGrants: MEMBER_ANALYTICS });
    expect(getPersonDay(t.db, granted, admin, { day: TODAY }, NOW).day).toBe(TODAY);
    // A grant never reaches the viewer column it was not given to.
    expect(
      refusal(() => getPersonDay(t.db, actor(vic, { orgGrants: MEMBER_ANALYTICS }), bea, {}, NOW)),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('every read is logged (D-102 rule 3)', () => {
  it('writes one row per read: who, whom, what and which day', () => {
    getPersonDay(t.db, actor(admin), bea, { day: TODAY, tz: 'UTC' }, NOW);
    getPersonDay(t.db, actor(owner), bea, { day: '2026-10-20', tz: 'UTC' }, NOW + 1);
    getPersonLocalActivity(t.db, actor(owner), bea, 14, NOW + 2);

    expect(
      views()
        .sort((a, b) => a.viewedAt - b.viewedAt)
        .map((v) => [v.viewerId, v.subjectId, v.kind, v.day, v.viewedAt]),
    ).toEqual([
      [admin, bea, 'time', TODAY, NOW],
      [owner, bea, 'time', '2026-10-20', NOW + 1],
      [owner, bea, 'local_activity', null, NOW + 2],
    ]);
  });

  it('logs the heatmap and the per-person tokens read for somebody else', () => {
    getPeopleActivity(t.db, actor(admin), bea, '12w', NOW);
    getPersonUsage(t.db, actor(owner), bea, NOW + 1);
    expect(views().map((v) => [v.viewerId, v.subjectId, v.kind, v.day])).toEqual([
      [admin, bea, 'activity', null],
      [owner, bea, 'usage', null],
    ]);
  });

  it('logs nothing for a person reading their own', () => {
    getMyDay(t.db, actor(bea), {}, NOW);
    getOwnLocalActivity(t.db, actor(bea), 14, NOW);
    getPersonUsage(t.db, actor(bea), bea, NOW);
    getPeopleActivity(t.db, actor(owner), owner, '12w', NOW);
    expect(views()).toEqual([]);
  });

  it('logs nothing for a read that was refused or failed', () => {
    refusal(() => getPersonDay(t.db, actor(bea), admin, {}, NOW));
    refusal(() => getPersonDay(t.db, actor(owner), 'nobody', {}, NOW));
    expect(
      refusal(() => getPersonDay(t.db, actor(owner), bea, { tz: 'Not/AZone' }, NOW)),
    ).toMatchObject({ code: 'unprocessable' });
    expect(
      refusal(() => getPersonDay(t.db, actor(owner), bea, { day: '21-10-2026' }, NOW)),
    ).toMatchObject({ code: 'unprocessable' });
    expect(views()).toEqual([]);
  });

  it('answers no read whose log cannot be written', () => {
    t.sqlite.exec('DROP TABLE analytics_views');
    expect(() => getPersonDay(t.db, actor(owner), bea, {}, NOW)).toThrow(/analytics_views/);
    expect(() => getPersonLocalActivity(t.db, actor(owner), bea, 14, NOW)).toThrow(
      /analytics_views/,
    );
  });
});
