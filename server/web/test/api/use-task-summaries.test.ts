/**
 * `src/api/use-task-summaries.ts` — a space's tasks as a list, with a failure
 * kept a failure (LAI-1128, the UX audit's B5).
 *
 * Calendar and Activity each mapped `status === 'error'` to `[]`, so a space
 * nobody could read drew as an empty calendar and "0 stale tasks". The
 * mapping is a pure function; these hold it to three states.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TaskSummary } from '../../src/api/tasks.ts';
import { taskSummariesOf } from '../../src/api/use-task-summaries.ts';

const task = (id: string) => ({ id }) as unknown as TaskSummary;
const tombstone = (id: string) => ({ id, deleted: true }) as unknown as TaskSummary;

void describe('taskSummariesOf', () => {
  void test('no project, or the first read in flight, is loading', () => {
    assert.deepEqual(taskSummariesOf(undefined), { status: 'loading' });
    assert.deepEqual(taskSummariesOf({ status: 'loading', tasks: [], error: null }), {
      status: 'loading',
    });
  });

  void test('a failed read is an error carrying its cause, never an empty list', () => {
    const cause = new Error('unreachable');
    const result = taskSummariesOf({ status: 'error', tasks: [], error: cause });
    assert.equal(result.status, 'error');
    assert.equal(result.status === 'error' ? result.error : undefined, cause);
    assert.equal('tasks' in result, false, 'an error must not also offer a list');
  });

  void test('a read set is ok, with deleted rows dropped and the rest in order', () => {
    const result = taskSummariesOf({
      status: 'ready',
      tasks: [task('a'), tombstone('b'), task('c')],
      error: null,
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.status === 'ok' ? result.tasks.map((t) => t.id) : [], ['a', 'c']);
  });

  void test('a ready set that is empty is ok and empty — the true empty state', () => {
    assert.deepEqual(taskSummariesOf({ status: 'ready', tasks: [], error: null }), {
      status: 'ok',
      tasks: [],
    });
  });
});
