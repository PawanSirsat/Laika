/**
 * `src/api/board-derive.ts` (LAI-049).
 *
 * Pure, so these are real unit tests. The interesting one is `blockedState`:
 * the API returns dependency **ids** without their statuses, so blocked-ness is
 * resolved against the tasks actually loaded — and the case that matters is the
 * one it cannot resolve.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALL_STATUSES,
  blockedState,
  blockers,
  boardStatusLabel,
  byIdIndex,
  dropNeighbours,
  groupByColumn,
  hideOldDone,
  staleFor,
} from '../../src/api/board-derive.ts';
import type { BoardColumn } from '../../src/api/columns.ts';
import type { Task, TaskStatus } from '../../src/api/tasks.ts';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LAI-${over.id}`,
    project_id: 'p',
    number: Number(over.id.replace(/\D/g, '')) || 1,
    title: 'A task',
    description_md: null,
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    created_by: 'u',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    ready: false,
    stale_flagged_at: null,
    position: null,
    blocked_by: [],
    tags: [],
    acceptance_md: null,
    blocks: [],
    comment_count: 0,
    started_at: null,
    completed_at: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

void describe('blockedState', () => {
  void test('no blocked_by is never blocked', () => {
    const t = task({ id: '1' });
    assert.equal(blockedState(t, byIdIndex([t])), false);
  });

  void test('an unfinished dependency blocks', () => {
    const dep = task({ id: '2', status: 'in_progress' });
    const t = task({ id: '1', blocked_by: ['2'] });
    assert.equal(blockedState(t, byIdIndex([t, dep])), true);
  });

  void test('done and cancelled blocked_by do not block', () => {
    const done = task({ id: '2', status: 'done' });
    const cancelled = task({ id: '3', status: 'cancelled' });
    const t = task({ id: '1', blocked_by: ['2', '3'] });
    assert.equal(blockedState(t, byIdIndex([t, done, cancelled])), false);
  });

  void test('one unfinished dependency among finished ones still blocks', () => {
    const done = task({ id: '2', status: 'done' });
    const open = task({ id: '3', status: 'backlog' });
    const t = task({ id: '1', blocked_by: ['2', '3'] });
    assert.equal(blockedState(t, byIdIndex([t, done, open])), true);
  });

  void test('an unresolvable dependency is undefined, not false', () => {
    // Guessing `false` would draw an unblocked card over a blocked task and
    // invite someone to start work that cannot proceed. Saying "unknown" is the
    // honest answer and the UI renders it as such.
    const t = task({ id: '1', blocked_by: ['missing'] });
    assert.equal(blockedState(t, byIdIndex([t])), undefined);
  });

  void test('a known blocker wins over an unknown one', () => {
    // If anything is definitely unfinished, the task is definitely blocked —
    // no need to hedge.
    const open = task({ id: '2', status: 'todo' });
    const t = task({ id: '1', blocked_by: ['2', 'missing'] });
    assert.equal(blockedState(t, byIdIndex([t, open])), true);
  });
});

void describe('groupByColumn (LAI-266)', () => {
  const col = (over: Partial<BoardColumn> & { id: string; statuses: string[] }): BoardColumn => ({
    project_id: 'p',
    name: over.id,
    position: 0,
    hidden: false,
    primary_status: over.statuses[0] ?? null,
    ...over,
    statuses: over.statuses,
  });

  const DEFAULT: BoardColumn[] = [
    col({ id: 'todo', statuses: ['todo', 'backlog'], position: 0 }),
    col({ id: 'wip', statuses: ['in_progress'], position: 1 }),
    col({ id: 'review', statuses: ['review'], position: 2 }),
    col({ id: 'done', statuses: ['done'], position: 3 }),
  ];

  void test('draws one lane per column, even when empty', () => {
    const lanes = groupByColumn([], DEFAULT);
    assert.deepEqual(
      lanes.map((l) => l.column.id),
      ['todo', 'wip', 'review', 'done'],
    );
  });

  void test('orders lanes by position, not by the order they arrived in', () => {
    // The fixture arrives shuffled on purpose: a function that simply returned
    // its input would pass a pre-sorted fixture and fail this one.
    const lanes = groupByColumn([], [DEFAULT[3]!, DEFAULT[0]!, DEFAULT[2]!, DEFAULT[1]!]);
    assert.deepEqual(
      lanes.map((l) => l.column.id),
      ['todo', 'wip', 'review', 'done'],
    );
  });

  void test('a multi-status column collects every status it lists', () => {
    const lanes = groupByColumn(
      [task({ id: '1', status: 'backlog' }), task({ id: '2', status: 'todo' })],
      DEFAULT,
    );
    assert.deepEqual(
      lanes[0]?.tasks.map((t) => t.id),
      ['1', '2'],
    );
  });

  void test('a status no column lists is drawn nowhere', () => {
    // `cancelled` is in the hidden column, so it reaches the board as unlisted —
    // which is how it disappeared before columns existed. The fixture contains
    // one, or the assertion would be vacuous.
    const lanes = groupByColumn(
      [task({ id: '1', status: 'cancelled' }), task({ id: '2', status: 'todo' })],
      DEFAULT,
    );
    assert.equal(lanes.flatMap((l) => l.tasks).length, 1);
  });

  void test('a status a column does list is drawn, cancelled included', () => {
    // The other value of the same property: it disappears because nobody claims
    // it, not because it is special-cased.
    const lanes = groupByColumn(
      [task({ id: '1', status: 'cancelled' })],
      [col({ id: 'bin', statuses: ['cancelled'] })],
    );
    assert.equal(lanes[0]?.tasks.length, 1);
  });

  void test('a status two columns claim files once, into the earlier lane', () => {
    const lanes = groupByColumn(
      [task({ id: '1', status: 'review' })],
      [
        col({ id: 'first', statuses: ['review'], position: 0 }),
        col({ id: 'second', statuses: ['review'], position: 1 }),
      ],
    );
    assert.equal(lanes.flatMap((l) => l.tasks).length, 1, 'never drawn twice');
    assert.equal(lanes[0]?.tasks.length, 1);
    assert.equal(lanes[1]?.tasks.length, 0);
  });

  void test('draws each lane in the project’s manual order, not by priority (LAI-473, D-070)', () => {
    // Position order and priority order disagree here, or this could not tell
    // the two apart. The board sorted by priority until LAI-473, which would
    // have ignored every stored order and snapped every drop back.
    const lanes = groupByColumn(
      [
        task({ id: '1', status: 'todo', priority: 'p1', position: 'a2' }),
        task({ id: '2', status: 'todo', priority: 'p3', position: 'a0' }),
        task({ id: '3', status: 'todo', priority: 'p2', position: 'a1' }),
      ],
      DEFAULT,
    );
    assert.deepEqual(
      lanes[0]?.tasks.map((t) => t.id),
      ['2', '3', '1'],
    );
  });

  void test('compares positions byte-wise, as the server does — never by locale', () => {
    // 'Z' (0x5A) sorts before 'a' (0x61) byte-wise; a locale compare would
    // put them the other way round on most systems.
    const lanes = groupByColumn(
      [
        task({ id: '1', status: 'todo', position: 'a0' }),
        task({ id: '2', status: 'todo', position: 'Zz' }),
      ],
      DEFAULT,
    );
    assert.deepEqual(
      lanes[0]?.tasks.map((t) => t.id),
      ['2', '1'],
    );
  });

  void test('a task without a place sorts after every placed one, then by number', () => {
    const lanes = groupByColumn(
      [
        task({ id: '3', status: 'todo', position: null }),
        task({ id: '1', status: 'todo', position: null }),
        task({ id: '2', status: 'todo', position: 'a5' }),
      ],
      DEFAULT,
    );
    assert.deepEqual(
      lanes[0]?.tasks.map((t) => t.id),
      ['2', '1', '3'],
    );
  });

  void test('a move in flight sorts the card directly below the card it was dropped under', () => {
    const tasks = [
      task({ id: '1', status: 'todo', position: 'a0' }),
      task({ id: '2', status: 'todo', position: 'a1' }),
      task({ id: '3', status: 'todo', position: 'a2' }),
      task({ id: '4', status: 'todo', position: 'a3' }),
    ];
    const below = groupByColumn(tasks, DEFAULT, { taskId: '4', afterId: '1' });
    assert.deepEqual(
      below[0]?.tasks.map((t) => t.id),
      ['1', '4', '2', '3'],
    );

    // With only the card it sits above — the top of a lane.
    const above = groupByColumn(tasks, DEFAULT, { taskId: '3', beforeId: '1' });
    assert.deepEqual(
      above[0]?.tasks.map((t) => t.id),
      ['3', '1', '2', '4'],
    );

    // An anchor that is not on the board leaves the card where it stands.
    const lost = groupByColumn(tasks, DEFAULT, { taskId: '3', afterId: 'gone' });
    assert.deepEqual(
      lost[0]?.tasks.map((t) => t.id),
      ['1', '2', '3', '4'],
    );
  });

  void test('is stable — the same input gives the same order', () => {
    const input = [
      task({ id: '2', status: 'review', priority: 'p2' }),
      task({ id: '1', status: 'review', priority: 'p2' }),
    ];
    assert.deepEqual(
      groupByColumn(input, DEFAULT)[2]?.tasks.map((t) => t.id),
      groupByColumn(input, DEFAULT)[2]?.tasks.map((t) => t.id),
    );
  });
});

void describe('hideOldDone (LAI-266)', () => {
  const DAY = 86_400_000;
  const now = 10 * DAY;

  void test('never means never', () => {
    const tasks = [task({ id: '1', status: 'done', completed_at: 0 })];
    const { kept, hidden } = hideOldDone(tasks, null, now);

    assert.equal(kept.length, 1);
    assert.equal(hidden, 0);
  });

  void test('drops done work older than the cutoff and keeps the rest', () => {
    // Both sides of the boundary, or the test passes for a function that hides
    // everything or nothing.
    const old = task({ id: '1', status: 'done', completed_at: now - 8 * DAY });
    const fresh = task({ id: '2', status: 'done', completed_at: now - 2 * DAY });
    const { kept, hidden } = hideOldDone([old, fresh], 7, now);

    assert.deepEqual(
      kept.map((t) => t.id),
      ['2'],
    );
    assert.equal(hidden, 1, 'the count is what the board discloses — it must be real');
  });

  void test('touches nothing that is not done', () => {
    // `cancelled` is not "finished", and unfinished work has no completion date
    // to be old. A fixture of each, all older than the cutoff.
    const tasks = [
      task({ id: '1', status: 'todo', completed_at: 0 }),
      task({ id: '2', status: 'in_progress', completed_at: 0 }),
      task({ id: '3', status: 'review', completed_at: 0 }),
      task({ id: '4', status: 'cancelled', completed_at: 0 }),
    ];
    const { kept, hidden } = hideOldDone(tasks, 1, now);

    assert.equal(kept.length, 4);
    assert.equal(hidden, 0);
  });

  void test('keeps a done task whose completion was never recorded', () => {
    // `completed_at` is null for work that finished before LAI-126 stamped it.
    // Hiding it would be guessing at an age nobody wrote down.
    const { kept } = hideOldDone([task({ id: '1', status: 'done', completed_at: null })], 1, now);

    assert.equal(kept.length, 1);
  });
});

void describe('blockers — which dependency is holding this up (LAI-066)', () => {
  void test('names only the unmet ones', () => {
    // `blockedState` answers *whether*; this answers *which*, because the card
    // has to name the blocker. A done dependency is not holding anything up.
    const done = task({ id: '1', status: 'done' });
    const open = task({ id: '2', status: 'todo' });
    const t = task({ id: '3', blocked_by: ['1', '2'] });

    const held = blockers(t, byIdIndex([done, open, t]));
    assert.deepEqual(
      held.map((d) => d.id),
      ['2'],
    );
  });

  void test('cancelled counts as met, exactly as blockedState treats it', () => {
    // The two must agree. If `blockedState` says blocked and `blockers` returns
    // nothing, the card renders a blocked banner naming nobody — which is the
    // vague message this task exists to remove.
    const cancelled = task({ id: '1', status: 'cancelled' });
    const t = task({ id: '2', blocked_by: ['1'] });
    const index = byIdIndex([cancelled, t]);

    assert.deepEqual(blockers(t, index), []);
    assert.equal(blockedState(t, index), false);
  });

  void test('a dependency the board has not loaded is not invented', () => {
    // It cannot be named, so it is not returned. `blockedState` reports the
    // same case as `undefined`, and the card says the count is unknown rather
    // than naming a subset and implying it is the whole story.
    const t = task({ id: '2', blocked_by: ['missing'] });
    const index = byIdIndex([t]);

    assert.deepEqual(blockers(t, index), []);
    assert.equal(blockedState(t, index), undefined);
  });

  void test('the two agree whenever a blocker exists', () => {
    // The property that matters, stated directly: blocked implies nameable,
    // for every dependency the board can see.
    const a = task({ id: '1', status: 'in_progress' });
    const b = task({ id: '2', status: 'done' });
    const t = task({ id: '3', blocked_by: ['1', '2'] });
    const index = byIdIndex([a, b, t]);

    assert.equal(blockedState(t, index), true);
    assert.ok(blockers(t, index).length > 0, 'blocked, but nothing to name');
  });

  void test('no blocked_by means nothing to name', () => {
    const t = task({ id: '1' });
    assert.deepEqual(blockers(t, byIdIndex([t])), []);
  });
});

void describe('staleFor — how long, in the fewest characters (LAI-157)', () => {
  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  void test('reads in the unit a person would use', () => {
    assert.equal(staleFor(0, 30_000), 'now');
    assert.equal(staleFor(0, 5 * MINUTE), '5m');
    assert.equal(staleFor(0, 3 * HOUR), '3h');
    assert.equal(staleFor(0, 9 * DAY), '9d');
  });

  void test('rounds down at every boundary, so it never overstates', () => {
    // A marker that says `1d` at 23h59m would be claiming a day that has not
    // happened. The board is read to decide whether to chase somebody.
    assert.equal(staleFor(0, HOUR - 1), '59m');
    assert.equal(staleFor(0, DAY - 1), '23h');
    assert.equal(staleFor(0, 2 * DAY - 1), '1d');
  });

  void test('a server clock ahead of the browser reads `now`, never `-1m`', () => {
    // `stale_flagged_at` is the server's clock and `now` is the browser's; they
    // disagree routinely, and a negative duration on a card reads as a broken
    // board rather than as two clocks.
    //
    // **This covers the branch order, not the clamp**, and a mutation is what
    // established that: deleting `Math.max` leaves these green, because a
    // negative `minutes` is `< 1` and the first branch catches it anyway. The
    // clamp guards the tidy-up that guards *that* branch. Breaking either alone
    // is invisible here — so this asserts the property both of them serve, and
    // says which one it can actually see.
    assert.equal(staleFor(10_000, 0), 'now');
    assert.equal(staleFor(9 * DAY, 0), 'now');
  });
});

void describe('boardStatusLabel — the column names the status (LAI-617)', () => {
  const col = (name: string, statuses: readonly TaskStatus[]) => ({ name, statuses });

  void test('a column owning one status lends it its name', () => {
    /*
     * A board whose `Review` column is renamed `Testing` showed cards reading
     * "Review" under a header reading "TESTING". The column is renameable; the
     * status is a fixed enum the REST API, the policy layer and the MCP tools
     * depend on by literal value — `laika_finish_task` moves a task to
     * `review`. So the name is the label and the enum stays the value.
     */
    const columns = [col('Testing', ['review']), col('Done', ['done'])];
    assert.equal(boardStatusLabel('review', columns), 'Testing');
    assert.equal(boardStatusLabel('done', columns), 'Done');
  });

  void test('a column owning several keeps their own names', () => {
    /*
     * The shipped default merges `todo` and `backlog` into one `To do`
     * column. Substituting the column name there would render two different
     * statuses identically and hide a real difference — so only the lossless
     * case substitutes.
     */
    const columns = [col('To do', ['todo', 'backlog'])];
    assert.equal(boardStatusLabel('backlog', columns), 'Backlog');
    assert.equal(boardStatusLabel('todo', columns), 'To do');
  });

  void test('an unowned status falls back to its own name', () => {
    // Nothing owns `cancelled` here — the label must still be a word, not
    // `undefined`, because a hidden column may be outside the list passed in.
    assert.equal(boardStatusLabel('cancelled', [col('To do', ['todo'])]), 'Cancelled');
    assert.equal(boardStatusLabel('review', []), 'Review');
  });

  void test('the substitution never invents a status value', () => {
    // The label changes; the enum does not. Renaming a column must not make
    // `review` unreachable, or an agent handing work back would fail.
    const columns = [col('Testing', ['review'])];
    assert.equal(boardStatusLabel('review', columns), 'Testing');
    assert.ok((ALL_STATUSES as readonly string[]).includes('review'), 'review left the enum');
  });
});

void describe('dropNeighbours — what a drop at an index asks the server (LAI-473)', () => {
  const lane = ['a', 'b', 'c', 'd'];

  void test('names the card above and the card below the gap, the dragged card left out', () => {
    // Dragging `d` to index 1 of [a, b, c] — between a and b.
    assert.deepEqual(dropNeighbours(lane, 'd', 1), { afterId: 'a', beforeId: 'b' });
    // The top of the lane has nothing above; the bottom nothing below.
    assert.deepEqual(dropNeighbours(lane, 'd', 0), { beforeId: 'a' });
    assert.deepEqual(dropNeighbours(lane, 'a', 3), { afterId: 'd' });
  });

  void test('a card from another lane counts every card here', () => {
    assert.deepEqual(dropNeighbours(lane, 'x', 2), { afterId: 'b', beforeId: 'c' });
    assert.deepEqual(dropNeighbours([], 'x', 0), {});
  });

  void test('dropping a card back where it was is no move at all', () => {
    assert.equal(dropNeighbours(lane, 'b', 1), undefined);
    assert.notEqual(dropNeighbours(lane, 'b', 2), undefined);
  });

  void test('an index past either end is clamped, never a hole', () => {
    assert.deepEqual(dropNeighbours(lane, 'x', 99), { afterId: 'd' });
    assert.deepEqual(dropNeighbours(lane, 'x', -3), { beforeId: 'a' });
  });
});
