import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_STATUS, type ErrorCode } from '../../src/errors.ts';
import { REQUEST_ID_HEADER } from '../../src/http/middleware/request-id.ts';
import { testApp } from '../helpers/app.ts';

describe('error envelope (SPEC §6.3)', () => {
  it('answers an unknown API route with a JSON not_found envelope', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(body.error.code).toBe('not_found');
    expect(typeof body.error.message).toBe('string');
    expect('details' in body.error).toBe(true);
  });

  it('answers unknown /mcp and /webhooks paths as JSON, not as the SPA', async () => {
    const { app } = testApp();

    for (const path of ['/mcp', '/mcp/anything', '/webhooks/github']) {
      const res = await app.request(path);

      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type'), path).toContain('application/json');
    }
  });

  it('always includes a details key so the shape never varies', () => {
    const withoutDetails = new ApiError('conflict', 'Taken').toBody();
    const withDetails = new ApiError('unprocessable', 'Bad field', { field: 'title' }).toBody();

    expect(withoutDetails.error.details).toBeNull();
    expect(withDetails.error.details).toEqual({ field: 'title' });
  });

  it('maps every SPEC §6.3 code to its documented status', () => {
    const expected: Record<ErrorCode, number> = {
      bad_request: 400,
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      unprocessable: 422,
      rate_limited: 429,
      internal: 500,
    };

    expect(ERROR_STATUS).toEqual(expected);

    for (const [code, status] of Object.entries(expected)) {
      expect(new ApiError(code as ErrorCode, 'x').status, code).toBe(status);
    }
  });
});

describe('unhandled errors', () => {
  /** Mounts a route that throws, on an app built exactly like the real one. */
  function appThatThrows(thrown: unknown) {
    const { app, log } = testApp();
    const boom = new Hono();
    boom.get('/', () => {
      throw thrown;
    });
    app.route('/api/v1/boom', boom);
    return { app, log };
  }

  it('returns internal with no leaked detail', async () => {
    const secret = 'connect ECONNREFUSED 10.0.0.5:5432 password=hunter2';
    const { app } = appThatThrows(new Error(secret));

    const res = await app.request('/api/v1/boom');

    expect(res.status).toBe(500);

    const raw = await res.text();
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('ECONNREFUSED');
    expect(raw).not.toContain('at ');

    const body = JSON.parse(raw) as { error: Record<string, unknown> };
    expect(body.error.code).toBe('internal');
    expect(body.error.message).toBe('Internal server error');
  });

  it('returns the request_id on a 5xx and logs the same one (SPEC §13.2)', async () => {
    const { app, log } = appThatThrows(new Error('kaboom'));

    const res = await app.request('/api/v1/boom', {
      headers: { [REQUEST_ID_HEADER]: 'trace-42' },
    });

    const body = (await res.json()) as { error: { details: { request_id: string } } };
    expect(body.error.details.request_id).toBe('trace-42');

    const logged = log.find('http.unhandled');
    expect(logged?.request_id).toBe('trace-42');
    expect(logged?.message).toBe('kaboom');
  });

  it('survives a thrown non-Error without leaking it', async () => {
    const { app, log } = appThatThrows({ nasty: 'payload' });

    const res = await app.request('/api/v1/boom');

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('nasty');
    expect(log.find('http.unhandled')).toBeDefined();
  });
});
