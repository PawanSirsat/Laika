/**
 * `src/api/permissions.ts` — the call, and the shape against the server's
 * (LAI-950).
 *
 * ## Why the shape is compared here and not in `view-type-drift.test.ts`
 *
 * A `PAIRS` entry there is what the server's response-type census counts, and
 * the census lists `PermissionsView` as unpaired in a file that is CORE's. A
 * pair added from this side alone turns that entry stale and the census red,
 * so the pair waits for both halves. Until it lands, the comparison is made
 * directly, the way `org.test.ts` checks what the drift check cannot.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  getOrgPermissions,
  getPermissions,
  holdsOrgAction,
  holdsProjectAction,
  implicitlyLeads,
  setOrgPermissions,
  type Permissions,
} from '../../src/api/permissions.ts';
import { permissionHolder } from '../../src/routes/nav-permissions.ts';
import { fieldsOf } from '../helpers/interfaces.ts';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const server = read('../../../src/services/permissions.ts');
const client = read('../../src/api/permissions.ts');

const sent: string[] = [];
const writes: { method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push(input instanceof URL ? input.href : input);
  writes.push({
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  });
  return Promise.resolve(
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}) as unknown as typeof fetch;

void describe('the call (§6.4)', () => {
  void test('GET /api/v1/permissions', async () => {
    await getPermissions();
    assert.deepEqual(sent, ['/api/v1/permissions']);
  });

  void test('GET /api/v1/org/permissions (LAI-960)', async () => {
    sent.length = 0;
    await getOrgPermissions();
    assert.deepEqual(sent, ['/api/v1/org/permissions']);
  });

  void test('PUT /api/v1/org/permissions sends the whole matrix as { grants }', async () => {
    sent.length = 0;
    writes.length = 0;
    const grants = { admin: { a: true }, member: { a: false } };
    await setOrgPermissions(grants);
    assert.deepEqual(sent, ['/api/v1/org/permissions']);
    assert.deepEqual(writes, [{ method: 'PUT', body: { grants } }]);
  });
});

void describe('the client sees every field the server sends, and no other', () => {
  for (const [serverName, clientName] of [
    ['PermissionsView', 'Permissions'],
    ['PermissionRow', 'PermissionRow'],
    ['ProjectGrants', 'ProjectGrants'],
  ] as const) {
    void test(`${clientName} matches ${serverName}`, () => {
      const served = fieldsOf(server, serverName);
      const declared = fieldsOf(client, clientName);
      // A rename must fail loudly rather than compare two empty lists.
      assert.ok(served !== undefined && served.length > 0, `${serverName} not found on the server`);
      assert.ok(declared !== undefined && declared.length > 0, `${clientName} not found`);
      assert.deepEqual(declared, served);
    });
  }
});

/** A `GET /permissions` answer, `me` only — the gates read nothing else. */
function view(me: Partial<Permissions['me']>): Permissions {
  return {
    org_roles: [],
    project_roles: [],
    permissions: [],
    me: {
      org_role: 'member',
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: null,
      actions: [],
      projects: [],
      ...me,
    },
  };
}

void describe('the gates read the server, never a role (LAI-970)', () => {
  void test('nothing is held before the server answers — whatever the role would say', () => {
    assert.equal(holdsOrgAction(undefined, 'user.invite'), false);
    assert.equal(holdsProjectAction(undefined, 'p1', 'project.settings.edit'), false);
    assert.equal(implicitlyLeads(undefined, 'p1'), false);
    assert.equal(permissionHolder(undefined)('audit_log.export'), false);
  });

  void test('an admin the owner withdrew a grant from does not hold it', () => {
    const admin = view({ org_role: 'admin', actions: ['org.read', 'user.invite'] });
    assert.equal(holdsOrgAction(admin, 'user.invite'), true);
    assert.equal(holdsOrgAction(admin, 'org.developer_insights.set'), false);
    assert.equal(permissionHolder(admin.me.actions)('audit_log.export'), false);
  });

  void test('a member the owner granted settings holds them', () => {
    const member = view({ actions: ['org.developer_insights.set', 'org.time.set'] });
    assert.equal(holdsOrgAction(member, 'org.developer_insights.set'), true);
    assert.equal(holdsOrgAction(member, 'user.invite'), false);
  });

  void test('an explicit lead holds the project-context editor without any implicit role', () => {
    const lead = view({
      projects: [{ project_id: 'p1', role: 'lead', actions: ['project.settings.edit'] }],
    });
    assert.equal(implicitlyLeads(lead, 'p1'), false);
    assert.equal(holdsProjectAction(lead, 'p1', 'project.settings.edit'), true);
    assert.equal(holdsProjectAction(lead, 'p2', 'project.settings.edit'), false);
  });

  void test('a membership answers from the actions the server listed for it', () => {
    const member = view({
      implicit_project_role: 'lead',
      projects: [{ project_id: 'p1', role: 'member', actions: ['task.write'] }],
    });
    assert.equal(holdsProjectAction(member, 'p1', 'project.settings.edit'), false);
    assert.equal(holdsProjectAction(member, 'p1', 'task.write'), true);
  });

  void test('an implicit lead holds lead actions in a project they are not a member of', () => {
    const admin = view({ org_role: 'admin', implicit_project_role: 'lead' });
    assert.equal(implicitlyLeads(admin, 'p9'), true);
    assert.equal(holdsProjectAction(admin, 'p9', 'project.settings.edit'), true);
    assert.equal(holdsProjectAction(admin, 'p9', 'sprint.manage'), true);
  });

  void test('an org viewer granted Open every project is a viewer there, never offered settings', () => {
    const viewer = view({ org_role: 'viewer', implicit_project_role: 'viewer' });
    assert.equal(implicitlyLeads(viewer, 'p9'), false);
    assert.equal(holdsProjectAction(viewer, 'p9', 'project.settings.edit'), false);
    assert.equal(holdsProjectAction(viewer, 'p9', 'task.write'), false);
  });

  void test('a token’s project whitelist bounds everything, the implicit role included', () => {
    const scoped = view({ implicit_project_role: 'lead', project_scope: ['p1'] });
    assert.equal(implicitlyLeads(scoped, 'p1'), true);
    assert.equal(implicitlyLeads(scoped, 'p2'), false);
    assert.equal(holdsProjectAction(scoped, 'p2', 'project.settings.edit'), false);
  });
});
