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
import { getOrgPermissions, getPermissions, setOrgPermissions } from '../../src/api/permissions.ts';
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
