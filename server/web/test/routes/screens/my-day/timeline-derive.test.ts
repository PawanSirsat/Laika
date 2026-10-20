import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MyDay, TimeDraft, TimeEntry } from '../../../../src/api/time.ts';
import {
  along,
  axisHours,
  clip,
  dayLine,
  dragEdge,
  gapsOf,
  snap,
  splitPoint,
  stepEnd,
  stepMinutes,
} from '../../../../src/routes/screens/my-day/timeline-derive.ts';

/**
 * The lane timeline's arithmetic (LAI-831): where blocks sit, which stretches
 * are gaps, what a break takes out of one, and what an edge dragged or a
 * −/+ does to a block — on five-minute steps.
 */

const DAY = '2026-10-20';
const MIDNIGHT = Date.parse(`${DAY}T00:00:00Z`);
const at = (h: number, m = 0): number => MIDNIGHT + (h * 60 + m) * 60_000;
const min = (h: number, m = 0): number => h * 60 + m;

function draft(id: string, from: number | null, minutes: number, extra: Partial<TimeDraft> = {}) {
  return {
    id,
    source: 'collector',
    day: DAY,
    tz: 'UTC',
    started_at: from,
    ended_at: from === null ? null : from + minutes * 60_000,
    minutes,
    task: null,
    task_key: null,
    project: null,
    general: false,
    signals: { prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 },
    note: null,
    ...extra,
  } satisfies TimeDraft;
}

function entry(id: string, from: number, minutes: number, extra: Partial<TimeEntry> = {}) {
  return {
    id,
    day: DAY,
    tz: 'UTC',
    started_at: from,
    ended_at: from + minutes * 60_000,
    minutes,
    source: 'manual',
    task: null,
    project: null,
    note: null,
    revision: 1,
    created_at: 1,
    updated_at: 1,
    ...extra,
  } satisfies TimeEntry;
}

const view = (
  over: Partial<Pick<MyDay, 'drafts' | 'entries' | 'breaks' | 'today'>> = {},
): Pick<MyDay, 'day' | 'tz' | 'today' | 'drafts' | 'entries' | 'breaks'> => ({
  day: DAY,
  tz: 'UTC',
  today: '2026-10-21',
  drafts: [],
  entries: [],
  breaks: [],
  ...over,
});

void describe('gapsOf — unaccounted time between blocks', () => {
  void test('twenty minutes or more is a gap; less is a breath', () => {
    const blocks = [
      { start: min(9), end: min(10) },
      { start: min(10, 19), end: min(11) },
      { start: min(11, 20), end: min(12) },
    ];
    assert.deepEqual(gapsOf(blocks, [], undefined), [{ start: min(11), end: min(11, 20) }]);
  });

  void test('nothing before the first block, and up to now on today only', () => {
    const blocks = [{ start: min(9), end: min(10) }];
    assert.deepEqual(gapsOf(blocks, [], undefined), []);
    assert.deepEqual(gapsOf(blocks, [], min(10, 30)), [{ start: min(10), end: min(10, 30) }]);
    assert.deepEqual(gapsOf(blocks, [], min(10, 15)), []);
  });

  void test('overlapping blocks are one stretch', () => {
    const blocks = [
      { start: min(9), end: min(11) },
      { start: min(9, 30), end: min(10) },
      { start: min(11, 40), end: min(12) },
    ];
    assert.deepEqual(gapsOf(blocks, [], undefined), [{ start: min(11), end: min(11, 40) }]);
  });

  void test('a break takes its span out; what is left counts only if it is still a gap', () => {
    const blocks = [
      { start: min(9), end: min(10) },
      { start: min(11), end: min(12) },
    ];
    // 10:00–11:00, less 10:10–10:45: 10 minutes (a breath) and 15 (a breath).
    assert.deepEqual(gapsOf(blocks, [{ start: min(10, 10), end: min(10, 45) }], undefined), []);
    // Less 10:00–10:30: 10:30–11:00 is still a gap.
    assert.deepEqual(gapsOf(blocks, [{ start: min(10), end: min(10, 30) }], undefined), [
      { start: min(10, 30), end: min(11) },
    ]);
  });

  void test('clip cuts a span around each cut', () => {
    assert.deepEqual(clip({ start: 0, end: 100 }, [{ start: 20, end: 30 }, { start: 90, end: 120 }]), [
      { start: 0, end: 20 },
      { start: 30, end: 90 },
    ]);
  });
});

void describe('dayLine — the day placed on its lane', () => {
  void test('places what has a time, counts what has none, and marks what needs a card', () => {
    const line = dayLine(
      view({
        drafts: [
          draft('d1', at(8, 40), 95, { general: true }),
          draft('d2', at(10, 40), 40),
          draft('d3', null, 25),
        ],
        entries: [entry('e1', at(11, 30), 30), entry('e2', at(12), 30, { source: 'import' })],
      }),
      at(20),
    );
    assert.deepEqual(
      line.blocks.map((b) => [b.id, b.kind, b.start, b.end, b.needsCard, b.locked]),
      [
        ['d1', 'drafted', min(8, 40), min(10, 15), false, false],
        ['d2', 'drafted', min(10, 40), min(11, 20), true, false],
        ['e1', 'confirmed', min(11, 30), min(12), false, false],
        ['e2', 'confirmed', min(12), min(12, 30), false, true],
      ],
    );
    assert.equal(line.untimed, 1);
    assert.equal(line.now, undefined, 'a past day has no now');
    assert.deepEqual(line.gaps, [{ start: min(10, 15), end: min(10, 40) }]);
  });

  void test('on today the gap runs to now, and the axis widens to hold it', () => {
    const line = dayLine(view({ today: DAY, drafts: [draft('d1', at(21), 30)] }), at(23, 10));
    assert.equal(line.now, min(23, 10));
    assert.deepEqual(line.gaps, [{ start: min(21, 30), end: min(23, 10) }]);
    assert.equal(line.from, 6);
    assert.equal(line.to, 24);
  });

  void test('6 AM to 10 PM unless a block falls outside', () => {
    assert.deepEqual(
      [dayLine(view({ drafts: [draft('d', at(9), 30)] }), 0)].map((l) => [l.from, l.to]),
      [[6, 22]],
    );
    assert.deepEqual(
      [dayLine(view({ drafts: [draft('d', at(4, 30), 30)] }), 0)].map((l) => [l.from, l.to]),
      [[4, 22]],
    );
  });

  void test('a break is placed, and closes its gap', () => {
    const line = dayLine(
      view({
        drafts: [draft('a', at(9), 60), draft('b', at(11), 60)],
        breaks: [{ id: 'k', day: DAY, tz: 'UTC', started_at: at(10), ended_at: at(11) }],
      }),
      0,
    );
    assert.deepEqual(line.breaks, [{ id: 'k', start: min(10), end: min(11) }]);
    assert.deepEqual(line.gaps, []);
  });
});

void describe('the axis', () => {
  void test('every hour, or every other one when the whole day must fit', () => {
    assert.deepEqual(axisHours(6, 10, '1'), [6, 7, 8, 9, 10]);
    assert.deepEqual(axisHours(6, 10, 'fit'), [6, 8, 10]);
  });

  void test('along puts a minute between the two ends', () => {
    assert.equal(along(min(6), 6, 22), 0);
    assert.equal(along(min(22), 6, 22), 100);
    assert.equal(along(min(14), 6, 22), 50);
  });
});

void describe('moving an edge, five minutes at a time (C)', () => {
  const block = { start: min(12), end: min(12, 30), minutes: 30 };

  void test('an edge lands on the nearest five minutes of the clock', () => {
    assert.equal(snap(min(12, 47)), min(12, 45));
    assert.equal(snap(min(12, 48)), min(12, 50));
    assert.deepEqual(dragEdge(block, 'end', min(12, 47)), {
      start: min(12),
      end: min(12, 45),
      minutes: 45,
    });
    assert.deepEqual(dragEdge(block, 'start', min(11, 52)), {
      start: min(11, 50),
      end: min(12, 30),
      minutes: 40,
    });
  });

  void test('a block that held less than its span keeps the difference', () => {
    const shared = { start: min(9), end: min(10), minutes: 40 };
    assert.deepEqual(dragEdge(shared, 'end', min(10, 20)), {
      start: min(9),
      end: min(10, 20),
      minutes: 60,
    });
  });

  void test('never closer than a step to the other edge, never off the day, never a no-op', () => {
    assert.deepEqual(dragEdge(block, 'end', min(11)), { start: min(12), end: min(12, 5), minutes: 5 });
    assert.deepEqual(dragEdge(block, 'start', -200), { start: 0, end: min(12, 30), minutes: 750 });
    assert.equal(dragEdge(block, 'end', min(12, 31)), undefined);
  });

  void test('−/+ move the end and the length together', () => {
    assert.deepEqual(stepEnd(block, 5), { start: min(12), end: min(12, 35), minutes: 35 });
    assert.deepEqual(stepEnd(block, -5), { start: min(12), end: min(12, 25), minutes: 25 });
    assert.equal(stepEnd({ start: min(12), end: min(12, 5), minutes: 5 }, -5), undefined);
    assert.equal(stepEnd({ start: min(23, 50), end: 1440, minutes: 10 }, 5), undefined);
    assert.equal(stepMinutes(25, 5), 30);
    assert.equal(stepMinutes(5, -5), undefined);
  });

  void test('Split in two: the middle, to five minutes from the start', () => {
    assert.equal(splitPoint({ start: min(8, 40), end: min(10, 15), minutes: 95 }), min(9, 30));
    assert.equal(splitPoint({ start: min(9), end: min(9, 8), minutes: 8 }), undefined);
  });
});
