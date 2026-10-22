/**
 * `nav-permissions.ts` — one mirror of the server's rules, not two (LAI-248).
 *
 * This predicate decides whether a gated entry is offered. It was inside
 * `Sidebar`, under a comment saying *"one mirror, not two"* — and then the space
 * tab bar needed the same answer, because `/dashboard` requires
 * `audit_log.export`. Copying it would have made that comment false the moment
 * it was written.
 *
 * Since LAI-970 it mirrors nothing: it answers from `GET /permissions`'
 * `me.actions`, which carries the owner's grants, and from no role.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { permissionHolder } from '../../src/routes/nav-permissions.ts';

void describe('who holds a nav permission', () => {
  void test('it is exactly the server’s list of actions', () => {
    const holds = permissionHolder(['audit_log.export', 'profile.read']);
    assert.equal(holds('audit_log.export'), true);
    assert.equal(holds('profile.read'), true);
    assert.equal(holds('token.list_any'), false);
  });

  void test('an admin the owner withdrew the history from is not offered it', () => {
    // The default grants would have said yes to an admin; the server's answer
    // is what decides, and it no longer lists the action.
    assert.equal(permissionHolder(['token.list_any'])('audit_log.export'), false);
  });

  void test('an unknown permission is never granted', () => {
    // Fail closed: a new `requires` string nobody taught this about hides the
    // entry rather than offering it.
    assert.equal(permissionHolder(['audit_log.export'])('something.invented'), false);
  });

  void test('no answer grants nothing', () => {
    // Pre-auth, while `/permissions` is in flight, and when it failed. Gated
    // entries stay hidden rather than leaking on that frame.
    assert.equal(permissionHolder(undefined)('audit_log.export'), false);
    assert.equal(permissionHolder()('profile.read'), false);
    assert.equal(permissionHolder([])('token.list_any'), false);
  });
});
