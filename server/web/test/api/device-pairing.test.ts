/**
 * `src/api/device-pairing.ts` — the owner's side of pairing (LAI-1061; API by
 * LAI-1050, SPEC §4.79). Each call is the route and method the server serves,
 * approve and deny send **the fingerprint they are given** and nothing else,
 * and the states are the server's.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  PAIRING_STATES,
  approvePairingRequest,
  cancelPairingRequest,
  createPairingRequest,
  denyPairingRequest,
  getPairingRequest,
} from '../../src/api/device-pairing.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(status = 200, answer: unknown = {}): Sent[] {
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
        : new Response(JSON.stringify(answer), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

void describe('the pairing calls', () => {
  void test('create POSTs kind and name, and an imported device only when chosen', async () => {
    const sent = stub(201, { pairing: {}, user_code: 'X', command: 'laika device pair' });
    await createPairingRequest({ kind: 'local', display_name: 'Belka' });
    await createPairingRequest({ kind: 'cloud', display_name: 'Runner', device_id: 'd2' });
    assert.deepEqual(
      sent.map((s) => [s.method, new URL(s.url, 'http://x').pathname, s.body]),
      [
        ['POST', '/api/v1/devices/pairing-requests', { kind: 'local', display_name: 'Belka' }],
        [
          'POST',
          '/api/v1/devices/pairing-requests',
          { kind: 'cloud', display_name: 'Runner', device_id: 'd2' },
        ],
      ],
    );
  });

  void test('read, approve, deny and cancel name the request; decisions echo the fingerprint', async () => {
    const sent = stub(200, {});
    await getPairingRequest('p/1');
    await approvePairingRequest('p1', '7f3a91c2');
    await denyPairingRequest('p1', '7f3a91c2');
    const cancelled = stub(204);
    await cancelPairingRequest('p1');
    assert.deepEqual(
      sent.map((s) => [s.method, new URL(s.url, 'http://x').pathname, s.body]),
      [
        ['GET', '/api/v1/devices/pairing-requests/p%2F1', undefined],
        ['POST', '/api/v1/devices/pairing-requests/p1/approve', { key_fingerprint: '7f3a91c2' }],
        ['POST', '/api/v1/devices/pairing-requests/p1/deny', { key_fingerprint: '7f3a91c2' }],
      ],
    );
    assert.deepEqual(
      cancelled.map((s) => [s.method, new URL(s.url, 'http://x').pathname]),
      [['DELETE', '/api/v1/devices/pairing-requests/p1']],
    );
  });
});

void describe('the states mirror the server', () => {
  void test('PAIRING_STATES is DEVICE_PAIRING_STATES in db/enums.ts', () => {
    const enums = readFileSync(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
    const found = /export const DEVICE_PAIRING_STATES = \[([^\]]*)\] as const/.exec(enums);
    assert.ok(found, 'the server no longer declares DEVICE_PAIRING_STATES as a literal array');
    const server = [...(found[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    assert.deepEqual([...PAIRING_STATES], server);
  });
});
