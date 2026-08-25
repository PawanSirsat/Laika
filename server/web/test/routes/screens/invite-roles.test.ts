/**
 * `src/routes/screens/invite-roles.ts` (LAI-077 AC3).
 *
 * AC3: *"The permission line must match §3.1 for that role — do not paraphrase
 * loosely."* These lines are the only description of what someone is accepting,
 * shown at the moment they accept it, and they cannot be corrected afterwards
 * by the person reading them.
 *
 * The risk is not a typo. It is claiming a capability the product does not have
 * — the prototype's own Member line promises control over **billing**, which
 * Laika has no concept of — or promising a project-level right (§3.2) as though
 * the org role granted it everywhere.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { ORG_ROLES, PROJECT_ROLES } from '../../../src/api/invites.ts';
import {
  ORG_ROLE_PERMITS,
  PROJECT_ROLE_PERMITS,
  orgRoleLabel,
} from '../../../src/routes/screens/invite-roles.ts';

void describe('every role an invite can carry has a description', () => {
  void test('all four org roles, because POST /invites accepts all four', () => {
    // `org_role: z.enum(ORG_ROLES)` — `owner` is invitable. A lookup that
    // returned `undefined` would print nothing in the one place whose entire
    // job is telling the reader what they are being given.
    for (const role of ORG_ROLES) {
      const line = ORG_ROLE_PERMITS[role];
      assert.ok(line !== undefined && line.length > 0, `no description for org role ${role}`);
    }
    assert.equal(Object.keys(ORG_ROLE_PERMITS).length, ORG_ROLES.length);
  });

  void test('all three project roles', () => {
    for (const role of PROJECT_ROLES) {
      assert.ok(PROJECT_ROLE_PERMITS[role]?.length > 0, `no description for project role ${role}`);
    }
    assert.equal(Object.keys(PROJECT_ROLE_PERMITS).length, PROJECT_ROLES.length);
  });

  void test('labels are capitalised for display, not lower-case enum values', () => {
    assert.equal(orgRoleLabel('member'), 'Member');
    assert.equal(orgRoleLabel('owner'), 'Owner');
  });
});

void describe('no line promises something this product does not have', () => {
  const all = [...Object.values(ORG_ROLE_PERMITS), ...Object.values(PROJECT_ROLE_PERMITS)];

  void test('nothing mentions billing', () => {
    // Straight from the mockup: "Cannot change org settings or billing." There
    // is no billing in the SPEC, no table, no endpoint. Telling someone their
    // role excludes them from a thing that does not exist invents a product.
    for (const line of all) {
      assert.ok(!/billing/i.test(line), `promises or denies billing: ${line}`);
    }
  });

  void test('nothing mentions capacity or presence, which have no endpoint', () => {
    // The previous wording said a Member could "start agent sessions that report
    // presence". `heartbeats` has no reader, no writer and no route, so that
    // sentence described a feature nobody could use.
    for (const line of all) {
      assert.ok(!/presence|heartbeat/i.test(line), `claims presence: ${line}`);
    }
  });
});

void describe('org lines describe org rights, not project rights', () => {
  void test('the Member line does not promise task editing everywhere', () => {
    // §3.1 gives an org Member: view the member list, join public projects,
    // generate own tokens. Creating and moving tasks is §3.2 and requires a
    // project role. The line must not read as an unconditional grant.
    const line = ORG_ROLE_PERMITS.member;
    if (/task/i.test(line)) {
      assert.match(
        line,
        /project/i,
        'mentions tasks without saying it depends on the project role',
      );
    }
    assert.match(line, /depends on your role/i, 'does not say the project role decides');
  });

  void test('the Viewer line says read-only, including its tokens', () => {
    // §3.1: Viewer generates tokens with `read_only` forced. That is a real
    // constraint someone accepting a Viewer invite should know before they
    // discover it from a 403.
    assert.match(ORG_ROLE_PERMITS.viewer, /read-only/i);
  });

  void test('the Admin line stops short of Owner', () => {
    // §3.1: Admin may change org roles but "not to Owner". An Admin who thinks
    // they can promote someone to Owner finds out by being refused.
    assert.match(ORG_ROLE_PERMITS.admin, /Owner/);
  });
});

void describe('the source keeps its reasoning', () => {
  void test('it cites §3.1 rather than the prototype', () => {
    // The wording was deliberately taken from the spec over the mockup, and the
    // next person to edit it needs to know that before "fixing" it back.
    const path = fileURLToPath(
      new URL('../../../src/routes/screens/invite-roles.ts', import.meta.url),
    );
    return readFile(path, 'utf8').then((source) => {
      assert.match(source, /§3\.1/, 'no reference to the permission matrix it came from');
    });
  });
});
