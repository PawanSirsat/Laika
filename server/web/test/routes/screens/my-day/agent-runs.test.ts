import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MyDay } from '../../../../src/api/time.ts';
import { dayLine } from '../../../../src/routes/screens/my-day/timeline-derive.ts';

/**
 * The AGENTS lane's bars (LAI-833): the five-minute buckets the agent worked
 * in, back to back, joined into one bar while they stay on a card or off one —
 * only what the server sent, placed in minutes after the day's midnight.
 */

const DAY = '2026-10-20';
const MIDNIGHT = Date.parse(`${DAY}T00:00:00Z`);
const at = (h: number, m = 0): number => MIDNIGHT + (h * 60 + m) * 60_000;
const min = (h: number, m = 0): number => h * 60 + m;
const NOON = at(12);

type Lane = readonly (readonly [number, number, number])[];

const view = (
  lane?: Lane,
): Pick<MyDay, 'day' | 'tz' | 'today' | 'drafts' | 'entries' | 'breaks'> & {
  agent?: { lane?: Lane };
} => ({
  day: DAY,
  tz: 'UTC',
  today: '2026-10-21',
  drafts: [],
  entries: [],
  breaks: [],
  ...(lane === undefined ? {} : { agent: { lane } }),
});

void describe('dayLine — the AGENTS lane', () => {
  void test('joins buckets back to back into one bar while they stay on a card or off it', () => {
    const line = dayLine(
      view([
        [at(9, 0), 300, 300],
        [at(9, 5), 240, 240],
        [at(9, 10), 120, 0],
        [at(9, 20), 60, 60],
      ]),
      NOON,
    );
    assert.deepEqual(line.agents, [
      { start: min(9), end: min(9, 10), seconds: 540, onCard: true },
      { start: min(9, 10), end: min(9, 15), seconds: 120, onCard: false },
      { start: min(9, 20), end: min(9, 25), seconds: 60, onCard: true },
    ]);
  });

  void test('a bucket is on a card when most of its time is', () => {
    const line = dayLine(
      view([
        [at(9, 0), 100, 50],
        [at(9, 5), 100, 49],
      ]),
      NOON,
    );
    assert.deepEqual(
      line.agents.map((a) => a.onCard),
      [true, false],
    );
  });

  void test('has no bars without a lane', () => {
    assert.deepEqual(dayLine(view(), NOON).agents, []);
    assert.deepEqual(dayLine(view([]), NOON).agents, []);
  });

  void test('widens the axis to the agent’s work, as a block does', () => {
    const line = dayLine(view([[at(4, 30), 60, 0]]), NOON);
    assert.equal(line.from, 4);
  });

  void test('leaves out a bucket that is not on this day', () => {
    const line = dayLine(
      view([
        [at(-1, 0), 60, 0],
        [at(10, 0), 60, 0],
        [at(24, 0), 60, 0],
      ]),
      NOON,
    );
    assert.deepEqual(line.agents, [
      { start: min(10), end: min(10, 5), seconds: 60, onCard: false },
    ]);
  });
});
