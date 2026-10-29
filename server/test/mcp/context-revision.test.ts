import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentSessionContextDeliveries, orgs, users } from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';
import { applyCheckpointDelivery } from '../../src/services/checkpoints.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * Context revisions over MCP (proposal §4.6, SPEC §7.1, §7.3, LAI-555):
 * `context_revision` on every answer — a census over the live registry, so a
 * tool added later cannot slip past — delivery recorded per session, the
 * notice that names revisions and never the document, and a project the
 * caller cannot see answered exactly as a missing one.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let server: ReturnType<typeof serve>;
let baseUrl: URL;
let ownerCookie: string;
let bob: { cookie: string; id: string };
let alpha: string;

interface Stamp {
  project: string;
  revision: number;
  delivered_revision: number | null;
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

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

async function succeeded(client: Client, name: string, args: Record<string, unknown>) {
  const result = await call(client, name, args);
  expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
  return result;
}

function payload(result: ToolResult): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

function text(result: ToolResult): string {
  return (result.content as { text: string }[]).map((c) => c.text).join('\n');
}

/** The owner writes the brief over REST, naming the revision it replaces. */
async function writeBrief(contextMd: string, baseRevision: number) {
  await must(
    '/api/v1/projects/alpha/context',
    {
      method: 'PATCH',
      body: JSON.stringify({ context_md: contextMd, base_revision: baseRevision }),
    },
    ownerCookie,
    200,
  );
}

/** A device per fixture agent: D-120 allows one active agent per harness per device. */
let fixtureDevices = 0;

async function registerAgent(name = 'Bob’s Codex') {
  return (await must(
    '/api/v1/agents',
    {
      method: 'POST',
      body: JSON.stringify({
        display_name: name,
        harness: 'codex',
        device_label: `device-${++fixtureDevices}`,
        grants: [{ project_id: alpha, scope: 'full' }],
      }),
    },
    bob.cookie,
  )) as unknown as { agent: { id: string }; secret: string };
}

async function ownerToken(): Promise<string> {
  const body = await must(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'owner', scope: 'full' }) },
    ownerCookie,
  );
  return body.secret as string;
}

async function newTask(title = 'Work'): Promise<string> {
  const body = await must(
    '/api/v1/projects/alpha/tasks',
    { method: 'POST', body: JSON.stringify({ title }) },
    bob.cookie,
  );
  return body.key as string;
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
  // A project Bob is not on, and so cannot see.
  await must(
    '/api/v1/projects',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'secret',
        slug: 'secret',
        prefix: 'SEC',
        visibility: 'private',
      }),
    },
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

/**
 * The tools only a registered agent holding a claim can answer (§4.70 – §4.73,
 * LAI-545, LAI-546). A person's token is refused them, so the census calls
 * them as agents, in the order a hand-off takes.
 */
const AGENT_ONLY_TOOLS = new Set([
  'agent_sync',
  'checkpoint_task',
  'offer_handoff',
  'respond_handoff',
]);

describe('context_revision on every answer (census over the registry)', () => {
  /**
   * Every registered tool, called once in an order that lets each succeed.
   * The list is checked against `listTools()` from both sides, so a new tool
   * fails here until it is added — and then it is stamped by construction.
   */
  it('every tool that answers carries context_revision', async () => {
    await writeBrief('The brief', 0);
    const client = await connect(await ownerToken());
    const ctx: { key?: string; sprint?: string } = {};

    const steps: [string, () => Record<string, unknown>, 'alpha' | null][] = [
      ['laika_whoami', () => ({}), null],
      ['list_projects', () => ({}), null],
      ['list_ready_tasks', () => ({ project: 'alpha' }), 'alpha'],
      ['create_task', () => ({ project: 'alpha', title: 'Census' }), 'alpha'],
      ['get_task_context', () => ({ task: ctx.key }), 'alpha'],
      ['get_project_context', () => ({ project: 'alpha' }), 'alpha'],
      ['list_sprints', () => ({ project: 'alpha' }), 'alpha'],
      ['list_members', () => ({ project: 'alpha' }), 'alpha'],
      [
        'create_sprint',
        () => ({
          project: 'alpha',
          name: 'S1',
          start_date: '2026-11-02',
          end_date: '2026-11-13',
        }),
        'alpha',
      ],
      ['update_sprint', () => ({ sprint: ctx.sprint, name: 'S1b' }), 'alpha'],
      ['set_task_sprint', () => ({ task: ctx.key, sprint: ctx.sprint }), 'alpha'],
      ['update_task', () => ({ task: ctx.key, title: 'Census 2' }), 'alpha'],
      ['update_status', () => ({ task: ctx.key, status: 'todo' }), 'alpha'],
      ['start_working', () => ({ task: ctx.key }), 'alpha'],
      ['add_comment', () => ({ task: ctx.key, body: 'Noted' }), 'alpha'],
      ['finish_task', () => ({ task: ctx.key, summary: 'Done' }), 'alpha'],
      [
        'update_project_context',
        () => ({ project: 'alpha', context_md: 'More', mode: 'append' }),
        'alpha',
      ],
      ['log_unlisted_work', () => ({ repo: 'acme/tools', note: 'An idea' }), null],
    ];
    // Refused by design on this org (time drafts are off), so there is no
    // answer to stamp — and a refusal must stay §6.3's envelope, unstamped.
    const refusedHere = new Set(['propose_time_entry']);

    const registry = (await client.listTools()).tools.map((t) => t.name).sort();
    expect([...steps.map(([name]) => name), ...refusedHere, ...AGENT_ONLY_TOOLS].sort()).toEqual(
      registry,
    );

    for (const [name, args, project] of steps) {
      const result = await succeeded(client, name, args());
      const out = payload(result);
      expect(out, name).toHaveProperty('context_revision');
      const stamp = out.context_revision as Stamp | null;
      if (project === null) {
        expect(stamp, name).toBeNull();
      } else {
        expect(stamp, name).toMatchObject({ project, delivered_revision: null });
        expect(stamp?.revision, name).toBeGreaterThanOrEqual(1);
      }
      if (name === 'create_task') ctx.key = (out.task as { key: string }).key;
      if (name === 'create_sprint') ctx.sprint = (out.sprint as { id: string }).id;
    }

    const refused = await call(client, 'propose_time_entry', { minutes: 5 });
    expect(refused.isError).toBe(true);
    expect(payload(refused)).not.toHaveProperty('context_revision');

    await client.close();
  });

  it('the agent-only tools carry it too: save, offer, inbox, accept (§4.70 – §4.73)', async () => {
    await writeBrief('The brief', 0);
    await must(
      '/api/v1/projects/alpha',
      { method: 'PATCH', body: JSON.stringify({ repo: 'kvelld/laika' }) },
      ownerCookie,
      200,
    );
    const sender = await registerAgent('Sender');
    const receiver = (await must(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'Receiver',
          harness: 'claude-code',
          grants: [{ project_id: alpha, scope: 'full' }],
        }),
      },
      bob.cookie,
    )) as unknown as { agent: { id: string }; secret: string };
    const key = await newTask();
    const from = await connect(sender.secret);
    const to = await connect(receiver.secret);
    const sha = 'c'.repeat(40);
    // The stamp is for the project the call names (§7.1): `respond_handoff`
    // names only an offer, so its stamp is null, as `log_unlisted_work`'s is.
    const stamped = (name: string, out: Record<string, unknown>, project: 'alpha' | null) => {
      expect(out, name).toHaveProperty('context_revision');
      if (project === null) expect(out.context_revision, name).toBeNull();
      else expect(out.context_revision, name).toMatchObject({ project });
    };
    const seen: string[] = [];

    const started = payload(await succeeded(from, 'start_working', { task: key }));
    const generation = (started.claim as { generation: number }).generation;

    const checkpointId = newId();
    const saved = payload(
      await succeeded(from, 'checkpoint_task', {
        task: key,
        id: checkpointId,
        idempotency_key: 'census-save',
        repo: 'kvelld/laika',
        branch: `${key}-work`,
        commit_sha: sha,
        manifest: [{ path: 'src/a.ts', added: 1, removed: 0 }],
        claim_generation: generation,
      }),
    );
    stamped('checkpoint_task', saved, 'alpha');
    seen.push('checkpoint_task');
    const remoteRef = (saved.checkpoint as { remote_ref: string }).remote_ref;
    // Verified as the signed webhook would (§10.1): what is under test here
    // is the answer's stamp, not the signature.
    expect(
      applyCheckpointDelivery(
        h.t.sqlite,
        h.db,
        {
          deliveryId: 'census-delivery',
          repo: 'kvelld/laika',
          ref: remoteRef,
          before: '0'.repeat(40),
          after: sha,
        },
        Date.now(),
      ).state,
    ).toBe('verified');

    const offered = payload(
      await succeeded(from, 'offer_handoff', {
        task: key,
        to_agent: receiver.agent.id,
        checkpoint: checkpointId,
        reason: 'Out of time',
        idempotency_key: 'census-offer',
        claim_generation: generation,
      }),
    );
    stamped('offer_handoff', offered, 'alpha');
    seen.push('offer_handoff');

    const inbox = payload(await succeeded(to, 'agent_sync', { project: 'alpha' }));
    stamped('agent_sync', inbox, 'alpha');
    seen.push('agent_sync');

    const accepted = payload(
      await succeeded(to, 'respond_handoff', {
        offer: (offered.offer as { id: string }).id,
        action: 'accept',
        verified_commit_sha: sha,
      }),
    );
    stamped('respond_handoff', accepted, null);
    seen.push('respond_handoff');

    expect(seen.sort()).toEqual([...AGENT_ONLY_TOOLS].sort());
    await from.close();
    await to.close();
  });

  it('laika_whoami keeps its text and gains the same payload', async () => {
    const client = await connect(await ownerToken());
    const result = await succeeded(client, 'laika_whoami', {});

    expect(JSON.parse(text(result))).toMatchObject({ email: 'ada@example.test' });
    expect(payload(result)).toMatchObject({ email: 'ada@example.test', context_revision: null });
    await client.close();
  });
});

describe('delivery to a session (§4.69)', () => {
  it('records the revision delivered, and stamps it on later answers', async () => {
    await writeBrief('one', 0);
    const { secret } = await registerAgent();
    const key = await newTask();
    const client = await connect(secret);

    const started = payload(await succeeded(client, 'start_working', { task: key }));
    const session = (started.claim as { session_id: string }).session_id;
    // Nothing delivered yet: the stamp says so, and asks for nothing.
    expect(started.context_revision).toEqual({
      project: 'alpha',
      revision: 1,
      delivered_revision: null,
    });

    const read = await succeeded(client, 'get_project_context', {
      project: 'alpha',
      session_id: session,
    });
    expect(text(read)).toContain('one');
    expect(payload(read).context_revision).toMatchObject({ revision: 1, delivered_revision: 1 });
    expect(h.db.select().from(agentSessionContextDeliveries).all()).toEqual([
      expect.objectContaining({ sessionId: session, projectId: alpha, revision: 1 }),
    ]);

    // Current, so no notice: the answer is the tool's own text and nothing else.
    const renewed = await succeeded(client, 'start_working', { task: key, session_id: session });
    expect(text(renewed)).not.toContain('Project context changed');
    expect(payload(renewed).context_revision).toMatchObject({
      revision: 1,
      delivered_revision: 1,
    });

    await client.close();
  });

  it('a session behind gets a short notice naming revisions, never the document', async () => {
    await writeBrief('one', 0);
    const { secret } = await registerAgent();
    const key = await newTask();
    const client = await connect(secret);
    const started = payload(await succeeded(client, 'start_working', { task: key }));
    const session = (started.claim as { session_id: string }).session_id;
    await succeeded(client, 'get_project_context', { project: 'alpha', session_id: session });

    await writeBrief('one\nSECRET-SECOND-LINE', 1);

    const renewed = await succeeded(client, 'start_working', { task: key, session_id: session });
    const notice = (renewed.content as { text: string }[]).at(-1)?.text ?? '';
    expect(notice).toBe(
      'Project context changed: r1 → r2. Call get_project_context with since_revision: 1 for the diff.',
    );
    expect(notice.length).toBeLessThanOrEqual(300);
    expect(text(renewed)).not.toContain('SECRET-SECOND-LINE');
    expect(payload(renewed).context_revision).toMatchObject({
      revision: 2,
      delivered_revision: 1,
    });

    await client.close();
  });

  it('since_revision answers a diff, not the whole document, and delivers the current one', async () => {
    await writeBrief('keep\nold', 0);
    await writeBrief('keep\nnew', 1);
    const { secret } = await registerAgent();
    const key = await newTask();
    const client = await connect(secret);
    const started = payload(await succeeded(client, 'start_working', { task: key }));
    const session = (started.claim as { session_id: string }).session_id;

    const result = await succeeded(client, 'get_project_context', {
      project: 'alpha',
      since_revision: 1,
      session_id: session,
    });
    const out = payload(result);

    expect(out.context).not.toHaveProperty('context_md');
    expect(out.context).toMatchObject({ revision: 2 });
    expect(out.context_diff).toMatchObject({
      from_revision: 1,
      to_revision: 2,
      diff: '@@ -1,2 +1,2 @@\n keep\n-old\n+new',
    });
    expect(text(result)).toContain('-old');
    expect(out.context_revision).toMatchObject({ revision: 2, delivered_revision: 2 });

    await client.close();
  });

  it('a truncated diff sends no text, says how to read it whole, and delivers nothing', async () => {
    const doc = (prefix: string) =>
      Array.from({ length: 1001 }, (_, i) => `${prefix} ${String(i)}`).join('\n');
    await writeBrief(doc('old'), 0);
    await writeBrief(doc('new'), 1);
    const { secret } = await registerAgent();
    const key = await newTask();
    const client = await connect(secret);
    const started = payload(await succeeded(client, 'start_working', { task: key }));
    const session = (started.claim as { session_id: string }).session_id;

    const result = await succeeded(client, 'get_project_context', {
      project: 'alpha',
      since_revision: 1,
      session_id: session,
    });
    const out = payload(result);

    expect(out.context).not.toHaveProperty('context_md');
    expect(out.context_diff).toMatchObject({ truncated: true, diff: '', added: null });
    expect(text(result)).toContain('get_project_context without since_revision');
    expect(text(result)).not.toContain('new 500');
    // Nothing of revision 2 was sent, so it was not delivered.
    expect(h.db.select().from(agentSessionContextDeliveries).all()).toEqual([]);
    expect(out.context_revision).toMatchObject({ revision: 2, delivered_revision: null });

    await client.close();
  });

  it('another agent’s session is 404 and nothing is recorded', async () => {
    await writeBrief('one', 0);
    const first = await registerAgent('First');
    const second = await registerAgent('Second');
    const key = await newTask();
    const a = await connect(first.secret);
    const b = await connect(second.secret);
    const started = payload(await succeeded(a, 'start_working', { task: key }));
    const session = (started.claim as { session_id: string }).session_id;

    const result = await call(b, 'get_project_context', { project: 'alpha', session_id: session });
    expect(result.isError).toBe(true);
    expect((payload(result).error as { code: string }).code).toBe('not_found');
    expect(h.db.select().from(agentSessionContextDeliveries).all()).toEqual([]);

    await a.close();
    await b.close();
  });

  it('says delivered, never understood', async () => {
    const client = await connect(await ownerToken());
    const tool = (await client.listTools()).tools.find((t) => t.name === 'get_project_context');
    expect(tool?.description).toMatch(/delivered/);
    expect(tool?.description).not.toMatch(/understood|understands/i);
    await client.close();
  });
});

describe('optimistic writes over MCP', () => {
  it('replace names its base revision; a stale one is 409 and changes nothing', async () => {
    await writeBrief('one', 0);
    const client = await connect(await ownerToken());

    const missing = await call(client, 'update_project_context', {
      project: 'alpha',
      context_md: 'two',
      mode: 'replace',
    });
    expect((payload(missing).error as { code: string }).code).toBe('unprocessable');

    const stale = await call(client, 'update_project_context', {
      project: 'alpha',
      context_md: 'two',
      mode: 'replace',
      base_revision: 0,
    });
    expect(payload(stale).error).toMatchObject({
      code: 'conflict',
      details: { reason: 'stale_context_revision', base_revision: 0, current_revision: 1 },
    });

    const read = payload(await succeeded(client, 'get_project_context', { project: 'alpha' }));
    expect(read.context).toMatchObject({ context_md: 'one', revision: 1 });
    await client.close();
  });
});

describe('a project the caller cannot see answers exactly as a missing one', () => {
  const CASES = [
    ['get_project_context', {}],
    ['get_project_context', { since_revision: 0 }],
    ['update_project_context', { context_md: 'x', mode: 'append' }],
    ['update_project_context', { context_md: 'x', mode: 'replace', base_revision: 0 }],
  ] as const;

  async function compare(client: Client, code: string, reason: string | undefined) {
    for (const [name, args] of CASES) {
      const hidden = await call(client, name, { project: 'secret', ...args });
      const missing = await call(client, name, { project: 'nope', ...args });
      const hiddenBody = payload(hidden);
      const missingBody = payload(missing);

      expect(hidden.isError, name).toBe(true);
      expect((hiddenBody.error as { code: string }).code, name).toBe(code);
      expect((hiddenBody.error as { details?: { reason?: string } }).details?.reason, name).toBe(
        reason,
      );
      // The whole envelope, once the slug each names is set aside.
      expect(JSON.stringify(hiddenBody).replaceAll('secret', 'nope'), name).toBe(
        JSON.stringify(missingBody),
      );
    }
  }

  it('a person’s token: 404, as for a slug that names nothing', async () => {
    const body = await must(
      '/api/v1/tokens',
      { method: 'POST', body: JSON.stringify({ name: 'bob', scope: 'full' }) },
      bob.cookie,
    );
    const client = await connect(body.secret as string);
    await compare(client, 'not_found', undefined);
    await client.close();
  });

  it('an agent’s token: 403 agent_not_granted, as §6.4 answers any slug it may not use', async () => {
    const { secret } = await registerAgent();
    const client = await connect(secret);
    await compare(client, 'forbidden', 'agent_not_granted');
    await client.close();
  });
});
