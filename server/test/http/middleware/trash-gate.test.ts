import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * `trashGate` (LAI-1354 review): under `/api/v1/tasks/:id`, a task in Trash
 * is `404` to a token whichever route it asks — its comments, files, rounds,
 * checkpoints, offers, watchers, estimate, time and usage, read or written —
 * while a person keeps reading it and a live task is untouched.
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

async function newTask(title: string): Promise<{ id: string; updated_at: number }> {
  const res = await must(
    req('/api/v1/projects/laika/tasks', { method: 'POST', body: JSON.stringify({ title }) }),
    201,
  );
  return (await res.json()) as { id: string; updated_at: number };
}

const remove = (id: string, auth = cookie) =>
  req(`/api/v1/tasks/${id}`, { method: 'DELETE' }, auth);
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

const UNDER_THE_TASK = [
  'comments',
  'attachments',
  'rounds',
  'checkpoints',
  'handoff-offers',
  'watchers',
  'estimate',
  'similar',
  'time',
  'usage',
] as const;

describe('trashGate', () => {
  it('answers a token 404 under every /tasks/:id route of a task in Trash', async () => {
    const gone = await newTask('Gone');
    await must(remove(gone.id));

    for (const sub of UNDER_THE_TASK) {
      const res = await req(`/api/v1/tasks/${gone.id}/${sub}`, {}, token);
      expect(res.status, `GET …/${sub}: ${await res.clone().text()}`).toBe(404);
    }
    const posted = await req(
      `/api/v1/tasks/${gone.id}/comments`,
      { method: 'POST', body: JSON.stringify({ body_md: 'Hello' }) },
      token,
    );
    expect(posted.status).toBe(404);
    // The same 404 a missing id gets, word for word but the id.
    const missing = await req('/api/v1/tasks/01JNOSUCHTASKXXXXXXXXXXXXX', {}, token);
    expect(missing.status).toBe(404);
  });

  it('lets a person read a task in Trash, and a token read a live one', async () => {
    const gone = await newTask('Gone');
    const live = await newTask('Live');
    await must(remove(gone.id));

    await must(req(`/api/v1/tasks/${gone.id}/comments`));
    await must(req(`/api/v1/tasks/${live.id}/comments`, {}, token));
    await must(req(`/api/v1/tasks/${live.id}`, {}, token));
    // `summary` sits under /tasks/:id's shape and names no task.
    await must(req('/api/v1/tasks/summary', {}, token));
  });
});
