/** The page's one rising order (LAI-538 review, round 5). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextReadOrder } from '../../src/api/read-order.ts';

void describe('nextReadOrder', () => {
  void test('every number is larger than every one before it — never a tie', () => {
    const seen = Array.from({ length: 1000 }, () => nextReadOrder());
    for (let i = 1; i < seen.length; i += 1) {
      assert.ok((seen[i] ?? 0) > (seen[i - 1] ?? 0), `order ${String(i)} did not rise`);
    }
  });

  void test('starts above zero, so 0 can mean "read before any order was taken"', () => {
    assert.ok(nextReadOrder() > 0);
  });
});
