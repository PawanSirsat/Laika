/**
 * The one list of filter keys (LAI-485, LAI-487).
 *
 * It decides when the List's page resets, and — from LAI-487 — what the badge
 * counts and what *Clear all* clears. Two hand-written lists is how *Clear all*
 * came to miss `sprint`, so this file checks the list against the screen that
 * reads the URL, not against a copy of itself.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import { FILTER_KEYS, filterSignature } from '../../../../src/routes/screens/board/filter-keys.ts';
import { code } from '../../../helpers/code.ts';

let board = '';
before(async () => {
  board = code(
    await readFile(
      new URL('../../../../src/routes/screens/BoardScreen.tsx', import.meta.url),
      'utf8',
    ),
  );
});

void describe('FILTER_KEYS', () => {
  void test('names every key the board reads as a filter', () => {
    // Positive control: the scan finds keys at all, or the next test is air.
    const read = [...board.matchAll(/params\.get\('([a-z_]+)'\)/g)].map((m) => m[1]);
    assert.ok(
      read.includes('priority'),
      `the scan found nothing it recognises: ${read.join(', ')}`,
    );
    for (const key of FILTER_KEYS) {
      assert.ok(read.includes(key), `${key} is listed as a filter but the board never reads it`);
    }
  });

  void test('leaves out every key that does not change which tasks match', () => {
    for (const key of ['project', 'task', 'group', 'view', 'sort', 'dir', 'page']) {
      assert.ok(!(FILTER_KEYS as readonly string[]).includes(key), `${key} is not a filter`);
    }
  });
});

void describe('filterSignature', () => {
  const sig = (s: string) => filterSignature(new URLSearchParams(s));

  void test('changes when a filter changes', () => {
    assert.notEqual(sig('priority=p1'), sig('priority=p2'));
    assert.notEqual(sig(''), sig('sprint=s1'));
  });

  void test('ignores sort, page, the open task and the project', () => {
    assert.equal(sig('priority=p1'), sig('priority=p1&sort=key&dir=asc&page=3&task=t1&project=x'));
  });

  void test('does not depend on the order the keys were written', () => {
    assert.equal(sig('q=a&priority=p1'), sig('priority=p1&q=a'));
  });
});
