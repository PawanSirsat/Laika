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
  chartWindow,
  countdownFor,
  DAY_WIDTH,
  dayIndex,
  isCurrent,
  isPast,
  monthBands,
  quarterBands,
  readZoom,
  sprintPhase,
  sprintSpan,
  sprintSummary,
  startOfDay,
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

/**
 * The successor to *"D-014 — tasks never get a position on the axis"*.
 *
 * **D-049 retired that guard and authorised this replacement.** Tasks get bars
 * now; what survives is the rule the old guard was really protecting:
 *
 * > **Laika never asserts a date it was not told.**
 *
 * So this does not check that bars are absent. It checks that **no bar is drawn
 * from a date the task does not have** — an unmeasured end falls back to the
 * sprint and is marked as a plan, and a task with neither gets no bar at all.
 */
void describe('the active sprint strip: DONE · BLOCKED · WIP · DAYS LEFT', () => {
  /** All four differ on purpose — four equal counts is a test that cannot fail. */
  const TASKS = [
    { status: 'done' },
    { status: 'done' },
    { status: 'done' },
    { status: 'in_progress' },
    { status: 'in_progress' },
    { status: 'todo' },
    { status: 'todo' },
    { status: 'todo' },
    { status: 'todo' },
  ];
  const BLOCKED = 1;
  const SPRINT = sprint({ id: 's', starts_on: d(0), ends_on: d(9) });

  void test('each count is itself, and no two are accidentally equal', () => {
    const summary = sprintSummary(TASKS, BLOCKED, SPRINT, d(3));
    assert.deepEqual(summary, {
      done: 3,
      total: 9,
      blocked: 1,
      wip: 2,
      countdown: { kind: 'left', days: 7 },
    });

    const four = [summary.done, summary.blocked, summary.wip, summary.countdown.days];
    assert.equal(new Set(four).size, 4, 'the fixture must keep all four distinct');
  });

  void test('blocked is passed in, not recomputed', () => {
    // `board-derive.ts` owns that rule. A second one drifts from it — the
    // LAI-215 `initials()` problem.
    assert.equal(sprintSummary(TASKS, 7, SPRINT, d(3)).blocked, 7);
  });

  void test('a finished sprint says it ended, rather than having zero days left', () => {
    // LAI-434 clamped this at zero, which stopped it reading minus seven — and
    // left `DAYS LEFT 0` on a sprint that finished last week, which is
    // indistinguishable from one ending tonight. Once a sprint can be selected
    // (LAI-436) that difference is the whole point of selecting it.
    assert.deepEqual(sprintSummary(TASKS, 0, SPRINT, d(20)).countdown, {
      kind: 'ended',
      days: 11,
    });
  });

  void test('a sprint that has not begun counts to its start, not from its end', () => {
    assert.deepEqual(sprintSummary(TASKS, 0, SPRINT, d(-3)).countdown, {
      kind: 'starts_in',
      days: 3,
    });
  });

  void test('the last day of the sprint has one day left, not zero', () => {
    // **This assertion is the opposite of the one it replaces, and the flip is
    // the finding.** The old one said zero, citing §4.15 for *"on the final day
    // there is no day left after today"* — §4.15 says only that the dates are
    // date-only, and if `ends_on` is inclusive then the final day is a day left.
    //
    // `sprint-derive`'s `daysLeft` has always said one, with the better reason:
    // *"the day you are standing in is still a day you can work"*. **The board's
    // strip and the timeline's were showing different numbers for the same
    // sprint on the same day.** `countdownFor` now calls `daysLeft` rather than
    // counting again, so there is one answer.
    assert.equal(sprintSummary(TASKS, 0, SPRINT, d(9)).countdown.days, 1);
  });

  void test('an empty sprint is zeroes, not a division by nothing', () => {
    assert.deepEqual(sprintSummary([], 0, SPRINT, d(3)), {
      done: 0,
      total: 0,
      blocked: 0,
      wip: 2 - 2,
      countdown: { kind: 'left', days: 7 },
    });
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
