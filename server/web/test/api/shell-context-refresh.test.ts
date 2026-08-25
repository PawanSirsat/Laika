/**
 * Which stream frames make the sidebar recount (LAI-122).
 *
 * `useShellContext` is a React hook and this package has no renderer
 * (CONVENTIONS §4), so the rendered badge is verified against a running
 * instance and recorded in the task. What can be asserted here is the decision
 * the hook makes: **which** frames mean "your numbers are stale".
 *
 * Getting this list wrong fails in two directions, and only one is visible.
 * Too narrow and the badge silently keeps a number that has stopped being true
 * — the bug this task exists to fix. Too wide and every comment anyone types
 * costs a `countSprints` request in every open tab.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COUNT_CHANGING } from '../../src/api/use-shell-context.ts';
import { STREAM_TYPES } from '../../src/api/stream-types.ts';

void describe('the frames that mean a sidebar number changed', () => {
  void test('project.updated is included, because sprints ride under it', () => {
    // Measured, not assumed: creating, renaming and deleting a sprint each emit
    // `project.updated` on the stream. §4.8 has no sprint verb of its own —
    // growing one is LAI-113 — so this is the only signal a sprint changed.
    assert.ok(
      COUNT_CHANGING.has('project.updated'),
      'the sprint badge cannot update without this — it is the frame sprints emit',
    );
  });

  void test('a project appearing or being archived also counts', () => {
    for (const type of ['project.created', 'project.archived']) {
      assert.ok(COUNT_CHANGING.has(type), `${type} changes what the shell describes`);
    }
  });

  void test('ordinary task and comment traffic does NOT trigger a recount', () => {
    // The expensive direction. A busy board would otherwise turn one person
    // working into a request per action, in every open tab, for a number that
    // did not change.
    for (const noisy of [
      'task.created',
      'task.updated',
      'task.status_changed',
      'task.assigned',
      'comment.added',
      'comment.edited',
      'heartbeat.session',
    ]) {
      assert.ok(!COUNT_CHANGING.has(noisy), `${noisy} would recount for nothing`);
    }
  });

  void test('every listed type is one the server can actually send', () => {
    // A type that is not in the §4.8 enum can never arrive, so listing one is a
    // silent no-op — the shell would look wired and never refresh. This is the
    // same mistake LAI-070 made by writing `sprint.created` from memory.
    for (const type of COUNT_CHANGING) {
      assert.ok(
        STREAM_TYPES.includes(type),
        `"${type}" is not in the server's activity enum, so it will never arrive`,
      );
    }
  });

  void test('the list stays small', () => {
    // Not a style rule: this set is the cost control. If it ever needs to be
    // large, the shell wants a different mechanism than "refetch on frame".
    assert.ok(COUNT_CHANGING.size <= 5, `${String(COUNT_CHANGING.size)} types is not a filter`);
  });
});
