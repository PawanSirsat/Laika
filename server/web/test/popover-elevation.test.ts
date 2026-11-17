/**
 * **Menus and popovers float** (LAI-1230). One elevation token,
 * `--shadow-popover`, declared in every theme, and the shared menu, popover
 * and dropdown surfaces take their shadow from it — never a card's hairline
 * and never a raw value of their own.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const read = (rel: string): string =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const THEME = read('styles/theme.css');

/** The bodies of every rule whose selector list names `selector` exactly. */
function ruleBodies(css: string, selector: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) bodies.push(match[2] ?? '');
  }
  assert.ok(bodies.length > 0, `no rule for ${selector} — this test proves nothing`);
  return bodies;
}

void describe('the popover elevation token', () => {
  for (const [theme, selector] of [
    ['dark', ':root'],
    ['light', ":root[data-theme='light']"],
    ['black', ":root[data-theme='black']"],
  ] as const) {
    void test(`${theme} declares --shadow-popover with a drop and a contact layer`, () => {
      const value = ruleBodies(THEME, selector)
        .map((body) => /--shadow-popover\s*:\s*([^;]+);/.exec(body)?.[1])
        .find((v) => v !== undefined);
      assert.ok(value !== undefined, `${theme} has no --shadow-popover`);
      // Two layers: a soft drop alone disappears on a dark surface.
      assert.equal(value.split(/,(?![^(]*\))/).length, 2, `${theme}: ${value}`);
    });
  }
});

/*
 * The shared floating surfaces, and the board toolbar's own popovers — the
 * ones the separate action buttons open. Each must name the token.
 */
const SURFACES: readonly (readonly [file: string, selector: string])[] = [
  ['components/dropdown.css', '.dd-panel'],
  ['components/wizard/overflow-menu.css', '.overflow-menu-list'],
  ['components/glass/glass.css', '.glass-3'],
  ['components/glass/glass.css', '.glass-solid'],
  ['components/sidebar/sidebar.css', '.spaces-pop'],
  ['components/shell/header-actions.css', '.hdr-popover'],
  ['routes/screens/board/board-toolbar.css', '.bt-pop'],
  ['routes/screens/board/view-settings.css', '.view-settings'],
  ['routes/screens/task/editor/rte-toolbar.css', '.rte-menu'],
  ['routes/screens/task/editor/rich-editor.css', '.rte-popover'],
  ['routes/screens/dashboard/dashboard.css', '.dcf-pop'],
];

void describe('the floating surfaces use it', () => {
  for (const [file, selector] of SURFACES) {
    void test(`${selector} takes var(--shadow-popover)`, () => {
      const shadows = ruleBodies(read(file), selector).flatMap((body) =>
        [...body.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim()),
      );
      assert.ok(shadows.length > 0, `${file} ${selector} declares no shadow`);
      assert.deepEqual(
        [...new Set(shadows)],
        ['var(--shadow-popover)'],
        `${file} ${selector}: ${shadows.join(' | ')}`,
      );
    });
  }
});
