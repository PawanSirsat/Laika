/**
 * `src/theme/initials.ts` (LAI-070).
 *
 * A four-line function, tested because it renders a person's identity into an
 * 18px circle and the failure mode is silent: a blank avatar looks like a
 * rendering fault, and a wrong letter is a wrong person.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { initials } from '../../src/theme/initials.ts';

void describe('initials', () => {
  void test('first and last initial', () => {
    assert.equal(initials('Ada Lovelace'), 'AL');
  });

  void test('a middle name does not become the second letter', () => {
    // First and *last*, not first and second — "Mary Ann Evans" is ME.
    assert.equal(initials('Mary Ann Evans'), 'ME');
  });

  void test('one word gives one letter rather than a doubled fake', () => {
    assert.equal(initials('Ada'), 'A');
  });

  void test('an empty or blank name is marked, not blank', () => {
    // An empty circle reads as broken rendering; `?` reads as unknown actor.
    for (const blank of ['', '   ', '\t\n']) {
      assert.equal(initials(blank), '?', `rendered nothing for ${JSON.stringify(blank)}`);
    }
  });

  void test('irregular spacing does not produce empty parts', () => {
    // The `.filter` exists for this: splitting on /\s+/ with leading whitespace
    // yields a leading '' and would make the first initial undefined.
    assert.equal(initials('  Ada   Lovelace  '), 'AL');
    assert.equal(initials('Ada\tLovelace'), 'AL');
    assert.equal(initials('Ada\nLovelace'), 'AL');
  });

  void test('always upper case, whatever was typed', () => {
    assert.equal(initials('ada lovelace'), 'AL');
  });

  void test('non-latin names keep their own first characters', () => {
    // No transliteration, no dropping to `?` — the letters are the person's.
    assert.equal(initials('Ada Лавлейс'), 'AЛ');
    assert.equal(initials('绫 小路'), '绫小');
  });
});
