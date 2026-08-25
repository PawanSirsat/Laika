/**
 * The tag picker leaves the naming rule to the server (LAI-081, D-027).
 *
 * AC4 is a *negative*: the client must **not** reimplement the pattern. A
 * negative like this is exactly what rots — someone adds a friendly inline
 * check, it agrees with the server on the day it is written, and it silently
 * disagrees the first time the server tightens.
 *
 * `readableRefusal` is tested with the two 422 shapes the server really sends,
 * both copied off a running instance.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, test } from 'node:test';
import { ApiError } from '../../../../src/api/errors.ts';
import { readableRefusal } from '../../../../src/api/tags.ts';
import { code } from '../../../helpers/code.ts';

let picker = '';

before(async () => {
  picker = code(
    await readFile(
      fileURLToPath(new URL('../../../../src/routes/screens/board/TagPicker.tsx', import.meta.url)),
      'utf8',
    ),
  );
});

void describe('the client does not judge a tag name', () => {
  void test('there is no tag-name pattern in the picker', () => {
    // The server's rule is "lowercase letters, digits and hyphens, starting
    // with a letter or digit, up to 24 characters". Any character class here
    // is a second copy of it.
    for (const pattern of [/\[a-z0-9/i, /\\w\+/, /a-zA-Z/, /RegExp\(/, /\.test\(/]) {
      assert.ok(!pattern.test(picker), `the picker validates the name itself: ${String(pattern)}`);
    }
  });

  void test('no length limit is enforced against the server’s 24', () => {
    // `maxLength` on the input is a different thing — it stops a runaway paste
    // at 64, which is the schema's own bound, not the naming rule's 24.
    assert.ok(!picker.includes('24'), 'the picker hardcodes the server’s length rule');
  });

  void test('it shapes with normaliseTagInput and sends', () => {
    assert.match(picker, /normaliseTagInput/, 'input is not normalised at all');
    assert.match(picker, /setTaskTags/, 'the picker does not save through the API helper');
  });
});

void describe('readableRefusal shows what the server said', () => {
  /** The service's own 422 for a bad name — written for a person. */
  const namedRefusal = new ApiError(
    'unprocessable',
    '"has space" is not a valid tag: lowercase letters, digits and hyphens, starting with a letter or digit, up to 24 characters',
    422,
    { tag: 'has space' },
  );

  /** A schema rejection — generic headline, detail in `issues`. */
  const schemaRefusal = new ApiError('unprocessable', 'Invalid request body', 422, {
    issues: [{ path: 'tags.0', message: 'Too small: expected string to have >=1 characters' }],
  });

  void test('the service’s message is used verbatim', () => {
    // It names the tag and states the rule. Rewording it here would mean
    // maintaining a second explanation of a rule we deliberately do not own.
    assert.equal(readableRefusal(namedRefusal), namedRefusal.message);
  });

  void test('a schema rejection shows the issue, not "Invalid request body"', () => {
    // Telling someone who typed one word that their *request body* is invalid
    // explains nothing about what they should do next.
    const shown = readableRefusal(schemaRefusal);
    assert.ok(!shown.includes('Invalid request body'), `showed the generic headline: ${shown}`);
    assert.match(shown, /Too small/);
  });

  void test('a non-API failure still says something', () => {
    for (const other of [new Error('offline'), null, undefined, 'a string']) {
      const shown = readableRefusal(other);
      assert.ok(shown.length > 0, 'an unrecognised failure produced no message');
    }
  });
});

void describe('the Viewer gate', () => {
  void test('editing is behind mayEdit', () => {
    // A Viewer sees tags — reading them is part of reading the task — and gets
    // no control that would answer 403.
    assert.match(picker, /mayEdit/);
    assert.match(picker, /if \(!mayEdit\)/, 'there is no read-only branch');
  });
});
