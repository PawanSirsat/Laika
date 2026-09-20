/**
 * The type roles in CSS say exactly what `TYPE_ROLES` says (LAI-606).
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
import { DENSITY, rem, ROLE_NAMES, ROLES } from '../src/theme/type-roles.ts';

const CSS = readFileSync(new URL('../src/styles/type.css', import.meta.url).pathname, 'utf8');

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
      assert.equal(css['font-size'], rem(role.size), 'size');
      assert.equal(css['font-weight'], String(role.weight), 'weight');
      assert.equal(
        css['line-height'],
        typeof role.leading === 'number'
          ? String(role.leading)
          : rem(Number.parseFloat(role.leading)),
        'line-height',
      );
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

  void test('the brief’s weight rule: 400 to 700, nothing heavier', () => {
    /*
     * The final brief loads 400/500/600/700 (avatar initials are 12/700).
     * The earlier version of this rule capped at 600 with a rationale about
     * unloaded faces being synthesised — obsolete twice over: the families are
     * variable fonts carrying the whole axis, and the brief now names 700.
     * The cap that remains is 800+: nothing in the role system may ask for a
     * heavier face than the brief loads.
     */
    for (const name of ROLE_NAMES) {
      const { weight } = ROLES[name];
      assert.ok([400, 500, 600, 700].includes(weight), `${name} is ${String(weight)}`);
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

  void test('density overrides size and leading only, never weight or colour', () => {
    // The rule that keeps a dense board the same hierarchy, closer together.
    for (const roles of Object.values(DENSITY)) {
      for (const [role, over] of Object.entries(roles)) {
        assert.deepEqual(
          Object.keys(over).filter((k) => k !== 'size' && k !== 'leading'),
          [],
          `density override for '${role}' changes more than size and leading`,
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
