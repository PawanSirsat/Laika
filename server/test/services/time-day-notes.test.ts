import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { timeDayNotes } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneTime } from '../../src/jobs/jobs.ts';
import { dayNoteOn, setDayNote } from '../../src/services/time-day-notes.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The day's note (§4.62, D-110 item 2, LAI-501): one per person per day,
 * trimmed, replaced in place, removed by nothing, and pruned with the entries.
 */

const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';

let t: TestDb;
let owner: ResolvedActor;

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return `${err.code}:${String((err.details as { field?: string } | null)?.field ?? '')}`;
    }
    throw err;
  }
  return 'no error';
}

beforeEach(() => {
  t = freshDb();
  const actor = loadActor(t.db, seed(t.db, NOW).userId);
  if (actor === null) throw new Error('no owner');
  owner = actor;
  setOrgTimeMode(t.db, owner, 'manual', NOW);
});

afterEach(() => {
  t.close();
});

describe("the day's note", () => {
  it('is set trimmed, read with its day, replaced in place, and removed by nothing', () => {
    expect(dayNoteOn(t.db, owner.userId, DAY)).toBeNull();
    expect(setDayNote(t.db, owner, DAY, '  Two meetings ran long  ', NOW)).toEqual({
      day: DAY,
      note: 'Two meetings ran long',
      updated_at: NOW,
    });
    expect(setDayNote(t.db, owner, DAY, 'Shorter', NOW + 1)).toMatchObject({
      note: 'Shorter',
      updated_at: NOW + 1,
    });
    expect(t.db.select().from(timeDayNotes).all()).toHaveLength(1);
    expect(dayNoteOn(t.db, owner.userId, DAY)?.note).toBe('Shorter');
    expect(setDayNote(t.db, owner, DAY, '   ', NOW + 2)).toBeNull();
    expect(t.db.select().from(timeDayNotes).all()).toEqual([]);
    expect(setDayNote(t.db, owner, DAY, null, NOW + 3)).toBeNull();
  });

  it('wants a calendar day and the organisation’s Time on', () => {
    expect(reason(() => setDayNote(t.db, owner, '2026-13-40', 'x', NOW))).toBe('unprocessable:day');
    setOrgTimeMode(t.db, owner, 'off', NOW);
    expect(reason(() => setDayNote(t.db, owner, DAY, 'x', NOW))).toMatch(/^forbidden:/);
  });

  it('goes with the entries, after three years', () => {
    setDayNote(t.db, owner, DAY, 'Kept a while', NOW);
    pruneTime(t.db, NOW + 31 * 86_400_000);
    expect(t.db.select().from(timeDayNotes).all()).toHaveLength(1);
    const later = new Date(NOW);
    later.setUTCFullYear(later.getUTCFullYear() + 3);
    pruneTime(t.db, later.getTime() + 86_400_000);
    expect(t.db.select().from(timeDayNotes).all()).toEqual([]);
  });
});
