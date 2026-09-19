/**
 * Grouping the board by something other than its columns (LAI-266).
 *
 * Pure, so this is a real unit test. The ordering rules are the substance:
 * **Unassigned and No sprint lead**, because that is the pile somebody opened
 * the view to act on, and priority sorts `p1 → p3` rather than alphabetically.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  groupLanes,
  groupNotice,
  isGroupBy,
  isSyntheticColumn,
} from '../../../../src/routes/screens/board/group-lanes.ts';
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

const members = new Map<string, Member>([
  ['u1', { user_id: 'u1', name: 'Ada', email: 'a@e.com', role: 'lead', created_at: 1 }],
  ['u2', { user_id: 'u2', name: 'Bo', email: 'b@e.com', role: 'member', created_at: 1 }],
]);

const sprintLabels = new Map([['s1', { label: 'S1', active: true }]]);
const options = { members, sprintLabels };

void describe('isGroupBy', () => {
  void test('accepts the three real groupings and nothing else', () => {
    assert.equal(isGroupBy('assignee'), true);
    assert.equal(isGroupBy('priority'), true);
    assert.equal(isGroupBy('sprint'), true);

    // `column` is the default and is *not* a grouping — it is the board.
    assert.equal(isGroupBy('column'), false);
    assert.equal(isGroupBy(undefined), false);
    assert.equal(isGroupBy('nonsense'), false);
  });
});

void describe('by assignee', () => {
  void test('puts Unassigned first, then people by name', () => {
    // Unassigned leads deliberately: it is the pile you act on. A fixture whose
    // names already sort that way would make this vacuous, so `Ada` sorts
    // before `Bo` and both sort before nothing — the lane order proves the
    // special case rather than the alphabet.
    const lanes = groupLanes(
      [
        task({ id: '1', assignee_id: 'u2' }),
        task({ id: '2', assignee_id: null }),
        task({ id: '3', assignee_id: 'u1' }),
      ],
      'assignee',
      options,
    );

    assert.deepEqual(
      lanes.map((l) => l.column.name),
      ['Unassigned', 'Ada', 'Bo'],
    );
  });

  void test('names a person it cannot resolve rather than dropping them', () => {
    const lanes = groupLanes([task({ id: '1', assignee_id: 'ghost' })], 'assignee', options);

    assert.equal(lanes.length, 1);
    assert.equal(lanes[0]?.tasks.length, 1, 'a task must never vanish because a name is missing');
  });
});

void describe('by priority', () => {
  void test('sorts p1 before p2 before p3', () => {
    const lanes = groupLanes(
      [
        task({ id: '1', priority: 'p3' }),
        task({ id: '2', priority: 'p1' }),
        task({ id: '3', priority: 'p2' }),
      ],
      'priority',
      options,
    );

    assert.deepEqual(
      lanes.map((l) => l.column.name),
      ['P1', 'P2', 'P3'],
    );
  });
});

void describe('by sprint', () => {
  void test('puts No sprint first', () => {
    const lanes = groupLanes(
      [task({ id: '1', sprint_id: 's1' }), task({ id: '2', sprint_id: null })],
      'sprint',
      options,
    );

    assert.deepEqual(
      lanes.map((l) => l.column.name),
      ['No sprint', 'S1'],
    );
  });
});

void describe('the lanes it makes are not columns', () => {
  void test('carry no statuses, so nothing can be dropped into them', () => {
    // The load-bearing half: `primaryStatus` returns undefined for these, and
    // `KanbanView` refuses a drop it cannot resolve. A synthetic lane that
    // claimed a status would accept drops that mean something else entirely.
    const lanes = groupLanes([task({ id: '1' })], 'assignee', options);

    assert.deepEqual(lanes[0]?.column.statuses, []);
    assert.equal(lanes[0]?.column.primary_status, null);
  });

  void test('are recognisable as synthetic', () => {
    const lanes = groupLanes([task({ id: '1' })], 'assignee', options);
    assert.ok(isSyntheticColumn(lanes[0]!.column));
  });

  void test('every task still lands somewhere', () => {
    const input = [
      task({ id: '1', assignee_id: 'u1' }),
      task({ id: '2', assignee_id: null }),
      task({ id: '3', assignee_id: 'u2' }),
    ];
    const lanes = groupLanes(input, 'assignee', options);

    assert.equal(
      lanes.reduce((n, lane) => n + lane.tasks.length, 0),
      input.length,
      'grouping must not lose a task',
    );
  });

  void test('sorts within a lane the way the board does', () => {
    const lanes = groupLanes(
      [
        task({ id: '3', assignee_id: 'u1', priority: 'p3' }),
        task({ id: '1', assignee_id: 'u1', priority: 'p1' }),
        task({ id: '2', assignee_id: 'u1', priority: 'p2' }),
      ],
      'assignee',
      options,
    );

    assert.deepEqual(
      lanes[0]?.tasks.map((t) => t.id),
      ['1', '2', '3'],
    );
  });
});

void describe('the notice', () => {
  void test('names the grouping and says drag is off', () => {
    // A missing affordance with no explanation reads as a bug, which is why the
    // sentence is a requirement rather than a nicety.
    const notice = groupNotice('assignee');

    assert.match(notice, /assignee/);
    assert.match(notice, /drag is off/i);
  });
});
