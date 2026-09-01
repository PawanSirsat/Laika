/**
 * The vocabulary parser (LAI-147).
 *
 * **This file is the criterion.** A comment written inside `ACTIVITY_TYPES`
 * broke the old parse, and the failure looked like a client/server drift that
 * did not exist. So the fixture here carries the hazards deliberately: if the
 * next person writes a comment in that array, this fails first and says why.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readVocabulary, stripComments } from './enums.ts';

/** The shape of the real file, hazards included. */
const SOURCE = `
export const ACTIVITY_TYPES = [
  'task.created',

  // A line comment containing §4.13's apostrophe — this is the one that broke
  // it: the quote in \`4.13's\` opened a match and swallowed prose as a "type".
  'task.updated',

  /*
   * A block comment that names 'project.created' outright. Matching the shape
   * alone would pick this up, which is why comments are stripped first.
   */
  'comment.added',
] as const;
`;

void describe('a vocabulary survives the comments people write in it', () => {
  void test('reads exactly the literals, in order', () => {
    assert.deepEqual(readVocabulary(SOURCE, 'ACTIVITY_TYPES'), [
      'task.created',
      'task.updated',
      'comment.added',
    ]);
  });

  void test('an apostrophe in prose contributes nothing — the original defect', () => {
    // Without stripping, `'` in `4.13's` opens a run that ends at the next
    // apostrophe, and the assertion fails with a diff full of English.
    const parsed = readVocabulary(SOURCE, 'ACTIVITY_TYPES');
    for (const type of parsed) {
      assert.match(type, /^[a-z_]+\.[a-z_]+$/, `parsed prose as a type: ${JSON.stringify(type)}`);
    }
  });

  void test('a type named inside a comment is not a member', () => {
    // The shape check alone would take this. Two defences, because either on
    // its own is a bet about what people write.
    assert.ok(
      !readVocabulary(SOURCE, 'ACTIVITY_TYPES').includes('project.created'),
      'a commented-out type was counted as declared',
    );
  });

  void test('adding another comment does not change the parse', () => {
    // The criterion in the task: the next comment must not break this.
    const withMore = SOURCE.replace(
      "  'comment.added',",
      "  // Another note, added later, with an apostrophe: the reader's problem.\n  'comment.added',",
    );
    assert.deepEqual(
      readVocabulary(withMore, 'ACTIVITY_TYPES'),
      readVocabulary(SOURCE, 'ACTIVITY_TYPES'),
    );
  });

  void test('a missing array is loud, not empty', () => {
    // An empty result would pass every caller's assertion vacuously — the
    // green-by-vacancy shape again.
    assert.throws(() => readVocabulary(SOURCE, 'NO_SUCH_ENUM'), /could not find NO_SUCH_ENUM/);
  });

  void test('stripComments leaves code alone', () => {
    assert.equal(
      stripComments('const a = 1; // note\nconst b = 2;'),
      'const a = 1; \nconst b = 2;',
    );
  });
});
