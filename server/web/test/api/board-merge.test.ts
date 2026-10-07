import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeTasks, sameValue } from '../../src/api/board-merge.ts';
import type { Task } from '../../src/api/tasks.ts';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LC-${over.id}`,
    project_id: 'p',
    number: 1,
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

const NONE: ReadonlySet<string> = new Set();

void describe('sameValue (LAI-707)', () => {
  void test('ignores key order and compares deeply', () => {
    assert.equal(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
    assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), true);
    assert.equal(sameValue({ a: [1, 2] }, { a: [2, 1] }), false);
    assert.equal(sameValue({ a: null }, { a: 0 }), false);
    assert.equal(sameValue('x', 'x'), true);
  });
});

void describe('mergeTasks (LAI-707)', () => {
  void test('keeps every unchanged object, and the array itself when nothing changed', () => {
    const prev = [task({ id: '1' }), task({ id: '2' })];
    const again = prev.map((t) => ({ ...t }));
    const merged = mergeTasks(prev, again, NONE);
    assert.equal(merged.tasks, prev, 'an identical answer must be the same array');
    assert.equal(merged.changed.size, 0);
  });

  void test('a changed task is new, the others keep their identity', () => {
    const prev = [task({ id: '1' }), task({ id: '2' }), task({ id: '3' })];
    const incoming = [{ ...prev[0]! }, { ...prev[1]!, status: 'done' as const }, { ...prev[2]! }];
    const merged = mergeTasks(prev, incoming, NONE);
    assert.equal(merged.tasks[0], prev[0]);
    assert.notEqual(merged.tasks[1], prev[1]);
    assert.equal(merged.tasks[1]?.status, 'done');
    assert.equal(merged.tasks[2], prev[2]);
    assert.deepEqual([...merged.changed], ['2']);
  });

  void test('a derived change with the same updated_at is still a change', () => {
    // `ready` moves when another task's blocker finishes; `updated_at` does not.
    const prev = [task({ id: '1', ready: false })];
    const merged = mergeTasks(prev, [{ ...prev[0]!, ready: true }], NONE);
    assert.notEqual(merged.tasks[0], prev[0]);
    assert.deepEqual([...merged.changed], ['1']);
  });

  void test('follows the server’s order and reports new and removed tasks', () => {
    const prev = [task({ id: '1' }), task({ id: '2' })];
    const fresh = task({ id: '3' });
    const merged = mergeTasks(prev, [fresh, { ...prev[0]! }], NONE);
    assert.deepEqual(
      merged.tasks.map((t) => t.id),
      ['3', '1'],
    );
    assert.equal(merged.tasks[1], prev[0]);
    assert.deepEqual([...merged.changed], ['3']);
    assert.deepEqual([...merged.removed], ['2']);
  });

  void test('a kept id keeps the local version, even if the server disagrees or omits it', () => {
    const prev = [task({ id: '1', status: 'in_progress' }), task({ id: '2' })];
    // The server's answer predates the local write: it still says todo, and has
    // not listed task 2 at all.
    const merged = mergeTasks(
      prev,
      [{ ...prev[0]!, status: 'todo' as const }],
      new Set(['1', '2']),
    );
    assert.equal(
      merged.tasks.find((t) => t.id === '1'),
      prev[0],
    );
    assert.equal(
      merged.tasks.find((t) => t.id === '2'),
      prev[1],
      'a kept task the server omitted is kept',
    );
    assert.equal(merged.removed.size, 0);
  });

  void test('a change to any field of a task is detected — every key, in turn', () => {
    const base = task({ id: '1' });
    const keys = Object.keys(base) as (keyof Task)[];
    assert.ok(
      keys.length >= 25,
      `only ${String(keys.length)} keys — the fixture is not a full Task`,
    );
    for (const key of keys) {
      if (key === 'id') continue;
      const value: unknown = base[key];
      const changed: unknown =
        typeof value === 'number'
          ? value + 1
          : typeof value === 'string'
            ? `${value}x`
            : typeof value === 'boolean'
              ? !value
              : Array.isArray(value)
                ? [...(value as string[]), 'x']
                : 'set';
      const altered: Task = { ...base, [key]: changed };
      const merged = mergeTasks([base], [altered], NONE);
      assert.notEqual(merged.tasks[0], base, `a change to ${key} was not noticed`);
    }
  });
});
