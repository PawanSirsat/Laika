/**
 * `src/routes/screens/board/thread-order.ts` — the task panel's **All** tab
 * order (LAI-575).
 *
 * The feed hands activity over newest first, so two events in one millisecond
 * arrive `seq`-descending. These tests feed them both ways round and fail if
 * the merge ever keeps the feed's order instead of the write order.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import type { Comment } from '../../../../src/api/comments.ts';
import { threadOrder, type ThreadItem } from '../../../../src/routes/screens/board/thread-order.ts';

const AT = 1_761_652_800_000;

function event(id: string, seq: number, at = AT): ThreadItem {
  const row: ActivityEvent = {
    id,
    seq,
    type: 'task.updated',
    project_id: 'p',
    task_id: 't',
    actor_id: 'u',
    actor_kind: 'user',
    actor_token_id: null,
    payload: {},
    created_at: at,
  };
  return { kind: 'event', at, event: row };
}

function comment(id: string, at = AT): ThreadItem {
  const row = { id, created_at: at } as Comment;
  return { kind: 'comment', at, comment: row };
}

const ids = (items: readonly ThreadItem[]) =>
  items.map((i) => (i.kind === 'event' ? i.event.id : i.comment.id));

void describe('the All tab orders two same-millisecond events by seq', () => {
  void test('the feed order (seq descending) comes out seq ascending', () => {
    // `task.status_changed` (seq 7) then `task.updated` (seq 8), as a claim
    // writes them — the feed returns 8 before 7.
    assert.deepEqual(ids([event('b', 8), event('a', 7)].sort(threadOrder)), ['a', 'b']);
  });

  void test('already ascending stays ascending', () => {
    assert.deepEqual(ids([event('a', 7), event('b', 8)].sort(threadOrder)), ['a', 'b']);
  });

  void test('created_at still decides before seq', () => {
    // A later row with a lower seq is not possible from one writer, but the
    // timestamp is the primary key of the order and must stay so.
    assert.deepEqual(ids([event('late', 1, AT + 1), event('early', 9)].sort(threadOrder)), [
      'early',
      'late',
    ]);
  });
});

void describe('a comment still sorts before an event on a tie', () => {
  void test('whichever list it came from first', () => {
    assert.deepEqual(ids([event('e', 3), comment('c')].sort(threadOrder)), ['c', 'e']);
    assert.deepEqual(ids([comment('c'), event('e', 3)].sort(threadOrder)), ['c', 'e']);
  });

  void test('and before both of two tied events, which keep seq order', () => {
    assert.deepEqual(ids([event('e2', 8), event('e1', 7), comment('c')].sort(threadOrder)), [
      'c',
      'e1',
      'e2',
    ]);
  });
});
