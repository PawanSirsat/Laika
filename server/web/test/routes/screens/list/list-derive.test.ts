/**
 * The List's row model (LAI-256).
 *
 * Every column the design colours — status, priority, age — decides here, so
 * the edges can be pinned without a browser (CONVENTIONS §4).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  LIST_COLUMNS,
  listRows,
  sortRows,
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
  void test('states the design’s seven columns, in its order', () => {
    assert.deepEqual(
      LIST_COLUMNS.map((c) => c.label),
      ['Key', 'Summary', 'Status', 'Pri', 'Assignee', 'Spr', 'Updated'],
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
