/**
 * What the Roles & permissions tab draws comes from the response (LAI-950).
 *
 * Every fixture here is **invented** — an action, a role and a label no
 * server has — so a module that knew §3 could not pass by knowing it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PermissionRow, Permissions } from '../../../../src/api/permissions.ts';
import {
  actionName,
  cellFor,
  heldNames,
  projectLabel,
  rowsFor,
} from '../../../../src/routes/screens/organisation/permissions-view.ts';

const row = (extra: Partial<PermissionRow> & Pick<PermissionRow, 'action'>): PermissionRow => ({
  scope: 'org',
  label: null,
  session_only: false,
  read_only: false,
  condition: null,
  roles: {},
  ...extra,
});

const VIEW: Permissions = {
  org_roles: ['steward', 'guest'],
  project_roles: ['pilot'],
  permissions: [
    row({ action: 'kite.fly', label: 'Fly the kite', roles: { steward: 'yes', guest: 'no' } }),
    row({ action: 'kite.mend', roles: { steward: 'yes' } }),
    row({ action: 'kite.lend', label: 'Fly the kite' }),
    row({
      action: 'rope.coil',
      scope: 'project',
      label: 'Coil rope',
      condition: 'Their own rope only',
      roles: { pilot: 'conditional' },
    }),
  ],
  me: {
    org_role: 'steward',
    credential: 'token',
    project_scope: ['p1'],
    implicit_project_role: null,
    actions: ['kite.fly', 'kite.lend', 'kite.mend', 'kite.unknown'],
    projects: [],
  },
};

void describe('names come from the response', () => {
  void test('a row with a label shows it', () => {
    assert.equal(actionName(VIEW.permissions[0]!), 'Fly the kite');
  });

  void test('a row with no label shows its action, not invented text', () => {
    assert.equal(actionName(VIEW.permissions[1]!), 'kite.mend');
  });

  void test('each table is the rows of its scope, in the order sent', () => {
    assert.deepEqual(
      rowsFor(VIEW, 'org').map((r) => r.action),
      ['kite.fly', 'kite.mend', 'kite.lend'],
    );
    assert.deepEqual(
      rowsFor(VIEW, 'project').map((r) => r.action),
      ['rope.coil'],
    );
  });

  void test('held actions are named once each, and an unknown one by its id', () => {
    assert.deepEqual(heldNames(VIEW, VIEW.me.actions), [
      'Fly the kite',
      'kite.mend',
      'kite.unknown',
    ]);
  });

  void test('a project is named when visible, otherwise by the id sent', () => {
    assert.equal(projectLabel([{ id: 'p1', name: 'Kites' }], 'p1'), 'Kites');
    assert.equal(projectLabel([], 'p1'), 'p1');
  });
});

void describe('a cell says what the server said', () => {
  void test('yes and no', () => {
    assert.deepEqual(cellFor(VIEW.permissions[0]!, 'steward'), { kind: 'yes', text: 'Yes' });
    assert.deepEqual(cellFor(VIEW.permissions[0]!, 'guest'), { kind: 'no', text: 'No' });
  });

  void test('conditional is the condition text', () => {
    assert.deepEqual(cellFor(VIEW.permissions[3]!, 'pilot'), {
      kind: 'conditional',
      text: 'Their own rope only',
    });
  });

  void test('a role the row does not mention is absent, not a refusal', () => {
    assert.deepEqual(cellFor(VIEW.permissions[1]!, 'guest'), { kind: 'absent', text: '—' });
  });

  void test('an answer this client does not know is shown as sent', () => {
    const odd = row({ action: 'kite.x', roles: { guest: 'on_tuesdays' } });
    assert.deepEqual(cellFor(odd, 'guest'), { kind: 'on_tuesdays', text: 'on_tuesdays' });
  });
});
