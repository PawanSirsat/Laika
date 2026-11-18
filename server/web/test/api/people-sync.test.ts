/**
 * `src/api/people-sync.ts` — the people sync on the Microsoft 365 card
 * (D-161, LAI-1330): each call's method, path and body.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getPeopleSync, savePeopleSync, syncPeopleNow } from '../../src/api/people-sync.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  return Promise.resolve(
    new Response('{"connected":true,"profile_enabled":false,"leavers_enabled":false}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

void describe('the calls (§6.4, LAI-1330)', () => {
  void test('each path written out whole, with its method and body', async () => {
    sent.length = 0;
    await getPeopleSync();
    await savePeopleSync({ profile_enabled: true, leavers_enabled: false });
    await syncPeopleNow();
    assert.deepEqual(sent, [
      { url: '/api/v1/org/people-sync', method: 'GET', body: undefined },
      {
        url: '/api/v1/org/people-sync',
        method: 'PUT',
        body: { profile_enabled: true, leavers_enabled: false },
      },
      { url: '/api/v1/org/people-sync/sync', method: 'POST', body: undefined },
    ]);
  });
});
