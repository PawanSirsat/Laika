import { describe, expect, it } from 'vitest';
import { REQUEST_ID_HEADER } from '../../../src/http/middleware/request-id.ts';
import { TEST_VERSION, testApp } from '../../helpers/app.ts';

describe('GET /api/v1/health', () => {
  it('returns 200 with status, version and uptime', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/health');

    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.version).toBe(TEST_VERSION);
    expect(typeof body.uptime_ms).toBe('number');
    expect(body.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(body.uptime_ms)).toBe(true);
  });

  it('carries a request id on the response', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/health');

    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honours an inbound request id so a proxy can correlate', async () => {
    const { app, log } = testApp();

    const res = await app.request('/api/v1/health', {
      headers: { [REQUEST_ID_HEADER]: 'edge-abc-123' },
    });

    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('edge-abc-123');
    expect(log.find('http.request')?.request_id).toBe('edge-abc-123');
  });

  it('rejects an implausible inbound request id rather than logging it', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/health', {
      headers: { [REQUEST_ID_HEADER]: 'a'.repeat(500) },
    });

    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs one structured line per request with the SPEC §13.2 fields', async () => {
    const { app, log } = testApp();

    await app.request('/api/v1/health');

    const record = log.find('http.request');
    expect(record).toBeDefined();
    expect(record).toMatchObject({
      level: 'info',
      method: 'GET',
      path: '/api/v1/health',
      status: 200,
      actor_id: null,
      actor_kind: null,
      token_id: null,
    });
    expect(typeof record?.duration_ms).toBe('number');
  });
});
