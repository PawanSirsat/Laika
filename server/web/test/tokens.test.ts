/**
 * Guards the token contract (LAI-018).
 *
 * Two failure modes, both silent without a test:
 *  - a token added to `tokens.css` in one theme and not the other, so switching
 *    themes strands it at the previous theme's value;
 *  - `token-list.ts` drifting from `tokens.css`, so the reference page and the
 *    contrast check stop covering what actually ships.
 *
 * Node's built-in runner with native TypeScript — no test framework, no new
 * dependency.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// These return promises; the repo's no-floating-promises rule is on, so each
// call is prefixed with `void`.
import { before, describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import {
  ALL_COLOR_TOKENS,
  CONTRAST_PAIRS,
  ELEVATION_TOKENS,
  FAMILY_TOKENS,
  RADIUS_TOKENS,
  SPACE_TOKENS,
  TYPE_TOKENS,
  WEIGHT_TOKENS,
} from '../src/theme/token-list.ts';

const TOKENS_CSS = fileURLToPath(new URL('../src/theme/tokens.css', import.meta.url));

/**
 * Custom properties declared under a selector, across **every** block using it.
 *
 * tokens.css has two `:root` blocks — the light palette and the
 * theme-independent type/space/radius scales. Reading only the first silently
 * drops half the inventory, which is exactly what this parser did on its first
 * run.
 */
function blockVars(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  let cursor = 0;
  let found = 0;

  for (;;) {
    const at = css.indexOf(selector, cursor);
    if (at === -1) break;
    cursor = at + selector.length;

    // Only a selector when the very next thing is its block. This skips the
    // mentions of `:root` and `.dk` inside the file's own comments.
    const opens = /^\s*\{/.exec(css.slice(cursor));
    if (!opens) continue;

    found += 1;
    let i = cursor + opens[0].length;
    const from = i;
    let depth = 1;

    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }

    for (const m of css.slice(from, i - 1).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      if (m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2].trim());
    }
    cursor = i;
  }

  assert.notEqual(found, 0, `no ${selector} block in tokens.css`);
  return out;
}

let light: Map<string, string>;
let dark: Map<string, string>;

void before(async () => {
  const css = await readFile(TOKENS_CSS, 'utf8');
  light = blockVars(css, ':root');
  dark = blockVars(css, '.dk');
  assert.ok(light.size > 10 && dark.size > 10, 'token blocks look empty — the parser is wrong');
});

void describe('every themed token exists in both themes', () => {
  void test('colour tokens', () => {
    const missingDark = ALL_COLOR_TOKENS.filter((t) => !dark.has(t));
    const missingLight = ALL_COLOR_TOKENS.filter((t) => !light.has(t));
    assert.deepEqual(missingLight, [], 'declared in .dk but not :root');
    assert.deepEqual(
      missingDark,
      [],
      'declared in :root but not .dk — switching to dark would leave these at the light value',
    );
  });

  void test('elevation tokens', () => {
    for (const t of ELEVATION_TOKENS) {
      assert.ok(light.has(t), `${t} missing from :root`);
      assert.ok(dark.has(t), `${t} missing from .dk`);
    }
  });

  void test('the two themes declare exactly the same names', () => {
    assert.deepEqual([...dark.keys()].sort(), [...light.keys()].filter((k) => dark.has(k)).sort());
    const onlyLight = [...light.keys()].filter((k) => !dark.has(k));
    // Type, spacing and radius are theme-independent and live in the second
    // :root block, so they legitimately appear only in light. Everything else
    // appearing only in light is a bug.
    const themeIndependent = new Set<string>([
      ...TYPE_TOKENS,
      ...WEIGHT_TOKENS,
      ...SPACE_TOKENS,
      ...RADIUS_TOKENS,
      ...FAMILY_TOKENS,
    ]);
    assert.deepEqual(
      onlyLight.filter((k) => !themeIndependent.has(k)),
      [],
    );
  });
});

void describe('token-list.ts matches tokens.css', () => {
  void test('every listed token is declared', () => {
    const declared = new Set([...light.keys(), ...dark.keys()]);
    const listed = [
      ...ALL_COLOR_TOKENS,
      ...ELEVATION_TOKENS,
      ...TYPE_TOKENS,
      ...WEIGHT_TOKENS,
      ...SPACE_TOKENS,
      ...RADIUS_TOKENS,
      ...FAMILY_TOKENS,
    ];
    assert.deepEqual(
      listed.filter((t) => !declared.has(t)),
      [],
      'token-list.ts names tokens that tokens.css does not declare',
    );
  });

  void test('every declared token is listed', () => {
    const listed = new Set<string>([
      ...ALL_COLOR_TOKENS,
      ...ELEVATION_TOKENS,
      ...TYPE_TOKENS,
      ...WEIGHT_TOKENS,
      ...SPACE_TOKENS,
      ...RADIUS_TOKENS,
      ...FAMILY_TOKENS,
    ]);
    const unlisted = [...new Set([...light.keys(), ...dark.keys()])].filter((t) => !listed.has(t));
    assert.deepEqual(
      unlisted,
      [],
      'tokens.css declares tokens token-list.ts does not know about — they would be missing from ' +
        'the reference page and unchecked for contrast',
    );
  });
});

void describe('no per-person avatar colours shipped', () => {
  void test('the mockup fixtures are absent', () => {
    // --mk --ta --sv --jd --rb are five named people in the prototype.
    // Avatar colours are derived from the user id at render (docs/design/
    // README.md). There is no `avatar_color` column to read — §4.1 has not had
    // one since LAI-148, and this comment cited it until LAI-153.
    const fixtures = ['--mk', '--ta', '--sv', '--jd', '--rb'];
    const present = fixtures.filter((t) => light.has(t) || dark.has(t));
    assert.deepEqual(present, [], 'per-person colour fixtures must not ship');
  });
});

void describe('WCAG AA — body and secondary text on their own surfaces', () => {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const luminance = (hex: string): number => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };

  const contrast = (a: string, b: string): number => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  for (const [name, vars] of [
    ['light', () => light],
    ['dark', () => dark],
  ] as const) {
    for (const pair of CONTRAST_PAIRS) {
      void test(`${name}: ${pair.text} on ${pair.background}`, () => {
        const fg = vars().get(pair.text);
        const bg = vars().get(pair.background);
        assert.ok(fg !== undefined && bg !== undefined, 'token missing');
        assert.ok(
          fg.startsWith('#') && bg.startsWith('#'),
          'expected opaque hex for a contrast check',
        );

        const ratio = contrast(fg, bg);
        assert.ok(
          ratio >= 4.5,
          `${pair.text} on ${pair.background} in ${name} is ${ratio.toFixed(2)}:1, below WCAG AA (4.5:1). ` +
            'The design is the contract — report this to PM rather than adjusting the token.',
        );
      });
    }
  }
});

void describe('every var(--token) a stylesheet uses is actually defined', () => {
  void test('no stylesheet reaches for a token that does not exist', async () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const files = (await readdir(src, { recursive: true }))
      .filter((f) => typeof f === 'string' && f.endsWith('.css'))
      .map((f) => join(src, f));

    const defined = new Set<string>();
    const used = new Map<string, string>();
    for (const file of files) {
      const css = await readFile(file, 'utf8');
      for (const [, name] of css.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)) {
        if (name !== undefined) defined.add(name);
      }
      for (const [, name] of css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
        if (name !== undefined && !used.has(name)) used.set(name, file);
      }
    }

    // A misspelt token is not a build error and not a lint error: the property
    // silently keeps its inherited value, so muted text renders un-muted and
    // nothing anywhere says so. `--fg-muted` for `--tx2` got this far once.
    const missing = [...used].filter(([name]) => !defined.has(name));
    assert.deepEqual(
      missing.map(([name, file]) => `${name} (${file.slice(src.length)})`),
      [],
      'these tokens are used but never defined',
    );
  });
});

void describe('the theme is one shared value, not one per component', () => {
  void test('useTheme reads a store rather than holding its own state', async () => {
    const src = code(await readFile(new URL('../src/theme/use-theme.ts', import.meta.url), 'utf8'));

    // Per-component `useState` here is a silent bug, and an unusually
    // convincing one. Toggling the theme puts `.dk` on the document, so
    // everything coloured by CSS variables changes and the app looks correct —
    // while every colour computed in JS from `theme` (each `avatarColor()`
    // call) keeps rendering the previous palette. Dark mode gets light-theme
    // avatars: pale chips with dark text, on every screen that draws a person.
    assert.ok(
      src.includes('useSyncExternalStore'),
      'useTheme must read a shared store so all consumers see one theme',
    );
    assert.ok(
      !src.includes('useState'),
      'per-component state here leaves every other consumer stale on a toggle',
    );
  });

  void test('every JS consumer of the theme goes through the hook', async () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const files = (await readdir(src, { recursive: true }))
      .filter((f) => typeof f === 'string' && (f.endsWith('.tsx') || f.endsWith('.ts')))
      .filter((f) => !f.startsWith('theme/'))
      .map((f) => join(src, f));

    // `avatarColor(id, theme)` is only correct if `theme` is live. Two ways to
    // get a live one: call the hook, or take it as a prop from a parent that
    // did. Anything else — reading the stored preference, defaulting the
    // argument away — reintroduces exactly the staleness the store removes.
    const offenders: string[] = [];
    for (const file of files) {
      const text = code(await readFile(file, 'utf8'));
      if (!text.includes('avatarColor(')) continue;
      const live = text.includes('useTheme()') || text.includes('readonly theme: Theme');
      if (!live) offenders.push(file.slice(src.length));
    }
    assert.deepEqual(offenders, [], 'these compute an avatar colour without a live theme');

    // And the preference is never read outside the theme module — that is the
    // back door round the store.
    const backdoors: string[] = [];
    for (const file of files) {
      const text = code(await readFile(file, 'utf8'));
      if (text.includes('readPreference(')) backdoors.push(file.slice(src.length));
    }
    assert.deepEqual(backdoors, [], 'read the theme through the hook, not from storage');
  });
});
