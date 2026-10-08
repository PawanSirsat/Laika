import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { donutArcs, percentLabel, roundedPercents } from '../../src/components/donut-arcs.ts';

void describe('donut geometry (LAI-711)', () => {
  void test('percentages always add up to 100', () => {
    assert.deepEqual(roundedPercents([1, 1, 1]), [34, 33, 33]);
    // Two equal small shares can round apart; the legend writes `<1%` for a
    // share that rounds to nothing, so neither reads as zero work.
    assert.deepEqual(roundedPercents([206, 2, 2, 133]), [60, 1, 0, 39]);
    for (const values of [[7, 3], [1, 2, 3, 4, 5, 6], [99, 1, 0], [5]]) {
      const sum = roundedPercents(values).reduce((a, b) => a + b, 0);
      assert.equal(sum, 100, `${JSON.stringify(values)} adds to ${String(sum)}`);
    }
  });

  void test('nothing at all is every share zero, not NaN', () => {
    assert.deepEqual(roundedPercents([0, 0]), [0, 0]);
    assert.deepEqual(
      donutArcs([0, 0]).map((a) => a.length),
      [0, 0],
    );
  });

  void test('a zero value never takes a percentage point from the rounding', () => {
    assert.deepEqual(roundedPercents([1, 0, 2]), [33, 0, 67]);
  });

  void test('slices run clockwise in order and cover the ring less the gaps', () => {
    const arcs = donutArcs([1, 1, 2], 1);
    assert.deepEqual(
      arcs.map((a) => a.start),
      [0.5, 25.5, 50.5],
    );
    assert.deepEqual(
      arcs.map((a) => a.length),
      [24, 24, 49],
    );
  });

  void test('a lone slice is a full ring with no gap', () => {
    const [only, empty] = donutArcs([5, 0]);
    assert.deepEqual(only, { start: 0, length: 100, percent: 100 });
    assert.equal(empty?.length, 0);
  });

  void test('a slice smaller than the gap still shows as a sliver', () => {
    const arcs = donutArcs([1, 999], 0.8);
    assert.ok((arcs[0]?.length ?? 0) > 0, 'one task vanished from the chart');
  });

  void test('a share that rounds to nothing reads as under one percent, never zero', () => {
    assert.equal(percentLabel(0, 1), '<1%');
    assert.equal(percentLabel(0, 0), '0%');
    assert.equal(percentLabel(38, 133), '38%');
  });
});
