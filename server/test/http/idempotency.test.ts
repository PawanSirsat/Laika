import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hashRequest,
  IDEMPOTENCY_TTL_MS,
  lookup,
  pruneExpired,
  remember,
} from '../../src/http/idempotency.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  signIn,
  signUp,
} from '../helpers/auth.ts';

const PASSWORD = 'correct-horse-battery-staple';

describe('idempotency store (SPEC §6.3)', () => {
  let h: AuthHarness;

  beforeEach(() => {
    h = authHarness();
  });
  afterEach(() => {
    h.close();
  });

  const fingerprint = hashRequest('POST', '/api/v1/tasks', '{"title":"a"}');

  it('reports an unseen key as fresh', () => {
    expect(lookup(h.db, 'user-1', 'key-1', fingerprint, 1_000).kind).toBe('fresh');
  });

  it('replays the stored response for the same actor, key and body', () => {
    remember(h.db, 'user-1', 'key-1', fingerprint, { status: 201, body: '{"id":"t1"}' }, 1_000);

    const found = lookup(h.db, 'user-1', 'key-1', fingerprint, 2_000);

    expect(found.kind).toBe('replay');
    expect(found.response).toEqual({ status: 201, body: '{"id":"t1"}' });
  });

  it('reports conflict when the same key carries a different body', () => {
    remember(h.db, 'user-1', 'key-1', fingerprint, { status: 201, body: '{}' }, 1_000);

    const other = hashRequest('POST', '/api/v1/tasks', '{"title":"something else"}');
    expect(lookup(h.db, 'user-1', 'key-1', other, 2_000).kind).toBe('conflict');
  });

  it('scopes keys per actor, so one caller cannot replay another response', () => {
    remember(
      h.db,
      'user-1',
      'shared-key',
      fingerprint,
      { status: 201, body: '{"secret":1}' },
      1_000,
    );

    expect(lookup(h.db, 'user-2', 'shared-key', fingerprint, 2_000).kind).toBe('fresh');
  });

  it('treats an entry past its 24h TTL as unseen', () => {
    remember(h.db, 'user-1', 'key-1', fingerprint, { status: 201, body: '{}' }, 1_000);

    expect(lookup(h.db, 'user-1', 'key-1', fingerprint, 1_000 + IDEMPOTENCY_TTL_MS).kind).toBe(
      'fresh',
    );
  });

  it('prunes expired rows without touching live ones', () => {
    remember(h.db, 'u', 'old', fingerprint, { status: 200, body: '{}' }, 1_000);
    remember(h.db, 'u', 'new', fingerprint, { status: 200, body: '{}' }, 1_000_000);

    pruneExpired(h.db, 1_000 + IDEMPOTENCY_TTL_MS + 1);

    expect(lookup(h.db, 'u', 'old', fingerprint, 1_000_001).kind).toBe('fresh');
    expect(lookup(h.db, 'u', 'new', fingerprint, 1_000_001).kind).toBe('replay');
  });

  it('fingerprints method, path and body together', () => {
    const a = hashRequest('POST', '/a', '{}');
    expect(hashRequest('POST', '/b', '{}')).not.toBe(a);
    expect(hashRequest('PATCH', '/a', '{}')).not.toBe(a);
    expect(hashRequest('POST', '/a', '{"x":1}')).not.toBe(a);
    expect(hashRequest('POST', '/a', '{}')).toBe(a);
  });
});

describe('Idempotency-Key over HTTP', () => {
  let h: AuthHarness;
  let cookie: string;
  let calls: number;

  beforeEach(async () => {
    h = authHarness();
    calls = 0;

    // A route that records how many times it actually ran, so a replay is
    // distinguishable from a second execution that happened to match.
    const echo = new Hono();
    echo.post('/', async (c) => {
      calls++;
      // Hono's generic gives a typed body without an assertion eslint rejects.
      const body = await c.req.json<{ title?: string }>();
      return c.json({ created: body.title ?? null, call: calls }, 201);
    });
    h.app.route('/api/v1/things', echo);

    await signUp(h.app, { email: 'ada@example.test', password: PASSWORD });
    cookie = cookieFrom(await signIn(h.app, 'ada@example.test', PASSWORD));
  });
  afterEach(() => {
    h.close();
  });

  async function post(key: string | undefined, body: unknown): Promise<Response> {
    return h.app.request('/api/v1/things', {
      method: 'POST',
      headers: jsonHeaders({
        Cookie: cookie,
        ...(key === undefined ? {} : { 'Idempotency-Key': key }),
      }),
      body: JSON.stringify(body),
    });
  }

  it('runs the handler once and replays the stored response', async () => {
    const first = await post('k1', { title: 'Ship it' });
    const second = await post('k1', { title: 'Ship it' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.text()).toBe(await first.clone().text());
    expect(second.headers.get('Idempotent-Replay')).toBe('true');

    // The whole point: the second request did not create a second thing.
    expect(calls).toBe(1);
  });

  it('returns conflict when the key is reused with a different body', async () => {
    await post('k1', { title: 'Ship it' });
    const clash = await post('k1', { title: 'Something else' });

    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { code: string } }).error.code).toBe('conflict');
    expect(calls).toBe(1);
  });

  it('does nothing when no key is supplied', async () => {
    await post(undefined, { title: 'a' });
    await post(undefined, { title: 'a' });

    expect(calls).toBe(2);
  });

  it('treats different keys as different requests', async () => {
    await post('k1', { title: 'a' });
    await post('k2', { title: 'a' });

    expect(calls).toBe(2);
  });
});
