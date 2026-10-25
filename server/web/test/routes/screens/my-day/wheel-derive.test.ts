import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { duration } from '../../../../src/routes/screens/my-day/format.ts';
import { clockMinute, lengthMinutes } from '../../../../src/routes/screens/my-day/when-parse.ts';
import {
  clockFrom,
  clockIndexes,
  clockText,
  lengthFrom,
  lengthIndexes,
  WHEEL_HOURS,
  WHEEL_MINUTES,
} from '../../../../src/routes/screens/my-day/wheel-derive.ts';

const GRID = Array.from({ length: 1440 / 5 }, (_, i) => i * 5);

void describe('the time wheel — a time of day', () => {
  void test('hour, minute and AM or PM, as an iPhone shows them', () => {
    assert.deepEqual(clockIndexes(0), { hour: 11, minute: 0, period: 0 }); // 12:00 AM
    assert.deepEqual(clockIndexes(12 * 60), { hour: 11, minute: 0, period: 1 }); // 12:00 PM
    assert.deepEqual(clockIndexes(13 * 60 + 30), { hour: 0, minute: 6, period: 1 }); // 1:30 PM
    assert.equal(WHEEL_HOURS[clockIndexes(13 * 60 + 30).hour], '1');
    assert.equal(WHEEL_MINUTES[clockIndexes(13 * 60 + 30).minute], '30');
  });

  void test('a time off the grid stands on the nearest five minutes', () => {
    assert.deepEqual(clockIndexes(10 * 60 + 32), clockIndexes(10 * 60 + 30));
    assert.deepEqual(clockIndexes(10 * 60 + 33), clockIndexes(10 * 60 + 35));
  });

  void test('every five minutes of the day goes round the columns and back', () => {
    for (const m of GRID) assert.equal(clockFrom(clockIndexes(m)), m, String(m));
  });

  void test('what the wheel writes, the field reads back to the same minute', () => {
    assert.equal(clockText(13 * 60 + 30), '1:30 PM');
    assert.equal(clockText(0), '12:00 AM');
    for (const m of GRID) assert.equal(clockMinute(clockText(m), m), m, clockText(m));
  });
});

void describe('the time wheel — a length', () => {
  void test('hours and minutes on the grid, a day at most, never empty', () => {
    assert.deepEqual(lengthIndexes(95), { hours: 1, minutes: 7 });
    assert.deepEqual(lengthIndexes(2000), { hours: 23, minutes: 11 });
    assert.equal(lengthFrom({ hours: 0, minutes: 0 }), 5);
    assert.equal(lengthFrom({ hours: 2, minutes: 6 }), 150);
  });

  void test('what the wheel writes for a length, the field reads back', () => {
    for (let m = 5; m <= 23 * 60 + 55; m += 5) {
      assert.equal(lengthFrom(lengthIndexes(m)), m);
      assert.equal(lengthMinutes(duration(m)), m, duration(m));
    }
  });
});
