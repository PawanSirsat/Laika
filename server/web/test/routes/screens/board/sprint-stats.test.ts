/**
 * The toolbar's DONE / BLK / LEFT, counted the way the sprint strip counted
 * them (LAI-727).
 *
 * The owner removed the strip and kept its three figures, so the figures must
 * not change meaning on the way. `stripCountFor` below is `countFor` from
 * `board/SprintStrip.tsx` at 5adbfae, copied rather than imported: it is the
 * definition being preserved, and the strip it lives in is no longer on the
 * board to keep it honest.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  countStats,
  narrowsBeyondSprint,
  statsScope,
} from '../../../../src/routes/screens/board/sprint-stats.ts';
import type { Sprint } from '../../../../src/api/sprints.ts';
import type { TaskStatus } from '../../../../src/api/tasks.ts';

interface Row {
  readonly status: TaskStatus;
  readonly ready: boolean;
  readonly sprint_id: string | null;
  readonly parent_task_id: string | null;
}

/** `SprintStrip.tsx` `countFor`, 5adbfae — the definition LAI-727 keeps. */
function stripCountFor(tasks: readonly Row[], sprintId: string | undefined) {
  const inScope = sprintId === undefined ? tasks : tasks.filter((t) => t.sprint_id === sprintId);
  return {
    total: inScope.length,
    done: inScope.filter((t) => t.status === 'done').length,
    blocked: inScope.filter((t) => !t.ready && t.status !== 'done').length,
  };
}

const row = (
  status: TaskStatus,
  ready: boolean,
  sprint: string | null,
  parent: string | null = null,
): Row => ({ status, ready, sprint_id: sprint, parent_task_id: parent });

const PROJECT: readonly Row[] = [
  row('done', true, 's1'),
  row('done', false, 's1'),
  row('done', true, 's2'),
  row('done', true, 's2', 'p'),
  row('in_progress', true, 's2'),
  row('in_progress', false, 's2'),
  row('review', true, 's2'),
  row('todo', false, 's2'),
  row('todo', false, 's2', 'p'),
  row('backlog', false, 's2'),
  row('cancelled', false, 's2'),
  row('todo', true, 's3'),
  row('backlog', false, null),
];

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 8, 15, 30);
const MIDNIGHT = Date.UTC(2026, 9, 8);

const sprint = (id: string, status: Sprint['status'], endsInDays: number): Sprint => ({
  id,
  project_id: 'p',
  name: `Sprint ${id}`,
  goal: null,
  status,
  starts_on: MIDNIGHT - 14 * DAY,
  ends_on: MIDNIGHT + endsInDays * DAY,
  created_at: 1,
  updated_at: 1,
});

const SPRINTS = [
  sprint('s1', 'completed', -3),
  sprint('s2', 'active', 9),
  sprint('s3', 'planned', 23),
];

void describe('countStats is the strip’s countFor (LAI-727)', () => {
  for (const scope of ['s1', 's2', 's3', undefined]) {
    void test(`over ${scope ?? 'every sprint'}`, () => {
      // The board's set for a scope is what the server returns for it, which is
      // the strip's set filtered the same way.
      const set = scope === undefined ? PROJECT : PROJECT.filter((t) => t.sprint_id === scope);
      assert.deepEqual(countStats(set), stripCountFor(PROJECT, scope));
    });
  }

  void test('the active sprint, by hand: subtasks count, cancelled is open work', () => {
    const s2 = PROJECT.filter((t) => t.sprint_id === 's2');
    assert.deepEqual(countStats(s2), { total: 9, done: 2, blocked: 5 });
  });
});

void describe('statsScope names what the figures describe (LAI-727)', () => {
  void test('a sprint is S<n> in list order, with its days left, inclusive', () => {
    const scope = statsScope('s2', SPRINTS, NOW);
    assert.equal(scope.label, 'S2');
    assert.equal(scope.name, 'Sprint s2');
    // `daysLeft`: ends 9 days after today's midnight, counting today, is 10.
    assert.equal(scope.daysLeft, 10);
  });

  void test('a finished sprint has none left, never a negative number', () => {
    assert.equal(statsScope('s1', SPRINTS, NOW).daysLeft, 0);
  });

  void test('every sprint has no days left to show', () => {
    const scope = statsScope(undefined, SPRINTS, NOW);
    assert.equal(scope.label, 'All sprints');
    assert.equal(scope.daysLeft, undefined);
  });

  void test('work in no sprint, an unknown sprint, and a list not yet read', () => {
    assert.equal(statsScope('none', SPRINTS, NOW).label, 'No sprint');
    assert.equal(statsScope('none', SPRINTS, NOW).daysLeft, undefined);
    assert.equal(statsScope('gone', SPRINTS, NOW).label, 'Unknown sprint');
    // Not "Unknown" before the list has answered — that is a claim it cannot make.
    assert.equal(statsScope('s2', undefined, NOW).label, 'Sprint');
  });
});

void describe('narrowsBeyondSprint decides whose task set is counted (LAI-727)', () => {
  void test('the sprint alone does not narrow — the board’s set is the strip’s', () => {
    assert.equal(narrowsBeyondSprint({}), false);
    assert.equal(narrowsBeyondSprint({ sprint: 's2' }), false);
  });

  void test('every other server-side filter does', () => {
    for (const filter of [
      { status: 'todo' as const },
      { priority: 'p1' as const },
      { assignee: 'u1' },
      { ready: true },
      { ready: false },
      { tag: 'ui' },
      { updated_since: 1 },
    ]) {
      assert.equal(narrowsBeyondSprint({ sprint: 's2', ...filter }), true, JSON.stringify(filter));
    }
  });
});
