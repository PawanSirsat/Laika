/** The avatar group's overflow and presence words (LAI-1206). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AVATAR_SIZES,
  groupOverflow,
  overflowWords,
  PRESENCE_WORDS,
  ringClass,
} from '../../../src/components/avatar/avatar-model.ts';

void describe('groupOverflow', () => {
  void test('everyone fits: no +N', () => {
    assert.deepEqual(groupOverflow(3, 4), { shown: 3, extra: 0 });
    assert.deepEqual(groupOverflow(4, 4), { shown: 4, extra: 0 });
  });

  void test('one too many: the last place becomes +2, never +1 for a face that would fit', () => {
    assert.deepEqual(groupOverflow(5, 4), { shown: 3, extra: 2 });
  });

  void test('a workspace of 1,284', () => {
    assert.deepEqual(groupOverflow(1284, 4), { shown: 3, extra: 1281 });
  });

  void test('nobody, and nonsense input, draw nothing rather than crash', () => {
    assert.deepEqual(groupOverflow(0, 4), { shown: 0, extra: 0 });
    assert.deepEqual(groupOverflow(-2, 4), { shown: 0, extra: 0 });
    assert.deepEqual(groupOverflow(3, 0), { shown: 0, extra: 3 });
  });
});

void describe('words', () => {
  void test('the +N names who it stands for', () => {
    assert.equal(overflowWords(['Jo', 'Ada Lovelace']), 'and 2 more: Jo, Ada Lovelace');
  });

  void test('every presence has words, so the dot is never colour alone', () => {
    assert.deepEqual(Object.keys(PRESENCE_WORDS).sort(), ['away', 'offline', 'online']);
  });

  void test('nine sizes, smallest first', () => {
    assert.deepEqual([...AVATAR_SIZES], [16, 20, 22, 24, 26, 28, 32, 36, 60]);
  });
});

void describe('ringClass (LAI-1349)', () => {
  void test('green online, amber away, and no ring when not told', () => {
    assert.equal(ringClass('online'), 'avatar-ring avatar-ring-online');
    assert.equal(ringClass('away'), 'avatar-ring avatar-ring-away');
    assert.equal(ringClass(undefined), '');
  });
});
