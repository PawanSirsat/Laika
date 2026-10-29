import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and } from 'drizzle-orm';
import { handoffOffers, orgs, taskClaims, tasks, users } from '../../src/db/schema.ts';
import { DEFAULT_CLAIM_TIMINGS, expireClaims } from '../../src/services/claims.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * D-119 over MCP (LAI-586): *"once a task names its agent, only that agent
 * can start it."* `start_working` — a claim, and `reclaim: true` — answers
 * another agent exactly as `POST /tasks/:id/claim` does, because the same
 * service decides; the REST cases are
 * `test/http/routes/selected-agent-owns-claim.test.ts`.
 */

const PASSWORD = 'correct-horse-battery-staple';
const LEASE = DEFAULT_CLAIM_TIMINGS.expireMs;

let h: AuthHarness;
let server: ReturnType<typeof serve>;
let baseUrl: URL;
let ownerCookie: string;
let bob: { cookie: string; id: string };
let alpha: string;

interface ErrorBody {
  error: { code: string; details: Record<string, unknown> | null };
}

async function must(path: string, init: RequestInit, cookie: string, status = 201) {
  const res = await h.app.request(path, { ...init, headers: jsonHeaders({ Cookie: cookie }) });
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function connect(secret: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  await client.connect(transport as Parameters<Client['connect']>[0]);
  return client;
}

async function refused(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} was expected to fail: ${JSON.stringify(result)}`).toBe(true);
  const body = result.structuredContent as ErrorBody;
  expect(body.error, `${name}: no §6.3 envelope`).toBeDefined();
  return {
    code: body.error.code,
    reason: body.error.details?.reason,
    details: body.error.details,
    text: JSON.stringify(result),
  };
}

async function succeeded(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
}

async function register(name: string, scope: 'full' | 'read_only' = 'full') {
  return (await must(
    '/api/v1/agents',
    {
      method: 'POST',
      body: JSON.stringify({
        display_name: name,
        harness: 'codex',
        grants: [{ project_id: alpha, scope }],
      }),
    },
    bob.cookie,
  )) as unknown as { agent: { id: string }; secret: string };
}

async function newTask(title = 'Work'): Promise<{ id: string; key: string }> {
  const body = await must(
    '/api/v1/projects/alpha/tasks',
    { method: 'POST', body: JSON.stringify({ title }) },
    bob.cookie,
  );
  return { id: body.id as string, key: body.key as string };
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
  const created = await must(
    '/api/v1/projects',
    { method: 'POST', body: JSON.stringify({ name: 'alpha', slug: 'alpha', prefix: 'ALP' }) },
    ownerCookie,
  );
  alpha = created.id as string;
  await must(
    '/api/v1/projects/alpha/members',
    { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
    ownerCookie,
  );

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

async function select(taskId: string, agentId: string | null): Promise<void> {
  await must(
    `/api/v1/tasks/${taskId}`,
    { method: 'PATCH', body: JSON.stringify({ selected_agent_id: agentId }) },
    bob.cookie,
    200,
  );
}

function requests(taskId: string) {
  return h.db
    .select({ toAgentId: handoffOffers.toAgentId, state: handoffOffers.state })
    .from(handoffOffers)
    .where(and(eq(handoffOffers.taskId, taskId), eq(handoffOffers.kind, 'work_request')))
    .all();
}

function claimsOf(taskId: string) {
  return h.db
    .select({ agentId: taskClaims.agentId, state: taskClaims.state })
    .from(taskClaims)
    .where(eq(taskClaims.taskId, taskId))
    .all();
}

describe('start_working on a task with a selected agent (D-119)', () => {
  it('the selected agent claims, and its work request is accepted', async () => {
    const polly = await register('Polly · Belka');
    const task = await newTask();
    await select(task.id, polly.agent.id);
    const client = await connect(polly.secret);

    const out = await succeeded(client, 'start_working', { task: task.key });

    expect((out.claim as { generation: number }).generation).toBe(1);
    expect(requests(task.id)).toEqual([{ toAgentId: polly.agent.id, state: 'accepted' }]);
    await client.close();
  });

  it('another agent is conflict, selected_for_another_agent, naming the selected agent; the request stays open', async () => {
    const polly = await register('Polly · Belka');
    const direct = await register('Claude Code · Belka');
    const task = await newTask();
    await select(task.id, polly.agent.id);
    const client = await connect(direct.secret);

    const r = await refused(client, 'start_working', { task: task.key });

    expect([r.code, r.reason]).toEqual(['conflict', 'selected_for_another_agent']);
    expect(r.details).toMatchObject({
      selected_agent_id: polly.agent.id,
      selected_agent: { id: polly.agent.id, display_name: 'Polly · Belka' },
    });
    expect(claimsOf(task.id)).toEqual([]);
    expect(requests(task.id)).toEqual([{ toAgentId: polly.agent.id, state: 'open' }]);
    await client.close();
  });

  it('with no selected agent any eligible agent claims', async () => {
    const direct = await register('Claude Code · Belka');
    const task = await newTask();
    const client = await connect(direct.secret);

    await succeeded(client, 'start_working', { task: task.key });

    expect(claimsOf(task.id)).toEqual([{ agentId: direct.agent.id, state: 'active' }]);
    await client.close();
  });

  it('reclaim: true is refused when the selection moved to another agent while the claim was expired', async () => {
    const polly = await register('Polly · Belka');
    const direct = await register('Claude Code · Belka');
    const task = await newTask();
    await select(task.id, direct.agent.id);
    const client = await connect(direct.secret);
    await succeeded(client, 'start_working', { task: task.key });
    expireClaims(h.db, Date.now() + LEASE + 1);
    await select(task.id, polly.agent.id);

    const r = await refused(client, 'start_working', { task: task.key, reclaim: true });

    expect([r.code, r.reason]).toEqual(['conflict', 'selected_for_another_agent']);
    expect(claimsOf(task.id)).toEqual([{ agentId: direct.agent.id, state: 'expired' }]);
    await client.close();
  });

  it('a read-only agent hears forbidden, and nothing about the selection', async () => {
    const polly = await register('Polly · Belka');
    const reader = await register('Reader', 'read_only');
    const task = await newTask();
    await select(task.id, polly.agent.id);
    const client = await connect(reader.secret);

    const r = await refused(client, 'start_working', { task: task.key });

    expect(r.code).toBe('forbidden');
    expect(r.text).not.toContain(polly.agent.id);
    expect(r.text).not.toContain('Polly');
    await client.close();
  });

  it('reads and comments are not refused to another agent', async () => {
    const polly = await register('Polly · Belka');
    const direct = await register('Claude Code · Belka');
    const task = await newTask();
    await select(task.id, polly.agent.id);
    const client = await connect(direct.secret);

    await succeeded(client, 'get_task_context', { task: task.key });
    await succeeded(client, 'add_comment', { task: task.key, body: 'for Polly' });
    await client.close();
  });
});

describe('start_working against a task the caller cannot see (LAI-586 review)', () => {
  /** Everything the tool answered, as the agent receives it. */
  async function answer(client: Client, args: Record<string, unknown>) {
    const result = await client.callTool({ name: 'start_working', arguments: args });
    expect(result.isError).toBe(true);
    return JSON.stringify({ content: result.content, structured: result.structuredContent });
  }

  async function outsider() {
    const beta = await must(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: 'beta', slug: 'beta', prefix: 'BET' }) },
      ownerCookie,
    );
    await must(
      '/api/v1/projects/beta/members',
      { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
      ownerCookie,
    );
    return (await must(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'Codex · Strelka',
          harness: 'codex',
          grants: [{ project_id: beta.id as string, scope: 'full' }],
        }),
      },
      bob.cookie,
    )) as unknown as { agent: { id: string }; secret: string };
  }

  for (const reclaim of [false, true]) {
    it(`${reclaim ? 'reclaim: true' : 'a claim'} — a hidden selected task answers byte for byte as a missing one, by key and by id`, async () => {
      const polly = await register('Polly · Belka');
      const task = await newTask();
      await select(task.id, polly.agent.id);
      const client = await connect((await outsider()).secret);
      const extra = reclaim ? { reclaim: true } : {};

      const byKey = await answer(client, { task: task.key, ...extra });
      const missingKey = await answer(client, { task: 'ALP-999', ...extra });
      const byId = await answer(client, { task: task.id, ...extra });
      const missingId = await answer(client, { task: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', ...extra });

      expect(byKey).toEqual(missingKey);
      expect(byId).toEqual(missingId);
      expect(byKey).toEqual(byId);
      expect(byKey).toContain('not_found');
      for (const text of [byKey, byId]) {
        expect(text).not.toContain(polly.agent.id);
        expect(text).not.toContain('Polly');
        expect(text).not.toContain(task.id);
      }
      await client.close();
    });
  }
});

describe('start_working by an agent holding a claim it is not selected for', () => {
  it('cannot renew it with its own session: selected_for_another_agent, lease unchanged', async () => {
    const polly = await register('Polly · Belka');
    const direct = await register('Claude Code · Belka');
    const task = await newTask();
    const client = await connect(direct.secret);
    const first = (await succeeded(client, 'start_working', { task: task.key })).claim as {
      session_id: string;
    };
    h.db.update(tasks).set({ selectedAgentId: polly.agent.id }).where(eq(tasks.id, task.id)).run();
    const before = h.db.select().from(taskClaims).where(eq(taskClaims.taskId, task.id)).all();

    const r = await refused(client, 'start_working', {
      task: task.key,
      session_id: first.session_id,
    });

    expect([r.code, r.reason]).toEqual(['conflict', 'selected_for_another_agent']);
    expect(h.db.select().from(taskClaims).where(eq(taskClaims.taskId, task.id)).all()).toEqual(
      before,
    );
    await client.close();
  });
});

describe('review round 2 over MCP', () => {
  function adaId(): string {
    return h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  }

  it('a task assigned to another person: a non-selected agent hears selected_for_another_agent', async () => {
    const polly = await register('Polly · Belka');
    const direct = await register('Claude Code · Belka');
    const task = await newTask();
    await must(
      `/api/v1/tasks/${task.id}`,
      { method: 'PATCH', body: JSON.stringify({ assignee_id: adaId() }) },
      bob.cookie,
      200,
    );
    await select(task.id, polly.agent.id);
    const client = await connect(direct.secret);

    const r = await refused(client, 'start_working', { task: task.key });

    expect([r.code, r.reason]).toEqual(['conflict', 'selected_for_another_agent']);
    expect(r.details?.selected_agent_id).toBe(polly.agent.id);
    expect(claimsOf(task.id)).toEqual([]);
    await client.close();
  });

  it('reclaim: true accepts the work request re-issued while the claim was expired', async () => {
    const polly = await register('Polly · Belka');
    const direct = await register('Claude Code · Belka');
    const task = await newTask();
    await select(task.id, polly.agent.id);
    const client = await connect(polly.secret);
    await succeeded(client, 'start_working', { task: task.key });
    expireClaims(h.db, Date.now() + LEASE + 1);
    await select(task.id, direct.agent.id);
    await select(task.id, polly.agent.id);

    await succeeded(client, 'start_working', { task: task.key, reclaim: true });

    expect(requests(task.id)).toEqual([
      { toAgentId: polly.agent.id, state: 'accepted' },
      { toAgentId: direct.agent.id, state: 'cancelled' },
      { toAgentId: polly.agent.id, state: 'accepted' },
    ]);
    expect(claimsOf(task.id)).toEqual([
      { agentId: polly.agent.id, state: 'expired' },
      { agentId: polly.agent.id, state: 'active' },
    ]);
    await client.close();
  });
});
