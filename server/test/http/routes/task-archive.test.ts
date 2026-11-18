import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Archiving over HTTP (§6.4, LAI-1353): `PATCH /tasks/:id { archived }`, the
 * lists' `?archived=only`, and an archived task as a §6.3 tombstone to a
 * catching-up read. The rules are the service's
 * (`test/services/task-archive.test.ts`); this is the transport.
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

const archive = (id: string, archived: boolean, auth = cookie) =>
  req(`/api/v1/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ archived }) }, auth);

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

describe('PATCH /api/v1/tasks/:id { archived }', () => {
  it('archives and restores, with an ETag, on a signed-in session', async () => {
    const task = await newTask('Put away');

    const res = await must(archive(task.id, true));
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}"$/);
    const body = (await res.json()) as { archived_at: number | null; archived_by: string | null };
    expect(body.archived_at).toEqual(expect.any(Number));
    expect(body.archived_by).toEqual(expect.any(String));

    const back = (await (await must(archive(task.id, false))).json()) as { archived_at: unknown };
    expect(back.archived_at).toBeNull();
  });

  it('is refused to a token, full scope included', async () => {
    const task = await newTask('Not theirs to put away');
    const res = await must(archive(task.id, true, token), 403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('travels alone: with another field it is 422 archived_alone, and nothing changes', async () => {
    const task = await newTask('Alone');
    const res = await must(
      req(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true, title: 'Renamed' }),
      }),
      422,
    );
    expect(
      ((await res.json()) as { error: { details: { reason: string } } }).error.details,
    ).toEqual(expect.objectContaining({ field: 'archived', reason: 'archived_alone' }));
    const read = (await (await must(req(`/api/v1/tasks/${task.id}`))).json()) as {
      title: string;
      archived_at: unknown;
    };
    expect(read).toMatchObject({ title: 'Alone', archived_at: null });
  });

  it('makes the task read-only: an edit is 409 archived', async () => {
    const task = await newTask('Read-only');
    await must(archive(task.id, true));
    const res = await must(
      req(`/api/v1/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'No' }) }),
      409,
    );
    expect(
      ((await res.json()) as { error: { details: { reason: string } } }).error.details,
    ).toEqual({ reason: 'archived' });
  });
});

describe('the lists', () => {
  it('leave an archived task out, list it under ?archived=only, and tombstone it to a catch-up', async () => {
    const kept = await newTask('Kept');
    const put = await newTask('Put away');
    const before = Date.now();
    await must(archive(put.id, true));

    const ids = (rows: unknown[]) => rows.map((r) => (r as { id: string }).id);
    expect(ids(await listed('/api/v1/projects/laika/tasks'))).toEqual([kept.id]);
    expect(ids(await listed('/api/v1/tasks?fields=slim'))).toEqual([kept.id]);

    expect(ids(await listed('/api/v1/projects/laika/tasks?archived=only&fields=slim'))).toEqual([
      put.id,
    ]);
    expect(ids(await listed('/api/v1/tasks?archived=only'))).toEqual([put.id]);

    // A client that reads only changes learns the task left.
    expect(await listed(`/api/v1/projects/laika/tasks?updated_since=${String(before)}`)).toEqual([
      { id: put.id, deleted: true },
    ]);
    expect(await listed(`/api/v1/tasks?updated_since=${String(before)}&fields=slim`)).toEqual([
      { id: put.id, deleted: true },
    ]);

    const summary = (await (await must(req('/api/v1/tasks/summary?archived=only'))).json()) as {
      total: number;
    };
    expect(summary.total).toBe(1);
  });

  it('refuses an archived filter it does not know, 400', async () => {
    await must(req('/api/v1/projects/laika/tasks?archived=include'), 400);
    await must(req('/api/v1/tasks?archived=yes'), 400);
  });
});
