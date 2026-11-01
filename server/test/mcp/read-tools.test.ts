import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, users } from '../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * The four read tools (SPEC §7.1, LAI-407), through a real MCP client.
 *
 * Driven end to end rather than by calling the handlers: the properties that
 * matter — that a viewer sees what a viewer sees, that a narrowed token sees one
 * project, that nothing is written — are produced by the whole chain, and a
 * direct call would skip the auth and scope layers that enforce them.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let server: ReturnType<typeof serve>;
let baseUrl: URL;

async function setUp(): Promise<string> {
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
  return cookieFrom(res);
}

async function api(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function mint(body: Record<string, unknown> = {}, cookie = ownerCookie): Promise<string> {
  const res = await api(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'agent', scope: 'full', ...body }) },
    cookie,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
}

async function connect(secret: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

/**
 * The two halves of an answer (§7.2).
 *
 * Typed against the SDK's own result — which carries an index signature — rather
 * than a narrower literal, because a narrower one is not assignable and `tsc`
 * says so even while vitest runs green.
 */
type ToolResult = Awaited<ReturnType<Client['callTool']>>;

/** The markdown half. */
function text(result: ToolResult): string {
  return (result.content as { type: string; text: string }[] | undefined)?.[0]?.text ?? '';
}

/** The structured half. */
function payload(result: ToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/**
 * A setup call that must succeed.
 *
 * Bare `await api(...)` in setup is how this file's dependency fixture silently
 * did nothing: the body used `depends_on` where the route wanted
 * `depends_on_task_id` — now `blocked_by_task_id` (LAI-099) — the route
 * correctly answered `422`, and nothing looked.
 * Two tests then asserted against a graph that had never been built. CLAUDE.md
 * §5: an assertion must be specific enough that a broken setup cannot satisfy it
 * — and a setup step with no assertion at all is the extreme case.
 */
async function must(path: string, init: RequestInit, expected = 201): Promise<Response> {
  const res = await api(path, init);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(expected);
  return res;
}

async function project(slug: string, prefix: string): Promise<string> {
  const res = await api('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: slug, slug, prefix }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function task(slug: string, body: Record<string, unknown>): Promise<Record<string, string>> {
  const res = await api(`/api/v1/projects/${slug}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Record<string, string>;
}

beforeEach(async () => {
  h = authHarness();
  ownerCookie = await setUp();
  baseUrl = await new Promise<URL>((resolve) => {
    server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve(new URL(`http://127.0.0.1:${String(info.port)}`));
    });
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

describe('the four tools are registered', () => {
  it('lists the §7.1 read tools', async () => {
    const client = await connect(await mint());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    for (const name of [
      'list_projects',
      'list_ready_tasks',
      'get_task_context',
      'get_project_context',
    ]) {
      expect(names, name).toContain(name);
    }

    await client.close();
  });

  it('the read tools take no arguments that could change anything', async () => {
    // What the "no write tools yet" assertion here was reaching for, stated as
    // a property rather than a moment.
    //
    // The original said `expect(names).not.toContain('create_task')`, which was
    // true when LAI-407 shipped and which **LAI-408 made false by doing exactly
    // what it was supposed to do**. A guard that fires on correct work is a bug
    // in the guard (D-037) — and this one was mine, one task after I argued the
    // same point to CHIEF about `not.toContain('token.created')`.
    //
    // The durable property is that these four accept nothing that names a
    // mutation: a status, a body, a title. That stays true however many write
    // tools land beside them.
    const client = await connect(await mint());
    const { tools } = await client.listTools();

    const readTools = tools.filter((t) =>
      ['list_projects', 'list_ready_tasks', 'get_task_context', 'get_project_context'].includes(
        t.name,
      ),
    );
    expect(readTools).toHaveLength(4);

    for (const tool of readTools) {
      const schema = JSON.stringify(tool.inputSchema);
      for (const mutating of ['status', 'body', 'title', 'summary', 'note']) {
        expect(schema, `${tool.name} accepts ${mutating}`).not.toContain(`"${mutating}"`);
      }
    }

    await client.close();
  });
});

describe('list_projects', () => {
  it('returns projects the caller can read, in both halves', async () => {
    await project('core', 'COR');
    const client = await connect(await mint());

    const result = await client.callTool({ name: 'list_projects', arguments: {} });

    expect(text(result)).toContain('core');
    expect(payload(result).projects).toHaveLength(1);

    await client.close();
  });

  it('does not carry the whole context document per project', async () => {
    // Not a permission rule — `GET /projects` returns `context_md` and this
    // tool may see it. It is a size rule: ten projects would put a megabyte of
    // briefs into a response whose job is to answer "which project?", which is
    // the failure §7.3 names. The length is kept so an agent knows there is one.
    await project('core', 'COR');
    await must(
      '/api/v1/projects/core/context',
      {
        method: 'PATCH',
        body: JSON.stringify({ context_md: 'SECRET-BRIEF-MARKER', base_revision: 0 }),
      },
      200,
    );

    const client = await connect(await mint());
    const result = await client.callTool({ name: 'list_projects', arguments: {} });

    expect(JSON.stringify(result)).not.toContain('SECRET-BRIEF-MARKER');
    expect((payload(result).projects as { context_length: number }[])[0]?.context_length).toBe(19);

    await client.close();
  });
});

describe('list_ready_tasks', () => {
  it('returns unassigned unblocked work, p1 first then oldest', async () => {
    await project('core', 'COR');
    await task('core', { title: 'Old p2', priority: 'p2' });
    await task('core', { title: 'Urgent', priority: 'p1' });

    const client = await connect(await mint());
    const result = await client.callTool({ name: 'list_ready_tasks', arguments: {} });

    const tasks = payload(result).tasks as { title: string; priority: string }[];
    expect(tasks.map((t) => t.title)).toEqual(['Urgent', 'Old p2']);

    await client.close();
  });

  it('agrees exactly with the REST ?ready= filter', async () => {
    // The divergence that would not fail anything: a second definition of
    // "ready" sends an agent to a different task than the board says is next.
    await project('core', 'COR');
    const blocker = await task('core', { title: 'Blocker' });
    const blocked = await task('core', { title: 'Blocked' });
    await must(`/api/v1/tasks/${blocked.id}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ blocked_by_task_id: blocker.id }),
    });

    const rest = (await (await api('/api/v1/projects/core/tasks?ready=true')).json()) as {
      data: { key: string }[];
    };

    const client = await connect(await mint());
    const result = await client.callTool({ name: 'list_ready_tasks', arguments: {} });
    const viaMcp = (payload(result).tasks as { key: string }[]).map((t) => t.key).sort();

    expect(viaMcp).toEqual(rest.data.map((t) => t.key).sort());
    // And it is a real test: the blocked one must be absent from both.
    expect(viaMcp).not.toContain(blocked.key);
    expect(viaMcp).toContain(blocker.key);

    await client.close();
  });

  it('shows display keys, not ULIDs', async () => {
    await project('core', 'COR');
    await task('core', { title: 'Findable' });

    const client = await connect(await mint());
    const result = await client.callTool({ name: 'list_ready_tasks', arguments: {} });

    expect(text(result)).toContain('COR-1');

    await client.close();
  });
});

describe('get_task_context', () => {
  it('returns the size, the forecast and the why (D-085, LAI-771)', async () => {
    await project('core', 'COR');
    const created = await task('core', {
      title: 'Sized',
      acceptance_md: '- [ ] one\n- [ ] two',
    });

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: created.key },
    });

    const estimate = payload(result).estimate as {
      size: { level: string; computed: string; overridden: boolean };
      why: { factors: { key: string; label: string; levels: number }[]; early: boolean };
      actual: { build_ms: number | null };
    };
    expect(['XS', 'S', 'M', 'L', 'XL']).toContain(estimate.size.level);
    expect(estimate.size.overridden).toBe(false);
    expect(estimate.why.factors.map((f) => f.key)).toContain('words');
    expect(estimate.actual.build_ms).toBeNull();
    // The markdown an agent reads says it too, with the cold start spelled out.
    // Called effort for agents too (LAI-785); the field stays `size`.
    expect(text(result)).toContain(`### Effort ${estimate.size.level} (`);
    expect(text(result)).toContain('no hours until');

    await client.close();
  });

  it('still answers when the size cannot be read, and says so (LAI-771 review)', async () => {
    await project('core', 'COR');
    const created = await task('core', { title: 'Sized, then unreadable' });
    // An estimate whose stored *why* is not JSON: reading it throws. The task
    // points at it, so `get_task_context` meets the failure on its way.
    const broken = newId();
    h.t.sqlite
      .prepare(
        "INSERT INTO task_estimates (id, task_id, source, level, weight, subtasks, factors_json, created_at) VALUES (?, ?, 'model', 'M', 1, 0, 'not json', ?)",
      )
      .run(broken, created.id, Date.now());
    h.t.sqlite.prepare('UPDATE tasks SET estimate_id = ? WHERE id = ?').run(broken, created.id);

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: created.key },
    });

    expect(result.isError).not.toBe(true);
    expect(text(result)).toContain('Sized, then unreadable');
    expect(text(result)).toContain('### Effort');
    expect(text(result)).toContain('_Unavailable');
    expect(payload(result).estimate).toBeNull();

    await client.close();
  });

  it('names up to five similar finished tasks and why they were sent back, and nobody (LAI-772)', async () => {
    await project('core', 'COR');
    const done = async (title: string, sentBack: string | null) => {
      const created = await task('core', { title, acceptance_md: title });
      await must(`/api/v1/tasks/${created.id}/claim`, { method: 'POST' }, 200);
      await must(
        `/api/v1/tasks/${created.id}/finish`,
        {
          method: 'POST',
          body: JSON.stringify({ summary: 'Done' }),
        },
        200,
      );
      if (sentBack !== null) {
        await must(
          `/api/v1/tasks/${created.id}/send-back`,
          {
            method: 'POST',
            body: JSON.stringify({ reason: sentBack }),
          },
          200,
        );
        await must(
          `/api/v1/tasks/${created.id}/finish`,
          {
            method: 'POST',
            body: JSON.stringify({ summary: 'Fixed' }),
          },
          200,
        );
      }
      await must(`/api/v1/tasks/${created.id}/accept`, { method: 'POST' }, 200);
      return created;
    };
    const migration = await done(
      'sqlite migration rebuild keeps triggers',
      'The rebuild dropped the triggers',
    );
    await done('sqlite migration adds a column', null);
    await done('board card lane colours', null);
    const next = await task('core', {
      title: 'sqlite migration for the new table',
      acceptance_md: 'sqlite migration',
    });

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: next.key },
    });
    const similar = payload(result).similar as {
      key: string;
      rounds: number;
      send_backs: { round: number | null; reason: string }[];
    }[];
    expect(similar.length).toBeGreaterThan(0);
    expect(similar.length).toBeLessThanOrEqual(5);
    expect(similar.find((s) => s.key === migration.key)).toMatchObject({
      rounds: 2,
      send_backs: [{ round: 1, reason: 'The rebuild dropped the triggers' }],
    });
    const section = text(result).split('### Similar finished tasks')[1]?.split('\n### ')[0] ?? '';
    expect(section).toContain(migration.key);
    expect(section).toContain('The rebuild dropped the triggers');
    // Reasons only: not who built it, who finished it, or who sent it back.
    expect(section).not.toContain('Ada');
    // And the token forecast says what it waits for, as the hours do.
    expect(text(result)).toContain('Tokens: no forecast until');

    await client.close();
  });

  it('accepts the display key it hands out', async () => {
    await project('core', 'COR');
    await task('core', { title: 'By key' });

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: 'COR-1' },
    });

    expect(text(result)).toContain('By key');

    await client.close();
  });

  it('returns the whole discovered_from chain, not just the parent', async () => {
    await project('core', 'COR');
    const root = await task('core', { title: 'Root cause' });
    const middle = await task('core', { title: 'Middle', discovered_from: root.id });
    const leaf = await task('core', { title: 'Leaf', discovered_from: middle.id });

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: leaf.key },
    });

    const chain = payload(result).discovered_from_chain as { key: string }[];
    expect(chain.map((t) => t.key)).toEqual([middle.key, root.key]);

    await client.close();
  });

  it('reports dependencies with their statuses', async () => {
    await project('core', 'COR');
    const blocker = await task('core', { title: 'Blocker' });
    const blocked = await task('core', { title: 'Blocked' });
    await must(`/api/v1/tasks/${blocked.id}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ blocked_by_task_id: blocker.id }),
    });

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: blocked.key },
    });

    expect(text(result)).toContain(blocker.key);
    expect(text(result)).toContain('backlog');
    expect(payload(result).blocked_by).toHaveLength(1);

    await client.close();
  });

  it('errors on a task that does not exist', async () => {
    await project('core', 'COR');
    const client = await connect(await mint());

    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: 'COR-999' },
    });

    expect(result.isError).toBe(true);

    await client.close();
  });
});

describe('get_project_context', () => {
  it('returns the document verbatim from LAI-404’s service', async () => {
    await project('core', 'COR');
    const raw = '  # Architecture\n\n\ttabbed\n';
    await must(
      '/api/v1/projects/core/context',
      { method: 'PATCH', body: JSON.stringify({ context_md: raw, base_revision: 0 }) },
      200,
    );

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_project_context',
      arguments: { project: 'core' },
    });

    expect((payload(result).context as { context_md: string }).context_md).toBe(raw);

    await client.close();
  });

  it('tells an agent to mark its task before it starts, and to name its branch after the key (LAI-770)', async () => {
    await project('core', 'COR');
    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_project_context',
      arguments: { project: 'core' },
    });

    const rule = payload(result).before_you_start as string;
    for (const said of ['start_working', 'update_status', 'in_progress', '`COR-42-']) {
      expect(rule, said).toContain(said);
      expect(text(result), said).toContain(said);
    }
    expect(rule).toContain('tokens');
    // LAI-770 review, B2: the holder's own start_working on a task in progress
    // is accepted, so that is the call to make; update_status to the status it
    // already has would be refused.
    expect(rule).toMatch(/also when it is already yours and in progress/);
    expect(rule).not.toMatch(/`update_status` to `in_progress` when it is already yours/);

    await client.close();
  });

  it('summarises open work and names the team', async () => {
    await project('core', 'COR');
    await task('core', { title: 'One' });

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_project_context',
      arguments: { project: 'core' },
    });

    expect(payload(result).open_task_count).toBe(1);
    expect(text(result)).toContain('Ada');

    await client.close();
  });
});

describe('unknown fields are refused, never ignored (§7.2)', () => {
  it('rejects a junk argument', async () => {
    await project('core', 'COR');
    const client = await connect(await mint());

    const result = await client.callTool({
      name: 'get_project_context',
      arguments: { project: 'core', sudo: true },
    });

    // Silently dropping it would be a caller believing it set something.
    expect(result.isError).toBe(true);

    await client.close();
  });
});

describe('permission travels with the token', () => {
  it('a token narrowed to one project sees only that project', async () => {
    const coreId = await project('core', 'COR');
    await project('shell', 'SHL');

    const narrowed = await mint({ project_ids: [coreId] });
    const client = await connect(narrowed);

    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    const slugs = (payload(result).projects as { slug: string }[]).map((p) => p.slug);

    expect(slugs).toEqual(['core']);

    await client.close();
  });

  it('a read_only token can still read', async () => {
    await project('core', 'COR');
    const client = await connect(await mint({ scope: 'read_only' }));

    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(result.isError).toBeFalsy();

    await client.close();
  });
});

describe('read tools never mutate (AC3)', () => {
  it('writes no activity row, whatever is called', async () => {
    await project('core', 'COR');
    await task('core', { title: 'Something' });
    await must(
      '/api/v1/projects/core/context',
      { method: 'PATCH', body: JSON.stringify({ context_md: 'brief', base_revision: 0 }) },
      200,
    );

    // **After** minting: creating a token writes `token.created` (LAI-402), so a
    // baseline taken before it would count that row as a read tool's doing.
    // This test failed exactly that way first — the assertion was right and the
    // setup was wrong, which is the good direction for that to happen in.
    const client = await connect(await mint());
    const before = h.db.select().from(activity).all().length;
    expect(before).toBeGreaterThan(0);
    await client.callTool({ name: 'list_projects', arguments: {} });
    await client.callTool({ name: 'list_ready_tasks', arguments: {} });
    await client.callTool({ name: 'get_task_context', arguments: { task: 'COR-1' } });
    await client.callTool({ name: 'get_project_context', arguments: { project: 'core' } });
    await client.close();

    // The only thing a read may touch is `tokens.last_used_at`, stamped by the
    // auth layer — that is the request being authenticated, not the tool acting.
    expect(h.db.select().from(activity).all().length).toBe(before);
  });

  it('leaves the task and project rows untouched', async () => {
    await project('core', 'COR');
    const created = await task('core', { title: 'Untouched' });

    const client = await connect(await mint());
    const before = (await (await api(`/api/v1/tasks/${created.id}`)).json()) as {
      updated_at: number;
    };

    await client.callTool({ name: 'get_task_context', arguments: { task: created.key } });
    await client.close();

    const after = (await (await api(`/api/v1/tasks/${created.id}`)).json()) as {
      updated_at: number;
    };
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('the owner’s identity is what the tools act as', async () => {
    await project('core', 'COR');
    const ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id;

    const client = await connect(await mint());
    const result = await client.callTool({ name: 'laika_whoami', arguments: {} });
    const identity = JSON.parse(text(result)) as { user_id: string };

    expect(identity.user_id).toBe(ownerId);

    await client.close();
  });
});

describe('get_task_context knows the parent and the subtasks (D-066)', () => {
  it('returns the parent for a child, and null for a root', async () => {
    await project('core', 'COR');
    const parent = await task('core', { title: 'Parent' });
    const child = await task('core', { title: 'Child', parent_task_id: parent.id });

    const client = await connect(await mint());
    const asChild = await client.callTool({
      name: 'get_task_context',
      arguments: { task: child.key },
    });
    expect(payload(asChild).parent).toMatchObject({
      key: parent.key,
      title: 'Parent',
      status: 'backlog',
    });
    expect(text(asChild)).toContain('### Parent');
    expect(text(asChild)).toContain(parent.key);

    const asRoot = await client.callTool({
      name: 'get_task_context',
      arguments: { task: parent.key },
    });
    expect(payload(asRoot).parent).toBeNull();

    await client.close();
  });

  it('lists the subtasks with their assignee, and counts done over not-cancelled', async () => {
    await project('core', 'COR');
    const parent = await task('core', { title: 'Parent' });
    const done = await task('core', { title: 'Done one', parent_task_id: parent.id });
    const open = await task('core', { title: 'Open one', parent_task_id: parent.id });
    const dropped = await task('core', { title: 'Dropped', parent_task_id: parent.id });
    await must(
      `/api/v1/tasks/${done.id}/status`,
      { method: 'POST', body: JSON.stringify({ status: 'done' }) },
      200,
    );
    await must(
      `/api/v1/tasks/${dropped.id}/status`,
      { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) },
      200,
    );

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: parent.key },
    });

    const subtasks = payload(result).subtasks as {
      key: string;
      status: string;
      assignee_id: string | null;
    }[];
    expect(subtasks.map((s) => s.key).sort()).toEqual([done.key, open.key, dropped.key].sort());
    expect(subtasks.every((s) => 'assignee_id' in s)).toBe(true);
    expect(payload(result).subtasks_done).toBe(1);
    expect(payload(result).subtasks_total).toBe(2);
    expect(text(result)).toContain('### Subtasks (1/2 done)');

    await client.close();
  });
});

/**
 * LAI-704: the read tools took one page (`limit: 200`, so 201 rows) from each
 * list service and treated it as the whole list. On production Onroute held
 * 328 tasks, and `get_project_context` counted 201 of them.
 */
describe('the read tools read every row, not the first page (LAI-704)', () => {
  const MANY = 230;

  async function bulk(slug: string, n: number, status: string): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      await task(slug, { title: `Bulk ${String(i)}`, status, priority: 'p3' });
    }
  }

  it('get_project_context counts every task', async () => {
    await project('core', 'COR');
    await bulk('core', MANY, 'done');

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_project_context',
      arguments: { project: 'core' },
    });

    expect(payload(result).open_task_count).toBe(MANY);
    expect((payload(result).task_counts as Record<string, number>).done).toBe(MANY);

    await client.close();
  });

  it('pages on the services’ own sort key, so no row is counted twice or missed', async () => {
    await project('core', 'COR');
    const created: string[] = [];
    for (let i = 0; i < MANY; i += 1) {
      created.push((await task('core', { title: `Bulk ${String(i)}`, status: 'done' })).id ?? '');
    }
    // Edited in reverse, so the order by \`updated_at\` — the one the services
    // page on — is the opposite of the order by \`created_at\`. A cursor taken
    // from the wrong timestamp then re-reads or skips rows; only the right one
    // counts each task once.
    for (const id of [...created].reverse()) {
      await must(
        `/api/v1/tasks/${id}`,
        { method: 'PATCH', body: JSON.stringify({ title: 'Edited' }) },
        200,
      );
    }

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_project_context',
      arguments: { project: 'core' },
    });
    expect(payload(result).open_task_count).toBe(MANY);

    await client.close();
  });

  it('list_ready_tasks finds the most urgent ready task even past the first page', async () => {
    await project('core', 'COR');
    // Two hundred and thirty **ready** p3 tasks first — more than a page of
    // them — so the p1 one is the most recently updated, last in the services'
    // order, and past the first page of ready tasks.
    await bulk('core', MANY, 'backlog');
    const urgent = await task('core', { title: 'The urgent one', priority: 'p1' });
    for (let i = 0; i < 3; i += 1)
      await task('core', { title: `Routine ${String(i)}`, priority: 'p3' });

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'list_ready_tasks',
      arguments: { project: 'core', limit: 1 },
    });

    const tasks = payload(result).tasks as { key: string }[];
    expect(tasks.map((t) => t.key)).toEqual([urgent.key]);

    await client.close();
  });
}, 60_000);

describe('get_task_context withholds another person’s agent in its round (LAI-1001)', () => {
  it('Ada’s token reads a round Bob’s agent finished: an agent, no name, no harness, no device', async () => {
    const coreId = await project('core', 'COR');
    const orgId = h.db.select().from(orgs).get()?.id ?? '';
    const adaId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id;
    const invite = seedInvite(h.db, {
      orgId,
      createdBy: adaId ?? '',
      email: 'bob@example.test',
      orgRole: 'member',
    });
    const signed = await signUp(h.app, {
      email: 'bob@example.test',
      password: PASSWORD,
      inviteToken: invite,
    });
    expect(signed.status, await signed.clone().text()).toBe(200);
    const bobCookie = cookieFrom(signed);
    const bobId = h.db.select().from(users).where(eq(users.email, 'bob@example.test')).get()?.id;
    await must('/api/v1/projects/core/members', {
      method: 'POST',
      body: JSON.stringify({ user_id: bobId, role: 'member' }),
    });
    const registered = await api(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'Bob’s secret rig',
          harness: 'codex',
          device_label: 'Bob’s laptop',
          grants: [{ project_id: coreId, scope: 'full' }],
        }),
      },
      bobCookie,
    );
    expect(registered.status, await registered.clone().text()).toBe(201);
    const rig = (await registered.json()) as { secret: string; agent: { id: string } };
    const rigId = rig.agent.id;

    const created = await task('core', { title: 'Bob’s agent does it' });
    const asRig = (path: string, generation?: string) =>
      h.app.request(path, {
        method: 'POST',
        body: path.endsWith('/finish') ? JSON.stringify({ summary: 'Did it' }) : '',
        headers: jsonHeaders({
          Authorization: `Bearer ${rig.secret}`,
          ...(generation === undefined ? {} : { 'X-Laika-Claim-Generation': generation }),
        }),
      });
    const claimed = await asRig(`/api/v1/tasks/${created.id}/claim`);
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const finished = await asRig(
      `/api/v1/tasks/${created.id}/finish`,
      claimed.headers.get('X-Laika-Claim-Generation') ?? '',
    );
    expect(finished.status, await finished.clone().text()).toBe(200);

    const client = await connect(await mint());
    const result = await client.callTool({
      name: 'get_task_context',
      arguments: { task: created.key },
    });
    const evidence = payload(result).evidence as {
      client_name: string | null;
      agent: unknown;
      by_registered_agent: boolean;
    } | null;
    expect(evidence).not.toBeNull();
    expect(evidence?.by_registered_agent).toBe(true);
    expect(evidence?.agent).toBeNull();
    expect(evidence?.client_name).toBeNull();
    const raw = JSON.stringify(result);
    expect(raw).not.toContain('Bob’s secret rig');
    expect(raw).not.toContain('Bob’s laptop');

    // Bob selects his agent: now the task shows it to Ada — by harness and
    // device, in the payload and the markdown, never by its registered name.
    const selected = await api(
      `/api/v1/tasks/${created.id}`,
      { method: 'PATCH', body: JSON.stringify({ selected_agent_id: rigId }) },
      bobCookie,
    );
    expect(selected.status, await selected.clone().text()).toBe(200);
    const again = await client.callTool({
      name: 'get_task_context',
      arguments: { task: created.key },
    });
    const shownTask = payload(again).task as {
      selected_agent: { display_name: string | null; harness: string } | null;
    };
    expect(shownTask.selected_agent).toMatchObject({ display_name: null, harness: 'codex' });
    expect(text(again)).toContain('Requested of agent **codex · Bob’s laptop**');
    expect(JSON.stringify(again)).not.toContain('Bob’s secret rig');
    await client.close();
  });
});
