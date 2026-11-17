/**
 * One icon registry, one icon component (LAI-1204).
 *
 * The registry is the drawing; `Icon` and the pixel-sized `NavIcon` both read
 * it. These pin that there is exactly one copy of the paths, that every nav
 * entry has a glyph, and that `Icon` is decorative unless it is given a name.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { code } from '../../helpers/code.ts';
import { ICON_PATHS, ICON_STROKE } from '../../../src/components/icon/icon-paths.ts';
import { NAV_ICONS } from '../../../src/routes/route-table.ts';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));
const read = (rel: string) => code(readFileSync(`${SRC}${rel}`, 'utf8'));

void describe('the registry', () => {
  void test('draws every sidebar entry', () => {
    for (const name of NAV_ICONS) {
      assert.ok(ICON_PATHS[name].length > 0, `${name} has no drawing`);
    }
  });

  void test('every path is SVG path data on the 24px grid, and none is drawn twice', () => {
    const seen = new Map<string, string>();
    for (const [name, paths] of Object.entries(ICON_PATHS)) {
      assert.ok(paths.length > 0, `${name} is empty`);
      for (const d of paths) {
        assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, `${name}: not path data`);
        assert.match(d, /^[Mm]/, `${name}: a path starts with a move`);
        for (const n of d.match(/-?\d*\.?\d+/g) ?? []) {
          assert.ok(Math.abs(Number(n)) <= 24, `${name}: ${n} is off the 24px grid`);
        }
      }
      const key = paths.join('|');
      assert.ok(!seen.has(key), `${name} is the same drawing as ${seen.get(key) ?? ''}`);
      seen.set(key, name);
    }
  });

  void test('one stroke weight for the family', () => {
    assert.equal(ICON_STROKE, 1.9, 'the sidebar family is drawn at 1.9 (LAI-796)');
  });
});

void describe('one copy of the paths', () => {
  void test('NavIcon reads the registry instead of carrying its own', () => {
    const nav = read('components/sidebar/NavIcon.tsx');
    assert.match(nav, /ICON_PATHS\[name\]/);
    assert.doesNotMatch(nav, /const PATHS/, 'NavIcon has its own path table again');
    assert.doesNotMatch(nav, /'M\d/, 'path data is back inside NavIcon');
  });
});

void describe('Icon is decoration unless it is named', () => {
  const icon = read('components/icon/Icon.tsx');

  void test('aria-hidden by default, role="img" with a label', () => {
    assert.match(icon, /aria-hidden=\{meaningful \? undefined : 'true'\}/);
    assert.match(icon, /role=\{meaningful \? 'img' : undefined\}/);
    assert.match(icon, /aria-label=\{meaningful \? label : undefined\}/);
    // A blank label is no label: it would be an unnamed image.
    assert.match(icon, /label\.trim\(\) !== ''/);
  });

  void test('sizes follow the type scale, not pixels', () => {
    const css = readFileSync(`${SRC}components/icon/icon.css`, 'utf8');
    for (const [size, token] of [
      ['tiny', '--text-small'],
      ['small', '--leading-small'],
      ['body', '--leading-body'],
      ['reading', '--leading-reading'],
    ] as const) {
      assert.match(
        css,
        new RegExp(
          `\\.icon-${size} \\{\\s*width: var\\(${token}\\);\\s*height: var\\(${token}\\);`,
        ),
        `icon-${size} is not ${token}`,
      );
    }
    assert.doesNotMatch(icon, /width=\{|height=\{/, 'Icon took a pixel size');
  });
});
