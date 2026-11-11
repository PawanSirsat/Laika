/**
 * `src/api/developer-setup.ts` — a member's developer setup and the admin
 * revokes (LAI-1140; API by LAI-1137, SPEC §6.4). Each call reaches the path
 * it names, with the ids encoded, and hands the answer on as it came.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getDeveloperSetup,
  revokeMemberTool,
  unpairMemberDevice,
} from '../../src/api/developer-setup.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
}

function stub(answer: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({ url: input instanceof URL ? input.href : input, method: init?.method ?? 'GET' });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

void describe('the developer setup calls', () => {
  void test('the read is one GET of /people/:id/developer-setup, answer unchanged', async () => {
    const served = { now: 1, user: { id: 'u/2' } };
    const sent = stub(served);
    assert.deepEqual(await getDeveloperSetup('u/2'), served);
    assert.deepEqual(sent, [{ url: '/api/v1/people/u%2F2/developer-setup', method: 'GET' }]);
  });

  void test('Revoke tool POSTs to the member’s agent', async () => {
    const sent = stub({ id: 'a1', status: 'revoked' });
    const tool = await revokeMemberTool('u2', 'a 1');
    assert.equal(tool.status, 'revoked');
    assert.deepEqual(sent, [{ url: '/api/v1/people/u2/agents/a%201/revoke', method: 'POST' }]);
  });

  void test('Unpair POSTs to the member’s device and returns what it revoked', async () => {
    const sent = stub({ device: { id: 'd1' }, revoked_agent_ids: ['a1', 'a2'] });
    const done = await unpairMemberDevice('u2', 'd1');
    assert.deepEqual(done.revoked_agent_ids, ['a1', 'a2']);
    assert.deepEqual(sent, [{ url: '/api/v1/people/u2/devices/d1/revoke', method: 'POST' }]);
  });
});
