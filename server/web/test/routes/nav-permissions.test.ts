/**
 * `nav-permissions.ts` — one mirror of the server's rules, not two (LAI-248).
 *
 * This predicate decides whether a gated entry is offered. It was inside
 * `Sidebar`, under a comment saying *"one mirror, not two"* — and then the space
 * tab bar needed the same answer, because `/dashboard` requires
 * `audit_log.export`. Copying it would have made that comment false the moment
 * it was written.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { permissionHolder } from '../../src/routes/nav-permissions.ts';
import { ORG_ROLES } from '../../src/api/invites.ts';
import { mayTriageUnlisted } from '../../src/api/unlisted.ts';

void describe('who holds a nav permission', () => {
  /**
   * The point of the module: it must agree with the predicate the unlisted
   * screen itself uses, **for every role**, not for the two somebody thought of.
   */
  void test('it defers to `mayTriageUnlisted` for every org role', () => {
    for (const role of ORG_ROLES) {
      assert.equal(
        permissionHolder(role)('audit_log.export'),
        mayTriageUnlisted(role),
        `${role} disagrees with the screen's own predicate`,
      );
    }
    // …and the roles are not all the same answer, or this proves nothing.
    const answers = new Set(ORG_ROLES.map((r) => permissionHolder(r)('audit_log.export')));
    assert.equal(answers.size, 2, 'every role gets the same answer — the check is vacuous');
  });

  void test('an unknown permission is never granted', () => {
    // Fail closed: a new `requires` string that nobody taught this about must
    // hide the entry, not offer it.
    for (const role of [...ORG_ROLES, undefined]) {
      assert.equal(permissionHolder(role)('something.invented'), false);
    }
  });

  void test('no role at all grants nothing', () => {
    // The pre-auth render and the tests pass no role. Gated entries stay hidden
    // rather than leaking on the frame before the session lands.
    assert.equal(permissionHolder(undefined)('audit_log.export'), false);
    assert.equal(permissionHolder('')('audit_log.export'), false);
  });
});
