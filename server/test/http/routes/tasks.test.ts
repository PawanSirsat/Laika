import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

let h: AuthHarness;
let cookie: string;

const PASSWORD = 'correct-horse-battery-staple';

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  return req(path, { method: 'POST', body: JSON.stringify(body) });
}

async function newTask(title = 'Do the thing', extra: Record<string, unknown> = {}) {
  const res = await post('/api/v1/projects/laika/tasks', { title, ...extra });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string; status: string; ready: boolean };
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
  expect(setup.status).toBe(201);
  cookie = cookieFrom(setup);
});
afterEach(() => {
  h.close();
});

describe('creating and reading tasks', () => {
  it('creates with a display key and reads back by id', async () => {
    const task = await newTask();

    expect(task.key).toBe('LAI-1');

    const read = await req(`/api/v1/tasks/${task.id}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { key: string }).key).toBe('LAI-1');
  });

  it('404s an unknown task id', async () => {
    expect((await req('/api/v1/tasks/01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404);
  });

  it('rejects unknown fields and an empty title', async () => {
    expect((await post('/api/v1/projects/laika/tasks', { title: 'x', sneaky: 1 })).status).toBe(
      422,
    );
    expect((await post('/api/v1/projects/laika/tasks', { title: '' })).status).toBe(422);
  });

  it('401s an anonymous caller', async () => {
    const res = await h.app.request('/api/v1/projects/laika/tasks');
    expect(res.status).toBe(401);
  });
});

describe('listing, filters and pagination', () => {
  it('returns the §6.3 page shape and paginates', async () => {
    for (let i = 0; i < 5; i++) await newTask(`t${String(i)}`);

    const first = (await (await req('/api/v1/projects/laika/tasks?limit=2')).json()) as {
      data: { id: string }[];
      next_cursor: string;
    };

    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();

    const second = (await (
      await req(
        `/api/v1/projects/laika/tasks?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`,
      )
    ).json()) as { data: { id: string }[] };

    const ids = [...first.data, ...second.data].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by status, priority, assignee and ready', async () => {
    await newTask('plain');
    await newTask('urgent', { priority: 'p1' });
    const me = (await (await req('/api/v1/me')).json()) as { id: string };
    await newTask('mine', { assignee_id: me.id });

    const byPriority = (await (await req('/api/v1/projects/laika/tasks?priority=p1')).json()) as {
      data: unknown[];
    };
    expect(byPriority.data).toHaveLength(1);

    const ready = (await (await req('/api/v1/projects/laika/tasks?ready=true')).json()) as {
      data: unknown[];
    };
    expect(ready.data).toHaveLength(2);

    const unassigned = (await (await req('/api/v1/projects/laika/tasks?assignee=none')).json()) as {
      data: unknown[];
    };
    expect(unassigned.data).toHaveLength(2);
  });

  it('rejects a bad filter value rather than ignoring it', async () => {
    expect((await req('/api/v1/projects/laika/tasks?status=shipped')).status).toBe(400);
    expect((await req('/api/v1/projects/laika/tasks?ready=maybe')).status).toBe(400);
  });
});

describe('claim (AC3)', () => {
  it('claims, then tells a second claimant who holds it', async () => {
    const task = await newTask();

    const first = await post(`/api/v1/tasks/${task.id}/claim`, {});
    expect(first.status).toBe(200);

    const claimed = (await first.json()) as { status: string; assignee_id: string };
    expect(claimed.status).toBe('in_progress');

    const second = await post(`/api/v1/tasks/${task.id}/claim`, {});
    expect(second.status).toBe(409);

    const body = (await second.json()) as { error: { details: { assignee_id: string } } };
    expect(body.error.details.assignee_id).toBe(claimed.assignee_id);
  });
});

describe('status transitions (AC4)', () => {
  it('walks the §5 path', async () => {
    const task = await newTask();

    for (const status of ['todo', 'in_progress', 'review', 'done'] as const) {
      const res = await post(`/api/v1/tasks/${task.id}/status`, { status });
      expect(res.status, status).toBe(200);
    }
  });

  it('refuses an illegal jump with unprocessable, listing what is allowed', async () => {
    const task = await newTask();

    const res = await post(`/api/v1/tasks/${task.id}/status`, { status: 'done' });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: { allowed: string[] } } };
    expect(body.error.details.allowed).toContain('todo');
  });

  it('refuses a status outside the enum', async () => {
    const task = await newTask();
    expect((await post(`/api/v1/tasks/${task.id}/status`, { status: 'shipped' })).status).toBe(422);
  });
});

describe('dependencies (AC5)', () => {
  it('adds, blocks readiness, and removes', async () => {
    const blocker = await newTask('blocker');
    const blocked = await newTask('blocked');

    const added = await post(`/api/v1/tasks/${blocked.id}/dependencies`, {
      depends_on_task_id: blocker.id,
    });
    expect(added.status).toBe(201);
    expect(((await added.json()) as { ready: boolean }).ready).toBe(false);

    const removed = await req(`/api/v1/tasks/${blocked.id}/dependencies/${blocker.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { ready: boolean }).ready).toBe(true);
  });

  it('rejects a cycle', async () => {
    const a = await newTask('a');
    const b = await newTask('b');

    await post(`/api/v1/tasks/${a.id}/dependencies`, { depends_on_task_id: b.id });
    const cycle = await post(`/api/v1/tasks/${b.id}/dependencies`, { depends_on_task_id: a.id });

    expect(cycle.status).toBe(422);
  });
});

describe('patch', () => {
  it('edits fields and unassigns with an explicit null', async () => {
    const me = (await (await req('/api/v1/me')).json()) as { id: string };
    const task = await newTask('x', { assignee_id: me.id });

    const patched = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed', assignee_id: null }),
    });

    expect(patched.status).toBe(200);
    const body = (await patched.json()) as { title: string; assignee_id: string | null };
    expect(body.title).toBe('Renamed');
    expect(body.assignee_id).toBeNull();
  });
});

/**
 * LAI-092 over HTTP — the boundary rules, which are the route's to enforce.
 */
describe('acceptance criteria on the wire', () => {
  it('accepts it on create and returns it', async () => {
    const res = await post('/api/v1/projects/laika/tasks', {
      title: 'With acceptance',
      acceptance_md: 'Second claim returns 409.',
    });

    expect(res.status).toBe(201);
    expect(((await res.json()) as { acceptance_md: string }).acceptance_md).toBe(
      'Second claim returns 409.',
    );
  });

  it('defaults to null rather than an empty string', () => {
    return newTask('Quiet').then(async (created) => {
      const fetched = (await (await req(`/api/v1/tasks/${created.id}`)).json()) as {
        acceptance_md: string | null;
      };
      expect(fetched.acceptance_md).toBeNull();
    });
  });

  it('accepts null on update to clear it, which is not the same as omitting it', async () => {
    const created = await newTask('Clearable', { acceptance_md: 'set' });

    const cleared = await req(`/api/v1/tasks/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ acceptance_md: null }),
    });

    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { acceptance_md: string | null }).acceptance_md).toBeNull();
  });

  it('refuses an acceptance longer than the limit', async () => {
    const res = await post('/api/v1/projects/laika/tasks', {
      title: 'Too long',
      acceptance_md: 'x'.repeat(10_001),
    });

    expect(res.status).toBe(422);
  });

  it('still refuses unknown fields beside it', async () => {
    // The strict-object rule (§6.3) must not have been loosened to let the new
    // field through.
    const res = await post('/api/v1/projects/laika/tasks', {
      title: 'Sneaky',
      acceptance_md: 'fine',
      acceptance: 'not a field',
    });

    expect(res.status).toBe(422);
  });
});
