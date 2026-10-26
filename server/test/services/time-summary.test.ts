import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { timeDrafts } from '../../src/db/schema.ts';
import { SUMMARY_MAX_DAYS, summaryOf } from '../../src/services/time-summary.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * `summaryOf` (LAI-526): a stretch of days, both ends kept, never backwards,
 * never longer than a quarter; an empty stretch is zeros on every day, not
 * nothing; a pending draft counts and a dismissed one does not.
 */

const NOW = Date.UTC(2026, 9, 25, 12);
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

describe('summaryOf', () => {
  it('an empty stretch is every day at zero, not nothing', () => {
    const s = summaryOf(t.db, userId, { from: '2026-10-19', to: '2026-10-21' });
    expect(s.by_day.map((d) => [d.day, d.confirmed_minutes, d.drafted_minutes])).toEqual([
      ['2026-10-19', 0, 0],
      ['2026-10-20', 0, 0],
      ['2026-10-21', 0, 0],
    ]);
    expect([s.days, s.active_days, s.by_project.length, s.by_kind.length]).toEqual([3, 0, 0, 0]);
  });

  it('a pending draft counts and a dismissed one does not', () => {
    draft('2026-10-20', 40);
    draft('2026-10-20', 25, 'dismissed');
    const s = summaryOf(t.db, userId, { from: '2026-10-20', to: '2026-10-20' });
    expect([s.drafted_minutes, s.active_days]).toEqual([40, 1]);
    expect(s.by_kind).toEqual([{ kind: null, minutes: 40 }]);
  });

  it(`covers at most ${String(SUMMARY_MAX_DAYS)} days, ends kept, never backwards`, () => {
    expect(summaryOf(t.db, userId, { from: '2026-07-02', to: '2026-10-01' }).days).toBe(92);
    expect(() => summaryOf(t.db, userId, { from: '2026-07-01', to: '2026-10-01' })).toThrow(
      /at most 92 days/,
    );
    expect(() => summaryOf(t.db, userId, { from: '2026-10-21', to: '2026-10-20' })).toThrow(
      /on or after from/,
    );
    expect(() => summaryOf(t.db, userId, { from: 'monday', to: '2026-10-20' })).toThrow(
      /from is a calendar date/,
    );
  });
});
