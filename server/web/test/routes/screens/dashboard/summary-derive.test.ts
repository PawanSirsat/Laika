/**
 * `routes/screens/dashboard/summary-derive.ts` (LAI-711).
 *
 * What a wrong number here costs: a dashboard that says one thing while the
 * board says another. Each test pins a rule against the reason for it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import { DAY_MS, startOfUtcDay } from '../../../../src/api/date-only.ts';
import type { Task } from '../../../../src/api/tasks.ts';
import { blockedTasks } from '../../../../src/routes/screens/dashboard/dashboard-derive.ts';
import {
  completedIn,
  dayHeading,
  fewDated,
  isOpen,
  MAX_PEOPLE,
  priorityBreakdown,
  REVIEW_WAIT_DAYS,
  splitBlocked,
  waitingForReview,
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
    status_id: 'st-todo',
    status_name: 'To do',
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
    send_back: null,
    size: null,
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

  void test('counts touched and created inside the range, and only those', () => {
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
    assert.equal(counts.touched, 3, 'the range is inclusive of its start, exclusive before it');
    assert.equal(counts.created, 2);
  });

  void test('all time counts every task', () => {
    const counts = windowCounts([task({ id: 'a' }), task({ id: 'b' })], undefined, NOW);
    assert.deepEqual([counts.touched, counts.created], [2, 2]);
  });

  /*
   * **The due tile says when it speaks for few** (LAI-817): on OnRoute 2 of
   * 301 open tasks had a date. Done work with a date is not open work.
   */
  void test('open and dated count open work only; fewer than half dated is "few"', () => {
    const counts = windowCounts(
      [
        task({ id: 'dated', due_on: today }),
        task({ id: 'plain-1' }),
        task({ id: 'plain-2' }),
        task({ id: 'done-dated', status: 'done', due_on: today }),
      ],
      since,
      NOW,
    );
    assert.deepEqual([counts.open, counts.dated], [3, 1]);
    assert.equal(fewDated(counts), true);
    assert.equal(fewDated({ open: 2, dated: 1 }), false, 'half is not few');
    assert.equal(fewDated({ open: 0, dated: 0 }), false, 'no open work is not "few dated"');
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

void describe('workloadByPerson — open work now (LAI-817, D-092 items 2 and 3)', () => {
  void test('open work only; review and backlog split out of each person, each its own share', () => {
    const load = workloadByPerson([
      task({ id: '1', assignee_id: 'u1', status: 'todo' }),
      task({ id: '2', assignee_id: 'u1', status: 'in_progress' }),
      task({ id: '3', assignee_id: 'u1', status: 'review' }),
      task({ id: '4', assignee_id: 'u1', status: 'done' }),
      task({ id: '5', assignee_id: 'u2', status: 'backlog' }),
      task({ id: '6', assignee_id: null, status: 'todo' }),
      task({ id: '7', assignee_id: null, status: 'cancelled' }),
      task({ id: '8', assignee_id: null, status: 'review' }),
    ]);
    assert.equal(load.open, 6);
    assert.equal(load.waitingForReview, 2, 'u1’s and the unassigned one');
    assert.equal(load.backlog, 1, 'u2’s');
    assert.deepEqual(
      load.rows.map((r) => [r.id, r.count, r.review, r.backlog]),
      [
        ['u1', 2, 1, 0],
        ['u2', 0, 0, 1],
        ['unassigned', 1, 1, 0],
      ],
    );
    assert.equal(
      load.rows.reduce((sum, r) => sum + r.count, 0) + load.backlog + load.waitingForReview,
      load.open,
      'the rows and the two shares must add up to the centre',
    );
  });

  /*
   * **D-092 item 3: load is committed work, and backlog is a pipeline** —
   * LAI-832. A person's number was backlog, to do and in progress, so 78 read
   * as load when 50 of it was backlog; at 390 px the detail that said so was
   * cut off. The count is now what Capacity calls load.
   */
  void test('a person’s count is to do and in progress; their backlog is beside it, never in it', () => {
    const load = workloadByPerson([
      ...Array.from({ length: 50 }, (_, i) =>
        task({ id: `b${String(i)}`, assignee_id: 'u1', status: 'backlog' }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        task({ id: `t${String(i)}`, assignee_id: 'u1', status: 'todo' }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        task({ id: `p${String(i)}`, assignee_id: 'u1', status: 'in_progress' }),
      ),
    ]);
    const u1 = load.rows.find((r) => r.id === 'u1');
    assert.equal(u1?.count, 28, 'seventy-eight is not their load');
    assert.equal(u1?.backlog, 50);
    assert.equal(load.backlog, 50, 'the donut’s backlog share');
    assert.equal(load.open, 78);
  });

  void test('blocked counts only what is in the count — committed work', () => {
    const load = workloadByPerson([
      task({ id: 'dep', assignee_id: 'u2', status: 'backlog' }),
      task({ id: 'later', assignee_id: 'u1', status: 'backlog', blocked_by: ['dep'] }),
      task({ id: 'next', assignee_id: 'u1', status: 'todo', blocked_by: ['dep'] }),
    ]);
    assert.equal(load.rows.find((r) => r.id === 'u1')?.blocked, 1, 'the backlog chain is apart');
  });

  void test('someone whose only open work is backlog keeps a row, at zero', () => {
    const load = workloadByPerson([task({ id: '1', assignee_id: 'u1', status: 'backlog' })]);
    assert.deepEqual(
      load.rows.map((r) => [r.id, r.count, r.backlog]),
      [['u1', 0, 1]],
    );
  });

  void test('someone whose only open work is in review keeps a row, at zero', () => {
    const load = workloadByPerson([task({ id: '1', assignee_id: 'u1', status: 'review' })]);
    assert.deepEqual(
      load.rows.map((r) => [r.id, r.count, r.review]),
      [['u1', 0, 1]],
    );
  });

  void test('a tie is ordered by work in review, then by name, not by arrival', () => {
    const names: Record<string, string> = { u1: 'Zed', u2: 'Amy', u3: 'Bea' };
    const load = workloadByPerson(
      [
        task({ id: '1', assignee_id: 'u1' }),
        task({ id: '2', assignee_id: 'u3' }),
        task({ id: '3', assignee_id: 'u2' }),
        task({ id: '4', assignee_id: 'u1', status: 'review' }),
      ],
      (id) => names[id] ?? id,
    );
    assert.deepEqual(
      load.rows.map((r) => r.id),
      ['u1', 'u2', 'u3'],
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

void describe('waitingForReview', () => {
  const into = (taskId: string, at: number): ActivityEvent => ({
    id: `e-${taskId}-${String(at)}`,
    seq: at,
    type: 'task.status_changed',
    project_id: 'p1',
    task_id: taskId,
    actor_id: 'u1',
    actor_kind: 'user',
    actor_token_id: null,
    payload: { from: 'in_progress', to: 'review' },
    created_at: at,
  });
  const over = (REVIEW_WAIT_DAYS + 1) * DAY_MS;
  const under = (REVIEW_WAIT_DAYS - 1) * DAY_MS;

  void test('the move into review, when the range holds it, decides the wait', () => {
    const rows = waitingForReview(
      [
        // Moved in long ago, touched yesterday: it has still waited.
        task({ id: 'long', status: 'review', updated_at: NOW - DAY_MS }),
        // Quiet for ages, but moved in recently: it has not.
        task({ id: 'fresh', status: 'review', updated_at: NOW - 50 * DAY_MS }),
      ],
      [into('long', NOW - over), into('fresh', NOW - under)],
      NOW - 30 * DAY_MS,
      NOW,
    );
    assert.deepEqual(
      rows.map((r) => [r.task.id, r.since]),
      [['long', NOW - over]],
    );
  });

  void test('a move before the range: the earlier of its start and the last touch, never overstated', () => {
    const rows = waitingForReview(
      [
        task({ id: 'old-quiet', status: 'review', updated_at: NOW - 20 * DAY_MS }),
        task({ id: 'old-touched', status: 'review', updated_at: NOW - DAY_MS }),
        task({ id: 'not-review', status: 'todo', updated_at: NOW - 20 * DAY_MS }),
      ],
      [],
      NOW - 7 * DAY_MS,
      NOW,
    );
    assert.deepEqual(
      rows.map((r) => [r.task.id, r.since]),
      [
        ['old-quiet', NOW - 20 * DAY_MS],
        ['old-touched', NOW - 7 * DAY_MS],
      ],
    );
    const day = waitingForReview(
      [task({ id: 'old-touched', status: 'review', updated_at: NOW - DAY_MS })],
      [],
      NOW - DAY_MS,
      NOW,
    );
    assert.deepEqual(day, [], 'with nothing but the range to go on, it cannot see the wait');
  });

  /*
   * **The wait does not move with the range** (LAI-832). `GET /review` says
   * when each task last moved into review, whatever the range — so a task ten
   * days in review, touched an hour ago, stays on "Last 24 hours".
   */
  void test('the review queue’s time of the move decides the wait, whatever the range', () => {
    const tasks = [task({ id: 'long', status: 'review', updated_at: NOW - 3_600_000 })];
    const queued = new Map([['long', NOW - 10 * DAY_MS]]);
    for (const rangeStart of [NOW - DAY_MS, NOW - 7 * DAY_MS, undefined]) {
      assert.deepEqual(
        waitingForReview(tasks, [], rangeStart, NOW, queued).map((r) => [r.task.id, r.since]),
        [['long', NOW - 10 * DAY_MS]],
        `range from ${String(rangeStart)}`,
      );
    }
  });

  void test('the later of the queue and the range’s own move wins: the queue may be a minute old', () => {
    // Sent back and delivered again two days ago; the queue was read before.
    const rows = waitingForReview(
      [task({ id: 'again', status: 'review', updated_at: NOW - 2 * DAY_MS })],
      [into('again', NOW - 2 * DAY_MS)],
      NOW - 7 * DAY_MS,
      NOW,
      new Map([['again', NOW - 10 * DAY_MS]]),
    );
    assert.deepEqual(rows, [], 'two days is not a five-day wait');
  });
});

void describe('splitBlocked', () => {
  void test('to do and in progress are counted; backlog and review are apart', () => {
    const tasks = [
      task({ id: 'dep', status: 'backlog' }),
      task({ id: 'todo', status: 'todo', blocked_by: ['dep'] }),
      task({ id: 'doing', status: 'in_progress', blocked_by: ['dep'] }),
      task({ id: 'later', status: 'backlog', blocked_by: ['dep'] }),
      task({ id: 'waiting', status: 'review', blocked_by: ['dep'] }),
    ];
    const split = splitBlocked(blockedTasks(tasks));
    assert.deepEqual(
      split.committed.map((r) => r.task.id),
      ['todo', 'doing'],
    );
    assert.deepEqual(
      split.apart.map((r) => r.task.id),
      ['later', 'waiting'],
    );
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
