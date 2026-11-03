import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../src/db/ids.ts';
import {
  activity,
  agentEventDeliveries,
  agentLauncherReports,
  capacityPings,
  orgs,
  projects,
  users,
} from '../../../src/db/schema.ts';
import { resetCapacityPingRateLimits } from '../../../src/services/agent-capacity.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * Capacity pings and launcher presence over the real routes, the real
 * `/api/v1/events` stream and the real MCP endpoint (SPEC §4.83, §4.84,
 * §6.4, §7.1, §11.5, D-126, LAI-1038). The clocks — the repeat window, the
 * minute, the buckets refilling, retention — are the service's test.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let server: ReturnType<typeof serve>;
let baseUrl: URL;
let cookie: string;
let projectId: string;
let taskId: string;
let mine: { id: string; secret: string };
let pinger: { id: string; secret: string };
let bystander: { id: string; secret: string };

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}

interface Ping {
  id: string;
  agent_id: string;
  project_id: string;
  task_id: string | null;
  state: string;
  requested_by: { user_id: string; agent_id: string | null };
  created_at: number;
  expires_at: number;
  answered_at: number | null;
  answer: unknown;
}

async function ok(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function errorOf(res: Response, status: number) {
  expect(res.status, await res.clone().text()).toBe(status);
  return ((await res.json()) as ErrorBody).error;
}

function bearer(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}` };
}

function send(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  return h.app.request(path, {
    method,
    headers: jsonHeaders(headers),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

let fixtureDevices = 0;

async function agent(
  name: string,
  ownerCookie = cookie,
  scope: 'full' | 'read_only' = 'full',
): Promise<{ id: string; secret: string }> {
  const body = await ok(
    await send(
      'POST',
      '/api/v1/agents',
      { Cookie: ownerCookie },
      {
        display_name: name,
        harness: 'claude-code',
        device_label: `device-${String(++fixtureDevices)}`,
        grants: [{ project_id: projectId, scope }],
      },
    ),
    201,
  );
  return { id: (body.agent as { id: string }).id, secret: body.secret as string };
}

/** Bob, a member of the project, signed in. */
async function bob(): Promise<{ cookie: string; id: string }> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const adaId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  const invite = seedInvite(h.db, { orgId, createdBy: adaId, email: 'bob@example.test' });
  const signed = await signUp(h.app, {
    email: 'bob@example.test',
    password: PASSWORD,
    inviteToken: invite,
  });
  expect(signed.status).toBe(200);
  const bobId = h.db.select().from(users).where(eq(users.email, 'bob@example.test')).get()!.id;
  await ok(
    await send(
      'POST',
      '/api/v1/projects/laika/members',
      { Cookie: cookie },
      { user_id: bobId, role: 'member' },
    ),
    201,
  );
  return { cookie: cookieFrom(signed), id: bobId };
}

async function allowOtherOwners() {
  await ok(
    await send(
      'PUT',
      '/api/v1/projects/laika/handoff-policy',
      { Cookie: cookie },
      { allow_other_owners: true, cross_owner_requires_approval: false },
    ),
    200,
  );
}

function pingAs(headers: Record<string, string>, agentId: string, body: Record<string, unknown>) {
  return send('POST', `/api/v1/agents/${agentId}/capacity-pings`, headers, body);
}

async function pinged(headers: Record<string, string>, agentId: string, body = {}): Promise<Ping> {
  const made = await ok(await pingAs(headers, agentId, { project: 'laika', ...body }), 201);
  expect(made.created).toBe(true);
  return made.ping as Ping;
}

const ANSWER = {
  launcher: {
    state: 'on',
    auto_pickup: { work_requests: true, handoffs: false },
    running: 0,
    max_concurrent: 1,
  },
  harness_ready: { credential: true, argv: true, hooks: true },
  session_live: true,
  battery: { state: 'ok', percent: 64, plugged: true },
  memory: { state: 'normal' },
  cli_version: '0.9.3',
  answered_by: 'launcher',
};

function reply(secret: string, pingId: string, body: unknown = ANSWER) {
  return send('POST', `/api/v1/agents/me/capacity-pings/${pingId}/reply`, bearer(secret), body);
}

const LAUNCHER = {
  enabled: true,
  auto_pickup: { work_requests: true, handoffs: true },
  running: 0,
  max_concurrent: 1,
  cli_version: '0.9.3',
  started_at: 1_790_000_000_000,
};

function report(secret: string, body: unknown = LAUNCHER) {
  return send('PUT', '/api/v1/agents/me/launcher', bearer(secret), body);
}

// ------------------------------------------------------------- reading frames

interface Frame {
  event: string | null;
  data: string;
}

function sseClient(res: Response) {
  const body = res.body;
  if (body === null) throw new Error('no response body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  async function raw(): Promise<string | null> {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        return frame;
      }
      const chunk = await reader.read();
      if (chunk.done) return null;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }
  return {
    async next(): Promise<Frame> {
      for (;;) {
        const text = await raw();
        if (text === null) throw new Error(`stream ended; buffered: ${JSON.stringify(buffer)}`);
        if (text.startsWith(':')) continue;
        const frame: Frame = { event: null, data: '' };
        const data: string[] = [];
        for (const line of text.split('\n')) {
          if (line.startsWith('event: ')) frame.event = line.slice(7);
          else if (line.startsWith('data: ')) data.push(line.slice(6));
        }
        frame.data = data.join('\n');
        return frame;
      }
    },
    async disconnect(): Promise<void> {
      await reader.cancel();
    },
  };
}

async function stream(headers: Record<string, string>) {
  const res = await h.app.request('/api/v1/events', { headers });
  expect(res.status).toBe(200);
  const client = sseClient(res);
  expect((await client.next()).event).toBe('ready');
  return client;
}

async function until(client: ReturnType<typeof sseClient>, type: string): Promise<Frame[]> {
  h.activityFeed.poll();
  const seen: Frame[] = [];
  for (;;) {
    const frame = await client.next();
    seen.push(frame);
    if (frame.event === type) return seen;
  }
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
  resetCapacityPingRateLimits();
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
  expect(setup.status, await setup.clone().text()).toBe(201);
  cookie = cookieFrom(setup);
  projectId = h.db.select().from(projects).get()!.id;
  const created = await ok(
    await send('POST', '/api/v1/projects/laika/tasks', { Cookie: cookie }, { title: 'Do it' }),
    201,
  );
  taskId = created.id as string;
  mine = await agent('Mine');
  pinger = await agent('Pinger');
  bystander = await agent('Bystander');

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

// ---------------------------------------------------------------------- ping

describe('POST /agents/:id/capacity-pings', () => {
  it('201: a person pings their own agent, with the task; the row is the activity', async () => {
    const ping = await pinged({ Cookie: cookie }, mine.id, { task_id: taskId });
    expect(ping).toMatchObject({
      agent_id: mine.id,
      project_id: projectId,
      task_id: taskId,
      state: 'pending',
      requested_by: { agent_id: null },
      answered_at: null,
      answer: null,
    });
    expect(ping.expires_at - ping.created_at).toBe(60_000);

    const row = h.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === 'agent.capacity_requested')!;
    expect(row).toMatchObject({ projectId, taskId, actorKind: 'user', agentId: null });
    expect(
      h.db
        .select()
        .from(agentEventDeliveries)
        .where(eq(agentEventDeliveries.activityId, row.id))
        .all()
        .map((d) => d.agentId),
    ).toEqual([mine.id]);
  });

  it('200 with the same ping for a repeat, and nothing written', async () => {
    const first = await pinged({ Cookie: cookie }, mine.id);
    const again = await ok(await pingAs({ Cookie: cookie }, mine.id, { project: 'laika' }), 200);
    expect(again).toEqual({ ping: first, created: false });
    expect(h.db.select().from(capacityPings).all()).toHaveLength(1);
  });

  it('another owner’s agent is byte for byte the 404 of an id that names no agent', async () => {
    const b = await bob();
    const bobs = await agent('Bob’s', b.cookie);
    const unknown = await pingAs({ Cookie: cookie }, newId(), { project: 'laika' });
    const others = await pingAs({ Cookie: cookie }, bobs.id, { project: 'laika' });
    const reverse = await pingAs({ Cookie: b.cookie }, mine.id, { project: 'laika' });
    // An agent's token, other owner, space not allowing it.
    const byAgent = await pingAs(bearer(pinger.secret), bobs.id, { project: 'laika' });

    expect(unknown.status).toBe(404);
    const body = await unknown.text();
    expect(JSON.parse(body)).toEqual({
      error: { code: 'not_found', message: 'No agent with that id', details: null },
    });
    for (const res of [others, reverse, byAgent]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(body);
    }
    expect(h.db.select().from(capacityPings).all()).toEqual([]);
  });

  it('an agent pings a sibling, and another owner’s once the space allows other owners', async () => {
    const b = await bob();
    const bobs = await agent('Bob’s', b.cookie);
    const sibling = await pinged(bearer(pinger.secret), mine.id);
    expect(sibling.requested_by.agent_id).toBe(pinger.id);
    await errorOf(await pingAs(bearer(pinger.secret), bobs.id, { project: 'laika' }), 404);
    await allowOtherOwners();
    await pinged(bearer(pinger.secret), bobs.id);
    // A read-only grant may not delegate.
    const reader = await agent('Reader', cookie, 'read_only');
    await errorOf(await pingAs(bearer(reader.secret), mine.id, { project: 'laika' }), 404);
  });

  it('refuses free text and a long wait: every body is closed', async () => {
    for (const body of [
      { project: 'laika', note: 'are you there?' },
      { project: 'laika', wait_ms: 10_001 },
      { task_id: taskId },
    ]) {
      expect((await errorOf(await pingAs({ Cookie: cookie }, mine.id, body), 422)).code).toBe(
        'unprocessable',
      );
    }
  });

  it('429 with Retry-After past 4 a minute from one requester to one agent', async () => {
    const tasks: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t = await ok(
        await send('POST', '/api/v1/projects/laika/tasks', { Cookie: cookie }, { title: `t${i}` }),
        201,
      );
      tasks.push(t.id as string);
    }
    await pinged({ Cookie: cookie }, mine.id);
    for (const id of tasks) await pinged({ Cookie: cookie }, mine.id, { task_id: id });
    const limited = await pingAs({ Cookie: cookie }, mine.id, {
      project: 'laika',
      task_id: taskId,
    });
    expect((await errorOf(limited, 429)).details).toEqual({
      reason: 'capacity_ping_rate',
      retry_after_seconds: 15,
    });
    expect(limited.headers.get('Retry-After')).toBe('15');
  });

  it('holds the request until the device answers', async () => {
    const started = Date.now();
    const held = pingAs({ Cookie: cookie }, mine.id, { project: 'laika', wait_ms: 8_000 });
    let row: { id: string } | undefined;
    for (let i = 0; i < 200 && row === undefined; i += 1) {
      row = h.db.select().from(capacityPings).get();
      if (row === undefined) await new Promise((r) => setTimeout(r, 5));
    }
    expect(row, 'the ping row never appeared').toBeDefined();
    await ok(await reply(mine.secret, row!.id), 200);
    const body = await ok(await held, 201);
    expect(body.ping).toMatchObject({ id: row!.id, state: 'answered', answer: ANSWER });
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it('answers pending when nothing answers within wait_ms', async () => {
    const body = await ok(
      await pingAs({ Cookie: cookie }, mine.id, { project: 'laika', wait_ms: 50 }),
      201,
    );
    expect((body.ping as Ping).state).toBe('pending');
  });
});

// --------------------------------------------------------------------- reply

describe('POST /agents/me/capacity-pings/:id/reply', () => {
  it('the pinged agent answers once; a second answer is 409 already_answered', async () => {
    const ping = await pinged({ Cookie: cookie }, mine.id);
    const answered = await ok(await reply(mine.secret, ping.id), 200);
    expect(answered.ping).toMatchObject({ id: ping.id, state: 'answered', answer: ANSWER });
    expect((await errorOf(await reply(mine.secret, ping.id), 409)).details).toMatchObject({
      reason: 'already_answered',
    });
  });

  it('an agent it was not addressed to gets the 404 of a ping that does not exist', async () => {
    const ping = await pinged({ Cookie: cookie }, mine.id);
    const unknown = await reply(bystander.secret, newId());
    const notAddressed = await reply(bystander.secret, ping.id);
    expect(unknown.status).toBe(404);
    expect(notAddressed.status).toBe(404);
    expect(await notAddressed.text()).toBe(await unknown.text());
  });

  it('a session cannot answer: 403 not_an_agent', async () => {
    const ping = await pinged({ Cookie: cookie }, mine.id);
    const res = await send(
      'POST',
      `/api/v1/agents/me/capacity-pings/${ping.id}/reply`,
      { Cookie: cookie },
      ANSWER,
    );
    expect((await errorOf(res, 403)).details).toMatchObject({ reason: 'not_an_agent' });
  });

  it('is a closed, capped object: an extra key, free text or an unknown reading as a number is 422', async () => {
    const ping = await pinged({ Cookie: cookie }, mine.id);
    const bad: unknown[] = [
      { ...ANSWER, host: 'pawans-macbook.local' },
      { ...ANSWER, battery: { state: 'ok', percent: 64, model: 'A2141' } },
      { ...ANSWER, battery: { state: 'unsupported', percent: 0 } },
      { ...ANSWER, memory: { state: 'plenty' } },
      { ...ANSWER, launcher: { state: 'off', running: 1 } },
      { ...ANSWER, launcher: { ...ANSWER.launcher, running: 5 } },
      { ...ANSWER, cli_version: '0.9.3 /Users/pawan/laika' },
      { ...ANSWER, answered_by: 'someone' },
    ];
    for (const body of bad) {
      expect((await errorOf(await reply(mine.secret, ping.id, body), 422)).code).toBe(
        'unprocessable',
      );
    }
    expect(h.db.select().from(capacityPings).get()!.answeredAt).toBeNull();
    // Its smallest form is taken.
    const minimal = {
      ...ANSWER,
      launcher: { state: 'off' },
      battery: { state: 'unavailable' },
      memory: { state: 'unsupported' },
      answered_by: 'session',
    };
    expect((await ok(await reply(mine.secret, ping.id, minimal), 200)).ping).toMatchObject({
      answer: minimal,
    });
  });
});

// ---------------------------------------------------------------------- read

describe('GET /capacity-pings/:id and GET /agents/:id/capacity', () => {
  it('whoever pinged and the agent’s owner read it; anyone else gets the unknown id’s 404', async () => {
    await allowOtherOwners();
    const b = await bob();
    const bobs = await agent('Bob’s', b.cookie);
    const ping = await pinged(bearer(pinger.secret), bobs.id);
    await ok(await reply(bobs.secret, ping.id), 200);

    const byAda = await ok(await send('GET', `/api/v1/capacity-pings/${ping.id}`, { Cookie: cookie }), 200);
    expect(byAda.ping).toMatchObject({ requested_by: { agent_id: pinger.id }, answer: ANSWER });
    const byBob = await ok(
      await send('GET', `/api/v1/capacity-pings/${ping.id}`, { Cookie: b.cookie }),
      200,
    );
    // The owner sees the answer, and not the other owner's agent.
    expect(byBob.ping).toMatchObject({ requested_by: { agent_id: null }, answer: ANSWER });

    const own = await pinged({ Cookie: b.cookie }, bobs.id);
    const hidden = await send('GET', `/api/v1/capacity-pings/${own.id}`, { Cookie: cookie });
    const unknown = await send('GET', `/api/v1/capacity-pings/${newId()}`, { Cookie: cookie });
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await unknown.text());
  });

  it('capacity: presence and the newest answer this reader may see', async () => {
    const ping = await pinged({ Cookie: cookie }, mine.id);
    await ok(await reply(mine.secret, ping.id), 200);
    await ok(await report(mine.secret), 200);
    const capacity = await ok(
      await send('GET', `/api/v1/agents/${mine.id}/capacity?project=laika`, { Cookie: cookie }),
      200,
    );
    expect(capacity).toMatchObject({
      agent_id: mine.id,
      launcher: { state: 'on', running: 0, max_concurrent: 1 },
      latest_answer: { id: ping.id, answer: ANSWER },
    });
    const b = await bob();
    const hidden = await send('GET', `/api/v1/agents/${mine.id}/capacity?project=laika`, {
      Cookie: b.cookie,
    });
    const unknown = await send('GET', `/api/v1/agents/${newId()}/capacity?project=laika`, {
      Cookie: b.cookie,
    });
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await unknown.text());
  });
});

// ------------------------------------------------------------------ delivery

describe('a ping reaches the pinged agent’s device, and nobody else’s', () => {
  it('in the durable inbox, as a versioned envelope with what the device needs', async () => {
    const ping = await pinged({ Cookie: cookie }, mine.id, { task_id: taskId });
    const page = await ok(
      await send('GET', '/api/v1/agents/me/events', bearer(mine.secret)),
      200,
    );
    const events = page.data as Record<string, unknown>[];
    expect(events.map((e) => e.type)).toEqual(['agent.capacity_requested']);
    expect(events[0]).toMatchObject({
      schema_version: 2,
      task_id: taskId,
      task_key: 'LAI-1',
      project_slug: 'laika',
      to: { agent_id: mine.id },
      ping: { id: ping.id, expires_at: ping.expires_at },
      offer: null,
      delivery: { state: 'available' },
    });
    const theirs = await ok(
      await send('GET', '/api/v1/agents/me/events', bearer(bystander.secret)),
      200,
    );
    expect(theirs.data).toEqual([]);
  });

  it('live on /api/v1/events, with its envelope', async () => {
    const client = await stream(bearer(mine.secret));
    const ping = await pinged({ Cookie: cookie }, mine.id);
    const frames = await until(client, 'agent.capacity_requested');
    const data = JSON.parse(frames.at(-1)!.data) as { envelope: { ping: unknown } };
    expect(data.envelope.ping).toEqual({ id: ping.id, expires_at: ping.expires_at });
    await client.disconnect();
  });

  it('a work request’s event carries the request, the agent, the task key and the slug', async () => {
    await ok(
      await send('PATCH', `/api/v1/tasks/${taskId}`, { Cookie: cookie }, {
        selected_agent_id: mine.id,
      }),
      200,
    );
    const page = await ok(
      await send('GET', '/api/v1/agents/me/events', bearer(mine.secret)),
      200,
    );
    const event = (page.data as Record<string, unknown>[]).find(
      (e) => e.type === 'task.agent_selected',
    )!;
    expect(event).toMatchObject({
      task_key: 'LAI-1',
      project_slug: 'laika',
      project_id: projectId,
      offer: { kind: 'work_request' },
      to: { agent_id: mine.id },
    });
  });
});

// ------------------------------------------------------------------ presence

describe('PUT /agents/me/launcher', () => {
  it('an agent reports; its view, and its device’s, say on', async () => {
    const reported = await ok(await report(mine.secret), 200);
    expect(reported).toMatchObject({
      agent_id: mine.id,
      enabled: true,
      state: 'on',
      auto_pickup: { work_requests: true, handoffs: true },
      started_at: LAUNCHER.started_at,
    });
    const view = await ok(await send('GET', `/api/v1/agents/${mine.id}`, { Cookie: cookie }), 200);
    expect((view.launcher as { state: string }).state).toBe('on');
    const devices = await ok(await send('GET', '/api/v1/devices', { Cookie: cookie }), 200);
    const device = (devices.data as { agents: { id: string }[]; launcher: { state: string } }[]).find(
      (d) => d.agents.some((a) => a.id === mine.id),
    )!;
    expect(device.launcher.state).toBe('on');
  });

  it('never reported is off; an old report is unknown; disabled is off', async () => {
    const before = await ok(await send('GET', `/api/v1/agents/${mine.id}`, { Cookie: cookie }), 200);
    expect(before.launcher).toEqual({
      state: 'off',
      reported_at: null,
      started_at: null,
      running: null,
      max_concurrent: null,
      auto_pickup: null,
      cli_version: null,
    });
    await ok(await report(mine.secret), 200);
    h.db
      .update(agentLauncherReports)
      .set({ reportedAt: Date.now() - 180_000 })
      .where(eq(agentLauncherReports.agentId, mine.id))
      .run();
    const stale = await ok(await send('GET', `/api/v1/agents/${mine.id}`, { Cookie: cookie }), 200);
    expect((stale.launcher as { state: string }).state).toBe('unknown');
    await ok(await report(mine.secret, { ...LAUNCHER, enabled: false }), 200);
    const off = await ok(await send('GET', `/api/v1/agents/${mine.id}`, { Cookie: cookie }), 200);
    expect((off.launcher as { state: string }).state).toBe('off');
  });

  it('a session is 403 not_an_agent; an extra key is 422', async () => {
    expect(
      (await errorOf(await send('PUT', '/api/v1/agents/me/launcher', { Cookie: cookie }, LAUNCHER), 403))
        .details,
    ).toMatchObject({ reason: 'not_an_agent' });
    await errorOf(await report(mine.secret, { ...LAUNCHER, command: 'start' }), 422);
    await errorOf(await report(mine.secret, { ...LAUNCHER, running: 5 }), 422);
  });
});

// ----------------------------------------------------------------------- MCP

describe('ping_agent and get_agent_capacity (§7.1)', () => {
  it('ping_agent pings and waits; get_agent_capacity reads the answer', async () => {
    const client = await connect(pinger.secret);
    const result = await client.callTool({
      name: 'ping_agent',
      arguments: { project: 'laika', agent: mine.id, task: 'LAI-1', wait_seconds: 0 },
    });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    const ping = (result.structuredContent as { ping: Ping }).ping;
    expect(ping).toMatchObject({ agent_id: mine.id, task_id: taskId, state: 'pending' });

    await ok(await reply(mine.secret, ping.id), 200);
    const read = await client.callTool({
      name: 'get_agent_capacity',
      arguments: { project: 'laika', agent: mine.id },
    });
    expect(read.isError, JSON.stringify(read.content)).not.toBe(true);
    expect(read.structuredContent).toMatchObject({
      agent_id: mine.id,
      launcher: { state: 'off' },
      latest_answer: { id: ping.id, answer: ANSWER },
    });
    await client.close();
  });

  it('another owner’s agent is not_found, as an id that names nothing', async () => {
    const b = await bob();
    const bobs = await agent('Bob’s', b.cookie);
    const client = await connect(pinger.secret);
    const theirs = await client.callTool({
      name: 'ping_agent',
      arguments: { project: 'laika', agent: bobs.id },
    });
    const none = await client.callTool({
      name: 'ping_agent',
      arguments: { project: 'laika', agent: newId() },
    });
    expect(theirs.isError).toBe(true);
    expect(theirs.structuredContent).toEqual(none.structuredContent);
    expect(theirs.structuredContent).toEqual({
      error: { code: 'not_found', message: 'No agent with that id', details: null },
    });
    await client.close();
  });
});
