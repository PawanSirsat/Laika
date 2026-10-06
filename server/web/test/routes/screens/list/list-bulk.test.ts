/**
 * Acting on many tasks at once (LAI-496).
 *
 * The server has no bulk endpoint and §7.2 forbids the tools one, so a bulk
 * action is one request per task. What makes that safe to offer is the two
 * properties pinned here: a refusal in the middle stops nothing else, and the
 * report names exactly which tasks it was.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../../../src/api/errors.ts';
import { ALL_STATUSES } from '../../../../src/api/board-derive.ts';
import type { Task } from '../../../../src/api/tasks.ts';
import {
  applyToEach,
  bulkPlan,
  bulkSummary,
  failureMessage,
  statusTargets,
} from '../../../../src/routes/screens/list/list-bulk.ts';

void describe('statusTargets', () => {
  void test('is the server’s own human transition table, status for status', async () => {
    /*
     * **Executed, not transcribed.** The server's table is data in
     * `task-lifecycle.ts`; a copy of it here would be a second table that
     * drifts, which is exactly what this test exists to refuse. The import is
     * dynamic because the module sits outside this package's `rootDir`.
     */
    const lifecycle = (await import(
      new URL('../../../../../src/services/task-lifecycle.ts', import.meta.url).href
    )) as {
      readonly transitionsFrom: (from: string, rule: 'human' | 'agent') => readonly string[];
    };

    for (const from of ALL_STATUSES) {
      assert.deepEqual(
        [...statusTargets(from)].sort(),
        [...lifecycle.transitionsFrom(from, 'human')].sort(),
        `targets from ${from}`,
      );
    }
  });

  void test('never offers the status the task is already in', () => {
    for (const from of ALL_STATUSES) {
      assert.ok(!statusTargets(from).includes(from), from);
    }
  });
});

void describe('applyToEach', () => {
  void test('runs every id in order, carries on past a refusal, and names it', async () => {
    const seen: string[] = [];
    const outcome = await applyToEach(['a', 'b', 'c', 'd'], (id) => {
      seen.push(id);
      if (id === 'b') {
        return Promise.reject(
          new ApiError('unprocessable', 'Cannot move a task from done to cancelled', 422, {}),
        );
      }
      if (id === 'd') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(undefined);
    });

    assert.deepEqual(seen, ['a', 'b', 'c', 'd'], 'the refusal must not stop the rest');
    assert.deepEqual(outcome.done, ['a', 'c']);
    assert.deepEqual(outcome.failed, [
      { id: 'b', message: 'Cannot move a task from done to cancelled' },
      { id: 'd', message: 'The request did not reach Laika.' },
    ]);
  });

  void test('is sequential, so the server sees one request at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    await applyToEach(['a', 'b', 'c'], async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
    });
    assert.equal(peak, 1);
  });

  void test('reports progress after each task, failures included', async () => {
    const ticks: number[] = [];
    await applyToEach(
      ['a', 'b'],
      (id) => (id === 'a' ? Promise.reject(new Error('no')) : Promise.resolve()),
      (completed) => {
        ticks.push(completed);
      },
    );
    assert.deepEqual(ticks, [1, 2]);
  });

  void test('nothing to do is an empty outcome, not an error', async () => {
    const outcome = await applyToEach([], () => Promise.reject(new Error('never called')));
    assert.deepEqual(outcome, { done: [], failed: [] });
  });
});

void describe('failureMessage and bulkSummary', () => {
  void test('an API refusal keeps the server’s words; anything else gets one sentence', () => {
    assert.equal(
      failureMessage(new ApiError('conflict', 'That task is already done', 409, {})),
      'That task is already done',
    );
    assert.equal(failureMessage(new Error('boom')), 'The request did not reach Laika.');
    assert.equal(failureMessage('junk'), 'The request did not reach Laika.');
  });

  void test('the summary counts, with the refusals and the skips only when there are any', () => {
    assert.equal(bulkSummary({ done: ['a', 'b'], failed: [] }, 0), '2 updated');
    assert.equal(bulkSummary({ done: ['a'], failed: [] }, 0), '1 updated');
    assert.equal(
      bulkSummary({ done: ['a'], failed: [{ id: 'b', message: 'x' }] }, 0),
      '1 updated, 1 refused',
    );
    assert.equal(bulkSummary({ done: [], failed: [] }, 3), '0 updated, 3 already there');
    assert.equal(
      bulkSummary(
        {
          done: ['a', 'b'],
          failed: [
            { id: 'c', message: 'x' },
            { id: 'd', message: 'y' },
          ],
        },
        1,
      ),
      '2 updated, 2 refused, 1 already there',
    );
  });
});

void describe('bulkPlan', () => {
  const task = (id: string, over: Partial<Task>): Task =>
    ({
      id,
      key: id.toUpperCase(),
      status: 'todo',
      priority: 'p2',
      assignee_id: null,
      sprint_id: null,
      ...over,
    }) as Task;

  void test('a status change skips the tasks already in that status', () => {
    const plan = bulkPlan({ kind: 'status', status: 'in_progress' }, [
      task('a', {}),
      task('b', { status: 'in_progress' }),
      task('c', { status: 'done' }),
    ]);
    assert.deepEqual(plan, { ids: ['a', 'c'], skipped: 1 });
  });

  void test('cancel is a status change to cancelled, and skips the cancelled', () => {
    const plan = bulkPlan({ kind: 'cancel' }, [task('a', {}), task('b', { status: 'cancelled' })]);
    assert.deepEqual(plan, { ids: ['a'], skipped: 1 });
  });

  void test('priority and assignee skip what already matches, null included', () => {
    assert.deepEqual(
      bulkPlan({ kind: 'priority', priority: 'p1' }, [
        task('a', { priority: 'p1' }),
        task('b', {}),
      ]),
      { ids: ['b'], skipped: 1 },
    );
    assert.deepEqual(
      bulkPlan({ kind: 'assignee', assigneeId: null }, [
        task('a', {}),
        task('b', { assignee_id: 'u' }),
      ]),
      { ids: ['b'], skipped: 1 },
    );
    assert.deepEqual(
      bulkPlan({ kind: 'assignee', assigneeId: 'u' }, [
        task('a', {}),
        task('b', { assignee_id: 'u' }),
      ]),
      { ids: ['a'], skipped: 1 },
    );
  });

  void test('a sprint move skips tasks already there; "no sprint" skips tasks in none', () => {
    assert.deepEqual(
      bulkPlan({ kind: 'sprint', sprintId: 's1' }, [task('a', { sprint_id: 's1' }), task('b', {})]),
      { ids: ['b'], skipped: 1 },
    );
    assert.deepEqual(
      bulkPlan({ kind: 'sprint', sprintId: null }, [task('a', { sprint_id: 's1' }), task('b', {})]),
      { ids: ['a'], skipped: 1 },
    );
  });
});
