/**
 * Every size is a step of the scale, and nothing is under 12px (LAI-828).
 *
 * LAI-706 set a 10px floor after the owner could not read the prototype's
 * 7.5px text. LAI-828 raised it to Jira's: *"the text size is very small, we
 * need to increase it everywhere … I want the same as the Jira board."* Body
 * text is 14px, the floor is 12px, and 11px is allowed only on the short list
 * of badges and counters below, where 12px truly cannot fit.
 *
 * The test reads every `font-size` in `src/**\/*.css`, every type role and
 * every density override. It holds three rules:
 *
 *  - **Tokens only.** A `font-size` is `var(--text-<step>)` for a step of
 *    `TYPE_SCALE`, or `0` — the toolbar's "hide the label, keep the icon"
 *    trick. A raw `0.8125rem` is a size nobody chose for the whole app.
 *  - **Nothing under 12px**, except `--text-tiny` on the selectors in `TINY`.
 *  - **`TINY` is exact**: each selector on it uses the tiny step, and no other
 *    selector does. Named, not counted.
 *
 * Two exemptions, both named with the file they cover:
 *
 *  - `index.css`'s `:root { font-size: 16px }` is the rem anchor every token is
 *    measured from, not a piece of text.
 *  - **My day** (`routes/screens/my-day/`) is being rebuilt by LAI-831 while
 *    this lands, so its stylesheet was not swept. It may still use raw sizes and
 *    the pre-LAI-828 token names, and is held to LAI-706's 10px floor instead.
 *    The last test here fails once My day needs neither — that is the signal to
 *    delete `MY_DAY`, its two filters and `LEGACY_TEXT_ALIASES`.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import {
  DENSITY,
  LEGACY_TEXT_ALIASES,
  ROLE_NAMES,
  ROLES,
  STEP_NAMES,
  TYPE_SCALE,
  type StepName,
} from '../../src/theme/type-roles.ts';

const FLOOR_PX = 12;
const LEGACY_FLOOR_PX = 10;
const SRC = new URL('../../src', import.meta.url).pathname;

/** LAI-831's screen, exempt until it is rebuilt on the scale. */
const MY_DAY = 'routes/screens/my-day/';

/**
 * The selectors allowed `--text-tiny` (11px), and the reason each needs it.
 *
 * Avatar initials: the widest pair, "WM", measures 23.8px at 12px in the
 * avatar's weight — wider than a 22px circle — and 21.8px at 11px (LAI-828,
 * measured in Chromium). Circles of 28px and more carry 12px initials and are
 * not here. The two counters sit where 12px would overflow their box.
 */
const TINY = [
  // Avatar initials in circles under 28px.
  '.t-avatar', // the board card's 26px avatar, and the toolbar's assignee stack
  '.dd-avatar', // 22px, in every person dropdown
  '.space-member', // 22px, the space header's member stack
  '.rail-feed-avatar', // 22px, the board rail's activity feed
  '.swim-avatar', // 22px, a swimlane's head
  '.dash-avatar', // 24px, the dashboard's contributors
  '.list-avatar', // 22px, the List view's assignee cell
  '.tlx-avatar', // 22px, a timeline row
  '.dep-avatar', // 22px (20px before LAI-828), a linked task in the task panel
  // 22px. Styled in task-panel.css but drawn by no component today; listed so
  // the rule cannot come back at a size nobody checked.
  '.watch-avatar',
  '.comment-avatar',
  // Counters.
  '.space-member-more', // "+3" beside the member stack, the stack's own height
  '.sidebar-collapsed .sidebar-count', // the badge over a folded sidebar icon
].sort();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const CSS_FILES = walk(SRC).filter((path) => path.endsWith('.css'));

const STEPS = new Set<string>(STEP_NAMES);
const LEGACY: Readonly<Record<string, StepName>> = LEGACY_TEXT_ALIASES;

/** A `font-size` value in px, or `null` for one this test cannot read. */
function px(value: string): number | null {
  const v = value.trim();
  if (v === '0') return 0;
  const remMatch = /^([0-9.]+)rem$/.exec(v);
  if (remMatch?.[1]) return Number(remMatch[1]) * 16;
  const pxMatch = /^([0-9.]+)px$/.exec(v);
  if (pxMatch?.[1]) return Number(pxMatch[1]);
  const token = /^var\((--text-[a-z0-9-]+)\)$/.exec(v)?.[1];
  if (token === undefined) return null;
  const step = token.slice('--text-'.length);
  if (STEPS.has(step)) return TYPE_SCALE[step as StepName].size;
  const legacy = LEGACY[token];
  return legacy === undefined ? null : TYPE_SCALE[legacy].size;
}

/** The step a value names, or `null` when it is not `var(--text-<step>)`. */
function stepOf(value: string): StepName | null {
  const step = /^var\(--text-([a-z0-9-]+)\)$/.exec(value.trim())?.[1];
  return step !== undefined && STEPS.has(step) ? (step as StepName) : null;
}

interface Declaration {
  readonly where: string;
  readonly selector: string;
  readonly value: string;
  readonly px: number | null;
}

/** Every `font-size`, with the selector of the rule it sits in. */
const DECLARATIONS: Declaration[] = CSS_FILES.flatMap((file) =>
  [
    ...readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].flatMap((rule) => {
    // `@import …;` lines have no braces, so they ride along at the front of
    // the first rule's selector; the selector is what follows the last `;`.
    const selector = (rule[1] ?? '').split(';').pop()?.replace(/\s+/g, ' ').trim() ?? '';
    return [...(rule[2] ?? '').matchAll(/font-size:\s*([^;]+);/g)].map((m) => {
      const value = (m[1] ?? '').trim();
      return { where: relative(SRC, file), selector, value, px: px(value) };
    });
  }),
);

const isMyDay = (d: Declaration) => d.where.startsWith(MY_DAY);
const isRootAnchor = (d: Declaration) =>
  d.where === 'index.css' && d.selector === ':root' && d.value === '16px';
const label = (d: Declaration) => `${d.where} ${d.selector}: ${d.value}`;

void describe('the type floor', () => {
  void test('the scan reaches the files the owner pointed at', () => {
    // Positive control: a scan that read nothing would pass every check below.
    const files = new Set(DECLARATIONS.map((d) => d.where));
    for (const expected of [
      'styles/type.css',
      'components/sidebar/sidebar.css',
      'routes/screens/board/board-toolbar.css',
      'routes/screens/list/list.css',
      'routes/screens/timeline/timeline.css',
      'routes/screens/organisation/organisation.css',
    ]) {
      assert.ok(files.has(expected), `no font-size found in ${expected}`);
    }
    assert.ok(DECLARATIONS.some(isRootAnchor), 'the rem anchor in index.css was not found');
  });

  void test('every font-size in the stylesheets is one this test can read', () => {
    const unread = DECLARATIONS.filter((d) => d.px === null).map(label);
    assert.deepEqual(
      unread,
      [],
      'a size the floor cannot check is a size the floor does not cover',
    );
  });

  void test('every font-size is a step of the scale', () => {
    const raw = DECLARATIONS.filter(
      (d) => !isMyDay(d) && !isRootAnchor(d) && d.value !== '0' && stepOf(d.value) === null,
    ).map(label);
    assert.deepEqual(raw, [], 'set these with var(--text-<step>) from styles/type.css');
  });

  void test(`no stylesheet sets text under ${String(FLOOR_PX)}px, but for the tiny list`, () => {
    const small = DECLARATIONS.filter(
      (d) =>
        !isMyDay(d) &&
        d.px !== null &&
        d.px !== 0 &&
        d.px < FLOOR_PX &&
        !(TINY.includes(d.selector) && stepOf(d.value) === 'tiny'),
    ).map((d) => `${label(d)} (${String(d.px)}px)`);
    assert.deepEqual(small, []);
  });

  void test('the tiny step is used by exactly the selectors on the tiny list', () => {
    const usingTiny = [
      ...new Set(DECLARATIONS.filter((d) => stepOf(d.value) === 'tiny').map((d) => d.selector)),
    ].sort();
    assert.deepEqual(usingTiny, TINY);
  });

  void test(`My day stays at LAI-706's ${String(LEGACY_FLOOR_PX)}px floor until LAI-831`, () => {
    const small = DECLARATIONS.filter(
      (d) => isMyDay(d) && d.px !== null && d.px !== 0 && d.px < LEGACY_FLOOR_PX,
    ).map((d) => `${label(d)} (${String(d.px)}px)`);
    assert.deepEqual(small, []);
  });

  void test('the pre-LAI-828 token names are used by My day and nothing else', () => {
    const legacy = DECLARATIONS.filter((d) => !isMyDay(d) && d.value.startsWith('var(--text-'))
      .filter((d) => stepOf(d.value) === null)
      .map(label);
    assert.deepEqual(legacy, []);
  });

  void test('My day still needs its exemption — delete it when this fails', () => {
    // The exemption expires by itself: once LAI-831 sets My day on the scale,
    // nothing in it is off the steps and this goes red. Then delete MY_DAY and
    // the filters that use it here, and LEGACY_TEXT_ALIASES in type-roles.ts.
    const offScale = DECLARATIONS.filter(
      (d) => isMyDay(d) && d.value !== '0' && stepOf(d.value) === null,
    );
    assert.notEqual(offScale.length, 0, 'My day is on the scale: retire its exemption');
  });

  void test(`no type role or density override is under ${String(FLOOR_PX)}px`, () => {
    const small = [
      // `avatar` is the role form of the tiny list's first entry.
      ...ROLE_NAMES.filter(
        (name) => name !== 'avatar' && TYPE_SCALE[ROLES[name].step].size < FLOOR_PX,
      ).map((name) => `${name}: ${ROLES[name].step}`),
      ...Object.entries(DENSITY).flatMap(([density, overrides]) =>
        Object.entries(overrides)
          .filter(([, o]) => 'step' in o && TYPE_SCALE[o.step as StepName].size < FLOOR_PX)
          .map(([name]) => `${density}.${name}`),
      ),
    ];
    assert.deepEqual(small, []);
    assert.equal(ROLES.avatar.step, 'tiny', 'the avatar role is the one tiny role');
  });
});
