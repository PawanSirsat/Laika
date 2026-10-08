/**
 * `routes/screens/timeline/timeline-derive.ts` (LAI-084, LAI-721).
 *
 * The axis arithmetic for sprint rows on a scrolling, zoomable axis. Two
 * properties matter more than the rest: a sprint's span is exactly its
 * inclusive dates on the window, and **nothing here gives a task a position**
 * — §11.4.3, and D-074 withdrawing D-049's task rows.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Sprint } from '../../../../src/api/sprints.ts';
import {
  AXIS_YEARS,
  axisProblem,
  blockedTally,
  chartWindow,
  countdownFor,
  countsProgress,
  DAY_WIDTH,
  dayIndex,
  isCurrent,
  isPast,
  monthBands,
  onAxis,
  quarterBands,
  readZoom,
  sprintPhase,
  sprintSpan,
  startOfDay,
  todayLabel,
  weekTicks,
} from '../../../../src/routes/screens/timeline/timeline-derive.ts';

const DAY = 24 * 60 * 60 * 1000;
const day = (iso: string): number => Date.parse(`${iso}T00:00:00.000Z`);
/** Day `n` relative to 1 Aug, for the bar tests — negative reaches before it. */
const d = (n: number): number => day('2026-08-01') + n * DAY;

function sprint(over: Partial<Sprint> & { id: string }): Sprint {
  return {
    name: `Sprint ${over.id}`,
    goal: null,
    starts_on: day('2026-08-01'),
    ends_on: day('2026-08-14'),
    status: 'planned',
    project_id: 'p',
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

/** 1–14 Aug, then a gap, then 20 Aug–2 Sept. */
const A = sprint({ id: 'a', starts_on: day('2026-08-01'), ends_on: day('2026-08-14') });
const B = sprint({ id: 'b', starts_on: day('2026-08-20'), ends_on: day('2026-09-02') });

void describe('chartWindow — whole months around every sprint and today', () => {
  void test('starts on the 1st and ends on the last day of a month, with a week of air', () => {
    const w = chartWindow([A, B], day('2026-08-10'))!;
    // A starts 1 Aug: a week earlier is July, so the window opens on 1 July.
    assert.equal(w.from, day('2026-07-01'));
    // B ends 2 Sept: a week later is still September, so it closes on 30 Sept.
    assert.equal(w.to, day('2026-09-30'));
    assert.equal(w.days, 92);
  });

  void test('reaches today when today is outside every sprint — the Today button needs it', () => {
    const w = chartWindow([A], day('2026-12-03'))!;
    assert.equal(w.to, day('2026-12-31'), 'today is past the window');
  });

  void test('ignores the order sprints arrive in, and no sprints is no chart', () => {
    assert.deepEqual(chartWindow([B, A], d(5)), chartWindow([A, B], d(5)));
    assert.equal(chartWindow([], d(5)), null);
  });
});

void describe('dayIndex and sprintSpan — a sprint is its inclusive dates', () => {
  const w = chartWindow([A, B], day('2026-08-10'))!;

  void test('the first day is index 0, and the time of day does not move it', () => {
    assert.equal(dayIndex(w, day('2026-07-01')), 0);
    assert.equal(dayIndex(w, day('2026-07-01') + 23 * 60 * 60 * 1000), 0);
    assert.equal(dayIndex(w, day('2026-08-01')), 31);
  });

  void test('a sprint starts on its first day and covers its last', () => {
    assert.deepEqual(sprintSpan(w, A), { start: 31, days: 14 });
    assert.deepEqual(sprintSpan(w, B), { start: 50, days: 14 });
  });

  void test('neighbours never overlap and the gap between them is real', () => {
    const a = sprintSpan(w, A);
    const b = sprintSpan(w, B);
    assert.equal(b.start - (a.start + a.days), 5, '15–19 Aug is a five-day gap');
  });
});

void describe('the header — months, quarters and Mondays', () => {
  const w = chartWindow([A, B], day('2026-08-10'))!;

  void test('month bands start where the month starts and sum to the window', () => {
    assert.deepEqual(
      monthBands(w).map((m) => [m.label, m.start, m.days]),
      [
        ['Jul 2026', 0, 31],
        ['Aug 2026', 31, 31],
        ['Sept 2026', 62, 30],
      ],
    );
    assert.deepEqual(
      monthBands(w, true).map((m) => m.label),
      ['Jul', 'Aug', 'Sept'],
    );
  });

  void test('gives every band a unique key, even the same month a year apart', () => {
    const long = chartWindow(
      [A, sprint({ id: 'z', starts_on: day('2027-08-01'), ends_on: day('2027-08-05') })],
      day('2026-08-10'),
    )!;
    const keys = monthBands(long).map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  void test('quarters cut where the calendar does', () => {
    assert.deepEqual(
      quarterBands(w).map((b) => [b.label, b.start, b.days]),
      [['Q3 2026', 0, 92]],
    );
    assert.deepEqual(
      quarterBands(chartWindow([A], day('2026-10-02'))!).map((b) => b.label),
      ['Q3 2026', 'Q4 2026'],
    );
  });

  void test('every tick is a Monday, a week apart', () => {
    const ticks = weekTicks(w);
    assert.ok(ticks.length >= 13, 'positive control: thirteen weeks in three months');
    for (const tick of ticks) {
      assert.equal(new Date(w.from + tick.index * DAY).getUTCDay(), 1, `day ${String(tick.index)}`);
    }
    for (let i = 1; i < ticks.length; i += 1) {
      assert.equal(ticks[i]!.index - ticks[i - 1]!.index, 7);
    }
    // 6 July 2026 is the first Monday in the window.
    assert.deepEqual(ticks[0], { index: 5, label: '6' });
  });
});

void describe('zoom', () => {
  void test('three scales, each wider than the next', () => {
    assert.ok(DAY_WIDTH.weeks > DAY_WIDTH.months && DAY_WIDTH.months > DAY_WIDTH.quarters);
  });

  void test('anything unknown in `?zoom=` is Months', () => {
    assert.equal(readZoom('weeks'), 'weeks');
    assert.equal(readZoom('quarters'), 'quarters');
    assert.equal(readZoom(null), 'months');
    assert.equal(readZoom('days'), 'months');
  });
});

void describe('sprintPhase — by the dates, not the stored status', () => {
  void test('past, current and future', () => {
    assert.equal(sprintPhase(A, day('2026-08-20')), 'past');
    assert.equal(sprintPhase(A, day('2026-08-14')), 'current');
    assert.equal(sprintPhase(A, day('2026-07-31')), 'future');
    assert.equal(sprintPhase({ ...A, status: 'active' }, day('2026-09-30')), 'past');
  });
});

void describe('past and current', () => {
  void test('a finished sprint is past; §11.4.3 dims rather than hides it', () => {
    assert.equal(isPast(A, day('2026-08-15')), true);
    assert.equal(isPast(A, day('2026-08-14')), false, 'the last day is not past');
  });

  void test('current spans the whole inclusive range', () => {
    assert.equal(isCurrent(A, day('2026-08-01')), true);
    assert.equal(isCurrent(A, day('2026-08-14')), true);
    assert.equal(isCurrent(A, day('2026-07-31')), false);
    assert.equal(isCurrent(A, day('2026-08-15')), false);
  });

  void test('current is about dates, not the stored status', () => {
    // A `planned` sprint whose dates have arrived is still where today is. The
    // status is the lead's declaration; this is the calendar.
    assert.equal(isCurrent(sprint({ id: 'p', status: 'planned' }), day('2026-08-05')), true);
  });
});

void describe('startOfDay', () => {
  void test('truncates to UTC midnight', () => {
    assert.equal(startOfDay(day('2026-08-05') + DAY - 1), day('2026-08-05'));
  });
});

void describe('countdownFor — the three sentences and their edges (LAI-436)', () => {
  const SPRINT = sprint({ id: 'sc', starts_on: d(0), ends_on: d(9) });

  void test('the day before it starts, and the first day', () => {
    assert.deepEqual(countdownFor(SPRINT, d(-1)), { kind: 'starts_in', days: 1 });
    // The first day is inside it, so it is already counting down rather than up.
    assert.deepEqual(countdownFor(SPRINT, d(0)), { kind: 'left', days: 10 });
  });

  void test('the last day, and the day after', () => {
    assert.deepEqual(countdownFor(SPRINT, d(9)), { kind: 'left', days: 1 });
    assert.deepEqual(countdownFor(SPRINT, d(10)), { kind: 'ended', days: 1 });
  });

  void test('the stored status does not decide it — the dates do', () => {
    // §11.4.3 already treats `status` as a label rather than the truth, because
    // a sprint left `active` past its end date is ordinary. A countdown driven
    // by the stored value would say "days left" for a sprint that is over.
    const stale = { ...SPRINT, status: 'active' as const };
    assert.equal(countdownFor(stale, d(30)).kind, 'ended');

    const early = { ...SPRINT, status: 'completed' as const };
    assert.equal(countdownFor(early, d(2)).kind, 'left');
  });
});

void describe('axisProblem — what is drawn, and why not (LAI-721 review)', () => {
  const NOW = day('2026-10-08');
  const at = (starts: number, ends: number) =>
    sprint({ id: 'x', starts_on: starts, ends_on: ends });
  const year = 366 * DAY;

  void test('a sprint six years back, or six years ahead, is drawn — and so is 2062', () => {
    assert.equal(onAxis(at(NOW - 6 * year, NOW - 6 * year + 13 * DAY), NOW), true, '6 years back');
    assert.equal(onAxis(at(NOW + 6 * year, NOW + 6 * year + 13 * DAY), NOW), true, '6 years on');
    assert.equal(onAxis(at(day('2026-10-01'), day('2062-03-01')), NOW), true, '2062');
  });

  void test('not a date is `invalid`; a real date past the reach is `beyond`', () => {
    assert.equal(axisProblem(at(day('2026-10-01'), 1e17), NOW), 'invalid', '1e17');
    assert.equal(axisProblem(at(Number.NaN, day('2026-10-14')), NOW), 'invalid', 'NaN');
    assert.equal(
      axisProblem(at(day('2026-10-14'), day('2026-10-01')), NOW),
      'invalid',
      'backwards',
    );
    assert.equal(axisProblem(at(day('2026-10-01'), Date.UTC(9999, 0, 1)), NOW), 'beyond', '9999');
    assert.equal(axisProblem(at(day('2026-10-01'), day('2026-10-14')), NOW), undefined);
  });

  void test(`the reach is ${String(AXIS_YEARS)} years either side of today`, () => {
    assert.equal(onAxis(at(NOW, NOW + (AXIS_YEARS - 0.1) * year), NOW), true);
    assert.equal(onAxis(at(NOW, NOW + (AXIS_YEARS + 0.1) * year), NOW), false);
  });

  void test('the widest drawable window steps by month and week, not by day', () => {
    const reach = AXIS_YEARS * 365 * DAY;
    const wide = chartWindow(
      [at(NOW - reach, NOW - reach + 13 * DAY), at(NOW + reach - 13 * DAY, NOW + reach)],
      NOW,
    )!;
    const calls = { n: 0 };
    // The descriptor, not `Date.prototype.toLocaleDateString`: the method is
    // restored below, never called detached from a date.
    const descriptor = Object.getOwnPropertyDescriptor(Date.prototype, 'toLocaleDateString')!;
    const original = descriptor.value as (
      this: Date,
      ...args: Parameters<Date['toLocaleDateString']>
    ) => string;
    Date.prototype.toLocaleDateString = function (
      this: Date,
      ...args: Parameters<Date['toLocaleDateString']>
    ) {
      calls.n += 1;
      return original.apply(this, args);
    };
    try {
      const started = performance.now();
      const months = monthBands(wide);
      const ticks = weekTicks(wide);
      const elapsed = performance.now() - started;
      // The work, counted: one label per month band, ~1,200 of them over a
      // century, not one per day (~36,500).
      assert.equal(calls.n, months.length, 'formatted a label for every day');
      assert.ok(months.length > 1000 && months.length < 1300, `${String(months.length)} months`);
      assert.equal(ticks.length, Math.floor((wide.days - ticks[0]!.index - 1) / 7) + 1);
      // A time bound only as a backstop, generous enough not to flake.
      assert.ok(elapsed < 600, `the header took ${elapsed.toFixed(1)} ms`);
    } finally {
      Object.defineProperty(Date.prototype, 'toLocaleDateString', descriptor);
    }
  });

  void test('bands tile the window exactly, at both zooms', () => {
    const w = chartWindow([A, B], day('2026-08-10'), 'quarters')!;
    for (const bandsOf of [monthBands(w), quarterBands(w)]) {
      assert.equal(bandsOf[0]!.start, 0);
      for (let i = 1; i < bandsOf.length; i += 1) {
        assert.equal(bandsOf[i]!.start, bandsOf[i - 1]!.start + bandsOf[i - 1]!.days);
      }
      const last = bandsOf[bandsOf.length - 1]!;
      assert.equal(last.start + last.days, w.days);
    }
  });
});

void describe('chartWindow at Quarters — whole quarters (LAI-721 review)', () => {
  void test('starts on a quarter’s first day and ends on a quarter’s last', () => {
    const w = chartWindow([B], day('2026-08-10'), 'quarters')!;
    assert.equal(w.from, day('2026-07-01'), 'Q3 starts 1 July');
    assert.equal(w.to, day('2026-09-30'), 'Q3 ends 30 Sept');
    const later = chartWindow([B], day('2026-11-20'), 'quarters')!;
    assert.equal(later.to, day('2026-12-31'), 'not mid-Q4');
  });
});

void describe('todayLabel — the UTC day the line is drawn on (LAI-721 review)', () => {
  void test('23:30 UTC on 8 Oct is THU 8 OCT, whatever the local clock says', () => {
    // Either side of Greenwich: a local reading is a day out in one of them.
    const zone = process.env.TZ;
    try {
      for (const tz of ['America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
        process.env.TZ = tz;
        assert.equal(todayLabel(Date.UTC(2026, 9, 8, 23, 30)), 'THU 8 OCT', tz);
        assert.equal(todayLabel(Date.UTC(2026, 9, 9, 0, 30)), 'FRI 9 OCT', tz);
      }
      // Positive control: the zone change reached the clock this test reads.
      process.env.TZ = 'America/Los_Angeles';
      assert.equal(new Date(Date.UTC(2026, 9, 8, 0, 0)).getDate(), 7, 'TZ did not take');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

void describe('counts from the sprint list (LAI-721 review)', () => {
  void test('done over total leaves cancelled out of both', () => {
    assert.deepEqual(
      countsProgress({
        total: 5,
        by_status: { backlog: 1, todo: 0, in_progress: 1, review: 0, done: 2, cancelled: 1 },
      }),
      { done: 2, total: 4, percent: 50 },
    );
    assert.deepEqual(
      countsProgress({
        total: 0,
        by_status: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
      }),
      { done: 0, total: 0, percent: 0 },
    );
  });

  void test('a blocker that is not loaded is unknown, not unblocked', () => {
    const t = (id: string, status: string, blocked_by: string[] = []) =>
      ({ id, status, blocked_by }) as unknown as Parameters<typeof blockedTally>[0][number];
    assert.deepEqual(
      blockedTally([
        t('a', 'todo'),
        t('b', 'todo', ['a']), // blocked by an open task here
        t('c', 'todo', ['elsewhere']), // blocker not loaded
        t('d', 'todo', ['gone', 'a']), // blocked here, whatever the other is
        t('e', 'done', ['f']),
        t('f', 'done'),
        // Finished work is never "blocked?", whatever it waited on.
        t('g', 'done', ['elsewhere']),
        t('h', 'cancelled', ['a']),
      ]),
      { blocked: 2, unknown: 1 },
    );
  });
});
