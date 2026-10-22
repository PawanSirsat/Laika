/**
 * A space's colour (D-103 item 4, LAI-978): eight palette names, each a token
 * in both themes, each carrying a white letter at WCAG AA.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { SPACE_COLORS, spaceColor, spaceColorVar } from '../../src/theme/space-color.ts';

const CSS = readFileSync(new URL('../../src/styles/theme.css', import.meta.url), 'utf8');

/** The declarations of the first block opened by `selector`. */
function block(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no ${selector} block`);
  const body = CSS.slice(start, CSS.indexOf('\n}', start));
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) vars.set(m[1]!, m[2]!.trim());
  return vars;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

void describe('space colours', () => {
  void test('the eight names are the design palette', () => {
    assert.deepEqual(
      [...SPACE_COLORS],
      ['black', 'violet', 'teal', 'blue', 'amber', 'magenta', 'red', 'green'],
    );
  });

  for (const [name, selector] of [
    ['dark', ':root'],
    ['light', ":root[data-theme='light']"],
  ] as const) {
    void test(`every fill clears AA under its letter in ${name}`, () => {
      const vars = block(selector);
      const letter = vars.get('--on-space');
      assert.ok(letter !== undefined, `--on-space missing in ${name}`);
      for (const color of SPACE_COLORS) {
        const fill = vars.get(`--space-${color}`);
        assert.ok(fill !== undefined, `--space-${color} missing in ${name}`);
        const r = ratio(letter, fill);
        assert.ok(r >= 4.5, `--on-space on --space-${color} in ${name} is ${r.toFixed(2)}:1`);
      }
    });
  }

  void test('a stored colour is used as stored', () => {
    assert.equal(spaceColor({ slug: 'anything', color: 'teal' }), 'teal');
    assert.equal(spaceColorVar('teal'), 'var(--space-teal)');
  });

  void test('no colour, or one this client does not know, derives a stable one from the slug', () => {
    const first = spaceColor({ slug: 'laika-core' });
    assert.equal(spaceColor({ slug: 'laika-core', color: null }), first);
    assert.equal(spaceColor({ slug: 'laika-core', color: 'chartreuse' }), first);
    assert.ok((SPACE_COLORS as readonly string[]).includes(first));
    const spread = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((slug) => spaceColor({ slug })),
    );
    assert.ok(spread.size > 2, 'every slug landed on the same colour');
  });
});
