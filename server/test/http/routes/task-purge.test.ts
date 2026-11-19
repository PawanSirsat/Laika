import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Delete now over HTTP (§6.4, LAI-1355): `POST /tasks/:id/purge` on a task in
 * Trash, and the task `404` to everyone under all of `/tasks/:id` from then
 * on. The rules are the service's (`test/services/task-purge.test.ts`); this
 * is the transport.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let token: string;

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

async function newTask(title: string): Promise<{ id: string }> {
  const res = await must(
    req('/api/v1/projects/laika/tasks', { method: 'POST', body: JSON.stringify({ title }) }),
    201,
  );
  return (await res.json()) as { id: string };
}

const purge = (id: string, auth = cookie) =>
  req(`/api/v1/tasks/${id}/purge`, { method: 'POST' }, auth);

async function refused(res: Promise<Response>, status: number): Promise<unknown> {
  const answered = await must(res, status);
  const body = (await answered.json()) as {
    error: { code: string; details?: { reason?: string } };
  };
  return { code: body.error.code, reason: body.error.details?.reason };
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
  const minted = await must(
    req('/api/v1/tokens', { method: 'POST', body: JSON.stringify({ name: 'CLI', scope: 'full' }) }),
    201,
  );
  token = ((await minted.json()) as { secret: string }).secret;
});

afterEach(() => {
  h.close();
});

describe('POST /api/v1/tasks/:id/purge', () => {
  it('scrubs a task in Trash, and from then on it is 404 to a person everywhere', async () => {
    const task = await newTask('Payroll');
    await must(
      req(`/api/v1/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body_md: 'The sheet' }),
      }),
      201,
    );
    await must(req(`/api/v1/tasks/${task.id}`, { method: 'DELETE' }));

    const res = await must(purge(task.id));
    expect(await res.json()).toEqual({ purged: [task.id] });

    for (const path of ['', '/comments', '/restore']) {
      const method = path === '/restore' ? 'POST' : 'GET';
      expect(await refused(req(`/api/v1/tasks/${task.id}${path}`, { method }), 404)).toEqual({
        code: 'not_found',
        reason: undefined,
      });
    }
    const trash = await must(req('/api/v1/projects/laika/tasks?trash=only'));
    expect(((await trash.json()) as { data: unknown[] }).data).toEqual([]);
    expect(await refused(purge(task.id), 404)).toEqual({ code: 'not_found', reason: undefined });
  });

  it('refuses a live task 409 not_in_trash, and a token 403, then 404 once in Trash', async () => {
    const task = await newTask('Live');
    expect(await refused(purge(task.id), 409)).toEqual({
      code: 'conflict',
      reason: 'not_in_trash',
    });
    expect(await refused(purge(task.id, token), 403)).toEqual({
      code: 'forbidden',
      reason: 'session_required',
    });
    await must(req(`/api/v1/tasks/${task.id}`, { method: 'DELETE' }));
    expect(await refused(purge(task.id, token), 404)).toEqual({
      code: 'not_found',
      reason: undefined,
    });
    // Still there for the person to restore: the token changed nothing.
    await must(req(`/api/v1/tasks/${task.id}/restore`, { method: 'POST' }));
  });
});
