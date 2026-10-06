/**
 * The List's selection (LAI-496).
 *
 * A selection is a set of task ids held above the view, because the view is
 * unmounted on every reload (LAI-485's lesson). What the screen *acts on* is
 * narrower: the stored set pruned to the rows on screen, so a filter change
 * can never send a request for a task the reader can no longer see.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  effectiveSelection,
  NO_SELECTION,
  pageState,
  selectAll,
  toggleOne,
  togglePage,
} from '../../../../src/routes/screens/list/list-select.ts';

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

void describe('toggleOne', () => {
  void test('adds an id that is absent and removes one that is present', () => {
    const one = toggleOne(NO_SELECTION, 'a');
    assert.deepEqual([...one], ['a']);
    const two = toggleOne(one, 'b');
    assert.deepEqual([...two], ['a', 'b']);
    assert.deepEqual([...toggleOne(two, 'a')], ['b']);
  });

  void test('never mutates the set it was given', () => {
    const before = new Set(['a']);
    toggleOne(before, 'b');
    toggleOne(before, 'a');
    assert.deepEqual([...before], ['a']);
  });
});

void describe('togglePage', () => {
  void test('selects every id on the page when any is missing', () => {
    const next = togglePage(new Set(['a']), ['a', 'b', 'c']);
    assert.deepEqual([...next].sort(), ['a', 'b', 'c']);
  });

  void test('clears the page when every id is already selected, and keeps the rest', () => {
    const next = togglePage(new Set(['a', 'b', 'z']), ['a', 'b']);
    assert.deepEqual([...next], ['z']);
  });

  void test('an empty page changes nothing', () => {
    const before = new Set(['z']);
    assert.deepEqual([...togglePage(before, [])], ['z']);
  });
});

void describe('pageState', () => {
  void test('none, some, all', () => {
    assert.equal(pageState(NO_SELECTION, ['a', 'b']), 'none');
    assert.equal(pageState(new Set(['a']), ['a', 'b']), 'some');
    assert.equal(pageState(new Set(['a', 'b', 'q']), ['a', 'b']), 'all');
  });

  void test('an empty page is never "all"', () => {
    // A header checkbox over no rows must not draw itself checked.
    assert.equal(pageState(new Set(['a']), []), 'none');
  });
});

void describe('selectAll and effectiveSelection', () => {
  void test('selectAll takes every row, in row order', () => {
    assert.deepEqual([...selectAll(rows('c', 'a', 'b'))], ['c', 'a', 'b']);
  });

  void test('the effective selection is the stored set pruned to the rows on screen', () => {
    const stored = new Set(['a', 'gone', 'c']);
    const effective = effectiveSelection(stored, rows('a', 'b', 'c'));
    assert.deepEqual([...effective].sort(), ['a', 'c']);
    // Pruning is a view, not a write: the stored set keeps `gone` for when
    // the filter widens again.
    assert.deepEqual([...stored].sort(), ['a', 'c', 'gone']);
  });

  void test('a stored set that fits the rows is returned as is, so React sees no change', () => {
    const stored: ReadonlySet<string> = new Set(['a']);
    assert.equal(effectiveSelection(stored, rows('a', 'b')), stored);
  });
});
