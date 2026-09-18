/**
 * One `initials`, in one place (LAI-215, closed by LAI-249).
 *
 * Four sites once carried character-identical private copies; a divergence
 * between them is near-invisible — the same person renders `AL` in the
 * sidebar and `AD` on a card and nothing fails. The guard is the AC's own
 * wording: no `function initials` anywhere under `src/` outside
 * `src/theme/initials.ts`.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

void describe('initials has a single source', () => {
  void test('no private copy exists outside src/theme/initials.ts', async () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const files = (await readdir(src, { recursive: true }))
      .filter((f) => typeof f === 'string' && (f.endsWith('.ts') || f.endsWith('.tsx')))
      .map((f) => join(src, f));

    const copies: string[] = [];
    for (const file of files) {
      // `code()` strips comments first, so prose about the function cannot
      // trip the scan — the trap test/helpers/code.ts exists for. Function
      // forms only: `api/projects.ts` legitimately holds a *value* named
      // `initials` (a prefix derivation), which is not a copy of the function.
      const text = code(await readFile(file, 'utf8'));
      if (/function\s+initials\s*\(/.test(text) || /const\s+initials\s*=\s*\(/.test(text)) {
        copies.push(file.slice(src.length));
      }
    }

    assert.deepEqual(
      copies,
      ['theme/initials.ts'],
      'a private initials() copy appeared — import src/theme/initials.ts instead',
    );
  });

  void test('the canonical copy is still there, or the list above proves nothing', async () => {
    const canonical = await readFile(
      new URL('../../src/theme/initials.ts', import.meta.url),
      'utf8',
    );
    assert.match(canonical, /export function initials/);
  });
});
