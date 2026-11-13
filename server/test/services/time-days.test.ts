import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { timeDrafts, timeEntries } from '../../src/db/schema.ts';
import { daysOf } from '../../src/services/time-days.ts';
import { freshDb, preparedDuring, seed, type TestDb } from '../helpers/db.ts';
import { hrPerson, leaveDay, manualHoliday } from '../helpers/hr.ts';

/**
 * `daysOf` (LAI-1173): one row per day of a stretch, each with the day view's
 * own state — *no signal* up to today, *future* after it, today read in the
 * zone asked for — and a dismissed draft counting for nothing, as there.
 */

// 2026-10-25 at 23:30 UTC: still the 25th in UTC, already the 26th in Johannesburg.
const NOW = Date.UTC(2026, 9, 25, 23, 30);
let t: TestDb;
let userId: string;

/** The person reading their own days, as `GET /me/time/days` does. */
function self(): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function draft(day: string, minutes: number, state: 'pending' | 'dismissed' = 'pending'): void {
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
      signals: '{}',
      state,
      createdAt: start,
      updatedAt: start,
    })
    .run();
}

function entry(day: string, minutes: number, deleted = false): void {
  const start = Date.parse(`${day}T10:00:00Z`);
  t.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      taskId: null,
      projectId: null,
      day,
      tz: 'UTC',
      minutes,
      source: 'manual',
      kind: 'work',
      createdAt: start,
      updatedAt: start,
      deletedAt: deleted ? start + 1 : null,
    })
    .run();
}

beforeEach(() => {
  t = freshDb();
  userId = seed(t.db, NOW).userId;
});

afterEach(() => {
  t.close();
});

describe('daysOf', () => {
  it('a day with nothing is no signal up to today and future after it', () => {
    const d = daysOf(
      t.db,
      self(),
      userId,
      { from: '2026-10-24', to: '2026-10-27', tz: 'UTC' },
      NOW,
    );
    expect(d.today).toBe('2026-10-25');
    expect(d.days.map((r) => [r.day, r.state])).toEqual([
      ['2026-10-24', 'no_signal'],
      ['2026-10-25', 'no_signal'],
      ['2026-10-26', 'future'],
      ['2026-10-27', 'future'],
    ]);
  });

  it('today is read in the zone asked for', () => {
    const d = daysOf(
      t.db,
      self(),
      userId,
      { from: '2026-10-26', to: '2026-10-26', tz: 'Africa/Johannesburg' },
      NOW,
    );
    expect([d.tz, d.today, d.days[0]?.state]).toEqual([
      'Africa/Johannesburg',
      '2026-10-26',
      'no_signal',
    ]);
  });

  it('a pending draft counts and a dismissed one does not', () => {
    draft('2026-10-20', 40);
    draft('2026-10-20', 25, 'dismissed');
    const d = daysOf(
      t.db,
      self(),
      userId,
      { from: '2026-10-20', to: '2026-10-20', tz: 'UTC' },
      NOW,
    );
    expect(d.days).toEqual([
      {
        day: '2026-10-20',
        state: 'drafted',
        confirmed_minutes: 0,
        drafted_minutes: 40,
        untied_minutes: 40,
        top_tasks: [
          {
            task: null,
            project: null,
            untied: true,
            confirmed_minutes: 0,
            drafted_minutes: 40,
          },
        ],
        off: null,
      },
    ]);
  });

  it('is bounded as the summary is, and refuses a zone it does not know', () => {
    expect(
      daysOf(t.db, self(), userId, { from: '2026-07-02', to: '2026-10-01' }, NOW).days,
    ).toHaveLength(92);
    expect(() =>
      daysOf(t.db, self(), userId, { from: '2026-07-01', to: '2026-10-01' }, NOW),
    ).toThrow(/at most 92 days/);
    expect(() =>
      daysOf(
        t.db,
        self(),
        userId,
        { from: '2026-10-20', to: '2026-10-20', tz: 'Mars/Olympus' },
        NOW,
      ),
    ).toThrow(/time zone/);
  });

  it('reads a stretch in two range queries, not two a day, and buckets each day exactly (LAI-1179)', () => {
    // The day before `from` and the day after `to` stay out; a deleted entry and
    // a dismissed draft count for nothing; two entries on one day add up.
    entry('2026-10-19', 30);
    entry('2026-10-20', 60);
    entry('2026-10-20', 45);
    entry('2026-10-21', 15, true);
    draft('2026-10-21', 25);
    draft('2026-10-22', 50, 'dismissed');
    entry('2026-10-23', 10);
    const prepared = preparedDuring(t.sqlite, () =>
      daysOf(t.db, self(), userId, { from: '2026-10-20', to: '2026-10-22', tz: 'UTC' }, NOW),
    );
    expect(prepared.filter((q) => q.includes('"time_entries"'))).toHaveLength(1);
    expect(prepared.filter((q) => q.includes('"time_drafts"'))).toHaveLength(1);
    const d = daysOf(
      t.db,
      self(),
      userId,
      { from: '2026-10-20', to: '2026-10-22', tz: 'UTC' },
      NOW,
    );
    expect(d.days.map((x) => [x.day, x.confirmed_minutes, x.drafted_minutes])).toEqual([
      ['2026-10-20', 105, 0],
      ['2026-10-21', 0, 25],
      ['2026-10-22', 0, 0],
    ]);
    // Ninety-two days prepare the same two statements as three days do.
    const long = preparedDuring(t.sqlite, () =>
      daysOf(t.db, self(), userId, { from: '2026-07-22', to: '2026-10-21', tz: 'UTC' }, NOW),
    );
    expect(long.filter((q) => /"time_(entries|drafts)"/.test(q))).toHaveLength(2);
  });

  it('carries each day’s holiday and leave as off, read once for the stretch (D-149, LAI-1183)', () => {
    const p = hrPerson(t.db, userId);
    manualHoliday(t.db, '2026-10-20', 'Founders’ day', userId);
    leaveDay(t.db, userId, p, '2026-10-21', { part: 'first_half', type: 'Sick' });
    leaveDay(t.db, userId, p, '2026-10-22', { status: 'pending', type: 'Annual' });
    leaveDay(t.db, userId, p, '2026-10-23', { removedAt: NOW });
    entry('2026-10-21', 240);
    const d = daysOf(
      t.db,
      self(),
      userId,
      { from: '2026-10-20', to: '2026-10-23', tz: 'UTC' },
      NOW,
    );
    expect(d.days.map((x) => [x.day, x.state, x.off])).toEqual([
      ['2026-10-20', 'no_signal', { holiday: { label: 'Founders’ day' }, leave: null }],
      [
        '2026-10-21',
        'confirmed',
        { holiday: null, leave: { part: 'first_half', status: 'approved', type: 'Sick' } },
      ],
      [
        '2026-10-22',
        'no_signal',
        { holiday: null, leave: { part: 'full', status: 'pending', type: 'Annual' } },
      ],
      ['2026-10-23', 'no_signal', null],
    ]);
    // Ninety-two days are one read of the holidays and one of the leave.
    const reader = self();
    const long = preparedDuring(t.sqlite, () =>
      daysOf(t.db, reader, userId, { from: '2026-07-22', to: '2026-10-21', tz: 'UTC' }, NOW),
    );
    expect(long.filter((q) => q.includes('"org_holidays"'))).toHaveLength(1);
    expect(long.filter((q) => q.includes('"leave_days"'))).toHaveLength(1);
  });
});
