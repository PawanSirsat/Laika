/**
 * The metrics client (LAI-275, closing LAI-457).
 *
 * The module's whole job is to ask the right URL and to name the shape; it
 * computes nothing, so what is worth pinning is the **request** — and that the
 * two "nothing here" shapes are carried through rather than flattened.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { getMetrics, type MetricsView } from '../../src/api/metrics.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(body: unknown): { readonly urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL) => {
    // `Request` and `URL` both stringify usefully; a bare object would not, so
    // the two cases are spelled out rather than run through `String()`.
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { urls };
}

const EMPTY: MetricsView = { since: 1, throughput: [], cycle_time: null };

void describe('getMetrics', () => {
  void test('asks the project’s metrics endpoint', async () => {
    const calls = stub(EMPTY);
    await getMetrics('laika-core');
    assert.equal(calls.urls.length, 1);
    assert.match(calls.urls[0] ?? '', /\/projects\/laika-core\/metrics$/);
  });

  void test('passes `since` through, and omits it entirely when absent', async () => {
    const withSince = stub(EMPTY);
    await getMetrics('laika-core', 1_700_000_000_000);
    assert.match(calls(withSince), /\?since=1700000000000$/);

    const without = stub(EMPTY);
    await getMetrics('laika-core');
    // Not `?since=undefined`, which the server answers `400` for.
    assert.doesNotMatch(calls(without), /since/);
  });

  void test('escapes a slug rather than pasting it into the path', async () => {
    const calls2 = stub(EMPTY);
    await getMetrics('a/b');
    assert.match(calls(calls2), /projects\/a%2Fb\/metrics/);
  });

  void test('carries `cycle_time: null` through as null', async () => {
    stub(EMPTY);
    const view = await getMetrics('laika-core');
    /*
     * `null` means *nothing completed in the window* and a zeroed shape would
     * claim every task finished instantly. A client that helpfully substituted
     * `{ p50_ms: 0 }` here would be inventing the one figure this endpoint
     * exists to report.
     */
    assert.equal(view.cycle_time, null);
  });

  void test('keeps a zero-completion day rather than dropping it', async () => {
    stub({
      since: 1,
      throughput: [
        { day: '2026-09-16', completed: 2 },
        { day: '2026-09-17', completed: 0 },
        { day: '2026-09-18', completed: 1 },
      ],
      cycle_time: null,
    });
    const view = await getMetrics('laika-core');
    // The server sends quiet days explicitly so a chart's spacing is the real
    // calendar; dropping them here would compact it back.
    assert.equal(view.throughput.length, 3);
    assert.equal(view.throughput[1]?.completed, 0);
  });
});

function calls(c: { readonly urls: string[] }): string {
  return c.urls[0] ?? '';
}
