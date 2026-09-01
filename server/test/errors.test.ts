import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_STATUS, type ErrorCode } from '../src/errors.ts';
import { REQUEST_ID_HEADER } from '../src/http/middleware/request-id.ts';
import { SERVER_ROOT } from '../src/paths.ts';
import { testApp } from './helpers/app.ts';

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
      method_not_allowed: 405,
      conflict: 409,
      payload_too_large: 413,
      unprocessable: 422,
      rate_limited: 429,
      internal: 500,
      unavailable: 503,
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

describe('the vocabulary matches SPEC §6.3 (D-021)', () => {
  /**
   * AC5 asked whether the doc could be checked mechanically. It can: §6.3's table
   * is the contract, and a code drifting from it is exactly the failure a closed
   * vocabulary exists to prevent. Parsing the table means the spec and
   * `ERROR_STATUS` cannot disagree without something going red.
   *
   * `docs/` is PM's area — this reads it, never writes it.
   */
  function specTable(): Map<string, number> {
    const spec = readFileSync(join(SERVER_ROOT, '..', 'docs', 'SPEC.md'), 'utf8');
    const rows = [...spec.matchAll(/^\s*\|\s*`([a-z_]+)`\s*\|\s*(\d{3})\s*\|\s*$/gm)];

    // A parse that finds nothing must fail loudly rather than pass vacuously.
    if (rows.length === 0) {
      throw new Error(
        'Could not find the §6.3 error table in docs/SPEC.md — has its format changed?',
      );
    }

    return new Map(rows.map((r) => [r[1]!, Number(r[2])]));
  }

  it('has exactly the codes the spec lists, with the same statuses', () => {
    expect(Object.fromEntries(specTable())).toEqual({ ...ERROR_STATUS });
  });

  it('carries the two codes D-021 added', () => {
    const table = specTable();

    expect(table.get('payload_too_large')).toBe(413);
    expect(table.get('method_not_allowed')).toBe(405);
  });

  it('keeps them out of bad_request, which is the whole point of D-021', () => {
    // Clients branch on `code`: too-large means send less, wrong method means
    // call differently, malformed means fix the JSON.
    expect(ERROR_STATUS.payload_too_large).not.toBe(ERROR_STATUS.bad_request);
    expect(ERROR_STATUS.method_not_allowed).not.toBe(ERROR_STATUS.bad_request);
  });
});

describe('framework exceptions still carry a usable message', () => {
  it('substitutes a default when Hono throws with none', async () => {
    // `bodyLimit` throws a bare 413; `"message": ""` tells a client nothing.
    const { app } = testApp();
    const boom = new Hono();
    boom.get('/', () => {
      throw new HTTPException(413, {});
    });
    app.route('/api/v1/boom', boom);

    const res = await app.request('/api/v1/boom');
    const body = (await res.json()) as { error: { code: string; message: string } };

    expect(body.error.code).toBe('payload_too_large');
    expect(body.error.message).toBe('Request body is too large');
  });

  it('keeps a message the exception did supply', () => {
    expect(new ApiError('conflict', 'That slug is taken').toBody().error.message).toBe(
      'That slug is taken',
    );
  });
});
