/** `src/routes/screens/task/delivers-derive.ts` — "What this delivers" (LAI-1117). */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Deliverable } from '../../../../src/api/tasks.ts';
import {
  blocksLine,
  deliverableEdits,
  hasDelivers,
  linesOf,
  progressLine,
} from '../../../../src/routes/screens/task/delivers-derive.ts';

const d = (id: string, title: string, state: Deliverable['state']): Deliverable => ({
  id,
  title,
  detail: null,
  state,
});

void describe('progressLine', () => {
  void test('counts what is built and names the item in progress', () => {
    assert.equal(
      progressLine(
        [
          d('a', 'Notify', 'done'),
          d('b', 'Watch', 'done'),
          d('c', 'Viewer', 'in_progress'),
          d('e', 'Skip', 'pending'),
        ],
        'in_progress',
      ),
      '2 of 4 built · Viewer in progress',
    );
  });

  void test('says waiting for approval only in review', () => {
    const all = [d('a', 'A', 'done'), d('b', 'B', 'done')];
    assert.equal(progressLine(all, 'review'), '2 of 2 built · waiting for approval');
    assert.equal(progressLine(all, 'done'), '2 of 2 built');
  });

  void test('says not started when nothing moved, and nothing with no items', () => {
    assert.equal(progressLine([d('a', 'A', 'pending')], 'backlog'), '0 of 1 built · not started');
    assert.equal(progressLine([], 'backlog'), null);
  });
});

void describe('hasDelivers', () => {
  void test('is false for a view without the fields and for three empty lists', () => {
    assert.equal(hasDelivers({}), false);
    assert.equal(hasDelivers({ deliverables: [], solves: [], unlocks: [] }), false);
    assert.equal(hasDelivers({ solves: ['x'] }), true);
  });
});

void describe('blocksLine', () => {
  void test('is none for a task that blocks nothing', () => {
    assert.deepEqual(blocksLine([], new Map()), { kind: 'none' });
  });

  void test('names the blocked tasks it knows and counts the rest', () => {
    const byId = new Map([['t2', { id: 't2', key: 'LAI-2', title: 'Two' }]]);
    assert.deepEqual(blocksLine(['t2', 'gone'], byId), {
      kind: 'tasks',
      tasks: [{ id: 't2', key: 'LAI-2', title: 'Two' }],
      unknown: 1,
    });
  });
});

void describe('deliverableEdits and linesOf', () => {
  void test('keeps every id so a PATCH keeps every state', () => {
    assert.deepEqual(deliverableEdits([d('a', 'A', 'done')]), [
      { id: 'a', title: 'A', detail: null },
    ]);
  });

  void test('splits typed lines, trimming and dropping blanks', () => {
    assert.deepEqual(linesOf(' one \n\n two\n  '), ['one', 'two']);
  });
});
