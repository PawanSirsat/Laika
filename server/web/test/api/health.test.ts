/**
 * `src/api/health.ts` (LAI-064).
 *
 * Small, but it is the only endpoint that reports a version, and the sidebar
 * shows that version. Worth pinning the path and the fact that it is asked for
 * without credentials mattering — the pre-auth shell reads it too.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getHealth } from '../../src/api/health.ts';

function stub(response: unknown, status = 200): string[] {
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL) => {
    urls.push(input instanceof URL ? input.href : input);
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return urls;
}

void describe('getHealth', () => {
  void test('asks /health under the API base', async () => {
    const urls = stub({ status: 'ok', version: '0.1.0', uptime_ms: 1 });
    await getHealth();
    assert.equal(urls[0], '/api/v1/health');
  });

  void test('returns the version the server reports, verbatim', async () => {
    stub({ status: 'ok', version: '9.9.9-rc1', uptime_ms: 1 });
    const health = await getHealth();
    // Never reformatted or prefixed here: the sidebar adds its own `v`, and a
    // version invented or massaged in transit is the thing LAI-064 forbids.
    assert.equal(health.version, '9.9.9-rc1');
  });
});
