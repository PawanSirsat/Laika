import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Sizes and forecasts over HTTP (§6.4, D-085, LAI-771): the size on every
 * task, the estimate a task panel reads, a person's size on `PATCH` and on
 * create, and the project's accuracy. The rules are the service's
 * (`test/services/estimates.test.ts`); this is the transport — shapes, status
 * codes, and who is refused.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let readOnly: string;

interface Size {
  level: string;
  computed: string;
  overridden: boolean;
  weight: number;
  build_p50_ms: number | null;
  build_p80_ms: number | null;
  subtasks: number;
}

interface TaskBody {
  id: string;
  key: string;
  size: Size | null;
}

async function asSession(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function asToken(secret: string, path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({
      Authorization: `Bearer ${secret}`,
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });
}

/** A call that must succeed — a broken setup must not satisfy a refusal test. */
async function must(res: Promise<Response>, expected = 200): Promise<Response> {
  const answered = await res;
  expect(answered.status, await answered.clone().text()).toBe(expected);
  return answered;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function newTask(body: Record<string, unknown> = {}): Promise<TaskBody> {
  return json<TaskBody>(
    await must(
      asSession('/api/v1/projects/core/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Work', acceptance_md: '- [ ] it works', ...body }),
      }),
      201,
    ),
  );
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
    }),
  });
  expect(setup.status).toBe(201);
  cookie = cookieFrom(setup);
  await must(
    asSession('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Core', slug: 'core', prefix: 'COR' }),
    }),
    201,
  );
  const minted = await must(
    asSession('/api/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Reader', scope: 'read_only' }),
    }),
    201,
  );
  readOnly = (await json<{ secret: string }>(minted)).secret;
});

afterEach(() => {
  h.close();
});

describe('the size on every task', () => {
  it('is on a created task, a read task and a listed task', async () => {
    const task = await newTask();
    expect(task.size).toMatchObject({ overridden: false, subtasks: 0 });
    expect(task.size!.level).toBe(task.size!.computed);

    const read = await json<TaskBody>(await must(asSession(`/api/v1/tasks/${task.id}`)));
    expect(read.size).toEqual(task.size);

    const page = await json<{ data: TaskBody[] }>(
      await must(asSession('/api/v1/projects/core/tasks')),
    );
    expect(page.data.find((t) => t.id === task.id)?.size).toEqual(task.size);
  });
});

describe('GET /api/v1/tasks/:id/estimate', () => {
  it('answers the size, the why, the frozen copy and the actual', async () => {
    const task = await newTask();
    const view = await json<{
      task_id: string;
      size: Size;
      why: { early: boolean; factors: { key: string; levels: number }[]; similar: unknown[] };
      at_start: unknown;
      actual: { build_ms: number | null; review_wait_ms: number; rework_ms: number };
      history: { source: string }[];
    }>(await must(asSession(`/api/v1/tasks/${task.id}/estimate`)));

    expect(view.task_id).toBe(task.id);
    expect(view.size).toEqual(task.size);
    expect(view.why.early).toBe(true);
    expect(view.why.factors.map((f) => f.key)).toContain('priority');
    expect(view.at_start).toBeNull();
    expect(view.actual).toMatchObject({ build_ms: null, review_wait_ms: 0, rework_ms: 0 });
    expect(view.history.map((r) => r.source)).toEqual(['model']);
  });

  it('is a 404 for a task that does not exist', async () => {
    const res = await asSession('/api/v1/tasks/01NOTATASK000000000000000/estimate');
    expect(res.status).toBe(404);
  });

  it('is a read: a read-only token may make it', async () => {
    const task = await newTask();
    await must(asToken(readOnly, `/api/v1/tasks/${task.id}/estimate`));
  });
});

describe('a person’s size', () => {
  it('is set by PATCH, cleared by null, and the computed one stays beside it', async () => {
    const task = await newTask();
    const level = task.size!.computed === 'XL' ? 'XS' : 'XL';

    const set = await json<TaskBody>(
      await must(
        asSession(`/api/v1/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ size: level }),
        }),
      ),
    );
    expect(set.size).toMatchObject({ level, computed: task.size!.computed, overridden: true });

    const cleared = await json<TaskBody>(
      await must(
        asSession(`/api/v1/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ size: null }),
        }),
      ),
    );
    expect(cleared.size).toMatchObject({ level: task.size!.computed, overridden: false });
  });

  it('is accepted on create', async () => {
    const task = await newTask({ size: 'S' });
    expect(task.size).toMatchObject({ level: 'S', overridden: true });
  });

  it('refuses a level that is not one of XS to XL', async () => {
    const task = await newTask();
    const res = await asSession(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ size: 'XXL' }),
    });
    expect(res.status).toBe(422);
  });

  it('refuses a read-only token: setting a size is an edit', async () => {
    const task = await newTask();
    const res = await asToken(readOnly, `/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ size: 'XL' }),
    });
    expect(res.status).toBe(403);
    const after = await json<TaskBody>(await must(asSession(`/api/v1/tasks/${task.id}`)));
    expect(after.size!.overridden).toBe(false);
  });
});

describe('GET /api/v1/projects/:slug/estimates/accuracy', () => {
  it('answers the project’s figures and nothing about a person', async () => {
    await newTask();
    const view = await json<Record<string, unknown>>(
      await must(asSession('/api/v1/projects/core/estimates/accuracy')),
    );
    expect(view).toMatchObject({
      finished: 0,
      forecasts_after: 10,
      live: { n: 0, typical_error: null, bias: null, p80_hit_rate: null },
      backtest: null,
      by_client: [],
    });
    expect(Object.keys(view).sort()).toEqual([
      'backtest',
      'by_client',
      'finished',
      'forecasts_after',
      'live',
      'model_version',
      'project_id',
    ]);
  });

  it('is a 404 for a project that does not exist', async () => {
    const res = await asSession('/api/v1/projects/nope/estimates/accuracy');
    expect(res.status).toBe(404);
  });
});
