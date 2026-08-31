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
  canEditProjectContext,
  contextBudget,
  readableContextError,
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

  void test('a refusal without details still says something true', () => {
    const cause = new ApiError('unprocessable', 'That context document is too long', 422, null);
    assert.equal(readableContextError(cause), 'That context document is too long');
  });

  void test('a non-API failure does not pretend to be one', () => {
    assert.equal(
      readableContextError(new Error('offline')),
      'Could not save the context document.',
    );
  });
});

void describe('the editor is offered only to someone who may use it', () => {
  const PROJECT = 'p1';
  const lead = [{ project_id: PROJECT, role: 'lead' }];
  const member = [{ project_id: PROJECT, role: 'member' }];
  const viewer = [{ project_id: PROJECT, role: 'viewer' }];

  void test('org owner and admin may edit without a membership row', () => {
    // They hold implicit lead — an Admin with no row on the project still edits.
    assert.equal(canEditProjectContext('owner', PROJECT, []), true);
    assert.equal(canEditProjectContext('admin', PROJECT, []), true);
  });

  void test('a project lead may', () => {
    assert.equal(canEditProjectContext('member', PROJECT, lead), true);
  });

  void test('a member and a viewer may not', () => {
    // §7.3: reading follows project read, editing is lead+. Offering them an
    // editor that answers 403 teaches them the app is broken.
    assert.equal(canEditProjectContext('member', PROJECT, member), false);
    assert.equal(canEditProjectContext('member', PROJECT, viewer), false);
  });

  void test('a lead on another project may not edit this one', () => {
    assert.equal(
      canEditProjectContext('member', PROJECT, [{ project_id: 'other', role: 'lead' }]),
      false,
    );
  });
});
