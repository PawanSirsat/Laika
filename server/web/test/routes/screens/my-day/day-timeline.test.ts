/**
 * My day's timeline bar (LAI-796): confirmed and drafted blocks across the
 * working day, in the reader's own zone, with a line at now.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dayTimeline, hourTicks } from '../../../../src/routes/screens/my-day/day-timeline.ts';
import type { TimeDraft, TimeEntry } from '../../../../src/api/time.ts';

const TZ = 'Asia/Kolkata'; // UTC+5:30, no daylight saving: a fixed fixture
const DAY = '2026-10-20';
/** `h:m` on DAY in TZ, as epoch ms. */
const at = (h: number, m = 0): number => Date.UTC(2026, 9, 20, h, m) - (5 * 60 + 30) * 60_000;

function entry(id: string, from: number | null, to: number | null, minutes: number): TimeEntry {
  return {
    id,
    day: DAY,
    tz: TZ,
    started_at: from,
    ended_at: to,
    minutes,
    source: 'manual',
    task: null,
    project: null,
    note: null,
    revision: 1,
    created_at: 0,
    updated_at: 0,
  };
}

function draft(id: string, from: number | null, to: number | null, minutes: number): TimeDraft {
  return {
    id,
    source: 'collector',
    day: DAY,
    tz: TZ,
    started_at: from,
    ended_at: to,
    minutes,
    task: { id: 't1', key: 'LAI-1', title: 'A card' },
    task_key: null,
    project: null,
    general: false,
    signals: { prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 },
    note: null,
  };
}

const view = (
  drafts: readonly TimeDraft[],
  entries: readonly TimeEntry[],
  today = '2026-10-21',
) => ({ day: DAY, tz: TZ, today, drafts, entries });

void describe('the blocks', () => {
  void test('each timed block is placed by its own clock in the reader’s zone', () => {
    const line = dayTimeline(view([draft('d1', at(13), at(14, 50), 110)], [entry('e1', at(11, 30), at(12), 30)]), at(23));
    assert.deepEqual(
      line.blocks.map((b) => [b.kind, b.id, b.start, b.end]),
      [
        ['confirmed', 'e1', 11 * 60 + 30, 12 * 60],
        ['drafted', 'd1', 13 * 60, 14 * 60 + 50],
      ],
    );
  });

  void test('labels say what it was and how long, in the order of the day', () => {
    const line = dayTimeline(view([draft('d1', at(9), at(10), 60)], [entry('e1', at(11), at(11, 30), 30)]), at(23));
    assert.deepEqual(
      line.blocks.map((b) => b.label),
      ['LAI-1 A card · 1:00', 'General · 0:30'],
    );
  });

  void test('a block with no set time is not drawn, and is counted', () => {
    const line = dayTimeline(view([draft('d1', null, null, 45)], [entry('e1', null, null, 30)]), at(23));
    assert.deepEqual(line.blocks, []);
    assert.equal(line.untimed, 2);
  });

  void test('a block that began the day before starts at midnight', () => {
    const line = dayTimeline(view([], [entry('e1', at(-1), at(1), 120)]), at(23));
    assert.equal(line.blocks[0]?.start, 0);
    assert.equal(line.blocks[0]?.end, 60);
  });
});

void describe('the span', () => {
  void test('8 to 18 when the day sits inside it', () => {
    const line = dayTimeline(view([], [entry('e1', at(10), at(11), 60)]), at(23));
    assert.equal(line.from, 8);
    assert.equal(line.to, 18);
  });

  void test('widens to whole hours to hold an early or a late block', () => {
    const line = dayTimeline(view([], [entry('e1', at(6, 45), at(7, 15), 30), entry('e2', at(19, 10), at(20, 5), 55)]), at(23));
    assert.equal(line.from, 6);
    assert.equal(line.to, 21);
  });
});

void describe('now', () => {
  void test('is drawn on today, at the minute', () => {
    const line = dayTimeline(view([], [], DAY), at(15, 20));
    assert.equal(line.now, 15 * 60 + 20);
  });

  void test('widens the span to be seen', () => {
    const line = dayTimeline(view([], [], DAY), at(21, 40));
    assert.equal(line.to, 22);
  });

  void test('is not drawn on another day', () => {
    assert.equal(dayTimeline(view([], []), at(15)).now, undefined);
  });
});

void describe('the hours under it', () => {
  void test('every other hour, ends included', () => {
    assert.deepEqual(hourTicks(8, 18), [8, 10, 12, 14, 16, 18]);
  });

  void test('an odd start ticks the even hours inside it', () => {
    assert.deepEqual(hourTicks(7, 13), [8, 10, 12]);
  });
});
