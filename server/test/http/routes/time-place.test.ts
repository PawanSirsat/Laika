import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Where the person is (D-106, LAI-895): `place` on `PUT /me/time-settings`,
 * beside the drafting switch — either field or both, the other left as it
 * was; read back by `GET /me/time-settings`; a zone-shaped id or null.
 */

const PASSWORD = 'correct horse battery staple';

let h: AuthHarness;
let cookie: string;

async function req(path: string, init: RequestInit = {}, auth = cookie): Promise<Response> {
  return h.app.request(`/api/v1${path}`, {
    ...init,
    headers: jsonHeaders({ Cookie: auth, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function ok(path: string, init: RequestInit, status: number): Promise<Response> {
  const res = await req(path, init);
  expect(res.status, `${init.method ?? 'GET'} ${path}: ${await res.clone().text()}`).toBe(status);
  return res;
}

const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });

interface Settings {
  draft_my_time: boolean;
  place: string | null;
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

describe('PUT /me/time-settings { place }', () => {
  it('is null until set, and the view answers what was set', async () => {
    const before = (await (await ok('/me/time-settings', {}, 200)).json()) as Settings;
    expect(before.place).toBeNull();

    const set = (await (
      await ok('/me/time-settings', put({ place: 'Asia/Kolkata' }), 200)
    ).json()) as Settings;
    expect(set.place).toBe('Asia/Kolkata');
    expect(set.draft_my_time).toBe(false);

    const read = (await (await ok('/me/time-settings', {}, 200)).json()) as Settings;
    expect(read.place).toBe('Asia/Kolkata');
  });

  it('leaves the other setting as it was, whichever is sent', async () => {
    await ok('/org/time', put({ mode: 'drafts' }), 200);
    await ok('/me/time-settings', put({ draft_my_time: true }), 200);
    const placed = (await (
      await ok('/me/time-settings', put({ place: 'Africa/Johannesburg' }), 200)
    ).json()) as Settings;
    expect(placed).toMatchObject({ draft_my_time: true, place: 'Africa/Johannesburg' });

    const switched = (await (
      await ok('/me/time-settings', put({ draft_my_time: false }), 200)
    ).json()) as Settings;
    expect(switched).toMatchObject({ draft_my_time: false, place: 'Africa/Johannesburg' });

    const both = (await (
      await ok('/me/time-settings', put({ draft_my_time: true, place: null }), 200)
    ).json()) as Settings;
    expect(both).toMatchObject({ draft_my_time: true, place: null });
  });

  it('refuses a place that is not a zone id, and an empty body', async () => {
    for (const body of [
      { place: 'New Delhi' },
      { place: '' },
      { place: 'Asia/Kolkata/Delhi/Extra' },
      { place: 'x'.repeat(65) },
      {},
    ]) {
      const res = await req('/me/time-settings', put(body));
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    const read = (await (await ok('/me/time-settings', {}, 200)).json()) as Settings;
    expect(read.place).toBeNull();
  });
});
