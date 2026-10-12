/**
 * The add-column tile asks before it creates (LAI-291, LAI-739).
 *
 * The owner first asked for *Name* and *Status category*; LAI-739 made a
 * column one project status and asked the second question in plain words —
 * *What kind of work is this?* — with the six kinds and a line each. Before
 * LAI-291 the `+` tile called `columns.create(nextColumnName(...))` and a
 * column called `Column 5` appeared for you to rename afterwards.
 *
 * Source assertions, because the properties worth pinning here are structural —
 * *nothing is created until Submit*, *the name gates Submit*, *every kind is
 * offered and none of them in jargon*. The rendered dialog is exercised in
 * `test/browser/column-create.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from '../../../helpers/code.ts';

let dialog = '';
let board = '';

before(async () => {
  const read = async (rel: string) =>
    code(await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
  dialog = await read('../../../../src/routes/screens/board/NewColumnDialog.tsx');
  board = await read('../../../../src/routes/screens/BoardScreen.tsx');
});

void describe('the tile no longer creates on click', () => {
  void test('`nextColumnName` is gone, and nothing auto-names a column', () => {
    // The whole complaint: a column appeared already named and you fixed it up.
    assert.ok(!board.includes('nextColumnName'), 'the auto-namer survived');
    assert.doesNotMatch(board, /Column \$\{/, 'something still builds a default name');
  });

  void test('the tile sets dialog state rather than calling create', () => {
    const handler = /onAddColumn:\s*\(\)\s*=>\s*\{([\s\S]{0,400}?)\}/.exec(board);
    assert.ok(handler, 'no onAddColumn handler found — this proves nothing');
    assert.match(handler[1] ?? '', /setCreatingColumn\(true\)/);
    assert.doesNotMatch(
      handler[1] ?? '',
      /columns\.create/,
      'the tile still creates a column directly',
    );
  });
});

void describe('the dialog', () => {
  void test('Submit is disabled without a name', () => {
    // A `422` is a worse way to say "required" than a button that cannot be
    // pressed. `trimmed` so a space is not a name.
    assert.match(dialog, /const trimmed = name\.trim\(\)/);
    assert.match(dialog, /disabled=\{trimmed === '' \|\| busy\}/);
  });

  void test('submitting is refused the same way, not only visually', () => {
    // Enter in the name field calls `submit` too, and a disabled button is not
    // a guard against that path.
    assert.match(dialog, /if \(trimmed === '' \|\| busy\) return;/);
  });

  void test('every kind of work is offered, each with its one line', () => {
    // All six, never a subset: a kind left out is a column nobody can make.
    assert.match(dialog, /STATUS_CATEGORIES\.map\(/, 'the choices iterate something narrower');
    assert.match(dialog, /CATEGORY_COPY\[kind\]\.description/, 'a choice without its description');
    assert.match(dialog, /What kind of work is this\?/);
  });

  void test('no "status" or "category" jargon on screen (LAI-739)', () => {
    // The owner's instruction: Jira team-managed simplicity. The retired
    // dialog said *Create status* and *Status category*.
    assert.doesNotMatch(dialog, />\s*Create status\s*</);
    assert.doesNotMatch(dialog, /Status category/);
  });

  void test('Escape and the scrim both close it', () => {
    assert.match(dialog, /event\.key === 'Escape'/);
    assert.match(dialog, /column-dialog-scrim[\s\S]{0,120}onClick=\{onClose\}/);
  });

  void test('the name field takes focus on open', () => {
    assert.match(dialog, /nameRef\.current\?\.focus\(\)/);
  });
});
