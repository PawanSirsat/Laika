/**
 * The type scale and roles in CSS say exactly what `type-roles.ts` says (LAI-606,
 * LAI-828).
 *
 * The brief asks for the classes to be *generated* from one object so the two
 * cannot drift. They are hand-written instead — CSS cannot import TypeScript,
 * and a stylesheet-emitting build step is a second pipeline to keep alive — so
 * this test supplies the same guarantee: the pair is declared twice and any
 * disagreement is a red build.
 *
 * **It asserts field by field, not class-count.** A check that only counted
 * `.t-*` blocks would pass while every size in them was wrong, which is the
 * exact shape of assertion this repo keeps getting bitten by.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { LEADING_TOKENS, TYPE_TOKENS } from '../../src/theme/token-list.ts';
import {
  DENSITY,
  leadingCss,
  LEGACY_TEXT_ALIASES,
  rem,
  ROLE_NAMES,
  ROLES,
  STEP_NAMES,
  TYPE_SCALE,
} from '../../src/theme/type-roles.ts';

const CSS = readFileSync(new URL('../../src/styles/type.css', import.meta.url).pathname, 'utf8');

/** The declarations inside one `.t-<name>` block. */
function block(name: string): Record<string, string> {
  const match = new RegExp(`\\.t-${name}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(match?.[1], `no .t-${name} rule in type.css`);

  return Object.fromEntries(
    match[1]
      .split(';')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf(':');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

/** The custom properties in type.css's `:root` block, in source order. */
function rootVars(): [string, string][] {
  const match = /^:root\s*\{([^}]*)\}/m.exec(CSS);
  assert.ok(match?.[1], 'no :root block in type.css');
  return [...match[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? '', m[2] ?? '']);
}

void describe('the scale in CSS is TYPE_SCALE', () => {
  void test('the seven steps LAI-828 names, at the sizes the owner asked for', () => {
    // Stated independently of TYPE_SCALE, for the same reason as the role list
    // below: a step lost from the object would vanish from CSS and test alike.
    assert.deepEqual(
      Object.fromEntries(STEP_NAMES.map((s) => [s, [TYPE_SCALE[s].size, TYPE_SCALE[s].leading]])),
      {
        tiny: [11, 16],
        small: [12, 16],
        body: [14, 20],
        reading: [16, 24],
        'heading-sm': [16, 20],
        'heading-md': [20, 24],
        'heading-lg': [24, 28],
      },
    );
  });

  void test('every step is declared once, in rem, size and leading', () => {
    const vars = new Map(rootVars());
    for (const step of STEP_NAMES) {
      assert.equal(vars.get(`--text-${step}`), rem(TYPE_SCALE[step].size), `--text-${step}`);
      assert.equal(
        vars.get(`--leading-${step}`),
        rem(TYPE_SCALE[step].leading),
        `--leading-${step}`,
      );
    }
  });

  void test('the root block declares the scale, the legacy aliases, and nothing else', () => {
    assert.deepEqual(
      rootVars()
        .map(([name]) => name)
        .sort(),
      [...TYPE_TOKENS, ...LEADING_TOKENS, ...Object.keys(LEGACY_TEXT_ALIASES)].sort(),
    );
    const vars = new Map(rootVars());
    for (const [alias, step] of Object.entries(LEGACY_TEXT_ALIASES)) {
      assert.equal(vars.get(alias), `var(--text-${step})`, alias);
    }
  });
});

void describe('every role matches its declaration', () => {
  void test('the sixteen roles the brief names, plus avatar, all exist', () => {
    /*
     * The sync suite derives both sides from TYPE_ROLES, so a role *deleted*
     * from the object vanishes from CSS and test alike with everything green —
     * which happened: a greedy edit swallowed `body-sm` and 16 === 16 passed.
     * The expected list is stated independently so a lost role is a red test,
     * not a silent absence.
     */
    assert.deepEqual(
      [...ROLE_NAMES].sort(),
      [
        'avatar',
        'body',
        'body-sm',
        'caption',
        'code',
        'code-sm',
        'control',
        'display',
        'field-label',
        'heading',
        'input',
        'label',
        'meta',
        'overline',
        'tab',
        'title',
        'value',
      ].sort(),
    );
  });

  for (const name of ROLE_NAMES) {
    void test(`.t-${name}`, () => {
      const role = ROLES[name];
      const css = block(name);

      assert.equal(css['font-family'], `var(--font-${role.family})`, 'family');
      assert.equal(css['font-size'], `var(--text-${role.step})`, 'size');
      assert.equal(css['font-weight'], String(role.weight), 'weight');
      assert.equal(css['line-height'], leadingCss(role.leading, role.step), 'line-height');
      assert.equal(
        css['letter-spacing'],
        role.tracking === 0 ? '0' : `${String(role.tracking)}em`,
        'tracking',
      );
      assert.equal(
        css.color,
        role.color === 'inherit' ? 'inherit' : `var(--${role.color})`,
        'colour token',
      );

      // Optional fields: present exactly when the role says so. Asserting the
      // absence matters as much — a stray `tabular-nums` on a role that does
      // not want it is the kind of drift nobody notices by eye.
      assert.equal(css['text-transform'], role.transform, 'text-transform');
      assert.equal(
        css['font-variant-numeric'],
        role.tabular === true ? 'tabular-nums' : undefined,
        'tabular',
      );
      assert.equal(
        css['text-overflow'],
        role.truncate === true ? 'ellipsis' : undefined,
        'truncation',
      );
    });
  }

  void test('the prototype’s weight rule: 400 to 800, nothing outside it', () => {
    /*
     * LAI-605 rebased the scale on the prototype file, which leans on 800 —
     * column heads, keys, initials and the space title are all heavy at small
     * sizes, and the variable fonts carry the whole axis. The cap that
     * remains is anything outside 400–800, and any weight the fonts do not
     * actually load. This rule capped at 700 for the earlier brief; the
     * prototype supersedes it.
     */
    for (const name of ROLE_NAMES) {
      const { weight } = ROLES[name];
      assert.ok([400, 500, 600, 700, 800].includes(weight), `${name} is ${String(weight)}`);
    }
  });

  void test('every density override names a real role', () => {
    /*
     * A density key that no longer matches a role is a dead rule — it stops
     * applying the moment the role is renamed, and nothing says so. Asserted
     * here rather than trusted, because the failure is invisible: the dense
     * board simply stops being dense in one place.
     */
    for (const [density, roles] of Object.entries(DENSITY)) {
      for (const role of Object.keys(roles)) {
        assert.ok(
          ROLE_NAMES.includes(role as (typeof ROLE_NAMES)[number]),
          `density '${density}' overrides '${role}', which is not a role`,
        );
      }
    }
  });

  void test('density overrides step and leading only, never weight or colour', () => {
    // The rule that keeps a dense board the same hierarchy, closer together.
    for (const roles of Object.values(DENSITY)) {
      for (const [role, over] of Object.entries(roles)) {
        assert.deepEqual(
          Object.keys(over).filter((k) => k !== 'step' && k !== 'leading'),
          [],
          `density override for '${role}' changes more than step and leading`,
        );
      }
    }
  });

  void test('no role is declared in CSS that TYPE_ROLES does not know', () => {
    // The other direction. Without it, a hand-added `.t-banner` would live in
    // the stylesheet forever, outside the system it is meant to be inside.
    // Anchored to the start of a line, so `.kanban-dense .t-body` — a density
    // override of a role that already exists — is not read as a new role.
    const inCss = [...CSS.matchAll(/^\.t-([a-z-]+)\s*\{/gm)].map((m) => m[1]);
    assert.deepEqual([...inCss].sort(), [...ROLE_NAMES].sort());
  });
});
