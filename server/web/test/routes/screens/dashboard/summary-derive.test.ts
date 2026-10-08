/**
 * `routes/screens/dashboard/summary-derive.ts` (LAI-711).
 *
 * What a wrong number here costs: a dashboard that says one thing while the
 * board says another. Each test pins a rule against the reason for it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DAY_MS, startOfUtcDay } from '../../../../src/api/date-only.ts';
import type { Task } from '../../../../src/api/tasks.ts';
import {
  completedIn,
  dayHeading,
  isOpen,
  MAX_PEOPLE,
  priorityBreakdown,
  staleTasks,
  STALE_DAYS,
  windowCounts,
  workloadByPerson,
} from '../../../../src/routes/screens/dashboard/summary-derive.ts';

const NOW = Date.now();

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LAI-${over.id}`,
    project_id: 'p1',
    number: 1,
    title: 'A task',
    description_md: null,
    acceptance_md: null,
    status: 'todo',
    priority: 'p2',
    position: null,
    assignee_id: null,
    sprint_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    ready: false,
    stale_flagged_at: null,
    blocked_by: [],
    blocks: [],
    tags: [],
    comment_count: 0,
    branch: null,
    external_ref: null,
    started_at: null,
    completed_at: null,
    created_at: NOW - 100 * DAY_MS,
    updated_at: NOW - 100 * DAY_MS,
    ...over,
  };
}

void describe('isOpen', () => {
  void test('done and cancelled are not open; everything else is', () => {
    assert.deepEqual(
      (['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'] as const).map((status) =>
        isOpen({ status }),
      ),
      [true, true, true, true, false, false],
    );
  });
});

void describe('windowCounts', () => {
  const since = NOW - 7 * DAY_MS;
  const today = startOfUtcDay(NOW);

  void test('counts updated and created inside the range, and only those', () => {
    const counts = windowCounts(
      [
        task({ id: 'a', updated_at: NOW - DAY_MS, created_at: NOW - DAY_MS }),
        task({ id: 'b', updated_at: NOW - DAY_MS }),
        task({ id: 'c', updated_at: since, created_at: since }),
        task({ id: 'd', updated_at: since - 1, created_at: since - 1 }),
      ],
      since,
      NOW,
    );
    assert.equal(counts.updated, 3, 'the range is inclusive of its start, exclusive before it');
    assert.equal(counts.created, 2);
  });

  void test('all time counts every task', () => {
    const counts = windowCounts([task({ id: 'a' }), task({ id: 'b' })], undefined, NOW);
    assert.deepEqual([counts.updated, counts.created], [2, 2]);
  });

  void test('due soon is open work due today through six days ahead; overdue is the board’s rule', () => {
    const counts = windowCounts(
      [
        task({ id: 'today', due_on: today }),
        task({ id: 'six', due_on: today + 6 * DAY_MS }),
        task({ id: 'seven', due_on: today + 7 * DAY_MS }),
        task({ id: 'late', due_on: today - DAY_MS }),
        task({ id: 'late-done', due_on: today - DAY_MS, status: 'done' }),
        task({ id: 'soon-done', due_on: today, status: 'done' }),
        task({ id: 'none' }),
      ],
      since,
      NOW,
    );
    assert.equal(counts.dueSoon, 2, 'today and six days ahead; seven is outside the week');
    assert.equal(counts.overdue, 1, 'finished work is never overdue');
  });
});

void describe('completedIn', () => {
  void test('sums the server’s days', () => {
    assert.equal(completedIn([{ completed: 3 }, { completed: 0 }, { completed: 4 }]), 7);
    assert.equal(completedIn([]), 0);
  });
});

void describe('workloadByPerson', () => {
  void test('open work only, every open status counted, Unassigned last', () => {
    const load = workloadByPerson([
      task({ id: '1', assignee_id: 'u1', status: 'todo' }),
      task({ id: '2', assignee_id: 'u1', status: 'in_progress' }),
      task({ id: '3', assignee_id: 'u1', status: 'review' }),
      task({ id: '4', assignee_id: 'u1', status: 'done' }),
      task({ id: '5', assignee_id: 'u2', status: 'backlog' }),
      task({ id: '6', assignee_id: null, status: 'todo' }),
      task({ id: '7', assignee_id: null, status: 'cancelled' }),
    ]);
    assert.equal(load.open, 5);
    assert.deepEqual(
      load.rows.map((r) => [r.id, r.count]),
      [
        ['u1', 3],
        ['u2', 1],
        ['unassigned', 1],
      ],
    );
    assert.deepEqual(load.rows[0]?.byStatus, { backlog: 0, todo: 1, in_progress: 1, review: 1 });
    assert.equal(
      load.rows.reduce((sum, r) => sum + r.count, 0),
      load.open,
      'the rows must add up to the centre',
    );
  });

  void test('a tie is ordered by name, not by arrival', () => {
    const names: Record<string, string> = { u1: 'Zed', u2: 'Amy' };
    const load = workloadByPerson(
      [task({ id: '1', assignee_id: 'u1' }), task({ id: '2', assignee_id: 'u2' })],
      (id) => names[id] ?? id,
    );
    assert.deepEqual(
      load.rows.map((r) => r.id),
      ['u2', 'u1'],
    );
  });

  void test('past the cut, the rest fold into Others — and Unassigned never does', () => {
    const tasks = Array.from({ length: MAX_PEOPLE + 2 }, (_, i) =>
      Array.from({ length: 10 - i }, (_, j) =>
        task({ id: `${String(i)}-${String(j)}`, assignee_id: `u${String(i)}` }),
      ),
    ).flat();
    tasks.push(task({ id: 'nobody', assignee_id: null }));
    const load = workloadByPerson(tasks);
    assert.equal(load.rows.length, MAX_PEOPLE + 2);
    const others = load.rows[MAX_PEOPLE];
    assert.equal(others?.kind, 'others');
    assert.deepEqual(others?.people, [`u${String(MAX_PEOPLE)}`, `u${String(MAX_PEOPLE + 1)}`]);
    assert.equal(load.rows.at(-1)?.kind, 'unassigned');
    assert.equal(
      load.rows.reduce((sum, r) => sum + r.count, 0),
      load.open,
    );
  });

  void test('blocked is counted per person by the dashboard’s blocked rule', () => {
    const load = workloadByPerson([
      task({ id: 'dep', assignee_id: 'u2', status: 'todo' }),
      task({ id: 'held', assignee_id: 'u1', status: 'todo', blocked_by: ['dep'] }),
    ]);
    assert.equal(load.rows.find((r) => r.id === 'u1')?.blocked, 1);
    assert.equal(load.rows.find((r) => r.id === 'u2')?.blocked, 0);
  });
});

void describe('priorityBreakdown', () => {
  void test('open work per priority, in the board’s order, zeros kept', () => {
    assert.deepEqual(
      priorityBreakdown([
        task({ id: '1', priority: 'p1' }),
        task({ id: '2', priority: 'p1', status: 'done' }),
        task({ id: '3', priority: 'p3' }),
      ]),
      [
        { priority: 'p1', count: 1 },
        { priority: 'p2', count: 0 },
        { priority: 'p3', count: 1 },
      ],
    );
  });
});

void describe('staleTasks', () => {
  void test('every open task quiet past the threshold, oldest first, uncapped', () => {
    const quiet = Array.from({ length: 9 }, (_, i) =>
      task({ id: `q${String(i)}`, updated_at: NOW - (STALE_DAYS + 1 + i) * DAY_MS }),
    );
    const stale = staleTasks(
      [
        ...quiet,
        task({ id: 'fresh', updated_at: NOW - DAY_MS }),
        task({ id: 'done', status: 'done', updated_at: NOW - 50 * DAY_MS }),
      ],
      NOW,
    );
    assert.equal(stale.length, 9, 'the count must not be capped');
    assert.equal(stale[0]?.id, 'q8', 'oldest first');
  });
});

void describe('dayHeading', () => {
  void test('today, yesterday, then a date', () => {
    assert.equal(dayHeading(NOW, NOW), 'Today');
    const yesterday = new Date(NOW);
    yesterday.setDate(yesterday.getDate() - 1);
    assert.equal(dayHeading(yesterday.getTime(), NOW), 'Yesterday');
    const older = new Date(NOW);
    older.setDate(older.getDate() - 3);
    const heading = dayHeading(older.getTime(), NOW);
    assert.ok(heading !== 'Today' && heading !== 'Yesterday' && heading.length > 3, heading);
  });
});
