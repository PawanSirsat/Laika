import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import { activity, projects, tasks, users } from '../../../src/db/schema.ts';
import { flagStaleTasks, STALE_AFTER_MS } from '../../../src/jobs/jobs.ts';
import { MAX_TAGS_PER_TASK } from '../../../src/services/tags.ts';
import { CLAIM_PULSE, taskVersion, type TaskView } from '../../../src/services/tasks.ts';
import { backfillTaskPositions, backfillTaskTimestamps } from '../../../src/db/backfill.ts';
import { systemPrincipal } from '../../../src/policy/can.ts';
import { refreshEstimate } from '../../../src/services/estimates.ts';
import { handlePullRequest } from '../../../src/services/webhooks.ts';
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
  return (await res.json()) as {
    id: string;
    key: string;
    status: string;
    ready: boolean;
    updated_at: number;
  };
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

  /** The ETag a read hands out now, asserted so a failed read cannot pass as one. */
  async function tokenOf(id: string): Promise<string> {
    const read = await req(`/api/v1/tasks/${id}`);
    expect(read.status).toBe(200);
    const etag = read.headers.get('etag');
    // The ETag is the digest of exactly the body it came with (LAI-571).
    expect(etag).toBe(`"${taskVersion((await read.json()) as TaskView)}"`);
    return etag!;
  }

  async function ok(res: Promise<Response>): Promise<void> {
    const r = await res;
    expect(r.status, await r.clone().text()).toBeLessThan(300);
  }

  /** A guarded PATCH that must be refused, naming the version that is current. */
  async function expectStale(id: string, token: string): Promise<void> {
    const refused = await req(`/api/v1/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'If-Match': token },
      body: JSON.stringify({ title: 'Late write', tags: ['late'] }),
    });
    expect(refused.status).toBe(409);
    const error = (await refused.json()) as { error: { code: string; details: { etag: string } } };
    expect(error.error.code).toBe('conflict');
    expect(error.error.details.etag).not.toBe(token);
    expect(error.error.details.etag).toBe(await tokenOf(id));
  }

  it('refuses a stale If-Match with the current task and changes nothing', async () => {
    const task = await newTask('Original');
    const stale = await tokenOf(task.id);

    const first = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'If-Match': stale },
      body: JSON.stringify({ title: 'Current' }),
    });
    expect(first.status).toBe(200);

    const rowBefore = h.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
    const activityBefore = h.db.select().from(activity).where(eq(activity.taskId, task.id)).all();
    const refused = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'If-Match': stale },
      body: JSON.stringify({ title: 'Late write', tags: ['should-not-land'] }),
    });

    expect(refused.status).toBe(409);
    const error = (await refused.json()) as {
      error: {
        code: string;
        details: { current: { title: string; updated_at: number }; etag: string };
      };
    };
    expect(error.error.code).toBe('conflict');
    expect(error.error.details.current).toMatchObject({
      title: 'Current',
      updated_at: rowBefore?.updatedAt,
    });
    expect(error.error.details.etag).toBe(first.headers.get('etag'));
    expect(h.db.select().from(tasks).where(eq(tasks.id, task.id)).get()).toEqual(rowBefore);
    expect(h.db.select().from(activity).where(eq(activity.taskId, task.id)).all()).toEqual(
      activityBefore,
    );
    const after = await req(`/api/v1/tasks/${task.id}`);
    expect(after.status).toBe(200);
    expect(((await after.json()) as { tags: string[] }).tags).toEqual([]);
  });

  it('refuses an If-Match that is not one ETag a read sent with 400', async () => {
    const task = await newTask('Original');
    const hex = (await tokenOf(task.id)).slice(1, -1);
    for (const bad of [
      '*',
      `W/"${hex}"`,
      hex,
      `"${hex.toUpperCase()}"`,
      `"${hex}", "${hex}"`,
      '"01"',
      '"x"',
    ]) {
      const res = await req(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'If-Match': bad },
        body: JSON.stringify({ title: 'Never' }),
      });
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code, bad).toBe(
        'bad_request',
      );
    }
    const after = await req(`/api/v1/tasks/${task.id}`);
    expect(after.status).toBe(200);
    expect(((await after.json()) as { title: string }).title).toBe('Original');
  });

  it('accepts a current If-Match and returns its new validator', async () => {
    const task = await newTask('Original');
    const etag = await tokenOf(task.id);

    const patched = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'If-Match': etag },
      body: JSON.stringify({ title: 'Guarded' }),
    });

    expect(patched.status).toBe(200);
    const body = (await patched.json()) as TaskView;
    expect(body.title).toBe('Guarded');
    expect(patched.headers.get('etag')).toBe(`"${taskVersion(body)}"`);
    expect(patched.headers.get('etag')).not.toBe(etag);
    expect(await tokenOf(task.id)).toBe(patched.headers.get('etag'));
  });

  it('allows exactly one of two same-millisecond writes with one If-Match', async () => {
    const task = await newTask('Original');
    const etag = await tokenOf(task.id);
    const activityBefore = h.db
      .select()
      .from(activity)
      .where(eq(activity.taskId, task.id))
      .all().length;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(task.updated_at);

    try {
      const writes = await Promise.all(
        ['First', 'Second'].map((title) =>
          req(`/api/v1/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'If-Match': etag },
            body: JSON.stringify({ title }),
          }),
        ),
      );
      expect(writes.map((response) => response.status).sort()).toEqual([200, 409]);

      const success = writes.find((response) => response.status === 200)!;
      const conflict = writes.find((response) => response.status === 409)!;
      const winner = (await success.json()) as TaskView;
      const loser = (await conflict.json()) as {
        error: { code: string; details: { current: TaskView; etag: string } };
      };
      expect(loser.error.code).toBe('conflict');
      expect(loser.error.details.current).toEqual(winner);
      expect(loser.error.details.etag).toBe(success.headers.get('etag'));
      expect(h.db.select().from(activity).where(eq(activity.taskId, task.id)).all().length).toBe(
        activityBefore + 1,
      );
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps an unguarded PATCH as it was, and still makes an earlier token stale', async () => {
    const task = await newTask('Original');
    const token = await tokenOf(task.id);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(task.updated_at);

    try {
      const patched = await req(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Unguarded' }),
      });
      expect(patched.status).toBe(200);
      // `updated_at` is the time of the last edit, unchanged by LAI-571, so in
      // the millisecond it was read it does not move, and the version still does.
      expect(await patched.json()).toMatchObject({
        title: 'Unguarded',
        updated_at: task.updated_at,
      });
      await expectStale(task.id, token);
    } finally {
      clock.mockRestore();
    }
  });

  // The first review's reproduction, exactly: read T, a tags-only update, then
  // a conditional PATCH with T. Tags live in `task_tags`, not on the row.
  it('refuses an If-Match read before a tags-only update', async () => {
    const task = await newTask('Original');
    const token = await tokenOf(task.id);

    const tagged = await req(`/api/v1/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags: ['kept'] }),
    });
    expect(tagged.status).toBe(200);
    expect(((await tagged.json()) as { tags: string[] }).tags).toEqual(['kept']);

    await expectStale(task.id, token);
    const after = (await (await req(`/api/v1/tasks/${task.id}`)).json()) as {
      title: string;
      tags: string[];
    };
    expect(after).toMatchObject({ title: 'Original', tags: ['kept'] });
  });

  // Round 3's first reproduction: a prefix rename committed by another
  // connection after `requireTask` read the project and before `BEGIN
  // IMMEDIATE`. The spy runs the rename at exactly that point.
  it('refuses a token whose key a prefix rename changed just before the write', async () => {
    const task = await newTask('Original');
    const token = await tokenOf(task.id);
    expect(task.key).toBe('LAI-' + task.key.split('-')[1]);
    const begin = h.db.transaction.bind(h.db);
    const spy = vi
      .spyOn(h.db, 'transaction')
      .mockImplementationOnce((...args: Parameters<typeof h.db.transaction>) => {
        h.db.update(projects).set({ prefix: 'NEW' }).run();
        return begin(...args);
      });
    try {
      const refused = await req(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'If-Match': token },
        body: JSON.stringify({ title: 'Late write' }),
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(refused.status).toBe(409);
      const error = (await refused.json()) as {
        error: { details: { current: { key: string; title: string }; etag: string } };
      };
      expect(error.error.details.current).toMatchObject({
        key: `NEW-${task.key.split('-')[1]!}`,
        title: 'Original',
      });
      expect(error.error.details.etag).toBe(await tokenOf(task.id));
    } finally {
      spy.mockRestore();
    }
  });

  describe('list rows carry the ETag a read of the task sends', () => {
    const LISTS = {
      'GET /projects/:slug/tasks': '/api/v1/projects/laika/tasks',
      'GET /tasks': '/api/v1/tasks',
    };

    for (const [name, path] of Object.entries(LISTS)) {
      for (const slim of [false, true]) {
        it(`${name}${slim ? '?fields=slim' : ''}: each row's etag is its GET's`, async () => {
          const a = await newTask('A', { tags: ['x'] });
          const b = await newTask('B');
          await ok(post(`/api/v1/tasks/${a.id}/dependencies`, { blocked_by_task_id: b.id }));
          await ok(post(`/api/v1/tasks/${b.id}/comments`, { body_md: 'hi' }));
          const res = await req(`${path}${slim ? '?fields=slim' : ''}`);
          expect(res.status).toBe(200);
          const rows = ((await res.json()) as { data: { id: string; etag: string }[] }).data;
          expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
          for (const row of rows) expect(row.etag, row.id).toBe(await tokenOf(row.id));
        });
      }
    }

    it("a slim row's etag guards a PATCH: current is 200, then stale is 409", async () => {
      const task = await newTask('Original');
      const res = await req('/api/v1/projects/laika/tasks?fields=slim');
      expect(res.status).toBe(200);
      const row = ((await res.json()) as { data: { id: string; etag: string }[] }).data.find(
        (r) => r.id === task.id,
      )!;
      expect(row).not.toHaveProperty('description_md');

      const guarded = await req(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'If-Match': row.etag },
        body: JSON.stringify({ title: 'From the list' }),
      });
      expect(guarded.status).toBe(200);
      await expectStale(task.id, row.etag);
    });
  });

  /**
   * **Every writer the two reviews named, and every one the codebase has** — each
   * in the millisecond the token was read, so nothing here leans on the clock.
   * A scenario sets up, names the task whose token it watches, and writes. The
   * ones a route cannot reach cheaply (a job, a backfill, offboarding, a
   * heartbeat, the GitHub webhook) write the column that writer writes, by the
   * same Drizzle statement shape, and say which writer they stand for.
   */
  describe('every write that changes a read makes an earlier token stale', () => {
    type Made = Awaited<ReturnType<typeof newTask>>;
    interface Setup {
      watch: string;
      write: () => Promise<void> | void;
    }
    type Scenario = (task: Made, other: Made) => Setup | Promise<Setup>;

    const patch = (id: string, body: unknown) =>
      ok(req(`/api/v1/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }));
    const del = (path: string) => ok(req(path, { method: 'DELETE' }));
    async function newSprint(): Promise<string> {
      const res = await post('/api/v1/projects/laika/sprints', {
        name: `S-${newId()}`,
        starts_on: Date.UTC(2027, 0, 1),
        ends_on: Date.UTC(2027, 0, 14),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    }
    const raw = (id: string, set: Partial<typeof tasks.$inferInsert>) => () => {
      expect(h.db.update(tasks).set(set).where(eq(tasks.id, id)).run().changes).toBe(1);
    };

    const SCENARIOS: Record<string, Scenario> = {
      'PATCH: tags only': (t) => ({ watch: t.id, write: () => patch(t.id, { tags: ['x'] }) }),
      'PATCH: size only': (t) => ({ watch: t.id, write: () => patch(t.id, { size: 'XL' }) }),
      'PATCH: a field': (t) => ({
        watch: t.id,
        write: () => patch(t.id, { priority: 'p1' }),
      }),
      'dependency added: the blocked task': (t, o) => ({
        watch: t.id,
        write: () => ok(post(`/api/v1/tasks/${t.id}/dependencies`, { blocked_by_task_id: o.id })),
      }),
      'dependency added: the blocker (blocks)': (t, o) => ({
        watch: t.id,
        write: () => ok(post(`/api/v1/tasks/${o.id}/dependencies`, { blocked_by_task_id: t.id })),
      }),
      'dependency removed: the blocked task': async (t, o) => {
        await ok(post(`/api/v1/tasks/${t.id}/dependencies`, { blocked_by_task_id: o.id }));
        return { watch: t.id, write: () => del(`/api/v1/tasks/${t.id}/dependencies/${o.id}`) };
      },
      'dependency removed: the blocker (blocks)': async (t, o) => {
        await ok(post(`/api/v1/tasks/${o.id}/dependencies`, { blocked_by_task_id: t.id }));
        return { watch: t.id, write: () => del(`/api/v1/tasks/${o.id}/dependencies/${t.id}`) };
      },
      "a blocker's status: the dependent's ready": async (t, o) => {
        await ok(post(`/api/v1/tasks/${t.id}/dependencies`, { blocked_by_task_id: o.id }));
        return {
          watch: t.id,
          write: () => ok(post(`/api/v1/tasks/${o.id}/status`, { status: 'done' })),
        };
      },
      'status change': (t) => ({
        watch: t.id,
        write: () => ok(post(`/api/v1/tasks/${t.id}/status`, { status: 'todo' })),
      }),
      'sent back from review': async (t) => {
        await ok(post(`/api/v1/tasks/${t.id}/status`, { status: 'in_progress' }));
        await ok(post(`/api/v1/tasks/${t.id}/status`, { status: 'review' }));
        return {
          watch: t.id,
          write: () => ok(post(`/api/v1/tasks/${t.id}/send-back`, { reason: 'Not yet' })),
        };
      },
      claim: (t) => ({
        watch: t.id,
        write: () => ok(post(`/api/v1/tasks/${t.id}/claim`, {})),
      }),
      reorder: (t, o) => ({
        watch: t.id,
        write: () => ok(post(`/api/v1/tasks/${t.id}/reorder`, { before_task_id: o.id })),
      }),
      'sprint: joined': async (t) => {
        const sprint = await newSprint();
        return {
          watch: t.id,
          write: () => ok(post(`/api/v1/sprints/${sprint}/tasks`, { task_ids: [t.id] })),
        };
      },
      'sprint: removed from': async (t) => {
        const sprint = await newSprint();
        await ok(post(`/api/v1/sprints/${sprint}/tasks`, { task_ids: [t.id] }));
        return { watch: t.id, write: () => del(`/api/v1/sprints/${sprint}/tasks/${t.id}`) };
      },
      'sprint: deleted (ON DELETE SET NULL)': async (t) => {
        const sprint = await newSprint();
        await ok(post(`/api/v1/sprints/${sprint}/tasks`, { task_ids: [t.id] }));
        return { watch: t.id, write: () => del(`/api/v1/sprints/${sprint}`) };
      },
      'tag: renamed': async (t) => {
        await patch(t.id, { tags: ['old'] });
        return {
          watch: t.id,
          write: () =>
            ok(
              req('/api/v1/projects/laika/tags/old', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'new' }),
              }),
            ),
        };
      },
      'tag: merged into another': async (t, o) => {
        await patch(t.id, { tags: ['old'] });
        await patch(o.id, { tags: ['survivor'] });
        return {
          watch: t.id,
          write: () =>
            ok(
              req('/api/v1/projects/laika/tags/old', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'survivor' }),
              }),
            ),
        };
      },
      'tag: deleted (cascade)': async (t) => {
        await patch(t.id, { tags: ['doomed'] });
        return { watch: t.id, write: () => del('/api/v1/projects/laika/tags/doomed') };
      },
      'comment: added': (t) => ({
        watch: t.id,
        write: () => ok(post(`/api/v1/tasks/${t.id}/comments`, { body_md: 'hello' })),
      }),
      'comment: deleted': async (t) => {
        const res = await post(`/api/v1/tasks/${t.id}/comments`, { body_md: 'bye' });
        expect(res.status).toBe(201);
        const { id } = (await res.json()) as { id: string };
        return { watch: t.id, write: () => del(`/api/v1/comments/${id}`) };
      },
      'subtask added: the parent': (t) => ({
        watch: t.id,
        write: async () => {
          await newTask('Child', { parent_task_id: t.id });
        },
      }),
      'job: stale flag (jobs.ts)': async (t) => {
        await ok(post(`/api/v1/tasks/${t.id}/claim`, {}));
        raw(t.id, { updatedAt: 1 })();
        return {
          watch: t.id,
          write: () => {
            expect(flagStaleTasks(h.db, t.updated_at + STALE_AFTER_MS + 1).changed).toBe(1);
          },
        };
      },
      'backfill: positions (backfill.ts)': (t) => {
        raw(t.id, { position: null })();
        return {
          watch: t.id,
          write: () => {
            expect(backfillTaskPositions(h.db)).toBeGreaterThan(0);
          },
        };
      },
      'backfill: started_at / completed_at (backfill.ts)': async (t) => {
        // A task whose history says it started, with the column lost, as a
        // database from before the column had it.
        await ok(post(`/api/v1/tasks/${t.id}/status`, { status: 'in_progress' }));
        raw(t.id, { startedAt: null })();
        return {
          watch: t.id,
          write: () => {
            expect(backfillTaskTimestamps(h.db).startedAt).toBeGreaterThan(0);
          },
        };
      },
      'estimate recompute (estimates.ts)': (t) => {
        raw(t.id, { estimateId: null })();
        return {
          watch: t.id,
          write: () => {
            expect(refreshEstimate(h.db, t.id, Date.now())).toBe(true);
          },
        };
      },
      'offboarding reassign (offboarding.ts)': async (t) => {
        const orgId = h.db.all<{ id: string }>(sql`SELECT id FROM orgs`)[0]!.id;
        const email = `leaver-${newId().toLowerCase()}@example.test`;
        const invite = seedInvite(h.db, {
          orgId,
          createdBy: ownerUserId(),
          email,
          orgRole: 'member',
        });
        const joined = await signUp(h.app, { email, password: PASSWORD, inviteToken: invite });
        expect(joined.status).toBe(200);
        const leaver = h.db.select().from(users).where(eq(users.email, email)).get()!.id;
        await ok(post('/api/v1/projects/laika/members', { user_id: leaver, role: 'member' }));
        await patch(t.id, { assignee_id: leaver });
        return {
          watch: t.id,
          write: () =>
            ok(
              req(`/api/v1/projects/laika/members/${leaver}`, {
                method: 'DELETE',
                body: JSON.stringify({ open_tasks: { reassign_to: ownerUserId() } }),
              }),
            ),
        };
      },
      'heartbeat branch (heartbeats.ts)': async (t) => {
        h.db.update(projects).set({ repo: 'kvell/laika' }).run();
        const minted = await post('/api/v1/tokens', { name: 'agent', scope: 'full' });
        expect(minted.status).toBe(201);
        const { secret } = (await minted.json()) as { secret: string };
        return {
          watch: t.id,
          write: async () => {
            const beat = await h.app.request('/api/v1/heartbeats', {
              method: 'POST',
              headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
              body: JSON.stringify({
                repo: 'kvell/laika',
                branch: `${t.key.toLowerCase()}-from-a-heartbeat`,
              }),
            });
            expect(beat.status).toBe(202);
          },
        };
      },
      'webhook pull request (webhooks.ts)': (t) => {
        h.db.update(projects).set({ repo: 'kvell/laika' }).run();
        return {
          watch: t.id,
          write: () => {
            const outcome = handlePullRequest(
              h.db,
              {
                action: 'opened',
                repository: { full_name: 'kvell/laika' },
                pull_request: { head: { ref: `${t.key.toLowerCase()}-a-pr` }, number: 7 },
              },
              (projectId) => systemPrincipal(projectId),
              Date.now(),
            );
            expect(outcome.handled, JSON.stringify(outcome)).toBe(true);
          },
        };
      },
    };

    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      it(name, async () => {
        const other = await newTask('Other');
        const task = await newTask('Original');
        const { watch, write } = await scenario(task, other);
        const token = await tokenOf(watch);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
        try {
          await write();
          await expectStale(watch, token);
        } finally {
          clock.mockRestore();
        }
      });
    }

    /**
     * **Every table that references a task, read from the schema**, says whether
     * a task read shows it and, if so, which scenario above proves its writes
     * move the version. A new table pointing at `tasks` fails here until
     * someone decides.
     */
    const REFERENCING: Record<
      string,
      { shown: string[] } | { not_shown: string } | { shown_by_test: string }
    > = {
      'task_tags.task_id': {
        shown: [
          'PATCH: tags only',
          'tag: renamed',
          'tag: merged into another',
          'tag: deleted (cascade)',
        ],
      },
      'task_dependencies.task_id': {
        shown: [
          'dependency added: the blocked task',
          'dependency removed: the blocked task',
          "a blocker's status: the dependent's ready",
        ],
      },
      'task_dependencies.depends_on_task_id': {
        shown: [
          'dependency added: the blocker (blocks)',
          'dependency removed: the blocker (blocks)',
        ],
      },
      'comments.task_id': { shown: ['comment: added', 'comment: deleted'] },
      'task_estimates.task_id': {
        shown: ['PATCH: size only', 'estimate recompute (estimates.ts)'],
      },
      'tasks.parent_task_id': { shown: ['subtask added: the parent'] },
      'task_reviews.task_id': { shown: ['sent back from review'] },
      'activity.task_id': {
        not_shown:
          'a read shows only the creating row (`created_by_client`), written once at create',
      },
      // Shown as `claim` (LAI-568). Who holds it moves the version; its pulse
      // does not, and that is the test below.
      'task_claims.task_id': {
        shown_by_test: 'moves the version when the claim changes hands, not when it beats',
      },
      'task_claim_estimates.task_id': {
        not_shown: 'the claimant’s own estimate, read by the estimate endpoint only',
      },
      // A finish opens a round and a send-back closes it; `send_back` reads
      // the open send-back from it (rounds.ts).
      'task_rounds.task_id': { shown: ['sent back from review'] },
      'task_watchers.task_id': { not_shown: 'per person, read through /me/watching' },
      'heartbeats.matched_task_id': { not_shown: 'presence, not the task' },
      'unlisted_work.promoted_task_id': { not_shown: 'read from the unlisted entry, not the task' },
      'handoff_offers.task_id': { not_shown: 'read by the hand-off inbox' },
      'token_usage_days.task_id': { not_shown: 'usage figures have their own endpoints' },
      'token_session_tasks.task_id': { not_shown: 'usage figures have their own endpoints' },
      'token_alerts.task_id': { not_shown: 'usage figures have their own endpoints' },
      'token_budgets.task_id': { not_shown: 'usage figures have their own endpoints' },
      'time_drafts.task_id': { not_shown: 'time tracking, per person' },
      'time_entries.task_id': { not_shown: 'time tracking, per person' },
      'time_timers.task_id': { not_shown: 'time tracking, per person' },
      'solidtime_entries.task_id': { not_shown: 'time tracking, per person' },
    };

    it('classifies every table that references a task (schema census)', () => {
      const found = (
        h.t.sqlite
          .prepare(
            `SELECT m.name AS tbl, f."from" AS col
               FROM sqlite_master m, pragma_foreign_key_list(m.name) f
              WHERE m.type = 'table' AND f."table" = 'tasks'`,
          )
          .all() as { tbl: string; col: string }[]
      ).map((r) => `${r.tbl}.${r.col}`);
      expect(found.length).toBeGreaterThan(10);
      expect([...found].sort()).toEqual(Object.keys(REFERENCING).sort());
      for (const entry of Object.values(REFERENCING)) {
        if ('shown' in entry)
          for (const s of entry.shown) expect(Object.keys(SCENARIOS)).toContain(s);
        if ('shown_by_test' in entry) expect(OWN_TESTS).toContain(entry.shown_by_test);
      }
    });

    const OWN_TESTS = ['moves the version when the claim changes hands, not when it beats'];

    it(OWN_TESTS[0]!, async () => {
      const task = await newTask('Original');
      const view = (await (await req(`/api/v1/tasks/${task.id}`)).json()) as TaskView;
      const claim: NonNullable<TaskView['claim']> = {
        generation: 1,
        state: 'active',
        agent_id: 'agent-1',
        session_id: 'session-1',
        lease_expires_at: 1_000,
        last_heartbeat_at: 500,
        connection: 'live',
        suspect_after_ms: 90_000,
        device_label: 'laptop-1',
      };
      const held = taskVersion({ ...view, claim });
      expect(held).not.toBe(taskVersion(view));

      // The pulse: a heartbeat renews the lease, and the clock makes it suspect.
      const beat = { last_heartbeat_at: 9_000, lease_expires_at: 99_000, connection: 'suspect' };
      expect([...CLAIM_PULSE].sort()).toEqual(Object.keys(beat).sort());
      expect(taskVersion({ ...view, claim: { ...claim, ...beat } as typeof claim })).toBe(held);

      // Who holds it, and how.
      for (const change of [
        { generation: 2 },
        { state: 'paused' },
        { agent_id: 'agent-2' },
        { session_id: 'session-2' },
        { device_label: 'laptop-2' },
      ]) {
        const moved = taskVersion({ ...view, claim: { ...claim, ...change } as typeof claim });
        expect(moved, JSON.stringify(change)).not.toBe(held);
      }
    });

    it('moves the version for a change to any field of the view', async () => {
      const task = await newTask('Original');
      const view = (await (await req(`/api/v1/tasks/${task.id}`)).json()) as Record<
        string,
        unknown
      >;
      const keys = Object.keys(view);
      expect(keys).toContain('comment_count');
      const base = taskVersion(view as unknown as TaskView);
      for (const key of keys) {
        const changed = { ...view, [key]: { changed: view[key] } };
        expect(taskVersion(changed as unknown as TaskView), key).not.toBe(base);
      }
    });
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
      const read = await req(`/api/v1/tasks/${String(item.id)}`);
      const one = (await read.json()) as Record<string, unknown>;
      // A row is the task's GET body plus that GET's ETag, as `etag` (LAI-571).
      expect(item).toEqual({ ...one, etag: read.headers.get('etag') });
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
    updated_at: number;
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
    const TIED = 1_800_000_000_000;
    const forced = h.db.update(tasks).set({ updatedAt: TIED }).run();
    expect(forced.changes).toBe(8);

    const unpagedRows = (await page('/api/v1/tasks?limit=200')).data;
    expect(unpagedRows.map((t) => t.updated_at)).toEqual(Array<number>(8).fill(TIED));
    const unpaged = unpagedRows.map((t) => t.id);
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

describe('GET /api/v1/tasks/summary — the figures for what /tasks pages through (LAI-974)', () => {
  interface Listed {
    id: string;
    key: string;
    status: string;
    assignee_id: string | null;
    due_on: number | null;
    blocked_by: string[];
  }
  interface ListPage {
    data: Listed[];
    next_cursor: string | null;
  }
  interface Summary {
    total: number;
    by_status: Record<string, number>;
    by_assignee: { user_id: string | null; name: string; count: number }[];
    overdue: number;
    blocked: number;
    unassigned: number;
  }

  const OPEN = ['backlog', 'todo', 'in_progress', 'review'];
  const PAST = Date.UTC(2020, 0, 1);
  const FUTURE = Date.UTC(2099, 0, 1);

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

  /** Move a task past §5's transitions: a fixture, asserted to have landed. */
  function force(id: string, status: 'done' | 'cancelled') {
    // `tasks_status_fk` holds `status` to `status_id`, so both move together.
    const statusId = h.db.all<{ id: string }>(
      sql`SELECT s.id FROM project_statuses s JOIN tasks t ON t.project_id = s.project_id
           WHERE t.id = ${id} AND s.category = ${status} ORDER BY s.position LIMIT 1`,
    )[0]!.id;
    expect(h.db.update(tasks).set({ status, statusId }).where(eq(tasks.id, id)).run().changes).toBe(
      1,
    );
  }

  async function blocks(blocker: Listed, blocked: Listed) {
    await must(
      post(`/api/v1/tasks/${blocked.id}/dependencies`, { blocked_by_task_id: blocker.id }),
      201,
    );
  }

  function headers(as: string): Record<string, string> {
    return as.startsWith('Bearer ') ? { Authorization: as } : { Cookie: as };
  }

  async function summary(query = '', as = cookie): Promise<Summary> {
    const res = await must(
      h.app.request(`/api/v1/tasks/summary${query}`, { headers: jsonHeaders(headers(as)) }),
      200,
    );
    return (await res.json()) as Summary;
  }

  /** `/tasks` walked to the end at `limit` a page; returns the rows and the page count. */
  async function walk(query = '', as = cookie, limit = 2) {
    const rows: Listed[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const sep = query === '' ? '?' : `${query}&`;
      const path: string =
        cursor === null
          ? `/api/v1/tasks${sep}limit=${String(limit)}`
          : `/api/v1/tasks${sep}limit=${String(limit)}&cursor=${encodeURIComponent(cursor)}`;
      const res = await must(h.app.request(path, { headers: jsonHeaders(headers(as)) }), 200);
      const p = (await res.json()) as ListPage;
      rows.push(...p.data);
      cursor = p.next_cursor;
      pages++;
    } while (cursor !== null && pages < 100);
    return { rows, pages };
  }

  /**
   * The figures counted on the client from a full walk — the answer the
   * summary has to agree with. `statusOf` reads every task (the owner's walk),
   * because a blocker need not match the filter for its task to be blocked.
   */
  function countWalk(rows: Listed[], statusOf: Map<string, string>) {
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const byStatus: Record<string, number> = Object.fromEntries(
      ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'].map((s) => [s, 0]),
    );
    const byAssignee = new Map<string | null, number>();
    for (const t of rows) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byAssignee.set(t.assignee_id, (byAssignee.get(t.assignee_id) ?? 0) + 1);
    }
    const open = rows.filter((t) => OPEN.includes(t.status));
    return {
      total: rows.length,
      by_status: byStatus,
      by_assignee: byAssignee,
      overdue: open.filter((t) => t.due_on !== null && t.due_on < today).length,
      blocked: open.filter((t) => t.blocked_by.some((id) => statusOf.get(id) !== 'done')).length,
      unassigned: byAssignee.get(null) ?? 0,
    };
  }

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

  /**
   * Two projects, every status, an overdue and a not-yet-due task, open and
   * closed ones past due, a task blocked by an open task, one by a done task
   * (not blocked), one by a cancelled task (blocked — §4.5 needs `done`), and a
   * closed task with an open blocker (not counted).
   */
  async function seed() {
    await project('core', 'COR', 'private');
    const me = ownerUserId();
    const m = await member();

    const a = await taskIn('laika', 'A', { assignee_id: me, due_on: PAST });
    const b = await taskIn('laika', 'B', { status: 'todo', due_on: FUTURE });
    const c = await taskIn('laika', 'C', { assignee_id: m.id, status: 'in_progress' });
    const d = await taskIn('laika', 'D', { status: 'review', due_on: PAST });
    const e = await taskIn('laika', 'E', { due_on: PAST });
    const f = await taskIn('core', 'F', { assignee_id: me });
    const g = await taskIn('core', 'G');
    const x = await taskIn('core', 'X');
    const y = await taskIn('core', 'Y', { assignee_id: me });
    force(e.id, 'done');
    force(x.id, 'done');
    force(y.id, 'cancelled');

    await blocks(c, a); //    open blocker      → A blocked
    await blocks(x, b); //    done blocker      → B not blocked
    await blocks(y, f); //    cancelled blocker → F blocked
    await blocks(g, e); //    E is done         → not counted
    await blocks(g, d); //    open blocker      → D blocked
    await blocks(x, d); //    D twice over is still one blocked task

    return { me, m };
  }

  it('answers the shape the Work page builds against, with the seeded figures', async () => {
    const { me, m } = await seed();
    const s = await summary();

    expect(Object.keys(s).sort()).toEqual(
      ['blocked', 'by_assignee', 'by_status', 'overdue', 'total', 'unassigned'].sort(),
    );
    expect(s.total).toBe(9);
    expect(s.by_status).toEqual({
      backlog: 3,
      todo: 1,
      in_progress: 1,
      review: 1,
      done: 2,
      cancelled: 1,
    });
    // A and D are open and past due; E is past due and done.
    expect(s.overdue).toBe(2);
    // A, D and F. Not B (done blocker), not E (done itself).
    expect(s.blocked).toBe(3);
    expect(s.unassigned).toBe(5);
    expect(s.by_assignee).toEqual([
      { user_id: null, name: 'Unassigned', count: 5 },
      { user_id: me, name: 'Ada', count: 3 },
      { user_id: m.id, name: expect.any(String) as string, count: 1 },
    ]);
  });

  it('agrees with walking /tasks to the end, for every filter', async () => {
    const { me, m } = await seed();
    const everything = (await walk()).rows;
    const statusOf = new Map(everything.map((t) => [t.id, t.status]));
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
    const inSprint = everything.filter((t) => t.key === 'COR-1' || t.key === 'COR-2');
    await must(
      post(`/api/v1/sprints/${sprint.id}/tasks`, { task_ids: inSprint.map((t) => t.id) }),
      200,
    );

    for (const query of [
      '',
      '?project=core',
      '?project=laika',
      '?assignee=none',
      `?assignee=${me}`,
      `?assignee=${m.id}`,
      '?status=backlog',
      '?status=done',
      `?sprint=${sprint.id}`,
      '?sprint=none',
      `?project=laika&assignee=none&sprint=none`,
      '?updated_since=0',
    ]) {
      const { rows, pages } = await walk(query);
      const expected = countWalk(rows, statusOf);
      const s = await summary(query);

      expect(s.total, query).toBe(expected.total);
      expect(s.by_status, query).toEqual(expected.by_status);
      expect(s.overdue, query).toBe(expected.overdue);
      expect(s.blocked, query).toBe(expected.blocked);
      expect(s.unassigned, query).toBe(expected.unassigned);
      expect(new Map(s.by_assignee.map((r) => [r.user_id, r.count])), query).toEqual(
        expected.by_assignee,
      );
      if (query === '') expect(pages).toBeGreaterThanOrEqual(3);
    }
  });

  it('leaves out a private project the member cannot read, by count and by key', async () => {
    await project('secret', 'SEC', 'private');
    await taskIn('laika', 'Shared');
    // Every figure would move if this one counted: it is overdue and blocked.
    const hiddenBlocker = await taskIn('secret', 'Blocker');
    const hidden = await taskIn('secret', 'Hidden', { due_on: PAST, assignee_id: ownerUserId() });
    await blocks(hiddenBlocker, hidden);
    const m = await member();

    const theirs = await summary('', m.cookie);
    expect(theirs).toEqual({
      total: 1,
      by_status: { backlog: 1, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
      by_assignee: [{ user_id: null, name: 'Unassigned', count: 1 }],
      overdue: 0,
      blocked: 0,
      unassigned: 1,
    });
    // And their walk agrees: SEC-2 is not on it.
    expect((await walk('', m.cookie)).rows.map((t) => t.key)).toEqual(['LAI-1']);

    // The owner, who reads every project, counts it — so the absence above is
    // the policy and not a task that never existed.
    const owners = await summary();
    expect(owners.total).toBe(3);
    expect(owners.overdue).toBe(1);
    expect(owners.blocked).toBe(1);
    expect(owners.by_assignee).toContainEqual({ user_id: ownerUserId(), name: 'Ada', count: 1 });
  });

  it('refuses ?project= the caller cannot read 403 and an unknown slug 404, as /tasks does', async () => {
    await project('secret', 'SEC', 'private');
    const m = await member();

    const crossed = await h.app.request('/api/v1/tasks/summary?project=secret', {
      headers: jsonHeaders({ Cookie: m.cookie }),
    });
    expect(crossed.status).toBe(403);
    expect(((await crossed.json()) as { error: { code: string } }).error.code).toBe('forbidden');

    const missing = await req('/api/v1/tasks/summary?project=nowhere');
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toBe('No project with slug "nowhere"');
  });

  it('a token limited to one project counts only that project, by count and by key', async () => {
    await project('core', 'COR', 'private');
    await taskIn('laika', 'Here');
    await taskIn('core', 'There', { due_on: PAST });
    const laikaId = (
      (await (await must(req('/api/v1/projects/laika'), 200)).json()) as { id: string }
    ).id;
    const res = await must(
      post('/api/v1/tokens', { name: 'Agent', scope: 'full', project_ids: [laikaId] }),
      201,
    );
    const bearer = `Bearer ${((await res.json()) as { secret: string }).secret}`;

    const s = await summary('', bearer);
    expect(s.total).toBe(1);
    expect(s.overdue).toBe(0);
    expect((await walk('', bearer)).rows.map((t) => t.key)).toEqual(['LAI-1']);
    // The owner behind it reads both — the absence is the token's scope.
    expect((await summary()).total).toBe(2);
    expect((await summary()).overdue).toBe(1);
  });

  it('puts the top ten by count first, then one "others" entry for the rest', async () => {
    // Twelve people seeded as rows, not signed up: twelve password hashes are
    // what made this slow, and nothing here reads a session of theirs.
    const people: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = newId();
      const now = new Date();
      h.db
        .insert(users)
        .values({
          id,
          email: `p${String(i)}@example.test`,
          name: `P${String(i)}`,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      await must(post('/api/v1/projects/laika/members', { user_id: id, role: 'member' }), 201);
      people.push(id);
    }
    // Person i holds i + 1 tasks: p11 has 12 … p0 has 1; plus 2 unassigned.
    for (const [i, id] of people.entries()) {
      for (let n = 0; n <= i; n++)
        await taskIn('laika', `t${String(i)}-${String(n)}`, { assignee_id: id });
    }
    await taskIn('laika', 'loose 1');
    await taskIn('laika', 'loose 2');

    const s = await summary();
    expect(s.total).toBe(78 + 2);
    expect(s.unassigned).toBe(2);
    expect(s.by_assignee).toHaveLength(11);
    expect(s.by_assignee.slice(0, 10).map((r) => [r.user_id, r.count])).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((i) => [people[i], i + 1]),
    );
    // The rest: p1 (2), p0 (1) and the two unassigned.
    expect(s.by_assignee[10]).toEqual({ user_id: 'others', name: 'Others', count: 5 });
    expect(s.by_assignee.reduce((sum, r) => sum + r.count, 0)).toBe(s.total);
  });

  it('refuses a bad status 400 and an unknown or paging key 422, rather than ignoring it', async () => {
    const status = await req('/api/v1/tasks/summary?status=nonsense');
    expect(status.status).toBe(400);
    expect(((await status.json()) as { error: { code: string } }).error.code).toBe('bad_request');

    for (const key of ['priority=p1', 'ready=true', 'limit=10', 'cursor=x', 'fields=slim']) {
      const unknown = await req(`/api/v1/tasks/summary?${key}`);
      expect(unknown.status, key).toBe(422);
      expect(((await unknown.json()) as { error: { code: string } }).error.code, key).toBe(
        'unprocessable',
      );
    }
  });

  it('reads an empty filter value as absent and answers zeros for nothing', async () => {
    const empty = await summary('?assignee=&sprint=&status=&project=');
    expect(empty).toEqual({
      total: 0,
      by_status: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
      by_assignee: [],
      overdue: 0,
      blocked: 0,
      unassigned: 0,
    });
  });

  it('401s an anonymous caller', async () => {
    const res = await h.app.request('/api/v1/tasks/summary');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });
});

describe('an assignee must be able to read the project (LAI-962)', () => {
  interface Refusal {
    error: { code: string; details: Record<string, unknown> };
  }

  /** A setup write that must land — a broken setup must not satisfy a test. */
  async function must(res: Response | Promise<Response>, expected: number): Promise<Response> {
    const answered = await res;
    expect(answered.status, await answered.clone().text()).toBe(expected);
    return answered;
  }

  /** Somebody in the org who is on no project; returns their id. */
  async function outsider(email: string, orgRole: 'member' | 'admin' = 'member'): Promise<string> {
    const orgId = h.db.all<{ id: string }>(sql`SELECT id FROM orgs`)[0]!.id;
    const token = seedInvite(h.db, { orgId, createdBy: ownerUserId(), email, orgRole });
    await must(signUp(h.app, { email, password: PASSWORD, inviteToken: token }), 200);
    return h.db.select().from(users).where(eq(users.email, email)).get()!.id;
  }

  async function secret(): Promise<void> {
    await must(
      post('/api/v1/projects', {
        name: 'secret',
        slug: 'secret',
        prefix: 'SEC',
        visibility: 'private',
      }),
      201,
    );
  }

  function assigneeOf(key: string): string | null | undefined {
    const number = Number(key.split('-')[1]);
    return h.db.all<{ assignee_id: string | null }>(
      sql`SELECT t.assignee_id FROM tasks t JOIN projects p ON p.id = t.project_id
            WHERE p.prefix = ${key.split('-')[0]} AND t.number = ${number}`,
    )[0]?.assignee_id;
  }

  it('refuses to create SEC-1 assigned to somebody who cannot read secret, and files nothing', async () => {
    await secret();
    const stranger = await outsider('stranger@example.test');

    const res = await post('/api/v1/projects/secret/tasks', {
      title: 'Not theirs',
      assignee_id: stranger,
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as Refusal).error).toMatchObject({
      code: 'unprocessable',
      details: { field: 'assignee_id', reason: 'not_on_project', assignee_id: stranger },
    });
    expect(assigneeOf('SEC-1')).toBeUndefined();
  });

  it('refuses to reassign SEC-1 to them, and leaves its assignee as it was', async () => {
    await secret();
    const stranger = await outsider('stranger@example.test');
    const created = (await (
      await must(
        post('/api/v1/projects/secret/tasks', { title: 'Mine', assignee_id: ownerUserId() }),
        201,
      )
    ).json()) as { id: string; key: string };
    expect(created.key).toBe('SEC-1');

    const res = await req(`/api/v1/tasks/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed', assignee_id: stranger }),
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as Refusal).error).toMatchObject({
      code: 'unprocessable',
      details: { field: 'assignee_id', reason: 'not_on_project', assignee_id: stranger },
    });
    expect(assigneeOf('SEC-1')).toBe(ownerUserId());
  });

  it('refuses an id that names nobody with the same code, not a 500', async () => {
    await secret();

    const res = await post('/api/v1/projects/secret/tasks', {
      title: 'Nobody',
      assignee_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as Refusal).error).toMatchObject({
      code: 'unprocessable',
      details: { field: 'assignee_id', reason: 'not_on_project' },
    });
  });

  it('assigns SEC-1 to them once they are a member', async () => {
    await secret();
    const stranger = await outsider('stranger@example.test');
    await must(post('/api/v1/projects/secret/members', { user_id: stranger, role: 'member' }), 201);

    await must(
      post('/api/v1/projects/secret/tasks', { title: 'Theirs', assignee_id: stranger }),
      201,
    );

    expect(assigneeOf('SEC-1')).toBe(stranger);
  });

  it('assigns SEC-1 to an org admin with no membership row — implicit access counts (D-006)', async () => {
    await secret();
    const admin = await outsider('admin@example.test', 'admin');
    const created = (await (
      await must(post('/api/v1/projects/secret/tasks', { title: 'For the admin' }), 201)
    ).json()) as { id: string };

    await must(
      req(`/api/v1/tasks/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignee_id: admin }),
      }),
      200,
    );

    expect(assigneeOf('SEC-1')).toBe(admin);
  });
});
