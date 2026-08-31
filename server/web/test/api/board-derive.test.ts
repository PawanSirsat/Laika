/**
 * `src/api/board-derive.ts` (LAI-049).
 *
 * Pure, so these are real unit tests. The interesting one is `blockedState`:
 * the API returns dependency **ids** without their statuses, so blocked-ness is
 * resolved against the tasks actually loaded — and the case that matters is the
 * one it cannot resolve.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BOARD_COLUMNS,
  blockedState,
  blockers,
  byIdIndex,
  groupByColumn,
} from '../../src/api/board-derive.ts';
import type { Task } from '../../src/api/tasks.ts';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LAI-${over.id}`,
    project_id: 'p',
    number: Number(over.id.replace(/\D/g, '')) || 1,
    title: 'A task',
    description_md: null,
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    created_by: 'u',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    ready: false,
    dependencies: [],
    tags: [],
    acceptance_md: null,
    blocks: [],
    comment_count: 0,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

void describe('blockedState', () => {
  void test('no dependencies is never blocked', () => {
    const t = task({ id: '1' });
    assert.equal(blockedState(t, byIdIndex([t])), false);
  });

  void test('an unfinished dependency blocks', () => {
    const dep = task({ id: '2', status: 'in_progress' });
    const t = task({ id: '1', dependencies: ['2'] });
    assert.equal(blockedState(t, byIdIndex([t, dep])), true);
  });

  void test('done and cancelled dependencies do not block', () => {
    const done = task({ id: '2', status: 'done' });
    const cancelled = task({ id: '3', status: 'cancelled' });
    const t = task({ id: '1', dependencies: ['2', '3'] });
    assert.equal(blockedState(t, byIdIndex([t, done, cancelled])), false);
  });

  void test('one unfinished dependency among finished ones still blocks', () => {
    const done = task({ id: '2', status: 'done' });
    const open = task({ id: '3', status: 'backlog' });
    const t = task({ id: '1', dependencies: ['2', '3'] });
    assert.equal(blockedState(t, byIdIndex([t, done, open])), true);
  });

  void test('an unresolvable dependency is undefined, not false', () => {
    // Guessing `false` would draw an unblocked card over a blocked task and
    // invite someone to start work that cannot proceed. Saying "unknown" is the
    // honest answer and the UI renders it as such.
    const t = task({ id: '1', dependencies: ['missing'] });
    assert.equal(blockedState(t, byIdIndex([t])), undefined);
  });

  void test('a known blocker wins over an unknown one', () => {
    // If anything is definitely unfinished, the task is definitely blocked —
    // no need to hedge.
    const open = task({ id: '2', status: 'todo' });
    const t = task({ id: '1', dependencies: ['2', 'missing'] });
    assert.equal(blockedState(t, byIdIndex([t, open])), true);
  });
});

void describe('groupByColumn', () => {
  void test('has all five columns even when empty', () => {
    const groups = groupByColumn([]);
    assert.deepEqual(Object.keys(groups).sort(), [...BOARD_COLUMNS].sort());
  });

  void test('cancelled is dropped, not given a column', () => {
    const groups = groupByColumn([task({ id: '1', status: 'cancelled' })]);
    assert.equal(Object.values(groups).flat().length, 0);
  });

  void test('sorts p1 before p2 before p3, then by number', () => {
    const groups = groupByColumn([
      task({ id: '3', status: 'todo', priority: 'p3' }),
      task({ id: '1', status: 'todo', priority: 'p1' }),
      task({ id: '2', status: 'todo', priority: 'p2' }),
      task({ id: '4', status: 'todo', priority: 'p1' }),
    ]);
    assert.deepEqual(
      groups.todo.map((t) => t.id),
      ['1', '4', '2', '3'],
    );
  });

  void test('is stable — the same input gives the same order', () => {
    const input = [
      task({ id: '2', status: 'review', priority: 'p2' }),
      task({ id: '1', status: 'review', priority: 'p2' }),
    ];
    assert.deepEqual(
      groupByColumn(input).review.map((t) => t.id),
      groupByColumn(input).review.map((t) => t.id),
    );
  });

  void test('files each task under its own status', () => {
    const groups = groupByColumn([
      task({ id: '1', status: 'backlog' }),
      task({ id: '2', status: 'done' }),
    ]);
    assert.equal(groups.backlog.length, 1);
    assert.equal(groups.done.length, 1);
    assert.equal(groups.todo.length, 0);
  });
});

void describe('blockers — which dependency is holding this up (LAI-066)', () => {
  void test('names only the unmet ones', () => {
    // `blockedState` answers *whether*; this answers *which*, because the card
    // has to name the blocker. A done dependency is not holding anything up.
    const done = task({ id: '1', status: 'done' });
    const open = task({ id: '2', status: 'todo' });
    const t = task({ id: '3', dependencies: ['1', '2'] });

    const held = blockers(t, byIdIndex([done, open, t]));
    assert.deepEqual(
      held.map((d) => d.id),
      ['2'],
    );
  });

  void test('cancelled counts as met, exactly as blockedState treats it', () => {
    // The two must agree. If `blockedState` says blocked and `blockers` returns
    // nothing, the card renders a blocked banner naming nobody — which is the
    // vague message this task exists to remove.
    const cancelled = task({ id: '1', status: 'cancelled' });
    const t = task({ id: '2', dependencies: ['1'] });
    const index = byIdIndex([cancelled, t]);

    assert.deepEqual(blockers(t, index), []);
    assert.equal(blockedState(t, index), false);
  });

  void test('a dependency the board has not loaded is not invented', () => {
    // It cannot be named, so it is not returned. `blockedState` reports the
    // same case as `undefined`, and the card says the count is unknown rather
    // than naming a subset and implying it is the whole story.
    const t = task({ id: '2', dependencies: ['missing'] });
    const index = byIdIndex([t]);

    assert.deepEqual(blockers(t, index), []);
    assert.equal(blockedState(t, index), undefined);
  });

  void test('the two agree whenever a blocker exists', () => {
    // The property that matters, stated directly: blocked implies nameable,
    // for every dependency the board can see.
    const a = task({ id: '1', status: 'in_progress' });
    const b = task({ id: '2', status: 'done' });
    const t = task({ id: '3', dependencies: ['1', '2'] });
    const index = byIdIndex([a, b, t]);

    assert.equal(blockedState(t, index), true);
    assert.ok(blockers(t, index).length > 0, 'blocked, but nothing to name');
  });

  void test('no dependencies means nothing to name', () => {
    const t = task({ id: '1' });
    assert.deepEqual(blockers(t, byIdIndex([t])), []);
  });
});
