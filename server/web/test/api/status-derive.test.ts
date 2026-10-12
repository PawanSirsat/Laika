import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  defaultMoveTarget,
  deleteBlockedReason,
  fullOrder,
  hiddenColumns,
  laneStatusId,
  nextColumnName,
  visibleColumns,
  withStatus,
} from '../../src/api/status-derive.ts';
import type { ProjectStatus } from '../../src/api/statuses.ts';
import type { Task } from '../../src/api/tasks.ts';

function s(
  id: string,
  category: ProjectStatus['category'],
  position: number,
  over: Partial<ProjectStatus> = {},
): ProjectStatus {
  return {
    id,
    project_id: 'p',
    name: id,
    category,
    position,
    hidden: false,
    created_at: 1,
    task_count: 0,
    ...over,
  };
}

const BOARD: readonly ProjectStatus[] = [
  s('Backlog', 'backlog', 0),
  s('To do', 'todo', 1),
  s('Doing', 'in_progress', 2),
  s('QA', 'review', 3),
  s('Code review', 'review', 4),
  s('Done', 'done', 5),
  s('Cancelled', 'cancelled', 6, { hidden: true }),
];

function t(over: Partial<Task>): Task {
  return { id: 't', status: 'todo', status_id: 'To do', status_name: 'To do', ...over } as Task;
}

void describe('which columns the board draws', () => {
  void test('every visible status, in position order — an empty one included', () => {
    const shuffled = [BOARD[3]!, BOARD[0]!, BOARD[6]!, BOARD[5]!, BOARD[1]!, BOARD[2]!, BOARD[4]!];
    assert.deepEqual(
      visibleColumns(shuffled).map((c) => c.id),
      ['Backlog', 'To do', 'Doing', 'QA', 'Code review', 'Done'],
    );
  });

  void test('hidden ones are listed apart, so they can be shown again', () => {
    assert.deepEqual(
      hiddenColumns(BOARD).map((c) => c.id),
      ['Cancelled'],
    );
  });
});

void describe('which lane a card sits in', () => {
  void test('its own status, when the board has it', () => {
    assert.equal(
      laneStatusId(t({ status: 'review', status_id: 'Code review' }), BOARD),
      'Code review',
    );
  });

  void test('a status the board does not know yet falls back to the first of its kind', () => {
    // A status created a moment ago in another tab, before the frame arrives.
    assert.equal(laneStatusId(t({ status: 'review', status_id: 'brand-new' }), BOARD), 'QA');
  });

  void test('a card in a hidden column is filed there, so the board draws it nowhere', () => {
    const lane = laneStatusId(t({ status: 'cancelled', status_id: 'Cancelled' }), BOARD);
    assert.equal(lane, 'Cancelled');
    assert.ok(!visibleColumns(BOARD).some((c) => c.id === lane));
  });
});

void describe('deleting a column', () => {
  void test('the last column of its kind cannot go, and says why in plain words', () => {
    const reason = deleteBlockedReason(BOARD[2]!, BOARD);
    assert.ok(reason !== undefined);
    assert.match(reason, /only/i);
    assert.match(reason, /in progress/i);
    assert.doesNotMatch(reason, /category|status/i, 'no jargon in the reason');
  });

  void test('one of two of a kind can go', () => {
    assert.equal(deleteBlockedReason(BOARD[3]!, BOARD), undefined);
  });

  void test('its tasks go to another column of the same kind by default', () => {
    assert.equal(defaultMoveTarget(BOARD[3]!, BOARD)?.id, 'Code review');
  });

  void test('with no sibling of its kind, the first other column', () => {
    const two = [s('A', 'todo', 0), s('B', 'done', 1)];
    assert.equal(defaultMoveTarget(two[1]!, two)?.id, 'A');
  });
});

void describe('reordering', () => {
  void test('the visible order is placed around the hidden columns, every id once', () => {
    const board = [
      s('a', 'todo', 0),
      s('h', 'cancelled', 1, { hidden: true }),
      s('b', 'in_progress', 2),
      s('c', 'done', 3),
    ];
    // The reader dragged c to the front of the visible three.
    assert.deepEqual(fullOrder(board, ['c', 'a', 'b']), ['c', 'h', 'a', 'b']);
  });

  void test('an id the board does not hold is dropped rather than sent', () => {
    const board = [s('a', 'todo', 0), s('b', 'done', 1)];
    assert.deepEqual(fullOrder(board, ['b', 'zz', 'a']), ['b', 'a']);
  });
});

void describe('a new column', () => {
  void test('gets a name nobody has, case-insensitively', () => {
    assert.equal(
      nextColumnName([s('New column', 'todo', 0), s('new column 2', 'todo', 1)]),
      'New column 3',
    );
    assert.equal(nextColumnName([]), 'New column');
  });
});

void describe('a card moved optimistically', () => {
  void test('takes the column’s id, name and kind together', () => {
    const moved = withStatus(t({}), BOARD[4]!);
    assert.equal(moved.status_id, 'Code review');
    assert.equal(moved.status_name, 'Code review');
    assert.equal(moved.status, 'review');
  });
});
