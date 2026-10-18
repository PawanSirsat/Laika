/**
 * `src/api/model-prices.ts` — the API-equivalent price table (LAI-773): the
 * code's dated prices and the organisation's own, said with whose they are.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getModelPrices,
  parsePrice,
  perMillion,
  priceStatus,
  resetModelPrice,
  setModelPrice,
} from '../../src/api/model-prices.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  return Promise.resolve(
    new Response('{"as_of":"2026-10-18","can_set":true,"entries":[]}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

void describe('the calls (§6.4)', () => {
  void test('GET /org/model-prices; PUT and DELETE one model', async () => {
    await getModelPrices();
    await setModelPrice('claude-opus-5-5', {
      input: 4,
      output: 20,
      cache_write: 5,
      cache_read: 0.2,
    });
    await resetModelPrice('gpt-5.2-codex');
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/org/model-prices', undefined],
        [
          'PUT',
          '/api/v1/org/model-prices/claude-opus-5-5',
          { input: 4, output: 20, cache_write: 5, cache_read: 0.2 },
        ],
        ['DELETE', '/api/v1/org/model-prices/gpt-5.2-codex', undefined],
      ],
    );
  });
});

void describe('a price, said', () => {
  void test('whose it is and how sure', () => {
    assert.equal(priceStatus({ overridden: true, confirmed: true }), 'organisation');
    assert.equal(priceStatus({ overridden: false, confirmed: true }), 'confirmed');
    assert.equal(priceStatus({ overridden: false, confirmed: false }), 'inferred');
  });

  void test('per million, as precise as given', () => {
    assert.equal(perMillion(4), '$4.00');
    assert.equal(perMillion(0.25), '$0.25');
    assert.equal(perMillion(0.125), '$0.125');
    assert.equal(perMillion(0.2), '$0.20');
    assert.equal(perMillion(12.5), '$12.50');
  });

  void test('as typed', () => {
    assert.equal(parsePrice('4'), 4);
    assert.equal(parsePrice('$0.125'), 0.125);
    for (const bad of ['', '-1', 'free', '10001']) assert.equal(parsePrice(bad), undefined, bad);
  });
});
