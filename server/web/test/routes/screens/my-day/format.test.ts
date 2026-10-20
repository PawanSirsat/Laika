import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  agentDuration,
  clock,
  duration,
  hourName,
  span,
} from '../../../../src/routes/screens/my-day/format.ts';

/**
 * My day's one seam for display formats (LAI-831, CHIEF's addition A): what
 * LAI-830's shared helpers print — durations in words, never `h:mm`, and the
 * 12-hour clock — with an agent's time in minutes however long (D-088 item 8).
 */

const at = (h: number, m = 0): number => Date.UTC(2026, 9, 20, h, m);

void describe('durations say their units', () => {
  void test('19 min, 1 h 35 min, 2 h — never 0:19 or 1:35', () => {
    assert.equal(duration(19), '19 min');
    assert.equal(duration(95), '1 h 35 min');
    assert.equal(duration(120), '2 h');
    for (const m of [5, 19, 60, 95, 310, 1439]) {
      assert.doesNotMatch(duration(m), /\d:\d/, `${String(m)} printed as h:mm`);
    }
  });

  void test('an agent’s time stays minutes, however long', () => {
    assert.equal(agentDuration(142), '142 min');
    assert.equal(agentDuration(600), '600 min');
  });
});

void describe('times of day on the 12-hour clock, in the day’s own zone', () => {
  void test('a time, and a range with one AM/PM when they share it', () => {
    assert.equal(clock(at(14, 29), 'UTC'), '2:29 PM');
    assert.equal(span(at(14, 29), at(14, 48), 'UTC'), '2:29–2:48 PM');
    assert.equal(span(at(11, 40), at(12, 10), 'UTC'), '11:40 AM–12:10 PM');
    assert.equal(clock(at(14, 29), 'Asia/Kolkata'), '7:59 PM');
  });

  void test('the axis names its hours: 6 AM, 12 PM, 10 PM', () => {
    assert.equal(hourName(6), '6 AM');
    assert.equal(hourName(12), '12 PM');
    assert.equal(hourName(22), '10 PM');
  });
});
