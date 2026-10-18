import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { planLimits, tokenArrivals, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  ARRIVAL_BUCKET_MS,
  clearPlanLimit,
  getPlanLimit,
  lastWeeklyReset,
  recordArrival,
  setPlanLimit,
  startOfDay,
} from '../../src/services/plan-limit.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The plan-limit forecast (LAI-773, D-087): the developer's own limit, their
 * own recent rate, *"at this rate you reach it around HH:MM"* — an estimate,
 * shown to them and to nobody else.
 */

const HOUR = 3_600_000;
const MIN = 60_000;
// Saturday 17 October 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 9, 17, 12);

let t: TestDb;
let me: string;
let other: string;

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function arrive(at: number, tokens: number, userId = me): void {
  t.db.transaction((tx) => {
    recordArrival(tx, userId, tokens, at);
  });
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

beforeEach(() => {
  t = freshDb();
  me = seed(t.db, NOW).userId;
  other = newId();
  t.db
    .insert(users)
    .values({
      id: other,
      email: 'bea@example.test',
      name: 'Bea',
      orgRole: 'admin',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
});

afterEach(() => {
  t.close();
});

describe('arrivals', () => {
  it('are kept in five-minute buckets, added, never negative', () => {
    arrive(NOW, 100);
    arrive(NOW + 2 * MIN, 50);
    arrive(NOW + 6 * MIN, 7);
    arrive(NOW + 7 * MIN, 0);
    const rows = t.db.select().from(tokenArrivals).all();
    expect(ARRIVAL_BUCKET_MS).toBe(5 * MIN);
    expect(rows.map((r) => [r.bucketMs - NOW, r.tokens])).toEqual([
      [0, 150],
      [5 * MIN, 7],
    ]);
  });
});

describe('zoned windows', () => {
  it('finds local midnight across an offset', () => {
    // 12:00 UTC is 14:00 in Johannesburg; its midnight is 22:00 UTC the day before.
    expect(startOfDay('Africa/Johannesburg', NOW)).toBe(Date.UTC(2026, 9, 16, 22));
    expect(startOfDay('UTC', NOW)).toBe(Date.UTC(2026, 9, 17));
  });

  it('finds the last weekly reset at a fixed day and time', () => {
    // Resets Mondays 09:00 UTC: the last one before Saturday noon was the 12th.
    expect(lastWeeklyReset('UTC', NOW, 1, 9 * 60)).toBe(Date.UTC(2026, 9, 12, 9));
    // Saturday 13:00: not yet today, so a week ago.
    expect(lastWeeklyReset('UTC', NOW, 6, 13 * 60)).toBe(Date.UTC(2026, 9, 10, 13));
    // Saturday 11:00: earlier today.
    expect(lastWeeklyReset('UTC', NOW, 6, 11 * 60)).toBe(Date.UTC(2026, 9, 17, 11));
  });
});

describe('the forecast', () => {
  it('says when the limit is reached at the last hour’s rate, labelled an estimate', () => {
    setPlanLimit(
      t.db,
      actor(me),
      { plan: 'claude-max-5x', window: '5h', limit_tokens: 1_000_000, tz: 'UTC' },
      NOW,
    );
    // 400k in the last five hours, 200k of it in the last hour.
    arrive(NOW - 4 * HOUR, 200_000);
    arrive(NOW - 30 * MIN, 200_000);
    // Outside the window: not counted.
    arrive(NOW - 6 * HOUR, 999_999);
    const view = getPlanLimit(t.db, actor(me), NOW);
    expect(view).toMatchObject({
      plan: 'claude-max-5x',
      window: '5h',
      limit_tokens: 1_000_000,
      used: 400_000,
      rate_per_hour: 200_000,
      reached: false,
      estimate: true,
    });
    // 600k left at 200k an hour: three hours from now.
    expect(view.reaches_limit_at).toBe(NOW + 3 * HOUR);
  });

  it('gives no time when nothing arrived in the last hour', () => {
    setPlanLimit(
      t.db,
      actor(me),
      { plan: 'other', window: 'day', limit_tokens: 500, tz: 'UTC' },
      NOW,
    );
    arrive(NOW - 3 * HOUR, 100);
    const view = getPlanLimit(t.db, actor(me), NOW);
    expect(view.used).toBe(100);
    expect(view.rate_per_hour).toBe(0);
    expect(view.reaches_limit_at).toBeNull();
  });

  it('says reached once it is, and nothing past the window’s reset', () => {
    setPlanLimit(
      t.db,
      actor(me),
      { plan: 'other', window: 'day', limit_tokens: 500, tz: 'UTC' },
      NOW,
    );
    arrive(NOW - 10 * MIN, 600);
    expect(getPlanLimit(t.db, actor(me), NOW)).toMatchObject({
      reached: true,
      reaches_limit_at: null,
    });

    // 100 an hour, 400 left: 16:00 would be past midnight's reset? No — 4 h is
    // 16:00, inside the day. At 23:00 with the same rate it would not be.
    t.db.delete(tokenArrivals).run();
    arrive(NOW - 10 * MIN, 100);
    expect(getPlanLimit(t.db, actor(me), NOW).reaches_limit_at).toBe(NOW + 4 * HOUR);
    const late = Date.UTC(2026, 9, 17, 23);
    t.db.delete(tokenArrivals).run();
    arrive(late - 10 * MIN, 100);
    expect(getPlanLimit(t.db, actor(me), late)).toMatchObject({
      reaches_limit_at: null,
      window_end: Date.UTC(2026, 9, 18),
    });
  });

  it('counts a week from the reset the developer gave', () => {
    setPlanLimit(
      t.db,
      actor(me),
      {
        plan: 'claude-max-20x',
        window: 'week',
        limit_tokens: 10_000_000,
        tz: 'UTC',
        week_reset: { weekday: 1, minute: 540 },
      },
      NOW,
    );
    arrive(Date.UTC(2026, 9, 12, 8), 5); // before Monday's reset
    arrive(Date.UTC(2026, 9, 12, 10), 70);
    const view = getPlanLimit(t.db, actor(me), NOW);
    expect(view.used).toBe(70);
    expect(view.window_start).toBe(Date.UTC(2026, 9, 12, 9));
    expect(view.window_end).toBe(Date.UTC(2026, 9, 19, 9));
  });

  it('needs a reset for a weekly window, and none for the others', () => {
    expect(
      reason(() =>
        setPlanLimit(
          t.db,
          actor(me),
          { plan: 'other', window: 'week', limit_tokens: 5, tz: 'UTC' },
          NOW,
        ),
      ),
    ).toMatch(/^unprocessable/);
    expect(
      reason(() =>
        setPlanLimit(
          t.db,
          actor(me),
          { plan: 'other', window: 'day', limit_tokens: 5, tz: 'Nowhere/Else' },
          NOW,
        ),
      ),
    ).toBe('unprocessable:invalid_tz');
  });
});

describe('only the developer', () => {
  it('reads and sets only their own — there is no way to name anybody else', () => {
    setPlanLimit(t.db, actor(me), { plan: 'other', window: '5h', limit_tokens: 9, tz: 'UTC' }, NOW);
    arrive(NOW, 5, other);
    // The admin's own view knows nothing of mine, and mine nothing of theirs.
    expect(getPlanLimit(t.db, actor(other), NOW)).toMatchObject({ plan: null, used: 5 });
    expect(getPlanLimit(t.db, actor(me), NOW)).toMatchObject({ plan: 'other', used: 0 });
  });

  it('refuses every token, the person’s own included', () => {
    const token = { ...actor(me), token: { id: 'tok', scope: 'full' as const, projectIds: null } };
    expect(reason(() => getPlanLimit(t.db, token, NOW))).toBe('forbidden:session_required');
    expect(
      reason(() =>
        setPlanLimit(t.db, token, { plan: 'other', window: '5h', limit_tokens: 9, tz: 'UTC' }, NOW),
      ),
    ).toBe('forbidden:session_required');
    expect(t.db.select().from(planLimits).all()).toHaveLength(0);
  });

  it('clears it', () => {
    setPlanLimit(t.db, actor(me), { plan: 'other', window: '5h', limit_tokens: 9, tz: 'UTC' }, NOW);
    clearPlanLimit(t.db, actor(me));
    expect(t.db.select().from(planLimits).where(eq(planLimits.userId, me)).all()).toHaveLength(0);
  });
});
