/**
 * The toolbar's DONE / BLK / LEFT, counted the way the sprint strip counted
 * them (LAI-727) — except BLK and a future sprint's LEFT (LAI-819).
 *
 * The owner removed the strip and kept its three figures, so DONE must not
 * change meaning on the way. `stripCountFor` below is `countFor` from
 * `board/SprintStrip.tsx` at 5adbfae, copied rather than imported: it is the
 * definition being preserved, and the strip it lives in is no longer on the
 * board to keep it honest.
 *
 * **BLK is not preserved** (LAI-819). The strip's `!ready` is also true of
 * every assigned task and every task already moving, so a 99-task sprint read
 * BLK 95 where 9 were blocked. BLK is the server's count now: open work
 * waiting on a dependency that is not `done`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { countStats, statsScope } from '../../../../src/routes/screens/board/sprint-stats.ts';
import type { Sprint } from '../../../../src/api/sprints.ts';
import type { TaskStatus } from '../../../../src/api/tasks.ts';

interface Row {
  readonly id: string;
  readonly status: TaskStatus;
  readonly ready: boolean;
  readonly sprint_id: string | null;
  readonly parent_task_id: string | null;
  readonly blocked_by: readonly string[];
}

/** `SprintStrip.tsx` `countFor`, 5adbfae — the definition LAI-727 keeps for DONE. */
function stripCountFor(tasks: readonly Row[], sprintId: string | undefined) {
  const inScope = sprintId === undefined ? tasks : tasks.filter((t) => t.sprint_id === sprintId);
  return {
    total: inScope.length,
    done: inScope.filter((t) => t.status === 'done').length,
    blocked: inScope.filter((t) => !t.ready && t.status !== 'done').length,
  };
}

const row = (
  id: string,
  status: TaskStatus,
  ready: boolean,
  sprint: string | null,
  over: { readonly parent?: string; readonly blockedBy?: readonly string[] } = {},
): Row => ({
  id,
  status,
  ready,
  sprint_id: sprint,
  parent_task_id: over.parent ?? null,
  blocked_by: over.blockedBy ?? [],
});

/*
 * `ready` as the server serves it (§4.5): backlog or todo, unassigned, every
 * dependency done. So it is false for everything moving or assigned, which is
 * the whole of the strip's overcount.
 */
const PROJECT: readonly Row[] = [
  row('a', 'done', false, 's1'),
  row('b', 'done', false, 's1'),
  row('c', 'done', false, 's2'),
  row('d', 'done', false, 's2', { parent: 'c' }),
  // Moving and assigned, nothing holding it: not ready, not blocked.
  row('e', 'in_progress', false, 's2'),
  // Waiting on `x`, open in the next sprint: blocked, though its blocker is not here.
  row('f', 'in_progress', false, 's2', { blockedBy: ['x'] }),
  // Waiting for a reviewer, nothing holding it.
  row('g', 'review', false, 's2'),
  // Its one blocker is done (in another sprint): ready, and not blocked.
  row('h', 'todo', true, 's2', { blockedBy: ['a'] }),
  // A cancelled blocker still blocks — the server requires `done`.
  row('i', 'todo', false, 's2', { parent: 'c', blockedBy: ['k'] }),
  // A blocker nobody loaded, and not ready: counted, not assumed met.
  row('j', 'backlog', false, 's2', { blockedBy: ['gone'] }),
  // Cancelled work is never blocked work, whatever it waits on.
  row('k', 'cancelled', false, 's2', { blockedBy: ['e'] }),
  // A blocker nobody loaded, but `ready` proves every dependency done.
  row('l', 'todo', true, 's2', { blockedBy: ['gone'] }),
  row('x', 'todo', true, 's3'),
  row('m', 'todo', false, 's3', { blockedBy: ['f'] }),
  row('n', 'backlog', false, null, { blockedBy: ['e'] }),
];

/** The whole project — what the board judges a blocker against. */
const BY_ID = new Map(PROJECT.map((t) => [t.id, t]));

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 8, 15, 30);
const MIDNIGHT = Date.UTC(2026, 9, 8);

const sprint = (
  id: string,
  status: Sprint['status'],
  endsInDays: number,
  startsInDays = -14,
): Sprint => ({
  id,
  project_id: 'p',
  name: `Sprint ${id}`,
  goal: null,
  status,
  starts_on: MIDNIGHT + startsInDays * DAY,
  ends_on: MIDNIGHT + endsInDays * DAY,
  created_at: 1,
  updated_at: 1,
});

const SPRINTS = [
  sprint('s1', 'completed', -3),
  sprint('s2', 'active', 9),
  sprint('s3', 'planned', 23),
];

void describe('DONE and its total are still the strip’s countFor (LAI-727)', () => {
  for (const scope of ['s1', 's2', 's3', undefined]) {
    void test(`over ${scope ?? 'every sprint'}`, () => {
      // The board's set for a scope is what the server returns for it, which is
      // the strip's set filtered the same way.
      const set = scope === undefined ? PROJECT : PROJECT.filter((t) => t.sprint_id === scope);
      const { total, done } = countStats(set, BY_ID);
      const strip = stripCountFor(PROJECT, scope);
      assert.deepEqual({ total, done }, { total: strip.total, done: strip.done });
    });
  }
});

void describe('BLK is open work held by an unfinished blocker (LAI-819)', () => {
  const s2 = PROJECT.filter((t) => t.sprint_id === 's2');

  void test('the active sprint, by hand', () => {
    // f (blocker open in s3), i (blocker cancelled), j (blocker unknown).
    // Subtasks count, as DONE counts them.
    assert.deepEqual(countStats(s2, BY_ID), { total: 10, done: 2, blocked: 3 });
  });

  void test('not the strip’s `!ready`, which also counted e, g and k', () => {
    assert.equal(stripCountFor(PROJECT, 's2').blocked, 6, 'the fixture lost its overcount');
    assert.notEqual(countStats(s2, BY_ID).blocked, stripCountFor(PROJECT, 's2').blocked);
  });

  void test('every sprint, and work in none', () => {
    // f, i, j in s2; m in s3; n in no sprint.
    assert.equal(countStats(PROJECT, BY_ID).blocked, 5);
    assert.equal(
      countStats(
        PROJECT.filter((t) => t.sprint_id === null),
        BY_ID,
      ).blocked,
      1,
    );
  });

  void test('a blocker is judged against the project, not the scope', () => {
    // h's blocker is done in s1. Judged against s2 alone it is unknown, and
    // h would count — `ready` is what saves it there, so take that away too.
    const assigned = row('h2', 'in_progress', false, 's2', { blockedBy: ['a'] });
    const scopeOnly = new Map([...s2, assigned].map((t) => [t.id, t]));
    assert.equal(countStats([assigned], BY_ID).blocked, 0, 'a done blocker held it');
    assert.equal(countStats([assigned], scopeOnly).blocked, 1, 'the control: unknown counts');
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

  void test('a sprint that has not started says when it starts, not days left (LAI-819)', () => {
    // Starts in 14 days and ends in 26: LEFT 27 counted 14 days nobody can work.
    const ahead = sprint('s4', 'planned', 26, 14);
    const scope = statsScope('s4', [...SPRINTS, ahead], NOW);
    assert.equal(scope.startsIn, 14);
    assert.equal(scope.daysLeft, undefined);
    // Tomorrow is one day; today is started.
    assert.equal(statsScope('t', [sprint('t', 'planned', 9, 1)], NOW).startsIn, 1);
    const started = statsScope('t', [sprint('t', 'active', 9, 0)], NOW);
    assert.equal(started.startsIn, undefined);
    assert.equal(started.daysLeft, 10);
  });

  void test('the hour of the day does not move the start', () => {
    const ahead = [sprint('s4', 'planned', 26, 14)];
    assert.equal(statsScope('s4', ahead, MIDNIGHT).startsIn, 14);
    assert.equal(statsScope('s4', ahead, MIDNIGHT + DAY - 1).startsIn, 14);
  });

  void test('every sprint has no days left to show', () => {
    const scope = statsScope(undefined, SPRINTS, NOW);
    assert.equal(scope.label, 'All sprints');
    assert.equal(scope.daysLeft, undefined);
    assert.equal(scope.startsIn, undefined);
  });

  void test('work in no sprint, an unknown sprint, and a list not yet read', () => {
    assert.equal(statsScope('none', SPRINTS, NOW).label, 'No sprint');
    assert.equal(statsScope('none', SPRINTS, NOW).daysLeft, undefined);
    assert.equal(statsScope('gone', SPRINTS, NOW).label, 'Unknown sprint');
    // Not "Unknown" before the list has answered — that is a claim it cannot make.
    assert.equal(statsScope('s2', undefined, NOW).label, 'Sprint');
  });
});
