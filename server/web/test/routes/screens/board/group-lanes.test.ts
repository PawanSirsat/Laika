/**
 * Grouping the board into swimlanes (LAI-290).
 *
 * **The assertion that carries this file is the column count**, because it is
 * the one LAI-266's implementation failed: grouping used to return one lane per
 * group, deleting the status columns. A grouped board has *n groups × the same
 * columns*, and nothing else here matters as much.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  groupNotice,
  groupSwimlanes,
  isGroupBy,
} from '../../../../src/routes/screens/board/group-lanes.ts';
import type { BoardColumn } from '../../../../src/api/columns.ts';
import type { Member, Task } from '../../../../src/api/tasks.ts';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LAI-${over.id}`,
    project_id: 'p',
    number: Number(over.id.replace(/\D/g, '')) || 1,
    title: 'A task',
    description_md: null,
    acceptance_md: null,
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    ready: false,
    blocked_by: [],
    blocks: [],
    tags: [],
    comment_count: 0,
    branch: null,
    external_ref: null,
    started_at: null,
    completed_at: null,
    stale_flagged_at: null,
    created_at: 1,
    updated_at: 1,
    ...over,
  } as Task;
}

function col(id: string, statuses: string[], position: number): BoardColumn {
  return {
    id,
    project_id: 'p',
    name: id,
    position,
    hidden: false,
    statuses: statuses as BoardColumn['statuses'],
    primary_status: (statuses[0] ?? null) as BoardColumn['primary_status'],
  };
}

const COLUMNS: BoardColumn[] = [
  col('todo', ['todo', 'backlog'], 0),
  col('wip', ['in_progress'], 1),
  col('review', ['review'], 2),
  col('done', ['done'], 3),
];

const members = new Map<string, Member>([
  ['u1', { user_id: 'u1', name: 'Ada', email: 'a@e.com', role: 'lead', created_at: 1 }],
  ['u2', { user_id: 'u2', name: 'Bo', email: 'b@e.com', role: 'member', created_at: 1 }],
]);

const options = { members, sprintLabels: new Map([['s1', { label: 'S1', active: true }]]) };

void describe('isGroupBy', () => {
  void test('accepts the three groupings and nothing else', () => {
    assert.equal(isGroupBy('assignee'), true);
    assert.equal(isGroupBy('priority'), true);
    assert.equal(isGroupBy('sprint'), true);

    // `column` is the default — it is the board, not a grouping of it.
    assert.equal(isGroupBy('column'), false);
    assert.equal(isGroupBy(undefined), false);
    assert.equal(isGroupBy('nonsense'), false);
  });
});

void describe('every swimlane holds the whole board', () => {
  void test('each row has the project’s columns, not one column per group', () => {
    /*
     * **This is the test LAI-266 would have failed.** Its grouping returned one
     * lane per assignee, so a two-person board had two lanes and no statuses.
     */
    const lanes = groupSwimlanes(
      [
        task({ id: '1', assignee_id: 'u1', status: 'todo' }),
        task({ id: '2', assignee_id: 'u2', status: 'done' }),
      ],
      'assignee',
      COLUMNS,
      options,
    );

    assert.equal(lanes.length, 2, 'one row per person');
    for (const lane of lanes) {
      assert.equal(lane.lanes.length, COLUMNS.length, `${lane.name} lost the columns`);
      assert.deepEqual(
        lane.lanes.map((l) => l.column.id),
        COLUMNS.map((c) => c.id),
        `${lane.name} has different columns from the board`,
      );
    }
  });

  void test('a card lands in its own row and its own column', () => {
    const lanes = groupSwimlanes(
      [task({ id: '1', assignee_id: 'u1', status: 'done' })],
      'assignee',
      COLUMNS,
      options,
    );

    const done = lanes[0]?.lanes.find((l) => l.column.id === 'done');
    assert.deepEqual(
      done?.tasks.map((t) => t.id),
      ['1'],
    );
    // And nowhere else.
    assert.equal(
      lanes[0]?.lanes.reduce((n, l) => n + l.tasks.length, 0),
      1,
    );
  });

  void test('the header count is the row’s cards across every column', () => {
    const lanes = groupSwimlanes(
      [
        task({ id: '1', assignee_id: 'u1', status: 'todo' }),
        task({ id: '2', assignee_id: 'u1', status: 'done' }),
        task({ id: '3', assignee_id: 'u1', status: 'review' }),
      ],
      'assignee',
      COLUMNS,
      options,
    );

    assert.equal(lanes[0]?.count, 3);
  });

  void test('a status no column claims is drawn nowhere, in any row', () => {
    // `cancelled` sits in the hidden column, so it reaches the board unclaimed.
    const lanes = groupSwimlanes(
      [
        task({ id: '1', assignee_id: 'u1', status: 'cancelled' }),
        task({ id: '2', assignee_id: 'u1', status: 'todo' }),
      ],
      'assignee',
      COLUMNS,
      options,
    );

    assert.equal(
      lanes[0]?.lanes.reduce((n, l) => n + l.tasks.length, 0),
      1,
      'an unclaimed status was drawn',
    );
    // The header still counts it, because it is the person's work either way.
    assert.equal(lanes[0]?.count, 2);
  });

  void test('a group with no cards does not get a row', () => {
    // Bo has nothing; a board grouped by assignee should not draw a row for
    // everyone in the org who happens to be idle.
    const lanes = groupSwimlanes(
      [task({ id: '1', assignee_id: 'u1' })],
      'assignee',
      COLUMNS,
      options,
    );

    assert.deepEqual(
      lanes.map((l) => l.name),
      ['Ada'],
    );
  });
});

void describe('row order', () => {
  void test('Unassigned leads, then people by name', () => {
    // Unassigned first deliberately: it is the pile you act on. `Ada` sorts
    // before `Bo` anyway, so the lead is what proves the special case.
    const lanes = groupSwimlanes(
      [
        task({ id: '1', assignee_id: 'u2' }),
        task({ id: '2', assignee_id: null }),
        task({ id: '3', assignee_id: 'u1' }),
      ],
      'assignee',
      COLUMNS,
      options,
    );

    assert.deepEqual(
      lanes.map((l) => l.name),
      ['Unassigned', 'Ada', 'Bo'],
    );
  });

  void test('priority sorts p1 → p3, not alphabetically by label', () => {
    const lanes = groupSwimlanes(
      [
        task({ id: '1', priority: 'p3' }),
        task({ id: '2', priority: 'p1' }),
        task({ id: '3', priority: 'p2' }),
      ],
      'priority',
      COLUMNS,
      options,
    );

    assert.deepEqual(
      lanes.map((l) => l.name),
      ['P1', 'P2', 'P3'],
    );
  });

  void test('No sprint leads', () => {
    const lanes = groupSwimlanes(
      [task({ id: '1', sprint_id: 's1' }), task({ id: '2', sprint_id: null })],
      'sprint',
      COLUMNS,
      options,
    );

    assert.deepEqual(
      lanes.map((l) => l.name),
      ['No sprint', 'S1'],
    );
  });
});

void describe('rows carry what the header needs', () => {
  void test('an assignee row carries the id the avatar is drawn from', () => {
    const lanes = groupSwimlanes(
      [task({ id: '1', assignee_id: 'u1' }), task({ id: '2', assignee_id: null })],
      'assignee',
      COLUMNS,
      options,
    );

    assert.equal(lanes.find((l) => l.name === 'Ada')?.avatarId, 'u1');
    // Nobody to draw for Unassigned, and inventing one would be a face that
    // belongs to no account.
    assert.equal(lanes.find((l) => l.name === 'Unassigned')?.avatarId, undefined);
  });

  void test('priority and sprint rows carry no avatar', () => {
    for (const by of ['priority', 'sprint'] as const) {
      const lanes = groupSwimlanes([task({ id: '1' })], by, COLUMNS, options);
      assert.equal(lanes[0]?.avatarId, undefined, by);
    }
  });

  void test('a person the board cannot name still gets a row', () => {
    const lanes = groupSwimlanes(
      [task({ id: '1', assignee_id: 'ghost' })],
      'assignee',
      COLUMNS,
      options,
    );

    assert.equal(lanes.length, 1, 'a task must never vanish because a name is missing');
    assert.equal(lanes[0]?.count, 1);
  });

  void test('keys are stable and distinguish Unassigned from a user', () => {
    const lanes = groupSwimlanes(
      [task({ id: '1', assignee_id: null }), task({ id: '2', assignee_id: 'u1' })],
      'assignee',
      COLUMNS,
      options,
    );

    // The key is what collapse state is stored against, so it must not be the
    // display name — renaming a person would silently expand their row.
    assert.deepEqual(
      lanes.map((l) => l.key),
      ['', 'u1'],
    );
  });
});

void describe('the notice', () => {
  void test('says cards still move between columns', () => {
    // LAI-266 said "drag is off", which is no longer true: only dragging
    // *between rows* is. A notice that overstates it teaches people not to try.
    const notice = groupNotice('assignee');

    assert.match(notice, /assignee/);
    assert.match(notice, /between columns/i);
  });
});
