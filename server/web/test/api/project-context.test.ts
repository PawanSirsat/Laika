/**
 * `src/api/project-context.ts` — the shared context document (SPEC §7.3).
 *
 * Two things here are worth a test rather than a glance: the budget, because
 * §7.3's requirement is that the limit is visible **before** it is hit, and the
 * refusal message, because the server sends `{ limit, length }` specifically so
 * a writer is not left guessing how much to cut.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  contextBudget,
  diffLinesOf,
  readableContextError,
  staleContextOf,
} from '../../src/api/project-context.ts';
import { ApiError } from '../../src/api/errors.ts';

const LIMIT = 100_000;

void describe('the budget warns before the cap, not after it', () => {
  void test('an ordinary document is quiet', () => {
    assert.equal(contextBudget(1_000, LIMIT).tone, 'ok');
  });

  void test('it becomes prominent while there is still room to act', () => {
    // The point of the warning is that it arrives with enough space left to
    // finish a thought and still cut something.
    const near = contextBudget(95_000, LIMIT);
    assert.equal(near.tone, 'near');
    assert.ok(near.remaining > 0, 'warned only once there was nothing left to do about it');
  });

  void test('the boundary is inclusive, so 90% already warns', () => {
    assert.equal(contextBudget(90_000, LIMIT).tone, 'near');
    assert.equal(contextBudget(89_999, LIMIT).tone, 'ok');
  });

  void test('exactly at the limit is not yet over — the server accepts it', () => {
    // `> CONTEXT_MD_LIMIT` is what the service refuses, so the UI must not
    // report a document as rejected while the server would take it.
    assert.equal(contextBudget(LIMIT, LIMIT).tone, 'near');
    assert.equal(contextBudget(LIMIT + 1, LIMIT).tone, 'over');
  });

  void test('past the cap it says how much to cut, not just that it is full', () => {
    const over = contextBudget(100_400, LIMIT);
    assert.equal(over.tone, 'over');
    assert.equal(over.remaining, -400, 'clamping to zero would hide how much to remove');
  });

  void test('an empty document is not treated as over', () => {
    assert.equal(contextBudget(0, LIMIT).tone, 'ok');
  });
});

void describe('a refusal names both numbers', () => {
  void test('it says the overage, the length and the limit', () => {
    const cause = new ApiError('unprocessable', 'That context document is too long', 422, {
      limit: 100_000,
      length: 100_400,
    });
    const message = readableContextError(cause);

    // Digits only. `toLocaleString` groups by the **runtime's** locale, so this
    // machine renders 100,400 as `1,00,400` — correct for the reader, and a
    // separator this assertion must not depend on. Asserting the grouping would
    // make the test pass or fail by machine rather than by behaviour.
    const digits = message.replace(/[^0-9]/g, '');
    assert.ok(digits.includes('100400'), `did not say the actual length: ${message}`);
    assert.ok(digits.includes('100000'), `did not say the limit: ${message}`);
    assert.match(message, /\b400\b|^400/, `did not say how much to cut: ${message}`);
  });

  void test("zod's refusal is read too, and gains the length it omits", () => {
    // The shape REST actually returns: the route's schema refuses before the
    // service's clear error can, so the limit is in prose and the length is
    // absent. Measured against the running server, not assumed. LAI-228.
    const cause = new ApiError('unprocessable', 'Invalid request body', 422, {
      issues: [
        { path: 'context_md', message: 'Too big: expected string to have <=100000 characters' },
      ],
    });
    const message = readableContextError(cause, 100_400);
    const digits = message.replace(/[^0-9]/g, '');
    assert.ok(digits.includes('100400'), `did not say the actual length: ${message}`);
    assert.ok(digits.includes('100000'), `did not say the limit: ${message}`);
    assert.ok(!message.includes('Invalid request body'), 'passed the envelope through unread');
  });

  void test('without a length to add, zod’s own words beat the envelope', () => {
    // Better the specific issue than "Invalid request body", which describes
    // nothing the reader can act on.
    const cause = new ApiError('unprocessable', 'Invalid request body', 422, {
      issues: [
        { path: 'context_md', message: 'Too big: expected string to have <=100000 characters' },
      ],
    });
    assert.match(readableContextError(cause), /Too big/);
  });

  void test('a refusal without details still says something true', () => {
    const cause = new ApiError('unprocessable', 'That context document is too long', 422, null);
    assert.equal(readableContextError(cause), 'That context document is too long');
  });

  void test('a save over a newer one says so and keeps the text (LAI-555)', () => {
    const cause = new ApiError('conflict', 'The context document is at revision 2, not 1', 409, {
      reason: 'stale_context_revision',
      base_revision: 1,
      current_revision: 2,
    });
    assert.match(readableContextError(cause), /newer version.*Your text is still here/);
  });

  void test('a non-API failure does not pretend to be one', () => {
    assert.equal(
      readableContextError(new Error('offline')),
      'Could not save the context document.',
    );
  });
});

void describe('the stale-save refusal is read, not guessed (LAI-556)', () => {
  void test('the 409 names both revisions', () => {
    const cause = new ApiError('conflict', 'stale', 409, {
      reason: 'stale_context_revision',
      base_revision: 3,
      current_revision: 5,
    });
    assert.deepEqual(staleContextOf(cause), { base_revision: 3, current_revision: 5 });
    assert.match(readableContextError(cause), /\(r5\) while you were editing r3/);
  });

  void test('any other conflict is not a stale save', () => {
    const cause = new ApiError('conflict', 'taken', 409, { reason: 'something_else' });
    assert.equal(staleContextOf(cause), null);
    assert.equal(staleContextOf(new Error('offline')), null);
  });
});

void describe('the server diff is drawn line by line', () => {
  void test('markers become kinds and the line keeps its text verbatim', () => {
    const lines = diffLinesOf('@@ -1,2 +1,2 @@\n same\n-old\n+new\n+-starts with a dash');
    assert.deepEqual(lines, [
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'same', text: 'same' },
      { kind: 'removed', text: 'old' },
      { kind: 'added', text: 'new' },
      { kind: 'added', text: '-starts with a dash' },
    ]);
  });

  void test('an empty diff is no lines, not one blank line', () => {
    assert.deepEqual(diffLinesOf(''), []);
  });
});
