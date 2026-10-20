/**
 * `routes/screens/dashboard/card-filters.ts` (LAI-732, LAI-817).
 *
 * The owner: the range buttons changed the stat cards *"but not this section
 * in the status overview and the work by person section"*. Status overview now
 * counts the tasks **touched** within the range — the "N touched" stat's rule
 * — and both cards have filters of their own, read from the URL under their
 * own prefix. These pin the three things a wrong number would come from: the
 * range, each filter under it, and an invalid value being ignored rather than
 * counted (LAI-487).
 *
 * **The people card no longer follows the range** (LAI-817, D-092 item 2):
 * Work by person counted open work touched in the range, and became
 * Contributors, whose Open work now is every open task, whatever the range.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DAY_MS } from '../../../../src/api/date-only.ts';
import type { Task, TaskSummary } from '../../../../src/api/tasks.ts';
import {
  blockedIdsOf,
  cardTasks,
  peopleCardActive,
  readPeopleCard,
  readStatusCard,
  statusCardActive,
} from '../../../../src/routes/screens/dashboard/card-filters.ts';
import { statusBreakdown } from '../../../../src/routes/screens/dashboard/dashboard-derive.ts';
import { workloadByPerson } from '../../../../src/routes/screens/dashboard/summary-derive.ts';

const NOW = 1_800_000_000_000;
const WEEK = NOW - 7 * DAY_MS;

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

/** Recent ones are touched an hour ago; old ones forty days ago. */
const recent = (over: Partial<Task> & { id: string }): Task =>
  task({ updated_at: NOW - 3_600_000, ...over });
const old = (over: Partial<Task> & { id: string }): Task =>
  task({ updated_at: NOW - 40 * DAY_MS, ...over });

const SET: readonly Task[] = [
  recent({
    id: 'a',
    status: 'in_progress',
    assignee_id: 'ada',
    sprint_id: 's1',
    priority: 'p1',
    tags: ['api'],
  }),
  recent({ id: 'b', status: 'done', assignee_id: 'ada', sprint_id: 's1', created_via: 'mcp' }),
  recent({ id: 'c', status: 'todo', assignee_id: null, sprint_id: 's2', tags: ['web'] }),
  recent({ id: 'd', status: 'cancelled', assignee_id: 'bob', sprint_id: 's1' }),
  old({
    id: 'e',
    status: 'review',
    assignee_id: 'bob',
    sprint_id: 's1',
    priority: 'p1',
    tags: ['api'],
    created_via: 'mcp',
  }),
  old({ id: 'f', status: 'backlog', assignee_id: null, sprint_id: null }),
  old({ id: 'g', status: 'done', assignee_id: 'bob', sprint_id: 's2' }),
];

const KNOWN = { sprintIds: new Set(['s1', 's2']), memberIds: new Set(['ada', 'bob']) };
const q = (s: string): URLSearchParams => new URLSearchParams(s);
const ids = (tasks: readonly TaskSummary[]): string[] => tasks.map((t) => t.id);
const ALL = { since: undefined, activeSprintId: 's1' };
const SEVEN = { since: WEEK, activeSprintId: 's1' };

void describe('no card filter and "All time" is today’s card exactly', () => {
  void test('Status overview: the same breakdown, cancelled still out of the total', () => {
    const filter = readStatusCard(q(''), KNOWN);
    const tasks = cardTasks(SET, filter, ALL);
    assert.deepEqual(statusBreakdown(tasks), statusBreakdown(SET));
    assert.equal(statusBreakdown(tasks).total - statusBreakdown(tasks).live, 1, 'one cancelled');
    assert.equal(statusCardActive(filter), 0);
  });

  void test('Open work now: the same open work, the same Unassigned row', () => {
    const filter = readPeopleCard(q(''), KNOWN);
    const load = workloadByPerson(cardTasks(SET, filter, ALL));
    assert.deepEqual(load, workloadByPerson(SET));
    assert.equal(load.rows.at(-1)?.kind, 'unassigned');
    assert.equal(peopleCardActive(filter), 0);
  });
});

void describe('the dashboard range applies to Status overview, never to Open work now', () => {
  void test('a range counts only tasks touched within it', () => {
    assert.deepEqual(ids(cardTasks(SET, readStatusCard(q(''), KNOWN), SEVEN)), [
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  /*
   * **Open work now ignores the range** (LAI-817, D-092 item 2). Under the old
   * card, 7 days dropped e and f — open, but untouched for forty days — and
   * the donut read as a smaller workload than anyone held.
   */
  void test('Open work now counts the same tasks under 7 days as under All time', () => {
    const filter = readPeopleCard(q(''), KNOWN);
    assert.deepEqual(ids(cardTasks(SET, filter, SEVEN)), ids(SET));
    const seven = workloadByPerson(cardTasks(SET, filter, SEVEN));
    assert.equal(seven.open, 4, 'a, c, e and f are open, two of them untouched for 40 days');
    assert.deepEqual(seven, workloadByPerson(SET));
  });

  /*
   * **The bound is inclusive, to the millisecond** (LAI-732 review): the
   * "N updated" stat counts `updated_at >= since`, and a card that used `>`
   * would drop a task touched at the very start of the window.
   */
  void test('a task updated exactly at the range’s start is kept; one a millisecond earlier is not', () => {
    const at = recent({ id: 'at', updated_at: WEEK });
    const before = recent({ id: 'before', updated_at: WEEK - 1 });
    const filter = readStatusCard(q(''), KNOWN);
    assert.deepEqual(ids(cardTasks([at, before], filter, SEVEN)), ['at']);
  });

  void test('"All tasks" on Status overview overrides the range, and counts as a filter', () => {
    const so = readStatusCard(q('so_range=all'), KNOWN);
    assert.deepEqual(ids(cardTasks(SET, so, SEVEN)), ids(SET));
    assert.equal(statusCardActive(so), 1);
  });
});

void describe('each Status overview filter, under "All time" and under 7 days', () => {
  const cases: readonly [string, string[], string[]][] = [
    ['so_sprint=active', ['a', 'b', 'd', 'e'], ['a', 'b', 'd']],
    ['so_sprint=s2', ['c', 'g'], ['c']],
    ['so_assignee=none', ['c', 'f'], ['c']],
    ['so_assignee=bob', ['d', 'e', 'g'], ['d']],
    ['so_priority=p1', ['a', 'e'], ['a']],
    ['so_tag=api', ['a', 'e'], ['a']],
    ['so_agent=true', ['b', 'e'], ['b']],
  ];
  for (const [query, all, seven] of cases) {
    void test(query, () => {
      const filter = readStatusCard(q(query), KNOWN);
      assert.equal(statusCardActive(filter), 1, `${query} is one filter`);
      assert.deepEqual(ids(cardTasks(SET, filter, ALL)), all, 'all time');
      assert.deepEqual(ids(cardTasks(SET, filter, SEVEN)), seven, '7 days');
    });
  }

  void test('filters combine', () => {
    const filter = readStatusCard(q('so_sprint=s1&so_priority=p1&so_tag=api'), KNOWN);
    assert.equal(statusCardActive(filter), 3);
    assert.deepEqual(ids(cardTasks(SET, filter, ALL)), ['a', 'e']);
    assert.deepEqual(ids(cardTasks(SET, filter, SEVEN)), ['a']);
  });

  void test('"Active" with no active sprint matches nothing, rather than everything', () => {
    const filter = readStatusCard(q('so_sprint=active'), KNOWN);
    assert.deepEqual(
      ids(cardTasks(SET, filter, { since: undefined, activeSprintId: undefined })),
      [],
    );
  });
});

void describe('each Contributors filter', () => {
  void test('sprint, priority and label narrow the work; the range never does', () => {
    const cases: readonly [string, string[]][] = [
      ['wp_sprint=s1', ['a', 'b', 'd', 'e']],
      ['wp_priority=p1', ['a', 'e']],
      ['wp_tag=web', ['c']],
    ];
    for (const [query, all] of cases) {
      const filter = readPeopleCard(q(query), KNOWN);
      assert.equal(peopleCardActive(filter), 1, query);
      assert.deepEqual(ids(cardTasks(SET, filter, ALL)), all, `${query} all time`);
      assert.deepEqual(ids(cardTasks(SET, filter, SEVEN)), all, `${query} 7 days`);
    }
  });

  /*
   * **The old card's Range and Statuses are not read** (LAI-817). Done work is
   * what Delivered counts and never open work; Open work now has no range. A
   * link saved with either still opens, unfiltered and not counted.
   */
  void test('"Include done" and "All tasks" are gone: an old link applies neither', () => {
    const filter = readPeopleCard(q('wp_status=all&wp_range=all'), KNOWN);
    assert.equal(peopleCardActive(filter), 0);
    assert.equal(workloadByPerson(cardTasks(SET, filter, SEVEN)).open, 4, 'open only, all of it');
  });

  void test('blocked is judged from the whole project, not the filtered few', () => {
    // y's one blocker is done — but in another sprint, so the card filters it
    // out. Judged from the filtered few it is "unknown", which counts as
    // blocked; judged from the project, y is free.
    const blocker = old({ id: 'x', status: 'done', sprint_id: 's2' });
    const held = recent({
      id: 'y',
      status: 'todo',
      assignee_id: 'ada',
      sprint_id: 's1',
      blocked_by: ['x'],
    });
    const all = [blocker, held];
    const filter = readPeopleCard(q('wp_sprint=s1'), KNOWN);
    const scoped = cardTasks(all, filter, ALL);
    assert.deepEqual(ids(scoped), ['y'], 'positive control: the blocker is filtered out');
    assert.equal(
      workloadByPerson(scoped).rows.find((r) => r.id === 'ada')?.blocked,
      1,
      'positive control: from the few, y looks blocked',
    );
    const load = workloadByPerson(scoped, (id) => id, 5, { blockedIds: blockedIdsOf(all) });
    assert.equal(load.rows.find((r) => r.id === 'ada')?.blocked, 0);
  });
});

void describe('an invalid value is ignored and not counted (LAI-487)', () => {
  void test('Status overview', () => {
    const bad =
      'so_sprint=nope&so_assignee=nobody&so_priority=p9&so_tag=-x&so_agent=yes&so_range=bogus';
    const filter = readStatusCard(q(bad), KNOWN);
    assert.equal(statusCardActive(filter), 0);
    assert.deepEqual(ids(cardTasks(SET, filter, ALL)), ids(SET));
  });

  void test('Work by person', () => {
    const filter = readPeopleCard(
      q('wp_sprint=nope&wp_priority=P1&wp_tag=a%20b&wp_status=x&wp_range=1'),
      KNOWN,
    );
    assert.equal(peopleCardActive(filter), 0);
    assert.deepEqual(ids(cardTasks(SET, filter, ALL)), ids(SET));
  });

  void test('a sprint or member not known yet is not applied until it is', () => {
    const filter = readStatusCard(q('so_sprint=s1&so_assignee=ada'), {});
    assert.equal(statusCardActive(filter), 0);
  });

  void test('the two cards read only their own prefix', () => {
    assert.equal(statusCardActive(readStatusCard(q('wp_priority=p1'), KNOWN)), 0);
    assert.equal(peopleCardActive(readPeopleCard(q('so_priority=p1'), KNOWN)), 0);
  });
});
