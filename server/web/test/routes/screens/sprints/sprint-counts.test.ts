/**
 * One sprint, the same figures on every surface (LAI-1040).
 *
 * **Done over total.** SPEC §11.4.3 states the rule for the Timeline's bars:
 * *"`cancelled` counts in neither"*. The Sprints card (`progressFor`) already
 * followed it; the board toolbar's DONE (`countStats`) put cancelled work in
 * the total, so a sprint with 8 done and 2 cancelled read 8/10 in the toolbar
 * and 8/8 on its card. Every surface now goes through `progressOf`.
 *
 * **Unassigned.** The Sprints card's "unassigned" counted every task with no
 * assignee, finished ones included. A done or cancelled task is not work
 * waiting for an owner, so it counts open work only — the meaning "Open" has
 * in §6 (not `done`, not `cancelled`).
 *
 * The expected figures are written out here, not taken from the helper, so a
 * helper that drifted cannot agree with itself.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL_STATUSES, byIdIndex } from '../../../../src/api/board-derive.ts';
import type { SprintTaskCounts } from '../../../../src/api/sprints.ts';
import type { Task, TaskStatus } from '../../../../src/api/tasks.ts';
import { countStats } from '../../../../src/routes/screens/board/sprint-stats.ts';
import {
  progressFor,
  sprintFigures,
} from '../../../../src/routes/screens/sprints/sprint-derive.ts';
import { countsProgress } from '../../../../src/routes/screens/timeline/timeline-derive.ts';

let next = 0;
function task(over: Partial<Task>): Task {
  next += 1;
  const status = over.status ?? 'todo';
  return {
    id: `t${String(next)}`,
    key: `LAI-${String(next)}`,
    project_id: 'p',
    number: next,
    title: 'A task',
    description_md: null,
    status,
    status_id: status,
    status_name: status,
    priority: 'p2',
    assignee_id: 'u',
    sprint_id: 's1',
    created_by: 'u',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    ready: false,
    stale_flagged_at: null,
    position: null,
    blocked_by: [],
    tags: [],
    acceptance_md: null,
    blocks: [],
    send_back: null,
    size: null,
    comment_count: 0,
    started_at: null,
    completed_at: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

const many = (n: number, status: TaskStatus): Task[] =>
  Array.from({ length: n }, () => task({ status }));

/** What the sprint list's `task_counts` would say for these tasks (§6.4). */
function taskCounts(tasks: readonly Task[]): SprintTaskCounts {
  const by_status = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const t of tasks) by_status[t.status] += 1;
  return { total: tasks.length, by_status };
}

/** Done over total, as each surface draws it. */
function surfaces(tasks: readonly Task[]): Record<string, string> {
  const board = countStats(tasks, byIdIndex(tasks));
  const card = progressFor(tasks);
  const timeline = countsProgress(taskCounts(tasks));
  return {
    'board toolbar DONE (countStats)': `${String(board.done)}/${String(board.total)}`,
    'Sprints card and Timeline bar from tasks (progressFor)': `${String(card.done)}/${String(card.total)}`,
    'Timeline bar from task_counts (countsProgress)': `${String(timeline.done)}/${String(timeline.total)}`,
  };
}

void describe('done over total agrees on every surface (LAI-1040)', () => {
  void test('8 done and 2 cancelled read 8/8 everywhere', () => {
    const tasks = [...many(8, 'done'), ...many(2, 'cancelled')];
    for (const [surface, figure] of Object.entries(surfaces(tasks))) {
      assert.equal(figure, '8/8', surface);
    }
  });

  void test('cancelled is in neither done nor total, whatever else is open', () => {
    // One task in each status: done 1, and every status but cancelled in the total.
    const tasks = ALL_STATUSES.map((status) => task({ status }));
    const expected = `1/${String(ALL_STATUSES.length - 1)}`;
    for (const [surface, figure] of Object.entries(surfaces(tasks))) {
      assert.equal(figure, expected, surface);
    }
  });

  void test('a sprint of nothing but cancelled work is 0/0 everywhere', () => {
    for (const [surface, figure] of Object.entries(surfaces(many(3, 'cancelled')))) {
      assert.equal(figure, '0/0', surface);
    }
  });
});

void describe('a sprint card’s unassigned counts open work only (LAI-1040)', () => {
  for (const status of ALL_STATUSES) {
    void test(`an unassigned task in ${status}`, () => {
      const tasks = [task({ status, assignee_id: null }), task({ status: 'todo' })];
      const open = status !== 'done' && status !== 'cancelled';
      assert.equal(sprintFigures(tasks, byIdIndex(tasks)).unassigned, open ? 1 : 0);
    });
  }
});
