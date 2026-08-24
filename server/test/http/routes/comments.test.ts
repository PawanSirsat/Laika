import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

let h: AuthHarness;
let cookie: string;
let taskId: string;

const PASSWORD = 'correct-horse-battery-staple';

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function addComment(body = 'Looks good'): Promise<{ id: string; edited_at: number | null }> {
  const res = await req(`/api/v1/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body_md: body }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; edited_at: number | null };
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
  cookie = cookieFrom(setup);

  const task = await req('/api/v1/projects/laika/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Do the thing' }),
  });
  taskId = ((await task.json()) as { id: string }).id;
});
afterEach(() => {
  h.close();
});

describe('POST and GET comments (AC1, AC2)', () => {
  it('creates and lists oldest first', async () => {
    const first = await addComment('first');
    const second = await addComment('second');

    const res = await req(`/api/v1/tasks/${taskId}/comments`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { id: string }[]; next_cursor: string | null };
    expect(body.data.map((c) => c.id)).toEqual([first.id, second.id]);
    expect(body).toHaveProperty('next_cursor');
  });

  it('paginates', async () => {
    for (let i = 0; i < 4; i++) await addComment(`c${String(i)}`);

    const first = (await (await req(`/api/v1/tasks/${taskId}/comments?limit=2`)).json()) as {
      data: { id: string }[];
      next_cursor: string;
    };
    expect(first.data).toHaveLength(2);

    const second = (await (
      await req(
        `/api/v1/tasks/${taskId}/comments?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`,
      )
    ).json()) as { data: { id: string }[] };

    const ids = [...first.data, ...second.data].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records created_via as web for a cookie session', async () => {
    const res = await req(`/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body_md: 'hello' }),
    });

    expect(((await res.json()) as { created_via: string }).created_via).toBe('web');
  });

  it('rejects an empty body and unknown fields', async () => {
    const empty = await req(`/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body_md: '   ' }),
    });
    expect(empty.status).toBe(422);

    const extra = await req(`/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body_md: 'x', author_id: 'someone-else' }),
    });
    expect(extra.status).toBe(422);
  });

  it('401s an anonymous caller', async () => {
    expect((await h.app.request(`/api/v1/tasks/${taskId}/comments`)).status).toBe(401);
  });
});

describe('PATCH and DELETE (AC3, AC4)', () => {
  it('edits and marks edited_at', async () => {
    const comment = await addComment('before');
    expect(comment.edited_at).toBeNull();

    const res = await req(`/api/v1/comments/${comment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body_md: 'after' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { body_md: string; edited_at: number };
    expect(body.body_md).toBe('after');
    expect(body.edited_at).not.toBeNull();
  });

  it('soft-deletes with 204 and hides it from a plain read', async () => {
    const comment = await addComment('gone');

    const res = await req(`/api/v1/comments/${comment.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const list = (await (await req(`/api/v1/tasks/${taskId}/comments`)).json()) as {
      data: unknown[];
    };
    expect(list.data).toEqual([]);
  });

  it('returns it as a tombstone to a client catching up', async () => {
    const comment = await addComment('gone');
    await req(`/api/v1/comments/${comment.id}`, { method: 'DELETE' });

    const list = (await (await req(`/api/v1/tasks/${taskId}/comments?updated_since=0`)).json()) as {
      data: { id: string; deleted?: boolean }[];
    };

    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ id: comment.id, deleted: true });
  });

  it('404s a comment that does not exist', async () => {
    const res = await req('/api/v1/comments/01ARZ3NDEKTSV4RRFFQ69G5FAV', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('conflicts on a second delete', async () => {
    const comment = await addComment('gone');
    await req(`/api/v1/comments/${comment.id}`, { method: 'DELETE' });

    const again = await req(`/api/v1/comments/${comment.id}`, { method: 'DELETE' });
    expect(again.status).toBe(409);
  });
});
