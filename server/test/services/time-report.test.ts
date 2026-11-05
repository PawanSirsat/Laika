import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  agentTimeDays,
  projectMemberships,
  projects,
  timeDrafts,
  timeEntries,
  users,
} from '../../src/db/schema.ts';
import { getTimeReport, REPORT_FLOOR_PEOPLE } from '../../src/services/time-report.ts';
import { summaryOf } from '../../src/services/time-summary.ts';
import { freshDb, queryPlansOf, seed, type TestDb } from '../helpers/db.ts';

/**
 * The Time report's assembly (D-130, LAI-1135), below the route: one person's
 * figures equal `summaryOf`'s, drafts and untied included; the floor at its
 * edge; what a kinds filter leaves out; and the read on an index.
 */

const NOW = Date.UTC(2026, 9, 26, 12);
const MON = '2026-10-19';
const SUN = '2026-10-25';

let t: TestDb;
let owner: string;
let laika: string;
let other: string;

function person(name: string): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole: 'member',
      createdAt: new Date(NOW),
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

function entry(
  userId: string,
  day: string,
  minutes: number,
  projectId: string | null,
  kind = 'work',
) {
  t.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      projectId,
      day,
      tz: 'UTC',
      minutes,
      source: 'draft',
      kind: kind as 'work',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function draft(
  userId: string,
  day: string,
  minutes: number,
  projectId: string | null,
  general = 0,
) {
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
      projectId,
      general,
      signals: '{}',
      createdAt: start,
      updatedAt: start,
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  owner = s.userId;
  laika = s.projectId;
  other = newId();
  t.db
    .insert(projects)
    .values({
      id: other,
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

describe('one person’s report is their summary', () => {
  it('matches summaryOf: totals, every day, every space, drafts untied and general apart', () => {
    const bea = person('Bea');
    entry(bea, '2026-10-20', 40, laika);
    entry(bea, '2026-10-21', 15, null, 'meeting');
    entry(bea, '2026-10-21', 25, other);
    draft(bea, '2026-10-22', 30, null); // untied: on nothing, not general
    draft(bea, '2026-10-22', 20, null, 1); // general: on nothing on purpose
    draft(bea, '2026-10-23', 10, laika);
    // Outside the stretch, and somebody else's: neither counts.
    entry(bea, '2026-10-26', 99, laika);
    entry(owner, '2026-10-20', 77, laika);

    const s = summaryOf(t.db, bea, { from: MON, to: SUN });
    const r = getTimeReport(
      t.db,
      actor(owner),
      { from: MON, to: SUN, members: bea, drafts: 'include' },
      NOW,
    );
    expect(r.scope).toBe('people');
    expect(r.totals).toEqual({
      confirmed_minutes: s.confirmed_minutes,
      drafted_minutes: s.drafted_minutes,
      meeting_minutes: s.meeting_minutes,
      manual_minutes: s.manual_minutes,
      active_days: s.active_days,
      people: 1,
    });
    expect([r.totals.confirmed_minutes, r.totals.drafted_minutes]).toEqual([80, 60]);
    expect(r.by_day).toEqual(s.by_day);
    const untied = (rows: { untied: boolean; drafted_minutes: number }[]) =>
      rows.filter((x) => x.untied).reduce((n, x) => n + x.drafted_minutes, 0);
    expect(untied(r.rows)).toBe(untied(s.by_task));
    // The 30 on nothing and the 10 on a space with no task; the general 20 is not.
    expect(untied(r.rows)).toBe(40);
  });
});

describe('the floor (D-088 item 7)', () => {
  function asLead(): ResolvedActor {
    const lead = person('Lead');
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId: laika, userId: lead, role: 'lead', createdAt: NOW })
      .run();
    return actor(lead);
  }

  it(`keeps a space with exactly ${String(REPORT_FLOOR_PEOPLE)} people, and folds one with fewer`, () => {
    const a = person('A');
    const b = person('B');
    for (const id of [a, b]) entry(id, '2026-10-20', 10, laika);
    const lead = asLead();

    const two = getTimeReport(t.db, lead, { from: MON, to: SUN }, NOW);
    expect(two.rows.map((x) => [x.project?.slug ?? null, x.confirmed_minutes])).toEqual([
      [null, 20],
    ]);
    expect(two.folded).toEqual({ tasks: 0, spaces: 1, minutes: 20 });

    entry(person('C'), '2026-10-21', 10, laika);
    const three = getTimeReport(t.db, lead, { from: MON, to: SUN }, NOW);
    expect(three.rows.map((x) => [x.project?.slug ?? null, x.confirmed_minutes])).toEqual([
      ['laika', 30],
    ]);
    expect(three.folded).toEqual({ tasks: 0, spaces: 0, minutes: 0 });
    expect(three.totals.people).toBe(3);
  });
});

describe('narrowing', () => {
  it('a kinds filter holds no drafts, and leaves agent minutes unsaid', () => {
    entry(owner, '2026-10-20', 30, laika, 'meeting');
    entry(owner, '2026-10-20', 45, laika, 'work');
    draft(owner, '2026-10-20', 20, laika);
    t.db
      .insert(agentTimeDays)
      .values({
        userId: owner,
        day: '2026-10-20',
        sessionKey: 's',
        kind: 'cli',
        seconds: 600,
        updatedAt: NOW,
      })
      .run();
    const all = getTimeReport(t.db, actor(owner), { from: MON, to: SUN, drafts: 'include' }, NOW);
    expect([all.totals.confirmed_minutes, all.totals.drafted_minutes, all.agent_minutes]).toEqual([
      75, 20, 10,
    ]);
    const meetings = getTimeReport(
      t.db,
      actor(owner),
      { from: MON, to: SUN, drafts: 'include', kinds: 'meeting' },
      NOW,
    );
    expect([
      meetings.totals.confirmed_minutes,
      meetings.totals.drafted_minutes,
      meetings.agent_minutes,
    ]).toEqual([30, 0, null]);
  });
});

describe('the read', () => {
  it('reads time_entries on an index, never a scan of the table', () => {
    entry(owner, '2026-10-20', 30, laika);
    const plans = queryPlansOf(t.sqlite, 'time_entries', () =>
      getTimeReport(t.db, actor(owner), { from: MON, to: SUN }, NOW),
    );
    for (const plan of plans) {
      expect(plan).toMatch(/USING (COVERING )?INDEX time_entries_/);
      expect(plan).not.toMatch(/SCAN time_entries(?! USING)/);
    }
  });
});
