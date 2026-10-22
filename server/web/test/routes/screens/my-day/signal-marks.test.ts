import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MyDay } from '../../../../src/api/time.ts';
import { dayLine } from '../../../../src/routes/screens/my-day/timeline-derive.ts';

/**
 * The SIGNALS lane's marks (LAI-834, D-096): the day's prompts and commits,
 * each in the five minutes it fell in, as minutes after the day's midnight —
 * only what the server sent, nothing spread or invented.
 */

const DAY = '2026-10-20';
const MIDNIGHT = Date.parse(`${DAY}T00:00:00Z`);
const at = (h: number, m = 0): number => MIDNIGHT + (h * 60 + m) * 60_000;
const min = (h: number, m = 0): number => h * 60 + m;
const NOON = at(12);

const view = (
  over: Partial<Pick<MyDay, 'signal_times' | 'tz' | 'day'>> = {},
): Pick<MyDay, 'day' | 'tz' | 'today' | 'drafts' | 'entries' | 'breaks' | 'signal_times'> => ({
  day: DAY,
  tz: 'UTC',
  today: '2026-10-21',
  drafts: [],
  entries: [],
  breaks: [],
  ...over,
});

void describe('dayLine — the SIGNALS lane', () => {
  void test('puts each prompt and commit at its five minutes, prompts first, each in time order', () => {
    const line = dayLine(
      view({
        signal_times: {
          prompts: [
            [at(9, 10), 2],
            [at(14, 0), 1],
          ],
          commits: [[at(9, 40), 3]],
        },
      }),
      NOON,
    );
    assert.deepEqual(line.signals, [
      { kind: 'prompt', start: min(9, 10), count: 2 },
      { kind: 'prompt', start: min(14), count: 1 },
      { kind: 'commit', start: min(9, 40), count: 3 },
    ]);
  });

  void test('has no marks for a day drafted without them, or a board that sends none', () => {
    assert.deepEqual(dayLine(view(), NOON).signals, []);
    assert.deepEqual(
      dayLine(view({ signal_times: { prompts: [], commits: [] } }), NOON).signals,
      [],
    );
  });

  void test('widens the axis to a mark outside the usual hours, as a block does', () => {
    const line = dayLine(
      view({ signal_times: { prompts: [[at(4, 20), 1]], commits: [[at(23, 15), 1]] } }),
      NOON,
    );
    assert.equal(line.from, 4);
    assert.equal(line.to, 24);
  });

  void test('leaves out a mark that is not on this day', () => {
    const line = dayLine(
      view({
        signal_times: {
          prompts: [
            [at(-1, 0), 1],
            [at(10, 0), 1],
          ],
          commits: [[at(24, 5), 1]],
        },
      }),
      NOON,
    );
    assert.deepEqual(line.signals, [{ kind: 'prompt', start: min(10), count: 1 }]);
  });

  void test('counts minutes from the day’s own midnight, in its zone', () => {
    // 09:10 in Kolkata is 03:40 UTC.
    const kolkata = Date.parse(`${DAY}T00:00:00+05:30`);
    const line = dayLine(
      view({
        tz: 'Asia/Kolkata',
        signal_times: { prompts: [[kolkata + min(9, 10) * 60_000, 1]], commits: [] },
      }),
      NOON,
    );
    assert.deepEqual(line.signals, [{ kind: 'prompt', start: min(9, 10), count: 1 }]);
  });
});
