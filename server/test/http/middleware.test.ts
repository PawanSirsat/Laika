import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/app.ts';

/** Mounts an echo route on a real app so the whole chain runs in front of it. */
function appWithEcho() {
  const { app, log } = testApp();
  const echo = new Hono();
  echo.post('/', async (c) => c.json({ received: (await c.req.text()).length }));
  app.route('/api/v1/echo', echo);
  return { app, log };
}

describe('bodyLimit (SPEC §11.2, §13.1)', () => {
  it('accepts a body under the limit', async () => {
    const { app } = appWithEcho();

    const res = await app.request('/api/v1/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(1000) }),
    });

    expect(res.status).toBe(200);
  });

  it('refuses a body over 1 MiB as payload_too_large (D-021)', async () => {
    const { app } = appWithEcho();

    const res = await app.request('/api/v1/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(1024 * 1024 + 1),
    });

    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('payload_too_large');
    expect('details' in body.error).toBe(true);
  });
});

describe('cors (SPEC §11.2)', () => {
  it('grants no cross-origin access by default', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/health', {
      headers: { Origin: 'https://evil.example' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('middleware ordering', () => {
  it('logs a request even when the handler throws', async () => {
    const { app, log } = testApp();
    const boom = new Hono();
    boom.get('/', () => {
      throw new Error('nope');
    });
    app.route('/api/v1/boom', boom);

    await app.request('/api/v1/boom');

    // requestLogger wraps `next()` in a finally, so an error downstream still
    // produces exactly one request line — with the real status, not a guess.
    const record = log.find('http.request');
    expect(record).toMatchObject({ path: '/api/v1/boom', status: 500 });
  });

  it('gives the error handler the same request id the logger used', async () => {
    const { app, log } = testApp();
    const boom = new Hono();
    boom.get('/', () => {
      throw new Error('nope');
    });
    app.route('/api/v1/boom', boom);

    await app.request('/api/v1/boom');

    expect(log.find('http.request')?.request_id).toBe(log.find('http.unhandled')?.request_id);
  });
});

describe('status-to-code mapping for errors raised inside Hono', () => {
  it('never reports a 4xx as an internal server error', async () => {
    const { HTTPException } = await import('hono/http-exception');
    const { app } = testApp();

    const raiser = new Hono();
    raiser.get('/:status', (c) => {
      throw new HTTPException(Number(c.req.param('status')) as 405, { message: 'nope' });
    });
    app.route('/api/v1/raise', raiser);

    const expected: Record<number, string> = {
      // 405 has its own code since D-021; the rest still fall back rather than
      // being reported as server faults.
      405: 'method_not_allowed',
      410: 'bad_request',
      415: 'bad_request',
    };

    for (const [status, code] of Object.entries(expected)) {
      const res = await app.request(`/api/v1/raise/${status}`);
      const body = (await res.json()) as { error: { code: string } };

      expect(res.status, status).toBe(Number(status));
      expect(body.error.code, status).toBe(code);
    }
  });
});
