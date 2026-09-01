/**
 * `routes/screens/timeline/timeline-derive.ts` (LAI-084).
 *
 * The axis arithmetic. Two properties matter more than the rest: the track's
 * segments must always sum to the range (or the header stops lining up with the
 * bars), and **nothing here may give a task a position** — D-014's whole point.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Sprint } from '../../../../src/api/sprints.ts';
import {
  isCurrent,
  isPast,
  monthBands,
  startOfDay,
  sprintSummary,
  taskActuals,
  taskBar,
  timelineRange,
  todayPosition,
  toSegments,
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

void describe('timelineRange', () => {
  void test('spans the earliest start to the latest end, inclusive', () => {
    const range = timelineRange([A, B]);

    assert.equal(range?.from, day('2026-08-01'));
    assert.equal(range?.to, day('2026-09-02'));
    // 1 Aug → 2 Sept inclusive is 33 days, not 32.
    assert.equal(range?.days, 33);
  });

  void test('a single sprint is its own axis', () => {
    assert.deepEqual(timelineRange([A]), {
      from: day('2026-08-01'),
      to: day('2026-08-14'),
      days: 14,
    });
  });

  void test('no sprints means no axis at all, so the screen can say so', () => {
    // `null` rather than a zero-width range: an axis with no bars is a chart
    // that looks broken, and the screen renders the empty state instead.
    assert.equal(timelineRange([]), null);
  });

  void test('is not stretched to reach today', () => {
    // Deliberate: a project whose next sprint is in March would otherwise get an
    // axis mostly made of empty January, squashing every bar to a sliver.
    const range = timelineRange([A]);
    assert.equal(range?.to, day('2026-08-14'));
  });

  void test('ignores the order sprints arrive in', () => {
    assert.deepEqual(timelineRange([B, A]), timelineRange([A, B]));
  });
});

void describe('toSegments', () => {
  void test('lays sprints on one track with the gap between them', () => {
    const range = timelineRange([A, B]);
    const segments = toSegments([A, B], range!);

    assert.deepEqual(
      segments.map((s) => [s.kind, s.days]),
      [
        ['sprint', 14], // 1–14 Aug
        ['gap', 5], // 15–19 Aug
        ['sprint', 14], // 20 Aug – 2 Sept
      ],
    );
  });

  void test('the segments always sum to the range', () => {
    // The header bands and the track are drawn from the same day count. If these
    // ever disagree the months stop lining up with the bars, which is the one
    // thing a date axis must not do.
    for (const set of [[A], [A, B], [B, A]]) {
      const range = timelineRange(set)!;
      const total = toSegments(set, range).reduce((n, s) => n + s.days, 0);
      assert.equal(
        total,
        range.days,
        `segments summed to ${String(total)} of ${String(range.days)}`,
      );
    }
  });

  void test('sorts by start date, so input order cannot reorder the track', () => {
    const range = timelineRange([A, B])!;
    assert.deepEqual(
      toSegments([B, A], range)
        .filter((s) => s.kind === 'sprint')
        .map((s) => s.sprint.id),
      ['a', 'b'],
    );
  });

  void test('adjacent sprints get no gap between them', () => {
    const next = sprint({ id: 'c', starts_on: day('2026-08-15'), ends_on: day('2026-08-28') });
    const range = timelineRange([A, next])!;

    assert.deepEqual(
      toSegments([A, next], range).map((s) => s.kind),
      ['sprint', 'sprint'],
    );
  });

  void test('pads the tail when the range outlives the last sprint', () => {
    // `timelineRange` never produces such a range — it ends at the last sprint —
    // but `toSegments` takes the range as an argument and must be total over any
    // of them. Without this the branch is unreachable and untested, which is how
    // it stops working the day someone passes a fixed quarter.
    const wide = { from: day('2026-08-01'), to: day('2026-08-31'), days: 31 };

    assert.deepEqual(
      toSegments([A], wide).map((s) => [s.kind, s.days]),
      [
        ['sprint', 14], // 1–14 Aug
        ['gap', 17], // 15–31 Aug
      ],
    );
    assert.equal(
      toSegments([A], wide).reduce((n, s) => n + s.days, 0),
      wide.days,
    );
  });

  void test('a lone sprint fills the axis exactly', () => {
    const range = timelineRange([A])!;
    assert.deepEqual(
      toSegments([A], range).map((s) => [s.kind, s.days]),
      [['sprint', 14]],
    );
  });
});

void describe('monthBands', () => {
  void test('weights each month by the days actually on the axis', () => {
    // August contributes 31 days, September only 2 — a clipped month must get
    // its real share or the header drifts out of line with the track.
    const bands = monthBands(timelineRange([A, B])!);

    assert.deepEqual(
      bands.map((b) => [b.label, b.days]),
      [
        ['Aug 2026', 31],
        ['Sept 2026', 2],
      ],
    );
  });

  void test('the bands sum to the range', () => {
    const range = timelineRange([A, B])!;
    assert.equal(
      monthBands(range).reduce((n, b) => n + b.days, 0),
      range.days,
    );
  });

  void test('labels consecutive months across a year boundary', () => {
    const dec = sprint({ id: 'x', starts_on: day('2026-12-20'), ends_on: day('2027-01-10') });

    assert.deepEqual(
      monthBands(timelineRange([dec])!).map((b) => b.label),
      ['Dec 2026', 'Jan 2027'],
    );
  });

  void test('gives every band a unique key, even the same month a year apart', () => {
    // The bands are compared against the *previous* one only, so two Augusts
    // twelve months apart are never adjacent and merge correctly whatever the
    // key is. The key still has to be unique — it is a React key, and duplicates
    // are a reconciliation bug rather than a layout one, which is exactly the
    // kind that survives a screenshot review.
    const long = sprint({ id: 'y', starts_on: day('2026-08-01'), ends_on: day('2027-09-30') });
    const bands = monthBands(timelineRange([long])!);

    const augusts = bands.filter((b) => b.label.startsWith('Aug'));
    assert.equal(augusts.length, 2, 'expected Aug 2026 and Aug 2027');
    assert.equal(new Set(bands.map((b) => b.key)).size, bands.length, 'band keys must be unique');
  });
});

void describe('todayPosition', () => {
  const range = timelineRange([A, B])!;

  void test('marks a day inside the axis, at the centre of its column', () => {
    const pos = todayPosition(range, day('2026-08-01'));
    assert.equal(pos.on, 'axis');
    // Day 0 of 33 → centre of the first column, not the very edge: a marker on
    // the boundary reads as belonging to the day on either side of it.
    assert.ok(pos.on === 'axis' && pos.percent > 0 && pos.percent < 100 / 33);
  });

  void test('the last day is still on the axis, not after it', () => {
    // `ends_on` is inclusive; an off-by-one here puts the marker off the chart
    // on the final day of a sprint, which is when someone is most likely to look.
    assert.equal(todayPosition(range, day('2026-09-02')).on, 'axis');
    assert.equal(todayPosition(range, day('2026-09-03')).on, 'after');
  });

  void test('says which side it falls on rather than drawing nothing', () => {
    assert.equal(todayPosition(range, day('2026-07-31')).on, 'before');
    assert.equal(todayPosition(range, day('2026-12-01')).on, 'after');
  });

  void test('ignores the time of day', () => {
    const noon = day('2026-08-05') + 12 * 60 * 60 * 1000;
    assert.deepEqual(todayPosition(range, noon), todayPosition(range, day('2026-08-05')));
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
void describe('D-049 — no bar is drawn from a date the task does not have', () => {
  const RANGE = timelineRange([sprint({ id: 's1', starts_on: d(0), ends_on: d(9) })])!;
  const SPRINT = sprint({ id: 's1', starts_on: d(0), ends_on: d(9) });
  const NOW = d(4);

  void test('a finished task is measured, start to finish', () => {
    const bar = taskBar(
      { status: 'done', started_at: d(1), completed_at: d(3) },
      SPRINT,
      RANGE,
      NOW,
    );
    assert.equal(bar?.kind, 'actual');
    assert.equal(bar?.fromSprint, false);
    assert.equal(bar?.from, d(1));
    assert.equal(bar?.to, d(3));
  });

  void test('a running task is measured to today, then planned to the sprint end', () => {
    const bar = taskBar(
      { status: 'in_progress', started_at: d(2), completed_at: null },
      SPRINT,
      RANGE,
      NOW,
    );
    assert.equal(bar?.kind, 'partial');
    assert.equal(bar?.to, d(4), 'the solid part must stop at today, not run to the sprint end');
    assert.ok((bar?.remainderDays ?? 0) > 0, 'the planned remainder is missing');
  });

  void test('a task with no actuals gets its sprint, marked as a plan', () => {
    const bar = taskBar(
      { status: 'todo', started_at: null, completed_at: null },
      SPRINT,
      RANGE,
      NOW,
    );
    assert.equal(bar?.kind, 'planned');
    assert.equal(bar?.fromSprint, true, 'a sprint-derived bar must say so');
    assert.equal(bar?.from, d(0));
  });

  void test('**a done task with no completed_at is a plan, not a measurement**', () => {
    // The load-bearing fallback. We know when it started and not when it
    // finished, so drawing it as an actual would assert an end nobody gave us.
    const bar = taskBar(
      { status: 'done', started_at: d(1), completed_at: null },
      SPRINT,
      RANGE,
      NOW,
    );
    assert.equal(bar?.kind, 'planned');
    assert.equal(bar?.fromSprint, true);
  });

  void test('no actuals and no sprint means no bar at all', () => {
    assert.equal(
      taskBar({ status: 'todo', started_at: null, completed_at: null }, undefined, RANGE, NOW),
      undefined,
    );
  });

  void test('a running task with no sprint is still measured, with no remainder', () => {
    // Actuals alone are enough to earn a position — the tray is for tasks with
    // neither, not for tasks without a sprint.
    const bar = taskBar(
      { status: 'in_progress', started_at: d(2), completed_at: null },
      undefined,
      RANGE,
      NOW,
    );
    assert.equal(bar?.kind, 'partial');
    assert.equal(bar?.remainderDays, 0, 'a remainder with no sprint would be invented');
  });

  void test('a task crossing a sprint boundary draws one bar across both', () => {
    // The case D-040 said was unrepresentable. It was — from sprint boundaries.
    // From actuals it is one span, and that is the point of D-049.
    const wide = timelineRange([
      sprint({ id: 'a', starts_on: d(0), ends_on: d(4) }),
      sprint({ id: 'b', starts_on: d(5), ends_on: d(9) }),
    ])!;
    const bar = taskBar(
      { status: 'done', started_at: d(3), completed_at: d(7) },
      sprint({ id: 'a', starts_on: d(0), ends_on: d(4) }),
      wide,
      d(9),
    );
    assert.equal(bar?.kind, 'actual');
    assert.equal(bar?.from, d(3));
    assert.equal(bar?.to, d(7), 'the bar must not be clipped to its own sprint');
  });

  void test('the segments always sum to the axis', () => {
    // The same invariant the sprint track has: if they do not sum, the header
    // stops lining up with the bars.
    for (const task of [
      { status: 'done', started_at: d(1), completed_at: d(3) },
      { status: 'in_progress', started_at: d(2), completed_at: null },
      { status: 'todo', started_at: null, completed_at: null },
    ]) {
      const bar = taskBar(task, SPRINT, RANGE, NOW);
      assert.ok(bar !== undefined);
      const total = bar.leadDays + bar.solidDays + bar.remainderDays + bar.trailDays;
      assert.equal(
        total,
        RANGE.days,
        `${task.status} sums to ${String(total)} not ${String(RANGE.days)}`,
      );
    }
  });

  void test('the axis widens to cover actuals rather than clamping them', () => {
    // Clamping would move a bar's start to the axis edge, which asserts a date
    // nobody gave us — the exact thing this describe block exists for.
    const actuals = taskActuals([{ status: 'done', started_at: d(-3), completed_at: d(1) }]);
    const widened = timelineRange([SPRINT], actuals)!;
    assert.ok(widened.from <= d(-3), 'a task that started before the first sprint was clipped');
  });
});

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
    assert.deepEqual(summary, { done: 3, total: 9, blocked: 1, wip: 2, daysLeft: 6 });

    const four = [summary.done, summary.blocked, summary.wip, summary.daysLeft];
    assert.equal(new Set(four).size, 4, 'the fixture must keep all four distinct');
  });

  void test('blocked is passed in, not recomputed', () => {
    // `board-derive.ts` owns that rule. A second one drifts from it — the
    // LAI-215 `initials()` problem.
    assert.equal(sprintSummary(TASKS, 7, SPRINT, d(3)).blocked, 7);
  });

  void test('DAYS LEFT clamps at zero for a sprint that has ended', () => {
    // A sprint that ended last week has not got minus seven days left. A
    // negative reads as a countdown running the wrong way.
    assert.equal(sprintSummary(TASKS, 0, SPRINT, d(20)).daysLeft, 0);
  });

  void test('the last day of the sprint is zero days left, not one', () => {
    // `ends_on` is inclusive (§4.15): on the final day there is no day left
    // after today.
    assert.equal(sprintSummary(TASKS, 0, SPRINT, d(9)).daysLeft, 0);
  });

  void test('an empty sprint is zeroes, not a division by nothing', () => {
    assert.deepEqual(sprintSummary([], 0, SPRINT, d(3)), {
      done: 0,
      total: 0,
      blocked: 0,
      wip: 2 - 2,
      daysLeft: 6,
    });
  });
});
