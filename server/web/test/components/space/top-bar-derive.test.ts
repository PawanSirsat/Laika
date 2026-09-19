/**
 * The pure parts of the space top bar (LAI-251).
 *
 * The cluster and the cycler are where an off-by-one shows up as a wrong
 * number beside real people, which is the kind of wrong that reads as true.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CLUSTER_LIMIT,
  agentCount,
  cluster,
  nextPriority,
  priorityLabel,
} from '../../../src/components/space/top-bar-derive.ts';

const person = (id: string, isAgent = false) => ({
  user_id: id,
  name: id,
  is_agent: isAgent,
  matched_task_id: null,
  project_ids: [],
  last_seen: 0,
});

void describe('the avatar cluster', () => {
  void test('shows everyone and counts nobody when the list fits', () => {
    const { shown, overflow } = cluster(['a', 'b', 'c']);
    assert.deepEqual(shown, ['a', 'b', 'c']);
    assert.equal(overflow, 0, 'a +0 claims there is more to see');
  });

  void test('a full list is still not an overflow', () => {
    // The boundary: exactly `CLUSTER_LIMIT` people is the case where an
    // off-by-one renders "+0" beside a complete row.
    const full = Array.from({ length: CLUSTER_LIMIT }, (_, i) => String(i));
    const { shown, overflow } = cluster(full);
    assert.equal(shown.length, CLUSTER_LIMIT);
    assert.equal(overflow, 0);
  });

  void test('one more than fits counts exactly one', () => {
    const { shown, overflow } = cluster(['a', 'b', 'c', 'd', 'e']);
    assert.equal(shown.length, CLUSTER_LIMIT);
    assert.equal(overflow, 5 - CLUSTER_LIMIT);
  });

  void test('an empty list is empty, not a zero badge', () => {
    assert.deepEqual(cluster([]), { shown: [], overflow: 0 });
  });
});

void describe('the priority cycler', () => {
  void test('cycles through every priority and back to any', () => {
    // Back to `undefined` is the property: the design draws one button and no
    // clear, so a cycle that cannot return is a filter you cannot remove.
    assert.equal(nextPriority(undefined), 'p1');
    assert.equal(nextPriority('p1'), 'p2');
    assert.equal(nextPriority('p2'), 'p3');
    assert.equal(nextPriority('p3'), undefined);
  });

  void test('a value the table does not know behaves like any', () => {
    // A hand-edited URL must not strand the control on a value it cannot leave.
    assert.equal(nextPriority('p9' as never), 'p1');
  });

  void test('the label says which, and says so in the design’s casing', () => {
    assert.equal(priorityLabel(undefined), 'Any priority');
    assert.equal(priorityLabel('p1'), 'P1');
  });
});

void describe('the agent count', () => {
  void test('counts agent sessions and no one else', () => {
    assert.equal(agentCount([person('a', true), person('b'), person('c', true)]), 2);
  });

  void test('no presence yet is zero, not a guess', () => {
    assert.equal(agentCount(undefined), 0);
    assert.equal(agentCount([]), 0);
  });
});
