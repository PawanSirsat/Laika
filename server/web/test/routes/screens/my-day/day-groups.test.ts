import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { groupByPart, partOf } from '../../../../src/routes/screens/my-day/day-groups.ts';

/** The lists' groups (LAI-505): by the hour a block started, in its zone; untimed last. */

const at = (h: number, tz = 'UTC') => ({
  started_at: Date.UTC(2026, 9, 22, h),
  tz,
  minutes: 10,
});

void describe('partOf', () => {
  void test('before noon is morning, before five afternoon, after evening, in the block’s zone', () => {
    assert.equal(partOf(at(9)), 'morning');
    assert.equal(partOf(at(11)), 'morning');
    assert.equal(partOf(at(12)), 'afternoon');
    assert.equal(partOf(at(16)), 'afternoon');
    assert.equal(partOf(at(17)), 'evening');
    // 09:00 UTC is 14:30 in Kolkata.
    assert.equal(partOf(at(9, 'Asia/Kolkata')), 'afternoon');
    assert.equal(partOf({ started_at: null, tz: 'UTC' }), 'untimed');
  });
});

void describe('groupByPart', () => {
  void test('keeps the day’s order, counts and sums each group, and leaves empty groups out', () => {
    const groups = groupByPart([
      { ...at(13), minutes: 20, id: 'b' },
      { ...at(8), minutes: 30, id: 'a' },
      { started_at: null, tz: 'UTC', minutes: 25, id: 'u' },
      { ...at(18), minutes: 5, id: 'c' },
    ]);
    assert.deepEqual(
      groups.map((g) => [g.key, g.name, g.items.map((i) => i.id), g.minutes]),
      [
        ['morning', 'Morning', ['a'], 30],
        ['afternoon', 'Afternoon', ['b'], 20],
        ['evening', 'Evening', ['c'], 5],
        ['untimed', 'No set time', ['u'], 25],
      ],
    );
    assert.deepEqual(groupByPart([]), []);
  });
});
