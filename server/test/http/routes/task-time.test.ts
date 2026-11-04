import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * `GET /api/v1/tasks/:id/time` over HTTP (§6.4, LAI-1122): the confirmed time
 * on a task, totals only. The rules are the service's
 * (`test/services/task-time.test.ts`); this is the transport — the shape, the
 * status codes, and that a time entry confirmed through the API is what it
 * counts.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let taskId: string;
let readOnly: string;

async function req(path: string, init: RequestInit = {}, auth = cookie): Promise<Response> {
  const credential = auth.startsWith('lai_')
    ? { Authorization: `Bearer ${auth}` }
    : { Cookie: auth };
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function must(res: Promise<Response>, expected = 200): Promise<Response> {
  const answered = await res;
  expect(answered.status, await answered.clone().text()).toBe(expected);
  return answered;
}

beforeEach(async () => {
  h = authHarness();
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
  const task = await must(
    req('/api/v1/projects/laika/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Time' }),
    }),
    201,
  );
  taskId = ((await task.json()) as { id: string }).id;
  const minted = await must(
    req('/api/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Reader', scope: 'read_only' }),
    }),
    201,
  );
  readOnly = ((await minted.json()) as { secret: string }).secret;
});

afterEach(() => {
  h.close();
});

describe('GET /api/v1/tasks/:id/time', () => {
  it('answers zeros for a task with no time', async () => {
    const res = await must(req(`/api/v1/tasks/${taskId}/time`));
    expect(await res.json()).toEqual({ total_minutes: 0, people: 0, entries: 0 });
  });

  it('counts the time a person confirmed on the task, and a read-only token reads the totals', async () => {
    await must(
      req('/api/v1/org/time', { method: 'PUT', body: JSON.stringify({ mode: 'drafts' }) }),
    );
    const day = new Date().toISOString().slice(0, 10);
    for (const minutes of [50, 80]) {
      await must(
        req('/api/v1/me/time-entries', {
          method: 'POST',
          body: JSON.stringify({ day, tz: 'UTC', minutes, task: 'LAI-1' }),
        }),
        201,
      );
    }
    const expected = { total_minutes: 130, people: 1, entries: 2 };
    expect(await (await must(req(`/api/v1/tasks/${taskId}/time`))).json()).toEqual(expected);
    expect(await (await must(req(`/api/v1/tasks/${taskId}/time`, {}, readOnly))).json()).toEqual(
      expected,
    );
  });

  it('is 404 not_found for a task that does not exist', async () => {
    const res = await req('/api/v1/tasks/no-such-task/time');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('is 401 for a caller who is not signed in', async () => {
    const res = await h.app.request(`/api/v1/tasks/${taskId}/time`, { headers: jsonHeaders() });
    expect(res.status).toBe(401);
  });
});
