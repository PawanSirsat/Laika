/**
 * `routes/screens/timeline/timeline-derive.ts` (LAI-084).
 *
 * The axis arithmetic. Two properties matter more than the rest: the track's
 * segments must always sum to the range (or the header stops lining up with the
 * bars), and **nothing here may give a task a position** — D-014's whole point.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { describe, test } from 'node:test';
import type { Sprint } from '../../../../src/api/sprints.ts';
import {
  isCurrent,
  isPast,
  monthBands,
  startOfDay,
  timelineRange,
  todayPosition,
  toSegments,
} from '../../../../src/routes/screens/timeline/timeline-derive.ts';

const DAY = 24 * 60 * 60 * 1000;
const day = (iso: string): number => Date.parse(`${iso}T00:00:00.000Z`);

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

void describe('D-014 — tasks never get a position on the axis', () => {
  void test('nothing in the timeline folder positions a task', async () => {
    // The prototype draws a row per task with its own start and length
    // (`tlSpans`). `tasks` has no planned-start and no due-date column and D-014
    // keeps it that way, so those rows are invented dates. This fails if anyone
    // reintroduces them — a comment would not.
    const dir = new URL('../../../../src/routes/screens/timeline/', import.meta.url);

    for (const name of await readdir(dir)) {
      if (!/\.tsx?$/.test(name)) continue;

      const source = await readFile(new URL(name, dir), 'utf8');
      const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

      // A task span would have to come from somewhere: there is no task date
      // field, so any of these appearing means one was invented.
      for (const banned of ['due_date', 'plannedStart', 'planned_start', 'taskSpan', 'tlSpans']) {
        assert.ok(!body.includes(banned), `${name} references ${banned} — see D-014`);
      }

      // `flexGrow` is how a bar claims its share of the axis. It must only ever
      // be applied to a sprint segment or a month band, never to a task.
      const positionsTask = /task[A-Za-z]*\s*\.\s*(?:starts_on|ends_on|days)/.test(body);
      assert.ok(!positionsTask, `${name} appears to derive an axis position from a task`);
    }
  });

  void test('the client Task type still has no date a bar could use', async () => {
    // If one is ever added, this fails and whoever added it reads D-014 before
    // the timeline quietly becomes a scheduling engine.
    const source = await readFile(new URL('../../../../src/api/tasks.ts', import.meta.url), 'utf8');

    for (const banned of ['due_date', 'planned_start', 'starts_on', 'ends_on']) {
      assert.ok(!source.includes(banned), `api/tasks.ts declares ${banned} — see D-014`);
    }
  });
});
