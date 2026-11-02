/**
 * `src/api/tool-setup.ts` — adding a tool, reconnecting one, and what the
 * board saw of it (LAI-1061; API by LAI-1056, SPEC §4.80). Each call is the
 * route and method the server serves, an add sends **only the harness**, and
 * no call here ever reaches the device's redeem route.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  TOOL_SETUP_STATES,
  addToolToDevice,
  cancelToolSetup,
  getAgentVerification,
  getToolSetup,
  reconnectAgent,
} from '../../src/api/tool-setup.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(status = 200): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response('{}', { status, headers: { 'content-type': 'application/json' } }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

const shape = (sent: readonly Sent[]) =>
  sent.map((s) => [s.method, new URL(s.url, 'http://x').pathname, s.body]);

void describe('the tool setup calls', () => {
  void test('add, reconnect, read and verify name what they act on', async () => {
    const sent = stub(201);
    await addToolToDevice('d1', 'claude-code');
    await reconnectAgent('a1');
    await getToolSetup('x1');
    await getAgentVerification('a1');
    assert.deepEqual(shape(sent), [
      ['POST', '/api/v1/devices/d1/tools', { harness: 'claude-code' }],
      ['POST', '/api/v1/agents/a1/reconnect', undefined],
      ['GET', '/api/v1/tool-setup/x1', undefined],
      ['GET', '/api/v1/agents/a1/verification', undefined],
    ]);
    assert.ok(
      sent.every((s) => !s.url.includes('/redeem')),
      'the browser never redeems',
    );
  });

  void test('cancel DELETEs the exchange', async () => {
    const sent = stub(204);
    await cancelToolSetup('x1');
    assert.deepEqual(shape(sent), [['DELETE', '/api/v1/tool-setup/x1', undefined]]);
  });
});

void describe('the states mirror the server', () => {
  void test('TOOL_SETUP_STATES is the server enum', () => {
    const enums = readFileSync(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
    const found = /export const TOOL_SETUP_STATES = \[([^\]]*)\] as const/.exec(enums);
    assert.ok(found, 'the server no longer declares TOOL_SETUP_STATES as a literal array');
    const server = [...(found[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    assert.deepEqual([...TOOL_SETUP_STATES], server);
  });
});
