/**
 * The task card renders real fields, and no colour it invented (LAI-066).
 *
 * Two guarantees that would fail silently:
 *
 * 1. **Tags are real.** They were `demoTags(task.id)` until LAI-079 shipped the
 *    tags table. D-032 is explicit that *a demo module beside a real endpoint
 *    is a defect* — and the failure mode is invisible, because plausible sample
 *    chips look exactly like working ones.
 * 2. **No per-tag colour.** D-027 refused a palette on purpose: a colour must be
 *    chosen, stored, kept legible in both themes, and explained to whoever adds
 *    the tenth tag. The server sends `string[]`, so there is nothing to colour
 *    by even if someone wanted to.
 */

import assert from 'node:assert/strict';
import { CHIP_COLORS, tagColor } from '../../../../src/routes/screens/board/tag-colors.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { code } from '../../../helpers/code.ts';

let card = '';
let css = '';

before(async () => {
  const dir = new URL('../../../../src/routes/screens/board/', import.meta.url);
  card = code(await readFile(fileURLToPath(new URL('TaskCard.tsx', dir)), 'utf8'));
  css = await readFile(fileURLToPath(new URL('board.css', dir)), 'utf8');
});

void describe('tags come from the API', () => {
  void test('the card imports no demo module', () => {
    assert.ok(!card.includes('demo/'), 'the card still reads sample data');
    assert.ok(!card.includes('demoTags'), 'demoTags is still referenced');
  });

  void test('it reads task.tags', () => {
    assert.match(card, /task\.tags/, 'tags are not taken from the task');
  });
});

void describe('TAG_COLORS (LAI-606, reversing D-027)', () => {
  /*
   * The owner reversed D-027 against the prototype: chips are tinted, one
   * hue per meaning. The map is asserted verbatim — a hue is a claim that a
   * word means something, so drift here is a semantic bug, not a style one.
   */
  void test('the brief’s mapping, verbatim', () => {
    for (const [tag, hue] of [
      ['ui', 'orange'],
      ['server', 'blue'],
      ['presence', 'blue'],
      ['board', 'green'],
      ['auth', 'green'],
      ['bug', 'pink'],
      ['agent', 'purple'],
      ['ai', 'purple'],
      ['a11y', 'neutral'],
      ['policy', 'neutral'],
      ['core', 'neutral'],
      ['infra', 'neutral'],
      ['audit', 'neutral'],
    ] as const) {
      assert.equal(tagColor(tag), hue, `${tag} should be ${hue}`);
    }
  });

  void test('an unknown tag is neutral, never hashed into meaning', () => {
    assert.equal(tagColor('some-new-tag'), 'neutral');
    assert.equal(tagColor('AUTH'), 'green', 'case must not matter');
  });

  void test('every hue the map hands out has a CSS rule', () => {
    // A mapping to a class with no rule renders an unstyled chip — the
    // card-tag-purple gap this test exists to keep closed.
    for (const hue of CHIP_COLORS) {
      assert.match(css, new RegExp(`\\.card-tag-${hue}\\b`), `no .card-tag-${hue} rule`);
    }
  });
});

void describe('the blocked banner names its blocker', () => {
  void test('it renders the blocking task, not just the word blocked', () => {
    // "blocked by a dependency" tells someone they are stuck and then makes
    // them go hunting for what by — the cost of being blocked, paid twice.
    assert.match(card, /blockers\(/, 'the card does not resolve which task blocks it');
    assert.match(card, /card-blocked-what/, 'the blocker title is not rendered');
  });

  void test('the key is never truncated, only the title', () => {
    // The key is what you go and look up; a shortened one matches no task.
    const keyRule = /\.card-blocked b\s*\{[^}]*\}/.exec(css);
    assert.ok(keyRule, 'no rule for the blocker key');
    assert.match(keyRule[0], /flex:\s*none/, 'the key can be squeezed');

    const titleRule = /\.card-blocked-what\s*\{[^}]*\}/.exec(css);
    assert.ok(titleRule, 'no rule for the blocker title');
    assert.match(titleRule[0], /text-overflow:\s*ellipsis/, 'the title does not truncate');
  });

  void test('the task key itself cannot break across lines', () => {
    // In a 167px column `LC-4` was breaking after the hyphen, rendering `LC-`
    // above `4` — which reads as two things and matches nothing.
    const rule = /\.card-key\s*\{[^}]*\}/.exec(css);
    assert.ok(rule, 'no .card-key rule found');
    assert.match(rule[0], /white-space:\s*nowrap/, 'the key can wrap mid-token');
  });
});

void describe('the card draws no stale marker, comment count or age (LAI-701)', () => {
  /*
   * This block used to prove the opposite — that the card drew a stale pill
   * from the served timestamp (LAI-157). The owner removed it with the comment
   * count and the age: *"I don't need that"*. Staleness is still flagged by the
   * server (§11.6) and listed on the Activity tab; the comment count is still
   * in the task view. The browser test proves the absence on the page; this
   * proves the card no longer reads the fields it would need to draw them.
   */
  void test('the card reads none of the three fields', () => {
    assert.ok(!card.includes('stale_flagged_at'), 'the card still reads the stale flag');
    assert.ok(!card.includes('comment_count'), 'the card still reads the comment count');
    assert.ok(!card.includes('updatedAge'), 'the card still prints an age');
    // Positive control: the scan is reading the real card, not an empty string.
    assert.match(card, /card-foot/, 'this is not the card source');
  });
});
