/**
 * Capacity's derivations (LAI-439).
 *
 * Every one of these is about **presentation**. `active_sessions`,
 * `in_progress_tasks` and `oldest_in_progress_ms` arrive decided by the server,
 * and AC7 forbids inventing a figure it did not send — so what is tested here is
 * ordering, formatting, and the one predicate the whole screen turns on.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  byAvailability,
  oldestAge,
  taskIdsToResolve,
} from '../../../../src/routes/screens/capacity/capacity-derive.ts';
import type { CapacityEntry } from '../../../../src/api/presence.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function person(over: Partial<CapacityEntry> & { user_id: string }): CapacityEntry {
  return {
    name: over.user_id,
    active_sessions: 0,
    in_progress_tasks: [],
    oldest_in_progress_ms: null,
    tasks_in_review: [],
    last_seen: null,
    ...over,
  };
}

void describe('oldestAge', () => {
  void test('null in, undefined out — no age is not an age of zero', () => {
    // `0` would render as "started this instant" for somebody with nothing in
    // progress at all.
    assert.equal(oldestAge(null), undefined);
  });

  void test('reads in the unit a person would use', () => {
    assert.equal(oldestAge(30_000), 'just now');
    assert.equal(oldestAge(40 * 60_000), '40m');
    assert.equal(oldestAge(5 * HOUR), '5h');
    assert.equal(oldestAge(3 * DAY), '3d');
  });

  void test('rounds down, and never renders a negative', () => {
    assert.equal(oldestAge(HOUR - 1), '59m');
    assert.equal(oldestAge(-5_000), 'just now');
  });
});

void describe('byAvailability — a ranking, not a score', () => {
  void test('fewest in progress first', () => {
    const ranked = byAvailability([
      person({ user_id: 'busy', in_progress_tasks: ['a', 'b'] }),
      person({ user_id: 'free' }),
      person({ user_id: 'one', in_progress_tasks: ['c'] }),
    ]);
    assert.deepEqual(
      ranked.map((p) => p.user_id),
      ['free', 'one', 'busy'],
    );
  });

  void test('then fewest awaiting their review', () => {
    const ranked = byAvailability([
      person({ user_id: 'reviewing', tasks_in_review: ['a', 'b'] }),
      person({ user_id: 'clear' }),
    ]);
    assert.equal(ranked[0]?.user_id, 'clear');
  });

  void test('then the youngest oldest task, so nobody stuck is offered more', () => {
    const ranked = byAvailability([
      person({ user_id: 'stuck', in_progress_tasks: ['a'], oldest_in_progress_ms: 9 * DAY }),
      person({ user_id: 'fresh', in_progress_tasks: ['b'], oldest_in_progress_ms: HOUR }),
    ]);
    assert.equal(ranked[0]?.user_id, 'fresh');
  });

  void test('name breaks the last tie, so the order does not wobble between polls', () => {
    const ranked = byAvailability([person({ user_id: 'b' }), person({ user_id: 'a' })]);
    assert.deepEqual(
      ranked.map((p) => p.user_id),
      ['a', 'b'],
    );
  });

  void test('it does not mutate what the server sent', () => {
    const sent = [person({ user_id: 'b' }), person({ user_id: 'a' })];
    byAvailability(sent);
    assert.equal(sent[0]?.user_id, 'b', 'the response was reordered in place');
  });
});

void describe('taskIdsToResolve', () => {
  void test('both lists, deduped across people', () => {
    const ids = taskIdsToResolve([
      person({ user_id: 'a', in_progress_tasks: ['t1', 't2'], tasks_in_review: ['t3'] }),
      person({ user_id: 'b', in_progress_tasks: ['t2'], tasks_in_review: ['t3'] }),
    ]);
    assert.deepEqual([...ids].sort(), ['t1', 't2', 't3']);
  });

  void test('nobody working is no requests, not one for undefined', () => {
    assert.deepEqual(taskIdsToResolve([person({ user_id: 'a' })]), []);
  });
});
