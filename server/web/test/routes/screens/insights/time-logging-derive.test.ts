/**
 * The Time logging grid's arithmetic (D-148, LAI-1175): the month and its
 * days, which cell a day is, what a row owes and what it reached — against
 * the served threshold, never a number of this file's own.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { OffDayEntry, OffLeave } from '../../../../src/api/off-days.ts';
import type { TimeLoggingPerson } from '../../../../src/api/time-logging.ts';
import {
  cellState,
  dayHref,
  dueDays,
  isDoor,
  isWorkingDay,
  monthDays,
  monthHref,
  monthKey,
  monthLabel,
  offMarks,
  owedOn,
  rowTotals,
  sharedHoliday,
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
    off_days: [],
    ...overrides,
  };
}

const holiday = (day: string, label: string): OffDayEntry => ({
  day,
  holiday: { label },
  leave: null,
});
const leave = (day: string, over: Partial<OffLeave> = {}): OffDayEntry => ({
  day,
  holiday: null,
  leave: { part: 'full', status: 'approved', type: null, ...over },
});

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

  void test('time on a day that owed nothing keeps its figure: before joining, not yet, after they left', () => {
    const p = person([
      { day: '2026-10-30', c: 480 }, // before joining
      { day: '2026-11-13', c: 480 }, // not yet
    ]);
    const before = cellState(p, '2026-10-30', THRESHOLD);
    assert.deepEqual([before.state, before.figure, isDoor(before)], ['before', '8h', true]);
    assert.equal(before.aria, 'Bea Nkosi, Fri 30 Oct: 8h, before they joined');
    const future = cellState(p, '2026-11-13', THRESHOLD);
    assert.deepEqual([future.state, future.figure, isDoor(future)], ['future', '8h', true]);
    // Nothing owed and nothing held: a dash and no door.
    assert.equal(isDoor(cellState(p, '2026-10-29', THRESHOLD)), false);
    assert.equal(isDoor(cellState(p, '2026-11-14', THRESHOLD)), false);
    assert.equal(isDoor(cellState(p, '2026-11-07', THRESHOLD)), false, 'a quiet Saturday');
    // A due day is always a door: nothing logged, and today.
    assert.equal(isDoor(cellState(p, '2026-11-04', THRESHOLD)), true);
    assert.equal(isDoor(cellState(p, '2026-11-12', THRESHOLD)), true);
  });

  void test('a deactivated person owes no day: an empty day is a dash, time keeps its figure, no verdict', () => {
    const gone = person(
      [
        { day: '2026-11-02', c: 480 },
        { day: '2026-11-07', c: 60 },
      ],
      { user: { id: 'u2', name: 'Bea Nkosi', org_role: 'member', deactivated: true } },
    );
    const full = cellState(gone, '2026-11-02', THRESHOLD);
    assert.deepEqual(
      [full.state, full.figure, full.glyph, isDoor(full)],
      ['left', '8h', '—', true],
    );
    assert.equal(full.aria, 'Bea Nkosi, Mon 2 Nov: 8h, no longer here');
    const quiet = cellState(gone, '2026-11-03', THRESHOLD);
    assert.deepEqual([quiet.state, quiet.figure, isDoor(quiet)], ['left', '', false]);
    assert.equal(
      cellState(gone, '2026-11-07', THRESHOLD).state,
      'left',
      'a Saturday is no different',
    );
    // Before joining, not yet and today still come first.
    assert.equal(cellState(gone, '2026-10-30', THRESHOLD).state, 'before');
    assert.equal(cellState(gone, '2026-11-13', THRESHOLD).state, 'future');
    assert.equal(cellState(gone, '2026-11-12', THRESHOLD).state, 'today');
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

void describe('holidays and leave (D-149 item 6)', () => {
  void test('a holiday comes after not yet, before joining, today and gone — and before a day off', () => {
    const p = person([{ day: '2026-11-03', c: 120 }], {
      off_days: [
        holiday('2026-11-03', 'Heritage Day'), // a Tuesday, with time
        holiday('2026-11-07', 'Saturday Fair'), // a Saturday
        holiday('2026-11-12', 'Today Fair'), // today
        holiday('2026-11-13', 'Tomorrow Fair'), // tomorrow
        holiday('2026-10-30', 'Before Fair'), // before joining
      ],
    });
    const h = cellState(p, '2026-11-03', THRESHOLD);
    assert.deepEqual(
      [h.state, h.glyph, h.figure, h.owed, h.off, isDoor(h)],
      ['holiday', '✱', '2h', null, 'holiday', true],
    );
    assert.equal(h.aria, 'Bea Nkosi, Tue 3 Nov: 2h, Heritage Day — not due');
    // A holiday on a Saturday is the holiday, not the day off.
    assert.equal(cellState(p, '2026-11-07', THRESHOLD).state, 'holiday');
    assert.equal(
      cellState(p, '2026-11-07', THRESHOLD).aria,
      'Bea Nkosi, Sat 7 Nov: Saturday Fair — not due',
    );
    // Today, not yet and before joining keep their place, and say the holiday.
    const today = cellState(p, '2026-11-12', THRESHOLD);
    assert.deepEqual([today.state, today.off], ['today', 'holiday']);
    assert.equal(today.aria, 'Bea Nkosi, Thu 12 Nov: so far today, Today Fair');
    assert.equal(cellState(p, '2026-11-13', THRESHOLD).state, 'future');
    assert.equal(cellState(p, '2026-10-30', THRESHOLD).state, 'before');
    // Someone who has left: still no verdict, the holiday or not.
    const gone = person([], {
      user: { id: 'u2', name: 'Bea Nkosi', org_role: 'member', deactivated: true },
      off_days: [holiday('2026-11-03', 'Heritage Day')],
    });
    assert.equal(cellState(gone, '2026-11-03', THRESHOLD).state, 'left');
    // A quiet holiday is a mark and no door: nothing owed, nothing held.
    const quiet = cellState(
      person([], { off_days: [holiday('2026-11-03', 'Heritage Day')] }),
      '2026-11-03',
      THRESHOLD,
    );
    assert.deepEqual([quiet.state, quiet.figure, isDoor(quiet)], ['holiday', '', false]);
  });

  void test('approved whole-day leave is not due; its type is said only when sent', () => {
    const p = person([{ day: '2026-11-04', c: 60 }], {
      off_days: [leave('2026-11-04', { type: 'Annual' }), leave('2026-11-05')],
    });
    const typed = cellState(p, '2026-11-04', THRESHOLD);
    assert.deepEqual(
      [typed.state, typed.glyph, typed.figure, typed.owed, typed.off],
      ['leave', '◐', '1h', null, 'leave'],
    );
    assert.equal(typed.aria, 'Bea Nkosi, Wed 4 Nov: 1h, On leave · Annual — not due');
    assert.equal(
      cellState(p, '2026-11-05', THRESHOLD).aria,
      'Bea Nkosi, Thu 5 Nov: On leave — not due',
    );
    // A whole day, as the server also sends two halves of one status, owes nothing.
    assert.equal(owedOn(p, '2026-11-05').due, false);
  });

  void test('a holiday and leave on one day: the holiday, and both said', () => {
    const p = person([], {
      off_days: [
        {
          day: '2026-11-03',
          holiday: { label: 'Heritage Day' },
          leave: { part: 'full', status: 'approved', type: null },
        },
      ],
    });
    const c = cellState(p, '2026-11-03', THRESHOLD);
    assert.equal(c.state, 'holiday');
    assert.equal(c.aria, 'Bea Nkosi, Tue 3 Nov: Heritage Day · On leave — not due');
  });

  void test('approved half-day leave owes half the threshold: 240 of 480 is full, 239 is under', () => {
    const p = person(
      [
        { day: '2026-11-02', c: 240 },
        { day: '2026-11-03', c: 200, d: 39 },
        { day: '2026-11-05', c: 470 },
      ],
      {
        off_days: [
          leave('2026-11-02', { part: 'first_half' }),
          leave('2026-11-03', { part: 'second_half' }),
          leave('2026-11-04', { part: 'first_half' }),
        ],
      },
    );
    const full = cellState(p, '2026-11-02', THRESHOLD);
    assert.deepEqual([full.state, full.owed, full.off, full.glyph], ['full', 240, 'leave', '✓']);
    assert.equal(full.aria, 'Bea Nkosi, Mon 2 Nov: 4h, 4h or more, full day, On leave · morning');
    const under = cellState(p, '2026-11-03', THRESHOLD);
    assert.deepEqual([under.state, under.owed], ['under', 240]);
    assert.equal(under.aria, 'Bea Nkosi, Tue 3 Nov: 3h 59m, under 4h, On leave · afternoon');
    const none = cellState(p, '2026-11-04', THRESHOLD);
    assert.deepEqual([none.state, none.owed, isDoor(none)], ['none', 240, true]);
    // An ordinary day still owes the whole threshold: 470 is under.
    const plain = cellState(p, '2026-11-05', THRESHOLD);
    assert.deepEqual([plain.state, plain.owed, plain.off], ['under', 480, null]);
    // Half of the server's threshold, not of a number typed here.
    assert.equal(cellState(p, '2026-11-03', 478).state, 'full', '239 is half of 478');
  });

  void test('pending leave changes nothing: the verdict stands, and the words say it was requested', () => {
    const p = person(
      [
        { day: '2026-11-03', c: 480 },
        { day: '2026-11-04', c: 240 },
      ],
      {
        off_days: [
          leave('2026-11-02', { status: 'pending' }),
          leave('2026-11-03', { status: 'pending' }),
          leave('2026-11-04', { status: 'pending', part: 'first_half' }),
        ],
      },
    );
    const none = cellState(p, '2026-11-02', THRESHOLD);
    assert.deepEqual(
      [none.state, none.owed, none.off, none.glyph],
      ['none', 480, 'requested', '✕'],
    );
    assert.equal(none.aria, 'Bea Nkosi, Mon 2 Nov: nothing logged, Leave requested');
    assert.equal(cellState(p, '2026-11-03', THRESHOLD).state, 'full');
    // A requested half day owes the whole day: 240 is under.
    const half = cellState(p, '2026-11-04', THRESHOLD);
    assert.deepEqual([half.state, half.owed], ['under', 480]);
  });

  void test('offMarks: the legend’s marks are the cells as drawn, never the raw off_days', () => {
    const { days } = monthDays('2026-11');
    const marks = (...people: TimeLoggingPerson[]) => offMarks(people, days, THRESHOLD);
    const none = { holiday: false, leave: false, half: false, requested: false, quiet: [] };
    // The only holiday is tomorrow: a dash with a corner mark, never the holiday's fill.
    assert.deepEqual(marks(person([], { off_days: [holiday('2026-11-13', 'Tomorrow Fair')] })), {
      ...none,
      quiet: ['holiday'],
    });
    // On a due day it is the fill.
    assert.deepEqual(marks(person([], { off_days: [holiday('2026-11-03', 'Heritage Day')] })), {
      ...none,
      holiday: true,
    });
    // Whole-day leave today, before joining, or for someone gone: corner marks only.
    assert.deepEqual(marks(person([], { off_days: [leave('2026-11-12')] })), {
      ...none,
      quiet: ['leave'],
    });
    assert.deepEqual(
      marks(person([], { joined_day: '2026-11-05', off_days: [leave('2026-11-04')] })),
      { ...none, quiet: ['leave'] },
    );
    assert.deepEqual(
      marks(
        person([], {
          user: { id: 'u2', name: 'Bea Nkosi', org_role: 'member', deactivated: true },
          off_days: [leave('2026-11-04')],
        }),
      ),
      { ...none, quiet: ['leave'] },
    );
    // A half day on a Saturday owes nothing: no half-day legend, a corner mark.
    assert.deepEqual(
      marks(person([], { off_days: [leave('2026-11-07', { part: 'first_half' })] })),
      { ...none, quiet: ['leave'] },
    );
    // A due half day, and a due request, are their own entries.
    assert.deepEqual(
      marks(
        person([], {
          off_days: [
            leave('2026-11-02', { part: 'first_half' }),
            leave('2026-11-04', { status: 'pending' }),
            leave('2026-11-20', { status: 'pending' }),
          ],
        }),
      ),
      { ...none, half: true, requested: true, quiet: ['requested'] },
    );
    // Whole-day leave on a due day is the fill; the quiet kinds come in tone order.
    assert.deepEqual(
      marks(
        person([], {
          off_days: [
            leave('2026-11-03'),
            leave('2026-11-25', { status: 'pending' }),
            leave('2026-11-24'),
            holiday('2026-11-30', 'Month End'),
          ],
        }),
      ),
      { ...none, leave: true, quiet: ['holiday', 'leave', 'requested'] },
    );
    assert.deepEqual(marks(), none);
  });

  void test('sharedHoliday: the head says a holiday only when everyone shown has it, under one name', () => {
    const a = person([], { off_days: [holiday('2026-11-03', 'Heritage Day')] });
    const b = person([], {
      user: { id: 'u3', name: 'Cleo Adams', org_role: 'member', deactivated: false },
      off_days: [holiday('2026-11-03', 'Heritage Day'), holiday('2026-11-04', 'Diwali')],
    });
    const c = person([], {
      user: { id: 'u4', name: 'Dev Rao', org_role: 'member', deactivated: false },
      off_days: [holiday('2026-11-03', 'Founders Day'), leave('2026-11-05')],
    });
    assert.equal(sharedHoliday([a, b], '2026-11-03'), 'Heritage Day');
    assert.equal(sharedHoliday([a, b, c], '2026-11-03'), null, 'two names');
    assert.equal(sharedHoliday([a, b], '2026-11-04'), null, 'one person without it');
    assert.equal(sharedHoliday([c], '2026-11-05'), null, 'leave is not a holiday');
    assert.equal(sharedHoliday([], '2026-11-03'), null, 'nobody shown');
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

  void test('dueDays: a holiday and approved whole-day leave are not due; a half day and pending leave are', () => {
    // Mon 2 to Wed 11 is eight working days. Tue 3 a holiday, Wed 4 on leave:
    // six. Thu 5 a half day and Fri 6 leave requested still owe.
    const p = person([], {
      off_days: [
        holiday('2026-11-03', 'Heritage Day'),
        leave('2026-11-04'),
        leave('2026-11-05', { part: 'first_half' }),
        leave('2026-11-06', { status: 'pending' }),
      ],
    });
    assert.equal(dueDays(p, days), 6);
    // A holiday on a Saturday takes nothing off: the Saturday never owed.
    assert.equal(dueDays(person([], { off_days: [holiday('2026-11-07', 'A Saturday')] }), days), 8);
    // A holiday today or tomorrow takes nothing off either: neither was due yet.
    assert.equal(
      dueDays(
        person([], {
          off_days: [holiday('2026-11-12', 'Today'), holiday('2026-11-13', 'Tomorrow')],
        }),
        days,
      ),
      8,
    );
  });

  void test('rowTotals: time on a holiday or a day on leave counts toward hours, never toward days', () => {
    const p = person(
      [
        { day: '2026-11-02', c: 480 }, // full
        { day: '2026-11-03', c: 480 }, // a full day's time on a holiday
        { day: '2026-11-04', c: 540 }, // more than a day's time on leave
        { day: '2026-11-05', c: 240 }, // a half day: half the threshold is full
        { day: '2026-11-06', c: 480 }, // leave requested: due, and full
      ],
      {
        off_days: [
          holiday('2026-11-03', 'Heritage Day'),
          leave('2026-11-04', { type: 'Annual' }),
          leave('2026-11-05', { part: 'second_half' }),
          leave('2026-11-06', { status: 'pending' }),
        ],
      },
    );
    const t = rowTotals(p, days, THRESHOLD);
    assert.deepEqual(t, { minutes: 480 + 480 + 540 + 240 + 480, full: 3, due: 6 });
  });

  void test('dayHref opens that person’s Day on their profile, encoded', () => {
    assert.equal(dayHref('u2', '2026-11-02'), '/people?user=u2&tab=day&day=2026-11-02');
    assert.equal(dayHref('a b', '2026-11-02'), '/people?user=a+b&tab=day&day=2026-11-02');
  });
});
