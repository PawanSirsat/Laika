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
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
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
  void test('states the design’s columns, in its order, plus Created and Due', () => {
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
      // `Due` joined them with D-066: the plan beside the two actuals. The
      // size with D-085, beside the priority it is not, called `Effort` since
      // LAI-785. The selected agent with LAI-538, beside the person and never
      // in their column.
      [
        'Key',
        'Summary',
        'Status',
        'Pri',
        'Effort',
        'Assignee',
        'Agent',
        'Spr',
        'Due',
        'Created',
        'Updated',
      ],
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

  void test('ages read as moments, and fresh work takes the accent (LAI-486)', () => {
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', updated_at: NOW }),
      task({ id: 'b', key: 'LC-2', updated_at: NOW - 59 * 60_000 }),
      task({ id: 'c', key: 'LC-3', updated_at: NOW - 2 * DAY }),
    ]);
    assert.equal(rows[0]?.updated.text, 'just now');
    assert.equal(rows[0]?.updatedTone, 'accent');
    assert.equal(rows[1]?.updated.text, '59 min ago');
    assert.equal(rows[1]?.updatedTone, 'accent', 'under an hour is fresh');
    assert.equal(rows[2]?.updatedTone, 'flat');
  });

  /*
   * **Amber is the server's stale flag** (D-092 item 4, LAI-832) — the one
   * rule the Dashboard and the Activity tab read. It was this screen's own
   * "five days without a change", which on OnRoute called 266 tasks stale
   * where the server's job flagged 7.
   */
  void test('amber is open work the server flagged stale — never quiet alone, never finished', () => {
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', status: 'in_progress', stale_flagged_at: NOW - DAY }),
      // A flagged task touched an hour ago — a sprint move — is still stale.
      task({
        id: 'b',
        key: 'LC-2',
        status: 'in_progress',
        stale_flagged_at: NOW - DAY,
        updated_at: NOW - 2 * 3_600_000,
      }),
      task({ id: 'c', key: 'LC-3', status: 'todo', updated_at: NOW - 9 * DAY }),
      // Flagged, then finished before the job's next run cleared it.
      task({
        id: 'd',
        key: 'LC-4',
        status: 'done',
        stale_flagged_at: NOW - DAY,
        updated_at: NOW - 9 * DAY,
      }),
      task({
        id: 'e',
        key: 'LC-5',
        status: 'cancelled',
        stale_flagged_at: NOW - DAY,
        updated_at: NOW - 9 * DAY,
      }),
    ]);
    assert.equal(rows[0]?.updatedTone, 'warn', 'flagged open work is stale');
    assert.equal(rows[1]?.updatedTone, 'warn', 'a touch does not clear the server’s flag');
    assert.equal(rows[2]?.updatedTone, 'flat', 'nine quiet days, never flagged, is not stale');
    assert.equal(rows[3]?.updatedTone, 'flat', 'a finished task is not neglected');
    assert.equal(rows[4]?.updatedTone, 'flat', 'a cancelled task is not neglected');
    assert.equal(rows[0]?.updatedNote, 'flagged stale 1d ago');
    assert.equal(rows[2]?.updatedNote, '', 'nothing to say about work the job did not flag');
  });

  void test('the flag outranks the accent: a minute-old touch does not make stale work fresh', () => {
    // `updated_at` a minute ago is the fixture's default. Before the server's
    // rule the two could not meet — five quiet days is never under an hour.
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', status: 'in_progress', stale_flagged_at: NOW - DAY }),
      task({ id: 'b', key: 'LC-2', status: 'in_progress' }),
    ]);
    assert.equal(rows[0]?.updatedTone, 'warn');
    assert.equal(rows[1]?.updatedTone, 'accent', 'positive control: unflagged, it is fresh');
  });

  void test('CREATED is never amber: old is not the same as quiet (LAI-486)', () => {
    const { rows } = rowsFor([
      task({ id: 'a', key: 'LC-1', status: 'todo', created_at: NOW - 90 * DAY, updated_at: NOW }),
    ]);
    assert.equal(rows[0]?.createdTone, 'flat');
    assert.match(rows[0]?.created.text ?? '', /^[0-9]{1,2} [A-Z][a-z]{2}/, 'ninety days is a date');
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

void describe('the Agent column (LAI-538)', () => {
  const agent = (id: string, device: string) => ({
    id,
    display_name: device,
    harness: 'claude-code',
    device_label: device,
    status: 'active' as const,
    owner: { id: 'u1', name: 'Ada Lovelace' },
  });
  const tasks = [
    task({ id: 'a', key: 'LC-1' }),
    task({ id: 'b', key: 'LC-2', selected_agent: agent('ag2', 'laptop-2') }),
    task({ id: 'c', key: 'LC-3', selected_agent: agent('ag1', 'desktop-1') }),
  ];

  void test('names the agent in its own column and leaves the assignee alone', () => {
    const { rows } = rowsFor(tasks);
    const row = rows.find((r) => r.key === 'LC-2');
    assert.equal(row?.agentLabel, 'Claude Code · laptop-2');
    assert.equal(row?.who, 'Unassigned', 'an agent was counted as the assignee');
    assert.equal(rows.find((r) => r.key === 'LC-1')?.agent, null);
  });

  void test('sorts by label, no agent last in both directions', () => {
    const { rows, byId } = rowsFor(tasks);
    assert.deepEqual(
      sortRows(rows, byId, 'agent', true).map((r) => r.key),
      ['LC-3', 'LC-2', 'LC-1'],
    );
    assert.deepEqual(
      sortRows(rows, byId, 'agent', false).map((r) => r.key),
      ['LC-2', 'LC-3', 'LC-1'],
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

  void test('`sort=size` still names the Effort column: an old address keeps working (LAI-785)', () => {
    assert.deepEqual(readSort(q('sort=size&dir=desc')), { key: 'size', ascending: false });
    assert.equal(LIST_COLUMNS.find((c) => c.key === 'size')?.label, 'Effort');
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

void describe('the STATUS cell speaks the project’s status names (LAI-739)', () => {
  const tasks = [
    task({ id: 'r', key: 'LC-1', status: 'review', status_id: 's-qa', status_name: 'QA' }),
    task({ id: 'b', key: 'LC-2', status: 'backlog', status_id: 's-ideas', status_name: 'Ideas' }),
    task({ id: 't', key: 'LC-3', status: 'review', status_id: 's-cr', status_name: 'Code review' }),
    task({ id: 'x', key: 'LC-4', status: 'todo', status_id: 's-new', status_name: 'Brand new' }),
  ];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const status = (s: string, name: string, category: Task['status'], position: number) => ({
    id: s,
    project_id: 'p',
    name,
    category,
    position,
    hidden: false,
    created_at: 0,
    task_count: 0,
  });
  const statuses = [
    status('s-ideas', 'Ideas', 'backlog', 0),
    // Renamed since the tasks were read: the List says the new name.
    status('s-cr', 'Peer review', 'review', 1),
    status('s-qa', 'QA', 'review', 2),
  ];
  const rows = listRows({ tasks, byId, members, sprintLabels, now: NOW, statuses });
  const cell = (key: string) => rows.find((r) => r.key === key)?.status;

  void test('names the status as the project calls it now', () => {
    assert.equal(cell('LC-1'), 'QA');
    assert.equal(cell('LC-3'), 'Peer review', 'a renamed column still reads its old name');
  });

  void test('a status the List has not loaded reads as the task says', () => {
    assert.equal(cell('LC-4'), 'Brand new');
  });

  void test('sorting by status follows the board’s column order, never the label or the kind', () => {
    // Alphabetically: Brand new, Ideas, Peer review, QA. By kind: Ideas,
    // Brand new, then the two reviews tied. By the board: Ideas, Peer review,
    // QA, and the unknown one last.
    const order = sortRows(rows, byId, 'status', true).map((r) => r.key);
    assert.deepEqual(order, ['LC-2', 'LC-3', 'LC-1', 'LC-4']);
  });
});

void describe('subtasks and the due date on a row (D-066)', () => {
  const JUL_12 = Date.UTC(2026, 6, 12);

  void test('names the parent by its key, never by its id, and says nothing for a top-level task', () => {
    const parent = task({ id: '01J0PARENT', key: 'LC-1' });
    const child = task({ id: '01J0CHILD', key: 'LC-2', parent_task_id: '01J0PARENT' });
    const { rows } = rowsFor([parent, child]);

    assert.equal(rows[1]?.parentKey, '↳ LC-1');
    assert.doesNotMatch(rows[1]?.parentKey ?? '', /01J0/);
    assert.equal(rows[0]?.parentKey, '');
  });

  void test('a parent outside the loaded page is still a subtask, marked `↳ …`', () => {
    const child = task({ id: 'c', key: 'LC-2', parent_task_id: 'elsewhere' });
    assert.equal(rowsFor([child]).rows[0]?.parentKey, '↳ …');
  });

  void test('the due date reads as a date, and is bad only while open and past', () => {
    const open = task({ id: 'a', key: 'LC-1', due_on: JUL_12, status: 'in_progress' });
    const done = task({ id: 'b', key: 'LC-2', due_on: JUL_12, status: 'done' });
    const none = task({ id: 'c', key: 'LC-3' });
    const { rows } = rowsFor([open, done, none], JUL_12 + 3 * DAY);

    assert.equal(rows[0]?.due, '12 Jul 2026');
    assert.equal(rows[0]?.dueTone, 'bad');
    assert.equal(rows[1]?.dueTone, 'flat', 'finished late is finished');
    assert.equal(rows[2]?.due, '');
    // Not yet due: the date shows, plainly.
    assert.equal(rowsFor([open], JUL_12 - DAY).rows[0]?.dueTone, 'flat');
  });

  void test('sorts by due with undated work last, whichever way the arrow points', () => {
    const late = task({ id: 'a', key: 'LC-1', due_on: JUL_12 + 5 * DAY });
    const soon = task({ id: 'b', key: 'LC-2', due_on: JUL_12 });
    const none = task({ id: 'c', key: 'LC-3' });
    const { rows, byId } = rowsFor([late, soon, none]);

    const asc = sortRows(rows, byId, 'due', true).map((r) => r.key);
    assert.deepEqual(asc, ['LC-2', 'LC-1', 'LC-3']);
    const desc = sortRows(rows, byId, 'due', false).map((r) => r.key);
    assert.deepEqual(desc, ['LC-1', 'LC-2', 'LC-3'], 'undated rows sort last both ways');
  });

  void test('sorts by size — level, then weight — with unsized work last either way (D-085)', () => {
    const size = (level: 'XS' | 'M' | 'L' | 'XL', weight: number, overridden = false) => ({
      level,
      computed: overridden ? ('M' as const) : level,
      overridden,
      weight,
      build_p50_ms: null,
      build_p80_ms: null,
      subtasks: 0,
    });
    const big = task({ id: 'a', key: 'LC-1', size: size('L', 2.5) });
    const small = task({ id: 'b', key: 'LC-2', size: size('XS', 0.2) });
    const none = task({ id: 'c', key: 'LC-3' });
    const typical = task({ id: 'd', key: 'LC-4', size: size('M', 1.1) });
    // A person said XL about a task Laika computed as M: it sorts as XL.
    const said = task({ id: 'e', key: 'LC-5', size: size('XL', 1.1, true) });
    const { rows, byId } = rowsFor([big, small, none, typical, said]);

    assert.deepEqual(
      sortRows(rows, byId, 'size', true).map((r) => r.key),
      ['LC-2', 'LC-4', 'LC-1', 'LC-5', 'LC-3'],
    );
    assert.deepEqual(
      sortRows(rows, byId, 'size', false).map((r) => r.key),
      ['LC-5', 'LC-1', 'LC-4', 'LC-2', 'LC-3'],
      'unsized rows sort last both ways',
    );
    assert.equal(rows.find((r) => r.key === 'LC-5')?.size?.level, 'XL');
    assert.equal(rows.find((r) => r.key === 'LC-3')?.size, null);
  });

  void test('Due is a column, between Spr and Created', () => {
    const keys = LIST_COLUMNS.map((c) => c.key);
    assert.deepEqual(keys.slice(keys.indexOf('sprint'), keys.indexOf('created') + 1), [
      'sprint',
      'due',
      'created',
    ]);
  });
});
