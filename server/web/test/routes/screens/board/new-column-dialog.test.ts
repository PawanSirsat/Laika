/**
 * The add-column tile asks before it creates (LAI-291).
 *
 * Asked for by the owner with a reference screenshot: *Name* (required),
 * *Status category*, Cancel / Submit. Before this, the `+` tile called
 * `columns.create(nextColumnName(...))` and a column called `Column 5` appeared
 * for you to rename afterwards.
 *
 * Source assertions, because the properties worth pinning here are structural —
 * *nothing is created until Submit*, *the name gates Submit*, *no status is
 * filtered out of the picker*. The rendered dialog is exercised in
 * `test/browser/`.
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

  /**
   * The first version filtered out statuses another column held, on the correct
   * reasoning that a status lives in one column. On any backfilled board that
   * left the picker showing **"Nothing yet"** and nothing else — a right rule
   * and a useless control. Every status is offered; picking a held one moves it.
   */
  void test('every status is offered, not only unclaimed ones', () => {
    assert.match(dialog, /\{STATUSES\.map\(/, 'the picker iterates something narrower');
    assert.doesNotMatch(
      dialog,
      /\{free\.map\(/,
      'the picker is back to offering only unclaimed statuses',
    );
  });

  void test('a moved status names the column it leaves', () => {
    assert.match(dialog, /moves out of/i);
    // Quoted, because a status and its column usually share a name and
    // "Moves here from Review" reads as one thing moving from itself.
    assert.match(dialog, /“\$\{holder\.get\(status\)\?\.name/);
  });

  void test('Escape and the scrim both close it', () => {
    assert.match(dialog, /event\.key === 'Escape'/);
    assert.match(dialog, /column-dialog-scrim[\s\S]{0,120}onClick=\{onClose\}/);
  });

  void test('the name field takes focus on open', () => {
    assert.match(dialog, /nameRef\.current\?\.focus\(\)/);
  });
});
