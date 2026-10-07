/**
 * The priority icon (LAI-705, D-070), checked at source.
 *
 * This package has no renderer, so what is asserted here is structural: three
 * levels, three different drawings, three names, the accessible parts that
 * stop colour being the only signal, and colours that come from tokens which
 * exist in both themes. That each level actually *draws* its glyph, in its
 * colour, on the card, the List and the task view is
 * `test/browser/priority-icons.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from '../helpers/code.ts';

let icon = '';
let css = '';
let theme = '';

before(async () => {
  const read = async (rel: string) =>
    await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  icon = code(await read('../../src/components/PriorityIcon.tsx'));
  css = code(await read('../../src/components/priority-icon.css'));
  theme = code(await read('../../src/styles/theme.css'));
});

const LEVELS = ['p1', 'p2', 'p3'] as const;

/** The body of a `{ p1: …, p2: …, p3: … }` literal following `name`. */
function record(name: string): Map<string, string> {
  const start = icon.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} is not exported`);
  const body = icon.slice(start, icon.indexOf('};', start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(p[123]): '([^']*)'/g)) out.set(m[1] ?? '', m[2] ?? '');
  return out;
}

/** The declarations inside one selector's block, by exact selector. */
function block(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return source.slice(at, source.indexOf('}', at));
}

void describe('PriorityIcon names each level as Jira does', () => {
  void test('High, Medium, Low for p1, p2, p3', () => {
    const names = record('PRIORITY_NAMES');
    assert.deepEqual(Object.fromEntries(names), { p1: 'High', p2: 'Medium', p3: 'Low' });
  });

  void test('each level has its own drawing, and the two chevrons point opposite ways', () => {
    const glyphs = record('PRIORITY_GLYPHS');
    assert.equal(glyphs.size, 3, 'a level has no glyph');
    assert.equal(new Set(glyphs.values()).size, 3, 'two levels share a drawing');

    // Up: the middle point is higher (smaller y) than both ends. Down: lower.
    const ys = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const up = ys(glyphs.get('p1') ?? '');
    assert.ok((up[3] ?? 0) < (up[1] ?? 0), `p1 does not point up: ${glyphs.get('p1') ?? ''}`);
    const down = glyphs.get('p3') ?? '';
    assert.match(down, /^M3 5\.5l5 5 5-5$/, 'p3 is not a downward chevron');
    // The equals sign is two horizontal strokes and nothing else.
    assert.match(glyphs.get('p2') ?? '', /^M3 [\d.]+h10M3 [\d.]+h10$/, 'p2 is not two bars');
  });
});

void describe('colour is never the only signal', () => {
  void test('the SVG is an image with a name, in aria-label and a <title>', () => {
    assert.match(icon, /role="img"/);
    assert.match(icon, /aria-label=\{name\}/);
    assert.match(icon, /<title>\{name\}<\/title>/);
    assert.match(icon, /const name = `Priority: \$\{PRIORITY_NAMES\[priority\]\}`/);
  });

  void test('it draws in currentColor, as a stroke, with round caps', () => {
    assert.match(icon, /stroke="currentColor"/);
    assert.match(icon, /fill="none"/);
    assert.match(icon, /strokeLinecap="round"/);
    assert.match(icon, /className=\{`priority-icon priority-icon-\$\{priority\}`\}/);
  });
});

void describe('colours come from existing tokens, in both themes (D-020)', () => {
  const TOKENS = { p1: '--overdue', p2: '--chip-orange', p3: '--chip-blue' } as const;

  void test('each level takes its token and nothing else', () => {
    for (const level of LEVELS) {
      assert.match(
        block(css, `.priority-icon-${level}`),
        new RegExp(`color: var\\(${TOKENS[level]}\\);`),
        `${level} is not ${TOKENS[level]}`,
      );
    }
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'a literal colour in priority-icon.css');
  });

  void test('every token is defined for dark and redefined for light', () => {
    const dark = block(theme, ':root');
    const light = block(theme, ":root[data-theme='light']");
    for (const token of Object.values(TOKENS)) {
      assert.match(dark, new RegExp(`${token}:`), `${token} is missing from dark`);
      assert.match(light, new RegExp(`${token}:`), `${token} is missing from light`);
    }
  });
});
