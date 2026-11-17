/**
 * The Calendar's day arithmetic for keyboard moves and paging (LAI-1200),
 * restored by LAI-1218 onto the combined calendar: PageUp and PageDown step a
 * week in Week view, the week is an address, and a day names no overdue count
 * because overdue work lives in the lane alone.
 *
 * **Run in a zone with daylight saving.** US clocks go back on 1 November
 * 2026, so a day there is 25 hours long: adding 24h lands on 23:00 the day
 * before, and the focused day would stick. `node --test` gives each file its
 * own process, so the zone set here changes nothing else.
 */

process.env.TZ = 'America/Los_Angeles';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addDays,
  addMonths,
  dayLabel,
  moveDay,
  nearestDueOutside,
  periodParams,
  sprintOnDay,
  weekOf,
  weekParam,
  weekParamOf,
} from '../../../../src/routes/screens/calendar/calendar-derive.ts';
import type { TaskStatus } from '../../../../src/api/tasks.ts';

const local = (y: number, m: number, d: number): number => new Date(y, m, d).getTime();
const ymd = (at: number): [number, number, number] => {
  const d = new Date(at);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

void describe('moving by days and months', () => {
  void test('the zone really has a 25-hour day on 1 November 2026', () => {
    // The control: without it the DST assertion below could pass by luck.
    assert.equal(local(2026, 10, 2) - local(2026, 10, 1), 25 * 3_600_000);
  });

  void test('a day forward across the clock change is the next date, at midnight', () => {
    const next = addDays(local(2026, 10, 1), 1);
    assert.deepEqual(ymd(next), [2026, 11, 2]);
    assert.equal(new Date(next).getHours(), 0);
  });

  void test('a month forward keeps the day, and clamps where the month is short', () => {
    assert.deepEqual(ymd(addMonths(local(2026, 10, 14), 1)), [2026, 12, 14]);
    assert.deepEqual(ymd(addMonths(local(2027, 0, 31), 1)), [2027, 2, 28]);
    assert.deepEqual(ymd(addMonths(local(2026, 0, 15), -1)), [2025, 12, 15]);
  });
});

void describe('moveDay, the grid keys', () => {
  /** Wednesday 11 November 2026. */
  const WED = local(2026, 10, 11);
  for (const [key, want] of [
    ['ArrowLeft', [2026, 11, 10]],
    ['ArrowRight', [2026, 11, 12]],
    ['ArrowUp', [2026, 11, 4]],
    ['ArrowDown', [2026, 11, 18]],
    ['Home', [2026, 11, 9]],
    ['End', [2026, 11, 15]],
    ['PageUp', [2026, 10, 11]],
    ['PageDown', [2026, 12, 11]],
  ] as const) {
    void test(key, () => {
      assert.deepEqual(ymd(moveDay(WED, key)), want);
    });
  }

  void test('in Week view PageUp and PageDown step a week; the arrows are unchanged', () => {
    assert.deepEqual(ymd(moveDay(WED, 'PageUp', 'week')), [2026, 11, 4]);
    assert.deepEqual(ymd(moveDay(WED, 'PageDown', 'week')), [2026, 11, 18]);
    assert.deepEqual(ymd(moveDay(WED, 'ArrowRight', 'week')), [2026, 11, 12]);
    assert.deepEqual(ymd(moveDay(WED, 'PageDown', 'month')), [2026, 12, 11]);
  });

  void test('Home on a Monday and End on a Sunday stay put', () => {
    assert.deepEqual(ymd(moveDay(local(2026, 10, 9), 'Home')), [2026, 11, 9]);
    assert.deepEqual(ymd(moveDay(local(2026, 10, 15), 'End')), [2026, 11, 15]);
  });
});

void describe('weekOf', () => {
  void test('Monday to Sunday around the anchor, today marked', () => {
    const week = weekOf(local(2026, 10, 11), local(2026, 10, 12));
    assert.equal(week.label, 'W46');
    assert.deepEqual(
      week.days.map((d) => d.dayOfMonth),
      [9, 10, 11, 12, 13, 14, 15],
    );
    assert.deepEqual(
      week.days.filter((d) => d.isToday).map((d) => d.dayOfMonth),
      [12],
    );
  });
});

void describe('dayLabel', () => {
  void test('date first, then today, tasks and sprint', () => {
    assert.equal(
      dayLabel(local(2026, 10, 10), { tasks: 3, today: true, sprint: 'S2 Receipts' }, 'en-GB'),
      'Tuesday 10 November, today, 3 tasks, S2 Receipts',
    );
  });

  void test('one task is singular; none says so', () => {
    assert.equal(
      dayLabel(local(2026, 10, 12), { tasks: 1, today: false }, 'en-GB'),
      'Thursday 12 November, 1 task',
    );
    assert.equal(
      dayLabel(local(2026, 10, 12), { tasks: 0, today: false }, 'en-GB'),
      'Thursday 12 November, no tasks',
    );
  });
});

void describe('the week in the address (LAI-1218)', () => {
  const NOW = local(2026, 10, 11) + 12 * 3_600_000;

  void test('any day of a week names its Monday; anything else is this week', () => {
    assert.deepEqual(ymd(weekParamOf('2026-11-18', NOW)), [2026, 11, 16]);
    assert.deepEqual(ymd(weekParamOf('2026-11-16', NOW)), [2026, 11, 16]);
    assert.deepEqual(ymd(weekParamOf(undefined, NOW)), [2026, 11, 9]);
    assert.deepEqual(ymd(weekParamOf('2026-02-31', NOW)), [2026, 11, 9]);
    assert.deepEqual(ymd(weekParamOf('nope', NOW)), [2026, 11, 9]);
  });

  void test('a week writes as its Monday, across the clock change', () => {
    assert.equal(weekParam(local(2026, 10, 1)), '2026-10-26');
    assert.equal(weekParam(local(2026, 10, 4)), '2026-11-02');
  });

  void test('defaults are dropped: month view, this month, this week', () => {
    assert.deepEqual(periodParams('month', NOW, NOW), {
      view: undefined,
      month: undefined,
      week: undefined,
    });
    assert.deepEqual(periodParams('month', local(2027, 1, 3), NOW), {
      view: undefined,
      month: '2027-02',
      week: undefined,
    });
    assert.deepEqual(periodParams('week', local(2026, 10, 13), NOW), {
      view: 'week',
      month: undefined,
      week: undefined,
    });
    assert.deepEqual(periodParams('week', local(2026, 10, 19), NOW), {
      view: 'week',
      month: undefined,
      week: '2026-11-16',
    });
  });
});

void describe('nearestDueOutside, the empty period’s way on', () => {
  const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);
  const t = (due: number | null, status: TaskStatus = 'todo') => ({ due_on: due, status });
  const FROM = local(2027, 0, 1);
  const TO = local(2027, 0, 31);

  void test('the soonest date ahead wins over a nearer one behind', () => {
    const at = nearestDueOutside(
      [t(utc(2026, 11, 30)), t(utc(2027, 2, 9)), t(utc(2027, 1, 3))],
      FROM,
      TO,
    );
    assert.deepEqual(ymd(at ?? 0), [2027, 2, 3]);
  });

  void test('nothing ahead: the latest date behind', () => {
    const at = nearestDueOutside([t(utc(2026, 10, 18)), t(utc(2026, 11, 2))], FROM, TO);
    assert.deepEqual(ymd(at ?? 0), [2026, 12, 2]);
  });

  void test('finished and undated work leads nowhere', () => {
    assert.equal(
      nearestDueOutside(
        [t(utc(2027, 1, 3), 'done'), t(utc(2027, 1, 4), 'cancelled'), t(null)],
        FROM,
        TO,
      ),
      undefined,
    );
  });
});

void describe('sprintOnDay', () => {
  const sprints = [
    {
      name: 'Receipts',
      starts_on: Date.UTC(2026, 10, 2),
      ends_on: Date.UTC(2026, 10, 13),
      status: 'completed',
    },
    {
      name: 'Ledger',
      starts_on: Date.UTC(2026, 10, 16),
      ends_on: Date.UTC(2026, 10, 27),
      status: 'active',
    },
  ];

  void test('a sprint’s first and last days are its own, in a zone west of UTC', () => {
    const first = sprintOnDay(local(2026, 10, 16), sprints);
    assert.deepEqual(
      [first?.tag, first?.running, first?.first, first?.last],
      ['S2', true, true, false],
    );
    const last = sprintOnDay(local(2026, 10, 27), sprints);
    assert.deepEqual([last?.first, last?.last], [false, true]);
  });

  void test('a day between sprints is in none', () => {
    assert.equal(sprintOnDay(local(2026, 10, 14), sprints), undefined);
  });
});
