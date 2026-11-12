/**
 * Glass has one home (LAI-1132).
 *
 * `backdrop-filter` is the most expensive thing a stylesheet can ask a GPU
 * for, and a nested one is both slower and muddier. The rules, held at the
 * source so a stray one fails the build rather than a frame budget:
 *
 *  1. No file in `src/` but `components/glass/glass.css` declares it.
 *  2. Every blur there is a `--glass-blur-*` token, never a literal, and no
 *     token exceeds 32px.
 *  3. Nothing nests: every blurred host is in the reset that strips the blur
 *     from a blurred surface inside chrome, and `GlassSurface` renders solid
 *     when nested.
 *
 * The rendered half — no blurred element with a blurred ancestor on a real
 * screen — is `test/browser/glass.test.ts`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import { glassClass } from '../src/components/glass/glass-level.ts';

const SRC = new URL('../src/', import.meta.url).pathname;
const GLASS = 'components/glass/glass.css';
const THEME = 'styles/theme.css';

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.(css|ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

const glassCss = code(readFileSync(join(SRC, GLASS), 'utf8'));

/** `selector { body }` pairs, top level and inside at-rules alike. */
function rules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').trim(),
    body: m[2] ?? '',
  }));
}

/** Selectors that declare a real blur, outside every at-rule fallback. */
function blurredSelectors(css: string): string[] {
  const top = css.replace(/@(media|supports)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return rules(top)
    .filter((r) => /backdrop-filter:\s*blur/.test(r.body))
    .flatMap((r) => r.selector.split(',').map((s) => s.trim()));
}

void describe('backdrop-filter lives only in glass.css', () => {
  void test('no other file in src/ declares it', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length);
      if (rel === GLASS) continue;
      for (const [i, line] of code(readFileSync(file, 'utf8')).split('\n').entries()) {
        if (/backdrop-filter|backdropFilter/i.test(line)) {
          offenders.push(`${rel}:${String(i + 1)} ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `backdrop-filter outside ${GLASS}`);
  });

  void test('glass.css declares no -webkit- twin', () => {
    // Measured on LAI-1132: the build's minifier folds `-webkit-backdrop-filter`
    // and `backdrop-filter` into one declaration and keeps the last — so a
    // prefixed line after the real one silently turned every blur off in
    // Chromium, which ignores the prefix. Safari has the unprefixed form (18+).
    assert.doesNotMatch(glassCss, /-webkit-backdrop-filter/);
  });

  void test('glass.css itself really blurs (the guard is not guarding an empty file)', () => {
    assert.ok(blurredSelectors(glassCss).length >= 8, 'expected the level panes and scrims');
  });
});

void describe('every blur is a capped token', () => {
  void test('no blur literal in glass.css', () => {
    // Declarations only — `@supports (backdrop-filter: blur(1px))` is a
    // feature query, not a blur anybody sees.
    const declared = [...glassCss.matchAll(/^\s*(?:-webkit-)?backdrop-filter:\s*([^;]+);/gm)];
    assert.ok(declared.length >= 8, 'no backdrop-filter declarations found — the regex is wrong');
    const literals = declared
      .flatMap((d) => [...(d[1] ?? '').matchAll(/blur\((var\([^)]*\)|[^)]*)\)/g)])
      .map((m) => (m[1] ?? '').trim())
      .filter((arg) => !/^var\(--glass-blur-[a-z0-9-]+\)$/.test(arg));
    assert.deepEqual(literals, [], 'blur must be var(--glass-blur-*)');
  });

  void test('no blur token over 32px', () => {
    const theme = readFileSync(join(SRC, THEME), 'utf8');
    const tokens = [...theme.matchAll(/(--glass-blur-[a-z0-9-]+):\s*(\d+)px/g)];
    assert.ok(tokens.length >= 4, 'no blur tokens found — the regex is wrong');
    for (const [, name, px] of tokens)
      assert.ok(Number(px) <= 32, `${name ?? '?'} is ${px ?? '?'}px`);
  });
});

void describe('glass never nests', () => {
  const blurred = blurredSelectors(glassCss);
  const hosts = blurred
    .filter((s) => s.endsWith('::before'))
    .map((s) => s.slice(0, -'::before'.length));

  void test('every blurred host is covered by the nesting reset', () => {
    const reset = rules(glassCss).find(
      (r) => r.selector.startsWith(':is(') && /backdrop-filter:\s*none/.test(r.body),
    );
    assert.ok(reset, 'no `:is(…) :is(…)::before { backdrop-filter: none }` reset in glass.css');
    const [outer, inner] = [...reset.selector.matchAll(/:is\(([^)]*)\)/g)].map((m) =>
      (m[1] ?? '').split(',').map((s) => s.trim()),
    );
    assert.ok(outer && inner, 'the reset must read `:is(containers) :is(floating)::before`');
    // A blurred host that can contain others must be a container in the
    // reset; one that floats must be strippable inside them. Every host is one
    // or the other — a new host that is neither nests unguarded.
    const unguarded = hosts.filter((h) => !outer.includes(h) && !inner.includes(h));
    assert.deepEqual(unguarded, [], 'blurred hosts missing from the nesting reset');
    for (const level of ['.glass-1', '.glass-2', '.glass-3']) {
      assert.ok(outer.includes(level) && inner.includes(level), `${level} must be on both sides`);
    }
  });

  void test('a nested GlassSurface renders solid-on-glass, never a level', () => {
    for (const level of [1, 2, 3] as const) {
      assert.equal(glassClass(level, false), `glass-${String(level)}`);
      assert.equal(glassClass(level, true), 'glass-solid');
    }
    assert.equal(
      glassClass(2, false, { interactive: true, selected: true }),
      'glass-2 glass-interactive glass-selected',
    );
  });

  void test('GlassSurface reads the nesting context it provides', () => {
    const src = code(readFileSync(join(SRC, 'components/glass/GlassSurface.tsx'), 'utf8'));
    assert.ok(
      src.includes('useContext(InsideGlass)'),
      'GlassSurface must read whether it is nested',
    );
    assert.ok(
      src.includes('<InsideGlass.Provider value={true}>'),
      'and tell its children they are',
    );
    assert.ok(src.includes('glassClass(level, nested'), 'and pass that to the class picker');
  });
});

void describe('fallbacks exist', () => {
  for (const [name, at] of [
    ['reduced transparency', '@media (prefers-reduced-transparency: reduce)'],
    ['forced colours', '@media (forced-colors: active)'],
    ['no backdrop-filter support', '@supports not (backdrop-filter: blur(1px))'],
  ] as const) {
    void test(name, () => {
      assert.ok(glassCss.includes(at), `glass.css has no ${at}`);
    });
  }

  void test('one global reduced-motion rule in theme.css', () => {
    const theme = code(readFileSync(join(SRC, THEME), 'utf8'));
    assert.match(
      theme,
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after/,
    );
  });
});
