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
  GLASS_CONTRAST_PAIRS,
  GLASS_SHARED_TOKENS,
  LAYER_TOKENS,
  RADIUS_TOKENS,
  SPACE_TOKENS,
  SHARED_MISC_TOKENS,
  WEIGHT_TOKENS,
} from '../src/theme/token-list.ts';

const TOKENS_CSS = fileURLToPath(new URL('../src/styles/theme.css', import.meta.url));

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
    // mentions of `:root` and `.dk` inside the file's own comments. A theme
    // block's selector list ends in its `:root…` (LAI-1212 puts the preview
    // scope first), so "next is `{`" still finds it.
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

  assert.notEqual(found, 0, `no ${selector} block in theme.css`);
  return out;
}

let light: Map<string, string>;
let dark: Map<string, string>;
let black: Map<string, string>;

void before(async () => {
  const css = await readFile(TOKENS_CSS, 'utf8');
  /*
   * **The polarity flipped with the move to `styles/theme.css`** (LAI-606).
   * Dark is now the bare `:root` — the default theme needs no attribute — and
   * light hangs on `:root[data-theme='light']`. The bare-`:root` scan also
   * collects the shared type/space/radius block, exactly as it used to collect
   * it from the light side; the shared-token filtering below moved with it.
   *
   * `blockVars(':root')` does not swallow the light block: after matching
   * `:root` the parser demands `{` next, and the light selector continues with
   * `[data-theme…`, so it is skipped there and matched by its full name.
   */
  dark = blockVars(css, ':root');
  light = blockVars(css, ":root[data-theme='light']");
  black = blockVars(css, ":root[data-theme='black']");
  assert.ok(
    light.size > 10 && dark.size > 10 && black.size > 10,
    'token blocks look empty — the parser is wrong',
  );
});

void describe('every themed token exists in both themes', () => {
  void test('colour tokens', () => {
    const missingDark = ALL_COLOR_TOKENS.filter((t) => !dark.has(t));
    const missingLight = ALL_COLOR_TOKENS.filter((t) => !light.has(t));
    const missingBlack = ALL_COLOR_TOKENS.filter((t) => !black.has(t));
    assert.deepEqual(missingDark, [], 'listed but missing from the dark block');
    assert.deepEqual(missingBlack, [], 'listed but missing from the black block');
    assert.deepEqual(
      missingLight,
      [],
      'declared in dark but not light — switching theme would strand these at the dark value',
    );
  });

  void test('elevation tokens', () => {
    for (const t of ELEVATION_TOKENS) {
      assert.ok(dark.has(t), `${t} missing from the dark block`);
      assert.ok(light.has(t), `${t} missing from the light block`);
      assert.ok(black.has(t), `${t} missing from the black block`);
    }
  });

  void test('the two themes declare exactly the same names', () => {
    assert.deepEqual([...light.keys()].sort(), [...dark.keys()].filter((k) => light.has(k)).sort());
    assert.deepEqual([...black.keys()].sort(), [...light.keys()].sort(), 'black ≠ light names');
    const onlyDark = [...dark.keys()].filter((k) => !light.has(k));
    // Type, spacing, radius, families and the shared misc tokens are
    // theme-independent and live in the second bare-:root block, so they
    // legitimately appear only on the dark side of this comparison. Everything
    // else appearing only in dark is a stranded theme value.
    const themeIndependent = new Set<string>([
      ...WEIGHT_TOKENS,
      ...SPACE_TOKENS,
      ...RADIUS_TOKENS,
      ...FAMILY_TOKENS,
      ...SHARED_MISC_TOKENS,
      ...GLASS_SHARED_TOKENS,
      ...LAYER_TOKENS,
    ]);
    assert.deepEqual(
      onlyDark.filter((k) => !themeIndependent.has(k)),
      [],
    );
  });
});

void describe('token-list.ts matches tokens.css', () => {
  void test('every listed token is declared', () => {
    const declared = new Set([...light.keys(), ...dark.keys(), ...black.keys()]);
    const listed = [
      ...ALL_COLOR_TOKENS,
      ...ELEVATION_TOKENS,
      ...WEIGHT_TOKENS,
      ...SPACE_TOKENS,
      ...RADIUS_TOKENS,
      ...FAMILY_TOKENS,
      ...SHARED_MISC_TOKENS,
      ...GLASS_SHARED_TOKENS,
      ...LAYER_TOKENS,
    ];
    assert.deepEqual(
      listed.filter((t) => !declared.has(t)),
      [],
      'token-list.ts names tokens that theme.css does not declare',
    );
  });

  void test('every declared token is listed', () => {
    const listed = new Set<string>([
      ...ALL_COLOR_TOKENS,
      ...ELEVATION_TOKENS,
      ...WEIGHT_TOKENS,
      ...SPACE_TOKENS,
      ...RADIUS_TOKENS,
      ...FAMILY_TOKENS,
      ...SHARED_MISC_TOKENS,
      ...GLASS_SHARED_TOKENS,
      ...LAYER_TOKENS,
    ]);
    const unlisted = [...new Set([...light.keys(), ...dark.keys(), ...black.keys()])].filter(
      (t) => !listed.has(t),
    );
    assert.deepEqual(
      unlisted,
      [],
      'theme.css declares tokens token-list.ts does not know about — they would be missing from ' +
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
    const present = fixtures.filter((t) => light.has(t) || dark.has(t) || black.has(t));
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
    ['black', () => black],
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

void describe('glass (LAI-1132)', () => {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  type Rgba = readonly [number, number, number, number];
  const parse = (value: string): Rgba => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex?.[1] !== undefined) {
      const h = hex[1];
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as unknown as Rgba;
    }
    const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value);
    assert.ok(rgba, `expected #rrggbb or rgba() for a composited contrast check, got ${value}`);
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  };
  /** Source-over: the colour a translucent glass actually shows over a backdrop. */
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const a = top[3];
    return [
      top[0] * a + bottom[0] * (1 - a),
      top[1] * a + bottom[1] * (1 - a),
      top[2] * a + bottom[2] * (1 - a),
      1,
    ];
  };
  const luminance = (c: Rgba): number =>
    0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const ratio = (a: Rgba, b: Rgba): number => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  for (const [name, vars] of [
    ['light', () => light],
    ['dark', () => dark],
    ['black', () => black],
  ] as const) {
    for (const pair of GLASS_CONTRAST_PAIRS) {
      void test(`${name}: ${pair.text} on ${pair.glass} over ${pair.backdrop} clears AA`, () => {
        const get = (t: string): string => {
          const v = vars().get(t);
          assert.ok(v !== undefined, `${t} missing in ${name}`);
          return v;
        };
        const glass = parse(get(pair.glass));
        // A glass level that turned opaque would pass while proving nothing
        // about translucency — the point of this check.
        assert.ok(glass[3] < 1, `${pair.glass} is opaque in ${name}; it is not glass`);
        const surface = over(glass, parse(get(pair.backdrop)));
        const r = ratio(parse(get(pair.text)), surface);
        assert.ok(
          r >= 4.5,
          `${pair.text} on ${pair.glass} over ${pair.backdrop} in ${name} is ${r.toFixed(2)}:1 — ` +
            'raise the level’s alpha, not its blur',
        );
      });
    }
  }

  void test('the ambient ground is one calm gradient and --ambient-peak is its extreme', () => {
    // v3 (owner: "keep it simple"): a single linear gradient of at most two
    // stops, each within a hair of the brand canvas — no radial discs, arcs
    // or hazes — and `--ambient-peak` is its worst case: the lightest stop in
    // dark, the darkest in light.
    for (const [name, vars, worse] of [
      ['dark', () => dark, (a: number, b: number) => a > b],
      ['black', () => black, (a: number, b: number) => a > b],
      ['light', () => light, (a: number, b: number) => a < b],
    ] as const) {
      const v = vars();
      const raw = v.get('--ambient-base') ?? '';
      assert.match(
        raw,
        /^linear-gradient\(/,
        `--ambient-base in ${name} is not one linear gradient`,
      );
      assert.equal(
        raw.match(/gradient\(/g)?.length,
        1,
        `--ambient-base in ${name} stacks gradients`,
      );
      assert.doesNotMatch(raw, /radial|conic|rgba/, `--ambient-base in ${name} is not simple`);
      const stops = raw.match(/#[0-9a-f]{6}/gi) ?? [];
      assert.ok(
        stops.length >= 1 && stops.length <= 2,
        `--ambient-base in ${name} has ${String(stops.length)} stops`,
      );
      const canvas = parse(v.get('--bg-canvas') ?? '');
      const peakHex = v.get('--ambient-peak') ?? '';
      const peak = luminance(parse(peakHex));
      assert.ok(
        stops.some((st) => st.toLowerCase() === peakHex.toLowerCase()),
        `--ambient-peak in ${name} is not one of the ground's stops`,
      );
      for (const stop of stops) {
        const c = parse(stop);
        assert.ok(!worse(luminance(c), peak), `${stop} in ${name} passes --ambient-peak`);
        // Low contrast: a tonal shift you sense rather than see.
        assert.ok(
          ratio(c, canvas) <= 1.1,
          `${stop} in ${name} is ${ratio(c, canvas).toFixed(3)}:1 from the canvas — keep it calm`,
        );
      }
      for (const gone of [
        '--ambient-orb-1',
        '--ambient-orb-2',
        '--ambient-orb-3',
        '--ambient-arc',
        '--ambient-rim',
      ]) {
        assert.equal(v.get(gone), undefined, `${gone} is back in ${name}`);
      }
    }
  });

  void test('blur levels rise with elevation and stay under the 32px cap', async () => {
    const css = await readFile(TOKENS_CSS, 'utf8');
    const px = (t: string): number => {
      const m = new RegExp(`${t}:\\s*(\\d+)px;`).exec(css);
      assert.ok(m?.[1] !== undefined, `${t} not declared in px`);
      return Number(m[1]);
    };
    const levels = ['--glass-blur-1', '--glass-blur-2', '--glass-blur-3'].map(px);
    assert.deepEqual(
      [...levels].sort((a, b) => a - b),
      levels,
      'blur must rise with the level',
    );
    for (const b of [...levels, px('--glass-blur-scrim')])
      assert.ok(b <= 32, `${String(b)}px > 32px`);
  });

  void test('layers rise strictly in the listed order; menus and popovers outrank panels (B16)', () => {
    const z = LAYER_TOKENS.map((t) => {
      const v = dark.get(t);
      assert.ok(v !== undefined && /^\d+$/.test(v), `${t} is not an integer layer`);
      return Number(v);
    });
    for (let i = 1; i < z.length; i += 1) {
      assert.ok((z[i] ?? 0) > (z[i - 1] ?? 0), `${LAYER_TOKENS[i] ?? '?'} does not rise`);
    }
    const at = (t: (typeof LAYER_TOKENS)[number]): number => z[LAYER_TOKENS.indexOf(t)] ?? 0;
    assert.ok(at('--layer-menu') > at('--layer-panel'));
    assert.ok(at('--layer-popover') > at('--layer-panel'));
  });
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

void describe('Black is true black (LAI-1212)', () => {
  void test('the canvas is #000000, and every surface above it is a neutral near-black', () => {
    assert.equal(black.get('--bg-canvas'), '#000000');
    assert.equal(black.get('--bg-input'), '#000000');
    for (const t of [
      '--bg-column',
      '--bg-card',
      '--bg-card-hover',
      '--sidebar-tint',
      '--glass-1-solid',
      '--glass-2-solid',
      '--glass-3-solid',
    ]) {
      const v = black.get(t) ?? '';
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
      assert.ok(m, `${t} in black is not opaque hex: ${v}`);
      const [r, g, b] = [m[1], m[2], m[3]].map((c) => parseInt(c ?? '', 16));
      // Neutral: no channel apart from another — a navy step would read as a
      // blue haze on true black.
      assert.ok(r === g && g === b, `${t} in black is tinted: ${v}`);
      // Near-black: elevated, but dark enough to keep the OLED saving.
      assert.ok((r ?? 255) > 0 && (r ?? 255) <= 0x24, `${t} in black is not near-black: ${v}`);
    }
  });

  void test('glass on black is a translucent neutral, never a blue haze', () => {
    for (const t of ['--glass-1', '--glass-2', '--glass-3', '--glass-hover', '--glass-border']) {
      const v = black.get(t) ?? '';
      const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(v);
      assert.ok(m, `${t} in black is not rgba(): ${v}`);
      assert.ok(m[1] === m[2] && m[2] === m[3], `${t} in black is tinted: ${v}`);
      assert.ok(Number(m[4]) < 1, `${t} in black is opaque`);
    }
  });

  void test('surfaces step up from the canvas in order', () => {
    const lum = (hex: string): number => parseInt(hex.slice(1, 3), 16);
    const steps = ['--bg-canvas', '--bg-column', '--bg-card', '--bg-card-hover'].map((t) =>
      lum(black.get(t) ?? '#ffffff'),
    );
    assert.deepEqual(
      [...steps].sort((a, b) => a - b),
      steps,
    );
    assert.equal(new Set(steps).size, steps.length, 'two surfaces share a step');
  });
});
