/**
 * The board's filter, applied to the one task set (LAI-724).
 *
 * The board used to send its filter to the server and walk the answer — a
 * second walk beside the sprint strip's whole-project one, and a third on the
 * List. With one set per project the filter is applied in memory, so it must
 * mean exactly what `listTasks`'s `WHERE` means (`server/src/services/tasks.ts`):
 * equality on status, priority, assignee and sprint (`none` for null), the
 * derived `ready` as served, a tag by its normalised name, `updated_at` at or
 * after `updated_since`, and children of a parent. Order is the set's own,
 * which is the server's.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  applyTaskFilter,
  isPriority,
  isTagName,
  matchesTaskFilter,
  TAG_NAME,
} from '../../src/api/task-filter.ts';
import type { Task, TaskFilter } from '../../src/api/tasks.ts';

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

const SET = [
  task({
    id: '1',
    status: 'done',
    priority: 'p1',
    assignee_id: 'ada',
    sprint_id: 's1',
    tags: ['api'],
    updated_at: 100,
  }),
  task({
    id: '2',
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    ready: false,
    updated_at: 200,
  }),
  task({
    id: '3',
    status: 'review',
    priority: 'p3',
    assignee_id: 'bob',
    sprint_id: 's2',
    tags: ['web', 'api'],
    updated_at: 300,
    parent_task_id: '1',
  }),
];

const ids = (filter: TaskFilter): string[] => applyTaskFilter(SET, filter).map((t) => t.id);

void describe('applyTaskFilter means what the server’s WHERE means', () => {
  void test('no filter is the set itself, the same array', () => {
    assert.equal(applyTaskFilter(SET, {}), SET);
  });

  void test('equality fields', () => {
    assert.deepEqual(ids({ status: 'done' }), ['1']);
    assert.deepEqual(ids({ priority: 'p3' }), ['3']);
    assert.deepEqual(ids({ assignee: 'ada' }), ['1']);
    assert.deepEqual(ids({ sprint: 's2' }), ['3']);
    assert.deepEqual(ids({ parent: '1' }), ['3']);
  });

  void test('`none` means null for assignee and sprint, as over a query string', () => {
    assert.deepEqual(ids({ assignee: 'none' }), ['2']);
    assert.deepEqual(ids({ sprint: 'none' }), ['2']);
  });

  void test('ready is the served value, in both directions', () => {
    assert.deepEqual(ids({ ready: true }), ['1', '3']);
    assert.deepEqual(ids({ ready: false }), ['2']);
  });

  void test('a tag matches its normalised name (trimmed, lower-case)', () => {
    assert.deepEqual(ids({ tag: 'api' }), ['1', '3']);
    assert.deepEqual(ids({ tag: '  API ' }), ['1', '3']);
    assert.deepEqual(ids({ tag: 'unknown' }), []);
  });

  void test('updated_since is inclusive', () => {
    assert.deepEqual(ids({ updated_since: 200 }), ['2', '3']);
  });

  void test('fields combine with AND, and order is kept', () => {
    assert.deepEqual(ids({ tag: 'api', ready: true, updated_since: 150 }), ['3']);
  });

  void test('limit and cursor are paging, not filtering', () => {
    assert.equal(applyTaskFilter(SET, { limit: 1, cursor: 'x' }), SET);
    assert.equal(matchesTaskFilter(SET[0]!, { limit: 1 }), true);
  });
});

/*
 * **A value the server would refuse is refused here too** (LAI-724 review,
 * S4a). The server answers an unknown `?priority=` with `400` and a malformed
 * `?tag=` with `422`, and the board used to show that error; filtering in
 * memory, the same URL silently drew an empty board. The board now names the
 * bad value instead, so the rules must be the server's.
 */
void describe('the filter values the server accepts', () => {
  void test('a priority is p1, p2 or p3', () => {
    for (const ok of ['p1', 'p2', 'p3']) assert.equal(isPriority(ok), true, ok);
    for (const bad of ['p9', 'P1', '', 'high']) assert.equal(isPriority(bad), false, bad);
  });

  void test('a tag is the server’s TAG_NAME after trimming and lower-casing', () => {
    for (const ok of ['api', ' API ', 'web-2', 'a'.repeat(24)])
      assert.equal(isTagName(ok), true, ok);
    for (const bad of ['-api', 'api tag', 'émoji', 'a'.repeat(25), '']) {
      assert.equal(isTagName(bad), false, bad);
    }
  });

  void test('TAG_NAME is the server’s, character for character', () => {
    const server = readFileSync(new URL('../../../src/services/tags.ts', import.meta.url), 'utf8');
    const declared = /export const TAG_NAME = (\/.*\/);/.exec(server)?.[1];
    assert.ok(declared !== undefined, 'the server’s TAG_NAME was not found — the guard is blind');
    assert.equal(String(TAG_NAME), declared);
  });
});
