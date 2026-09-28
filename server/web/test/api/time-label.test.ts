/**
 * `src/api/time-label.ts` — relative for a day, then a date (LAI-486, D-065).
 *
 * Every moment here is built from **local** components (`new Date(y, m, d, …)`),
 * so the expected strings hold in any timezone the suite runs in. The labels
 * use a fixed table of names rather than `Intl`, so no locale can change them
 * either — `27 Sep`, never `27 Sept`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { startTicker, timeLabel, type Timers } from '../../src/api/time-label.ts';

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number =>
  new Date(y, mo - 1, d, h, mi, s).getTime();

const NOW = at(2026, 9, 28, 15, 30, 0);
const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

void describe('timeLabel — the text', () => {
  void test('under a minute is just now; the minute boundary is exact', () => {
    assert.equal(timeLabel(NOW, NOW).text, 'just now');
    assert.equal(timeLabel(NOW - 59 * SEC, NOW).text, 'just now');
    assert.equal(timeLabel(NOW - 60 * SEC, NOW).text, '1 min ago');
  });

  void test('minutes up to the hour, then hours', () => {
    assert.equal(timeLabel(NOW - 4 * MIN, NOW).text, '4 min ago');
    assert.equal(timeLabel(NOW - 59 * MIN, NOW).text, '59 min ago');
    assert.equal(timeLabel(NOW - 60 * MIN, NOW).text, '1 h ago');
    assert.equal(timeLabel(NOW - (23 * HOUR + 59 * MIN), NOW).text, '23 h ago');
  });

  void test('a day or more is a date and a 24-hour time, day before month', () => {
    assert.equal(timeLabel(NOW - 24 * HOUR, NOW).text, '27 Sep, 15:30');
    assert.equal(timeLabel(at(2026, 9, 3, 9, 5), NOW).text, '3 Sep, 09:05');
    assert.equal(timeLabel(at(2026, 1, 14, 21, 45), NOW).text, '14 Jan, 21:45');
  });

  void test('another year says the year', () => {
    assert.equal(timeLabel(at(2025, 3, 14, 9, 12), NOW).text, '14 Mar 2025, 09:12');
  });

  void test('across New Year: forty minutes is still relative, two days is a dated year', () => {
    const newYear = at(2026, 1, 1, 0, 30);
    assert.equal(timeLabel(at(2025, 12, 31, 23, 50), newYear).text, '40 min ago');
    assert.equal(timeLabel(at(2025, 12, 30, 12, 0), newYear).text, '30 Dec 2025, 12:00');
  });

  void test('a future stamp reads just now, never a negative age', () => {
    const label = timeLabel(NOW + 3 * MIN, NOW);
    assert.equal(label.text, 'just now');
    assert.equal(label.fresh, true);
  });
});

void describe('timeLabel — the rest of the label', () => {
  void test('full is the whole moment, weekday first', () => {
    assert.equal(timeLabel(at(2026, 9, 27, 14, 5, 31), NOW).full, 'Sun 27 Sep 2026, 14:05:31');
  });

  void test('iso is the instant, for <time dateTime>', () => {
    const moment = at(2026, 9, 27, 14, 5, 31);
    assert.equal(timeLabel(moment, NOW).iso, new Date(moment).toISOString());
  });

  void test('fresh is under an hour, and the boundary is exact', () => {
    assert.equal(timeLabel(NOW - 59 * MIN, NOW).fresh, true);
    assert.equal(timeLabel(NOW - 60 * MIN, NOW).fresh, false);
  });
});

void describe('startTicker — a table left open keeps moving', () => {
  void test('ticks at the interval asked for, and the stop clears that same interval', () => {
    const started: { ms: number; id: symbol }[] = [];
    const cleared: unknown[] = [];
    const id = Symbol('interval');
    const timers: Timers = {
      setInterval: (_run, ms) => {
        started.push({ ms, id });
        return id;
      },
      clearInterval: (x) => {
        cleared.push(x);
      },
    };
    const stop = startTicker(() => undefined, 60_000, timers);
    assert.deepEqual(started, [{ ms: 60_000, id }]);
    assert.deepEqual(cleared, [], 'cleared before anyone asked');
    stop();
    assert.deepEqual(cleared, [id], 'the stop did not clear the interval it started');
  });
});
