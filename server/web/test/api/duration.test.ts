/**
 * `src/api/duration.ts` — how long something took, in words (LAI-830).
 *
 * The owner, on My day's `0:19` and `1:09`: *"is this minutes or hours?"*.
 * A duration says its units: `19 min`, `1 h 9 min`, `2 h`, `3 d 4 h`, and
 * never `h:mm`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatDuration, formatDurationMs } from '../../src/api/duration.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

void describe('formatDuration — minutes in, words out', () => {
  void test('the owner’s figures: 19 min, 15 min, 8 min and a total of 1 h 9 min', () => {
    assert.equal(formatDuration(19), '19 min');
    assert.equal(formatDuration(15), '15 min');
    assert.equal(formatDuration(8), '8 min');
    assert.equal(formatDuration(69), '1 h 9 min');
  });

  void test('zero is 0 min, and under a minute is < 1 min — never 0 for something that ran', () => {
    assert.equal(formatDuration(0), '0 min');
    assert.equal(formatDuration(0.2), '< 1 min');
    assert.equal(formatDuration(0.99), '< 1 min');
    assert.equal(formatDuration(1), '1 min');
  });

  void test('59 minutes is minutes; 60 is 1 h, with no 0 min on the end', () => {
    assert.equal(formatDuration(59), '59 min');
    assert.equal(formatDuration(60), '1 h');
    assert.equal(formatDuration(120), '2 h');
    assert.equal(formatDuration(170), '2 h 50 min');
  });

  void test('rounds to the whole minute, and a round up to the hour says the hour', () => {
    assert.equal(formatDuration(18.4), '18 min');
    assert.equal(formatDuration(18.5), '19 min');
    assert.equal(formatDuration(59.6), '1 h');
    assert.equal(formatDuration(119.5), '2 h');
  });

  void test('under a day keeps its minutes; a day or more is days and whole hours', () => {
    assert.equal(formatDuration(23 * 60 + 59), '23 h 59 min');
    assert.equal(formatDuration(24 * 60), '1 d');
    assert.equal(formatDuration(3 * 24 * 60 + 4 * 60), '3 d 4 h');
    // 1 d 0 h 29 min rounds to the hour: 1 d.
    assert.equal(formatDuration(24 * 60 + 29), '1 d');
    // 1 d 0 h 30 min rounds up a whole hour.
    assert.equal(formatDuration(24 * 60 + 30), '1 d 1 h');
    // 2 d 23 h 40 min rounds up into the next day, and says no 0 h.
    assert.equal(formatDuration(2 * 24 * 60 + 23 * 60 + 40), '3 d');
  });

  void test('a negative or a non-number is 0 min, never a minus sign or NaN', () => {
    assert.equal(formatDuration(-5), '0 min');
    assert.equal(formatDuration(Number.NaN), '0 min');
    assert.equal(formatDuration(Number.POSITIVE_INFINITY), '0 min');
  });

  void test('minutesOnly keeps an agent’s time in minutes, however long (D-088 item 8)', () => {
    assert.equal(formatDuration(600, { minutesOnly: true }), '600 min');
    assert.equal(formatDuration(142, { minutesOnly: true }), '142 min');
    assert.equal(formatDuration(0, { minutesOnly: true }), '0 min');
    assert.equal(formatDuration(0.4, { minutesOnly: true }), '< 1 min');
  });

  void test('never prints h:mm', () => {
    for (const minutes of [0, 1, 9, 59, 60, 61, 69, 119, 600, 1439, 1440, 10_000]) {
      assert.doesNotMatch(formatDuration(minutes), /\d:\d/, `${String(minutes)} printed as h:mm`);
    }
  });
});

void describe('formatDurationMs — the same words from milliseconds', () => {
  void test('reads milliseconds as the same durations', () => {
    assert.equal(formatDurationMs(19 * MIN), '19 min');
    assert.equal(formatDurationMs(HOUR + 9 * MIN), '1 h 9 min');
    assert.equal(formatDurationMs(3 * DAY + 4 * HOUR), '3 d 4 h');
    assert.equal(formatDurationMs(20_000), '< 1 min');
    assert.equal(formatDurationMs(0), '0 min');
  });
});
