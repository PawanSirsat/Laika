/**
 * Guards the radius scale (LAI-1220).
 *
 * Every corner in `src/` comes from one ladder of `--radius-*` tokens in
 * `styles/theme.css`'s shared block. Before this the census counted 273
 * `border-radius` declarations with a raw length across 37 distinct values;
 * the scale absorbed them (`visual-language.md` §4.4), so a new raw radius is
 * a new rung nobody chose.
 *
 * Allowed in a `border-radius` (or a longhand corner): a listed token, `0`,
 * and the CSS-wide keywords. A circle is `--radius-round` and a pill
 * `--radius-pill`, never `50%` or `999px` typed again.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import {
  SRC,
  TOKEN_SHEETS,
  declarations,
  rawLengths,
  scripts,
  stylesheets,
} from './helpers/stylesheets.ts';
import { RADIUS_TOKENS } from '../src/theme/token-list.ts';

const RADIUS_PROP = /border(?:-[a-z]+)*-radius/;

/**
 * Declarations allowed a raw length, by file, each value with its reason. The
 * guard fails when one of these goes away, so the list cannot outlive its
 * cause.
 */
const RADIUS_EXEMPT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'components/documents/documents.css': {
    'calc(var(--radius-control) - 2px)': 'nested corner: the control radius less its 2px inset',
  },
  'routes/screens/appearance/appearance.css': {
    'calc(var(--radius-control) - 3px)': 'nested corner: the control radius less its 3px inset',
  },
  'routes/screens/usage/usage.css': {
    'calc(var(--radius-control) - 2px)': 'nested corner: the control radius less its 2px inset',
  },
  // The Segmented control's options inside its 2px-inset track (LAI-1222).
  'components/kpi/kpi.css': {
    'calc(var(--radius-control) - 2px)': 'nested corner: the control radius less its 2px inset',
  },
};

/** Why a radius value breaks the rule, or null. */
function offence(value: string): string | null {
  const raw = rawLengths(value);
  if (raw.length > 0) return `raw ${raw.join(', ')}`;
  const unknown = [...value.matchAll(/var\((--[a-z0-9-]+)/g)]
    .map((m) => m[1] ?? '')
    .filter((t) => !(RADIUS_TOKENS as readonly string[]).includes(t));
  if (unknown.length > 0) return `not a radius token: ${unknown.join(', ')}`;
  return null;
}

void describe('radius: one scale', () => {
  void test('every border-radius is a token, 0 or a keyword', async () => {
    const found: string[] = [];
    for (const [file, css] of await stylesheets()) {
      if (TOKEN_SHEETS.has(file)) continue;
      for (const d of declarations(css, RADIUS_PROP)) {
        const why = offence(d.value);
        if (why === null || RADIUS_EXEMPT[file]?.[d.value] !== undefined) continue;
        found.push(`${file}:${String(d.line)} ${d.prop}: ${d.value} — ${why}`);
      }
    }
    assert.deepEqual(found, [], 'use a --radius-* token from styles/theme.css');
  });

  void test('the instrument sees an offence', () => {
    // A scanner that matched nothing would pass the test above for free.
    const probe = declarations(
      '.a { border-radius: 6px; }\n.b{border-top-left-radius:50%}\n.c { border-radius: 0.5rem 0; }\n' +
        '.d { border-radius: var(--radius-card) 0; }\n.e { border-radius: var(--space-2); }\n' +
        '.f { border-radius: inherit; }',
      RADIUS_PROP,
    ).map((d) => offence(d.value));
    assert.deepEqual(probe, [
      'raw 6px',
      'raw 50%',
      'raw 0.5rem',
      null,
      'not a radius token: --space-2',
      null,
    ]);
  });

  void test('every exemption still has its declaration', async () => {
    const sheets = await stylesheets();
    for (const [file, values] of Object.entries(RADIUS_EXEMPT)) {
      const css = sheets.get(file);
      assert.ok(css !== undefined, `${file} is gone: drop its exemption`);
      const present = new Set(declarations(css, RADIUS_PROP).map((d) => d.value));
      for (const [value, why] of Object.entries(values)) {
        assert.ok(present.has(value), `${file} no longer has "${value}": drop it (${why})`);
        assert.notEqual(offence(value), null, `${file} "${value}" is clean now: drop it`);
      }
    }
  });
});

void describe('radius: names from both sides', () => {
  void test('every radius token used in src/ is declared, and every declared one is used', async () => {
    const theme = code(await readFile(join(SRC, 'styles/theme.css'), 'utf8'));
    const declared = new Set([...theme.matchAll(/(--radius-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    assert.deepEqual([...declared].sort(), [...RADIUS_TOKENS].sort(), 'theme.css ≠ RADIUS_TOKENS');

    const used = new Set<string>();
    const sources = [...(await stylesheets()), ...(await scripts())];
    for (const [file, text] of sources) {
      if (file === 'styles/theme.css') continue;
      for (const m of code(text).matchAll(/var\((--radius-[a-z0-9-]+)/g)) used.add(m[1] ?? '');
    }
    assert.deepEqual(
      [...used].filter((t) => !declared.has(t)).sort(),
      [],
      'a var(--radius-*) names a token theme.css does not declare',
    );
    assert.deepEqual(
      [...declared].filter((t) => t !== undefined && !used.has(t)).sort(),
      [],
      'a radius token nothing uses: drop it or use it',
    );
  });
});
