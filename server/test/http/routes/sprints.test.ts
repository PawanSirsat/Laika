import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

let h: AuthHarness;
let cookie: string;

const PASSWORD = 'correct-horse-battery-staple';
const DAY = 86_400_000;
const JAN1 = Date.UTC(2026, 0, 1);
const jan = (n: number): number => JAN1 + (n - 1) * DAY;

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  return req(path, { method: 'POST', body: JSON.stringify(body) });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return req(path, { method: 'PATCH', body: JSON.stringify(body) });
}

interface SprintBody {
  id: string;
  name: string;
  goal: string | null;
  starts_on: number;
  ends_on: number;
  status: string;
}

async function newSprint(
  name = 'Sprint 1',
  starts = jan(1),
  ends = jan(14),
  extra: Record<string, unknown> = {},
): Promise<SprintBody> {
  const res = await post('/api/v1/projects/laika/sprints', {
    name,
    starts_on: starts,
    ends_on: ends,
    ...extra,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as SprintBody;
}

async function newTask(title = 'Do the thing'): Promise<{ id: string; sprint_id: string | null }> {
  const res = await post('/api/v1/projects/laika/tasks', { title });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; sprint_id: string | null };
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
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

describe('project-scoped sprint endpoints (AC1)', () => {
  it('creates and reads back', async () => {
    const created = await newSprint('Sprint 1', jan(1), jan(14));

    expect(created).toMatchObject({ name: 'Sprint 1', status: 'planned', goal: null });

    const read = await req(`/api/v1/sprints/${created.id}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as SprintBody).name).toBe('Sprint 1');
  });

  it('returns the §6.3 page shape, ordered by date, and paginates', async () => {
    await newSprint('Third', jan(21), jan(28));
    await newSprint('First', jan(1), jan(7));
    await newSprint('Second', jan(11), jan(18));

    const first = (await (await req('/api/v1/projects/laika/sprints?limit=2')).json()) as {
      data: SprintBody[];
      next_cursor: string | null;
    };

    expect(first.data.map((s) => s.name)).toEqual(['First', 'Second']);
    expect(first.next_cursor).not.toBeNull();

    const second = (await (
      await req(`/api/v1/projects/laika/sprints?limit=2&cursor=${first.next_cursor!}`)
    ).json()) as { data: SprintBody[]; next_cursor: string | null };

    expect(second.data.map((s) => s.name)).toEqual(['Third']);
    expect(second.next_cursor).toBeNull();
  });

  it('filters by status and rejects a status it does not know', async () => {
    await newSprint('Planned', jan(1), jan(7));
    await newSprint('Running', jan(11), jan(18), { status: 'active' });

    const active = (await (await req('/api/v1/projects/laika/sprints?status=active')).json()) as {
      data: SprintBody[];
    };
    expect(active.data.map((s) => s.name)).toEqual(['Running']);

    const bad = await req('/api/v1/projects/laika/sprints?status=nonsense');
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe('bad_request');
  });

  it('401s an anonymous caller on both halves', async () => {
    const created = await newSprint();

    expect((await h.app.request('/api/v1/projects/laika/sprints')).status).toBe(401);
    expect((await h.app.request(`/api/v1/sprints/${created.id}`)).status).toBe(401);
  });
});

describe('validation at the boundary (AC5)', () => {
  it('rejects unknown fields, a missing date and a non-integer one', async () => {
    const cases: [Record<string, unknown>, number][] = [
      [{ name: 'x', starts_on: jan(1), ends_on: jan(7), points: 13 }, 422],
      [{ name: 'x', starts_on: jan(1) }, 422],
      [{ name: 'x', starts_on: jan(1) + 0.5, ends_on: jan(7) }, 422],
      [{ name: '', starts_on: jan(1), ends_on: jan(7) }, 422],
    ];

    for (const [body, status] of cases) {
      const res = await post('/api/v1/projects/laika/sprints', body);
      expect(res.status, JSON.stringify(body)).toBe(status);
    }
  });

  it('answers a backwards range with 422 and an overlap with 409', async () => {
    await newSprint('Sprint 1', jan(10), jan(20));

    const backwards = await post('/api/v1/projects/laika/sprints', {
      name: 'Backwards',
      starts_on: jan(20),
      ends_on: jan(10),
    });
    expect(backwards.status).toBe(422);

    const overlapping = await post('/api/v1/projects/laika/sprints', {
      name: 'Overlapping',
      starts_on: jan(15),
      ends_on: jan(25),
    });
    expect(overlapping.status).toBe(409);
    expect(await errorCode(overlapping)).toBe('conflict');
  });
});

describe('mutating a sprint (AC1, AC3)', () => {
  it('patches fields and clears a goal with null', async () => {
    const created = await newSprint('Sprint 1', jan(1), jan(14), { goal: 'Ship it' });

    const renamed = (await (
      await patch(`/api/v1/sprints/${created.id}`, { name: 'Sprint One' })
    ).json()) as SprintBody;
    expect(renamed).toMatchObject({ name: 'Sprint One', goal: 'Ship it' });

    const cleared = (await (
      await patch(`/api/v1/sprints/${created.id}`, { goal: null })
    ).json()) as SprintBody;
    expect(cleared.goal).toBeNull();
  });

  it('409s a second activation', async () => {
    await newSprint('Sprint 1', jan(1), jan(14), { status: 'active' });
    const second = await newSprint('Sprint 2', jan(15), jan(28));

    const res = await patch(`/api/v1/sprints/${second.id}`, { status: 'active' });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('conflict');
  });

  it('deletes with 204 and leaves the tasks behind', async () => {
    const created = await newSprint();
    const task = await newTask();
    await post(`/api/v1/sprints/${created.id}/tasks`, { task_ids: [task.id] });

    const res = await req(`/api/v1/sprints/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect((await req(`/api/v1/sprints/${created.id}`)).status).toBe(404);

    const after = (await (await req(`/api/v1/tasks/${task.id}`)).json()) as {
      sprint_id: string | null;
    };
    expect(after.sprint_id).toBeNull();
  });

  it('404s an unknown sprint on every verb', async () => {
    const missing = '/api/v1/sprints/01ARZ3NDEKTSV4RRFFQ69G5FAV';

    expect((await req(missing)).status).toBe(404);
    expect((await patch(missing, { name: 'x' })).status).toBe(404);
    expect((await req(missing, { method: 'DELETE' })).status).toBe(404);
    expect((await post(`${missing}/tasks`, { task_ids: ['x'] })).status).toBe(404);
  });
});

describe('tasks in and out of a sprint (AC2)', () => {
  it('assigns in bulk and answers with the tasks, not a page', async () => {
    const created = await newSprint();
    const a = await newTask('A');
    const b = await newTask('B');

    const res = await post(`/api/v1/sprints/${created.id}/tasks`, { task_ids: [a.id, b.id] });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['tasks']);
    // Deliberately not the `{ data, next_cursor }` envelope — this is an action's
    // result and does not paginate.
    expect(body).not.toHaveProperty('next_cursor');
    expect((body.tasks as { sprint_id: string }[]).map((t) => t.sprint_id)).toEqual([
      created.id,
      created.id,
    ]);
  });

  it('removes one and returns the task', async () => {
    const created = await newSprint();
    const a = await newTask('A');
    await post(`/api/v1/sprints/${created.id}/tasks`, { task_ids: [a.id] });

    const res = await req(`/api/v1/sprints/${created.id}/tasks/${a.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sprint_id: string | null }).sprint_id).toBeNull();
  });

  it('rejects an empty or oversized task_ids list', async () => {
    const created = await newSprint();

    expect((await post(`/api/v1/sprints/${created.id}/tasks`, { task_ids: [] })).status).toBe(422);
    expect(
      (
        await post(`/api/v1/sprints/${created.id}/tasks`, {
          task_ids: Array.from({ length: 501 }, () => 'x'),
        })
      ).status,
    ).toBe(422);
  });
});

describe('the ?sprint= filter (AC7)', () => {
  it('narrows the task list, and `none` finds the unassigned', async () => {
    const created = await newSprint();
    const inSprint = await newTask('In');
    const loose = await newTask('Loose');
    await post(`/api/v1/sprints/${created.id}/tasks`, { task_ids: [inSprint.id] });

    const inside = (await (
      await req(`/api/v1/projects/laika/tasks?sprint=${created.id}`)
    ).json()) as { data: { id: string }[] };
    expect(inside.data.map((t) => t.id)).toEqual([inSprint.id]);

    const outside = (await (await req('/api/v1/projects/laika/tasks?sprint=none')).json()) as {
      data: { id: string }[];
    };
    expect(outside.data.map((t) => t.id)).toEqual([loose.id]);
  });
});
