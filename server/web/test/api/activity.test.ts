/**
 * `src/api/activity.ts` (LAI-056).
 *
 * Pure helpers over the feed. `describeEvent` matters more than it looks: an
 * unknown event type must stay readable rather than throwing or rendering
 * `task.status_changed` raw at someone.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeEvent, statusTransition, type ActivityEvent } from '../../src/api/activity.ts';

function event(over: Partial<ActivityEvent> & { type: string }): ActivityEvent {
  return {
    id: 'e1',
    seq: 1,
    project_id: 'p',
    task_id: 't',
    actor_id: 'u',
    actor_kind: 'user',
    actor_token_id: null,
    payload: null,
    created_at: 0,
    ...over,
  };
}

void describe('describeEvent', () => {
  void test('gives human wording for the types we know', () => {
    assert.equal(describeEvent(event({ type: 'task.created' })), 'created this task');
    assert.equal(describeEvent(event({ type: 'comment.added' })), 'commented');
    assert.equal(describeEvent(event({ type: 'task.status_changed' })), 'moved this task');
  });

  void test('an unknown type degrades to itself, not to a crash or a blank', () => {
    // New server-side types will appear as themselves until someone adds a
    // line. Legible and obviously incomplete is the right failure.
    assert.equal(describeEvent(event({ type: 'task.teleported' })), 'task.teleported');
  });

  void test('never returns an empty string', () => {
    for (const type of ['task.created', 'nonsense', '']) {
      assert.equal(typeof describeEvent(event({ type })), 'string');
    }
  });
});

void describe('statusTransition', () => {
  void test('reads from and to off a status change', () => {
    const move = statusTransition(
      event({ type: 'task.status_changed', payload: { from: 'todo', to: 'in_progress' } }),
    );
    assert.deepEqual(move, { from: 'todo', to: 'in_progress' });
  });

  void test('is undefined for any other type, even with a matching payload', () => {
    // Guards against labelling a comment as a move because its payload happens
    // to carry the same keys.
    assert.equal(
      statusTransition(event({ type: 'comment.added', payload: { from: 'a', to: 'b' } })),
      undefined,
    );
  });

  void test('is undefined when the payload is missing or malformed', () => {
    for (const payload of [null, {}, { from: 'todo' }, { from: 1, to: 2 }]) {
      assert.equal(
        statusTransition(event({ type: 'task.status_changed', payload })),
        undefined,
        `payload ${JSON.stringify(payload)} should not produce a transition`,
      );
    }
  });
});
