import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MyDay, TimeDraft, TimeEntry } from '../../../../src/api/time.ts';
import {
  agentsDuring,
  along,
  axisHours,
  buildScale,
  clip,
  dayFigures,
  dayLine,
  dragEdge,
  gapsOf,
  idleEnds,
  limitsOf,
  placeChips,
  setLength,
  signalsDuring,
  snap,
  splitPoint,
  stackOf,
  stepEnd,
  stepMinutes,
  FOLD_PX,
  PX_PER_HOUR,
  type AgentRun,
  type Box,
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
  void test('twenty minutes or more is a gap; less is a breath', () => {
    const blocks = [
      { start: min(9), end: min(10) },
      { start: min(10, 19), end: min(11) },
      { start: min(11, 20), end: min(12) },
    ];
    assert.deepEqual(gapsOf(blocks, []), [{ start: min(11), end: min(11, 20) }]);
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
    // 10:00–11:00, less 10:10–10:45: 10 minutes (a breath) and 15 (a breath).
    assert.deepEqual(gapsOf(blocks, [{ start: min(10, 10), end: min(10, 45) }]), []);
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
    assert.deepEqual(line.gaps, [{ start: min(10, 15), end: min(10, 40) }]);
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

void describe('placeChips — a badge only where it clears everything (LAI-860)', () => {
  const box = (l: number, r: number, t = 10, b = 60): Box => ({ l, r, t, b });
  const TRACK = { l: 0, r: 1000 };
  // A badge as drawn: 50 px wide, from 8 px above its block to 11 px into it.
  const chip = (id: string, top = 2, bottom = 21) => ({ id, width: 50, top, bottom });

  void test('inside its block’s end where it fits, the inset from that end', () => {
    const places = placeChips([chip('a')], new Map([['a', box(0, 200)]]), TRACK, 4);
    assert.deepEqual([...places], [['a', 'end']]);
    // 50 px and 4 px either side need 58: one pixel less is centred over it.
    const tight = placeChips([chip('a')], new Map([['a', box(0, 57)]]), TRACK, 4);
    assert.deepEqual([...tight], [['a', 'centre']]);
  });

  void test('a short block standing alone keeps its badge, centred over it', () => {
    const places = placeChips([chip('a')], new Map([['a', box(100, 110)]]), TRACK, 4);
    assert.deepEqual([...places], [['a', 'centre']]);
  });

  void test('not drawn where it would lie over another block; touching is not lying over', () => {
    // Centred over a: 80–130.
    const near = new Map([
      ['a', box(100, 110)],
      ['b', box(120, 140)],
    ]);
    assert.deepEqual([...placeChips([chip('a')], near, TRACK, 4)], []);
    const touching = new Map([
      ['a', box(100, 110)],
      ['b', box(130, 140)],
    ]);
    assert.deepEqual([...placeChips([chip('a')], touching, TRACK, 4)], [['a', 'centre']]);
  });

  void test('of two badges that would meet, the longer block’s is drawn', () => {
    // Badges above the blocks, so only they can meet: a's 80–130, b's 120–170.
    const blocks = new Map([
      ['a', box(100, 110)],
      ['b', box(135, 155)],
    ]);
    const above = (id: string) => chip(id, 0, 9);
    assert.deepEqual(
      [...placeChips([above('a'), above('b')], blocks, TRACK, 4)],
      [['b', 'centre']],
    );
    // As long as each other: the one further left.
    const even = new Map([
      ['a', box(100, 110)],
      ['b', box(140, 150)],
    ]);
    assert.deepEqual([...placeChips([above('b'), above('a')], even, TRACK, 4)], [['a', 'centre']]);
  });

  void test('not drawn past either end of the track', () => {
    const first = placeChips([chip('a')], new Map([['a', box(0, 10)]]), TRACK, 4);
    const last = placeChips([chip('a')], new Map([['a', box(990, 1000)]]), TRACK, 4);
    assert.deepEqual([...first, ...last], []);
  });

  void test('in a stack, a lower row’s badge lies over the row above and is not drawn', () => {
    // Rows of 10 px, 2 px apart: the top row's badge ends above the next row.
    const two = new Map([
      ['a', box(0, 200, 10, 20)],
      ['b', box(0, 200, 22, 32)],
    ]);
    const chips = [chip('a', 2, 21), chip('b', 14, 33)];
    assert.deepEqual([...placeChips(chips, two, TRACK, 4)], [['a', 'end']]);
    // Rows of 8 px: it reaches 1 px into the next, so neither is drawn.
    const deep = new Map([
      ['a', box(0, 200, 10, 18)],
      ['b', box(0, 200, 20, 28)],
    ]);
    const deepChips = [chip('a', 2, 21), chip('b', 12, 31)];
    assert.deepEqual([...placeChips(deepChips, deep, TRACK, 4)], []);
  });

  void test('a badge whose block is not drawn is left out', () => {
    assert.deepEqual([...placeChips([chip('gone')], new Map(), TRACK, 4)], []);
  });
});

void describe('idleEnds — the idle stretches Fit folds (LAI-883)', () => {
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

void describe('buildScale — minutes to px and back (LAI-883)', () => {
  void test('1× and 2× are linear at their px an hour, whatever the width', () => {
    const one = buildScale(6, 22, '1', 500);
    assert.equal(one.total, 16 * (PX_PER_HOUR['1'] ?? 0));
    assert.equal(one.pos(min(7)), PX_PER_HOUR['1']);
    assert.equal(one.at(one.pos(min(13, 20))), min(13, 20));
    assert.equal(one.folded(min(7)), false);
    const two = buildScale(6, 22, '2', 500);
    assert.equal(two.pos(min(7)), PX_PER_HOUR['2']);
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

void describe('agentsDuring and signalsDuring — what fell inside a span (LAI-883)', () => {
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

void describe('dayFigures — the Timeline header (LAI-883)', () => {
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
