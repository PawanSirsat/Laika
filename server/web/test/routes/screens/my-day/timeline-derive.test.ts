import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MyDay, TimeDraft, TimeEntry } from '../../../../src/api/time.ts';
import {
  agentsDuring,
  along,
  axisHours,
  buildScale,
  checkDrop,
  clip,
  dayFigures,
  dayLine,
  dragEdge,
  freeAround,
  rangeFromDrag,
  gapsOf,
  idleEnds,
  limitsIn,
  limitsOf,
  moveBlock,
  setLength,
  signalsDuring,
  snap,
  splitPoint,
  workedIn,
  stackOf,
  stepEnd,
  stepMinutes,
  timerSpan,
  trayDropSpan,
  FOLD_PX,
  BLOCK_PX,
  HIT_MIN_PX,
  LANE_GAP_PX,
  LANE_MIN_PX,
  OPEN_LANE_PX,
  ROW_LANES,
  ZOOM_MAX,
  ZOOM_STEPS,
  clampZoom,
  groupIdOf,
  keepAt,
  layoutRow,
  pxPerHour,
  sliderMax,
  sliderMin,
  sliderValue,
  wheelAction,
  zoomFloor,
  zoomLabel,
  zoomOfSlider,
  zoomStep,
  type AgentRun,
  type LaneBlock,
  type SignalMark,
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
  void test('five minutes or more is a gap; less is a breath (the My Day design, LAI-510)', () => {
    const blocks = [
      { start: min(9), end: min(10) },
      { start: min(10, 4), end: min(11) },
      { start: min(11, 5), end: min(12) },
    ];
    assert.deepEqual(gapsOf(blocks, []), [{ start: min(11), end: min(11, 5) }]);
  });

  void test('only between blocks — nothing before the first, nothing after the last (review round 1)', () => {
    // An evening is not seven hours unaccounted: the day ends with its last block.
    assert.deepEqual(gapsOf([{ start: min(9), end: min(10) }], []), []);
  });

  void test('overlapping blocks are one stretch', () => {
    const blocks = [
      { start: min(9), end: min(11) },
      { start: min(9, 30), end: min(10) },
      { start: min(11, 40), end: min(12) },
    ];
    assert.deepEqual(gapsOf(blocks, []), [{ start: min(11), end: min(11, 40) }]);
  });

  void test('a break takes its span out; what is left counts only if it is still a gap', () => {
    const blocks = [
      { start: min(9), end: min(10) },
      { start: min(11), end: min(12) },
    ];
    // 10:00–11:00, less 10:03–10:56: 3 minutes (a breath) and 4 (a breath).
    assert.deepEqual(gapsOf(blocks, [{ start: min(10, 3), end: min(10, 56) }]), []);
    // Less 10:00–10:30: 10:30–11:00 is still a gap.
    assert.deepEqual(gapsOf(blocks, [{ start: min(10), end: min(10, 30) }]), [
      { start: min(10, 30), end: min(11) },
    ]);
  });

  void test('clip cuts a span around each cut', () => {
    assert.deepEqual(
      clip({ start: 0, end: 100 }, [
        { start: 20, end: 30 },
        { start: 90, end: 120 },
      ]),
      [
        { start: 0, end: 20 },
        { start: 30, end: 90 },
      ],
    );
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
    // 10:15–10:40, and the ten minutes before e1: five and up is a gap (LAI-510).
    assert.deepEqual(line.gaps, [
      { start: min(10, 15), end: min(10, 40) },
      { start: min(11, 20), end: min(11, 30) },
    ]);
  });

  void test('on today the axis widens to hold now, and no gap runs to it', () => {
    const line = dayLine(view({ today: DAY, drafts: [draft('d1', at(21), 30)] }), at(23, 10));
    assert.equal(line.now, min(23, 10));
    assert.deepEqual(line.gaps, []);
    assert.equal(line.from, 6);
    assert.equal(line.to, 24);
  });

  void test('a clock-change day labels each hour where that hour really falls (review round 1)', () => {
    // Europe/London leaves summer time at 2:00 on 25 October 2026: the day has
    // 25 hours, and 6 AM is seven hours after midnight, not six.
    const autumn = dayLine(
      {
        day: '2026-10-25',
        tz: 'Europe/London',
        today: '2026-10-26',
        drafts: [draft('d', Date.UTC(2026, 9, 25, 8), 30)],
        entries: [],
        breaks: [],
      },
      0,
    );
    assert.equal(autumn.length, 25 * 60);
    const mark = (hour: number) => autumn.hours.find((h) => h.hour === hour)?.minute;
    assert.equal(mark(6), 7 * 60);
    assert.equal(mark(12), 13 * 60);
    // The block at 8:00 GMT sits under its own label.
    assert.equal(autumn.blocks[0]?.start, mark(8));
    // An ordinary day: an hour is sixty minutes after the one before.
    const plain = dayLine(view({ drafts: [draft('d', at(9), 30)] }), 0);
    assert.equal(plain.hours.find((h) => h.hour === 6)?.minute, 6 * 60);
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
    assert.deepEqual(axisHours(6, 10, 1), [6, 7, 8, 9, 10]);
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
    assert.deepEqual(dragEdge(block, 'end', min(11)), {
      start: min(12),
      end: min(12, 5),
      minutes: 5,
    });
    assert.deepEqual(dragEdge(block, 'start', -200), { start: 0, end: min(12, 30), minutes: 750 });
    assert.equal(dragEdge(block, 'end', min(12, 31)), undefined);
  });

  void test('an edge stops at a neighbouring confirmed block (review round 1)', () => {
    const confirmed = [
      { start: min(9), end: min(11, 10) },
      { start: min(12, 40), end: min(13) },
    ];
    const limits = limitsOf(block, confirmed);
    assert.deepEqual(limits, { lo: min(11, 10), hi: min(12, 40) });
    assert.deepEqual(dragEdge(block, 'start', min(9, 30), limits), {
      start: min(11, 10),
      end: min(12, 30),
      minutes: 80,
    });
    assert.deepEqual(dragEdge(block, 'end', min(13, 30), limits), {
      start: min(12),
      end: min(12, 40),
      minutes: 40,
    });
    // One that already overlaps the block bounds nothing; the server refuses that confirm.
    assert.deepEqual(limitsOf(block, [{ start: min(12, 10), end: min(12, 20) }]), {
      lo: 0,
      hi: 1440,
    });
  });

  void test('−/+ move the end and the length together', () => {
    assert.deepEqual(stepEnd(block, 5), { start: min(12), end: min(12, 35), minutes: 35 });
    assert.deepEqual(stepEnd(block, -5), { start: min(12), end: min(12, 25), minutes: 25 });
    assert.equal(stepEnd({ start: min(12), end: min(12, 5), minutes: 5 }, -5), undefined);
    assert.equal(stepEnd({ start: min(23, 50), end: 1440, minutes: 10 }, 5), undefined);
    // Never past a confirmed block's edge.
    assert.equal(stepEnd(block, 5, min(12, 30)), undefined);
  });

  void test('−/+ and Split land on the five-minute grid from an off-grid edge (review round 1)', () => {
    const off = { start: min(10, 2), end: min(10, 13), minutes: 11 };
    assert.deepEqual(stepEnd(off, 5), { start: min(10, 2), end: min(10, 15), minutes: 13 });
    assert.deepEqual(stepEnd(off, -5), { start: min(10, 2), end: min(10, 10), minutes: 8 });
    // 9:03–10:01: the middle is 9:32, and the cut is 9:30.
    assert.equal(splitPoint({ start: min(9, 3), end: min(10, 1), minutes: 58 }), min(9, 30));
    assert.equal(stepMinutes(25, 5), 30);
    assert.equal(stepMinutes(5, -5), undefined);
  });

  void test('Split in two: the middle, to five minutes from the start', () => {
    assert.equal(splitPoint({ start: min(8, 40), end: min(10, 15), minutes: 95 }), min(9, 30));
    assert.equal(splitPoint({ start: min(9), end: min(9, 8), minutes: 8 }), undefined);
  });

  void test('a typed length moves the end by as much, within the day and its neighbours', () => {
    assert.deepEqual(setLength(block, 90), { start: min(12), end: min(13, 30), minutes: 90 });
    assert.deepEqual(setLength(block, 10), { start: min(12), end: min(12, 10), minutes: 10 });
    // A block that held less than its span keeps the difference.
    assert.deepEqual(setLength({ start: min(9), end: min(10), minutes: 40 }, 50), {
      start: min(9),
      end: min(10, 10),
      minutes: 50,
    });
    assert.equal(setLength(block, 45, min(12, 40)), undefined, 'past a confirmed block');
    assert.equal(setLength({ start: min(23), end: min(23, 30), minutes: 30 }, 90), undefined);
  });
});

void describe('stackOf — blocks at the same time share the lane (LAI-860)', () => {
  void test('a block nothing overlaps keeps the whole lane; touching is not overlapping', () => {
    const blocks = [
      { start: min(9), end: min(9, 5) },
      { start: min(9, 5), end: min(9, 10) },
      { start: min(9, 12), end: min(9, 17) },
    ];
    assert.deepEqual(stackOf(blocks), [
      { row: 0, rows: 1 },
      { row: 0, rows: 1 },
      { row: 0, rows: 1 },
    ]);
  });

  void test('blocks at the same time take a row each, and the stretch knows how many', () => {
    // The owner's day: two at once, then three at once, then one alone.
    const blocks = [
      { start: min(8, 7), end: min(8, 12) },
      { start: min(8, 9), end: min(8, 14) },
      { start: min(8, 15), end: min(8, 20) },
      { start: min(8, 16), end: min(8, 21) },
      { start: min(8, 18), end: min(8, 23) },
      { start: min(9, 10), end: min(9, 15) },
    ];
    assert.deepEqual(stackOf(blocks), [
      { row: 0, rows: 2 },
      { row: 1, rows: 2 },
      { row: 0, rows: 3 },
      { row: 1, rows: 3 },
      { row: 2, rows: 3 },
      { row: 0, rows: 1 },
    ]);
  });

  void test('a row is used again once it is free, so a long block and a run of short ones need two', () => {
    const blocks = [
      { start: min(10), end: min(11) },
      { start: min(10, 5), end: min(10, 10) },
      { start: min(10, 20), end: min(10, 25) },
      { start: min(10, 40), end: min(10, 45) },
    ];
    assert.deepEqual(stackOf(blocks), [
      { row: 0, rows: 2 },
      { row: 1, rows: 2 },
      { row: 1, rows: 2 },
      { row: 1, rows: 2 },
    ]);
  });

  void test('a block that starts as a stretch ends begins a new one (review round 1)', () => {
    // The first case's touching blocks are one row either way, so this is the
    // one that tells `start >= reach` from `start > reach`.
    const blocks = [
      { start: min(8), end: min(8, 10) },
      { start: min(8, 5), end: min(8, 10) },
      { start: min(8, 10), end: min(8, 15) },
    ];
    assert.deepEqual(stackOf(blocks), [
      { row: 0, rows: 2 },
      { row: 1, rows: 2 },
      { row: 0, rows: 1 },
    ]);
  });

  void test('a row is free from the minute its block ends (review round 1)', () => {
    // Inside a long block's stretch: `end <= start` takes row 1 again, and
    // `end < start` would open a third row.
    const blocks = [
      { start: min(10), end: min(11) },
      { start: min(10, 5), end: min(10, 10) },
      { start: min(10, 10), end: min(10, 15) },
    ];
    assert.deepEqual(stackOf(blocks), [
      { row: 0, rows: 2 },
      { row: 1, rows: 2 },
      { row: 1, rows: 2 },
    ]);
  });

  void test('index for index with the blocks, in whatever order they come', () => {
    const late = { start: min(14), end: min(14, 30) };
    const early = { start: min(13, 50), end: min(14, 10) };
    assert.deepEqual(stackOf([late, early]), [
      { row: 1, rows: 2 },
      { row: 0, rows: 2 },
    ]);
    assert.deepEqual(stackOf([]), []);
  });
});

void describe('the organisation’s breaks on the day (D-101, LAI-956)', () => {
  // 2026-10-20 is a Tuesday: ISO day 2.
  const LUNCH = { label: 'Lunch', start: '12:00', end: '13:00', days: [1, 2, 3, 4, 5] };
  const withSchedule = (
    breaks: { label: string; start: string; end: string; days: number[] }[],
    over: Parameters<typeof view>[0] = {},
  ) => ({ ...view(over), settings: { breaks } });

  void test('a window on the viewed weekday is placed, by its label, in the day’s own zone', () => {
    const line = dayLine(
      withSchedule([LUNCH, { label: 'Weekend walk', start: '15:00', end: '16:00', days: [6, 7] }]),
      0,
    );
    assert.deepEqual(line.scheduled, [{ label: 'Lunch', start: min(12), end: min(13) }]);
  });

  void test('none on a weekday it does not name, and none from a board that sends no schedule', () => {
    // 2026-10-24 is a Saturday.
    const saturday = dayLine({ ...withSchedule([LUNCH]), day: '2026-10-24' }, 0);
    assert.deepEqual(saturday.scheduled, []);
    assert.deepEqual(dayLine(view(), 0).scheduled, []);
  });

  void test('wall-clock in the day’s zone: 12:00 in Kolkata is 06:30 UTC, minute 720 of its day', () => {
    const line = dayLine({ ...withSchedule([LUNCH]), tz: 'Asia/Kolkata' }, 0);
    assert.deepEqual(line.scheduled, [{ label: 'Lunch', start: min(12), end: min(13) }]);
    assert.equal(
      line.midnight === undefined ? undefined : line.midnight + min(12) * 60_000,
      Date.UTC(2026, 9, 20, 6, 30),
    );
  });

  void test('on a clock-change day a window sits where its wall clock really falls', () => {
    // Europe/London: 25 October 2026 has 25 hours; 12:00 is 13 hours after midnight.
    const line = dayLine(
      { ...withSchedule([{ ...LUNCH, days: [7] }]), day: '2026-10-25', tz: 'Europe/London' },
      0,
    );
    assert.deepEqual(line.scheduled, [{ label: 'Lunch', start: 13 * 60, end: 14 * 60 }]);
  });

  void test('a scheduled window is cut out of a gap like the person’s own break', () => {
    const line = dayLine(
      withSchedule([LUNCH], { drafts: [draft('a', at(10), 120), draft('b', at(13, 30), 60)] }),
      0,
    );
    // 12:00–13:30, less lunch: 13:00–13:30 is still a gap.
    assert.deepEqual(line.gaps, [{ start: min(13), end: min(13, 30) }]);
    // And what is left is held to the same five minutes: 13:00–13:03 is a breath.
    const short = dayLine(
      withSchedule([LUNCH], { drafts: [draft('a', at(10), 120), draft('b', at(13, 3), 60)] }),
      0,
    );
    assert.deepEqual(short.gaps, []);
  });

  void test('nothing before the first block or after the last becomes a gap because of one', () => {
    const line = dayLine(withSchedule([LUNCH], { drafts: [draft('a', at(9), 60)] }), 0);
    assert.deepEqual(line.gaps, []);
  });

  void test('gapsOf takes scheduled windows as cuts, the same as breaks', () => {
    const blocks = [
      { start: min(9), end: min(10) },
      { start: min(11), end: min(12) },
    ];
    assert.deepEqual(gapsOf(blocks, [], [{ start: min(10), end: min(10, 30) }]), [
      { start: min(10, 30), end: min(11) },
    ]);
  });

  void test('the axis reaches a window outside 6 AM – 10 PM', () => {
    const line = dayLine(
      withSchedule([{ label: 'Dawn stretch', start: '05:00', end: '05:30', days: [2] }]),
      0,
    );
    assert.deepEqual([line.from, line.to], [5, 22]);
    const late = dayLine(
      withSchedule([{ label: 'Night', start: '22:30', end: '23:15', days: [2] }]),
      0,
    );
    assert.deepEqual([late.from, late.to], [6, 24]);
  });

  void test('Fit never folds a window away, and a window alone folds nothing', () => {
    const lunchOnly = dayLine(withSchedule([LUNCH]), 0);
    assert.deepEqual(idleEnds(lunchOnly), []);
    const morning = dayLine(withSchedule([LUNCH], { drafts: [draft('a', at(9), 60)] }), 0);
    assert.deepEqual(idleEnds(morning), [
      { start: min(6), end: min(9) },
      { start: min(13), end: min(22) },
    ]);
  });
});

void describe('idleEnds — the idle stretches Fit folds (LAI-888)', () => {
  const line = (over: {
    blocks?: { start: number; end: number }[];
    now?: number;
    agents?: AgentRun[];
    signals?: SignalMark[];
  }) => ({
    from: 6,
    to: 22,
    blocks: (over.blocks ?? []).map((b, i) => ({
      kind: 'drafted' as const,
      id: `b${String(i)}`,
      ...b,
      minutes: b.end - b.start,
      needsCard: false,
      locked: false,
    })),
    breaks: [],
    scheduled: [],
    signals: over.signals ?? [],
    agents: over.agents ?? [],
    now: over.now,
  });

  void test('before the first block and after the last, each only when 45 minutes or more', () => {
    assert.deepEqual(idleEnds(line({ blocks: [{ start: min(9), end: min(17) }] })), [
      { start: min(6), end: min(9) },
      { start: min(17), end: min(22) },
    ]);
    // Forty minutes before the first block is not folded; the evening still is.
    assert.deepEqual(idleEnds(line({ blocks: [{ start: min(6, 40), end: min(17) }] })), [
      { start: min(17), end: min(22) },
    ]);
  });

  void test('on today the tail starts at now, so the now line stands on an open stretch', () => {
    assert.deepEqual(idleEnds(line({ blocks: [{ start: min(9), end: min(10) }], now: min(14) })), [
      { start: min(6), end: min(9) },
      { start: min(14), end: min(22) },
    ]);
  });

  void test('a signal or an agent run counts as something placed', () => {
    assert.deepEqual(
      idleEnds(
        line({
          signals: [{ kind: 'prompt', start: min(8), count: 1 }],
          agents: [{ start: min(20), end: min(20, 5), seconds: 300, onCard: true }],
        }),
      ),
      [
        { start: min(6), end: min(8) },
        { start: min(20, 5), end: min(22) },
      ],
    );
  });

  void test('a day with nothing placed folds nothing', () => {
    assert.deepEqual(idleEnds(line({})), []);
  });
});

void describe('buildScale — minutes to px and back (LAI-888)', () => {
  void test('1× and 2× are linear at their px an hour, whatever the width', () => {
    const one = buildScale(6, 22, 1, 500);
    assert.equal(one.total, 16 * 160);
    assert.equal(one.pos(min(7)), 160);
    assert.equal(one.at(one.pos(min(13, 20))), min(13, 20));
    assert.equal(one.folded(min(7)), false);
    const two = buildScale(6, 22, 2, 500);
    assert.equal(two.pos(min(7)), 320);
  });

  void test('Fit is the width across, a folded stretch FOLD_PX wide and the rest minute for minute', () => {
    const folds = [
      { start: min(6), end: min(9) },
      { start: min(17), end: min(22) },
    ];
    const scale = buildScale(6, 22, 'fit', 1000, folds);
    assert.equal(scale.total, 1000);
    assert.equal(scale.pos(min(9)), FOLD_PX);
    assert.equal(scale.pos(min(17)), 1000 - FOLD_PX);
    // The open eight hours share what the folds leave, so an hour is (1000 − 184) / 8.
    const hour = (1000 - 2 * FOLD_PX) / 8;
    assert.ok(Math.abs(scale.pos(min(10)) - (FOLD_PX + hour)) < 1e-9);
    // Inside a fold a minute still has a place, and back again.
    assert.ok(scale.pos(min(7, 30)) > 0 && scale.pos(min(7, 30)) < FOLD_PX);
    assert.equal(scale.folded(min(7, 30)), true);
    assert.equal(scale.folded(min(9)), false);
    assert.ok(Math.abs(scale.at(scale.pos(min(12, 35))) - min(12, 35)) < 1e-9);
  });

  void test('a fold that would make no room stays open: an hour at 300 px across is 19 px, not 92', () => {
    const scale = buildScale(6, 22, 'fit', 300, [{ start: min(6), end: min(7) }]);
    assert.deepEqual(
      scale.segments.map((s) => s.folded),
      [false],
    );
    assert.equal(scale.total, 300);
    assert.equal(scale.folded(min(6, 30)), false);
  });

  void test('Fit with nothing to fold is linear across the width; unmeasured, a pixel a minute', () => {
    const plain = buildScale(6, 22, 'fit', 960);
    assert.equal(plain.total, 960);
    assert.equal(plain.pos(min(14)), 480);
    const unmeasured = buildScale(6, 22, 'fit', 0, [{ start: min(6), end: min(9) }]);
    assert.ok(unmeasured.total > 0);
  });
});

void describe('agentsDuring and signalsDuring — what fell inside a span (LAI-888)', () => {
  void test('an agent run counts by the share of it inside the span, on a card or not', () => {
    const runs: AgentRun[] = [
      { start: min(9), end: min(9, 10), seconds: 600, onCard: true },
      { start: min(9, 10), end: min(9, 20), seconds: 300, onCard: false },
      { start: min(12), end: min(12, 5), seconds: 300, onCard: true },
    ];
    assert.deepEqual(agentsDuring(runs, { start: min(9, 5), end: min(9, 15) }), {
      seconds: 450,
      onCardSeconds: 300,
      runs: 2,
    });
    assert.deepEqual(agentsDuring(runs, { start: min(10), end: min(11) }), {
      seconds: 0,
      onCardSeconds: 0,
      runs: 0,
    });
  });

  void test('a signal bucket counts where its middle falls', () => {
    const marks: SignalMark[] = [
      { kind: 'prompt', start: min(9), count: 3 },
      { kind: 'commit', start: min(9), count: 1 },
      { kind: 'prompt', start: min(9, 5), count: 2 },
    ];
    assert.deepEqual(signalsDuring(marks, { start: min(9), end: min(9, 5) }), {
      prompts: 3,
      commits: 1,
    });
    assert.deepEqual(signalsDuring(marks, { start: min(9), end: min(10) }), {
      prompts: 5,
      commits: 1,
    });
  });
});

void describe('dayFigures — the Timeline header (LAI-888)', () => {
  void test('confirmed, drafted on a card or General, drafted on nothing, and the gaps', () => {
    const view = {
      entries: [entry('e1', at(11), 30), entry('e2', at(20), 15)],
      drafts: [
        draft('d1', at(9), 60, { task: { id: 't', key: 'LAI-1', title: 'A' } }),
        draft('d2', at(13), 40),
        draft('d3', null, 25, { general: true }),
      ],
    };
    assert.deepEqual(
      dayFigures(view, [
        { start: min(10), end: min(11) },
        { start: min(12), end: min(12, 30) },
      ]),
      { confirmed: 45, drafted: 85, needsCard: 40, gaps: 90 },
    );
  });
});

void describe('the scale — one zoom from Fit to 5× (D-113, LAI-300)', () => {
  void test('each step of the slider’s keys is its multiple of 160 px an hour; Fit has none', () => {
    assert.deepEqual(ZOOM_STEPS, [0.5, 0.75, 1, 1.5, 2, 3, 4, 5]);
    for (const level of ZOOM_STEPS) assert.equal(pxPerHour(level), 160 * level, String(level));
    assert.equal(pxPerHour('fit'), undefined);
    assert.equal(buildScale(6, 22, 1.5, 500).pos(min(7)), 240);
    assert.equal(buildScale(6, 22, 1.37, 500).pos(min(7)), 160 * 1.37);
  });

  void test('the floor is the multiple that fits the whole axis in the width; unmeasured, half', () => {
    assert.equal(zoomFloor(6, 22, 16 * 80), 0.5);
    assert.equal(zoomFloor(6, 22, 16 * 160), 1);
    assert.equal(zoomFloor(6, 22, 0), 0.5);
    assert.equal(zoomFloor(6, 22, 1e9), ZOOM_MAX);
  });

  void test('a multiple at or under the floor is Fit, and past 5× is 5×', () => {
    assert.equal(clampZoom(0.45, 0.45), 'fit');
    assert.equal(clampZoom(0.3, 0.45), 'fit');
    assert.equal(clampZoom(0.46, 0.45), 0.46);
    assert.equal(clampZoom(9, 0.45), ZOOM_MAX);
    assert.equal(clampZoom(Number.NaN, 0.45), 'fit');
  });

  void test('the slider: a hundredth of a doubling, 1× and 2× exactly, its least value Fit', () => {
    const floor = 0.45;
    assert.equal(sliderValue(1, floor), 0);
    assert.equal(sliderValue(2, floor), 100);
    assert.equal(sliderValue('fit', floor), sliderMin(floor));
    assert.equal(sliderMin(floor), Math.floor(Math.log2(0.45) * 100));
    assert.equal(sliderValue(ZOOM_MAX, floor), sliderMax());
    assert.equal(zoomOfSlider(0, floor), 1);
    assert.equal(zoomOfSlider(100, floor), 2);
    assert.equal(zoomOfSlider(sliderMin(floor), floor), 'fit');
    assert.equal(zoomOfSlider(sliderMax(), floor), ZOOM_MAX);
    // Every step there and back within a percent.
    for (const level of ZOOM_STEPS) {
      const back = zoomOfSlider(sliderValue(level, floor), floor);
      assert.ok(back !== 'fit' && Math.abs(back / level - 1) < 0.01, String(level));
    }
  });

  void test('the slider’s keys walk the steps from wherever a pinch left the scale', () => {
    const floor = 0.45;
    assert.equal(zoomStep(1, 1, floor), 1.5);
    assert.equal(zoomStep(1, -1, floor), 0.75);
    assert.equal(zoomStep(1.3, 1, floor), 1.5);
    assert.equal(zoomStep(1.3, -1, floor), 1);
    assert.equal(zoomStep(5, 1, floor), undefined);
    assert.equal(zoomStep(4.5, 1, floor), 5);
    // From Fit, in is the first step past the floor; out is nothing.
    assert.equal(zoomStep('fit', 1, floor), 0.5);
    assert.equal(zoomStep('fit', 1, 0.8), 1);
    assert.equal(zoomStep('fit', -1, floor), undefined);
    // Out past the floor is Fit.
    assert.equal(zoomStep(0.5, -1, floor), 'fit');
    assert.equal(zoomStep(1, -1, 0.8), 'fit');
  });

  void test('says what it is: Fit, or its multiple to a sensible place', () => {
    assert.equal(zoomLabel('fit'), 'Fit');
    assert.equal(zoomLabel(1), '1×');
    assert.equal(zoomLabel(1.5), '1.5×');
    assert.equal(zoomLabel(0.75), '0.75×');
    assert.equal(zoomLabel(1.4948), '1.5×');
    assert.equal(zoomLabel(5), '5×');
  });
});

void describe('keepAt — zooming around a time (D-113, LAI-300)', () => {
  void test('the minute under the pointer stays under it from 1× to 2× and back', () => {
    const one = buildScale(6, 22, 1, 1000);
    const two = buildScale(6, 22, 2, 1000);
    const scroll1 = 600;
    const offset = 340;
    const minute = one.at(scroll1 + offset);
    const scroll2 = keepAt(two, minute, offset, 1000);
    assert.ok(Math.abs(two.at(scroll2 + offset) - minute) < 1e-9);
    const back = keepAt(one, two.at(scroll2 + offset), offset, 1000);
    assert.ok(Math.abs(back - scroll1) < 1e-9);
  });

  void test('from Fit, folded, into a multiple: the anchor minute stays put', () => {
    const fit = buildScale(6, 22, 'fit', 1000, [{ start: min(6), end: min(9) }]);
    const one = buildScale(6, 22, 1, 1000);
    const offset = 500;
    const minute = fit.at(offset);
    const scroll = keepAt(one, minute, offset, 1000);
    assert.ok(Math.abs(one.at(scroll + offset) - minute) < 1e-9);
  });

  void test('clamped to the track: never before its start nor past its end', () => {
    const two = buildScale(6, 22, 2, 1000);
    assert.equal(keepAt(two, min(6, 10), 500, 1000), 0);
    assert.equal(keepAt(two, min(21, 55), 0, 1000), two.total - 1000);
    // A track narrower than its view does not scroll at all.
    assert.equal(keepAt(buildScale(6, 22, 0.25, 1000), min(14), 10, 1000), 0);
  });
});

void describe('wheelAction — what a wheel over the Timeline does (D-113 item 2)', () => {
  const wheel = (over: Partial<Parameters<typeof wheelAction>[0]>) => ({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ...over,
  });
  const room = { left: 100, right: 100 };

  void test('pinch or Ctrl/Cmd + wheel zooms: down is out, up is in; a notch is capped', () => {
    const out = wheelAction(wheel({ ctrlKey: true, deltaY: 100 }), room);
    assert.equal(out.kind, 'zoom');
    assert.ok(out.kind === 'zoom' && Math.abs(out.by - Math.exp(-0.25)) < 1e-12);
    const inward = wheelAction(wheel({ metaKey: true, deltaY: -100 }), room);
    assert.ok(inward.kind === 'zoom' && Math.abs(inward.by - Math.exp(0.25)) < 1e-12);
    // A pinch's small deltas count whole.
    const pinch = wheelAction(wheel({ ctrlKey: true, deltaY: -4 }), room);
    assert.ok(pinch.kind === 'zoom' && Math.abs(pinch.by - Math.exp(0.04)) < 1e-12);
    // A line is sixteen pixels.
    const lines = wheelAction(wheel({ ctrlKey: true, deltaY: 1, deltaMode: 1 }), room);
    assert.ok(lines.kind === 'zoom' && Math.abs(lines.by - Math.exp(-0.16)) < 1e-12);
  });

  void test('Shift + wheel pans sideways while there is room that way, and is the page’s at an edge', () => {
    assert.deepEqual(wheelAction(wheel({ shiftKey: true, deltaY: 120 }), room), {
      kind: 'pan',
      dx: 120,
    });
    assert.deepEqual(wheelAction(wheel({ shiftKey: true, deltaX: -60 }), room), {
      kind: 'pan',
      dx: -60,
    });
    assert.deepEqual(wheelAction(wheel({ shiftKey: true, deltaY: 120 }), { left: 50, right: 0 }), {
      kind: 'native',
    });
    assert.deepEqual(wheelAction(wheel({ shiftKey: true, deltaY: -120 }), { left: 0, right: 9 }), {
      kind: 'native',
    });
  });

  void test('a plain wheel or a trackpad pan is the browser’s own, both ways', () => {
    assert.deepEqual(wheelAction(wheel({ deltaY: 120 }), room), { kind: 'native' });
    assert.deepEqual(wheelAction(wheel({ deltaX: 30, deltaY: 4 }), room), { kind: 'native' });
  });
});

void describe('layoutRow — crowded stretches as groups that open into lanes (D-113, LAI-300)', () => {
  /** Minutes to px at 1×: 160 px an hour from 6 AM. */
  const at1 = (m: number): number => ((m - 360) * 160) / 60;
  /** `n` hour-long blocks a minute apart from `h:m`, all at the same time. */
  const atOnce = (prefix: string, h: number, m: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${String(i + 1)}`,
      start: min(h, m + i),
      end: min(h, m + i) + 60,
    }));

  void test('the threshold: three lanes keep the readable minimum in the row, four would not', () => {
    assert.equal(ROW_LANES, 3);
    const lane = (n: number): number => (BLOCK_PX + LANE_GAP_PX) / n - LANE_GAP_PX;
    assert.ok(lane(ROW_LANES) >= LANE_MIN_PX);
    assert.ok(lane(ROW_LANES + 1) < LANE_MIN_PX);
    assert.ok(OPEN_LANE_PX >= LANE_MIN_PX, 'an open lane is never under the minimum');
  });

  void test('one block alone has the row; two at once share it in two lanes, with a strip', () => {
    const one = layoutRow([{ id: 'a', start: min(9), end: min(10) }], at1);
    assert.deepEqual(one.placed.get('a'), {
      lane: 0,
      lanes: 1,
      top: 0,
      height: BLOCK_PX,
      group: undefined,
      hidden: false,
      hit: undefined,
    });
    assert.deepEqual(one.groups, []);
    assert.deepEqual(one.strips, []);
    assert.equal(one.height, BLOCK_PX);

    const two = layoutRow(atOnce('k', 9, 0, 2), at1);
    assert.deepEqual(
      ['k1', 'k2'].map((id) => [two.placed.get(id)?.top, two.placed.get(id)?.height]),
      [
        [0, 39],
        [41, 39],
      ],
    );
    assert.deepEqual(two.strips, [{ id: 'k1', start: min(9), end: min(10, 1), n: 2 }]);
    assert.deepEqual(two.groups, []);
  });

  void test('four at once is a group: closed, one marker the row tall, its blocks not drawn', () => {
    const row = layoutRow(atOnce('f', 12, 0, 4), at1);
    assert.equal(row.groups.length, 1);
    const g = row.groups[0];
    assert.ok(g !== undefined);
    assert.equal(g.id, groupIdOf('f1'));
    assert.deepEqual(g.ids, ['f1', 'f2', 'f3', 'f4']);
    assert.equal(g.lanes, 4);
    assert.equal(g.open, false);
    assert.equal(g.height, BLOCK_PX);
    assert.equal(g.start, min(12));
    assert.equal(g.end, min(13, 3));
    assert.deepEqual(
      g.preview.map((p) => p.lane),
      [0, 1, 2, 3],
    );
    for (const id of g.ids) assert.equal(row.placed.get(id)?.hidden, true, id);
    assert.deepEqual(row.strips, []);
    assert.equal(row.height, BLOCK_PX);
  });

  void test('open, a group’s blocks take a readable lane each and the row grows to hold them', () => {
    for (const n of [4, 8, 12]) {
      const blocks = atOnce('g', 13, 30, n);
      const row = layoutRow(blocks, at1, new Set([groupIdOf('g1')]));
      const g = row.groups[0];
      assert.ok(g?.open === true, `${String(n)}: not open`);
      const tall = n * (OPEN_LANE_PX + LANE_GAP_PX) - LANE_GAP_PX;
      assert.equal(g.height, tall);
      assert.equal(row.height, Math.max(BLOCK_PX, tall));
      for (const b of blocks) {
        const p = row.placed.get(b.id);
        assert.ok(p !== undefined && !p.hidden, `${String(n)}: ${b.id} not drawn`);
        assert.equal(p.height, OPEN_LANE_PX);
        assert.equal(p.top, p.lane * (OPEN_LANE_PX + LANE_GAP_PX));
      }
      // No two blocks in one lane overlap in time; no two lanes overlap in px.
      for (const a of blocks) {
        for (const b of blocks) {
          if (a.id >= b.id) continue;
          const pa = row.placed.get(a.id);
          const pb = row.placed.get(b.id);
          assert.ok(pa !== undefined && pb !== undefined);
          if (pa.lane === pb.lane) assert.ok(a.end <= b.start || b.end <= a.start);
          else assert.ok(pa.top + pa.height <= pb.top || pb.top + pb.height <= pa.top);
        }
      }
    }
  });

  void test('mixed lengths: a long block and short ones inside it reuse lanes, as stackOf does', () => {
    const blocks = [
      { id: 'long', start: min(10), end: min(12) },
      { id: 's1', start: min(10, 10), end: min(10, 40) },
      { id: 's2', start: min(10, 50), end: min(11, 20) },
      { id: 's3', start: min(11, 30), end: min(11, 50) },
      { id: 'alone', start: min(14), end: min(14, 30) },
    ];
    const row = layoutRow(blocks, at1);
    assert.deepEqual(
      blocks.map((b) => [b.id, row.placed.get(b.id)?.lane, row.placed.get(b.id)?.lanes]),
      [
        ['long', 0, 2],
        ['s1', 1, 2],
        ['s2', 1, 2],
        ['s3', 1, 2],
        ['alone', 0, 1],
      ],
    );
    assert.deepEqual(row.groups, []);
    // Deep in one stretch but never more than three at a minute: lanes, not a group.
    const deep = layoutRow(
      [
        { id: 'a', start: min(9), end: min(11) },
        { id: 'b', start: min(9), end: min(9, 30) },
        { id: 'c', start: min(9, 30), end: min(10) },
        { id: 'd', start: min(9, 15), end: min(9, 45) },
      ],
      at1,
    );
    assert.equal(deep.placed.get('a')?.lanes, 3);
    assert.deepEqual(deep.groups, []);
  });

  void test('five-minute blocks back to back at 1×: their targets overlap, so they take lanes', () => {
    const blocks = [
      { id: 't1', start: min(15), end: min(15, 5) },
      { id: 't2', start: min(15, 5), end: min(15, 10) },
      { id: 't3', start: min(15, 10), end: min(15, 15) },
    ];
    // Five minutes at 1× is 13.3px, under the 24px target.
    assert.ok(at1(min(15, 5)) - at1(min(15)) < HIT_MIN_PX);
    const row = layoutRow(blocks, at1);
    assert.deepEqual(
      blocks.map((b) => row.placed.get(b.id)?.lane),
      [0, 1, 0],
    );
    for (const b of blocks) {
      const p = row.placed.get(b.id);
      assert.ok(p?.hit !== undefined, `${b.id} has no target`);
      assert.ok(p.hit.r - p.hit.l >= HIT_MIN_PX - 1e-9, `${b.id}'s target is narrow`);
      // Centred on the bar, and the bar inside it.
      const x0 = at1(b.start);
      const x1 = at1(b.end);
      assert.ok(Math.abs((p.hit.l + p.hit.r) / 2 - (x0 + x1) / 2) < 1e-9);
      assert.ok(p.hit.l <= x0 && p.hit.r >= x1);
    }
    // At 2× five minutes is 26.7px: wide enough, one lane, no targets.
    const at2 = (m: number): number => ((m - 360) * 320) / 60;
    const wide = layoutRow(blocks, at2);
    assert.deepEqual(
      blocks.map((b) => [wide.placed.get(b.id)?.lanes, wide.placed.get(b.id)?.hit]),
      [
        [1, undefined],
        [1, undefined],
        [1, undefined],
      ],
    );
  });

  void test('twelve five-minute blocks at once: one group, at any zoom', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({
      id: `c${String(i + 1).padStart(2, '0')}`,
      start: min(11),
      end: min(11, 5),
    }));
    for (const pph of [40, 160, 800]) {
      const pos = (m: number): number => ((m - 360) * pph) / 60;
      const row = layoutRow(blocks, pos);
      assert.equal(row.groups.length, 1, `${String(pph)} px an hour`);
      assert.equal(row.groups[0]?.ids.length, 12);
      assert.equal(row.groups[0]?.id, groupIdOf('c01'));
    }
  });

  void test('a narrow target stops at whatever is drawn beside it', () => {
    const blocks = [
      { id: 'big', start: min(9), end: min(10) },
      { id: 'tiny', start: min(10), end: min(10, 5) },
    ];
    const gap = { start: min(10, 5), end: min(10, 30) };
    const row = layoutRow(blocks, at1, new Set(), [gap]);
    // A big block and a tiny one beside it do not clash: one lane each, the row whole.
    assert.equal(row.placed.get('big')?.lanes, 1);
    const hit = row.placed.get('tiny')?.hit;
    assert.deepEqual(hit, { l: at1(min(10)), r: at1(min(10, 5)) });
    // With room on the right, it reaches as far as half the target there.
    const open = layoutRow(blocks, at1);
    const c = (at1(min(10)) + at1(min(10, 5))) / 2;
    assert.deepEqual(open.placed.get('tiny')?.hit, { l: at1(min(10)), r: c + HIT_MIN_PX / 2 });
  });

  void test('a closed group drawn narrower than the target gets one, as a block does', () => {
    const blocks = Array.from({ length: 5 }, (_, i) => ({
      id: `n${String(i)}`,
      start: min(11),
      end: min(11, 5),
    }));
    const fit = (m: number): number => ((m - 360) * 40) / 60;
    const g = layoutRow(blocks, fit).groups[0];
    assert.ok(g?.hit !== undefined);
    assert.ok(Math.abs(g.hit.r - g.hit.l - HIT_MIN_PX) < 1e-9);
    assert.equal(layoutRow(blocks, fit, new Set([groupIdOf('n0')])).groups[0]?.hit, undefined);
  });

  void test('a group’s id is its blocks’, never its place: order, and edits elsewhere, keep it', () => {
    const crowd = atOnce('g', 13, 30, 6);
    const others = [
      { id: 'early', start: min(8), end: min(9) },
      { id: 'late', start: min(17), end: min(18) },
    ];
    const id = layoutRow([...others, ...crowd], at1).groups[0]?.id;
    assert.equal(id, groupIdOf('g1'));
    // Shuffled.
    assert.equal(layoutRow([...crowd].reverse().concat(others), at1).groups[0]?.id, id);
    // A block elsewhere edited, added, or gone: the group stays the same group — and open.
    const edited = [
      { id: 'early', start: min(7), end: min(8, 30) },
      { id: 'new', start: min(19), end: min(20) },
      ...crowd,
    ];
    const row = layoutRow(edited, at1, new Set([id ?? '']));
    assert.equal(row.groups[0]?.id, id);
    assert.equal(row.groups[0]?.open, true);
    // Two blocks at the very same minute: the id decides, not the order sent.
    const tie = [
      { id: 'b', start: min(9), end: min(10) },
      { id: 'a', start: min(9), end: min(10) },
      { id: 'c', start: min(9), end: min(10) },
      { id: 'd', start: min(9), end: min(10) },
    ];
    assert.equal(layoutRow(tie, at1).groups[0]?.id, groupIdOf('a'));
  });

  void test('several groups open at once, each on its own; one open never closes another', () => {
    const blocks = [...atOnce('f', 12, 0, 5), ...atOnce('g', 13, 30, 8)];
    const both = layoutRow(blocks, at1, new Set([groupIdOf('f1'), groupIdOf('g1')]));
    assert.deepEqual(
      both.groups.map((g) => [g.id, g.open]),
      [
        [groupIdOf('f1'), true],
        [groupIdOf('g1'), true],
      ],
    );
    assert.equal(both.height, 8 * (OPEN_LANE_PX + LANE_GAP_PX) - LANE_GAP_PX);
    const one = layoutRow(blocks, at1, new Set([groupIdOf('g1')]));
    assert.deepEqual(
      one.groups.map((g) => g.open),
      [false, true],
    );
  });
});

void describe('workedIn — the organisation’s window set against the day (LAI-894)', () => {
  const span = (start: number, end: number) => ({ start, end });

  void test('nothing in the window: no minute worked, one run, not worked', () => {
    assert.deepEqual(workedIn([span(600, 660)], span(720, 780)), {
      worked: 0,
      rest: 60,
      runs: [{ start: 720, end: 780, worked: false }],
    });
  });

  void test('a block over the first half: 30 worked, 30 off, two runs in order', () => {
    assert.deepEqual(workedIn([span(720, 750)], span(720, 780)), {
      worked: 30,
      rest: 30,
      runs: [
        { start: 720, end: 750, worked: true },
        { start: 750, end: 780, worked: false },
      ],
    });
  });

  void test('a block over the whole window, from outside it on both sides: worked through', () => {
    assert.deepEqual(workedIn([span(700, 800)], span(720, 780)), {
      worked: 60,
      rest: 0,
      runs: [{ start: 720, end: 780, worked: true }],
    });
  });

  void test('two blocks at once count each minute once; touching blocks are one run', () => {
    const w = workedIn([span(725, 745), span(735, 755), span(755, 760)], span(720, 780));
    assert.equal(w.worked, 35);
    assert.equal(w.rest, 25);
    assert.deepEqual(w.runs, [
      { start: 720, end: 725, worked: false },
      { start: 725, end: 760, worked: true },
      { start: 760, end: 780, worked: false },
    ]);
  });
});

void describe('rangeFromDrag and freeAround — a range dragged on the empty track (LAI-897)', () => {
  const span = (start: number, end: number) => ({ start, end });
  const confirmed = [span(540, 600), span(780, 840)];

  void test('freeAround is the whole day with nothing confirmed, and the stretch between blocks otherwise', () => {
    assert.deepEqual(freeAround(700, []), { lo: 0, hi: 1440 });
    assert.deepEqual(freeAround(700, confirmed), { lo: 600, hi: 780 });
    assert.deepEqual(freeAround(500, confirmed, 420), { lo: 420, hi: 540 });
    assert.equal(freeAround(570, confirmed), undefined);
  });

  void test('both ends land on five minutes, in order, whichever way the drag went', () => {
    assert.deepEqual(rangeFromDrag(843, 898, []), { start: 845, end: 900 });
    assert.deepEqual(rangeFromDrag(898, 843, []), { start: 845, end: 900 });
  });

  void test('a drag into a confirmed block stops at its edge', () => {
    assert.deepEqual(rangeFromDrag(650, 900, confirmed), { start: 650, end: 780 });
    assert.deepEqual(rangeFromDrag(650, 300, confirmed), { start: 600, end: 650 });
  });

  void test('a drag that starts on a confirmed block, or ends up under one step, is nothing', () => {
    assert.equal(rangeFromDrag(560, 700, confirmed), undefined);
    assert.equal(rangeFromDrag(650, 652, confirmed), undefined);
  });
});

/* ------------------------------------------------------- drag (LAI-512) */

const lane = (id: string, kind: LaneBlock['kind'], from: number, to: number): LaneBlock => ({
  kind,
  id,
  start: from,
  end: to,
  minutes: to - from,
  needsCard: false,
  locked: false,
});

void describe('a block moved whole (the design’s move)', () => {
  const d3 = { start: min(13), end: min(14, 50), minutes: 100 };

  void test('its start lands on the five-minute grid, its span comes with it, its minutes stay', () => {
    assert.deepEqual(moveBlock(d3, min(13, 32)), {
      start: min(13, 30),
      end: min(15, 20),
      minutes: 100,
    });
    assert.deepEqual(moveBlock(d3, min(12, 53)), {
      start: min(12, 55),
      end: min(14, 45),
      minutes: 100,
    });
  });

  void test('a move that snaps back to where it was is nothing', () => {
    assert.equal(moveBlock(d3, min(13, 2)), undefined);
  });

  void test('past midnight it goes there, unpinned, so the drop can refuse it', () => {
    const late = moveBlock(d3, min(23, 30));
    assert.deepEqual(late, { start: min(23, 30), end: min(25, 20), minutes: 100 });
    assert.deepEqual(checkDrop(late ?? d3, [], 'd3'), { ok: false, why: 'midnight' });
  });
});

void describe('whether a block may land where it is (the design’s check)', () => {
  const e1 = lane('e1', 'confirmed', min(11, 30), min(12));
  const e2 = lane('e2', 'confirmed', min(12), min(12, 30));
  const d2 = lane('d2', 'drafted', min(10, 40), min(11, 20));
  const blocks = [d2, e1, e2];

  void test('on a free stretch of the day, and over drafts, it may', () => {
    assert.deepEqual(checkDrop({ start: min(9), end: min(10) }, blocks, undefined), { ok: true });
    assert.deepEqual(checkDrop({ start: min(10, 30), end: min(11) }, blocks, undefined), {
      ok: true,
    });
  });

  void test('a confirmed block or a tray item over confirmed time may not, and the refusal names that block', () => {
    const check = checkDrop({ start: min(11, 45), end: min(12, 15) }, blocks, 'e1');
    assert.equal(check.ok, false);
    assert.equal(!check.ok && check.why === 'overlap' ? check.over.id : '', 'e2');
    const tray = checkDrop({ start: min(12), end: min(12, 20) }, blocks, undefined);
    assert.equal(!tray.ok && tray.why === 'overlap' ? tray.over.id : '', 'e2');
  });

  void test('a draft may lie over confirmed time — the design’s check, LAI-510; confirming it there is refused', () => {
    assert.deepEqual(checkDrop({ start: min(11, 30), end: min(12, 10) }, blocks, 'd2'), {
      ok: true,
    });
    // Midnight still binds a draft.
    assert.deepEqual(checkDrop({ start: min(23, 50), end: min(24, 30) }, blocks, 'd2'), {
      ok: false,
      why: 'midnight',
    });
  });

  void test('a draft’s edges run the whole day; a confirmed block’s stop at its neighbours', () => {
    const line = { blocks, length: 1440 };
    assert.deepEqual(limitsIn(line, d2), { lo: 0, hi: 1440 });
    assert.deepEqual(limitsIn(line, e1), { lo: 0, hi: min(12) });
  });

  void test('its own place is never in its way, and touching end to start is not overlapping', () => {
    assert.deepEqual(checkDrop({ start: min(11, 35), end: min(12) }, blocks, 'e1'), { ok: true });
    assert.deepEqual(checkDrop({ start: min(12, 30), end: min(13) }, blocks, undefined), {
      ok: true,
    });
  });

  void test('across either midnight it may not — before the day, or past its length', () => {
    assert.deepEqual(checkDrop({ start: -5, end: 20 }, [], undefined), {
      ok: false,
      why: 'midnight',
    });
    assert.deepEqual(checkDrop({ start: min(23, 50), end: min(24, 10) }, [], undefined), {
      ok: false,
      why: 'midnight',
    });
    // A day with an hour less (a clock change) ends sooner.
    assert.deepEqual(checkDrop({ start: min(22, 50), end: min(23, 10) }, [], undefined, 1380), {
      ok: false,
      why: 'midnight',
    });
  });
});

void describe('a tray item dropped on the track', () => {
  void test('it lands centred on the pointer, on the grid', () => {
    // 25 min at 4:30 PM: 4:17:30 snaps to 4:20.
    assert.deepEqual(trayDropSpan(min(16, 30), 25), { start: min(16, 20), end: min(16, 45) });
    assert.deepEqual(trayDropSpan(min(9, 2), 60), { start: min(8, 30), end: min(9, 30) });
  });

  void test('never shorter than a step', () => {
    // 2 min counts as 5 at 10:00: 9:57:30 snaps to 10:00.
    assert.deepEqual(trayDropSpan(min(10), 2), { start: min(10), end: min(10, 5) });
  });

  void test('near midnight it is not pinned to the day: the check refuses it', () => {
    const span = trayDropSpan(5, 40);
    assert.deepEqual(span, { start: -15, end: 25 });
    assert.deepEqual(checkDrop(span, [], undefined), { ok: false, why: 'midnight' });
  });
});

void describe('the running timer on the track (the design’s S.timer)', () => {
  const midnight = Date.UTC(2026, 9, 22);
  const at = (h: number, m = 0): number => midnight + min(h, m) * 60_000;

  void test('running: from the minute it started, as long as it has run, paused time left out', () => {
    // Started 2:20, 49 min banked, running again since 2:59; now 3:00.
    const timer = {
      started_at: at(14, 20),
      resumed_at: at(14, 59),
      paused_at: null,
      accumulated_ms: 49 * 60_000,
    };
    assert.deepEqual(timerSpan(timer, midnight, 1440, at(15)), {
      start: min(14, 20),
      end: min(15, 10),
      minutes: 50,
      paused: false,
    });
  });

  void test('paused: the banked minutes only, however long since', () => {
    const timer = {
      started_at: at(9),
      resumed_at: at(9),
      paused_at: at(9, 42),
      accumulated_ms: 42 * 60_000,
    };
    assert.deepEqual(timerSpan(timer, midnight, 1440, at(15)), {
      start: min(9),
      end: min(9, 42),
      minutes: 42,
      paused: true,
    });
  });

  void test('three minutes wide at least, so a timer just started can be seen and clicked', () => {
    const timer = { started_at: at(15), resumed_at: at(15), paused_at: null, accumulated_ms: 0 };
    assert.deepEqual(timerSpan(timer, midnight, 1440, at(15, 0) + 30_000), {
      start: min(15),
      end: min(15, 3),
      minutes: 0,
      paused: false,
    });
  });

  void test('none, or one that started on another day, is not on this day’s track', () => {
    assert.equal(timerSpan(null, midnight, 1440, at(15)), undefined);
    const yesterday = {
      started_at: at(-2),
      resumed_at: at(-2),
      paused_at: null,
      accumulated_ms: 0,
    };
    assert.equal(timerSpan(yesterday, midnight, 1440, at(15)), undefined);
    assert.equal(timerSpan(yesterday, undefined, 1440, at(15)), undefined);
  });
});
