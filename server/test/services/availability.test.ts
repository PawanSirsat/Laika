import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, userAvailability, userAwayPeriods, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneTime } from '../../src/jobs/jobs.ts';
import {
  addAwayPeriod,
  availabilityFor,
  deleteAwayPeriod,
  getMyAvailability,
  setMyAvailability,
} from '../../src/services/availability.ts';
import { setTimeSettings } from '../../src/services/time-settings.ts';
import { expectSqliteError, freshDb, type TestDb } from '../helpers/db.ts';
import { hrPerson, leaveDay } from '../helpers/hr.ts';

/**
 * A person's own availability (SPEC §4.85, §4.86, D-131, LAI-1130): the
 * empty view, every limit as a field-named `422`, the merge, away derived in
 * the person's own zone, away periods kept to the person, and retention.
 */

const DAY = 86_400_000;
// Wednesday 21 October 2026, 15:00 UTC — already Thursday 22nd in Auckland.
const NOW = Date.UTC(2026, 9, 21, 15);

let t: TestDb;
let bea: string;
let cal: string;

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

function refusal(fn: () => unknown): { code: string; details: unknown } | string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return { code: err.code, details: err.details };
    throw err;
  }
  return 'no error';
}

function invalid(field: string, reason: string) {
  return { code: 'unprocessable', details: { field, reason } };
}

beforeEach(() => {
  t = freshDb();
  const owner = makeUser('Ada', 'owner');
  bea = makeUser('Bea', 'member');
  cal = makeUser('Cal', 'member');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: owner, createdAt: NOW, updatedAt: NOW })
    .run();
});
afterEach(() => {
  t.close();
});

describe('a person who set nothing', () => {
  it('reads every field empty, never a 404', () => {
    expect(getMyAvailability(t.db, actor(bea), NOW)).toEqual({
      status: null,
      away: null,
      on_leave: null,
      hours_per_week: null,
      note: null,
      tags: [],
      work_week: null,
      away_periods: [],
      updated_at: null,
    });
    // And is `null` to every people read, which draws no pill.
    expect(availabilityFor(t.db, actor(bea), [bea], NOW).get(bea)).toBeNull();
  });
});

describe('PUT /me/availability', () => {
  it('writes the person’s own row, and the working week multiplied out', () => {
    const view = setMyAvailability(
      t.db,
      actor(bea),
      {
        status: 'open',
        hours_per_week: 10,
        note: '  Happy to pair on payments  ',
        tags: ['Payments', 'react'],
        work_week: { days: [5, 1, 2, 3, 4, 1], start: '09:00', end: '17:00' },
      },
      NOW,
    );
    expect(view).toEqual({
      status: 'open',
      away: null,
      on_leave: null,
      hours_per_week: 10,
      note: 'Happy to pair on payments',
      tags: ['Payments', 'react'],
      // Five days of eight hours: the person's own declaration, not a balance.
      work_week: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', minutes: 2400 },
      away_periods: [],
      updated_at: NOW,
    });
    expect(
      t.db
        .select()
        .from(userAvailability)
        .all()
        .map((r) => r.userId),
    ).toEqual([bea]);
    // Nobody else's row was touched — there is no argument that names one.
    expect(getMyAvailability(t.db, actor(cal), NOW).status).toBeNull();
  });

  it('is a merge: a field left out is kept, null clears, and a same write keeps updated_at', () => {
    setMyAvailability(t.db, actor(bea), { status: 'open', note: 'Hi', tags: ['go'] }, NOW);
    const kept = setMyAvailability(t.db, actor(bea), { hours_per_week: 4 }, NOW + 1000);
    expect(kept).toMatchObject({ status: 'open', note: 'Hi', tags: ['go'], hours_per_week: 4 });
    expect(kept.updated_at).toBe(NOW + 1000);

    const same = setMyAvailability(t.db, actor(bea), { status: 'open', note: 'Hi' }, NOW + 5000);
    expect(same.updated_at).toBe(NOW + 1000);

    const cleared = setMyAvailability(
      t.db,
      actor(bea),
      { note: null, hours_per_week: null, status: 'capacity' },
      NOW + 9000,
    );
    expect(cleared).toMatchObject({
      status: 'capacity',
      note: null,
      hours_per_week: null,
      tags: ['go'],
      updated_at: NOW + 9000,
    });
    // A blank note is no note.
    expect(setMyAvailability(t.db, actor(bea), { note: '   ' }, NOW).note).toBeNull();
  });

  it('de-duplicates tags case-insensitively, keeping the first spelling', () => {
    const view = setMyAvailability(t.db, actor(bea), { tags: ['React', ' react ', 'Go'] }, NOW);
    expect(view.tags).toEqual(['React', 'Go']);
  });

  it('refuses every limit with a 422 naming the field and the reason', () => {
    const me = actor(bea);
    const put = (input: Parameters<typeof setMyAvailability>[2]) => () =>
      setMyAvailability(t.db, me, input, NOW);
    expect(refusal(put({ hours_per_week: 0 }))).toEqual(invalid('hours_per_week', 'out_of_range'));
    expect(refusal(put({ hours_per_week: 81 }))).toEqual(invalid('hours_per_week', 'out_of_range'));
    expect(refusal(put({ hours_per_week: 2.5 }))).toEqual(
      invalid('hours_per_week', 'out_of_range'),
    );
    expect(refusal(put({ note: 'x'.repeat(141) }))).toEqual(invalid('note', 'too_long'));
    expect(refusal(put({ tags: ['a', ''] }))).toEqual(invalid('tags', 'tag_length'));
    expect(refusal(put({ tags: ['x'.repeat(33)] }))).toEqual(invalid('tags', 'tag_length'));
    expect(refusal(put({ tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }))).toEqual(
      invalid('tags', 'too_many'),
    );
    expect(refusal(put({ work_week: { days: [8], start: null, end: null } }))).toEqual(
      invalid('work_week.days', 'not_a_weekday'),
    );
    expect(refusal(put({ work_week: { days: [1], start: '09:00', end: null } }))).toEqual(
      invalid('work_week.end', 'start_and_end'),
    );
    expect(refusal(put({ work_week: { days: [1], start: '9am', end: '17:00' } }))).toEqual(
      invalid('work_week.start', 'not_a_time'),
    );
    expect(refusal(put({ work_week: { days: [1], start: '09:00', end: '24:00' } }))).toEqual(
      invalid('work_week.end', 'not_a_time'),
    );
    expect(refusal(put({ work_week: { days: [1], start: '17:00', end: '09:00' } }))).toEqual(
      invalid('work_week.end', 'end_before_start'),
    );
    // Nothing was written by any of them.
    expect(t.db.select().from(userAvailability).all()).toEqual([]);
    // Eight is the limit, not seven.
    expect(
      setMyAvailability(t.db, me, { tags: ['1', '2', '3', '4', '5', '6', '7', '8'] }, NOW).tags,
    ).toHaveLength(8);
  });

  it('is refused to any token, the person’s own full one included', () => {
    const token = actor(bea, { token: { id: 'tok', scope: 'full', projectIds: null } });
    expect(refusal(() => setMyAvailability(t.db, token, { status: 'open' }, NOW))).toEqual({
      code: 'forbidden',
      details: expect.objectContaining({ reason: 'session_required' }) as unknown,
    });
    expect(refusal(() => getMyAvailability(t.db, token, NOW))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('is held by the table’s own CHECKs too', () => {
    expectSqliteError(
      () =>
        t.db.run(
          sql`INSERT INTO user_availability (user_id, hours_per_week, updated_at) VALUES (${bea}, 81, 1)`,
        ),
      /CHECK constraint failed: user_availability_hours_check/,
    );
    expectSqliteError(
      () =>
        t.db.run(
          sql`INSERT INTO user_availability (user_id, status, updated_at) VALUES (${bea}, 'away', 1)`,
        ),
      /CHECK constraint failed: user_availability_status_check/,
    );
    expectSqliteError(
      () =>
        t.db.run(
          sql`INSERT INTO user_availability (user_id, work_start, work_end, updated_at) VALUES (${bea}, '17:00', '09:00', 1)`,
        ),
      /CHECK constraint failed: user_availability_work_hours_check/,
    );
    expectSqliteError(
      () =>
        t.db.run(
          sql`INSERT INTO user_away_periods (id, user_id, from_day, to_day, created_at) VALUES ('x', ${bea}, '2026-10-22', '2026-10-21', 1)`,
        ),
      /CHECK constraint failed: user_away_periods_range_check/,
    );
  });
});

describe('away periods', () => {
  it('derive away from the period covering today in the person’s own zone', () => {
    // Bea is in Auckland, where it is already the 22nd; Cal sets no place: UTC, the 21st.
    setTimeSettings(t.db, actor(bea), { place: 'Pacific/Auckland' });
    const period = { from: '2026-10-22', to: '2026-10-23' };
    const beaView = addAwayPeriod(t.db, actor(bea), period, NOW);
    const calView = addAwayPeriod(t.db, actor(cal), period, NOW);

    expect(beaView.away).toEqual({ until: '2026-10-23' });
    expect(calView.away).toBeNull();
    // Upcoming for Cal, so still listed — and still away-free today.
    expect(calView.away_periods).toEqual([
      { id: expect.any(String) as unknown, from: '2026-10-22', to: '2026-10-23' },
    ]);
    // A day later Cal is away too.
    expect(getMyAvailability(t.db, actor(cal), NOW + DAY).away).toEqual({ until: '2026-10-23' });
    // And once it is over, it is no longer listed.
    expect(getMyAvailability(t.db, actor(cal), NOW + 3 * DAY).away_periods).toEqual([]);
  });

  it('refuses a period that already ended, and bad dates, by field', () => {
    const me = actor(bea);
    const add = (from: string, to: string) => () => addAwayPeriod(t.db, me, { from, to }, NOW);
    expect(refusal(add('2026-10-01', '2026-10-20'))).toEqual(invalid('to', 'away_in_past'));
    expect(refusal(add('2026-10-25', '2026-10-24'))).toEqual(invalid('to', 'range_backwards'));
    expect(refusal(add('2026-02-30', '2026-03-01'))).toEqual(invalid('from', 'not_a_date'));
    expect(refusal(add('2026-10-22', '2027-10-23'))).toEqual(invalid('to', 'range_too_long'));
    // Ending today is not in the past.
    expect(addAwayPeriod(t.db, me, { from: '2026-10-01', to: '2026-10-21' }, NOW).away).toEqual({
      until: '2026-10-21',
    });
  });

  it('holds at most twenty current and upcoming periods', () => {
    const me = actor(bea);
    for (let i = 0; i < 20; i += 1) {
      addAwayPeriod(t.db, me, { from: '2026-11-02', to: '2026-11-03' }, NOW);
    }
    expect(
      refusal(() => addAwayPeriod(t.db, me, { from: '2026-11-02', to: '2026-11-03' }, NOW)),
    ).toEqual({ code: 'unprocessable', details: { reason: 'too_many_away_periods', max: 20 } });
  });

  it('deletes only the caller’s own; anybody else’s is a 404', () => {
    const view = addAwayPeriod(t.db, actor(bea), { from: '2026-10-22', to: '2026-10-23' }, NOW);
    const id = view.away_periods[0]?.id ?? '';
    expect(refusal(() => deleteAwayPeriod(t.db, actor(cal), id))).toMatchObject({
      code: 'not_found',
    });
    expect(t.db.select().from(userAwayPeriods).all()).toHaveLength(1);
    deleteAwayPeriod(t.db, actor(bea), id);
    expect(t.db.select().from(userAwayPeriods).all()).toEqual([]);
  });

  it('are pruned by time retention once they ended more than 30 days ago', () => {
    addAwayPeriod(t.db, actor(bea), { from: '2026-10-20', to: '2026-10-21' }, NOW);
    addAwayPeriod(t.db, actor(bea), { from: '2026-11-20', to: '2026-11-21' }, NOW);
    // 30 days after the 21st: the cutoff is the 21st itself, so nothing goes.
    pruneTime(t.db, Date.UTC(2026, 10, 20, 12));
    expect(t.db.select().from(userAwayPeriods).all()).toHaveLength(2);
    // A day later the first has been over for more than 30 days.
    pruneTime(t.db, Date.UTC(2026, 10, 21, 12));
    expect(t.db.select({ to: userAwayPeriods.toDay }).from(userAwayPeriods).all()).toEqual([
      { to: '2026-11-21' },
    ]);
  });
});

describe('on leave (D-149, LAI-1183)', () => {
  it('sits beside away: the leave covering today in the person’s own zone, until the end of its run', () => {
    // Bea is in Auckland, where it is already the 22nd; Cal sets no place: UTC, the 21st.
    setTimeSettings(t.db, actor(bea), { place: 'Pacific/Auckland' });
    const pb = hrPerson(t.db, bea);
    const pc = hrPerson(t.db, cal);
    for (const day of ['2026-10-21', '2026-10-22', '2026-10-23']) {
      leaveDay(t.db, bea, pb, day, { type: 'Annual' });
    }
    leaveDay(t.db, cal, pc, '2026-10-22', { status: 'pending', type: 'Sick' });

    expect(getMyAvailability(t.db, actor(bea), NOW).on_leave).toEqual({
      until: '2026-10-23',
      status: 'approved',
      type: 'Annual',
    });
    // Cal's request is tomorrow in UTC: not today's, so not on leave yet…
    expect(getMyAvailability(t.db, actor(cal), NOW).on_leave).toBeNull();
    // …and a day later, requested — never approved by being shown.
    expect(getMyAvailability(t.db, actor(cal), NOW + DAY).on_leave).toEqual({
      until: '2026-10-22',
      status: 'pending',
      type: 'Sick',
    });
  });

  it('makes a person who set nothing a view, not null — leave is availability too', () => {
    const pb = hrPerson(t.db, bea);
    leaveDay(t.db, bea, pb, '2026-10-21');
    const view = availabilityFor(t.db, actor(bea), [bea, cal], NOW);
    expect(view.get(bea)).toMatchObject({
      status: null,
      away: null,
      on_leave: { until: '2026-10-21', status: 'approved' },
    });
    expect(view.get(cal)).toBeNull();
  });
});
