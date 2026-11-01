/**
 * `src/api/local-activity.ts` — the developer's side of D-079 (LAI-751).
 *
 * Each call goes to the path and method §6.4 names, and the writes carry only
 * what the server's strict bodies accept: a sharing change is `{ enabled?,
 * scope? }`, and the delete sends nothing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  deleteOwnLocalActivity,
  getActivitySharing,
  getOwnLocalActivity,
  LOCAL_ACTIVITY_SCOPES,
  otelEnvBlock,
  setActivitySharing,
} from '../../src/api/local-activity.ts';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(answer: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({
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
  return calls;
}

void describe('the developer’s requests (§6.4)', () => {
  void test('reads the sharing setting with GET', async () => {
    const calls = stub({ org_enabled: true, enabled: false });
    await getActivitySharing();
    assert.equal(calls[0]?.method, 'GET');
    assert.ok(calls[0]?.url.endsWith('/api/v1/me/activity-sharing'), calls[0]?.url);
  });

  void test('changes the scope with PUT, and only the scope (D-102 amended, LAI-964)', async () => {
    const calls = stub({ scope: 'laika-repos' });
    await setActivitySharing({ scope: 'laika-repos' });
    assert.deepEqual(
      calls.map((c) => [c.method, c.body]),
      [['PUT', { scope: 'laika-repos' }]],
    );
    // `enabled` is the organisation's now; the server refuses it 403, so the client cannot send it.
    // @ts-expect-error — not a field of the change any more.
    const refused: Parameters<typeof setActivitySharing>[0] = { enabled: true };
    void refused;
    assert.ok(calls[0]?.url.endsWith('/api/v1/me/activity-sharing'));
  });

  void test('previews the last fourteen days, and deletes with a bodiless DELETE', async () => {
    const calls = stub({ days: [] });
    await getOwnLocalActivity();
    assert.ok(calls[0]?.url.endsWith('/api/v1/me/local-activity?days=14'), calls[0]?.url);

    const gone = stub(null, 204);
    assert.equal(await deleteOwnLocalActivity(), undefined);
    assert.equal(gone[0]?.method, 'DELETE');
    assert.equal(gone[0]?.body, undefined);
    assert.ok(gone[0]?.url.endsWith('/api/v1/me/local-activity'));
  });

  void test('offers the two scopes the server stores', () => {
    assert.deepEqual([...LOCAL_ACTIVITY_SCOPES], ['agent-repos', 'laika-repos']);
  });
});

void describe('the OpenTelemetry block (LAI-773)', () => {
  // LAI-867: what `laika activity on` writes to settings.json — no export line, no token.
  void test('is metrics only, JSON, cumulative, logs off — this board’s address, a helper for the token', () => {
    const block = otelEnvBlock('https://laika.example.com');
    assert.deepEqual(JSON.parse(block), {
      env: {
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'https://laika.example.com/api/v1/otlp/v1/metrics',
        OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
        OTEL_LOGS_EXPORTER: 'none',
      },
      otelHeadersHelper: '~/.laika/otel-headers',
    });
    assert.doesNotMatch(block, /export |LAIKA_TOKEN|Bearer/);
    // Never a secret on the page, never a logs or traces endpoint.
    assert.doesNotMatch(block, /laika_[A-Za-z0-9]{8,}/);
    assert.doesNotMatch(block, /v1\/(logs|traces)/);
  });
});
