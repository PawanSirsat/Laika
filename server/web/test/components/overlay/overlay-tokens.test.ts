/**
 * The overlay layers and motion (LAI-1205): one list in `overlay-tokens.ts`,
 * the same numbers as custom properties in `overlay.css`, and the order that
 * keeps a menu over the panel it opened from (B16).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  LAYER,
  MOTION,
  layerVar,
  type LayerName,
} from '../../../src/components/overlay/overlay-tokens.ts';
import { KEPT_UNDER_REDUCED_MOTION } from '../../../src/theme/motion.ts';

const CSS = readFileSync(
  new URL('../../../src/components/overlay/overlay.css', import.meta.url),
  'utf8',
);

/** Every `--name: value;` declared in the file's `:root` block. */
function rootDeclarations(css: string): Map<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  assert.ok(root, 'overlay.css declares no :root block — this test proves nothing');
  const found = new Map<string, string>();
  for (const match of (root[1] ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return found;
}

const MOTION_CSS = readFileSync(new URL('../../../src/styles/motion.css', import.meta.url), 'utf8');
const MOTION_ROOT = rootDeclarations(MOTION_CSS);
const THEME = readFileSync(new URL('../../../src/styles/theme.css', import.meta.url), 'utf8');

/*
 * One ladder (merge train): the shared layer names are theme.css's (LAI-1132)
 * and overlay.css declares only the overlays' own — never the same name twice.
 */
const own = rootDeclarations(CSS);
const theme = new Map(
  [...THEME.matchAll(/(--layer-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(
    (m) => [m[1] ?? '', (m[2] ?? '').trim()] as const,
  ),
);
assert.ok(theme.size > 0, 'theme.css declares no layers — this test proves nothing');
const declared = new Map([...theme].filter(([k]) => k.startsWith('--layer-')).concat([...own]));

void test("overlay.css redeclares none of theme.css's layers", () => {
  const twice = [...own.keys()].filter((k) => k.startsWith('--layer-') && theme.has(k));
  assert.deepEqual(twice, []);
});

void describe('the CSS and the module say the same thing', () => {
  void test('every layer is declared with its number, and nothing else is', () => {
    const names = Object.keys(LAYER) as LayerName[];
    for (const name of names) {
      assert.equal(declared.get(layerVar(name)), String(LAYER[name]), `${layerVar(name)} differs`);
    }
    // Every overlay-only layer is the module's; theme.css may hold more (sidebar…).
    const cssLayers = [...own.keys()].filter((k) => k.startsWith('--layer-')).sort();
    assert.deepEqual(
      cssLayers,
      names
        .map(layerVar)
        .filter((v) => !theme.has(v))
        .sort(),
      'a layer in one file only',
    );
  });

  void test('every motion value is declared with its value, and nothing else is', () => {
    for (const [name, value] of Object.entries(MOTION)) {
      assert.equal(declared.get(`--${name}`), value, `--${name} differs`);
    }
    const cssMotion = [...own.keys()].filter((k) => k.startsWith('--overlay-')).sort();
    assert.deepEqual(
      cssMotion,
      Object.keys(MOTION)
        .map((n) => `--${n}`)
        .sort(),
    );
  });

  void test('layerVar spells the CSS name', () => {
    assert.equal(layerVar('panelScrim'), '--layer-panel-scrim');
    assert.equal(layerVar('dialog'), '--layer-dialog');
  });
});

void describe('the order', () => {
  void test('a picker outranks every surface it can open from (B16)', () => {
    for (const from of ['popover', 'sheetContent', 'panel', 'nested'] as const) {
      assert.ok(LAYER.dropdown > LAYER[from], `dropdown (${String(LAYER.dropdown)}) ≤ ${from}`);
    }
  });

  void test('a modal outranks the panel and the picker; the toast outranks the modal', () => {
    assert.ok(LAYER.dialog > LAYER.dropdown);
    assert.ok(LAYER.dialog > LAYER.nested);
    assert.ok(LAYER.toast > LAYER.dialog);
  });

  void test('every scrim sits directly under its surface', () => {
    assert.equal(LAYER.popover - LAYER.catcher, 1);
    assert.equal(LAYER.panel - LAYER.panelScrim, 1);
    assert.equal(LAYER.nested - LAYER.nestedScrim, 1);
  });

  void test('the modal stacks by depth in steps of two, from the dialog layer', () => {
    assert.match(
      CSS,
      /\.overlay-layer\s*\{[^}]*z-index:\s*calc\(var\(--layer-dialog\) \+ var\(--overlay-depth\) \* 2\)/,
    );
  });
});

void describe('the motion', () => {
  void test('stays inside the review bands: a menu ≤ 200ms, a dialog ≤ 300ms', () => {
    // Durations are motion.css tokens (LAI-1208): read the value they name.
    const ms = (v: string): number => {
      const token = /^var\((--[a-z-]+)\)$/.exec(v)?.[1];
      const raw = token === undefined ? v : (MOTION_ROOT.get(token) ?? 'NaN');
      return Number(raw.replace(/ms$/, ''));
    };
    assert.ok(ms(MOTION['overlay-menu-in']) >= 120 && ms(MOTION['overlay-menu-in']) <= 200);
    assert.ok(ms(MOTION['overlay-in']) >= 150 && ms(MOTION['overlay-in']) <= 300);
    assert.ok(ms(MOTION['overlay-sheet-in']) <= 300);
    assert.ok(ms(MOTION['overlay-scrim-in']) <= ms(MOTION['overlay-in']));
  });

  void test('never from nothing: the starting scale is 0.9 or more', () => {
    assert.ok(Number(MOTION['overlay-scale']) >= 0.9);
    assert.ok(Number(MOTION['overlay-menu-scale']) >= 0.9);
  });

  void test('animates opacity and transform only, and none under reduced motion', () => {
    for (const match of CSS.matchAll(/transition:\s*([^;]+);/g)) {
      const value = match[1] ?? '';
      if (value.trim() === 'none') continue;
      const properties = value.split(',').map((part) => part.trim().split(/\s+/)[0]);
      for (const property of properties) {
        assert.ok(
          property === 'opacity' || property === 'transform',
          `transitions ${String(property)}`,
        );
      }
    }
    // None under reduced motion: every duration is a motion.css token that
    // motion.css zeroes (LAI-1208), the one place the question is asked.
    for (const name of ['overlay-in', 'overlay-scrim-in', 'overlay-menu-in', 'overlay-sheet-in']) {
      const token = /^var\((--duration-[a-z]+)\)$/.exec(MOTION[name as keyof typeof MOTION])?.[1];
      assert.ok(token !== undefined, `${name} is not on a duration token`);
      assert.ok(!KEPT_UNDER_REDUCED_MOTION.includes(token), `${token} is kept under reduce`);
    }
    assert.ok(!CSS.includes('prefers-reduced-motion'), 'overlay.css asks the question again');
  });
});
