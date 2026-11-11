import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memberNotices, orgs, projectMemberships, tasks, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `GET /me/notices`, `POST /me/notices/:id/read`, `POST /me/notices/read-all`
 * and `POST /projects/:slug/members`' two new fields over HTTP (SPEC §6.4,
 * D-134, LAI-1136). Every refusal asserts the status, the §6.3 `code` and the
 * `reason`, so a broken setup cannot pass for the rule.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;

interface Auth {
  cookie?: string;
  bearer?: string;
}

interface ErrorBody {
  error: { code: string; details: { reason?: string } | null };
}

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...headers, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok(res: Response, status = 200): Promise<Record<string, unknown>> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function refused(res: Response, status: number, code: string, reason?: string) {
  expect(res.status, await res.clone().text()).toBe(status);
  const body = (await res.json()) as ErrorBody;
  expect(body.error.code).toBe(code);
  if (reason !== undefined) expect(body.error.details?.reason).toBe(reason);
}

async function join(email: string) {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole: 'member' });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function mint(cookie: string): Promise<string> {
  const body = await ok(
    await req(
      '/api/v1/tokens',
      { method: 'POST', body: JSON.stringify({ name: 'Agent', scope: 'full' }) },
      { cookie },
    ),
    201,
  );
  return String(body.secret);
}

async function newTask(slug: string, title: string): Promise<string> {
  const body = await ok(
    await req(
      `/api/v1/projects/${slug}/tasks`,
      { method: 'POST', body: JSON.stringify({ title }) },
      { cookie: ownerCookie },
    ),
    201,
  );
  return body.id as string;
}

function add(slug: string, body: Record<string, unknown>): Promise<Response> {
  return req(
    `/api/v1/projects/${slug}/members`,
    { method: 'POST', body: JSON.stringify(body) },
    { cookie: ownerCookie },
  );
}

interface NoticesPage {
  data: {
    id: string;
    kind: string;
    message: string | null;
    task: { id: string; key: string } | null;
    project: { slug: string } | null;
    read_at: number | null;
  }[];
  next_cursor: string | null;
  unread_count: number;
}

async function notices(cookie: string, query = ''): Promise<NoticesPage> {
  return (await ok(
    await req(`/api/v1/me/notices${query}`, {}, { cookie }),
  )) as unknown as NoticesPage;
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
  ownerCookie = cookieFrom(setup);
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  await ok(
    await req(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: 'Alpha', slug: 'alpha', prefix: 'ALP' }) },
      { cookie: ownerCookie },
    ),
    201,
  );
});

afterEach(() => {
  h.close();
});

describe('POST /projects/:slug/members — message and first card (D-134)', () => {
  it('behaves as before with no new fields, and still notifies the person', async () => {
    const bob = await join('bob@example.test');
    const body = await ok(await add('alpha', { user_id: bob.id, role: 'member' }), 201);
    expect(Object.keys(body)).toEqual(['members']);
    expect((body.members as { user_id: string }[]).map((m) => m.user_id)).toContain(bob.id);

    const page = await notices(bob.cookie);
    expect(page.unread_count).toBe(1);
    expect(page.data).toMatchObject([
      { kind: 'added_to_space', message: null, task: null, project: { slug: 'alpha' } },
    ]);
  });

  it('carries the message and the first card, and assigns it', async () => {
    const bob = await join('bob@example.test');
    const taskId = await newTask('alpha', 'Start here');
    await ok(
      await add('alpha', {
        user_id: bob.id,
        role: 'member',
        message: '  Welcome to Alpha  ',
        assign_task_id: taskId,
      }),
      201,
    );
    expect(h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.assigneeId).toBe(bob.id);
    const page = await notices(bob.cookie);
    expect(page.data[0]).toMatchObject({
      message: 'Welcome to Alpha',
      task: { id: taskId, key: 'ALP-1' },
    });
  });

  it('refuses a first card already assigned 422 task_not_assignable, and adds nobody', async () => {
    const bob = await join('bob@example.test');
    const taskId = await newTask('alpha', 'Taken');
    await ok(
      await req(
        `/api/v1/tasks/${taskId}`,
        { method: 'PATCH', body: JSON.stringify({ assignee_id: ownerId }) },
        { cookie: ownerCookie },
      ),
    );
    await refused(
      await add('alpha', { user_id: bob.id, role: 'member', assign_task_id: taskId }),
      422,
      'unprocessable',
      'task_not_assignable',
    );
    expect(
      h.db.select().from(projectMemberships).where(eq(projectMemberships.userId, bob.id)).all(),
    ).toEqual([]);
    expect(h.db.select().from(memberNotices).all()).toEqual([]);
  });

  it('refuses a deactivated person 422 user_deactivated', async () => {
    const bob = await join('bob@example.test');
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, bob.id)).run();
    await refused(
      await add('alpha', { user_id: bob.id, role: 'member' }),
      422,
      'unprocessable',
      'user_deactivated',
    );
  });

  it('refuses a message over 500 characters before anything is written', async () => {
    const bob = await join('bob@example.test');
    await refused(
      await add('alpha', { user_id: bob.id, role: 'member', message: 'x'.repeat(501) }),
      422,
      'unprocessable',
    );
    expect(
      h.db.select().from(projectMemberships).where(eq(projectMemberships.userId, bob.id)).all(),
    ).toEqual([]);
    expect(h.db.select().from(memberNotices).all()).toEqual([]);
  });
});

describe('/me/notices (D-134)', () => {
  it('returns only the caller’s own, with the unread count, and pages', async () => {
    const bob = await join('bob@example.test');
    const cy = await join('cy@example.test');
    await ok(await add('alpha', { user_id: bob.id, role: 'member' }), 201);
    await ok(await add('alpha', { user_id: cy.id, role: 'member' }), 201);

    expect((await notices(bob.cookie)).data).toHaveLength(1);
    expect((await notices(cy.cookie)).data).toHaveLength(1);
    expect((await notices(bob.cookie)).data[0]!.id).not.toBe(
      (await notices(cy.cookie)).data[0]!.id,
    );
    expect(await notices(ownerCookie)).toEqual({ data: [], next_cursor: null, unread_count: 0 });

    // A second space, so there are two to page through, newest first.
    await ok(
      await req(
        '/api/v1/projects',
        { method: 'POST', body: JSON.stringify({ name: 'Beta', slug: 'beta', prefix: 'BET' }) },
        { cookie: ownerCookie },
      ),
      201,
    );
    await ok(await add('beta', { user_id: bob.id, role: 'member' }), 201);
    const first = await notices(bob.cookie, '?limit=1');
    expect(first.data.map((n) => n.project?.slug)).toEqual(['beta']);
    expect(first.unread_count).toBe(2);
    expect(first.next_cursor).not.toBeNull();
    const second = await notices(bob.cookie, `?limit=1&cursor=${first.next_cursor}`);
    expect(second.data.map((n) => n.project?.slug)).toEqual(['alpha']);
    expect(second.next_cursor).toBeNull();
  });

  it('marks one read and all read, both idempotent 204s', async () => {
    const bob = await join('bob@example.test');
    await ok(await add('alpha', { user_id: bob.id, role: 'member' }), 201);
    const [notice] = (await notices(bob.cookie)).data;

    for (let i = 0; i < 2; i++) {
      const res = await req(
        `/api/v1/me/notices/${notice!.id}/read`,
        { method: 'POST' },
        { cookie: bob.cookie },
      );
      expect(res.status).toBe(204);
    }
    const read = await notices(bob.cookie);
    expect(read.unread_count).toBe(0);
    expect(read.data[0]!.read_at).not.toBeNull();
    expect((await notices(bob.cookie, '?unread=true')).data).toEqual([]);

    for (let i = 0; i < 2; i++) {
      const res = await req(
        '/api/v1/me/notices/read-all',
        { method: 'POST' },
        { cookie: bob.cookie },
      );
      expect(res.status).toBe(204);
    }
  });

  it('answers 404 for somebody else’s notice', async () => {
    const bob = await join('bob@example.test');
    const cy = await join('cy@example.test');
    await ok(await add('alpha', { user_id: bob.id, role: 'member' }), 201);
    const [notice] = (await notices(bob.cookie)).data;
    await refused(
      await req(`/api/v1/me/notices/${notice!.id}/read`, { method: 'POST' }, { cookie: cy.cookie }),
      404,
      'not_found',
    );
  });

  it('refuses every token 403 session_required', async () => {
    const bob = await join('bob@example.test');
    const bearer = await mint(bob.cookie);
    await refused(
      await req('/api/v1/me/notices', {}, { bearer }),
      403,
      'forbidden',
      'session_required',
    );
    await refused(
      await req('/api/v1/me/notices/read-all', { method: 'POST' }, { bearer }),
      403,
      'forbidden',
      'session_required',
    );
    await refused(
      await req('/api/v1/me/notices/01ABC/read', { method: 'POST' }, { bearer }),
      403,
      'forbidden',
      'session_required',
    );
  });

  it('refuses an unread value that is not true or false, and an unknown parameter', async () => {
    const bob = await join('bob@example.test');
    await refused(
      await req('/api/v1/me/notices?unread=yes', {}, { cookie: bob.cookie }),
      422,
      'unprocessable',
    );
    await refused(
      await req('/api/v1/me/notices?since=1', {}, { cookie: bob.cookie }),
      422,
      'unprocessable',
    );
  });
});
