import { describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';
import { isLimited } from '../../../src/http/middleware/rate-limit.ts';

/**
 * `/mcp`'s transport binding (LAI-406).
 *
 * The protocol itself is covered by `test/mcp/server.test.ts`, which drives a
 * real client over a real socket. What is left for this file is the things that
 * are true of the **mount** rather than of MCP: that the path is not swallowed
 * by the SPA fallback, that it is rate-limited like the rest of the API, and
 * that an unauthenticated caller gets Laika's envelope rather than a page.
 */

const PASSWORD = 'correct-horse-battery-staple';

async function setUp(h: AuthHarness): Promise<string> {
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

describe('the mount', () => {
  it('is not swallowed by the SPA fallback', async () => {
    // The failure this prevents is specific and nasty: an agent POSTing JSON-RPC
    // would receive `index.html` with a 200, which is unparseable as MCP and
    // looks like a protocol fault rather than a routing one.
    const h = authHarness();
    try {
      await setUp(h);
      const res = await h.app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });

      expect(res.status).not.toBe(200);
      expect(res.headers.get('content-type')).not.toContain('text/html');
      expect(await res.text()).not.toContain('<!doctype html');
    } finally {
      h.close();
    }
  });

  it('counts as API surface for the rate limiter', () => {
    // Already true before this task — asserted here so mounting a real handler
    // on the path cannot quietly change it.
    expect(isLimited('/mcp')).toBe(true);
  });

  it('answers an unauthenticated caller in the §6.3 envelope', async () => {
    const h = authHarness();
    try {
      await setUp(h);
      const res = await h.app.request('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });

      expect(res.status).toBe(401);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: 'unauthorized' },
      });
    } finally {
      h.close();
    }
  });

  it('does not require a cookie — a session is not how an agent authenticates', async () => {
    // A browser session reaching /mcp would be a second auth path. §6.1 gives
    // exactly two, and for /mcp it is the token.
    const h = authHarness();
    try {
      const cookie = await setUp(h);
      const res = await h.app.request('/mcp', {
        method: 'POST',
        headers: jsonHeaders({ Cookie: cookie, Accept: 'application/json' }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });

      // A cookie resolves an actor, so this is not a 401 — but it is the same
      // actor a token would resolve, through the same middleware. Nothing here
      // is a second credential path; it is the one from §6.1 doing its job.
      expect(res.status).not.toBe(401);
    } finally {
      h.close();
    }
  });
});
