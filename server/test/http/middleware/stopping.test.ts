import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * API requests are refused once shutdown has begun (§11.2, LAI-214).
 *
 * `server.close()` stops accepting new **TCP connections**, and a browser that
 * already holds an idle keep-alive connection can reuse it. A dev instance
 * answered two fresh `GET /api/v1/events` with `200` and a `ready` frame three
 * seconds into a ten-second grace window, from a process about to be killed.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let stopping: boolean;

beforeEach(async () => {
  stopping = false;
  h = authHarness({ isStopping: () => stopping });
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
});
afterEach(() => {
  h.close();
});

async function get(path: string): Promise<Response> {
  return h.app.request(path, { headers: jsonHeaders({ Cookie: cookie }) });
}

describe('once shutdown has begun', () => {
  it('does not open a new event stream', async () => {
    // Working before, refused after — so it cannot pass against an endpoint that
    // was broken all along.
    expect((await get('/api/v1/events')).status).toBe(200);

    stopping = true;

    const res = await get('/api/v1/events');
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('ready');
  });

  it('refuses every API path, not only the stream', async () => {
    stopping = true;

    for (const path of ['/api/v1/projects', '/api/v1/me', '/api/v1/users']) {
      // The reused-connection route serves any endpoint; the stream is only
      // where it was visible.
      expect((await get(path)).status, path).toBe(503);
    }
  });

  it('answers in §6.3’s envelope with something a client can act on', async () => {
    stopping = true;

    const body = (await (await get('/api/v1/projects')).json()) as {
      error: { code: string; details?: { retry_after_seconds?: number } };
    };

    // A refusal a client can retry beats a `200` it cannot use — and `503` is
    // what a load balancer, a browser and an `EventSource` already understand.
    expect(body.error.code).toBe('unavailable');
    expect(body.error.details?.retry_after_seconds).toBeGreaterThan(0);
  });

  it('still answers /health, so a supervisor learns we are draining', async () => {
    stopping = true;

    // Deliberately exempt: the process asking whether to keep routing traffic
    // here needs an answer, and refusing it would tell it nothing it can use.
    expect((await h.app.request('/api/v1/health')).status).toBe(200);
  });

  it('gives a definite answer rather than holding the socket', async () => {
    stopping = true;

    // AC4. A refusal is fine; a request that hangs to the end of the grace
    // window is the failure — and a hang here would show as a timeout rather
    // than a status.
    const res = await Promise.race([
      get('/api/v1/events'),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('hung')), 2_000)),
    ]);

    expect(res.status).toBe(503);
  });

  it('does nothing while the server is running', async () => {
    // The other half: asserting only the refusal passes against a gate that
    // refuses everything, always.
    for (const path of ['/api/v1/projects', '/api/v1/me', '/api/v1/events']) {
      expect((await get(path)).status, path).toBe(200);
    }
  });
});
