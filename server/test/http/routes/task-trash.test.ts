import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Trash over HTTP (§6.4, LAI-1354): `DELETE /tasks/:id`, `POST
 * /tasks/:id/restore`, `?trash=only`, a deleted task as a §6.3 tombstone, and
 * a token answered `404` for it. The rules are the service's
 * (`test/services/task-trash.test.ts`); this is the transport.
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
const restore = (id: string, auth = cookie) =>
  req(`/api/v1/tasks/${id}/restore`, { method: 'POST' }, auth);

async function listed(path: string): Promise<unknown[]> {
  const res = await must(req(path));
  return ((await res.json()) as { data: unknown[] }).data;
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

describe('DELETE /api/v1/tasks/:id and POST /api/v1/tasks/:id/restore', () => {
  it('move a task into Trash and back, answering the task with its ETag', async () => {
    const task = await newTask('Deleted');

    const res = await must(remove(task.id));
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}"$/);
    const body = (await res.json()) as { deleted_at: number | null; deleted_by: string | null };
    expect(body.deleted_at).toEqual(expect.any(Number));
    expect(body.deleted_by).toEqual(expect.any(String));
    // A person still reads it, for its banner.
    await must(req(`/api/v1/tasks/${task.id}`));

    const back = (await (await must(restore(task.id))).json()) as { deleted_at: unknown };
    expect(back.deleted_at).toBeNull();
  });

  it('are refused to a token; a deleted task is 404 to it, read or written', async () => {
    const live = await newTask('Live');
    const gone = await newTask('Gone');
    await must(remove(gone.id));

    const refused = await must(remove(live.id, token), 403);
    expect(
      ((await refused.json()) as { error: { details: { reason: string } } }).error.details,
    ).toEqual({ reason: 'session_required' });
    await must(restore(gone.id, token), 404);
    await must(req(`/api/v1/tasks/${gone.id}`, {}, token), 404);
    await must(
      req(
        `/api/v1/tasks/${gone.id}`,
        { method: 'PATCH', body: JSON.stringify({ title: 'X' }) },
        token,
      ),
      404,
    );
    await must(req('/api/v1/projects/laika/tasks?trash=only', {}, token), 403);
  });

  it('leave the task read-only to a person: an edit is 409 deleted', async () => {
    const gone = await newTask('Gone');
    await must(remove(gone.id));
    const res = await must(
      req(`/api/v1/tasks/${gone.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'No' }) }),
      409,
    );
    expect(
      ((await res.json()) as { error: { details: { reason: string } } }).error.details,
    ).toEqual({ reason: 'deleted' });
  });
});

describe('the lists', () => {
  it('leave a deleted task out, list it under ?trash=only, and tombstone it to a catch-up', async () => {
    const kept = await newTask('Kept');
    const gone = await newTask('Gone');
    const before = Date.now();
    await must(remove(gone.id));

    const ids = (rows: unknown[]) => rows.map((r) => (r as { id: string }).id);
    expect(ids(await listed('/api/v1/projects/laika/tasks'))).toEqual([kept.id]);
    expect(ids(await listed('/api/v1/tasks?fields=slim'))).toEqual([kept.id]);
    expect(ids(await listed('/api/v1/projects/laika/tasks?trash=only&fields=slim'))).toEqual([
      gone.id,
    ]);
    expect(ids(await listed('/api/v1/projects/laika/tasks?archived=only'))).toEqual([]);
    expect(await listed(`/api/v1/projects/laika/tasks?updated_since=${String(before)}`)).toEqual([
      { id: gone.id, deleted: true },
    ]);
  });

  it('take one shelf at a time, and only a value they know', async () => {
    await must(req('/api/v1/projects/laika/tasks?trash=only&archived=only'), 400);
    await must(req('/api/v1/projects/laika/tasks?trash=all'), 400);
  });
});
