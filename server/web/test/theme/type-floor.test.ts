/**
 * No text in Laika is smaller than 10px (LAI-706).
 *
 * The prototype's scale (LAI-605) ran down to 7.5px, and on a laptop the
 * owner could not read it: *"there so many text on this website that is too
 * small"*. LAI-706 lifted every size under 13.5px. This test is what stops the
 * next component from bringing 8px back. It reads every `font-size` in
 * `src/**\/*.css`, every type role and every density override, and resolves a
 * `var(--text-*)` through the token it names.
 *
 * Two things are allowed under the floor, and both are named here:
 *
 *  - `font-size: 0` is not text. It is the toolbar's "hide the label, keep the
 *    icon" trick.
 *  - **Avatar initials.** They sit in a circle of fixed size, so they are part
 *    of a graphic, not something to read. LAI-706 first lifted them with
 *    everything else, and `MK` no longer fitted its circle. They keep the
 *    prototype's sizes, and the person's name is always written beside them
 *    or in their tooltip. The rule is matched by selector: a class with
 *    `avatar` in it, or the space header's `.space-member` stack.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { DENSITY, ROLE_NAMES, ROLES } from '../../src/theme/type-roles.ts';

const FLOOR_PX = 10;
const SRC = new URL('../../src', import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const CSS_FILES = walk(SRC).filter((path) => path.endsWith('.css'));
const THEME = readFileSync(join(SRC, 'styles/theme.css'), 'utf8');

/** `--text-sm` → its size in px, from `styles/theme.css`. */
function tokenPx(name: string): number {
  const match = new RegExp(`${name}:\\s*([0-9.]+)rem;`).exec(THEME);
  assert.ok(match?.[1], `${name} is not declared in rem in theme.css`);
  return Number(match[1]) * 16;
}

/** A `font-size` value in px, or `null` for one this test cannot read. */
function px(value: string): number | null {
  const v = value.trim();
  if (v === '0') return 0;
  const remMatch = /^([0-9.]+)rem$/.exec(v);
  if (remMatch?.[1]) return Number(remMatch[1]) * 16;
  const pxMatch = /^([0-9.]+)px$/.exec(v);
  if (pxMatch?.[1]) return Number(pxMatch[1]);
  const token = /^var\((--text-[a-z]+)\)$/.exec(v);
  if (token?.[1]) return tokenPx(token[1]);
  return null;
}

interface Declaration {
  readonly where: string;
  readonly selector: string;
  readonly value: string;
  readonly px: number | null;
}

/** The selectors whose text is an avatar's initials. */
const AVATAR = /avatar|^\.space-member(-more)?$/;

/** Every `font-size`, with the selector of the rule it sits in. */
const DECLARATIONS: Declaration[] = CSS_FILES.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((rule) => {
    const selector = (rule[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    return [...(rule[2] ?? '').matchAll(/font-size:\s*([^;]+);/g)].map((m) => {
      const value = m[1] ?? '';
      return { where: relative(SRC, file), selector, value, px: px(value) };
    });
  }),
);

void describe('the type floor', () => {
  void test('the scan reaches the files the owner pointed at', () => {
    // Positive control: a scan that read nothing would pass every check below.
    const files = new Set(DECLARATIONS.map((d) => d.where));
    for (const expected of [
      'styles/type.css',
      'components/sidebar/sidebar.css',
      'routes/screens/sprints/sprints.css',
      'routes/screens/timeline/timeline.css',
    ]) {
      assert.ok(files.has(expected), `no font-size found in ${expected}`);
    }
  });

  void test('every font-size in the stylesheets is one this test can read', () => {
    const unread = DECLARATIONS.filter((d) => d.px === null).map((d) => `${d.where}: ${d.value}`);
    assert.deepEqual(
      unread,
      [],
      'a size the floor cannot check is a size the floor does not cover',
    );
  });

  void test(`no stylesheet sets text under ${String(FLOOR_PX)}px`, () => {
    const small = DECLARATIONS.filter(
      (d) => d.px !== null && d.px !== 0 && d.px < FLOOR_PX && !AVATAR.test(d.selector),
    ).map((d) => `${d.where} ${d.selector}: ${d.value} (${String(d.px)}px)`);
    assert.deepEqual(small, []);
  });

  void test('the avatar exemption covers avatars and nothing else', () => {
    // Positive control for the exemption: it must match real avatar rules…
    const exempt = DECLARATIONS.filter((d) => AVATAR.test(d.selector)).map((d) => d.selector);
    assert.ok(exempt.includes('.list-avatar'), 'the exemption no longer reaches .list-avatar');
    // …and a rule that merely sits beside one is still held to the floor.
    assert.ok(!AVATAR.test('.space-members-label'));
    assert.ok(!AVATAR.test('.presence-name'));
  });

  void test(`no type role or density override is under ${String(FLOOR_PX)}px`, () => {
    const small = [
      // `avatar` is the role form of the exemption above.
      ...ROLE_NAMES.filter((name) => name !== 'avatar' && ROLES[name].size < FLOOR_PX).map(
        (name) => `${name}: ${String(ROLES[name].size)}`,
      ),
      ...Object.entries(DENSITY).flatMap(([density, overrides]) =>
        Object.entries(overrides)
          .filter(([, o]) => 'size' in o && o.size < FLOOR_PX)
          .map(([name, o]) => `${density}.${name}: ${String('size' in o ? o.size : '')}`),
      ),
    ];
    assert.deepEqual(small, []);
  });
});
