/**
 * The List's row model (LAI-256).
 *
 * Every column the design colours — status, priority, age — decides here, so
 * the edges can be pinned without a browser (CONVENTIONS §4).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_SORT,
  LIST_COLUMNS,
  listRows,
  nextSort,
  pageParam,
  readPage,
  readSort,
  sortParams,
  sortRows,
  type SortKey,
} from '../../../../src/routes/screens/list/list-derive.ts';
import type { Member, Task } from '../../../../src/api/tasks.ts';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const task = (over: Partial<Task> & { id: string; key: string }): Task =>
  ({
    number: Number(over.key.split('-')[1] ?? '1'),
    project_id: 'p',
    title: 'A task',
    description_md: '',
    acceptance_md: '',
    status: 'backlog',
    priority: 'p2',
    assignee_id: null,
    created_by: 'u1',
    created_via: 'web',
    sprint_id: null,
    tags: [],
    ready: false,
    comment_count: 0,
    blocked_by: [],
    blocks: [],
    discovered_from: null,
    stale_flagged_at: null,
    created_at: 1,
    updated_at: NOW - 60_000,
    started_at: null,
    completed_at: null,
    ...over,
  }) as Task;

const members = new Map<string, Member>([
  ['u1', { user_id: 'u1', name: 'Mira Kellner', email: 'm@x', role: 'member' } as Member],
]);

const sprintLabels = new Map([['s2', { label: 'S2' }]]);

function rowsFor(tasks: readonly Task[], now = NOW) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return { rows: listRows({ tasks, byId, members, sprintLabels, now }), byId };
}

void describe('the List row', () => {
  void test('states the design’s columns, in its order, plus Created', () => {
    /*
     * **Eight, not the design's seven** (LAI-621). `Created` is an owner-asked
     * addition, not drift: the design dated a task only by when it was last
     * touched, so a row could not distinguish new work from old work someone
     * had just commented on. It sits beside `Updated` because the two are read
     * together.
     *
     * The names are asserted rather than the count, so a column appearing or
     * vanishing fails here as an edit somebody has to mean.
     */
    assert.deepEqual(
      LIST_COLUMNS.map((c) => c.label),
      ['Key', 'Summary', 'Status', 'Pri', 'Assignee', 'Spr', 'Created', 'Updated'],
    );
  });

  void test('upper-cases the priority and tones it by rank', () => {
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', priority: 'p1' }),
      task({ id: 'b', key: 'LC-2', priority: 'p2' }),
      task({ id: 'c', key: 'LC-3', priority: 'p3' }),
    ]);
    assert.deepEqual(
      rows.map((r) => `${r.priority}/${r.priorityTone}`),
      ['P1/bad', 'P2/warn', 'P3/flat'],
    );
  });

  void test('tones the status the way the design does', () => {
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', status: 'in_progress' }),
      task({ id: 'b', key: 'LC-2', status: 'done' }),
      task({ id: 'c', key: 'LC-3', status: 'backlog' }),
    ]);
    assert.deepEqual(
      rows.map((r) => r.statusTone),
      ['accent', 'good', 'flat'],
    );
    // And a finished row steps back, which is the only thing `muted` says.
    assert.deepEqual(
      rows.map((r) => r.muted),
      [false, true, false],
    );
  });

  void test('names the blocker by its key, never by its id', () => {
    const blocker = task({ id: '01J0BLOCKERULID', key: 'LC-1' });
    const blocked = task({ id: 'b', key: 'LC-6', blocked_by: [blocker.id] });
    const { rows } = rowsFor([blocker, blocked]);

    const row = rows.find((r) => r.key === 'LC-6');
    assert.ok(row !== undefined);
    assert.equal(row.blockedBy, 'blocked by LC-1');
    // The ULID must not reach the screen — the `p1 · t1` defect, one screen over.
    assert.doesNotMatch(row.blockedBy, /01J0/);
    assert.equal(row.blocked, true);
  });

  void test('claims nothing about a blocker outside the loaded page', () => {
    /*
     * `blockedState` answers `undefined` for a dependency it cannot see, and
     * says so deliberately — the API returns dependency **ids**, not their
     * statuses. The row takes `true` only, which is what the board's card does,
     * so the two views cannot show the same task differently.
     *
     * The id must not reach the screen either way.
     */
    const blocked = task({ id: 'b', key: 'LC-6', blocked_by: ['01JNOTLOADED'] });
    const { rows } = rowsFor([blocked]);
    assert.equal(rows[0]?.blocked, false, 'unknown is not drawn as blocked');
    assert.equal(rows[0]?.blockedBy, '', 'an id must never be printed as a key');
  });

  void test('ages by the clock, and ambers anything over five days', () => {
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', updated_at: NOW }),
      task({ id: 'b', key: 'LC-2', updated_at: NOW - 2 * DAY }),
      task({ id: 'c', key: 'LC-3', updated_at: NOW - 9 * DAY }),
    ]);
    assert.equal(rows[0]?.updated, 'just now');
    assert.equal(rows[0]?.updatedTone, 'accent');
    assert.equal(rows[1]?.updatedTone, 'flat');
    assert.equal(rows[2]?.updatedTone, 'warn', 'nine days is stale by the rail’s own threshold');
  });

  void test('says Unassigned rather than leaving the column blank', () => {
    const { rows } = rowsFor([task({ id: 'a', key: 'LC-1' })]);
    assert.equal(rows[0]?.who, 'Unassigned');
    assert.equal(rows[0]?.assigned, false);
    assert.equal(rows[0]?.initials, '—');
    assert.equal(rows[0]?.assigneeId, '');
  });

  void test('colours an assignee by their user id, not the row’s task id', () => {
    const { rows } = rowsFor([
      task({ id: 'task-one', key: 'LC-1', assignee_id: 'u1' }),
      task({ id: 'task-two', key: 'LC-2', assignee_id: 'u1' }),
    ]);
    // One person, two rows, one identity — the whole point of the field.
    assert.equal(rows[0]?.assigneeId, 'u1');
    assert.equal(rows[1]?.assigneeId, 'u1');
    assert.equal(rows[0]?.initials, 'MK');
  });

  void test('carries the sprint tag the board already derived', () => {
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', sprint_id: 's2' }),
      task({ id: 'b', key: 'LC-2', sprint_id: null }),
    ]);
    assert.equal(rows[0]?.sprintTag, 'S2');
    assert.equal(rows[1]?.sprintTag, '');
  });
});

void describe('sorting', () => {
  void test('orders by key numerically, so LC-10 follows LC-9', () => {
    const tasks = [
      task({ id: 'c', key: 'LC-10' }),
      task({ id: 'a', key: 'LC-2' }),
      task({ id: 'b', key: 'LC-9' }),
    ];
    const { rows, byId } = rowsFor(tasks);
    assert.deepEqual(
      sortRows(rows, byId, 'key', true).map((r) => r.key),
      ['LC-2', 'LC-9', 'LC-10'],
    );
  });

  void test('reverses on the same key', () => {
    const tasks = [task({ id: 'a', key: 'LC-1' }), task({ id: 'b', key: 'LC-2' })];
    const { rows, byId } = rowsFor(tasks);
    assert.deepEqual(
      sortRows(rows, byId, 'key', false).map((r) => r.key),
      ['LC-2', 'LC-1'],
    );
  });
});

/* ------------------------------------------------------------ LAI-485 sort */

void describe('every column sorts the way a person reads it (LAI-485)', () => {
  const sprints = new Map([
    ['sA', { label: 'S2' }],
    ['sB', { label: 'S10' }],
  ]);
  const people = new Map<string, Member>([
    ['u1', { user_id: 'u1', name: 'Zed Adams', email: 'z@x', role: 'member' } as Member],
    ['u2', { user_id: 'u2', name: 'Amy Burke', email: 'a@x', role: 'member' } as Member],
  ]);
  const tasks = [
    task({
      id: 'a',
      key: 'LC-4',
      status: 'done',
      priority: 'p3',
      assignee_id: null,
      sprint_id: null,
      title: 'beta',
      created_at: 40,
      updated_at: 400,
    }),
    task({
      id: 'b',
      key: 'LC-2',
      status: 'backlog',
      priority: 'p1',
      assignee_id: 'u1',
      sprint_id: 'sB',
      title: 'Alpha',
      created_at: 20,
      updated_at: 200,
    }),
    task({
      id: 'c',
      key: 'LC-3',
      status: 'cancelled',
      priority: 'p2',
      assignee_id: 'u2',
      sprint_id: 'sA',
      title: 'gamma',
      created_at: 30,
      updated_at: 300,
    }),
    task({
      id: 'd',
      key: 'LC-1',
      status: 'todo',
      priority: 'p1',
      assignee_id: null,
      sprint_id: 'sA',
      title: 'alpha',
      created_at: 10,
      updated_at: 100,
    }),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows = listRows({ tasks, byId, members: people, sprintLabels: sprints, now: NOW });
  const keys = (key: SortKey, ascending = true): string[] =>
    sortRows(rows, byId, key, ascending).map((r) => r.key);

  void test('key is numeric', () => {
    assert.deepEqual(keys('key'), ['LC-1', 'LC-2', 'LC-3', 'LC-4']);
  });

  void test('title ignores case, and ties break by key', () => {
    // "Alpha" and "alpha" tie; LC-1 before LC-2 by key.
    assert.deepEqual(keys('title'), ['LC-1', 'LC-2', 'LC-4', 'LC-3']);
  });

  void test('status is the workflow, not the alphabet', () => {
    // Alphabetical would be backlog, cancelled, done, todo.
    assert.deepEqual(keys('status'), ['LC-2', 'LC-1', 'LC-4', 'LC-3']);
  });

  void test('priority p1 first, and ties break by key', () => {
    assert.deepEqual(keys('priority'), ['LC-1', 'LC-2', 'LC-3', 'LC-4']);
  });

  void test('Unassigned sorts after every name when ascending', () => {
    // Amy, Zed, then the two unassigned by key.
    assert.deepEqual(keys('assignee'), ['LC-3', 'LC-2', 'LC-1', 'LC-4']);
  });

  void test('sprints sort by number — S2 before S10 — and no sprint last', () => {
    assert.deepEqual(keys('sprint'), ['LC-1', 'LC-3', 'LC-2', 'LC-4']);
  });

  void test('created and updated sort by the stamp; descending is newest first', () => {
    assert.deepEqual(keys('created'), ['LC-1', 'LC-2', 'LC-3', 'LC-4']);
    assert.deepEqual(keys('updated', false), ['LC-4', 'LC-3', 'LC-2', 'LC-1']);
  });

  void test('ties break by key ascending whatever the direction', () => {
    // LC-1 and LC-2 are both p1: descending by priority still lists them 1, 2.
    const desc = keys('priority', false);
    assert.deepEqual(desc.slice(-2), ['LC-1', 'LC-2']);
  });
});

void describe('the sort in the URL (LAI-485, D-065)', () => {
  const q = (s: string) => new URLSearchParams(s);

  void test('no params is newest-updated first', () => {
    assert.deepEqual(readSort(q('')), { key: 'updated', ascending: false });
    assert.deepEqual(DEFAULT_SORT, { key: 'updated', ascending: false });
  });

  void test('the default is never written; anything else is', () => {
    assert.deepEqual(sortParams(DEFAULT_SORT), { sort: undefined, dir: undefined });
    assert.deepEqual(sortParams({ key: 'updated', ascending: true }), {
      sort: 'updated',
      dir: 'asc',
    });
    assert.deepEqual(sortParams({ key: 'key', ascending: true }), { sort: 'key', dir: 'asc' });
  });

  void test('a written sort reads back as itself', () => {
    for (const key of LIST_COLUMNS.map((c) => c.key)) {
      for (const ascending of [true, false]) {
        const p = sortParams({ key, ascending });
        const back = readSort(
          q(
            new URLSearchParams(
              Object.entries(p).filter(([, v]) => v !== undefined) as [string, string][],
            ).toString(),
          ),
        );
        assert.deepEqual(
          back,
          { key, ascending },
          `${key} ${String(ascending)} did not round-trip`,
        );
      }
    }
  });

  void test('the URL is untrusted: junk is the default, never a throw', () => {
    assert.deepEqual(readSort(q('sort=bogus&dir=asc')), DEFAULT_SORT);
    assert.deepEqual(readSort(q('dir=asc')), DEFAULT_SORT, 'a dir with no sort');
    assert.deepEqual(readSort(q('sort=__proto__')), DEFAULT_SORT);
  });

  void test('a known sort with a bad or missing dir starts the column its own way', () => {
    assert.deepEqual(readSort(q('sort=key&dir=sideways')), { key: 'key', ascending: true });
    assert.deepEqual(readSort(q('sort=created')), { key: 'created', ascending: false });
  });

  void test('first click: dates start newest first, everything else A to Z; a second click flips', () => {
    assert.deepEqual(nextSort(DEFAULT_SORT, 'created'), { key: 'created', ascending: false });
    assert.deepEqual(nextSort(DEFAULT_SORT, 'title'), { key: 'title', ascending: true });
    assert.deepEqual(nextSort({ key: 'title', ascending: true }, 'title'), {
      key: 'title',
      ascending: false,
    });
    assert.deepEqual(nextSort(DEFAULT_SORT, 'updated'), { key: 'updated', ascending: true });
  });

  void test('page is 1-based in the URL, omitted on page one, and junk is page one', () => {
    assert.equal(readPage(q('')), 0);
    assert.equal(readPage(q('page=3')), 2);
    assert.equal(readPage(q('page=0')), 0);
    assert.equal(readPage(q('page=-2')), 0);
    assert.equal(readPage(q('page=two')), 0);
    assert.equal(pageParam(0), undefined);
    assert.equal(pageParam(2), '3');
  });
});
