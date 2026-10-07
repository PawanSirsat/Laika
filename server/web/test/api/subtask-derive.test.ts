import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { childrenOf, parentOf, subtaskProgress } from '../../src/api/subtask-derive.ts';
import type { Task } from '../../src/api/tasks.ts';

function task(over: Partial<Task> & { id: string; number: number }): Task {
  return {
    key: `LC-${String(over.number)}`,
    project_id: 'p',
    title: 'A task',
    description_md: null,
    acceptance_md: null,
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    ready: true,
    stale_flagged_at: null,
    position: null,
    comment_count: 0,
    tags: [],
    blocked_by: [],
    blocks: [],
    started_at: null,
    completed_at: null,
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

const PARENT = task({ id: 'p1', number: 1 });
const DONE = task({ id: 'c2', number: 2, parent_task_id: 'p1', status: 'done' });
const OPEN = task({ id: 'c3', number: 3, parent_task_id: 'p1', status: 'in_progress' });
const DROPPED = task({ id: 'c4', number: 4, parent_task_id: 'p1', status: 'cancelled' });
const OTHER = task({ id: 'o5', number: 5 });
const byId = new Map([PARENT, OTHER, DROPPED, OPEN, DONE].map((t) => [t.id, t]));

void describe('subtasks off the page (D-066)', () => {
  void test('childrenOf finds the children, in key order, and only them', () => {
    assert.deepEqual(
      childrenOf('p1', byId).map((t) => t.id),
      ['c2', 'c3', 'c4'],
    );
    assert.deepEqual(childrenOf('o5', byId), []);
  });

  void test('parentOf is the parent when it is loaded, and nothing when it is not', () => {
    assert.equal(parentOf(OPEN, byId)?.id, 'p1');
    assert.equal(parentOf(PARENT, byId), undefined);
    const orphan = task({ id: 'c9', number: 9, parent_task_id: 'gone' });
    assert.equal(parentOf(orphan, byId), undefined);
  });

  void test('progress counts done over not-cancelled, and nothing over nothing', () => {
    // The cancelled child is in neither number: 1 done of 2 that count.
    assert.deepEqual(subtaskProgress(childrenOf('p1', byId)), { done: 1, total: 2 });
    assert.equal(subtaskProgress([]), undefined);
    // Only cancelled children: nothing to show, not 0/0.
    assert.equal(subtaskProgress([DROPPED]), undefined);
  });
});
