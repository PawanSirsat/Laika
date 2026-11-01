/**
 * The overflow menu's keys (LAI-1044), without a DOM. The same keys pressed
 * in a real browser, with focus followed, are in
 * `test/browser/overflow-menu.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { menuKey, openingIndex } from '../../../src/components/wizard/overflow-menu-model.ts';

const ALL = [true, true, true];
/** The middle item is disabled. */
const GAP = [true, false, true];

void describe('openingIndex', () => {
  void test('opens on the first enabled item, or the last when opened from the end', () => {
    assert.equal(openingIndex(ALL, false), 0);
    assert.equal(openingIndex(ALL, true), 2);
    assert.equal(openingIndex([false, true, true], false), 1);
    assert.equal(openingIndex([true, true, false], true), 1);
  });

  void test('has nowhere to go when every item is disabled', () => {
    assert.equal(openingIndex([false, false], false), undefined);
  });
});

void describe('menuKey', () => {
  void test('ArrowDown and ArrowUp move one enabled item, wrapping at the ends', () => {
    assert.deepEqual(menuKey('ArrowDown', ALL, 0), { kind: 'focus', index: 1 });
    assert.deepEqual(menuKey('ArrowDown', ALL, 2), { kind: 'focus', index: 0 });
    assert.deepEqual(menuKey('ArrowUp', ALL, 1), { kind: 'focus', index: 0 });
    assert.deepEqual(menuKey('ArrowUp', ALL, 0), { kind: 'focus', index: 2 });
  });

  void test('the arrows skip a disabled item', () => {
    assert.deepEqual(menuKey('ArrowDown', GAP, 0), { kind: 'focus', index: 2 });
    assert.deepEqual(menuKey('ArrowUp', GAP, 2), { kind: 'focus', index: 0 });
  });

  void test('Home and End go to the first and last enabled item', () => {
    assert.deepEqual(menuKey('Home', [false, true, true], 2), { kind: 'focus', index: 1 });
    assert.deepEqual(menuKey('End', [true, true, false], 0), { kind: 'focus', index: 1 });
  });

  void test('Escape closes and gives focus back; Tab closes and lets it move on', () => {
    assert.deepEqual(menuKey('Escape', ALL, 1), { kind: 'close', restore: true });
    assert.deepEqual(menuKey('Tab', ALL, 1), { kind: 'close', restore: false });
  });

  void test('any other key does nothing', () => {
    assert.deepEqual(menuKey('a', ALL, 1), { kind: 'none' });
    assert.deepEqual(menuKey('ArrowDown', [false, false], 0), { kind: 'none' });
  });
});
