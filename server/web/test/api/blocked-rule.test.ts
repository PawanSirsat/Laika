/**
 * One rule for "blocked", on every surface (LAI-882).
 *
 * The server calls a task blocked while any dependency is not `done`: `isReady`
 * (`task-lifecycle.ts`) and the project card's `blocked_count`
 * (`services/projects.ts`) both read `<> 'done'`, so a **cancelled** dependency
 * still blocks. The board's BLK and a sprint's lock followed that (LAI-819);
 * the card, the List row, the Blocked-only filter and the Timeline did not, so
 * a task whose only blocker was cancelled counted in BLK while its own card
 * drew no lock.
 *
 * So this asks every surface the same question, for a dependency in each
 * status, and checks each answer against the server's rule written out here
 * rather than against the shared helper — a helper that drifted would
 * otherwise agree with itself.
 *
 * The Blocked-only filter (`BoardScreen.tsx`) is `blockedState(...) === false`
 * inline, so `blockedState` here is its answer as well as the card's.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALL_STATUSES,
  blockedState,
  blockers,
  byIdIndex,
  heldByBlocker,
} from '../../src/api/board-derive.ts';
import type { Task, TaskStatus } from '../../src/api/tasks.ts';
import { countStats } from '../../src/routes/screens/board/sprint-stats.ts';
import { blockedTasks } from '../../src/routes/screens/dashboard/dashboard-derive.ts';
import { listRows } from '../../src/routes/screens/list/list-derive.ts';
import { sprintFigures } from '../../src/routes/screens/sprints/sprint-derive.ts';
import { blockedTally } from '../../src/routes/screens/timeline/timeline-derive.ts';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LAI-${over.id}`,
    project_id: 'p',
    number: Number(over.id.replace(/\D/g, '')) || 1,
    title: 'A task',
    description_md: null,
    status: 'todo',
    status_id: over.status ?? 'todo',
    status_name: over.status ?? 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
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

/** The server's rule, as `isReady` and `blocked_count` state it. */
const serverBlocks = (dependency: TaskStatus): boolean => dependency !== 'done';

/** Every surface's answer for one open task waiting on one dependency. */
function surfaces(dependencyStatus: TaskStatus): Record<string, boolean> {
  const dependency = task({ id: '1', status: dependencyStatus });
  const waiting = task({ id: '2', status: 'todo', blocked_by: ['1'] });
  const tasks = [dependency, waiting];
  const byId = byIdIndex(tasks);
  const row = listRows({
    tasks,
    byId,
    members: new Map(),
    sprintLabels: new Map(),
    now: 0,
  }).find((r) => r.key === waiting.key);
  assert.ok(row !== undefined);

  return {
    'card lock and Blocked-only filter (blockedState)': blockedState(waiting, byId) === true,
    'card "blocked by" (blockers)': blockers(waiting, byId).some((d) => d.id === '1'),
    'List row mark': row.blocked,
    'List row "blocked by"': row.blockedBy === 'blocked by LAI-1',
    'board BLK (countStats)': countStats([waiting], byId).blocked === 1,
    'sprint card lock (sprintFigures)': sprintFigures([waiting], byId).blocked === 1,
    heldByBlocker: heldByBlocker(waiting, byId),
    'Timeline blocked count (blockedTally)': blockedTally(tasks).blocked === 1,
    'Dashboard blocked list (blockedTasks)': blockedTasks(tasks).some(
      (r) => r.task.id === waiting.id,
    ),
  };
}

void describe('every surface calls the same tasks blocked, the server’s way (LAI-882)', () => {
  for (const status of ALL_STATUSES) {
    void test(`a dependency in ${status}`, () => {
      const expected = serverBlocks(status);
      for (const [surface, blocked] of Object.entries(surfaces(status))) {
        assert.equal(blocked, expected, `${surface} disagrees with the server on ${status}`);
      }
    });
  }

  void test('a task whose only blocker is cancelled is blocked on the card and in BLK', () => {
    // The case the review found, stated alone so its failure names it.
    const answers = surfaces('cancelled');
    assert.equal(answers['card lock and Blocked-only filter (blockedState)'], true);
    assert.equal(answers['board BLK (countStats)'], true);
  });
});
