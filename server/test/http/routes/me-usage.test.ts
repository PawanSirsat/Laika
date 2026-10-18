import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * A person's own token alerts and plan limit over HTTP (LAI-773, D-087):
 * session only, the caller's own, and no path that could name anybody else.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;

async function req(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  const credential =
    auth === undefined
      ? {}
      : auth.startsWith('lai_')
        ? { Authorization: `Bearer ${auth}` }
        : { Cookie: auth };
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function mint(): Promise<string> {
  const res = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Agent', scope: 'full' }) },
    cookie,
  );
  expect(res.status).toBe(201);
  return String(((await res.json()) as { secret: string }).secret);
}

beforeEach(async () => {
  h = authHarness({ rateLimiter: new RateLimiter() });
  const setup = await h.app.request('/api/v1/setup', {
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
  expect(setup.status, await setup.clone().text()).toBe(201);
  cookie = cookieFrom(setup);
});

afterEach(() => {
  h.close();
});

describe('GET /me/token-alerts', () => {
  it('answers the caller’s own on a session, and refuses every token', async () => {
    const res = await req('/api/v1/me/token-alerts', {}, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alerts: [] });
    const token = await req('/api/v1/me/token-alerts', {}, await mint());
    expect(token.status).toBe(403);
    expect(
      ((await token.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('session_required');
  });

  it('answers 404 dismissing an alert that is not the caller’s', async () => {
    const res = await req('/api/v1/me/token-alerts/01ABC/dismiss', { method: 'POST' }, cookie);
    expect(res.status).toBe(404);
  });
});

describe('/me/plan-limit', () => {
  it('sets, reads and clears the caller’s own, labelled an estimate', async () => {
    const empty = await req('/api/v1/me/plan-limit', {}, cookie);
    expect(await empty.json()).toMatchObject({ plan: null, estimate: true });

    const set = await req(
      '/api/v1/me/plan-limit',
      {
        method: 'PUT',
        body: JSON.stringify({
          plan: 'claude-max-5x',
          window: '5h',
          limit_tokens: 2_000_000,
          tz: 'UTC',
        }),
      },
      cookie,
    );
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await set.json()).toMatchObject({
      plan: 'claude-max-5x',
      limit_tokens: 2_000_000,
      used: 0,
    });

    const weekly = await req(
      '/api/v1/me/plan-limit',
      {
        method: 'PUT',
        body: JSON.stringify({
          plan: 'claude-max-20x',
          window: 'week',
          limit_tokens: 9,
          tz: 'Africa/Johannesburg',
          week_reset: { weekday: 1, minute: 540 },
        }),
      },
      cookie,
    );
    expect(await weekly.json()).toMatchObject({
      window: 'week',
      week_reset: { weekday: 1, minute: 540 },
    });

    expect((await req('/api/v1/me/plan-limit', { method: 'DELETE' }, cookie)).status).toBe(204);
    expect(await (await req('/api/v1/me/plan-limit', {}, cookie)).json()).toMatchObject({
      plan: null,
    });
  });

  it('refuses a token, an unknown plan, and a field it does not know', async () => {
    expect((await req('/api/v1/me/plan-limit', {}, await mint())).status).toBe(403);
    for (const body of [
      { plan: 'claude-unlimited', window: '5h', limit_tokens: 5, tz: 'UTC' },
      { plan: 'other', window: '5h', limit_tokens: 5, tz: 'UTC', user_id: 'someone' },
    ]) {
      const res = await req(
        '/api/v1/me/plan-limit',
        { method: 'PUT', body: JSON.stringify(body) },
        cookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});
