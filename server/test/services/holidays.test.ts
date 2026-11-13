import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgHolidays, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { addHoliday, listHolidays, removeHoliday } from '../../src/services/holidays.ts';
import { expectSqliteError, freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * The organisation's holidays (D-149 items 5 and 8, LAI-1181): every member
 * reads them; an owner or admin types and removes manual ones; Clan's are
 * Clan's to remove; nothing is ever deleted.
 */

const NOW = Date.UTC(2026, 10, 13, 12);

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

function load(userId: string): ResolvedActor {
  const actor = loadActor(t.db, userId);
  if (actor === null) throw new Error('no such user');
  return actor;
}

function person(orgRole: 'admin' | 'member' | 'viewer'): ResolvedActor {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${orgRole}-${id.toLowerCase()}@example.test`,
      name: orgRole,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return load(id);
}

function clanHoliday(
  day: string,
  label: string,
  ref: string,
  extra: { scopeJson?: string; removedAt?: number } = {},
): string {
  const id = newId();
  t.db
    .insert(orgHolidays)
    .values({
      id,
      day,
      label,
      source: 'clan',
      sourceRef: ref,
      scopeJson: extra.scopeJson ?? null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      removedAt: extra.removedAt ?? null,
    })
    .run();
  return id;
}

function caught(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a failure, and the call succeeded');
}

function reasonOf(err: ApiError): string | undefined {
  return (err.details as { reason?: string } | null)?.reason;
}

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW);
  owner = load(s.userId);
});
afterEach(() => {
  t.close();
});

describe('reading', () => {
  it('serves every member, a viewer included, the live holidays in the range, by day', () => {
    const christmas = clanHoliday('2026-12-25', 'Christmas', '1');
    const scoped = clanHoliday('2026-08-15', 'Independence Day', '2', {
      scopeJson: '{"departments":["4"],"designations":[]}',
    });
    clanHoliday('2026-09-01', 'Gone from Clan', '3', { removedAt: NOW });
    clanHoliday('2027-01-01', 'Next year', '4');

    const expected = {
      holidays: [
        {
          id: scoped,
          day: '2026-08-15',
          label: 'Independence Day',
          source: 'clan',
          everyone: false,
        },
        { id: christmas, day: '2026-12-25', label: 'Christmas', source: 'clan', everyone: true },
      ],
    };
    expect(listHolidays(t.db, owner, YEAR)).toEqual(expected);
    expect(listHolidays(t.db, person('viewer'), YEAR)).toEqual(expected);
  });

  it('puts a manual holiday before Clan’s on the same day — the one that wins', () => {
    clanHoliday('2026-09-24', 'Heritage Day', '1');
    const manual = addHoliday(t.db, owner, { day: '2026-09-24', label: 'Our day' }, NOW);
    expect(listHolidays(t.db, owner, YEAR).holidays.map((h) => [h.id, h.source])).toEqual([
      [manual.id, 'manual'],
      [expect.any(String), 'clan'],
    ]);
  });

  it('takes a range of at most 731 days, from no later than to, of real dates', () => {
    // 2025-01-01 to 2027-01-01 is 731 days counting both ends: the most.
    expect(listHolidays(t.db, owner, { from: '2025-01-01', to: '2027-01-01' }).holidays).toEqual(
      [],
    );
    for (const range of [
      { from: '2025-01-01', to: '2027-01-02' },
      { from: '2026-02-01', to: '2026-01-31' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: 'today', to: '2026-03-01' },
    ]) {
      expect(caught(() => listHolidays(t.db, owner, range)).status, JSON.stringify(range)).toBe(
        422,
      );
    }
  });
});

describe('typing and removing', () => {
  it('lets an owner and an admin add one, and refuses a member', () => {
    const added = addHoliday(t.db, owner, { day: '2026-12-26', label: 'Day of Goodwill' }, NOW);
    expect(added).toEqual({
      id: expect.any(String) as unknown,
      day: '2026-12-26',
      label: 'Day of Goodwill',
      source: 'manual',
      everyone: true,
    });
    expect(t.db.select().from(orgHolidays).get()).toMatchObject({
      createdBy: s.userId,
      sourceRef: null,
      createdAt: NOW,
    });
    expect(addHoliday(t.db, person('admin'), { day: '2026-12-27', label: 'B' }, NOW).day).toBe(
      '2026-12-27',
    );

    const err = caught(() => addHoliday(t.db, person('member'), { day: '2026-12-28', label: 'C' }));
    expect(err.code).toBe('forbidden');
    expect((err.details as { action: string }).action).toBe('org.time.set');
  });

  it('refuses a second live manual holiday on one day: 409 holiday_exists', () => {
    const first = addHoliday(t.db, owner, { day: '2026-12-26', label: 'One' }, NOW);
    const err = caught(() => addHoliday(t.db, owner, { day: '2026-12-26', label: 'Two' }, NOW));
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ reason: 'holiday_exists', id: first.id });

    // The database holds the same line if a race got past the check.
    expectSqliteError(
      () =>
        t.db
          .insert(orgHolidays)
          .values({
            id: newId(),
            day: '2026-12-26',
            label: 'Raced',
            source: 'manual',
            createdBy: s.userId,
            createdAt: NOW,
            updatedAt: NOW,
          })
          .run(),
      /UNIQUE constraint failed: org_holidays\.day/,
    );
  });

  it('stamps a removed manual holiday, and lets the day be typed again', () => {
    const first = addHoliday(t.db, owner, { day: '2026-12-26', label: 'One' }, NOW);
    removeHoliday(t.db, owner, first.id, NOW + 1);

    const row = t.db.select().from(orgHolidays).where(eq(orgHolidays.id, first.id)).get();
    expect(row?.removedAt).toBe(NOW + 1);
    expect(listHolidays(t.db, owner, YEAR).holidays).toEqual([]);

    const again = addHoliday(t.db, owner, { day: '2026-12-26', label: 'Two' }, NOW + 2);
    expect(again.id).not.toBe(first.id);
    expect(t.db.select().from(orgHolidays).all()).toHaveLength(2);
  });

  it('refuses to remove Clan’s holiday: 409 holiday_from_clan', () => {
    const id = clanHoliday('2026-09-24', 'Heritage Day', '1');
    const err = caught(() => removeHoliday(t.db, owner, id, NOW));
    expect(err.status).toBe(409);
    expect(reasonOf(err)).toBe('holiday_from_clan');
    expect(t.db.select().from(orgHolidays).get()?.removedAt).toBeNull();
  });

  it('answers 404 for a holiday that is not there, or already removed', () => {
    expect(caught(() => removeHoliday(t.db, owner, 'nope', NOW)).status).toBe(404);
    const gone = clanHoliday('2026-09-01', 'Gone', '3', { removedAt: NOW });
    expect(caught(() => removeHoliday(t.db, owner, gone, NOW)).status).toBe(404);
  });

  it('refuses a member removing one', () => {
    const added = addHoliday(t.db, owner, { day: '2026-12-26', label: 'One' }, NOW);
    expect(caught(() => removeHoliday(t.db, person('member'), added.id, NOW)).code).toBe(
      'forbidden',
    );
  });

  it('holds a manual holiday to its creator and a synced one to nobody, in the database', () => {
    // Two-sided (LAI-1181 review): no manual row without a name, no Clan row with one.
    expectSqliteError(
      () =>
        t.db
          .insert(orgHolidays)
          .values({
            id: newId(),
            day: '2026-12-30',
            label: 'Nobody typed this',
            source: 'manual',
            createdBy: null,
            createdAt: NOW,
            updatedAt: NOW,
          })
          .run(),
      /CHECK constraint failed: org_holidays_origin_check/,
    );
    expectSqliteError(
      () =>
        t.db
          .insert(orgHolidays)
          .values({
            id: newId(),
            day: '2026-12-30',
            label: 'Clan, with a name',
            source: 'clan',
            sourceRef: '9',
            createdBy: s.userId,
            createdAt: NOW,
            updatedAt: NOW,
          })
          .run(),
      /CHECK constraint failed: org_holidays_origin_check/,
    );
  });

  it('keeps the creator of a manual holiday from being deleted, as the set null meets the check', () => {
    const admin = person('admin');
    addHoliday(t.db, admin, { day: '2026-12-26', label: 'One' }, NOW);
    expectSqliteError(
      () => t.db.delete(users).where(eq(users.id, admin.userId)).run(),
      /CHECK constraint failed: org_holidays_origin_check/,
    );
  });

  it('refuses a day that is not a date', () => {
    const err = caught(() => addHoliday(t.db, owner, { day: '2026-02-30', label: 'X' }, NOW));
    expect(err.status).toBe(422);
    expect(err.details).toEqual({ field: 'day' });
  });
});
