/**
 * The API client (LAI-007).
 *
 * Real unit tests with a stubbed `fetch` — the client is the one piece of this
 * task with branching logic worth testing directly, and stubbing the transport
 * is what makes the error paths reachable at all. The `401` handler in
 * particular cannot be exercised through the UI yet: `/me` on mount is the only
 * call the app makes, and the interesting case is a 401 from some *other*
 * request, which arrives with the Phase 2 screens.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { API_BASE, request, setUnauthorizedHandler } from '../src/api/client.ts';
import { ApiError, NetworkError, toApiError } from '../src/api/errors.ts';

interface FetchArgs {
  url: string;
  init: RequestInit;
}

function stubFetch(handler: (args: FetchArgs) => Response | Promise<Response>): FetchArgs[] {
  const calls: FetchArgs[] = [];
  globalThis.fetch = ((input: string | URL, init: RequestInit = {}) => {
    const args = { url: input instanceof URL ? input.href : input, init };
    calls.push(args);
    return Promise.resolve(handler(args));
  }) as unknown as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  setUnauthorizedHandler(undefined);
});

void describe('request — the happy path', () => {
  void test('hits the versioned base and returns parsed JSON', async () => {
    const calls = stubFetch(() => json({ id: 'u1' }));
    const body = await request<{ id: string }>('/me');

    assert.equal(body.id, 'u1');
    assert.equal(calls[0]?.url, `${API_BASE}/me`);
  });

  void test('always sends the session cookie', async () => {
    // The cookie is httpOnly, so this is the only way the session travels.
    const calls = stubFetch(() => json({}));
    await request('/me');
    assert.equal(calls[0]?.init.credentials, 'include');
  });

  void test('a bodyless request sends no content-type', async () => {
    const calls = stubFetch(() => json({}));
    await request('/me');
    assert.equal(calls[0]?.init.headers, undefined);
    assert.equal(calls[0]?.init.body, undefined);
  });

  void test('a request with a body sends JSON and its content-type', async () => {
    // Regression guard: better-auth answers 415 to a POST with no content-type,
    // which made sign-out silently fail while the UI looked signed out.
    const calls = stubFetch(() => json({}));
    await request('/auth/sign-out', { method: 'POST', body: {} });

    const init = calls[0]?.init;
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, '{}');
    assert.deepEqual(init?.headers, { 'content-type': 'application/json' });
  });

  void test('204 resolves without parsing', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    assert.equal(await request('/tokens/abc', { method: 'DELETE' }), undefined);
  });
});

void describe('request — errors become ApiError', () => {
  void test('the §6.3 envelope is parsed into code, message and details', async () => {
    stubFetch(() =>
      json(
        { error: { code: 'forbidden', message: 'Not your project.', details: { need: 'lead' } } },
        403,
      ),
    );

    await assert.rejects(request('/projects/x'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'forbidden');
      assert.equal(error.status, 403);
      assert.equal(error.message, 'Not your project.');
      assert.deepEqual(error.details, { need: 'lead' });
      return true;
    });
  });

  void test('request_id is surfaced on 5xx so a user can quote it', async () => {
    stubFetch(() =>
      json({ error: { code: 'internal', message: 'Boom', details: null } }, 500, {
        'X-Request-Id': 'req-123',
      }),
    );

    await assert.rejects(request('/me'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.requestId, 'req-123');
      return true;
    });
  });

  void test('an unknown code falls back rather than throwing while throwing', async () => {
    stubFetch(() => json({ error: { code: 'teapot', message: 'no' } }, 418));
    await assert.rejects(request('/x'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'internal');
      assert.equal(error.status, 418);
      return true;
    });
  });

  void test('a non-JSON error body still produces an ApiError', async () => {
    stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    await assert.rejects(request('/x'), (error: unknown) => error instanceof ApiError);
  });

  void test('retryable is true only where retrying could help', () => {
    assert.equal(toApiError(500, { error: { code: 'internal' } }).retryable, true);
    assert.equal(toApiError(429, { error: { code: 'rate_limited' } }).retryable, true);
    assert.equal(toApiError(403, { error: { code: 'forbidden' } }).retryable, false);
    assert.equal(toApiError(422, { error: { code: 'unprocessable' } }).retryable, false);
  });
});

void describe('request — the network failing is not the server failing', () => {
  void test('a dropped connection is a NetworkError, not internal', async () => {
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    await assert.rejects(request('/me'), (error: unknown) => {
      assert.ok(error instanceof NetworkError);
      assert.ok(!(error instanceof ApiError));
      return true;
    });
  });

  void test('an abort is the caller’s own doing and passes through', async () => {
    // A screen unmounting must not be reported as the instance being down.
    globalThis.fetch = () => Promise.reject(new DOMException('Aborted', 'AbortError'));
    await assert.rejects(request('/me'), (error: unknown) => {
      assert.ok(error instanceof DOMException);
      assert.ok(!(error instanceof NetworkError));
      return true;
    });
  });
});

void describe('401 handling (AC5)', () => {
  void test('fires the handler exactly once per 401', async () => {
    let fired = 0;
    setUnauthorizedHandler(() => {
      fired += 1;
    });
    stubFetch(() => json({ error: { code: 'unauthorized', message: 'Not signed in' } }, 401));

    await assert.rejects(request('/me'));
    assert.equal(fired, 1, 'one 401 must clear the session once, not loop');
  });

  void test('does not fire for other failures', async () => {
    let fired = 0;
    setUnauthorizedHandler(() => {
      fired += 1;
    });

    stubFetch(() => json({ error: { code: 'forbidden', message: 'no' } }, 403));
    await assert.rejects(request('/x'));

    stubFetch(() => json({ error: { code: 'internal', message: 'no' } }, 500));
    await assert.rejects(request('/x'));

    assert.equal(fired, 0, 'only 401 means the session ended');
  });

  void test('still throws, so the caller can react too', async () => {
    setUnauthorizedHandler(() => undefined);
    stubFetch(() => json({ error: { code: 'unauthorized', message: 'Not signed in' } }, 401));
    await assert.rejects(request('/me'), (error: unknown) => error instanceof ApiError);
  });

  void test('an unregistered handler is not an error', async () => {
    setUnauthorizedHandler(undefined);
    stubFetch(() => json({ error: { code: 'unauthorized', message: 'x' } }, 401));
    await assert.rejects(request('/me'), (error: unknown) => error instanceof ApiError);
  });
});

void describe('403 must never render as an empty list (AC6)', () => {
  // The mapping itself is asserted structurally — @laika/web has no renderer
  // (CONVENTIONS §4) — but the branch it depends on is real logic worth pinning.
  void test('forbidden is distinguishable from every other failure', () => {
    const forbidden = toApiError(403, { error: { code: 'forbidden', message: 'no' } });
    assert.equal(forbidden.code, 'forbidden');
    assert.equal(forbidden.retryable, false, 'permission is not a transient condition');

    for (const [status, code] of [
      [404, 'not_found'],
      [409, 'conflict'],
      [422, 'unprocessable'],
      [500, 'internal'],
    ] as const) {
      assert.notEqual(
        toApiError(status, { error: { code } }).code,
        'forbidden',
        `${code} must not be mistaken for forbidden`,
      );
    }
  });
});
