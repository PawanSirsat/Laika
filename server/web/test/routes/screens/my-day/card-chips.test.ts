import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardChips } from '../../../../src/routes/screens/my-day/card-chips.ts';

/**
 * The cards offered as chips in the inspector and Add time (LAI-831): the
 * block's own first, then the reader's own work in progress, then the day's
 * other cards — each once, and a handful, never a list of everything.
 */

const card = (n: number) => ({
  id: `t${String(n)}`,
  key: `LAI-${String(n)}`,
  title: `Card ${String(n)}`,
});

void describe('cardChips', () => {
  void test('the block’s own card first, then work in progress, then the day’s', () => {
    assert.deepEqual(
      cardChips(card(3), [card(1), card(2)], [card(4), card(1)]).map((c) => c.key),
      ['LAI-3', 'LAI-1', 'LAI-2', 'LAI-4'],
    );
  });

  void test('each card once, and no more than the cap', () => {
    const many = Array.from({ length: 10 }, (_, i) => card(i + 1));
    assert.deepEqual(
      cardChips(null, many, many, 4).map((c) => c.key),
      ['LAI-1', 'LAI-2', 'LAI-3', 'LAI-4'],
    );
  });

  void test('nothing to offer is nothing, never a made-up card', () => {
    assert.deepEqual(cardChips(null, [], []), []);
  });
});
