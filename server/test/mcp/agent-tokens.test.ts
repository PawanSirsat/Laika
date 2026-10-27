import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, tokens, users } from '../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * A registered agent's token over MCP (D-114, LAI-534): the same refusals, with
 * the same §6.3 `code` and `reason`, as the REST routes in
 * `test/http/routes/agents.test.ts` — because the tools call the same services,
 * and the grant step is in `can()` — and `laika_whoami` names the agent.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let server: ReturnType<typeof serve>;
let baseUrl: URL;
let ownerCookie: string;
let bob: { cookie: string; id: string };
let alpha: string;

interface ErrorBody {
  error: { code: string; message: string; details: { reason?: unknown } | null };
}

async function must(path: string, init: RequestInit, cookie: string, status = 201) {
  const res = await h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie }),
  });
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function connect(secret: string, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${secret}`, ...headers } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

async function refused(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} was expected to fail: ${JSON.stringify(result)}`).toBe(true);
  const body = result.structuredContent as ErrorBody;
  expect(body.error, `${name}: no §6.3 envelope`).toBeDefined();
  return { code: body.error.code, reason: body.error.details?.reason };
}

async function succeeded(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
  return result;
}

async function register(grants: { project_id: string; scope: 'full' | 'read_only' }[]) {
  return (await must(
    '/api/v1/agents',
    {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Bob’s Codex', harness: 'codex', grants }),
    },
    bob.cookie,
  )) as unknown as { agent: { id: string }; token: { id: string }; secret: string };
}

async function whoami(client: Client): Promise<Record<string, unknown>> {
  const result = await succeeded(client, 'laika_whoami', {});
  const content = result.content as { text: string }[];
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
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
  const orgId = h.db.select().from(orgs).get()?.id ?? '';
  const ownerId =
    h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';

  const invite = seedInvite(h.db, {
    orgId,
    createdBy: ownerId,
    email: 'bob@example.test',
    orgRole: 'member',
  });
  const signed = await signUp(h.app, {
    email: 'bob@example.test',
    password: PASSWORD,
    inviteToken: invite,
  });
  expect(signed.status).toBe(200);
  bob = {
    cookie: cookieFrom(signed),
    id: h.db.select().from(users).where(eq(users.email, 'bob@example.test')).get()?.id ?? '',
  };

  for (const [slug, prefix] of [
    ['alpha', 'ALP'],
    ['beta', 'BET'],
  ] as const) {
    const created = await must(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: slug, slug, prefix }) },
      ownerCookie,
    );
    if (slug === 'alpha') alpha = created.id as string;
    await must(
      `/api/v1/projects/${slug}/members`,
      { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
      ownerCookie,
    );
  }

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

describe('the grant narrows every tool', () => {
  it('a project with no grant: create_task and get_project_context both answer agent_not_granted', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'full' }]);
    const client = await connect(secret);

    await succeeded(client, 'create_task', { project: 'alpha', title: 'mine' });
    expect(await refused(client, 'create_task', { project: 'beta', title: 'not mine' })).toEqual({
      code: 'forbidden',
      reason: 'agent_not_granted',
    });
    expect(await refused(client, 'get_project_context', { project: 'beta' })).toEqual({
      code: 'forbidden',
      reason: 'agent_not_granted',
    });

    await client.close();
  });

  it('a read_only grant on a full token refuses the write and keeps the read', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'read_only' }]);
    const client = await connect(secret);

    expect(await refused(client, 'create_task', { project: 'alpha', title: 'x' })).toEqual({
      code: 'forbidden',
      reason: 'agent_read_only',
    });
    await succeeded(client, 'get_project_context', { project: 'alpha' });

    await client.close();
  });

  it('a full grant on a read_only token refuses the write', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const changed = h.db
      .update(tokens)
      .set({ scope: 'read_only' })
      .where(eq(tokens.id, created.token.id))
      .run();
    expect(changed.changes).toBe(1);
    const client = await connect(created.secret);

    expect((await refused(client, 'create_task', { project: 'alpha', title: 'x' })).code).toBe(
      'forbidden',
    );
    await succeeded(client, 'get_project_context', { project: 'alpha' });

    await client.close();
  });

  it('the owner losing a permission removes it from the agent', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'full' }]);
    const client = await connect(secret);
    await succeeded(client, 'create_task', { project: 'alpha', title: 'before' });

    await must(
      `/api/v1/projects/alpha/members/${bob.id}`,
      { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) },
      ownerCookie,
      200,
    );

    expect(await refused(client, 'create_task', { project: 'alpha', title: 'after' })).toEqual({
      code: 'forbidden',
      reason: undefined,
    });
    await client.close();
  });

  it('a header naming another agent changes nothing', async () => {
    const other = await register([{ project_id: alpha, scope: 'full' }]);
    const narrow = await register([]);
    const client = await connect(narrow.secret, { 'X-Laika-Agent-Id': other.agent.id });

    expect(await refused(client, 'create_task', { project: 'alpha', title: 'x' })).toEqual({
      code: 'forbidden',
      reason: 'agent_not_granted',
    });
    expect((await whoami(client)).agent).toMatchObject({ id: narrow.agent.id });
    await client.close();
  });
});

describe('laika_whoami', () => {
  it('names the agent for an agent’s token', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const client = await connect(created.secret);

    expect((await whoami(client)).agent).toEqual({
      id: created.agent.id,
      display_name: 'Bob’s Codex',
      harness: 'codex',
      device_label: null,
      status: 'active',
    });
    await client.close();
  });

  it('says null for a legacy token, and the legacy token is unchanged', async () => {
    const legacy = (await must(
      '/api/v1/tokens',
      { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
      bob.cookie,
    )) as { secret: string };
    const created = await register([]);
    const client = await connect(legacy.secret, { 'X-Laika-Agent-Id': created.agent.id });

    const me = await whoami(client);
    expect(me).toMatchObject({ email: 'bob@example.test', token_scope: 'full', agent: null });
    await succeeded(client, 'create_task', { project: 'beta', title: 'legacy reaches beta' });
    await client.close();
  });
});
