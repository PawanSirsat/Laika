import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, taskClaims, tasks, users } from '../../src/db/schema.ts';
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
 * Claims over MCP (proposal §4.2, SPEC §7.1, LAI-541): `start_working` takes
 * and reclaims, `claim_generation` is fenced exactly as REST's header is —
 * the same service decides — and **every registered tool** is classified as
 * fenced or exempt, read from a live `listTools()`, so a tool added later
 * cannot slip past unclassified.
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
  error: { code: string; details: { reason?: unknown } | null };
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
  return { code: body.error.code, reason: body.error.details?.reason };
}

async function succeeded(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
}

async function register(name = 'Bob’s Codex') {
  return (await must(
    '/api/v1/agents',
    {
      method: 'POST',
      body: JSON.stringify({
        display_name: name,
        harness: 'codex',
        grants: [{ project_id: alpha, scope: 'full' }],
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

interface ClaimOut {
  generation: number;
  session_id: string;
}

describe('start_working on a registered agent’s token', () => {
  it('answers the claim — session and generation — beside the task', async () => {
    const { agent, secret } = await register();
    const task = await newTask();
    const client = await connect(secret);

    const out = await succeeded(client, 'start_working', { task: task.key });

    expect(out.claim).toMatchObject({ generation: 1, agent_id: agent.id, state: 'active' });
    await client.close();
  });

  it('a second session of the same person is claim_held, as over REST', async () => {
    const first = await register('First');
    const second = await register('Second');
    const task = await newTask();
    const a = await connect(first.secret);
    const b = await connect(second.secret);

    await succeeded(a, 'start_working', { task: task.key });
    expect(await refused(b, 'start_working', { task: task.key })).toEqual({
      code: 'conflict',
      reason: 'claim_held',
    });
    await a.close();
    await b.close();
  });

  it('reclaim: true takes an expired claim back at generation + 1; the old generation stays refused', async () => {
    const { secret } = await register();
    const task = await newTask();
    const client = await connect(secret);
    const first = (await succeeded(client, 'start_working', { task: task.key })).claim as ClaimOut;

    expireClaims(h.db, Date.now() + LEASE + 1);

    expect(
      await refused(client, 'update_task', {
        task: task.key,
        title: 'Zombie',
        claim_generation: 1,
      }),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    // A plain start_working from the same session is not a reclaim.
    expect(
      await refused(client, 'start_working', { task: task.key, session_id: first.session_id }),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });

    const back = await succeeded(client, 'start_working', {
      task: task.key,
      session_id: first.session_id,
      reclaim: true,
    });
    expect(back.claim).toMatchObject({ generation: 2, state: 'active' });

    expect(
      await refused(client, 'update_task', { task: task.key, title: 'Old', claim_generation: 1 }),
    ).toEqual({ code: 'conflict', reason: 'stale_claim' });
    await succeeded(client, 'update_task', { task: task.key, title: 'New', claim_generation: 2 });
    expect(h.db.select().from(tasks).where(eq(tasks.id, task.id)).get()?.title).toBe('New');
    expect(
      h.db
        .select()
        .from(taskClaims)
        .where(eq(taskClaims.taskId, task.id))
        .all()
        .map((c) => [c.generation, c.state]),
    ).toEqual([
      [1, 'expired'],
      [2, 'active'],
    ]);
    await client.close();
  });
});

// ---------------------------------------------------------------- the census

interface Fixture {
  key: string;
  sprint: string;
}

/** Each fenced tool, with arguments that would change the claimed task. */
const FENCED: Record<string, (f: Fixture) => Record<string, unknown>> = {
  update_task: (f) => ({ task: f.key, title: 'Stale' }),
  update_status: (f) => ({ task: f.key, status: 'review' }),
  finish_task: (f) => ({ task: f.key, summary: 'Stale' }),
  set_task_sprint: (f) => ({ task: f.key, sprint: f.sprint }),
  // §4.70 (LAI-545): a save is a change the fence refuses to a stale claim,
  // before the repo or anything else about it is looked at.
  checkpoint_task: (f) => ({
    task: f.key,
    id: '01JCXXXXXXXXXXXXXXXXXXXXXX',
    idempotency_key: 'stale-save',
    repo: 'kvelld/laika',
    branch: `${f.key}-work`,
    commit_sha: 'a'.repeat(40),
    manifest: [],
  }),
  // §4.73 (LAI-546): an offer is a change the fence refuses to a stale claim,
  // before the checkpoint or the receiver is looked at.
  offer_handoff: (f) => ({
    task: f.key,
    to_agent: '01JRECEIVERXXXXXXXXXXXXXXX',
    checkpoint: '01JCXXXXXXXXXXXXXXXXXXXXXX',
    reason: 'Stale',
    idempotency_key: 'stale-offer',
  }),
};

/** Every other tool, and why it is not fenced. */
const EXEMPT: Record<string, string> = {
  start_working: 'takes, resumes or reclaims the claim — asserted above',
  add_comment: 'comments are never fenced',
  create_task: 'a new task has no claim; its blockers and sprint are on the new task',
  propose_time_entry: "a draft in the person's own time, not a change to the task",
  log_unlisted_work: 'belongs to no task',
  laika_whoami: 'reads nothing',
  list_projects: 'a read',
  list_ready_tasks: 'a read',
  get_task_context: 'a read',
  get_project_context: 'a read',
  list_sprints: 'a read',
  list_members: 'a read',
  agent_sync: 'a read',
  respond_handoff:
    'answers an offer by id, not a task: the accept moves the claim itself, in one transaction (test/services/handoffs.test.ts)',
  create_sprint: 'a sprint, not a task',
  update_sprint: 'a sprint, not a task — its tasks are untouched',
  update_project_context: 'the project brief, not a task',
};

describe('the live claim never reaches a caller who cannot read the task (LAI-568)', () => {
  /** A second project Bob is a member of, so a restriction is the only thing in the way. */
  async function beta(): Promise<string> {
    const created = await must(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: 'beta', slug: 'beta', prefix: 'BET' }) },
      ownerCookie,
    );
    await must(
      '/api/v1/projects/beta/members',
      { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
      ownerCookie,
    );
    return created.id as string;
  }

  async function agentOn(projectIds: string[]): Promise<string> {
    return (
      await must(
        '/api/v1/agents',
        {
          method: 'POST',
          body: JSON.stringify({
            display_name: 'Elsewhere',
            harness: 'codex',
            grants: projectIds.map((project_id) => ({ project_id, scope: 'full' })),
          }),
        },
        bob.cookie,
      )
    ).secret as string;
  }

  async function bobToken(projectIds: string[] | null): Promise<string> {
    return (
      await must(
        '/api/v1/tokens',
        {
          method: 'POST',
          body: JSON.stringify({ name: 'reader', scope: 'full', project_ids: projectIds }),
        },
        bob.cookie,
      )
    ).secret as string;
  }

  /** A task held by Bob's agent, and the holder's session id. */
  async function held(): Promise<{ key: string; session: string }> {
    const { secret } = await register();
    const task = await newTask();
    const holder = await connect(secret);
    const out = await succeeded(holder, 'start_working', { task: task.key });
    await holder.close();
    return { key: task.key, session: (out.claim as ClaimOut).session_id };
  }

  /** `get_task_context` as `secret`: the claim when readable, else the refusal and its text. */
  async function context(secret: string, key: string) {
    const client = await connect(secret);
    const result = await client.callTool({ name: 'get_task_context', arguments: { task: key } });
    await client.close();
    return { result, text: JSON.stringify(result) };
  }

  it('a granted agent reads it; an agent with no grant on the project is refused without it', async () => {
    const betaId = await beta();
    const { key, session } = await held();

    // Positive control: the same read on an agent granted alpha carries the claim.
    const granted = await context(await agentOn([alpha]), key);
    expect(granted.result.isError, granted.text).not.toBe(true);
    const task = (granted.result.structuredContent as { task: { claim: unknown } }).task;
    expect(task.claim).toMatchObject({ session_id: session, state: 'active' });

    const ungranted = await context(await agentOn([betaId]), key);
    expect(ungranted.result.isError, ungranted.text).toBe(true);
    expect((ungranted.result.structuredContent as ErrorBody).error).toMatchObject({
      code: 'forbidden',
      details: { action: 'project.read', reason: 'agent_not_granted' },
    });
    expect(ungranted.text).not.toContain(session);
  });

  it('an unpinned token reads it; one pinned to another project is refused without it', async () => {
    const betaId = await beta();
    const { key, session } = await held();

    const unpinned = await context(await bobToken(null), key);
    expect(unpinned.result.isError, unpinned.text).not.toBe(true);
    const task = (unpinned.result.structuredContent as { task: { claim: unknown } }).task;
    expect(task.claim).toMatchObject({ session_id: session, state: 'active' });

    const pinned = await context(await bobToken([betaId]), key);
    expect(pinned.result.isError, pinned.text).toBe(true);
    expect((pinned.result.structuredContent as ErrorBody).error).toMatchObject({
      code: 'forbidden',
      details: { action: 'project.read' },
    });
    expect(pinned.text).not.toContain(session);
  });
});

describe('the census: every tool is fenced or named', () => {
  it('the tools the server registers are exactly FENCED and EXEMPT', async () => {
    const { secret } = await register();
    const client = await connect(secret);
    const registered = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(registered.length).toBeGreaterThan(10);
    expect(registered).toEqual([...Object.keys(FENCED), ...Object.keys(EXEMPT)].sort());
    await client.close();
  });

  for (const tool of Object.keys(FENCED)) {
    it(`${tool} refuses a stale claim_generation with stale_claim, and changes nothing`, async () => {
      const { secret } = await register();
      const task = await newTask();
      const sprint = (
        await must(
          '/api/v1/projects/alpha/sprints',
          {
            method: 'POST',
            body: JSON.stringify({
              name: 'S1',
              starts_on: Date.UTC(2026, 0, 1),
              ends_on: Date.UTC(2026, 0, 14),
            }),
          },
          ownerCookie,
        )
      ).id as string;
      const client = await connect(secret);
      await succeeded(client, 'start_working', { task: task.key });
      const before = h.db.select().from(tasks).where(eq(tasks.id, task.id)).get();

      expect(
        await refused(client, tool, {
          ...FENCED[tool]!({ key: task.key, sprint }),
          claim_generation: 2,
        }),
      ).toEqual({ code: 'conflict', reason: 'stale_claim' });
      expect(h.db.select().from(tasks).where(eq(tasks.id, task.id)).get()).toEqual(before);
      await client.close();
    });
  }
});
