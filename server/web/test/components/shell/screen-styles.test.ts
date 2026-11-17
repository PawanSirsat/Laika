/**
 * `screen-styles.ts` keeps every screen's CSS in the entry stylesheet, in the
 * order the screens brought it before they were split (LAI-1219).
 *
 * Read from source: the file is nothing but CSS imports, which `node --test`
 * cannot load. That the list is **complete** is proved in a real build by
 * `bundle-budget.test.ts` (no screen chunk carries CSS of its own); this file
 * guards that it is well-formed and sits where its order depends on it.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const SHELL = fileURLToPath(new URL('../../../src/components/shell/', import.meta.url));

async function listed(): Promise<string[]> {
  const source = await readFile(resolve(SHELL, 'screen-styles.ts'), 'utf8');
  return [...source.matchAll(/^import '([^']+)';$/gm)].map((m) => m[1] ?? '');
}

void describe('screen-styles.ts', () => {
  void test('it lists stylesheets at all, or nothing below proves anything', async () => {
    const paths = await listed();
    assert.ok(paths.length >= 50, `parsed ${String(paths.length)} imports — format changed?`);
    assert.ok(
      paths.includes('../../routes/screens/board/board-rail.css'),
      'the board layout sheet — the one that exposed the need for this file — is missing',
    );
  });

  void test('every entry is a stylesheet that exists, named once', async () => {
    const paths = await listed();
    const missing = paths.filter((p) => !p.endsWith('.css') || !existsSync(resolve(SHELL, p)));
    assert.deepEqual(missing, []);
    assert.equal(new Set(paths).size, paths.length, 'a stylesheet is listed twice');
  });

  void test('ScreenOutlet imports it first, where the screens used to be imported', async () => {
    const outlet = await readFile(resolve(SHELL, 'ScreenOutlet.tsx'), 'utf8');
    const firstImport = /^import [^\n]+$/m.exec(outlet)?.[0];
    assert.equal(firstImport, "import './screen-styles.ts';");
  });

  void test('the three sheets the old stylesheet led with come before the palette’s', async () => {
    const shell = await readFile(resolve(dirname(SHELL), 'AppShell.tsx'), 'utf8');
    const at = (needle: string): number => {
      const i = shell.indexOf(needle);
      assert.ok(i >= 0, `AppShell.tsx no longer imports ${needle}`);
      return i;
    };
    const palette = at("from './command/CommandPaletteHost.tsx'");
    for (const sheet of ["'./tooltip/tooltip.css'", "'./icon/icon.css'", "'./states.css'"]) {
      assert.ok(at(sheet) < palette, `${sheet} must be imported before the palette host`);
    }
  });
});
