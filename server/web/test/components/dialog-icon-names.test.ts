/**
 * An icon-only button inside a dialog has a name (LAI-1209).
 *
 * A `<button>` whose only content is a glyph — `×`, an `<Icon>`, an `<svg>` —
 * has no words for a screen reader to say, so it must carry `aria-label` (or
 * `aria-labelledby`). Read from the source of **every file that draws a
 * dialog**, found by grep rather than listed, so a new dialog is covered the
 * day it is written. `IconButton` makes `label` a required prop and is held by
 * the type checker instead.
 *
 * The files LAI-1209 migrated are held to more: no bare `title=` on a button,
 * and each icon-only button wrapped in the shared `Tooltip`; an `IconButton`
 * there may not switch its tooltip off. The browser half —
 * the tooltip actually showing, on hover and on focus — is
 * `test/browser/dialog-tooltips.test.ts`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';
import { buttons, hasWords, insideTooltip, named } from '../helpers/jsx-buttons.ts';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** What makes a file a dialog's: a dialog role, or the shared Dialog. */
const DRAWS_A_DIALOG =
  /role="(?:dialog|alertdialog)"|role=\{?['"](?:dialog|alertdialog)|<Dialog\b|role: '(?:dialog|alertdialog)'/;

/** The dialogs LAI-1209 gave tooltips: held to the stricter rules below. */
const MIGRATED = [
  'components/create-task/CreateTaskDialog.tsx',
  'components/create-task/CreateTaskFields.tsx',
  'components/overlay/Dialog.tsx',
  'components/OffboardingDialog.tsx',
  'components/ConfirmDialog.tsx',
  'routes/screens/organisation/InviteDialog.tsx',
  'routes/screens/review/ReviewDialog.tsx',
  'routes/screens/review/SendBackDialog.tsx',
  'routes/screens/my-day/MyDayDialog.tsx',
  'routes/screens/board/NewColumnDialog.tsx',
  'routes/screens/board/DeleteColumnDialog.tsx',
  'routes/screens/board/HiddenColumnsDialog.tsx',
  'routes/screens/task/editor/RichEditor.tsx',
] as const;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

const files = walk(SRC)
  .filter((path) => DRAWS_A_DIALOG.test(readFileSync(path, 'utf8')))
  .map((path) => relative(SRC, path));

void describe('the reader', () => {
  void test('tells a glyph from words', () => {
    assert.equal(hasWords('<span aria-hidden="true">×</span>'), false);
    assert.equal(hasWords('\n  ✕\n'), false);
    assert.equal(hasWords('<Icon name="close" size="small" />'), false);
    assert.equal(hasWords('{busy && <Spinner size="sm" />}'), false);
    assert.equal(hasWords('{busy && <Spinner size="sm" />}\n Send back'), true);
    assert.equal(hasWords('{children}'), true);
  });

  void test('reads every button, with what it holds', () => {
    const found = buttons(
      '<button aria-label="Close" onClick={() => go(">")}>×</button><button>Save</button>',
    );
    assert.equal(found.length, 2);
    assert.equal(found[0]?.inner, '×');
    assert.equal(named(found[0]?.open ?? ''), true);
    assert.equal(hasWords(found[1]?.inner ?? ''), true);
  });
});

void describe('icon-only buttons in dialogs are named (LAI-1209)', () => {
  void test('the census found the dialogs, by grep', () => {
    // Not a count to keep up to date: names that must be in it, so a broken
    // grep that finds nothing cannot pass the test below.
    for (const file of [
      'components/create-task/CreateTaskDialog.tsx',
      'components/overlay/Dialog.tsx',
      'routes/screens/review/SendBackDialog.tsx',
    ]) {
      assert.ok(files.includes(file), `${file} is not in the census`);
    }
  });

  for (const file of files) {
    void test(file, () => {
      const src = code(readFileSync(join(SRC, file), 'utf8'));
      const unnamed = buttons(src)
        .filter((b) => !hasWords(b.inner) && !named(b.open))
        .map((b) => b.open);
      assert.deepEqual(unnamed, [], `${file}: an icon-only <button> with no name`);
    });
  }
});

void describe('the migrated dialogs show it too (LAI-1209)', () => {
  for (const file of MIGRATED) {
    void test(file, () => {
      const src = code(readFileSync(join(SRC, file), 'utf8'));
      for (const b of buttons(src)) {
        assert.doesNotMatch(
          b.open,
          /\stitle=/,
          `${file}: a bare title= — use the Tooltip:\n${b.open}`,
        );
      }
      // Each icon-only button sits directly inside a <Tooltip …>.
      const bare = buttons(src)
        .filter((b) => !hasWords(b.inner))
        .filter((b) => !insideTooltip(src, b.at))
        .map((b) => b.open);
      assert.deepEqual(bare, [], `${file}: an icon-only <button> with no Tooltip around it`);
      assert.doesNotMatch(
        src,
        /<IconButton\b[^>]*tooltip=\{false\}/,
        `${file}: a silenced IconButton`,
      );
    });
  }
});
