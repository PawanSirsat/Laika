/**
 * The task panel's sprint control (LAI-619).
 *
 * Source scans, in the shape `loading-sweep.test.ts` uses: what matters here
 * is that the control exists, that it can reach *both* outcomes, and that it
 * asks the policy rather than deciding for itself. A render test would prove
 * one of those; the risk is the field being quietly dropped or its permission
 * gate being replaced with `true` during a later refactor.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from '../../../helpers/code.ts';

let meta = '';
let panel = '';
let board = '';

before(async () => {
  const read = async (rel: string) =>
    code(await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
  meta = await read('../../../../src/routes/screens/task/TaskMeta.tsx');
  panel = await read('../../../../src/routes/screens/board/TaskDetailPanel.tsx');
  board = await read('../../../../src/routes/screens/BoardScreen.tsx');
});

void describe('the task panel can change a sprint', () => {
  void test('the field exists and offers every sprint plus none', () => {
    assert.match(meta, /meta-label">Sprint</, 'the Sprint row is gone');
    assert.match(meta, /value=\{task\.sprint_id \?\? ''\}/, 'the control stopped reading the task');
    /*
     * **"No sprint" is the half most likely to be dropped.** Backlog work
     * genuinely belongs to no sprint, and without this option the only way out
     * of one is the Sprints screen — which is where this task started.
     */
    // An option of the `Dropdown` since LAI-726, where it was an `<option>`.
    assert.match(meta, /\{ value: '', label: 'No sprint'/, 'clearing is unreachable');
    assert.match(meta, /sprints\.map\(/, 'the real sprints are not listed');
  });

  void test('both outcomes are wired, and they are different calls', () => {
    /*
     * Measured against the server rather than assumed: `POST /sprints/:id/tasks`
     * on a task already in another sprint **reassigns** it, so moving needs no
     * prior delete. Clearing has no sprint to post to, so it is the only case
     * that needs `removeTaskFromSprint`. Asserting both keeps a later
     * "simplification" from collapsing them.
     */
    assert.match(panel, /addTasksToSprint\(sprintId, \[task\.id\]\)/, 'assigning is gone');
    assert.match(panel, /removeTaskFromSprint\(task\.sprint_id, task\.id\)/, 'clearing is gone');
    assert.match(panel, /sprintId === null/, 'the two paths are no longer distinguished');
  });

  void test('the control asks the policy, and does not invent an answer', () => {
    // §3.2: assigning to a sprint is member+. The same helper the Sprints
    // screen uses — not a second rule that can drift from it.
    assert.match(board, /canAssignToSprints\(me\.org_role, boardProjectId, me\.memberships\)/);
    assert.match(meta, /disabled=\{sprintBusy \|\| !maySetSprint\}/, 'a Viewer can edit it');
  });

  void test('a refusal is shown, in the server words', () => {
    // A closed sprint refuses with a reason. Inventing one here would tell the
    // reader something the server did not say.
    assert.match(panel, /cause instanceof ApiError \? cause\.message/);
    assert.match(meta, /sprintError !== undefined/, 'the reason is never rendered');
  });
});
