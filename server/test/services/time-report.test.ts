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
import {
  getTimeReport,
  type SpaceWeeksReportView,
  type TimeReportAnswer,
  type TimeReportView,
} from '../../src/services/time-report.ts';
import { summaryOf } from '../../src/services/time-summary.ts';
import { freshDb, queryPlansOf, seed, type TestDb } from '../helpers/db.ts';

/**
 * The Time report's assembly (D-130, LAI-1135), below the route: one person's
 * figures equal `summaryOf`'s, drafts and untied included; a space admin's
 * weeks, and why they cannot be subtracted under the floor; what a kinds filter leaves out; and the read on an index.
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

function asPeople(answer: TimeReportAnswer): TimeReportView {
  if ('weeks' in answer) throw new Error(`expected own or people, got ${answer.scope}`);
  return answer;
}

function asWeeks(answer: TimeReportAnswer): SpaceWeeksReportView {
  if (!('weeks' in answer)) throw new Error(`expected space_totals, got ${answer.scope}`);
  return answer;
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
    const r = asPeople(
      getTimeReport(
        t.db,
        actor(owner),
        { from: MON, to: SUN, members: bea, drafts: 'include' },
        NOW,
      ),
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

describe('a space admin’s weeks (D-136)', () => {
  // Three whole ISO weeks of Laika, Monday to Sunday.
  const W = [
    { from: '2026-10-05', to: '2026-10-11' },
    { from: '2026-10-12', to: '2026-10-18' },
    { from: '2026-10-19', to: '2026-10-25' },
  ] as const;
  let lead: ResolvedActor;

  beforeEach(() => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(person);
    // Week 1: three people, 10 each. Week 2: A alone, 40. Week 3: four people, 5 each.
    for (const id of [a, b, c]) entry(id ?? '', '2026-10-06', 10, laika);
    entry(a ?? '', '2026-10-13', 40, laika);
    for (const id of [a, b, c, d]) entry(id ?? '', '2026-10-21', 5, laika);
    // Skynet, which this lead does not read, and a minute outside every week.
    for (const id of [a, b, c]) entry(id ?? '', '2026-10-13', 7, other);
    entry(a ?? '', '2026-10-26', 99, laika);
    const id = person('Lead');
    t.db
      .insert(projectMemberships)
      .values({ id: newId(), projectId: laika, userId: id, role: 'lead', createdAt: NOW })
      .run();
    lead = actor(id);
  });

  const weeks = (from: string, to: string) =>
    asWeeks(getTimeReport(t.db, lead, { from, to, spaces: 'laika' }, NOW));

  /*
   * **Why no subtraction gets under the floor** — the claim `spaceWeeks`
   * makes, held here.
   *
   * Every figure a space admin can be shown is one (space, ISO week) cell.
   * Subtraction isolates data only when one published figure covers a
   * superset of another's entries. Cells never share an entry, so that can
   * happen only if (a) a figure other than a cell is published — a total, a
   * day, a kind — or (b) one cell reads differently in two answers, as it
   * would if its value or its withholding depended on the range asked for.
   * So the test asks every range of whole weeks there is and holds:
   *
   *  1. an answer is its weeks and nothing else — no figure but the cells;
   *  2. a week reads the same in every answer that holds it — value, head
   *     count, and whether it is withheld;
   *  3. the week of one person is `null` in every one of them.
   *
   * Break either half — publish a total, or decide the floor over the range
   * — and this goes red.
   */
  it('publishes each week of one space the same way in every answer, and nothing more', () => {
    const seen = new Map<string, string>();
    for (let i = 0; i < W.length; i++) {
      for (let j = i; j < W.length; j++) {
        const r = weeks(W[i]?.from ?? '', W[j]?.to ?? '');
        expect(Object.keys(r).sort()).toEqual(['from', 'project', 'scope', 'to', 'weeks']);
        expect(r.weeks).toHaveLength(j - i + 1);
        for (const w of r.weeks) {
          expect(Object.keys(w).sort()).toEqual(['confirmed_minutes', 'from', 'people', 'to']);
          const said = JSON.stringify(w);
          expect(seen.get(w.from) ?? said, w.from).toBe(said);
          seen.set(w.from, said);
        }
      }
    }
    expect([...seen.values()].map((w) => JSON.parse(w) as unknown)).toEqual([
      { from: W[0].from, to: W[0].to, confirmed_minutes: 30, people: 3 },
      { from: W[1].from, to: W[1].to, confirmed_minutes: null, people: 1 },
      { from: W[2].from, to: W[2].to, confirmed_minutes: 20, people: 4 },
    ]);
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
    const all = asPeople(
      getTimeReport(t.db, actor(owner), { from: MON, to: SUN, drafts: 'include' }, NOW),
    );
    expect([all.totals.confirmed_minutes, all.totals.drafted_minutes, all.agent_minutes]).toEqual([
      75, 20, 10,
    ]);
    const meetings = asPeople(
      getTimeReport(
        t.db,
        actor(owner),
        { from: MON, to: SUN, drafts: 'include', kinds: 'meeting' },
        NOW,
      ),
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
