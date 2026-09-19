/**
 * One file owns colour (LAI-606).
 *
 * The brief's architectural requirement: adding a theme must be one block in
 * `styles/theme.css` and nothing else. That only stays true if no colour can
 * be written anywhere else — a single `#fff` in a component is a value no
 * theme can reach, and it will look wrong in exactly the theme nobody tested.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;
const THEME = 'styles/theme.css';

/**
 * The one exemption, and why it cannot be a token.
 *
 * `avatar-color.ts` *computes* a colour from a hash of the user id — the hue
 * is per-person and unbounded, so there is no finite list of values a theme
 * could declare. It is the generator, not a palette. It still honours the
 * theme: it takes the light/dark branch, and its text colour is
 * `var(--on-accent)`.
 */
const EXEMPT = ['theme/avatar-color.ts'];

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

/**
 * Comments are prose, not colour.
 *
 * Several files *describe* a measured value — "both computed `rgba(0, 0, 0, 0)`
 * fill" — and a check that fails on those is a check somebody disables within
 * a week. Strip comments, then look.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.(css|ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

void describe('colour lives in exactly one file', () => {
  void test('no component writes a colour literal', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length);
      if (rel === THEME || EXEMPT.includes(rel)) continue;

      for (const [i, line] of code(readFileSync(file, 'utf8')).split('\n').entries()) {
        if (COLOUR.test(line)) offenders.push(`${rel}:${String(i + 1)} ${line.trim()}`);
      }
    }

    assert.deepEqual(offenders, [], `colour outside ${THEME}`);
  });

  void test('every theme block declares the same tokens', () => {
    /*
     * The invariant that makes a theme swappable. A token declared in one
     * block and not another is a component that renders correctly until
     * somebody switches theme — the worst kind of bug to find, because the
     * code that breaks is nowhere near the code that is wrong.
     */
    const theme = readFileSync(join(SRC, THEME), 'utf8');
    const blocks = [...theme.matchAll(/(:root(?:\[data-theme='[a-z]+'\])?)\s*\{([\s\S]*?)\n\}/g)];
    const colourBlocks = blocks.filter(([, , body]) => COLOUR.test(code(body ?? '')));

    assert.ok(colourBlocks.length >= 2, 'expected at least a dark and a light block');

    /*
     * `noUncheckedIndexedAccess` makes every capture `string | undefined`, and
     * a `!` here would be the assertion this test exists to avoid. A regex that
     * matched but captured nothing is exactly the silent-pass case, so it is
     * filtered rather than asserted away.
     */
    const names = colourBlocks.map(
      ([, , body]) =>
        new Set(
          [...code(body ?? '').matchAll(/^\s+(--[a-z0-9-]+):/gm)]
            .map((m) => m[1])
            .filter((name): name is string => name !== undefined),
        ),
    );
    const first = names[0];
    assert.ok(first, 'no theme block parsed');
    // A block that parsed to zero tokens would compare equal to another empty
    // one and pass while proving nothing.
    assert.ok(first.size > 20, `only ${String(first.size)} tokens parsed — check the regex`);

    for (const [i, set] of names.entries()) {
      const selector = colourBlocks[i]?.[1] ?? '?';
      assert.deepEqual(
        [...set].sort(),
        [...first].sort(),
        `${selector} does not declare the same tokens as the first theme block`,
      );
    }
  });
});
