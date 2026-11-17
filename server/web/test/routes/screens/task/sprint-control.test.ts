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
    // The label leads with its decorative mark since LAI-1213.
    assert.match(
      meta,
      /meta-label">\s*(?:<Icon name="sprint"[^>]*\/>\s*)?Sprint\s*</,
      'the Sprint row is gone',
    );
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
    // One writer for both directions since LAI-1310, so Undo can call it back.
    assert.match(panel, /addTasksToSprint\(to, \[task\.id\]\)/, 'assigning is gone');
    assert.match(panel, /removeTaskFromSprint\(from, task\.id\)/, 'clearing is gone');
    assert.match(panel, /to === null/, 'the two paths are no longer distinguished');
  });

  void test('the control asks the policy, and does not invent an answer', () => {
    // §3.2: assigning to a sprint is member+ — asked of the server's answer
    // (LAI-970), as the Sprints screen asks it, not a second rule here.
    assert.match(board, /gates\.project\(boardProjectId, 'task\.assign_sprint'\)/);
    assert.match(meta, /disabled=\{sprintBusy \|\| !maySetSprint\}/, 'a Viewer can edit it');
  });

  void test('a change and a refusal are said in a toast, in the server words', () => {
    // A closed sprint refuses with a reason. Since LAI-1310 the change goes
    // through `useAction().run`, whose error toast carries the server's own
    // sentence as its detail (`action-model.ts`'s `detailOf`, unit-tested
    // there) — so this pins that the sprint change is run through it.
    assert.match(
      panel,
      /action\.run\(\{\s*do: \(\) => writeSprint\(from, sprintId\)/,
      'the sprint change no longer reports through useAction',
    );
    assert.match(panel, /failure: 'Couldn’t change the sprint'/, 'a refusal is not toasted');
  });
});
