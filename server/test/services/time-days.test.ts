import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { timeDrafts } from '../../src/db/schema.ts';
import { daysOf } from '../../src/services/time-days.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * `daysOf` (LAI-1173): one row per day of a stretch, each with the day view's
 * own state — *no signal* up to today, *future* after it, today read in the
 * zone asked for — and a dismissed draft counting for nothing, as there.
 */

// 2026-10-25 at 23:30 UTC: still the 25th in UTC, already the 26th in Johannesburg.
const NOW = Date.UTC(2026, 9, 25, 23, 30);
let t: TestDb;
let userId: string;

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

beforeEach(() => {
  t = freshDb();
  userId = seed(t.db, NOW).userId;
});

afterEach(() => {
  t.close();
});

describe('daysOf', () => {
  it('a day with nothing is no signal up to today and future after it', () => {
    const d = daysOf(t.db, userId, { from: '2026-10-24', to: '2026-10-27', tz: 'UTC' }, NOW);
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
    const d = daysOf(t.db, userId, { from: '2026-10-20', to: '2026-10-20', tz: 'UTC' }, NOW);
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
      },
    ]);
  });

  it('is bounded as the summary is, and refuses a zone it does not know', () => {
    expect(daysOf(t.db, userId, { from: '2026-07-02', to: '2026-10-01' }, NOW).days).toHaveLength(
      92,
    );
    expect(() => daysOf(t.db, userId, { from: '2026-07-01', to: '2026-10-01' }, NOW)).toThrow(
      /at most 92 days/,
    );
    expect(() =>
      daysOf(t.db, userId, { from: '2026-10-20', to: '2026-10-20', tz: 'Mars/Olympus' }, NOW),
    ).toThrow(/time zone/);
  });
});
