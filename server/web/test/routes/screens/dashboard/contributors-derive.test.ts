/**
 * `routes/screens/dashboard/contributors-derive.ts` (LAI-817, D-092 item 1).
 *
 * What a wrong number here costs is the owner's complaint itself: the person
 * who did most of the work ranked last. Each test is one clause of D-092's
 * rule, with the near miss beside it so the clause can be seen to bite.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import { contributors } from '../../../../src/routes/screens/dashboard/contributors-derive.ts';
import { ASH, EVENTS, EXPECTED, NOW, PAW, SAK } from '../../../browser/onroute-dashboard.ts';

const DAY = 86_400_000;
let seq = 0;

/** A status change, oldest first in the order written. */
function move(
  task: string,
  actor: string | null,
  from: string,
  to: string,
  kind: ActivityEvent['actor_kind'] = 'user',
): ActivityEvent {
  seq += 1;
  return {
    id: `e${String(seq)}`,
    seq,
    type: 'task.status_changed',
    project_id: 'p1',
    task_id: task,
    actor_id: actor,
    actor_kind: kind,
    actor_token_id: kind === 'agent' ? 'tok-1' : null,
    payload: { from, to },
    created_at: 1_000 + seq,
  };
}

/** Newest first, as the feed arrives. */
const feed = (...events: ActivityEvent[]): ActivityEvent[] => events.reverse();

const row = (result: ReturnType<typeof contributors>, id: string) =>
  result.rows.find((r) => r.id === id);

void describe('delivered', () => {
  void test('a move into review, or into done without review, is a delivery', () => {
    const result = contributors(
      feed(
        move('t1', 'ada', 'in_progress', 'review'),
        move('t2', 'ada', 'todo', 'done'),
        // Near misses: moving work is not delivering it.
        move('t3', 'ada', 'todo', 'in_progress'),
        move('t4', 'ada', 'backlog', 'todo'),
      ),
    );
    assert.equal(row(result, 'ada')?.delivered, 2);
  });

  void test('an agent’s move is credited to its token’s owner', () => {
    // The server writes the owner as `actor_id` on an agent's row (§4.8).
    const result = contributors(
      feed(
        move('t1', 'pawan', 'in_progress', 'review', 'agent'),
        move('t2', 'pawan', 'in_progress', 'review', 'agent'),
        move('t3', 'pawan', 'in_progress', 'review', 'user'),
      ),
    );
    assert.deepEqual(result.rows, [{ id: 'pawan', delivered: 3, reviewed: 0, selfClosed: 0 }]);
  });

  void test('a system row counts for nobody', () => {
    const result = contributors(feed(move('t1', null, 'in_progress', 'review', 'system')));
    assert.deepEqual(result.rows, []);
  });

  void test('a task moved twice counts once', () => {
    const result = contributors(
      feed(
        move('t1', 'ada', 'in_progress', 'review'),
        move('t1', 'bob', 'review', 'in_progress'),
        move('t1', 'ada', 'in_progress', 'review'),
        move('t2', 'ada', 'in_progress', 'review'),
      ),
    );
    assert.equal(row(result, 'ada')?.delivered, 2, 'two tasks, three moves');
  });

  void test('a move between two review columns is not a second delivery', () => {
    // QA → Code review: both are the review category (LAI-738).
    const result = contributors(
      feed(move('t1', 'ada', 'review', 'review'), move('t2', 'bob', 'done', 'done')),
    );
    assert.deepEqual(result.rows, []);
  });
});

void describe('reviewed', () => {
  void test('review → done by someone else counts as Reviewed; by the deliverer it does not', () => {
    const result = contributors(
      feed(
        move('t1', 'ada', 'in_progress', 'review'),
        move('t1', 'bob', 'review', 'done'),
        move('t2', 'bob', 'in_progress', 'review'),
        move('t2', 'bob', 'review', 'done'),
      ),
    );
    assert.equal(row(result, 'bob')?.reviewed, 1, 'only Ada’s task is a review');
    assert.equal(row(result, 'bob')?.delivered, 1, 'Bob delivered his own');
    assert.equal(row(result, 'ada')?.reviewed, 0);
  });

  void test('sending work back is a review too', () => {
    const result = contributors(
      feed(move('t1', 'ada', 'in_progress', 'review'), move('t1', 'bob', 'review', 'todo')),
    );
    assert.equal(row(result, 'bob')?.reviewed, 1);
  });

  void test('a delivery before the range: the assignee stands in for the deliverer', () => {
    const assigneeOf = (task: string): string | null =>
      ({ mine: 'bob', theirs: 'ada', nobodys: null })[task] ?? null;
    const result = contributors(
      feed(
        move('mine', 'bob', 'review', 'done'),
        move('theirs', 'bob', 'review', 'done'),
        move('nobodys', 'bob', 'review', 'done'),
      ),
      (id) => id,
      { assigneeOf },
    );
    assert.equal(row(result, 'bob')?.reviewed, 2, 'Ada’s and nobody’s, not his own');
  });
});

void describe('self-closes', () => {
  void test('counted in delivered, and totalled for the footnote', () => {
    const result = contributors(
      feed(
        move('t1', 'ada', 'in_progress', 'done'),
        move('t2', 'ada', 'in_progress', 'review'),
        move('t2', 'bob', 'review', 'done'),
        move('t3', 'bob', 'todo', 'done'),
      ),
    );
    assert.deepEqual(row(result, 'ada'), { id: 'ada', delivered: 2, reviewed: 0, selfClosed: 1 });
    assert.equal(result.selfClosed, 2);
  });
});

void describe('ranking and scope', () => {
  void test('most delivered first; reviewed, then name, break a tie', () => {
    const names: Record<string, string> = { z: 'Zed', a: 'Amy', b: 'Bea', r: 'Rex' };
    const result = contributors(
      feed(
        // Bea arrives before Amy, so a name order cannot be an arrival order.
        move('t0', 'b', 'todo', 'review'),
        move('t1', 'z', 'todo', 'review'),
        move('t2', 'a', 'todo', 'review'),
        move('t3', 'r', 'todo', 'review'),
        move('t4', 'r', 'todo', 'review'),
        move('t5', 'z', 'review', 'done'),
      ),
      (id) => names[id] ?? id,
      { assigneeOf: () => null },
    );
    assert.deepEqual(
      result.rows.map((r) => r.id),
      ['r', 'z', 'a', 'b'],
    );
  });

  void test('the card’s filter narrows the tasks counted', () => {
    const result = contributors(
      feed(move('in', 'ada', 'todo', 'review'), move('out', 'ada', 'todo', 'review')),
      (id) => id,
      { include: (task) => task === 'in' },
    );
    assert.equal(row(result, 'ada')?.delivered, 1);
  });
});

/*
 * **The owner's space, as production measured it** (D-092's note). The
 * fixture is built from named groups; these are its sums, counted there by
 * hand — not by this function.
 */
void describe('the OnRoute shape', () => {
  const since = (days: number): ActivityEvent[] =>
    EVENTS.filter((e) => e.created_at >= NOW - days * DAY);

  void test('7 days: Ashutosh 23 delivered, Pawan 3', () => {
    const result = contributors(since(7));
    assert.deepEqual(
      result.rows.map((r) => [r.id, r.delivered, r.reviewed, r.selfClosed]),
      [
        [ASH, EXPECTED.delivered7d[ASH], 0, 0],
        [PAW, EXPECTED.delivered7d[PAW], EXPECTED.reviewed7d[PAW], EXPECTED.selfClosed7d[PAW]],
        [SAK, 0, EXPECTED.reviewed7d[SAK], 0],
      ],
    );
  });

  void test('30 days and all time: Pawan 168, Ashutosh 86, Sakshi 16', () => {
    for (const events of [since(30), EVENTS as ActivityEvent[]]) {
      const result = contributors(events);
      assert.deepEqual(
        result.rows.map((r) => [r.id, r.delivered, r.reviewed]),
        [
          [PAW, EXPECTED.delivered30d[PAW], EXPECTED.reviewed30d[PAW]],
          [ASH, EXPECTED.delivered30d[ASH], EXPECTED.reviewed30d[ASH]],
          [SAK, EXPECTED.delivered30d[SAK], EXPECTED.reviewed30d[SAK]],
        ],
      );
      assert.equal(result.selfClosed, EXPECTED.selfClosed30d[PAW]);
    }
  });
});
