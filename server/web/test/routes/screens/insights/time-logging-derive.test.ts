/**
 * The Time logging grid's arithmetic (D-148, LAI-1175): the month and its
 * days, which cell a day is, what a row owes and what it reached — against
 * the served threshold, never a number of this file's own.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TimeLoggingPerson } from '../../../../src/api/time-logging.ts';
import {
  cellState,
  dayHref,
  dueDays,
  isWorkingDay,
  monthDays,
  monthHref,
  monthKey,
  monthLabel,
  rowTotals,
  stepMonth,
} from '../../../../src/routes/screens/insights/time-logging-derive.ts';

const THRESHOLD = 480;

/** Joined on Sunday 1 November; today is Thursday 12 November, in UTC. */
function person(
  days: readonly { day: string; c: number; d?: number }[],
  overrides: Partial<TimeLoggingPerson> = {},
): TimeLoggingPerson {
  return {
    user: { id: 'u2', name: 'Bea Nkosi', org_role: 'member', deactivated: false },
    zone: 'UTC',
    joined_day: '2026-11-01',
    today_day: '2026-11-12',
    work_days: [1, 2, 3, 4, 5],
    days: days.map((x) => ({ day: x.day, confirmed_minutes: x.c, drafted_minutes: x.d ?? 0 })),
    ...overrides,
  };
}

void describe('the month', () => {
  void test('monthDays: 31, 30, 28 and 29 days, each with its weekday and weekend flag', () => {
    const nov = monthDays('2026-11');
    assert.deepEqual([nov.from, nov.to, nov.days.length], ['2026-11-01', '2026-11-30', 30]);
    assert.deepEqual(nov.days[0], { day: '2026-11-01', dow: 7, date: 1, weekend: true });
    assert.deepEqual(nov.days[1], { day: '2026-11-02', dow: 1, date: 2, weekend: false });
    assert.deepEqual(nov.days[6], { day: '2026-11-07', dow: 6, date: 7, weekend: true });
    assert.equal(monthDays('2026-10').days.length, 31);
    assert.equal(monthDays('2026-02').days.length, 28);
    assert.equal(monthDays('2028-02').days.length, 29);
    assert.equal(
      nov.days.filter((d) => d.weekend).length,
      9,
      'November 2026 has nine weekend days',
    );
    // Friday is never a weekend day.
    assert.equal(
      nov.days.some((d) => d.dow === 5 && d.weekend),
      false,
    );
  });

  void test('monthKey takes a well-formed month and falls back to today’s otherwise', () => {
    assert.equal(monthKey('2026-10', '2026-11-12'), '2026-10');
    assert.equal(monthKey('2026-13', '2026-11-12'), '2026-11');
    assert.equal(monthKey('2026-1', '2026-11-12'), '2026-11');
    assert.equal(monthKey('garbage', '2026-11-12'), '2026-11');
    assert.equal(monthKey(null, '2026-11-12'), '2026-11');
    assert.equal(monthKey(undefined, '2026-11-12'), '2026-11');
  });

  void test('monthLabel, monthHref and stepMonth', () => {
    assert.equal(monthLabel('2026-11'), 'November 2026');
    assert.equal(monthHref('2026-11', '2026-11'), '/insights?tab=time&view=days');
    assert.equal(monthHref('2026-10', '2026-11'), '/insights?tab=time&view=days&month=2026-10');
    assert.equal(stepMonth('2026-11', -1), '2026-10');
    assert.equal(stepMonth('2026-12', 1), '2027-01');
    assert.equal(stepMonth('2026-01', -1), '2025-12');
  });
});

void describe('a cell', () => {
  void test('isWorkingDay: the person’s days, Saturday included when they say so; Mon–Fri when they set none', () => {
    assert.equal(isWorkingDay([1, 2, 3, 4, 5, 6], '2026-11-07'), true); // Saturday
    assert.equal(isWorkingDay([1, 2, 3, 4, 5], '2026-11-07'), false);
    assert.equal(isWorkingDay([], '2026-11-07'), false);
    assert.equal(isWorkingDay([], '2026-11-06'), true); // Friday
    assert.equal(isWorkingDay([1, 2, 3], '2026-11-05'), false); // Thursday
  });

  void test('the verdict at the threshold: 480 is full, 479 is under, 0 is nothing', () => {
    const p = person([
      { day: '2026-11-02', c: 480 },
      { day: '2026-11-03', c: 479 },
      { day: '2026-11-04', c: 300, d: 180 },
    ]);
    assert.equal(cellState(p, '2026-11-02', THRESHOLD).state, 'full');
    assert.equal(cellState(p, '2026-11-03', THRESHOLD).state, 'under');
    assert.equal(cellState(p, '2026-11-04', THRESHOLD).state, 'full', 'drafted counts');
    assert.equal(cellState(p, '2026-11-05', THRESHOLD).state, 'none');
    // The threshold is the server's: at 420, 479 is a full day.
    assert.equal(cellState(p, '2026-11-03', 420).state, 'full');
  });

  void test('a day off, before joining, not yet, and today — in that order of precedence', () => {
    const p = person([
      { day: '2026-11-07', c: 120 }, // Saturday, with time
      { day: '2026-11-12', c: 90 }, // today
      { day: '2026-11-13', c: 480 }, // tomorrow, filed early
      { day: '2026-10-30', c: 480 }, // before joining
    ]);
    const off = cellState(p, '2026-11-07', THRESHOLD);
    assert.deepEqual([off.state, off.figure, off.glyph], ['off', '2h', '—']);
    assert.equal(cellState(p, '2026-11-08', THRESHOLD).figure, '', 'a quiet Sunday says nothing');
    const today = cellState(p, '2026-11-12', THRESHOLD);
    assert.deepEqual([today.state, today.figure, today.glyph], ['today', '1h 30m', '—']);
    assert.equal(
      cellState(p, '2026-11-13', THRESHOLD).state,
      'future',
      'tomorrow is not a full day yet',
    );
    assert.equal(cellState(p, '2026-10-30', THRESHOLD).state, 'before');
    // A Saturday today is today, not off; a Saturday tomorrow is not yet, not off.
    const sat = person([], { today_day: '2026-11-07' });
    assert.equal(cellState(sat, '2026-11-07', THRESHOLD).state, 'today');
    assert.equal(cellState(sat, '2026-11-14', THRESHOLD).state, 'future');
    // Joined on a Saturday: the Friday before is "before", not "off".
    const late = person([], { joined_day: '2026-11-07' });
    assert.equal(cellState(late, '2026-11-06', THRESHOLD).state, 'before');
  });

  void test('says the person, the day, the hours and the words', () => {
    const p = person([
      { day: '2026-11-02', c: 540 },
      { day: '2026-11-03', c: 180 },
      { day: '2026-11-12', c: 90 },
    ]);
    assert.equal(
      cellState(p, '2026-11-02', THRESHOLD).aria,
      'Bea Nkosi, Mon 2 Nov: 9h, 8h or more, full day',
    );
    assert.equal(cellState(p, '2026-11-03', THRESHOLD).aria, 'Bea Nkosi, Tue 3 Nov: 3h, under 8h');
    assert.equal(
      cellState(p, '2026-11-04', THRESHOLD).aria,
      'Bea Nkosi, Wed 4 Nov: nothing logged',
    );
    assert.equal(
      cellState(p, '2026-11-07', THRESHOLD).aria,
      'Bea Nkosi, Sat 7 Nov: not a working day',
    );
    assert.equal(
      cellState(p, '2026-11-12', THRESHOLD).aria,
      'Bea Nkosi, Thu 12 Nov: 1h 30m, so far today',
    );
    assert.equal(cellState(p, '2026-11-13', THRESHOLD).aria, 'Bea Nkosi, Fri 13 Nov: not yet');
    assert.equal(
      cellState(p, '2026-10-31', THRESHOLD).aria,
      'Bea Nkosi, Sat 31 Oct: before they joined',
    );
  });
});

void describe('a row', () => {
  const { days } = monthDays('2026-11');

  void test('dueDays: working days from joining to yesterday — not today, not before they joined; none when deactivated', () => {
    // Joined Sunday 1 Nov, today Thursday 12 Nov: Mon 2 to Wed 11 is eight working days.
    assert.equal(dueDays(person([]), days), 8);
    assert.equal(dueDays(person([], { joined_day: '2026-11-04' }), days), 6);
    assert.equal(dueDays(person([], { work_days: [1, 2, 3, 4, 5, 6] }), days), 9);
    assert.equal(
      dueDays(
        person([], {
          user: { id: 'u2', name: 'Bea Nkosi', org_role: 'member', deactivated: true },
        }),
        days,
      ),
      0,
    );
  });

  void test('rowTotals: every minute counts toward hours — drafts, a day off, today — and only due full days toward days', () => {
    const p = person(
      [
        { day: '2026-11-02', c: 480 }, // full
        { day: '2026-11-03', c: 300, d: 180 }, // full, with drafts
        { day: '2026-11-04', c: 100 }, // under
        { day: '2026-11-07', c: 120 }, // Saturday off: hours, not days
        { day: '2026-11-12', c: 90 }, // today: hours, not days
        { day: '2026-11-13', c: 480 }, // not yet: hours, not days
      ],
      { joined_day: '2026-11-02' },
    );
    // Joined Monday 2 Nov, today Thursday 12 Nov: Mon 2 to Wed 11 is eight working days.
    const t = rowTotals(p, days, THRESHOLD);
    assert.deepEqual(t, { minutes: 480 + 480 + 100 + 120 + 90 + 480, full: 2, due: 8 });
    assert.equal(`${String(t.full)} / ${String(t.due)}`, '2 / 8');
    // A deactivated person's full days are not counted: they owe none.
    const gone = rowTotals(
      person([{ day: '2026-11-02', c: 480 }], {
        user: { id: 'u2', name: 'Bea Nkosi', org_role: 'member', deactivated: true },
      }),
      days,
      THRESHOLD,
    );
    assert.deepEqual([gone.full, gone.due], [0, 0]);
  });

  void test('dayHref opens that person’s Day on their profile, encoded', () => {
    assert.equal(dayHref('u2', '2026-11-02'), '/people?user=u2&tab=day&day=2026-11-02');
    assert.equal(dayHref('a b', '2026-11-02'), '/people?user=a+b&tab=day&day=2026-11-02');
  });
});
