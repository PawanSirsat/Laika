import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * Project status endpoints, and the task endpoints that take a status
 * (§6.4, LAI-738). Transport only — the rules and their tests live in
 * `test/services/project-statuses.test.ts`. What is asserted here is what only
 * the route layer can get wrong: paths, status codes, the strict bodies, the
 * `{ data }` envelope, and that the old column routes are gone.
 */

let h: AuthHarness;
let cookie: string;

const PASSWORD = 'correct-horse-battery-staple';

interface StatusBody {
  id: string;
  project_id: string;
  name: string;
  category: string;
  position: number;
  hidden: boolean;
  created_at: number;
  task_count: number;
}

interface TaskBody {
  id: string;
  status: string;
  status_id: string;
  status_name: string;
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return req(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A write that must succeed — a setup step that cannot fail silently (CLAUDE.md §5). */
async function ok<T>(method: string, path: string, body: unknown, status = 200): Promise<T> {
  const res = await send(method, path, body);
  expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBe(status);
  return (await res.json()) as T;
}

async function list(): Promise<StatusBody[]> {
  const res = await req('/api/v1/projects/laika/statuses');
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: StatusBody[] }).data;
}

async function named(name: string): Promise<StatusBody> {
  const found = (await list()).find((s) => s.name === name);
  if (found === undefined) throw new Error(`no status called ${name}`);
  return found;
}

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
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

describe('GET /projects/:slug/statuses', () => {
  it('serves the statuses first boot gave the project, every field, by position', async () => {
    // `setup.ts` is the creation site most easily forgotten; this notices if
    // first boot stops seeding.
    const statuses = await list();
    expect(statuses.map((s) => [s.name, s.category, s.hidden])).toEqual([
      ['Backlog', 'backlog', false],
      ['To do', 'todo', false],
      ['In progress', 'in_progress', false],
      ['Review', 'review', false],
      ['Done', 'done', false],
      ['Cancelled', 'cancelled', true],
    ]);
    expect(Object.keys(statuses[0]!).sort()).toEqual(
      [
        'category',
        'created_at',
        'hidden',
        'id',
        'name',
        'position',
        'project_id',
        'task_count',
      ].sort(),
    );
  });

  it('refuses an unauthenticated caller and 404s an unknown project', async () => {
    expect((await h.app.request('/api/v1/projects/laika/statuses')).status).toBe(401);
    expect((await req('/api/v1/projects/nope/statuses')).status).toBe(404);
  });

  it('no longer serves the board-column routes', async () => {
    // A body, not a status: an unknown API path must not fall through to the
    // SPA's index.html and answer 200 (see the spa-fallback memory).
    const res = await req('/api/v1/projects/laika/board-columns');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
  });
});

describe('writing statuses', () => {
  it('creates with 201 and answers with the whole list', async () => {
    const body = await ok<{ data: StatusBody[] }>(
      'POST',
      '/api/v1/projects/laika/statuses',
      { name: 'QA', category: 'review' },
      201,
    );
    expect(body.data.map((s) => s.name)).toEqual([
      'Backlog',
      'To do',
      'In progress',
      'Review',
      'QA',
      'Done',
      'Cancelled',
    ]);
  });

  it('refuses an unknown category, a missing name and an unknown field with 422', async () => {
    for (const body of [
      { name: 'QA', category: 'testing' },
      { category: 'review' },
      { name: 'QA', category: 'review', colour: 'red' },
    ]) {
      const res = await send('POST', '/api/v1/projects/laika/statuses', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('renames and hides with PATCH, and refuses a category change in words', async () => {
    const review = await named('Review');
    const body = await ok<{ data: StatusBody[] }>(
      'PATCH',
      `/api/v1/projects/laika/statuses/${review.id}`,
      { name: 'Code review', hidden: true },
    );
    expect(body.data.find((s) => s.id === review.id)).toMatchObject({
      name: 'Code review',
      hidden: true,
    });

    const res = await send('PATCH', `/api/v1/projects/laika/statuses/${review.id}`, {
      category: 'done',
    });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).message).toMatch(/^A status’s category cannot be changed\./);

    expect((await send('PATCH', `/api/v1/projects/laika/statuses/${review.id}`, {})).status).toBe(
      422,
    );
  });

  it('reorders with PUT /statuses/order', async () => {
    const ids = (await list()).map((s) => s.id).reverse();
    const body = await ok<{ data: StatusBody[] }>('PUT', '/api/v1/projects/laika/statuses/order', {
      ids,
    });
    expect(body.data.map((s) => s.id)).toEqual(ids);
    expect(
      (await send('PUT', '/api/v1/projects/laika/statuses/order', { ids: ids.slice(1) })).status,
    ).toBe(422);
  });

  it('deletes with a body naming where the work goes, and says how much moved', async () => {
    const qa = (
      await ok<{ data: StatusBody[] }>(
        'POST',
        '/api/v1/projects/laika/statuses',
        { name: 'QA', category: 'review' },
        201,
      )
    ).data.find((s) => s.name === 'QA')!;
    const task = await ok<TaskBody>(
      'POST',
      '/api/v1/projects/laika/tasks',
      { title: 'In QA', status_id: qa.id },
      201,
    );
    expect(task).toMatchObject({ status: 'review', status_name: 'QA' });

    const review = await named('Review');
    const body = await ok<{ data: StatusBody[]; moved: number }>(
      'DELETE',
      `/api/v1/projects/laika/statuses/${qa.id}`,
      { move_to: review.id },
    );
    expect(body.moved).toBe(1);
    expect(body.data.map((s) => s.name)).not.toContain('QA');
    expect(body.data.find((s) => s.id === review.id)?.task_count).toBe(1);

    // Without a destination it is refused, and so is the last of a category.
    expect((await send('DELETE', `/api/v1/projects/laika/statuses/${review.id}`, {})).status).toBe(
      422,
    );
    const last = await send('DELETE', `/api/v1/projects/laika/statuses/${review.id}`, {
      move_to: (await named('Done')).id,
    });
    expect(last.status).toBe(409);
    expect((await errorOf(last)).message).toBe(
      'Review is this project’s only Review status, and every project keeps at least one',
    );
  });
});

describe('permission is asked before the body is read', () => {
  /**
   * A caller who may not edit statuses learns that, whatever they sent — not
   * a validation error that describes the endpoint to them first (§5: every
   * endpoint calls `can()` before it reads or writes).
   */
  it('answers 403 to a project member, even for a body that would be 422', async () => {
    const owner = h.db.select().from(users).get()!;
    const orgId = h.db.all<{ id: string }>(sql`SELECT id FROM orgs`)[0]!.id;
    const email = 'member@example.test';
    const token = seedInvite(h.db, { orgId, createdBy: owner.id, email, orgRole: 'member' });
    const joined = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
    expect(joined.status, await joined.clone().text()).toBe(200);
    const memberId = h.db.select().from(users).where(eq(users.email, email)).get()!.id;
    await ok('POST', '/api/v1/projects/laika/members', { user_id: memberId, role: 'member' }, 201);
    const memberCookie = cookieFrom(joined);

    const review = await named('Review');
    for (const [method, path, body] of [
      ['POST', '/api/v1/projects/laika/statuses', { category: 'nope' }],
      ['PATCH', `/api/v1/projects/laika/statuses/${review.id}`, {}],
      ['PATCH', `/api/v1/projects/laika/statuses/${review.id}`, { category: 'done' }],
      ['PUT', '/api/v1/projects/laika/statuses/order', { ids: [] }],
      ['DELETE', `/api/v1/projects/laika/statuses/${review.id}`, {}],
    ] as const) {
      const res = await h.app.request(path, {
        method,
        headers: jsonHeaders({ Cookie: memberCookie }),
        body: JSON.stringify(body),
      });
      expect(res.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(403);
    }
  });
});

describe('tasks take a status by id or by category', () => {
  it('moves by status_id or status on POST /tasks/:id/status, and refuses both or neither', async () => {
    const coding = (
      await ok<{ data: StatusBody[] }>(
        'POST',
        '/api/v1/projects/laika/statuses',
        { name: 'Coding', category: 'in_progress' },
        201,
      )
    ).data.find((s) => s.name === 'Coding')!;
    const task = await ok<TaskBody>(
      'POST',
      '/api/v1/projects/laika/tasks',
      { title: 'A', status: 'in_progress' },
      201,
    );
    expect(task.status_name).toBe('In progress');

    const moved = await ok<TaskBody>('POST', `/api/v1/tasks/${task.id}/status`, {
      status_id: coding.id,
    });
    expect(moved).toMatchObject({
      status: 'in_progress',
      status_id: coding.id,
      status_name: 'Coding',
    });

    const byCategory = await ok<TaskBody>('POST', `/api/v1/tasks/${task.id}/status`, {
      status: 'review',
    });
    expect(byCategory).toMatchObject({ status: 'review', status_name: 'Review' });

    for (const body of [{}, { status: 'done', status_id: coding.id }]) {
      const res = await send('POST', `/api/v1/tasks/${task.id}/status`, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('filters GET /projects/:slug/tasks by status_id', async () => {
    const todo = await named('To do');
    const a = await ok<TaskBody>(
      'POST',
      '/api/v1/projects/laika/tasks',
      { title: 'A', status: 'todo' },
      201,
    );
    await ok<TaskBody>('POST', '/api/v1/projects/laika/tasks', { title: 'B' }, 201);

    const res = await req(`/api/v1/projects/laika/tasks?status_id=${todo.id}`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { data: TaskBody[] };
    expect(page.data.map((t) => t.id)).toEqual([a.id]);
  });
});
