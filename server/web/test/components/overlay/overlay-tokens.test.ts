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

const declared = rootDeclarations(CSS);

void describe('the CSS and the module say the same thing', () => {
  void test('every layer is declared with its number, and nothing else is', () => {
    const names = Object.keys(LAYER) as LayerName[];
    for (const name of names) {
      assert.equal(declared.get(layerVar(name)), String(LAYER[name]), `${layerVar(name)} differs`);
    }
    const cssLayers = [...declared.keys()].filter((k) => k.startsWith('--layer-')).sort();
    assert.deepEqual(cssLayers, names.map(layerVar).sort(), 'a layer in one file only');
  });

  void test('every motion value is declared with its value, and nothing else is', () => {
    for (const [name, value] of Object.entries(MOTION)) {
      assert.equal(declared.get(`--${name}`), value, `--${name} differs`);
    }
    const cssMotion = [...declared.keys()].filter((k) => k.startsWith('--overlay-')).sort();
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
    const ms = (v: string): number => Number(v.replace(/ms$/, ''));
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
    assert.match(
      CSS,
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.overlay-scrim,\s*\.overlay-dialog,\s*\.overlay-dialog > :not\(\[data-dropdown-panel\]\)\s*\{\s*transition: none;/,
    );
  });
});
