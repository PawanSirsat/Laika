/**
 * The Review tab as a decision queue (D-146, LAI-1168).
 *
 * Which rows the page shows, how they group, and what a bulk Accept says
 * when it ends — pinned here so the browser test can assert the page and
 * not the arithmetic.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NO_FILTER, type ReviewQueueItem } from '../../../../src/api/review.ts';
import type { Task } from '../../../../src/api/tasks.ts';
import {
  acceptSummary,
  advanceAfterDecide,
  dialogCommand,
  flatOrder,
  groupBySpace,
  itemParam,
  positionOf,
  reviewView,
  visibleQueue,
  withItem,
  withView,
} from '../../../../src/routes/screens/review/review-derive.ts';

function queued(
  key: string,
  patch: { slug?: string; decide?: boolean; assignee?: string | null } = {},
): ReviewQueueItem {
  const slug = patch.slug ?? 'laika';
  return {
    task: { id: `id-${key}`, key, assignee_id: patch.assignee ?? null } as unknown as Task,
    project: { id: `p-${slug}`, slug, name: slug.toUpperCase(), prefix: 'X' },
    assignee_name: null,
    waiting_since: 0,
    round: null,
    finished_by_name: null,
    can_decide: patch.decide ?? true,
    cue: null,
  };
}

const keys = (items: readonly ReviewQueueItem[]) => items.map((i) => i.task.key);

void describe('reviewView and withView', () => {
  void test('the default is mine; all and handoffs are the other two; anything else is mine', () => {
    assert.equal(reviewView(new URLSearchParams()), 'mine');
    assert.equal(reviewView(new URLSearchParams('view=all')), 'all');
    assert.equal(reviewView(new URLSearchParams('view=handoffs')), 'handoffs');
    assert.equal(reviewView(new URLSearchParams('view=everything')), 'mine');
    assert.equal(reviewView(new URLSearchParams('view=')), 'mine');
  });

  void test('mine leaves the address alone; all sets view; other params survive', () => {
    const from = new URLSearchParams('tab=review&view=all');
    assert.equal(withView(from, 'mine').toString(), 'tab=review');
    assert.equal(
      withView(new URLSearchParams('tab=review'), 'all').toString(),
      'tab=review&view=all',
    );
    // It returns a copy: the caller's params are not mutated.
    assert.equal(from.toString(), 'tab=review&view=all');
  });
});

void describe('visibleQueue', () => {
  const items = [
    queued('A', { slug: 'orb', decide: true, assignee: 'u1' }),
    queued('B', { slug: 'laika', decide: false }),
    queued('C', { slug: 'laika', decide: true, assignee: 'u1' }),
  ];

  void test('decidable keeps only can_decide rows, in the server’s order', () => {
    assert.deepEqual(keys(visibleQueue(items, { decidable: true, filter: NO_FILTER })), ['A', 'C']);
  });

  void test('everything keeps every row', () => {
    assert.deepEqual(keys(visibleQueue(items, { decidable: false, filter: NO_FILTER })), [
      'A',
      'B',
      'C',
    ]);
  });

  void test('the filters apply in both views', () => {
    const laika = { ...NO_FILTER, project: 'laika' };
    assert.deepEqual(keys(visibleQueue(items, { decidable: true, filter: laika })), ['C']);
    assert.deepEqual(keys(visibleQueue(items, { decidable: false, filter: laika })), ['B', 'C']);
  });

  void test('an empty queue is an empty answer', () => {
    assert.deepEqual(visibleQueue([], { decidable: true, filter: NO_FILTER }), []);
  });
});

void describe('groupBySpace', () => {
  void test('groups in order of first appearance — the space with the oldest task first', () => {
    const groups = groupBySpace([
      queued('A', { slug: 'orb' }),
      queued('B', { slug: 'laika', decide: false }),
      queued('C', { slug: 'orb' }),
      queued('D', { slug: 'laika' }),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.project.slug, keys(g.items)]),
      [
        ['orb', ['A', 'C']],
        ['laika', ['B', 'D']],
      ],
    );
  });

  void test('a group’s decidable ids are the rows the reader may decide, in order', () => {
    const [laika] = groupBySpace([
      queued('B', { slug: 'laika', decide: false }),
      queued('D', { slug: 'laika' }),
      queued('E', { slug: 'laika' }),
    ]);
    assert.deepEqual(laika?.decidable, ['id-D', 'id-E']);
  });

  void test('a group with nothing decidable says so, and no rows means no groups', () => {
    const [only] = groupBySpace([queued('B', { decide: false })]);
    assert.deepEqual(only?.decidable, []);
    assert.deepEqual(groupBySpace([]), []);
  });

  void test('groups by project id, not by name', () => {
    const twin = queued('Z', { slug: 'other' });
    const groups = groupBySpace([
      queued('A'),
      { ...twin, project: { ...twin.project, name: 'LAIKA' } },
    ]);
    assert.equal(groups.length, 2);
  });
});

void describe('flatOrder', () => {
  void test('is every row’s id, groups flattened, as the page draws them', () => {
    const groups = groupBySpace([
      queued('A', { slug: 'orb' }),
      queued('B', { slug: 'laika' }),
      queued('C', { slug: 'orb' }),
    ]);
    assert.deepEqual(flatOrder(groups), ['id-A', 'id-C', 'id-B']);
    assert.deepEqual(flatOrder([]), []);
  });
});

void describe('acceptSummary', () => {
  void test('counts accepted, and refused only when any were', () => {
    assert.equal(acceptSummary({ done: ['a', 'b', 'c'], failed: [] }), '3 accepted');
    assert.equal(
      acceptSummary({ done: ['a', 'b'], failed: [{ id: 'c', message: 'no' }] }),
      '2 accepted, 1 refused',
    );
    assert.equal(
      acceptSummary({ done: [], failed: [{ id: 'c', message: 'no' }] }),
      '0 accepted, 1 refused',
    );
    assert.equal(acceptSummary({ done: [], failed: [] }), '0 accepted');
  });
});

void describe('the dialog’s address (LAI-1169)', () => {
  void test('?item= names the open task; empty or absent is none', () => {
    assert.equal(itemParam(new URLSearchParams('tab=review&item=t1')), 't1');
    assert.equal(itemParam(new URLSearchParams('tab=review')), null);
    assert.equal(itemParam(new URLSearchParams('item=')), null);
  });

  void test('withItem sets or removes it and keeps the rest, on a copy', () => {
    const from = new URLSearchParams('tab=review&view=all');
    assert.equal(withItem(from, 't1').toString(), 'tab=review&view=all&item=t1');
    assert.equal(
      withItem(new URLSearchParams('tab=review&item=t1'), null).toString(),
      'tab=review',
    );
    assert.equal(from.toString(), 'tab=review&view=all');
  });
});

void describe('positionOf', () => {
  const order = ['a', 'b', 'c'];

  void test('index, total and both neighbours, the ends open', () => {
    assert.deepEqual(positionOf(order, 'b'), { index: 1, total: 3, prev: 'a', next: 'c' });
    assert.deepEqual(positionOf(order, 'a'), { index: 0, total: 3, prev: null, next: 'b' });
    assert.deepEqual(positionOf(order, 'c'), { index: 2, total: 3, prev: 'b', next: null });
  });

  void test('a row not drawn has no position', () => {
    assert.equal(positionOf(order, 'z'), null);
    assert.equal(positionOf([], 'a'), null);
  });
});

void describe('advanceAfterDecide', () => {
  const order = ['a', 'b', 'c', 'd'];

  void test('the next row in the order captured before the decision — never the same id', () => {
    assert.equal(advanceAfterDecide(order, 'b'), 'c');
    assert.notEqual(advanceAfterDecide(order, 'b'), 'b');
  });

  void test('the last row closes; an unknown id closes', () => {
    assert.equal(advanceAfterDecide(order, 'd'), null);
    assert.equal(advanceAfterDecide(order, 'z'), null);
  });

  void test('a row a poll took meanwhile is skipped', () => {
    assert.equal(advanceAfterDecide(order, 'b', new Set(['a', 'd'])), 'd');
    assert.equal(advanceAfterDecide(order, 'b', new Set(['a'])), null);
  });
});

void describe('dialogCommand', () => {
  void test('the letters and the arrows', () => {
    assert.equal(dialogCommand({ key: 'j' }, false), 'next');
    assert.equal(dialogCommand({ key: 'ArrowDown' }, false), 'next');
    assert.equal(dialogCommand({ key: 'k' }, false), 'prev');
    assert.equal(dialogCommand({ key: 'ArrowUp' }, false), 'prev');
    assert.equal(dialogCommand({ key: 'a' }, false), 'accept');
    assert.equal(dialogCommand({ key: 's' }, false), 'send_back');
    assert.equal(dialogCommand({ key: 'Escape' }, false), 'close');
    assert.equal(dialogCommand({ key: 'x' }, false), null);
    assert.equal(dialogCommand({ key: 'Enter' }, false), null);
  });

  void test('nothing while typing — except Escape', () => {
    for (const key of ['j', 'k', 'a', 's', 'ArrowDown', 'ArrowUp']) {
      assert.equal(dialogCommand({ key }, true), null, key);
    }
    assert.equal(dialogCommand({ key: 'Escape' }, true), 'close');
  });

  void test('nothing with a modifier held, so ⌘A still selects', () => {
    assert.equal(dialogCommand({ key: 'a', metaKey: true }, false), null);
    assert.equal(dialogCommand({ key: 'j', ctrlKey: true }, false), null);
    assert.equal(dialogCommand({ key: 's', altKey: true }, false), null);
  });

  void test('an Escape something inside already spent is left to it', () => {
    assert.equal(dialogCommand({ key: 'Escape', defaultPrevented: true }, false), null);
    assert.equal(dialogCommand({ key: 'Escape', defaultPrevented: false }, true), 'close');
  });
});
