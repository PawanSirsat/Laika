import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tasks, users } from '../../../src/db/schema.ts';
import { flagStaleTasks, STALE_AFTER_MS } from '../../../src/jobs/jobs.ts';
import { MAX_TAGS_PER_TASK } from '../../../src/services/tags.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

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

    // The holder's own repeat is a mark, not a move (LAI-770 review, B2): the
    // task as it is.
    const again = await post(`/api/v1/tasks/${task.id}/claim`, {});
    expect(again.status, await again.clone().text()).toBe(200);
    expect(await again.json()).toMatchObject({
      status: 'in_progress',
      assignee_id: claimed.assignee_id,
    });

    // Somebody else is told who holds it.
    const invited = await post('/api/v1/invites', {
      email: 'brin@example.test',
      org_role: 'member',
    });
    expect(invited.status, await invited.clone().text()).toBe(201);
    const signed = await signUp(h.app, {
      email: 'brin@example.test',
      password: PASSWORD,
      name: 'Brin',
      inviteToken: ((await invited.json()) as { token: string }).token,
    });
    expect(signed.status, await signed.clone().text()).toBe(200);
    const brin = h.db.select().from(users).where(eq(users.email, 'brin@example.test')).get()?.id;
    const joined = await post('/api/v1/projects/laika/members', { user_id: brin, role: 'member' });
    expect(joined.status, await joined.clone().text()).toBe(201);

    const second = await h.app.request(`/api/v1/tasks/${task.id}/claim`, {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookieFrom(signed) }),
      body: '{}',
    });
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

  it('lets a person jump straight to done, because columns are configurable', async () => {
    // LAI-266. This request was a 422 before the §5 table split by principal;
    // a board whose columns are user-made makes `todo → done` an ordinary drag.
    const task = await newTask();

    expect((await post(`/api/v1/tasks/${task.id}/status`, { status: 'done' })).status).toBe(200);
  });

  it('refuses an impossible move with unprocessable, listing what is allowed', async () => {
    // `done → cancelled` is the one refusal that survives the widening for a
    // person — cancelling something already finished is meaningless — so it is
    // what keeps the 422 path and its `allowed` payload under test at all.
    const task = await newTask();
    expect((await post(`/api/v1/tasks/${task.id}/status`, { status: 'done' })).status).toBe(200);

    const res = await post(`/api/v1/tasks/${task.id}/status`, { status: 'cancelled' });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: { allowed: string[] } } };
    // The human list, because a human was refused — not `ALLOWED_TRANSITIONS.done`.
    expect(body.error.details.allowed).toContain('todo');
    expect(body.error.details.allowed).not.toContain('cancelled');
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

/**
 * Subtasks and dates over HTTP (D-066, LAI-493): the body shapes, the one
 * list filter, and the error the client is promised.
 */
describe('subtasks and dates on the wire (D-066)', () => {
  const DAY = 86_400_000;

  it('creates a subtask, serves parent_task_id, and lists children with ?parent=', async () => {
    const parent = await newTask('Parent');
    const child = await newTask('Child', { parent_task_id: parent.id });
    await newTask('Unrelated');

    const read = (await (await req(`/api/v1/tasks/${child.id}`)).json()) as {
      parent_task_id: string | null;
    };
    expect(read.parent_task_id).toBe(parent.id);

    const list = await req(`/api/v1/projects/laika/tasks?parent=${parent.id}`);
    expect(list.status).toBe(200);
    const page = (await list.json()) as { data: { id: string }[] };
    expect(page.data.map((t) => t.id)).toEqual([child.id]);
  });

  it('sets and clears the parent and both dates on PATCH', async () => {
    const parent = await newTask('Parent');
    const task = await newTask('Loose');

    const set = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parent_task_id: parent.id, due_on: 5 * DAY, planned_start: DAY }),
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      parent_task_id: parent.id,
      due_on: 5 * DAY,
      planned_start: DAY,
    });

    const cleared = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parent_task_id: null, due_on: null, planned_start: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({
      parent_task_id: null,
      due_on: null,
      planned_start: null,
    });
  });

  it('refuses a depth of two with 422 and names the reason', async () => {
    const parent = await newTask('Parent');
    const child = await newTask('Child', { parent_task_id: parent.id });

    const res = await post('/api/v1/projects/laika/tasks', {
      title: 'Grandchild',
      parent_task_id: child.id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; details: { field: string; reason: string } };
    };
    expect(body.error.code).toBe('unprocessable');
    expect(body.error.details).toEqual({ field: 'parent_task_id', reason: 'depth' });
  });

  it('refuses a date that is not an integer timestamp', async () => {
    const task = await newTask('Dated');
    const res = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ due_on: '2026-07-12' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /tasks/:id/reorder (LAI-472, D-070)', () => {
  const ordered = async () => {
    const res = await req('/api/v1/projects/laika/tasks');
    const body = (await res.json()) as { data: { title: string; position: string }[] };
    return [...body.data].sort((a, b) => (a.position < b.position ? -1 : 1)).map((t) => t.title);
  };

  it('moves a card between its neighbours and answers the task with its new place', async () => {
    const a = await newTask('a');
    const b = await newTask('b');
    const c = await newTask('c');

    const res = await post(`/api/v1/tasks/${c.id}/reorder`, {
      after_task_id: a.id,
      before_task_id: b.id,
    });

    expect(res.status).toBe(200);
    const moved = (await res.json()) as { id: string; position: string };
    expect(moved.id).toBe(c.id);
    expect(typeof moved.position).toBe('string');
    expect(await ordered()).toEqual(['a', 'c', 'b']);
  });

  it('serves position on every task the list returns', async () => {
    await newTask('a');
    const res = await req('/api/v1/projects/laika/tasks');
    const body = (await res.json()) as { data: { position: unknown }[] };
    expect(body.data.every((t) => typeof t.position === 'string')).toBe(true);
  });

  it('refuses a body with neither neighbour, or an unknown field, as 422', async () => {
    const a = await newTask('a');
    for (const body of [{}, { after_task_id: a.id, position: 'a0' }]) {
      const res = await post(`/api/v1/tasks/${a.id}/reorder`, body);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unprocessable');
    }
  });

  it('answers 409 when the neighbours are the wrong way round — the board changed', async () => {
    const a = await newTask('a');
    const b = await newTask('b');
    const c = await newTask('c');
    const res = await post(`/api/v1/tasks/${c.id}/reorder`, {
      after_task_id: b.id,
      before_task_id: a.id,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('conflict');
    expect(await ordered()).toEqual(['a', 'b', 'c']);
  });

  it('answers 404 for a task that does not exist', async () => {
    const a = await newTask('a');
    const res = await post(`/api/v1/tasks/no-such-task/reorder`, { after_task_id: a.id });
    expect(res.status).toBe(404);
  });
});

describe('an outside id on the wire (LAI-780)', () => {
  interface Refusal {
    error: { code: string; details: Record<string, unknown> & { field?: string } };
  }

  it('takes external_ref on create and on PATCH, upper-cased, and null clears it', async () => {
    const task = await newTask('From the repo', { external_ref: 'lai-780' });
    expect((task as unknown as { external_ref: string }).external_ref).toBe('LAI-780');

    const changed = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ external_ref: 'DATA_ENG-12' }),
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await changed.json()).toMatchObject({ external_ref: 'DATA_ENG-12' });

    const cleared = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ external_ref: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ external_ref: null });
  });

  it('refuses an id another task in the project holds, 422 naming that task (review)', async () => {
    const holder = await newTask('Holder', { external_ref: 'LAI-780' });
    const other = await newTask('Other');
    const res = await req(`/api/v1/tasks/${other.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ external_ref: 'lai-780' }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Refusal).error.details).toEqual({
      field: 'external_ref',
      reason: 'taken',
      external_ref: 'LAI-780',
      task: holder.key,
    });
  });

  it('refuses one of another shape 422 on external_ref — a pull request, a URL, too long', async () => {
    const task = await newTask('Shaped');
    for (const bad of ['kvell/laika#221', 'https://example.test/LAI-1', 'ABCDEFGHIJKLMNOPQ-1']) {
      const res = await req(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ external_ref: bad }),
      });
      expect(res.status, bad).toBe(422);
      expect(((await res.json()) as Refusal).error.details.field, bad).toBe('external_ref');
    }
    const created = await post('/api/v1/projects/laika/tasks', {
      title: 'Bad',
      external_ref: 'LAI 780',
    });
    expect(created.status).toBe(422);
    expect(((await created.json()) as Refusal).error.details.field).toBe('external_ref');
  });
});

/**
 * The list without its two texts (LAI-795). `description_md` and
 * `acceptance_md` were 83% of a gzip'd 200-task page on production (LAI-786),
 * and nothing that draws a list renders either. `?fields=slim` leaves them
 * out; without it the answer is byte-for-byte what it was, because agents,
 * the CLI and every other client read it.
 *
 * Counted in fields and bytes, never in time (LAI-779).
 */
describe('a slim list: ?fields=slim (LAI-795)', () => {
  const TEXTS = ['description_md', 'acceptance_md'] as const;

  interface ListPage {
    data: Record<string, unknown>[];
    next_cursor: string | null;
  }

  /** Every page of the list, with the raw bodies, so bytes can be counted. */
  async function walk(query: string): Promise<{ items: Record<string, unknown>[]; bytes: number }> {
    const items: Record<string, unknown>[] = [];
    let bytes = 0;
    let cursor: string | null = null;
    do {
      const after: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const res = await req(`/api/v1/projects/laika/tasks?limit=2${query}${after}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      bytes += Buffer.byteLength(text);
      const page = JSON.parse(text) as ListPage;
      items.push(...page.data);
      cursor = page.next_cursor;
    } while (cursor !== null);
    return { items, bytes };
  }

  async function seed(): Promise<{ textBytes: number }> {
    const description = 'A long description, as a real one is. '.repeat(40);
    const acceptance = '- [ ] the first criterion\n- [ ] the second one\n'.repeat(10);
    const blocker = await newTask('Blocker', { description_md: description });
    const blocked = await newTask('Blocked', {
      description_md: description,
      acceptance_md: acceptance,
      tags: ['perf'],
      external_ref: 'LAI-795',
    });
    expect(
      (
        await post(`/api/v1/tasks/${blocked.id}/dependencies`, {
          blocked_by_task_id: blocker.id,
        })
      ).status,
    ).toBe(201);
    await newTask('No texts at all');
    await newTask('Only acceptance', { acceptance_md: acceptance });
    await newTask('Child', { parent_task_id: blocker.id, description_md: description });
    return {
      textBytes:
        Buffer.byteLength(JSON.stringify(description)) * 3 +
        Buffer.byteLength(JSON.stringify(acceptance)) * 2,
    };
  }

  it('leaves the default answer as it was: every task carries both texts, as GET /tasks/:id does', async () => {
    await seed();
    const { items } = await walk('');

    expect(items).toHaveLength(5);
    for (const item of items) {
      const one = (await (await req(`/api/v1/tasks/${String(item.id)}`)).json()) as Record<
        string,
        unknown
      >;
      expect(item).toEqual(one);
      for (const field of TEXTS) expect(Object.keys(item)).toContain(field);
    }
  });

  it('drops exactly the two texts and nothing else, in the same order and on the same pages', async () => {
    await seed();
    const full = await walk('');
    const slim = await walk('&fields=slim');

    expect(slim.items.map((t) => t.id)).toEqual(full.items.map((t) => t.id));
    slim.items.forEach((item, i) => {
      const { description_md: _d, acceptance_md: _a, ...rest } = full.items[i]!;
      expect(item).toEqual(rest);
      expect(Object.keys(item)).toEqual(Object.keys(rest));
      for (const field of TEXTS) expect(Object.keys(item)).not.toContain(field);
    });
  });

  it('saves at least the bytes the texts took', async () => {
    const { textBytes } = await seed();
    const full = await walk('');
    const slim = await walk('&fields=slim');

    // Each text is gone with its key; the difference can only be larger.
    expect(full.bytes - slim.bytes).toBeGreaterThanOrEqual(textBytes);
  });

  it('is slim under the other filters too — ready, which reads in batches, and parent', async () => {
    await seed();
    for (const query of ['&fields=slim&ready=true', '&fields=slim&status=backlog&priority=p2']) {
      const { items } = await walk(query);
      expect(items.length, query).toBeGreaterThan(0);
      for (const item of items) {
        for (const field of TEXTS) expect(Object.keys(item), query).not.toContain(field);
      }
    }
    const parent = (await (
      await req('/api/v1/projects/laika/tasks?fields=slim')
    ).json()) as ListPage;
    const blocker = parent.data.find((t) => t.title === 'Blocker');
    const children = (await (
      await req(`/api/v1/projects/laika/tasks?fields=slim&parent=${String(blocker?.id)}`)
    ).json()) as ListPage;
    expect(children.data.map((t) => t.title)).toEqual(['Child']);
    for (const field of TEXTS) expect(Object.keys(children.data[0]!)).not.toContain(field);
  });

  it('refuses a value it does not know, 400 naming it, rather than answering the full shape', async () => {
    await newTask('Any');
    for (const bad of ['full', 'SLIM', 'description_md', 'title,key', 'slim,full']) {
      const res = await req(`/api/v1/projects/laika/tasks?fields=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string; details: { fields: string } };
      };
      expect(body.error.code, bad).toBe('bad_request');
      expect(body.error.details.fields, bad).toBe(bad);
      expect(body.error.message, bad).toMatch(/fields/);
    }
  });

  it('reads an empty value as absent, as every other filter here does', async () => {
    await newTask('Plain', { description_md: 'text' });
    const page = (await (await req('/api/v1/projects/laika/tasks?fields=')).json()) as ListPage;
    expect(page.data[0]?.description_md).toBe('text');
  });
});

describe("GET /api/v1/tasks — everyone's work across projects (LAI-887)", () => {
  interface Listed {
    id: string;
    key: string;
    project_id: string;
    status: string;
    assignee_id: string | null;
    sprint_id: string | null;
  }
  interface ListPage {
    data: Listed[];
    next_cursor: string | null;
  }

  /** A setup write that must land — a broken setup must not satisfy a test. */
  async function must(res: Response | Promise<Response>, expected: number): Promise<Response> {
    const answered = await res;
    expect(answered.status, await answered.clone().text()).toBe(expected);
    return answered;
  }

  async function project(slug: string, prefix: string, visibility: 'private' | 'public') {
    await must(post('/api/v1/projects', { name: slug, slug, prefix, visibility }), 201);
  }

  async function taskIn(slug: string, title: string, extra: Record<string, unknown> = {}) {
    const res = await must(post(`/api/v1/projects/${slug}/tasks`, { title, ...extra }), 201);
    return (await res.json()) as Listed;
  }

  async function page(path: string, as = cookie): Promise<ListPage> {
    const res = await must(h.app.request(path, { headers: jsonHeaders({ Cookie: as }) }), 200);
    return (await res.json()) as ListPage;
  }

  const keys = (p: ListPage) => p.data.map((t) => t.key).sort();

  /** A member of `laika` only, signed in; returns their cookie and id. */
  async function member(): Promise<{ cookie: string; id: string }> {
    const orgId = h.db.all<{ id: string }>(sql`SELECT id FROM orgs`)[0]!.id;
    const email = 'member@example.test';
    const token = seedInvite(h.db, { orgId, createdBy: ownerUserId(), email, orgRole: 'member' });
    const joined = await must(
      signUp(h.app, { email, password: PASSWORD, inviteToken: token }),
      200,
    );
    const id = h.db.select().from(users).where(eq(users.email, email)).get()!.id;
    await must(post('/api/v1/projects/laika/members', { user_id: id, role: 'member' }), 201);
    return { cookie: cookieFrom(joined), id };
  }

  it('answers tasks from every project the owner can read, in one request', async () => {
    await project('core', 'COR', 'private');
    await taskIn('laika', 'Here');
    await taskIn('core', 'There');

    expect(keys(await page('/api/v1/tasks'))).toEqual(['COR-1', 'LAI-1']);
  });

  it('answers each task in the per-project list’s shape, field for field', async () => {
    await taskIn('laika', 'Same shape', { description_md: 'body', tags: ['ui'] });

    const everyone = (await page('/api/v1/tasks')).data.find((t) => t.key === 'LAI-1');
    const perProject = (await page('/api/v1/projects/laika/tasks')).data.find(
      (t) => t.key === 'LAI-1',
    );
    expect(everyone).toBeDefined();
    expect(everyone).toEqual(perProject);

    const slim = (await page('/api/v1/tasks?fields=slim')).data.find((t) => t.key === 'LAI-1');
    const perProjectSlim = (await page('/api/v1/projects/laika/tasks?fields=slim')).data.find(
      (t) => t.key === 'LAI-1',
    );
    expect(slim).toEqual(perProjectSlim);
    expect(Object.keys(slim!)).not.toContain('description_md');
  });

  it('leaves out a private project the member is not in, by key', async () => {
    await project('secret', 'SEC', 'private');
    await taskIn('laika', 'Shared');
    await taskIn('secret', 'Hidden');
    const m = await member();

    const seen = keys(await page('/api/v1/tasks', m.cookie));
    expect(seen).toContain('LAI-1');
    expect(seen).not.toContain('SEC-1');

    // And the owner, who reads every project, sees it — so the absence above
    // is the policy and not a task that never existed.
    expect(keys(await page('/api/v1/tasks'))).toContain('SEC-1');
  });

  it('refuses ?project= naming a project the caller cannot read, as the per-project list does', async () => {
    await project('secret', 'SEC', 'private');
    await taskIn('secret', 'Hidden');
    const m = await member();

    const crossed = await h.app.request('/api/v1/tasks?project=secret', {
      headers: jsonHeaders({ Cookie: m.cookie }),
    });
    const direct = await h.app.request('/api/v1/projects/secret/tasks', {
      headers: jsonHeaders({ Cookie: m.cookie }),
    });
    expect(crossed.status).toBe(403);
    expect(crossed.status).toBe(direct.status);
    const body = (await crossed.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.code).toBe(((await direct.json()) as { error: { code: string } }).error.code);
  });

  it('404s ?project= naming no project', async () => {
    const res = await req('/api/v1/tasks?project=nowhere');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    // The project's refusal, not "No route for GET /api/v1/tasks".
    expect(body.error.message).toBe('No project with slug "nowhere"');
  });

  it('filters by project, assignee (an id or none), status and sprint', async () => {
    await project('core', 'COR', 'private');
    const me = ownerUserId();
    await taskIn('laika', 'Mine here', { assignee_id: me });
    await taskIn('laika', 'Nobody here');
    await taskIn('core', 'Mine there', { assignee_id: me, status: 'in_progress' });
    await taskIn('core', 'Nobody there');

    const sprint = (await (
      await must(
        post('/api/v1/projects/core/sprints', {
          name: 'One',
          starts_on: Date.UTC(2026, 9, 1),
          ends_on: Date.UTC(2026, 9, 14),
        }),
        201,
      )
    ).json()) as { id: string };
    const nobodyThere = (await page('/api/v1/projects/core/tasks')).data.find(
      (t) => t.key === 'COR-2',
    )!;
    await must(post(`/api/v1/sprints/${sprint.id}/tasks`, { task_ids: [nobodyThere.id] }), 200);

    expect(keys(await page('/api/v1/tasks?project=core'))).toEqual(['COR-1', 'COR-2']);
    expect(keys(await page(`/api/v1/tasks?assignee=${me}`))).toEqual(['COR-1', 'LAI-1']);
    expect(keys(await page('/api/v1/tasks?assignee=none'))).toEqual(['COR-2', 'LAI-2']);
    expect(keys(await page('/api/v1/tasks?status=in_progress'))).toEqual(['COR-1']);
    expect(keys(await page(`/api/v1/tasks?sprint=${sprint.id}`))).toEqual(['COR-2']);
    expect(keys(await page('/api/v1/tasks?sprint=none'))).toEqual(['COR-1', 'LAI-1', 'LAI-2']);
    expect(keys(await page(`/api/v1/tasks?project=laika&assignee=${me}`))).toEqual(['LAI-1']);
  });

  it('pages with the §6.3 cursor across projects, every task once', async () => {
    await project('core', 'COR', 'private');
    for (let i = 0; i < 3; i++) {
      await taskIn('laika', `L${String(i)}`);
      await taskIn('core', `C${String(i)}`);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string =
        cursor === null ? '?limit=2' : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const p = await page(`/api/v1/tasks${query}`);
      expect(p.data.length).toBeLessThanOrEqual(2);
      seen.push(...p.data.map((t) => t.key));
      cursor = p.next_cursor;
      pages++;
    } while (cursor !== null && pages < 10);

    expect(seen.sort()).toEqual(['COR-1', 'COR-2', 'COR-3', 'LAI-1', 'LAI-2', 'LAI-3']);
    expect(pages).toBe(3);
  });

  it('reads an empty filter value as absent, not as a value matching nothing', async () => {
    await project('core', 'COR', 'private');
    await taskIn('laika', 'Assigned', { assignee_id: ownerUserId() });
    await taskIn('core', 'Unassigned');

    const all = keys(await page('/api/v1/tasks'));
    expect(all).toEqual(['COR-1', 'LAI-1']);
    for (const empty of ['assignee=', 'sprint=', 'status=', 'project=', 'fields=']) {
      expect(keys(await page(`/api/v1/tasks?${empty}`)), empty).toEqual(all);
    }
    expect(keys(await page('/api/v1/tasks?assignee=&sprint=&status=&project='))).toEqual(all);
  });

  it('pages through tasks sharing one updated_at by id, every task once and in order', async () => {
    await project('core', 'COR', 'private');
    for (let i = 0; i < 4; i++) {
      await taskIn('laika', `L${String(i)}`);
      await taskIn('core', `C${String(i)}`);
    }
    // Every task on one timestamp: only the id tie-breaker orders them, and
    // every page boundary at limit=3 falls inside the tie.
    h.db.update(tasks).set({ updatedAt: 1_800_000_000_000 }).run();

    const unpaged = (await page('/api/v1/tasks?limit=200')).data.map((t) => t.id);
    expect(unpaged).toHaveLength(8);
    expect(unpaged).toEqual([...unpaged].sort());

    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string =
        cursor === null ? '?limit=3' : `?limit=3&cursor=${encodeURIComponent(cursor)}`;
      const p = await page(`/api/v1/tasks${query}`);
      walked.push(...p.data.map((t) => t.id));
      cursor = p.next_cursor;
      pages++;
    } while (cursor !== null && pages < 10);

    expect(walked).toEqual(unpaged);
    expect(pages).toBe(3);
  });

  describe('through a token', () => {
    async function mint(body: Record<string, unknown>): Promise<string> {
      const res = await must(post('/api/v1/tokens', { name: 'Agent', ...body }), 201);
      return ((await res.json()) as { secret: string }).secret;
    }

    async function asToken(secret: string, path: string): Promise<ListPage> {
      const res = await must(
        h.app.request(path, { headers: jsonHeaders({ Authorization: `Bearer ${secret}` }) }),
        200,
      );
      return (await res.json()) as ListPage;
    }

    async function projectId(slug: string): Promise<string> {
      const res = await must(req(`/api/v1/projects/${slug}`), 200);
      return ((await res.json()) as { id: string }).id;
    }

    it('a token limited to one project sees only that project’s tasks, by key', async () => {
      await project('core', 'COR', 'private');
      await taskIn('laika', 'Here');
      await taskIn('core', 'There');
      const secret = await mint({ scope: 'full', project_ids: [await projectId('laika')] });

      const seen = keys(await asToken(secret, '/api/v1/tasks'));
      expect(seen).toContain('LAI-1');
      expect(seen).not.toContain('COR-1');
      // The owner behind it reads both, so the absence is the token's scope.
      expect(keys(await page('/api/v1/tasks'))).toEqual(['COR-1', 'LAI-1']);
    });

    it('a read_only token reads it', async () => {
      await project('core', 'COR', 'private');
      await taskIn('laika', 'Here');
      await taskIn('core', 'There');
      const secret = await mint({ scope: 'read_only' });

      expect(keys(await asToken(secret, '/api/v1/tasks'))).toEqual(['COR-1', 'LAI-1']);
    });
  });

  it('refuses a bad status 400 and an unknown filter 422, rather than ignoring it', async () => {
    const status = await req('/api/v1/tasks?status=nonsense');
    expect(status.status).toBe(400);
    expect(((await status.json()) as { error: { code: string } }).error.code).toBe('bad_request');

    const unknown = await req('/api/v1/tasks?priority=p1');
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      'unprocessable',
    );
  });

  it('401s an anonymous caller', async () => {
    const res = await h.app.request('/api/v1/tasks');
    expect(res.status).toBe(401);
  });
});
