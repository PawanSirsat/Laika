/**
 * `src/api/developer-updates.ts` (LAI-1065): the compatibility answer read
 * whole, every time it is asked for — *Retry* depends on that — and a refusal
 * passed on as a rejection, which the Devices tab shows as *Could not check*.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getCompatibility } from '../../src/api/developer-updates.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
}

function stub(status: number, answer: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({ url: input instanceof URL ? input.href : input, method: init?.method ?? 'GET' });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

void describe('getCompatibility', () => {
  void test('GETs the board’s compatibility answer and hands back the body untouched', async () => {
    const body = {
      protocol: { current: 2, min_client: 1 },
      cli: { source: { commit: 'abc1234' } },
    };
    const sent = stub(200, body);
    assert.deepEqual(await getCompatibility(), body);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.method, 'GET');
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/developer\/compatibility$/);
  });

  void test('asks again each time: nothing is cached, so Retry reaches the board', async () => {
    const sent = stub(200, {});
    await getCompatibility();
    await getCompatibility();
    assert.equal(sent.length, 2);
  });

  void test('a refusal rejects with the server’s code', async () => {
    stub(500, { error: { code: 'internal', message: 'later' } });
    await assert.rejects(getCompatibility(), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, 'internal');
      return true;
    });
  });
});
