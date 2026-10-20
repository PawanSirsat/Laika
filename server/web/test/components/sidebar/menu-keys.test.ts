/**
 * The user menu's keys (LAI-796): arrows move through the items and wrap,
 * Home and End jump, and nothing else moves the focus.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { menuStep } from '../../../src/components/sidebar/menu-keys.ts';

void describe('moving through a menu of four', () => {
  void test('down and up move one, and wrap at the ends', () => {
    assert.equal(menuStep(4, 0, 'ArrowDown'), 1);
    assert.equal(menuStep(4, 3, 'ArrowDown'), 0);
    assert.equal(menuStep(4, 2, 'ArrowUp'), 1);
    assert.equal(menuStep(4, 0, 'ArrowUp'), 3);
  });

  void test('Home and End go to the first and the last', () => {
    assert.equal(menuStep(4, 2, 'Home'), 0);
    assert.equal(menuStep(4, 1, 'End'), 3);
  });

  void test('from nowhere, down is the first and up is the last', () => {
    assert.equal(menuStep(4, -1, 'ArrowDown'), 0);
    assert.equal(menuStep(4, -1, 'ArrowUp'), 3);
  });

  void test('any other key is not a move', () => {
    for (const key of ['Enter', ' ', 'Tab', 'a', 'Escape']) {
      assert.equal(menuStep(4, 1, key), undefined, key);
    }
  });

  void test('an empty menu has nowhere to go', () => {
    assert.equal(menuStep(0, -1, 'ArrowDown'), undefined);
  });
});
