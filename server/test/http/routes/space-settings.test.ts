import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  signUp,
} from '../../helpers/auth.ts';

/**
 * Space settings, the API half (D-103, LAI-976): what `PATCH /projects/:slug`
 * takes, leaving a space, archived spaces in the list, and the two per-space
 * rules — who may create tasks, and whether agents may write — through REST and
 * MCP alike.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let server: ReturnType<typeof serve>;
let baseUrl: URL;

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

async function api(path: string, init: RequestInit = {}, auth = ownerCookie): Promise<Response> {
  const credential = auth.startsWith('lai_')
    ? { Authorization: `Bearer ${auth}` }
    : { Cookie: auth };
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

/** A setup call that must succeed (CLAUDE.md §5). */
async function must(
  path: string,
  init: RequestInit = {},
  expected = 201,
  auth = ownerCookie,
): Promise<Response> {
  const res = await api(path, init, auth);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(expected);
  return res;
}

async function patch(slug: string, body: unknown, auth = ownerCookie): Promise<Response> {
  return api(`/api/v1/projects/${slug}`, { method: 'PATCH', body: JSON.stringify(body) }, auth);
}

async function newTask(slug: string, title: string, auth = ownerCookie): Promise<Response> {
  return api(
    `/api/v1/projects/${slug}/tasks`,
    { method: 'POST', body: JSON.stringify({ title }) },
    auth,
  );
}

async function error(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

async function mint(auth = ownerCookie): Promise<string> {
  const res = await must(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'agent', scope: 'full' }) },
    201,
    auth,
  );
  return ((await res.json()) as { secret: string }).secret;
}

/** A second person, signed in, with `role` on `slug`. Returns their cookie and id. */
async function person(
  email: string,
  slug: string | null,
  role: 'lead' | 'member' | 'viewer' = 'member',
  orgRole: 'member' | 'viewer' | 'admin' = 'member',
): Promise<{ cookie: string; id: string }> {
  const invited = await must('/api/v1/invites', {
    method: 'POST',
    body: JSON.stringify({ email, org_role: orgRole }),
  });
  const { token } = (await invited.json()) as { token: string };
  const signed = await signUp(h.app, {
    email,
    password: PASSWORD,
    name: email,
    inviteToken: token,
  });
  expect(signed.status, await signed.clone().text()).toBe(200);
  const people = (await (await api('/api/v1/users')).json()) as {
    data: { id: string; email: string }[];
  };
  const id = people.data.find((u) => u.email === email)?.id;
  if (id === undefined) throw new Error(`no user ${email}`);
  if (slug !== null) {
    await must(`/api/v1/projects/${slug}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: id, role }),
    });
  }
  return { cookie: cookieFrom(signed), id };
}

async function connect(secret: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

beforeEach(async () => {
  h = authHarness();
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status).toBe(201);
  ownerCookie = cookieFrom(res);
  baseUrl = await new Promise<URL>((resolve) => {
    server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
    });
  });
  await must('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Core', slug: 'core', prefix: 'COR' }),
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  h.close();
});

describe('PATCH /projects/:slug takes the settings page’s fields', () => {
  it('accepts board_hide_done_days — refused since LAI-266', async () => {
    const res = await patch('core', { board_hide_done_days: 7 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { board_hide_done_days: number }).board_hide_done_days).toBe(7);

    const cleared = await patch('core', { board_hide_done_days: null });
    expect(cleared.status).toBe(200);
    expect(
      ((await cleared.json()) as { board_hide_done_days: number | null }).board_hide_done_days,
    ).toBeNull();
  });

  it('keeps board_hide_done_days given on create', async () => {
    const res = await must('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Web', slug: 'web', prefix: 'WEB', board_hide_done_days: 3 }),
    });
    expect(((await res.json()) as { board_hide_done_days: number }).board_hide_done_days).toBe(3);
  });

  it('takes name, description, repo and a palette colour, and refuses another colour', async () => {
    const res = await patch('core', {
      name: 'Core engine',
      description: 'The API',
      repo: 'PawanSirsat/Laika',
      color: 'teal',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({
      name: 'Core engine',
      description: 'The API',
      repo: 'PawanSirsat/Laika',
      color: 'teal',
    });

    const pink = await patch('core', { color: 'pink' });
    expect(pink.status).toBe(422);
    expect((await error(pink)).code).toBe('unprocessable');

    const cleared = await patch('core', { color: null });
    expect(((await cleared.json()) as { color: string | null }).color).toBeNull();
  });

  it('returns the per-space rules on the view, with their defaults', async () => {
    const view = (await (await api('/api/v1/projects/core')).json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      color: null,
      task_create_min_role: 'member',
      agents_allowed: true,
      former_prefixes: [],
    });

    const list = (await (await api('/api/v1/projects')).json()) as {
      data: Record<string, unknown>[];
    };
    expect(list.data[0]).toMatchObject({ task_create_min_role: 'member', agents_allowed: true });
  });

  it('refuses a rule value outside its vocabulary', async () => {
    expect((await patch('core', { task_create_min_role: 'viewer' })).status).toBe(422);
    expect((await patch('core', { agents_allowed: 'no' })).status).toBe(422);
  });

  it('is a space admin’s: a member is refused', async () => {
    const member = await person('m@example.test', 'core');
    const res = await patch('core', { color: 'red' }, member.cookie);
    expect(res.status).toBe(403);
    expect((await error(res)).details).toMatchObject({ action: 'project.settings.edit' });
  });
});

describe('a new key prefix keeps every old key resolving (D-103 item 3)', () => {
  it('re-keys the display, resolves the old key, and numbers new tasks on', async () => {
    await must('/api/v1/projects/core/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'First' }),
    });

    const res = await patch('core', { prefix: 'eng' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ prefix: 'ENG', former_prefixes: ['COR'] });

    const second = (await (await newTask('core', 'Second')).json()) as { key: string };
    expect(second.key).toBe('ENG-2');

    const client = await connect(await mint());
    for (const ref of ['COR-1', 'cor-1', 'ENG-1']) {
      const result = await client.callTool({ name: 'get_task_context', arguments: { task: ref } });
      expect(result.isError, `${ref}: ${JSON.stringify(result)}`).not.toBe(true);
      const task = (result.structuredContent as { task: { title: string; key: string } }).task;
      expect(task, ref).toMatchObject({ title: 'First', key: 'ENG-1' });
    }
    await client.close();
  });

  it('refuses a prefix another space holds now or held before, 409 on the field', async () => {
    await must('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Web', slug: 'web', prefix: 'WEB' }),
    });
    const taken = await patch('core', { prefix: 'WEB' });
    expect(taken.status).toBe(409);
    expect((await error(taken)).details).toMatchObject({ field: 'prefix' });

    await must('/api/v1/projects/core', { method: 'PATCH', body: '{"prefix":"ENG"}' }, 200);

    // COR-n still names core's tasks, so nobody else may become COR.
    const reused = await patch('web', { prefix: 'COR' });
    expect(reused.status).toBe(409);
    expect((await error(reused)).details).toMatchObject({ field: 'prefix', reason: 'former' });

    const created = await api('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Other', slug: 'other', prefix: 'cor' }),
    });
    expect(created.status).toBe(409);
    expect((await error(created)).details).toMatchObject({ field: 'prefix', reason: 'former' });
  });

  it('lets a space go back to a prefix it held', async () => {
    await must('/api/v1/projects/core', { method: 'PATCH', body: '{"prefix":"ENG"}' }, 200);
    const back = await patch('core', { prefix: 'COR' });
    expect(back.status, await back.clone().text()).toBe(200);
    expect(await back.json()).toMatchObject({ prefix: 'COR', former_prefixes: ['ENG'] });
  });

  it('refuses a malformed prefix', async () => {
    expect((await patch('core', { prefix: 'x' })).status).toBe(422);
  });
});

describe('who may create tasks (D-103 item 6)', () => {
  it('space admins only: a member is refused on REST, a lead is not, editing still works', async () => {
    const member = await person('m@example.test', 'core');
    const lead = await person('l@example.test', 'core', 'lead');
    const made = (await (await newTask('core', 'Existing')).json()) as { id: string };

    await must(
      '/api/v1/projects/core',
      {
        method: 'PATCH',
        body: JSON.stringify({ task_create_min_role: 'lead' }),
      },
      200,
    );

    const refused = await newTask('core', 'Nope', member.cookie);
    expect(refused.status).toBe(403);
    expect((await error(refused)).details).toMatchObject({
      action: 'task.create',
      reason: 'task_create_min_role',
      task_create_min_role: 'lead',
    });

    expect((await newTask('core', 'Yes', lead.cookie)).status).toBe(201);

    const edited = await api(
      `/api/v1/tasks/${made.id}`,
      { method: 'PATCH', body: JSON.stringify({ title: 'Edited' }) },
      member.cookie,
    );
    expect(edited.status).toBe(200);
  });

  it('space admins only: a member’s agent is refused on MCP too', async () => {
    const member = await person('m@example.test', 'core');
    await must(
      '/api/v1/projects/core',
      {
        method: 'PATCH',
        body: JSON.stringify({ task_create_min_role: 'lead' }),
      },
      200,
    );

    const client = await connect(await mint(member.cookie));
    const result = await client.callTool({
      name: 'create_task',
      arguments: { project: 'core', title: 'Nope' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('task_create_min_role');
    await client.close();
  });

  it('never a viewer, under the default', async () => {
    const viewer = await person('v@example.test', 'core', 'viewer');
    const res = await newTask('core', 'Nope', viewer.cookie);
    expect(res.status).toBe(403);
    expect((await error(res)).details).toMatchObject({ action: 'task.create' });
  });
});

describe('agents off (D-103 item 7)', () => {
  it('refuses an agent token every write on REST, allows its reads, and leaves people alone', async () => {
    const made = (await (await newTask('core', 'Work')).json()) as { id: string };
    const secret = await mint();
    await must(
      '/api/v1/projects/core',
      {
        method: 'PATCH',
        body: JSON.stringify({ agents_allowed: false }),
      },
      200,
    );

    const writes: [string, RequestInit][] = [
      ['/api/v1/projects/core/tasks', { method: 'POST', body: '{"title":"Nope"}' }],
      [`/api/v1/tasks/${made.id}`, { method: 'PATCH', body: '{"title":"Nope"}' }],
      [`/api/v1/tasks/${made.id}/claim`, { method: 'POST', body: '{}' }],
      [`/api/v1/tasks/${made.id}/finish`, { method: 'POST', body: '{"summary":"Nope"}' }],
      [`/api/v1/tasks/${made.id}/comments`, { method: 'POST', body: '{"body_md":"Nope"}' }],
    ];
    for (const [path, init] of writes) {
      const res = await api(path, init, secret);
      expect(res.status, `${path} ${await res.clone().text()}`).toBe(403);
      expect((await error(res)).details, path).toMatchObject({ reason: 'agents_off' });
    }

    expect((await api(`/api/v1/tasks/${made.id}`, {}, secret)).status).toBe(200);
    expect((await api('/api/v1/projects/core/tasks', {}, secret)).status).toBe(200);

    // The person, signed in, is unaffected.
    expect((await newTask('core', 'By hand')).status).toBe(201);
  });

  it('refuses the MCP write tools and answers the read ones', async () => {
    await must('/api/v1/projects/core/tasks', { method: 'POST', body: '{"title":"Work"}' });
    const client = await connect(await mint());
    await must(
      '/api/v1/projects/core',
      {
        method: 'PATCH',
        body: JSON.stringify({ agents_allowed: false }),
      },
      200,
    );

    const calls: [string, Record<string, unknown>][] = [
      ['create_task', { project: 'core', title: 'Nope' }],
      ['start_working', { task: 'COR-1', branch: 'COR-1-nope' }],
      ['update_status', { task: 'COR-1', status: 'todo' }],
      ['update_task', { task: 'COR-1', title: 'Nope' }],
      ['add_comment', { task: 'COR-1', body: 'Nope' }],
      ['finish_task', { task: 'COR-1', summary: 'Nope' }],
    ];
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      expect(JSON.stringify(result), name).toContain('agents_off');
    }

    const read = await client.callTool({ name: 'get_task_context', arguments: { task: 'COR-1' } });
    expect(read.isError, JSON.stringify(read)).not.toBe(true);
    await client.close();
  });
});

interface LeaveBody {
  slug: string;
  implicit_access: boolean;
  notice: string | null;
}

describe('POST /projects/:slug/leave (D-103 item 5)', () => {
  it('lets a member leave, after which the space is closed to them', async () => {
    const member = await person('m@example.test', 'core');
    const res = await api('/api/v1/projects/core/leave', { method: 'POST' }, member.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'core', implicit_access: false, notice: null });

    expect((await api('/api/v1/projects/core', {}, member.cookie)).status).toBe(403);
  });

  it('refuses the last space admin 409 last_lead, saying what to do', async () => {
    const res = await api('/api/v1/projects/core/leave', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = await error(res);
    expect(body.code).toBe('conflict');
    expect(body.details).toMatchObject({ reason: 'last_lead' });
    expect(body.message).toMatch(/space admin/i);
  });

  it('tells an owner who leaves that they can still open the space', async () => {
    await person('l@example.test', 'core', 'lead');
    const res = await api('/api/v1/projects/core/leave', { method: 'POST' });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as LeaveBody;
    expect(body.implicit_access).toBe(true);
    expect(body.notice).toMatch(/Open every project/);

    expect((await api('/api/v1/projects/core')).status).toBe(200);
  });

  it('answers 404 to somebody who is not a member', async () => {
    const outsider = await person('o@example.test', null);
    const res = await api('/api/v1/projects/core/leave', { method: 'POST' }, outsider.cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /projects?archived= (D-103 item 10)', () => {
  async function slugs(query: string, auth = ownerCookie): Promise<string[]> {
    const res = await api(`/api/v1/projects${query}`, {}, auth);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { data: { slug?: string; deleted?: boolean }[] };
    return body.data.map((p) => p.slug ?? '(tombstone)').sort();
  }

  beforeEach(async () => {
    await must('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Old', slug: 'old', prefix: 'OLD' }),
    });
    await must('/api/v1/projects/old', { method: 'PATCH', body: '{"archived":true}' }, 200);
  });

  it('keeps the default as it was: the archived space is a tombstone', async () => {
    expect(await slugs('')).toEqual(['(tombstone)', 'core']);
  });

  it('includes archived spaces in full, or lists only them', async () => {
    expect(await slugs('?archived=include')).toEqual(['core', 'old']);
    expect(await slugs('?archived=only')).toEqual(['old']);

    const only = (await (await api('/api/v1/projects?archived=only')).json()) as {
      data: { archived_at: number | null }[];
    };
    expect(only.data[0]?.archived_at).not.toBeNull();
  });

  it('shows an archived space to its members and nobody else', async () => {
    const member = await person('m@example.test', 'old');
    const outsider = await person('o@example.test', 'core');
    expect(await slugs('?archived=only', member.cookie)).toEqual(['old']);
    expect(await slugs('?archived=only', outsider.cookie)).toEqual([]);
  });

  it('refuses a value it does not know, 400', async () => {
    const res = await api('/api/v1/projects?archived=yes');
    expect(res.status).toBe(400);
    expect((await error(res)).details).toMatchObject({ archived: 'yes' });
  });
});
