/**
 * The motion system holds (LAI-1208).
 *
 * - `styles/motion.css` declares exactly `MOTION_TOKENS`, and nothing else
 *   declares them: one source, so PR #291's copy in `theme.css` (the same
 *   names and values) turns this red until one of the two is deleted.
 * - No component stylesheet writes a time literal, a `cubic-bezier()` or
 *   `ease-in` in a `transition` or `animation`. Durations and curves come from
 *   the tokens; `ease-in` makes UI start slow at the exact moment it is
 *   watched, and is never what a component wants.
 * - The reduced-motion question is asked once in CSS (`motion.css`) and once
 *   in script (`theme/motion.ts`), plus the named exemptions below — each a
 *   block that repaints a still frame rather than removing motion.
 * - Under reduced motion every token that moves something is zero.
 *
 * Every exemption is proved still needed: one whose reason has gone fails.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from './helpers/code.ts';
import { KEPT_UNDER_REDUCED_MOTION, MOTION_TOKENS } from '../src/theme/motion.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const MOTION_CSS = 'styles/motion.css';

/** Token sheets: they define values, so literals are what they are for. */
const TOKEN_SHEETS = new Set(['styles/motion.css', 'styles/theme.css', 'styles/type.css']);

/**
 * Component stylesheets allowed a raw time literal, each with the reason and
 * the change that retires it.
 */
const RAW_TIMING_EXEMPT: Readonly<Record<string, string>> = {};

/** Stylesheets allowed their own `prefers-reduced-motion` block, and why. */
const REDUCED_MOTION_EXEMPT: Readonly<Record<string, string>> = {
  'routes/screens/board/board-motion.css':
    'the arrival glow is held for 3.6s with steps(1, end), not faded: the state, not travel',
  'components/states.css': 'a still spinner closes its gap, or a gapped ring reads as broken',
  'routes/screens/my-day/day-skeleton.css': 'a still sheen is a stripe; the gradient is dropped',
  'components/brand/brand.css':
    'its loops run on --motion-* (LAI-1126), not these tokens: paused on the first frame, ' +
    'and the splash lights its first step so it does not read as empty',
};

async function stylesheets(): Promise<Map<string, string>> {
  const files = (await readdir(SRC, { recursive: true }))
    .filter((f): f is string => typeof f === 'string' && f.endsWith('.css'))
    .sort();
  const out = new Map<string, string>();
  for (const f of files) {
    out.set(
      relative(SRC, join(SRC, f)).split('\\').join('/'),
      await readFile(join(SRC, f), 'utf8'),
    );
  }
  return out;
}

async function scripts(): Promise<Map<string, string>> {
  const files = (await readdir(SRC, { recursive: true }))
    .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f))
    .sort();
  const out = new Map<string, string>();
  for (const f of files) {
    out.set(f.split('\\').join('/'), await readFile(join(SRC, f), 'utf8'));
  }
  return out;
}

/** Every `transition*` / `animation*` declaration's value, with its line. */
function motionDeclarations(css: string): { prop: string; value: string; line: number }[] {
  const stripped = code(css);
  const out: { prop: string; value: string; line: number }[] = [];
  for (const m of stripped.matchAll(
    /(?:^|[;{\s])((?:transition|animation)(?:-[a-z-]+)?)\s*:\s*([^;{}]+)/g,
  )) {
    const line = stripped.slice(0, m.index).split('\n').length;
    out.push({ prop: m[1] ?? '', value: (m[2] ?? '').trim(), line });
  }
  return out;
}

const TIME = /(?<![\w-])\d*\.?\d+m?s\b/;

/** Why a declaration breaks the rule, or null. */
function offence(value: string): string | null {
  if (TIME.test(value)) return 'a time literal';
  if (value.includes('cubic-bezier(')) return 'a cubic-bezier()';
  if (/(?<![\w-])ease-in(?![\w-])/.test(value)) return 'ease-in';
  return null;
}

/** Custom properties declared in a block body. */
function declared(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of code(body).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return out;
}

void describe('motion tokens: one source', () => {
  void test('motion.css declares exactly MOTION_TOKENS on :root', async () => {
    const css = (await stylesheets()).get(MOTION_CSS);
    assert.ok(css !== undefined, `${MOTION_CSS} is missing`);
    const root = /^:root\s*\{([^}]*)\}/m.exec(code(css));
    assert.ok(root, 'no top-level :root block in motion.css');
    assert.deepEqual([...declared(root[1] ?? '').keys()], [...MOTION_TOKENS]);
  });

  void test('no other stylesheet declares a motion token', async () => {
    const owners: string[] = [];
    for (const [file, css] of await stylesheets()) {
      if (file === MOTION_CSS) continue;
      for (const name of declared(css).keys()) {
        if ((MOTION_TOKENS as readonly string[]).includes(name)) owners.push(`${file}: ${name}`);
      }
    }
    assert.deepEqual(owners, [], 'motion tokens are declared outside styles/motion.css');
  });

  void test('index.css imports motion.css, once', async () => {
    const index = code((await stylesheets()).get('index.css') ?? '');
    assert.equal(index.match(/@import\s+'\.\/styles\/motion\.css';/g)?.length, 1);
  });

  void test('the shared colour transition runs at --duration-fast', async () => {
    // `--transition` lives in theme.css (colour, not movement). Its duration
    // is the fast token's value, so the two cannot drift apart unnoticed.
    const sheets = await stylesheets();
    const fast = /--duration-fast:\s*([^;]+);/.exec(sheets.get(MOTION_CSS) ?? '')?.[1];
    const shared = /--transition:\s*([^;]+);/.exec(code(sheets.get('styles/theme.css') ?? ''))?.[1];
    assert.ok(fast !== undefined && shared !== undefined, 'a token is missing');
    const times = shared.match(/\d*\.?\d+m?s\b/g) ?? [];
    assert.ok(times.length > 0, `--transition has no duration: ${shared}`);
    assert.deepEqual(new Set(times), new Set([fast.trim()]));
  });
});

void describe('component CSS uses the tokens', () => {
  void test('no raw time, cubic-bezier() or ease-in in a transition or animation', async () => {
    const found: string[] = [];
    for (const [file, css] of await stylesheets()) {
      if (TOKEN_SHEETS.has(file) || file in RAW_TIMING_EXEMPT) continue;
      for (const d of motionDeclarations(css)) {
        const why = offence(d.value);
        if (why !== null) found.push(`${file}:${String(d.line)} ${d.prop}: ${d.value} — ${why}`);
      }
    }
    assert.deepEqual(found, [], 'use the --duration-* and --ease-* tokens from styles/motion.css');
  });

  void test('the instrument sees an offence', () => {
    // A scanner that matched nothing would pass the test above for free.
    const probe = motionDeclarations(
      '.a { transition: opacity 120ms ease; }\n.b{animation:x 1.4s cubic-bezier(0,0,1,1) infinite}\n' +
        '.c { transition: transform var(--duration-fast) ease-in; }\n' +
        '.d { transition: transform var(--duration-fast) var(--ease-standard); }',
    ).map((d) => offence(d.value));
    assert.deepEqual(probe, ['a time literal', 'a time literal', 'ease-in', null]);
  });

  void test('every timing exemption still has a literal to exempt', async () => {
    const sheets = await stylesheets();
    for (const [file, why] of Object.entries(RAW_TIMING_EXEMPT)) {
      const css = sheets.get(file);
      assert.ok(css !== undefined, `${file} is gone: drop its exemption (${why})`);
      assert.ok(
        motionDeclarations(css).some((d) => offence(d.value) !== null),
        `${file} is on the tokens now: drop its exemption (${why})`,
      );
    }
  });
});

void describe('reduced motion: asked once', () => {
  void test('only motion.css and the named exemptions write the media query', async () => {
    const writers = [...(await stylesheets())]
      .filter(([, css]) => code(css).includes('prefers-reduced-motion'))
      .map(([file]) => file);
    assert.deepEqual(writers.sort(), [MOTION_CSS, ...Object.keys(REDUCED_MOTION_EXEMPT)].sort());
  });

  void test('no exempt block turns an animation or transition off itself', async () => {
    // The global rule removes the motion; an exempt block only repaints.
    const sheets = await stylesheets();
    for (const file of Object.keys(REDUCED_MOTION_EXEMPT)) {
      const css = code(sheets.get(file) ?? '');
      const at = css.indexOf('prefers-reduced-motion');
      const block = css.slice(at, css.indexOf('\n}', at));
      assert.doesNotMatch(
        block,
        /(animation|transition)\s*:\s*none/,
        `${file} switches motion off locally`,
      );
    }
  });

  void test('script asks through theme/motion.ts only', async () => {
    const askers = [...(await scripts())]
      .filter(([, src]) => code(src).includes('prefers-reduced-motion'))
      .map(([file]) => file);
    assert.deepEqual(askers, ['theme/motion.ts']);
  });

  void test('every moving token is zero under reduced motion, and only those', async () => {
    const css = code((await stylesheets()).get(MOTION_CSS) ?? '');
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css);
    assert.ok(media, 'no reduced-motion :root block in motion.css');
    const zeroed = declared(media[1] ?? '');
    for (const [name, value] of zeroed) assert.equal(value, '0ms', `${name} is not zero`);
    const expected = MOTION_TOKENS.filter((t) => !KEPT_UNDER_REDUCED_MOTION.includes(t));
    assert.deepEqual([...zeroed.keys()], expected);
  });

  void test('loops not on a token are stopped by the backstop', async () => {
    const css = code((await stylesheets()).get(MOTION_CSS) ?? '');
    assert.match(css, /animation-iteration-count:\s*1\s*!important/);
  });
});
