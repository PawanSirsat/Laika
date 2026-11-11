/**
 * `src/api/owner-setup.ts` — an admin may not act on the owner's setup
 * (D-133; LAI-1137, LAI-1143). The client's mirror of the server's rule, and
 * the sentence for its `403 not_for_owner`, shared by the profile's Developer
 * setup tab, the Manage member panel and Organisation → Security (LAI-1140).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../src/api/errors.ts';
import {
  isNotForOwner,
  mayActOnSetupOf,
  NOT_FOR_OWNER_LINE,
  revokeRefusal,
} from '../../src/api/owner-setup.ts';

void describe('mayActOnSetupOf', () => {
  void test('an admin may act on a member’s or an admin’s setup, never the owner’s', () => {
    assert.equal(mayActOnSetupOf('admin', 'member'), true);
    assert.equal(mayActOnSetupOf('admin', 'viewer'), true);
    assert.equal(mayActOnSetupOf('admin', 'admin'), true);
    assert.equal(mayActOnSetupOf('admin', 'owner'), false);
  });

  void test('the owner may act on anyone’s, their own role included', () => {
    assert.equal(mayActOnSetupOf('owner', 'owner'), true);
    assert.equal(mayActOnSetupOf('owner', 'member'), true);
  });
});

void describe('the refusal', () => {
  const owner = new ApiError('forbidden', 'An admin cannot change the owner’s setup', 403, {
    action: 'token.revoke_any',
    reason: 'not_for_owner',
  });

  void test('403 not_for_owner is recognised by its reason, not its status', () => {
    assert.equal(isNotForOwner(owner), true);
    assert.equal(isNotForOwner(new ApiError('forbidden', 'No', 403, { reason: 'other' })), false);
    assert.equal(isNotForOwner(new ApiError('forbidden', 'No', 403)), false);
    assert.equal(isNotForOwner(null), false);
  });

  void test('it is said in the reader’s terms; anything else is the server’s sentence', () => {
    assert.equal(revokeRefusal(owner, 'x'), NOT_FOR_OWNER_LINE);
    assert.equal(
      NOT_FOR_OWNER_LINE,
      'Only the owner can change the owner’s setup. Nothing was changed.',
    );
    assert.equal(revokeRefusal(new ApiError('internal', 'Boom', 500), 'x'), 'Boom');
    assert.equal(revokeRefusal('not an error', 'fallback'), 'fallback');
  });
});
