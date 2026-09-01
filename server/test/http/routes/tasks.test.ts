import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tasks, users } from '../../../src/db/schema.ts';
import { flagStaleTasks, STALE_AFTER_MS } from '../../../src/jobs/jobs.ts';
import { MAX_TAGS_PER_TASK } from '../../../src/services/tags.ts';
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

/** The Owner's id, read from the row rather than threaded through the harness. */
function ownerUserId(): string {
  return h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
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
      blocked_by_task_id: blocker.id,
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

    await post(`/api/v1/tasks/${a.id}/dependencies`, { blocked_by_task_id: b.id });
    const cycle = await post(`/api/v1/tasks/${b.id}/dependencies`, { blocked_by_task_id: a.id });

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

/**
 * Watch and unwatch (§6.4, D-047, LAI-143).
 *
 * The service owns the watcher set and its rules. What is left here is transport
 * and the **scope layer** — the half D-047 turns on.
 */

describe('too many tags says how many (LAI-159)', () => {
  it('names the count the caller actually sent', async () => {
    // `.max(MAX_TAGS_PER_TASK)` on the route was the same constant the service
    // compares against, so zod refused first and `count` — the only number that
    // tells somebody how many to drop — never reached the caller.
    const tags = Array.from({ length: MAX_TAGS_PER_TASK + 3 }, (_, i) => `tag-${String(i)}`);

    const res = await post('/api/v1/projects/laika/tasks', { title: 'many tags', tags });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: { count?: number } } };
    expect(body.error.details.count).toBe(tags.length);
  });

  it('still accepts exactly the maximum', async () => {
    // The boundary the refusal is measured from; without it a service refusing
    // at `>=` would satisfy the assertion above.
    const tags = Array.from({ length: MAX_TAGS_PER_TASK }, (_, i) => `tag-${String(i)}`);

    const res = await post('/api/v1/projects/laika/tasks', { title: 'exactly enough', tags });

    expect(res.status, await res.clone().text()).toBe(201);
  });
});

describe('the stale marker reaches the client (§11.4.1, LAI-208)', () => {
  /**
   * `tasks.stale_flagged_at` has existed and been written by the nightly job
   * since §11.7, and was **not** in `TaskView` — so the board could draw
   * `blocked` and `ready` and not `stale`, which is the one of the three that
   * says nobody is looking at this.
   *
   * Driven through the **real job** rather than by writing the column: what has
   * to hold is that the value a client receives is the value §11.6 wrote. A
   * fixture that sets the column itself would pass against a job that never runs
   * and against a column nothing populates.
   */
  async function flagOne(): Promise<{ id: string; key: string; at: number }> {
    const task = await newTask('Left running');

    // §5's path, walked one step at a time, **each one asserted**. The first
    // version of this used a PATCH that the route ignores; it returned a
    // non-200 nobody looked at, the task stayed in `backlog`, and the job then
    // had nothing to flag. Only the `changed` guard below caught it.
    for (const status of ['todo', 'in_progress'] as const) {
      const res = await post(`/api/v1/tasks/${task.id}/status`, { status });
      expect(res.status, `${status}: ${await res.clone().text()}`).toBe(200);
    }

    // The job flags `in_progress` tasks untouched for three days. Ageing the row
    // is the only way to reach that without waiting.
    const now = Date.now();
    h.db
      .update(tasks)
      .set({ updatedAt: now - STALE_AFTER_MS - 1 })
      .where(eq(tasks.id, task.id))
      .run();

    const result = flagStaleTasks(h.db, now);
    // Without this the tests below assert `null === null` and pass against a
    // field that is never populated — the failure this whole task is about.
    expect(result.changed, 'the job flagged nothing, so nothing is being proved').toBe(1);

    return { id: task.id, key: task.key, at: now };
  }

  it('round-trips a flagged task through GET /tasks/:id', async () => {
    const flagged = await flagOne();

    const body = (await (await req(`/api/v1/tasks/${flagged.id}`)).json()) as {
      stale_flagged_at: number | null;
    };

    // The timestamp the job wrote, not merely "something non-null": a view that
    // sent `Date.now()` would satisfy a null check and be a different field.
    expect(body.stale_flagged_at).toBe(flagged.at);
  });

  it('round-trips it through GET /projects/:slug/tasks as well', async () => {
    // AC2 names both endpoints. They share `toView`, but "they share a helper
    // today" is not the property — that the list is not separately assembled is
    // exactly the kind of thing a later refactor changes without noticing.
    const flagged = await flagOne();

    const body = (await (await req('/api/v1/projects/laika/tasks')).json()) as {
      data: { id: string; stale_flagged_at: number | null }[];
    };
    const row = body.data.find((t) => t.id === flagged.id);

    expect(row, 'the flagged task is not in the page').toBeDefined();
    expect(row?.stale_flagged_at).toBe(flagged.at);
  });

  it('is null for a task nobody has flagged, not absent', async () => {
    // A marker the UI draws on truthiness must be able to tell "not stale" from
    // "this server does not send the field" — `undefined` renders the same as
    // `null` in JS and means something different.
    const task = await newTask('Perfectly fine');

    const body = (await (await req(`/api/v1/tasks/${task.id}`)).json()) as {
      stale_flagged_at: number | null;
    };

    expect(body).toHaveProperty('stale_flagged_at');
    expect(body.stale_flagged_at).toBeNull();
  });

  it('sends the stored timestamp rather than a computed boolean', async () => {
    // AC1, stated as its own case. `ready` is derived server-side because §4.5
    // must have one definition; staleness is *stored*, so the honest shape is
    // the value the job wrote. A boolean would discard the only information the
    // row holds, and §11.4.1's marker wants to say how stale.
    const flagged = await flagOne();

    const body = (await (await req(`/api/v1/tasks/${flagged.id}`)).json()) as {
      stale_flagged_at: number | null;
    };

    expect(typeof body.stale_flagged_at).toBe('number');
    expect(body).not.toHaveProperty('stale');
    expect(body).not.toHaveProperty('is_stale');
  });
});

describe('watching a task', () => {
  async function mintToken(scope: 'full' | 'read_only'): Promise<string> {
    const res = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: `t-${scope}`, scope }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { secret: string }).secret;
  }

  async function asToken(secret: string, path: string, method = 'GET'): Promise<Response> {
    return h.app.request(path, {
      method,
      headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
    });
  }

  it('watches and unwatches with 204, and reports the watcher', async () => {
    const task = (await newTask()).id;

    expect((await req(`/api/v1/tasks/${task}/watch`, { method: 'PUT' })).status).toBe(204);

    const watchers = (await (await req(`/api/v1/tasks/${task}/watchers`)).json()) as {
      watchers: string[];
    };
    expect(watchers.watchers).toContain(ownerUserId());

    expect((await req(`/api/v1/tasks/${task}/watch`, { method: 'DELETE' })).status).toBe(204);
    const after = (await (await req(`/api/v1/tasks/${task}/watchers`)).json()) as {
      watchers: string[];
    };
    expect(after.watchers).not.toContain(ownerUserId());
  });

  it('refuses a read_only token the write, and still allows it the read', async () => {
    const task = (await newTask()).id;
    const readOnly = await mintToken('read_only');

    // **Both halves, and the second is what makes the first mean anything.**
    // The refusal has to come from the **scope** layer: `task.watch` is granted
    // to every project role, so a role-layer denial would be an accident. The
    // token can still read the watcher list, so the credential is the only
    // difference between the two calls.
    expect((await asToken(readOnly, `/api/v1/tasks/${task}/watch`, 'PUT')).status).toBe(403);
    expect((await asToken(readOnly, `/api/v1/tasks/${task}/watchers`)).status).toBe(200);
  });

  it('allows a full token the write, so the refusal is about scope and not tokens', async () => {
    const task = (await newTask()).id;
    const full = await mintToken('full');

    expect((await asToken(full, `/api/v1/tasks/${task}/watch`, 'PUT')).status).toBe(204);
  });

  it('401s when signed out', async () => {
    const task = (await newTask()).id;
    const res = await h.app.request(`/api/v1/tasks/${task}/watch`, {
      method: 'PUT',
      headers: jsonHeaders(),
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /me/watching and GET /projects/:slug/mentionable (LAI-143)', () => {
  it('lists the caller’s watched tasks and nobody else’s', async () => {
    const task = (await newTask()).id;
    await req(`/api/v1/tasks/${task}/watch`, { method: 'PUT' });

    const body = (await (await req('/api/v1/me/watching')).json()) as { task_ids: string[] };

    expect(body.task_ids).toContain(task);
  });

  it('has no path that could ask about somebody else', async () => {
    // The permission is the shape of the URL: `/users/:id/watching` is not a
    // route, so the request cannot be expressed. The service refuses a foreign
    // id too, but nothing can reach it to try.
    const res = await req(`/api/v1/users/${ownerUserId()}/watching`);

    expect([404, 405]).toContain(res.status);
  });

  it('401s /me/watching when signed out', async () => {
    const res = await h.app.request('/api/v1/me/watching', { headers: jsonHeaders() });

    expect(res.status).toBe(401);
  });

  it('offers the Owner as mentionable although they have no membership row', async () => {
    const body = (await (await req('/api/v1/projects/laika/mentionable')).json()) as {
      users: { id: string; name: string }[];
    };

    // The case `/members` gets wrong (D-006).
    expect(body.users.map((u) => u.id)).toContain(ownerUserId());
  });

  it('404s mentionable on a project that does not exist', async () => {
    expect((await req('/api/v1/projects/nope/mentionable')).status).toBe(404);
  });
});
