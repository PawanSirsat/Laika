/**
 * `src/api/members.ts` (LAI-059).
 *
 * Worth pinning: the mutations return the **full list** and the screen must
 * use it. Who is offered the controls is the server's `project.members.manage`
 * (`GET /permissions`, LAI-970), tested with the other gates in
 * `test/api/permissions.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { changeMemberRole, listMembers, removeMember } from '../../src/api/members.ts';

interface Call {
  url: string;
  init: RequestInit;
}

function stub(response: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: input instanceof URL ? input.href : input, init });
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

const list = {
  members: [
    { user_id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', role: 'lead', created_at: 0 },
  ],
};

void describe('mutations return the whole list', () => {
  void test('changeMemberRole PATCHes and returns members', async () => {
    const calls = stub(list);
    const result = await changeMemberRole('laika-core', 'u1', 'member');

    assert.equal(calls[0]?.url, '/api/v1/projects/laika-core/members/u1');
    assert.equal(calls[0]?.init.method, 'PATCH');
    const body = calls[0]?.init.body;
    assert.equal(typeof body, 'string');
    assert.deepEqual(JSON.parse(body as string), { role: 'member' });
    assert.equal(result.members.length, 1);
  });

  void test('removeMember DELETEs and returns members', async () => {
    const calls = stub({ members: [] });
    const result = await removeMember('laika-core', 'u1');

    assert.equal(calls[0]?.url, '/api/v1/projects/laika-core/members/u1');
    assert.equal(calls[0]?.init.method, 'DELETE');
    assert.deepEqual(result.members, []);
  });

  void test('ids and slugs are escaped', async () => {
    const calls = stub(list);
    await changeMemberRole('a b', 'u/1', 'viewer');
    assert.ok(calls[0]?.url.includes('a%20b'));
    assert.ok(calls[0]?.url.includes('u%2F1'));
  });

  void test('listMembers reads the { members } envelope, not a page', async () => {
    stub(list);
    assert.equal((await listMembers('laika-core')).members[0]?.name, 'Ada Lovelace');
  });
});
