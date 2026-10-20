import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { timeBreaks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneTime } from '../../src/jobs/jobs.ts';
import {
  addBreak,
  BREAKS_PER_DAY_MAX,
  breaksOn,
  removeBreak,
} from '../../src/services/time-breaks.ts';
import { setOrgTimeMode } from '../../src/services/time-settings.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * Breaks (LAI-831, CHIEF's addition D): a gap a person waved away. Theirs
 * alone, on their own day, never overlapping, and gone with the drafts.
 */

const NOW = Date.UTC(2026, 9, 20, 18);
const DAY = '2026-10-20';
const at = (h: number, m = 0): number => Date.UTC(2026, 9, 20, h, m);

let t: TestDb;
let owner: ResolvedActor;
let bea: ResolvedActor;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return `${err.code}:${String((err.details as { reason?: string } | null)?.reason ?? '')}`;
    }
    throw err;
  }
  return 'no error';
}

const span = (from: number, to: number) => ({
  day: DAY,
  tz: 'UTC',
  started_at: from,
  ended_at: to,
});

beforeEach(() => {
  t = freshDb();
  owner = load(seed(t.db, NOW).userId);
  const beaId = newId();
  t.db
    .insert(users)
    .values({
      id: beaId,
      email: 'bea@example.test',
      name: 'Bea',
      orgRole: 'member',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  bea = load(beaId);
  setOrgTimeMode(t.db, owner, 'manual', NOW);
});

afterEach(() => {
  t.close();
});

describe('a break', () => {
  it('is read back with its day, in the order the day ran', () => {
    const late = addBreak(t.db, owner, span(at(15), at(15, 30)), NOW);
    const early = addBreak(t.db, owner, span(at(12), at(12, 45)), NOW);
    expect(breaksOn(t.db, owner.userId, DAY).map((b) => b.id)).toEqual([early.id, late.id]);
    expect(breaksOn(t.db, bea.userId, DAY)).toEqual([]);
  });

  it('overlaps no break already there, and a day holds a bounded number', () => {
    addBreak(t.db, owner, span(at(12), at(13)), NOW);
    expect(reason(() => addBreak(t.db, owner, span(at(12, 30), at(13, 30)), NOW))).toBe(
      'unprocessable:overlaps_break',
    );
    // Touching is not overlapping.
    expect(reason(() => addBreak(t.db, owner, span(at(13), at(13, 5)), NOW))).toBe('no error');
    for (let i = 2; i < BREAKS_PER_DAY_MAX; i += 1) {
      addBreak(t.db, owner, span(at(0, i), at(0, i) + 30_000), NOW);
    }
    expect(reason(() => addBreak(t.db, owner, span(at(20), at(21)), NOW))).toBe(
      'unprocessable:too_many_breaks',
    );
  });

  it('is refused while the organisation’s Time is off', () => {
    setOrgTimeMode(t.db, owner, 'off', NOW);
    expect(reason(() => addBreak(t.db, owner, span(at(12), at(13)), NOW))).toMatch(/^forbidden:/);
  });

  it('is removed by its person only', () => {
    const made = addBreak(t.db, owner, span(at(12), at(13)), NOW);
    expect(reason(() => removeBreak(t.db, bea, made.id))).toBe('not_found:');
    removeBreak(t.db, owner, made.id);
    expect(breaksOn(t.db, owner.userId, DAY)).toEqual([]);
  });

  it('goes with the drafts, after 30 days', () => {
    addBreak(t.db, owner, span(at(12), at(13)), NOW);
    pruneTime(t.db, NOW + 31 * 86_400_000);
    expect(t.db.select().from(timeBreaks).all()).toEqual([]);
  });
});
