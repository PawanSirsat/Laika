import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  agentSessions,
  recognisedAgentDevices,
  taskClaims,
  agents,
  heartbeats,
  idempotencyKeys,
  orgs,
  tasks,
  tokens,
  users,
} from '../../../src/db/schema.ts';
import { loadActor } from '../../../src/auth/resolve-actor.ts';
import { insertToken } from '../../../src/services/tokens.ts';
import { expireClaims } from '../../../src/services/claims.ts';
import { sql } from 'drizzle-orm';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `/api/v1/agents` over HTTP, and what an agent's token may then reach
 * (SPEC §4.63, §4.64, §6.4, D-114, LAI-534).
 *
 * Every refusal asserts the §6.3 `code` **and** the `reason`, so a broken
 * setup — a 401 from a bad token, a 404 from a missing project — cannot pass
 * for the grant doing its job.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
/** A plain member, on both projects as `member`, whose agents the tests use. */
let bob: { cookie: string; id: string };

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...headers, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

interface Auth {
  cookie?: string;
  bearer?: string;
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok(res: Response, status = 200): Promise<Record<string, unknown>> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function error(res: Response): Promise<{ status: number; code: string; reason: unknown }> {
  const body = (await res.json()) as { error: { code: string; details: { reason?: unknown } } };
  return { status: res.status, code: body.error.code, reason: body.error.details?.reason };
}

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer') {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

async function project(slug: string, prefix: string): Promise<string> {
  const body = await ok(
    await req(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: slug, slug, prefix }) },
      { cookie: ownerCookie },
    ),
    201,
  );
  return body.id as string;
}

async function addMember(slug: string, userId: string, role: 'member' | 'viewer') {
  await ok(
    await req(
      `/api/v1/projects/${slug}/members`,
      { method: 'POST', body: JSON.stringify({ user_id: userId, role }) },
      { cookie: ownerCookie },
    ),
    201,
  );
}

interface Registered {
  agent: { id: string; tokens: { id: string }[]; grants: unknown[]; status: string };
  token: { id: string };
  secret: string;
}

async function register(
  grants: { project_id: string; scope: 'full' | 'read_only' }[],
  cookie = bob.cookie,
  overrides: Record<string, unknown> = {},
): Promise<Registered> {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'Bob’s Claude',
          harness: 'claude-code',
          device_label: 'Belka',
          grants,
          ...overrides,
        }),
      },
      { cookie },
    ),
    201,
  )) as unknown as Registered;
}

function createTask(slug: string, bearer: string, title = 'Agent work'): Promise<Response> {
  return req(
    `/api/v1/projects/${slug}/tasks`,
    { method: 'POST', body: JSON.stringify({ title }) },
    { bearer },
  );
}

function listTasks(slug: string, bearer: string): Promise<Response> {
  return req(`/api/v1/projects/${slug}/tasks`, {}, { bearer });
}

let alpha: string;
let beta: string;
/** Set to hold the limiter's clock still; `null` is the real clock. */
let frozen: number | null = null;

beforeEach(async () => {
  frozen = null;
  h = authHarness({ rateLimiter: new RateLimiter(() => frozen ?? Date.now()) });
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

  bob = await join('bob@example.test', 'member');
  alpha = await project('alpha', 'ALP');
  beta = await project('beta', 'BET');
  await addMember('alpha', bob.id, 'member');
  await addMember('beta', bob.id, 'member');
});

afterEach(() => {
  h.close();
});

describe('registering', () => {
  it('returns the agent, its first token and the secret, once', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);

    expect(created.secret).toMatch(/^lai_[0-9A-Za-z]{40}$/);
    expect(created.agent).toMatchObject({
      display_name: 'Bob’s Claude',
      harness: 'claude-code',
      device_label: 'Belka',
      status: 'active',
      grants: [{ project_id: alpha, scope: 'full' }],
    });
    expect(created.agent.tokens.map((t) => t.id)).toEqual([created.token.id]);

    // The row says whose credential it is; nothing else does.
    const row = h.db.select().from(tokens).where(eq(tokens.id, created.token.id)).get();
    expect(row?.agentId).toBe(created.agent.id);
    expect(row?.userId).toBe(bob.id);

    // Never again: not on the list, not on the read.
    const list = await req('/api/v1/agents', {}, { cookie: bob.cookie });
    const one = await req(`/api/v1/agents/${created.agent.id}`, {}, { cookie: bob.cookie });
    expect(await list.text()).not.toContain(created.secret);
    expect(await one.text()).not.toContain(created.secret);
  });

  it('refuses a token: managing agents is session only', async () => {
    const legacy = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as { secret: string };

    const res = await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({ display_name: 'x', harness: 'other', grants: [] }),
      },
      { bearer: legacy.secret },
    );
    expect(await error(res)).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'session_required',
    });
  });

  it('refuses a grant on a project the owner cannot read', async () => {
    const gamma = await project('gamma', 'GAM'); // Bob is not a member.
    const res = await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: 'x',
          harness: 'other',
          grants: [{ project_id: gamma, scope: 'full' }],
        }),
      },
      { cookie: bob.cookie },
    );
    expect(res.status).toBe(422);
    expect(h.db.select().from(agents).all()).toEqual([]);
  });

  it('refuses an unknown harness and a body naming an agent id', async () => {
    const harness = await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({ display_name: 'x', harness: 'skynet', grants: [] }),
      },
      { cookie: bob.cookie },
    );
    expect((await error(harness)).code).toBe('unprocessable');

    const smuggled = await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({ display_name: 'x', harness: 'other', grants: [], agent_id: 'a1' }),
      },
      { cookie: bob.cookie },
    );
    // Unknown keys are refused by name (§6.3), so the agent cannot be asserted.
    const text = await smuggled.clone().text();
    expect((await error(smuggled)).code).toBe('unprocessable');
    expect(text).toContain('agent_id');
    expect(h.db.select().from(agents).all()).toEqual([]);
  });
});

describe('effective access: owner ∩ grant ∩ token', () => {
  it('a project with no grant is refused with agent_not_granted, reads and writes alike', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'full' }]);

    expect((await createTask('alpha', secret)).status).toBe(201);

    expect(await error(await createTask('beta', secret))).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'agent_not_granted',
    });
    // `listTasks` is a read: a missing grant refuses reads too — the project
    // is not this agent's to see, whatever its owner may.
    expect(await error(await listTasks('beta', secret))).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'agent_not_granted',
    });
  });

  it('a read_only grant on a full token refuses a write and keeps the read', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'read_only' }]);

    expect(await error(await createTask('alpha', secret))).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'agent_read_only',
    });
    expect((await listTasks('alpha', secret)).status).toBe(200);
  });

  it('a full grant on a read_only token refuses a write — the token’s scope still narrows', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const changed = h.db
      .update(tokens)
      .set({ scope: 'read_only' })
      .where(eq(tokens.id, created.token.id))
      .run();
    expect(changed.changes).toBe(1);

    const res = await createTask('alpha', created.secret);
    expect(res.status).toBe(403);
    expect((await error(res)).code).toBe('forbidden');
    expect((await listTasks('alpha', created.secret)).status).toBe(200);
  });

  it('the owner losing a permission removes it from the agent at once', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'full' }]);
    expect((await createTask('alpha', secret)).status).toBe(201);

    await ok(
      await req(
        `/api/v1/projects/alpha/members/${bob.id}`,
        { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) },
        { cookie: ownerCookie },
      ),
    );

    // The grant still says `full`; the owner no longer may, so neither may it.
    const res = await createTask('alpha', secret);
    expect(await error(res)).toEqual({ status: 403, code: 'forbidden', reason: undefined });
  });

  it('an agent’s token cannot mint a legacy token to escape its grants', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'full' }]);
    const res = await req(
      '/api/v1/tokens',
      { method: 'POST', body: JSON.stringify({ name: 'escape', scope: 'full' }) },
      { bearer: secret },
    );
    expect(await error(res)).toEqual({ status: 403, code: 'forbidden', reason: 'agent_token' });
  });

  it('a header naming another agent changes nothing', async () => {
    const wide = await register([
      { project_id: alpha, scope: 'full' },
      { project_id: beta, scope: 'full' },
    ]);
    const narrow = await register([{ project_id: alpha, scope: 'full' }]);

    for (const name of ['X-Laika-Agent', 'X-Laika-Agent-Id', 'X-Agent-Id']) {
      const res = await req(
        '/api/v1/projects/beta/tasks',
        {
          method: 'POST',
          body: JSON.stringify({ title: 'spoof' }),
          headers: { [name]: wide.agent.id },
        },
        { bearer: narrow.secret },
      );
      expect(await error(res), name).toEqual({
        status: 403,
        code: 'forbidden',
        reason: 'agent_not_granted',
      });
    }
  });
});

describe('legacy tokens', () => {
  it('a token with no agent reaches every project its owner can, as before', async () => {
    const legacy = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as { secret: string; token: { id: string } };
    expect(h.db.select().from(tokens).where(eq(tokens.id, legacy.token.id)).get()?.agentId).toBe(
      null,
    );

    // An agent registered beside it, with a grant on one project, narrows
    // nothing for the legacy token, and a header cannot attach that agent.
    const agent = await register([{ project_id: alpha, scope: 'read_only' }]);
    const res = await req(
      '/api/v1/projects/beta/tasks',
      {
        method: 'POST',
        body: JSON.stringify({ title: 'legacy' }),
        headers: { 'X-Laika-Agent-Id': agent.agent.id },
      },
      { bearer: legacy.secret },
    );
    expect(res.status).toBe(201);
    expect((await createTask('alpha', legacy.secret)).status).toBe(201);
  });
});

describe('rotating a token', () => {
  it('mints a new secret once, revokes the old in the same step, and keeps the agent', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const other = (await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as { secret: string };
    const sibling = await register([{ project_id: alpha, scope: 'full' }]);

    expect((await createTask('alpha', created.secret, 'before')).status).toBe(201);

    const rotated = (await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/rotate-token`,
        { method: 'POST', body: JSON.stringify({ token_id: created.token.id }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as unknown as Registered;

    expect(rotated.secret).toMatch(/^lai_/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.agent.id).toBe(created.agent.id);
    expect(rotated.agent.grants).toEqual([{ project_id: alpha, scope: 'full' }]);

    // The old one is a 401 now; the new one works with the same agent.
    expect((await createTask('alpha', created.secret)).status).toBe(401);
    expect((await createTask('alpha', rotated.secret, 'after')).status).toBe(201);
    const row = h.db.select().from(tokens).where(eq(tokens.id, rotated.token.id)).get();
    expect(row?.agentId).toBe(created.agent.id);

    // The owner's other tokens — a legacy one and a sibling agent's — still work.
    expect((await createTask('alpha', other.secret)).status).toBe(201);
    expect((await createTask('alpha', sibling.secret)).status).toBe(201);

    // History kept: the work done before rotation is still on the old token.
    const created_events = h.db
      .select()
      .from(activity)
      .where(and(eq(activity.type, 'task.created'), eq(activity.actorTokenId, created.token.id)))
      .all();
    expect(created_events).toHaveLength(1);

    // And the secret is not shown again.
    const read = await req(`/api/v1/agents/${created.agent.id}`, {}, { cookie: bob.cookie });
    expect(await read.text()).not.toContain(rotated.secret);
  });

  it('refuses a token that is not this agent’s, and an already revoked one', async () => {
    const a = await register([]);
    const b = await register([]);

    const wrong = await req(
      `/api/v1/agents/${a.agent.id}/rotate-token`,
      { method: 'POST', body: JSON.stringify({ token_id: b.token.id }) },
      { cookie: bob.cookie },
    );
    expect((await error(wrong)).code).toBe('not_found');
    // The other agent's token was not touched.
    expect(h.db.select().from(tokens).where(eq(tokens.id, b.token.id)).get()?.revokedAt).toBe(null);

    await ok(
      await req(
        `/api/v1/agents/${a.agent.id}/rotate-token`,
        { method: 'POST', body: JSON.stringify({ token_id: a.token.id }) },
        { cookie: bob.cookie },
      ),
      201,
    );
    const again = await req(
      `/api/v1/agents/${a.agent.id}/rotate-token`,
      { method: 'POST', body: JSON.stringify({ token_id: a.token.id }) },
      { cookie: bob.cookie },
    );
    expect(await error(again)).toEqual({ status: 409, code: 'conflict', reason: 'token_revoked' });
  });
});

describe('revoking an agent', () => {
  it('401s every token it holds, and leaves the owner and their other agents alone', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const rotated = (await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/rotate-token`,
        { method: 'POST', body: JSON.stringify({ token_id: created.token.id }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as unknown as Registered;
    const sibling = await register([{ project_id: alpha, scope: 'full' }]);

    const revoked = await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/revoke`,
        { method: 'POST' },
        { cookie: bob.cookie },
      ),
    );
    expect(revoked).toMatchObject({ status: 'revoked' });

    expect((await listTasks('alpha', rotated.secret)).status).toBe(401);
    const live = h.db
      .select()
      .from(tokens)
      .where(eq(tokens.agentId, created.agent.id))
      .all()
      .filter((t) => t.revokedAt === null);
    expect(live).toEqual([]);

    expect((await listTasks('alpha', sibling.secret)).status).toBe(200);
    expect((await req('/api/v1/me', {}, { cookie: bob.cookie })).status).toBe(200);

    // Idempotent, and a revoked agent cannot be changed or rotated back.
    await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/revoke`,
        { method: 'POST' },
        { cookie: bob.cookie },
      ),
    );
    const rename = await req(
      `/api/v1/agents/${created.agent.id}`,
      { method: 'PATCH', body: JSON.stringify({ display_name: 'back' }) },
      { cookie: bob.cookie },
    );
    expect(await error(rename)).toEqual({ status: 409, code: 'conflict', reason: 'agent_revoked' });
  });
});

describe('only the owner’s own agents', () => {
  it('another person’s agent is a 404 to every route', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const carol = await join('carol@example.test', 'admin');

    const paths: [string, RequestInit][] = [
      [`/api/v1/agents/${created.agent.id}`, {}],
      [`/api/v1/agents/${created.agent.id}`, { method: 'PATCH', body: '{"display_name":"x"}' }],
      [`/api/v1/agents/${created.agent.id}/grants`, { method: 'PUT', body: '{"grants":[]}' }],
      [
        `/api/v1/agents/${created.agent.id}/rotate-token`,
        { method: 'POST', body: JSON.stringify({ token_id: created.token.id }) },
      ],
      [`/api/v1/agents/${created.agent.id}/revoke`, { method: 'POST' }],
    ];
    for (const [path, init] of paths) {
      const res = await req(path, init, { cookie: carol.cookie });
      expect((await error(res)).code, `${init.method ?? 'GET'} ${path}`).toBe('not_found');
    }
    const list = (await ok(await req('/api/v1/agents', {}, { cookie: carol.cookie }))) as {
      data: unknown[];
    };
    expect(list.data).toEqual([]);
  });
});

describe('grants and renames', () => {
  it('PUT /grants replaces the set and takes effect on the next request', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    expect((await createTask('beta', created.secret)).status).toBe(403);

    await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/grants`,
        { method: 'PUT', body: JSON.stringify({ grants: [{ project_id: beta, scope: 'full' }] }) },
        { cookie: bob.cookie },
      ),
    );
    expect((await createTask('beta', created.secret)).status).toBe(201);
    expect(await error(await createTask('alpha', created.secret))).toMatchObject({
      reason: 'agent_not_granted',
    });
  });

  it('renaming the agent renames its tokens', async () => {
    const created = await register([]);
    await ok(
      await req(
        `/api/v1/agents/${created.agent.id}`,
        { method: 'PATCH', body: JSON.stringify({ display_name: 'Renamed' }) },
        { cookie: bob.cookie },
      ),
    );
    expect(h.db.select().from(tokens).where(eq(tokens.id, created.token.id)).get()?.name).toBe(
      'Renamed',
    );
  });
});

describe('the secret never leaves the one-time reveal', () => {
  it('appears in no activity row written by registering, rotating and revoking', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const rotated = (await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/rotate-token`,
        { method: 'POST', body: JSON.stringify({ token_id: created.token.id }) },
        { cookie: bob.cookie },
      ),
      201,
    )) as unknown as Registered;
    expect((await createTask('alpha', rotated.secret)).status).toBe(201);
    await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/revoke`,
        { method: 'POST' },
        { cookie: bob.cookie },
      ),
    );

    const rows = h.db.select().from(activity).all();
    const types = rows.map((r) => r.type);
    // The positive control: the rows this grep reads were written.
    expect(types.filter((t) => t === 'token.created')).toHaveLength(2);
    expect(types.filter((t) => t === 'token.revoked')).toHaveLength(2);

    const dump = JSON.stringify(rows);
    // And none in the request log: the positive control is that it logged.
    expect(h.log.records.length).toBeGreaterThan(0);
    const logged = JSON.stringify(h.log.records);
    for (const secret of [created.secret, rotated.secret]) {
      expect(dump).not.toContain(secret);
      // Nor its body without the prefix.
      expect(dump).not.toContain(secret.slice(4));
      expect(logged).not.toContain(secret.slice(4));
    }
  });
});

describe('rate limits', () => {
  it('an agent’s token spends the existing per-token bucket, and only its own', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const sibling = await register([{ project_id: alpha, scope: 'full' }]);

    // §6.3: a token gets 120 a minute. The 121st is refused. The clock is
    // held still, or the bucket refills while the loop runs.
    frozen = Date.now();
    for (let i = 0; i < 120; i += 1) {
      const res = await listTasks('alpha', created.secret);
      expect(res.status, `request ${String(i + 1)}`).toBe(200);
    }
    const over = await listTasks('alpha', created.secret);
    expect(over.status).toBe(429);
    expect((await error(over)).code).toBe('rate_limited');

    // Its sibling, and its owner's browser, are separate buckets.
    expect((await listTasks('alpha', sibling.secret)).status).toBe(200);
    expect((await req('/api/v1/agents', {}, { cookie: bob.cookie })).status).toBe(200);
  });
});

/**
 * The idempotency store and secrets (Codex review of PR #102, LAI-534).
 *
 * The store replays before the route runs, so before `can()`. Two things
 * follow, each asserted on the table itself rather than inferred from a
 * response: a one-time secret is never written to it, and a stored answer is
 * found only by the credential that earned it.
 */
describe('idempotency never keeps a secret, and replays only to its own credential', () => {
  const KEY = { 'Idempotency-Key': 'retry-1' };

  function storedBodies(): string {
    return JSON.stringify(h.db.select().from(idempotencyKeys).all());
  }

  it('stores no row for any route that reveals a secret, and a retry mints afresh', async () => {
    // The positive control first: an ordinary keyed POST is stored, so an
    // empty table below means "not stored", not "the store is off".
    const plain = await req(
      '/api/v1/projects/alpha/tasks',
      { method: 'POST', body: JSON.stringify({ title: 'control' }), headers: KEY },
      { cookie: bob.cookie },
    );
    expect(plain.status).toBe(201);
    expect(h.db.select().from(idempotencyKeys).all()).toHaveLength(1);

    const secrets: string[] = [];
    const reveal = async (
      path: string,
      body: unknown,
      cookie: string,
      pick: (b: Record<string, unknown>) => string,
      // The retry runs the route again. Most mint a second secret; the two
      // invite routes refuse instead (already invited, already replaced) —
      // either way it is the route answering, never a stored copy.
      retryStatus = 201,
    ) => {
      const init = {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': `secret-${path}` },
      };
      const first = await ok(await req(path, init, { cookie }), 201);
      secrets.push(pick(first));
      const retry = await req(path, init, { cookie });
      expect(retry.headers.get('Idempotent-Replay'), path).toBeNull();
      const again = await ok(retry, retryStatus);
      if (retryStatus === 201) {
        expect(pick(again), path).not.toBe(pick(first));
        secrets.push(pick(again));
      }
      return first;
    };

    await reveal(
      '/api/v1/tokens',
      { name: 'cli', scope: 'full' },
      bob.cookie,
      (b) => b.secret as string,
    );
    const agent = await reveal(
      '/api/v1/agents',
      { display_name: 'a', harness: 'other', grants: [] },
      bob.cookie,
      (b) => b.secret as string,
    );
    const agentId = (agent.agent as { id: string }).id;
    const tokenId = (agent.token as { id: string }).id;
    // Rotation with a key: the retry is a second rotation, refused because
    // the first one already revoked that token — never a replayed secret.
    const rotateInit = {
      method: 'POST',
      body: JSON.stringify({ token_id: tokenId }),
      headers: { 'Idempotency-Key': 'secret-rotate' },
    };
    const rotated = await ok(
      await req(`/api/v1/agents/${agentId}/rotate-token`, rotateInit, { cookie: bob.cookie }),
      201,
    );
    secrets.push(rotated.secret as string);
    const retry = await req(`/api/v1/agents/${agentId}/rotate-token`, rotateInit, {
      cookie: bob.cookie,
    });
    expect(retry.headers.get('Idempotent-Replay')).toBeNull();
    expect(await error(retry)).toEqual({ status: 409, code: 'conflict', reason: 'token_revoked' });

    const invite = await reveal(
      '/api/v1/invites',
      { email: 'dora@example.test', org_role: 'member' },
      ownerCookie,
      (b) => b.token as string,
      409,
    );
    await reveal(
      `/api/v1/invites/${(invite.invite as { id: string }).id}/reissue`,
      {},
      ownerCookie,
      (b) => b.token as string,
      // Reissuing replaces the invite, so a retry of the old id is not found.
      404,
    );
    await reveal(`/api/v1/users/${bob.id}/reset-link`, {}, ownerCookie, (b) => b.url as string);
    await reveal('/api/v1/org/github-webhook', {}, ownerCookie, (b) => b.secret as string);

    // Still only the control row, and no secret anywhere in the table.
    expect(h.db.select().from(idempotencyKeys).all()).toHaveLength(1);
    const dump = storedBodies();
    expect(secrets.length).toBe(11);
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(20);
      expect(dump).not.toContain(secret);
    }
  });

  it('a sibling token of the same person never receives another credential’s stored answer', async () => {
    const wide = await register([{ project_id: alpha, scope: 'full' }]);
    const narrow = await register([]);
    const init = {
      method: 'POST',
      body: JSON.stringify({ title: 'by the wide agent' }),
      headers: KEY,
    };

    const first = await ok(
      await req('/api/v1/projects/alpha/tasks', init, { bearer: wide.secret }),
      201,
    );
    // The same key and body from the narrow agent is not a replay: the route
    // runs and the grant refuses it.
    const sibling = await req('/api/v1/projects/alpha/tasks', init, { bearer: narrow.secret });
    expect(sibling.headers.get('Idempotent-Replay')).toBeNull();
    expect(await error(sibling)).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'agent_not_granted',
    });
    // Nor does the owner's web session get the token's answer by its key.
    const session = await req('/api/v1/projects/alpha/tasks', init, { cookie: bob.cookie });
    expect(session.headers.get('Idempotent-Replay')).toBeNull();
    expect(session.status).toBe(201);
    expect(((await session.json()) as { id: string }).id).not.toBe(first.id);

    // And the credential that earned it still replays its own.
    const own = await req('/api/v1/projects/alpha/tasks', init, { bearer: wide.secret });
    expect(own.headers.get('Idempotent-Replay')).toBe('true');
    expect(((await own.json()) as { id: string }).id).toBe(first.id);
  });

  it('agent.manage_own stays session only through a replay', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const init = {
      method: 'POST',
      body: JSON.stringify({ grants: [] }),
      headers: KEY,
    };
    // A session's keyed, stored answer to a managing POST …
    const revoked = await ok(
      await req(`/api/v1/agents/${created.agent.id}/revoke`, init, { cookie: bob.cookie }),
    );
    expect(revoked).toMatchObject({ status: 'revoked' });
    const sibling = await register([{ project_id: alpha, scope: 'full' }]);

    // … is not handed to the person's token holding the same key and body:
    // the route runs, and refuses it as a token.
    const replay = await req(`/api/v1/agents/${created.agent.id}/revoke`, init, {
      bearer: sibling.secret,
    });
    expect(replay.headers.get('Idempotent-Replay')).toBeNull();
    expect(await error(replay)).toEqual({
      status: 403,
      code: 'forbidden',
      reason: 'session_required',
    });
  });

  it('a replay to its own credential after the credential changed answers as the credential now is', async () => {
    const created = await register([{ project_id: alpha, scope: 'full' }]);
    const init = {
      method: 'POST',
      body: JSON.stringify({ title: 'before the change' }),
      headers: KEY,
    };
    await ok(await req('/api/v1/projects/alpha/tasks', init, { bearer: created.secret }), 201);

    // Revoked in between: the resolver refuses the token before the store is
    // consulted, so the stored answer is unreachable.
    await ok(
      await req(
        `/api/v1/agents/${created.agent.id}/revoke`,
        { method: 'POST' },
        { cookie: bob.cookie },
      ),
    );
    const after = await req('/api/v1/projects/alpha/tasks', init, { bearer: created.secret });
    expect(after.status).toBe(401);
    expect(after.headers.get('Idempotent-Replay')).toBeNull();
  });
});

/**
 * Heartbeats write a task's branch only as far as the sender may (M4,
 * LAIKA-537; Codex review of PR #102). The beat always lands; the task link
 * needs `project.read` and the branch needs `task.write`, both asked of the
 * whole actor — owner, agent grant, token.
 */
describe('heartbeats respect the grant, the role and the pin', () => {
  let taskId: string;
  let number: number;

  beforeEach(async () => {
    await ok(
      await req(
        '/api/v1/projects/alpha',
        { method: 'PATCH', body: JSON.stringify({ repo: 'kvell/alpha' }) },
        { cookie: ownerCookie },
      ),
    );
    const task = await ok(
      await req(
        '/api/v1/projects/alpha/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'beat me' }) },
        { cookie: ownerCookie },
      ),
      201,
    );
    taskId = task.id as string;
    number = task.number as number;
  });

  /** `branch` is `written` or `unchanged`, compared with the task before the beat. */
  async function beat(secret: string): Promise<{ branch: string; matched: string | null }> {
    const branchOf = () => h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.branch;
    const before = branchOf();
    const branch = `alp-${String(number)}-work-${String(Math.random()).slice(2, 8)}`;
    const res = await req(
      '/api/v1/heartbeats',
      { method: 'POST', body: JSON.stringify({ repo: 'kvell/alpha', branch }) },
      { bearer: secret },
    );
    expect(res.status, await res.clone().text()).toBe(202);
    const row = h.db.select().from(heartbeats).where(eq(heartbeats.branch, branch)).get();
    expect(row, 'the beat itself always lands').toBeDefined();
    const after = branchOf();
    expect([branch, before], 'the branch is this beat’s or what it was').toContain(after);
    return {
      branch: after === branch ? 'written' : 'unchanged',
      matched: row?.matchedTaskId ?? null,
    };
  }

  it('a full grant writes the branch', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'full' }]);
    expect(await beat(secret)).toEqual({ branch: 'written', matched: taskId });
  });

  it('an agent with no grant there neither links nor writes', async () => {
    const { secret } = await register([{ project_id: beta, scope: 'full' }]);
    expect(await beat(secret)).toEqual({ branch: 'unchanged', matched: null });
  });

  it('a read_only grant links the beat and writes nothing', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'read_only' }]);
    expect(await beat(secret)).toEqual({ branch: 'unchanged', matched: taskId });
  });

  it('a legacy token: as before for a member, nothing for someone outside the project', async () => {
    const mint = async (cookie: string, body: unknown) =>
      (
        (await ok(
          await req('/api/v1/tokens', { method: 'POST', body: JSON.stringify(body) }, { cookie }),
          201,
        )) as { secret: string }
      ).secret;

    expect(await beat(await mint(bob.cookie, { name: 'cli', scope: 'full' }))).toEqual({
      branch: 'written',
      matched: taskId,
    });

    const carol = await join('carol@example.test', 'member'); // on no project
    expect(await beat(await mint(carol.cookie, { name: 'cli', scope: 'full' }))).toEqual({
      branch: 'unchanged',
      matched: null,
    });

    // Pinned to another project: the pin refuses this one.
    const pinned = await mint(bob.cookie, { name: 'pinned', scope: 'full', project_ids: [beta] });
    expect(await beat(pinned)).toEqual({ branch: 'unchanged', matched: null });
  });
});

describe('devices (LAI-590)', () => {
  interface Device {
    device_label: string | null;
    display_name: string;
    recognised: boolean;
    last_seen_at: number | null;
    active_count: number;
    revoked_count: number;
    agents: { id: string; harness: string; status: string }[];
  }

  async function devices(auth: Auth = { cookie: bob.cookie }): Promise<Device[]> {
    const body = await ok(await req('/api/v1/agents/devices', {}, auth));
    return body.data as Device[];
  }

  function devicePost(
    action: 'confirm' | 'revoke',
    label: string | null,
    auth: Auth = { cookie: bob.cookie },
  ) {
    return req(
      `/api/v1/agents/devices/${action}`,
      {
        method: 'POST',
        body: JSON.stringify({ device_label: label }),
      },
      auth,
    );
  }

  it('groups normalised own labels with harness/status, counts and the newest last_seen_at', async () => {
    const first = await register([], bob.cookie, { device_label: '  BÉLKA  ' });
    const second = await register([], bob.cookie, { device_label: 'bélka', harness: 'codex' });
    const revoked = await register([], bob.cookie, { device_label: 'BÉLKA' });
    await ok(
      await req(
        `/api/v1/agents/${revoked.agent.id}/revoke`,
        { method: 'POST' },
        { cookie: bob.cookie },
      ),
    );
    h.db.update(agents).set({ lastSeenAt: 120 }).where(eq(agents.id, first.agent.id)).run();
    h.db.update(agents).set({ lastSeenAt: 450 }).where(eq(agents.id, revoked.agent.id)).run();
    const nullLabel = await register([], bob.cookie, { device_label: null });
    const blank = await register([], bob.cookie, { device_label: '\t ' });
    await register([], bob.cookie, { device_label: 'Unnamed device' });
    const list = await devices();
    expect(list).toHaveLength(3);
    const belka = list.find((d) => d.device_label === 'bélka')!;
    expect(belka).toMatchObject({
      recognised: false,
      last_seen_at: 450,
      active_count: 2,
      revoked_count: 1,
    });
    expect(belka.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.agent.id, harness: 'claude-code', status: 'active' }),
        expect.objectContaining({ id: second.agent.id, harness: 'codex', status: 'active' }),
        expect.objectContaining({ id: revoked.agent.id, status: 'revoked' }),
      ]),
    );
    const unnamed = list.find((d) => d.device_label === null);
    expect(unnamed).toMatchObject({
      display_name: 'Unnamed device',
      last_seen_at: null,
      active_count: 2,
      revoked_count: 0,
    });
    expect(unnamed?.agents.map((a) => a.id).sort()).toEqual(
      [nullLabel.agent.id, blank.agent.id].sort(),
    );
    expect(JSON.stringify(list)).not.toContain(first.secret);
  });

  it('never lists or changes another owner’s agents, even on a shared label; foreign and unknown are identical 404s', async () => {
    const own = await register([]);
    const foreignShared = await register([], ownerCookie);
    const foreign = await register([], ownerCookie, { device_label: 'Secret laptop' });
    expect((await devices()).flatMap((d) => d.agents.map((a) => a.id))).toEqual([own.agent.id]);
    for (const action of ['confirm', 'revoke'] as const) {
      const unknown = await devicePost(action, 'made up');
      const hidden = await devicePost(action, 'Secret laptop');
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toEqual(await unknown.json());
    }
    expect(await ok(await devicePost('revoke', ' BELKA '))).toEqual({
      revoked_agent_ids: [own.agent.id],
    });
    for (const id of [foreignShared.agent.id, foreign.agent.id]) {
      expect(h.db.select().from(agents).where(eq(agents.id, id)).get()?.status).toBe('active');
    }
    expect(h.db.select().from(recognisedAgentDevices).all()).toEqual([]);
    // An org owner cannot see a member's device either.
    const onlyForeign = await register([], bob.cookie, { device_label: 'member only' });
    const ownerList = await devices({ cookie: ownerCookie });
    expect(JSON.stringify(ownerList)).not.toContain('member only');
    expect(JSON.stringify(ownerList)).not.toContain(onlyForeign.agent.id);
  });

  it('recognition belongs to an owner and label, persists, and never follows an agent to a new label', async () => {
    const a = await register([]);
    await register([], ownerCookie);
    expect((await devices())[0]?.recognised).toBe(false);
    expect(await ok(await devicePost('confirm', ' BELKA '))).toEqual({
      device_label: 'belka',
      recognised: true,
    });
    await ok(await devicePost('confirm', 'belka'));
    expect(h.db.select().from(recognisedAgentDevices).all()).toHaveLength(1);
    expect((await devices())[0]?.recognised).toBe(true);
    expect((await devices({ cookie: ownerCookie }))[0]?.recognised).toBe(false);
    await ok(
      await req(
        `/api/v1/agents/${a.agent.id}`,
        { method: 'PATCH', body: '{"device_label":"Cloud"}' },
        { cookie: bob.cookie },
      ),
    );
    expect((await devices())[0]).toMatchObject({ device_label: 'cloud', recognised: false });
    await register([]); // the owner's confirmation survives the old agent moving away
    expect((await devices()).find((d) => d.device_label === 'belka')?.recognised).toBe(true);
    await register([], bob.cookie, { device_label: null });
    await ok(await devicePost('confirm', null));
    expect((await devices()).find((d) => d.device_label === null)?.recognised).toBe(true);
  });

  it('allows every role to list and confirm only their own devices', async () => {
    await register([]);
    for (const role of ['admin', 'member', 'viewer'] as const) {
      const person = await join(`device-${role}@example.test`, role);
      const created = await register([], person.cookie, { device_label: role });
      expect(
        (await devices({ cookie: person.cookie })).flatMap((d) => d.agents.map((a) => a.id)),
      ).toEqual([created.agent.id]);
      await ok(await devicePost('confirm', role, { cookie: person.cookie }));
      expect((await devices({ cookie: person.cookie }))[0]?.recognised).toBe(true);
      await ok(await devicePost('revoke', role, { cookie: person.cookie }));
      expect((await devices({ cookie: person.cookie }))[0]?.revoked_count).toBe(1);
    }
  });

  it('requires authentication on every path and refuses management to every token, including its own agent', async () => {
    const agent = await register([]);
    const secrets = [agent.secret];
    for (const scope of ['full', 'read_only']) {
      const minted = await ok(
        await req(
          '/api/v1/tokens',
          { method: 'POST', body: JSON.stringify({ name: scope, scope }) },
          { cookie: bob.cookie },
        ),
        201,
      );
      secrets.push(minted.secret as string);
    }
    expect((await error(await req('/api/v1/agents/devices'))).code).toBe('unauthorized');
    for (const action of ['confirm', 'revoke'] as const) {
      expect((await error(await devicePost(action, 'Belka', {}))).code).toBe('unauthorized');
      for (const bearer of secrets) {
        expect((await devices({ bearer }))[0]?.agents[0]?.id).toBe(agent.agent.id);
        const refusal = await error(await devicePost(action, 'Belka', { bearer }));
        expect(refusal).toEqual({ status: 403, code: 'forbidden', reason: 'session_required' });
      }
    }
    expect(h.db.select().from(recognisedAgentDevices).all()).toEqual([]);
    expect(h.db.select().from(agents).where(eq(agents.id, agent.agent.id)).get()?.status).toBe(
      'active',
    );
  });

  it('rejects malformed labels and unknown body fields', async () => {
    await register([]);
    for (const action of ['confirm', 'revoke']) {
      for (const body of [
        {},
        { device_label: 42 },
        { device_label: 'x'.repeat(201) },
        { device_label: 'Belka', owner_user_id: ownerId },
      ]) {
        const res = await req(
          `/api/v1/agents/devices/${action}`,
          { method: 'POST', body: JSON.stringify(body) },
          { cookie: bob.cookie },
        );
        expect((await error(res)).code).toBe('unprocessable');
      }
    }
  });

  it('confirms and revokes a device by the key the list served, even when lower-casing lengthened it', async () => {
    // 'İ' lower-cases to two code units: an 80-character label lists as a
    // 160-character key, past the limit a stored label has.
    const created = await register([], bob.cookie, { device_label: 'İ'.repeat(80) });
    const [device] = await devices();
    expect(device?.device_label?.length).toBe(160);
    expect(await ok(await devicePost('confirm', device!.device_label))).toEqual({
      device_label: device!.device_label,
      recognised: true,
    });
    expect((await devices())[0]?.recognised).toBe(true);
    expect(await ok(await devicePost('revoke', device!.device_label))).toEqual({
      revoked_agent_ids: [created.agent.id],
    });
  });

  async function claimedAgent(deviceLabel: string | null) {
    const created = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, {
      device_label: deviceLabel,
    });
    const task = await ok(await createTask('alpha', created.secret), 201);
    const claimed = await req(
      `/api/v1/tasks/${task.id as string}/claim`,
      { method: 'POST' },
      { bearer: created.secret },
    );
    await ok(claimed);
    const sessionId = claimed.headers.get('X-Laika-Agent-Session');
    expect(sessionId).toBeTruthy();
    return { ...created, taskId: task.id as string, sessionId };
  }

  it('revokes all active device agents and live tokens; ends sessions/claims, preserves other devices and personal tokens, and retries write nothing', async () => {
    const a = await claimedAgent('Belka');
    const b = await claimedAgent(' BELKA ');
    const other = await claimedAgent('Strelka');
    const extra = insertToken(h.db, loadActor(h.db, bob.id)!, {
      name: 'extra',
      scope: 'full',
      projectIds: null,
      expiresAt: null,
      agentId: a.agent.id,
      now: Date.now(),
    });
    const personal = await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: '{"name":"personal","scope":"full"}' },
        { cookie: bob.cookie },
      ),
      201,
    );
    const beforeEvents = h.db
      .select()
      .from(activity)
      .all()
      .filter((r) => r.type === 'token.revoked').length;
    // Single-agent revoke leaves the claim row to lapse with its session ended
    // (§4.66, claims.test.ts); the device path must do exactly the same.
    const claimsBefore = h.db.select().from(taskClaims).all();
    const result = await ok(await devicePost('revoke', 'belka'));
    expect(result.revoked_agent_ids).toEqual(expect.arrayContaining([a.agent.id, b.agent.id]));
    expect(result.revoked_agent_ids).toHaveLength(2);
    for (const revoked of [a, b]) {
      expect(h.db.select().from(agents).where(eq(agents.id, revoked.agent.id)).get()?.status).toBe(
        'revoked',
      );
      expect(
        h.db
          .select()
          .from(tokens)
          .where(eq(tokens.agentId, revoked.agent.id))
          .all()
          .every((t) => t.revokedAt !== null),
      ).toBe(true);
      const session = h.db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, revoked.sessionId!))
        .get();
      expect(session?.endReason).toBe('agent_revoked');
      expect(session?.endedAt).not.toBeNull();
      expect((await req('/api/v1/me', {}, { bearer: revoked.secret })).status).toBe(401);
    }
    expect((await req('/api/v1/me', {}, { bearer: extra.secret })).status).toBe(401);
    expect((await req('/api/v1/me', {}, { bearer: personal.secret as string })).status).toBe(200);
    expect((await req('/api/v1/me', {}, { bearer: other.secret })).status).toBe(200);
    expect(
      h.db.select().from(agentSessions).where(eq(agentSessions.id, other.sessionId!)).get()
        ?.endedAt,
    ).toBeNull();
    expect(h.db.select().from(taskClaims).all()).toEqual(claimsBefore);
    expect(
      h.db
        .select()
        .from(activity)
        .all()
        .filter((r) => r.type === 'token.revoked'),
    ).toHaveLength(beforeEvents + 3);
    const before = h.db.select().from(activity).all();
    expect(await ok(await devicePost('revoke', 'BELKA'))).toEqual({ revoked_agent_ids: [] });
    expect(h.db.select().from(activity).all()).toEqual(before);
    // As with one agent: the claim is held until its lease runs out, then
    // lapses like any other (claims.test.ts, 'revoking the agent ends its sessions').
    const held = await req(
      `/api/v1/tasks/${a.taskId}/claim`,
      { method: 'POST' },
      { bearer: other.secret },
    );
    expect((await error(held)).reason).toBe('claim_held');
    const lease = Math.max(...claimsBefore.map((c) => c.leaseExpiresAt));
    expireClaims(h.db, lease);
    for (const revoked of [a, b]) {
      expect(
        h.db.select().from(taskClaims).where(eq(taskClaims.agentId, revoked.agent.id)).get()?.state,
      ).toBe('expired');
    }
  });

  it('rolls back every agent, token, session, claim and audit row if a later agent fails revocation', async () => {
    await claimedAgent('Belka');
    const second = await claimedAgent('Belka');
    const tables = [agents, tokens, agentSessions, taskClaims, activity] as const;
    const before = tables.map((table) => h.db.select().from(table).all());
    // Newest sorts first; fail on the oldest, after the newest was revoked.
    const oldest = h.db.select().from(agents).orderBy(agents.createdAt, agents.id).all()[0]!;
    expect(oldest.id).not.toBe(second.agent.id);
    h.db.run(
      sql`CREATE TRIGGER fail_device_revoke BEFORE UPDATE OF revoked_at ON tokens WHEN OLD.agent_id = '${sql.raw(oldest.id)}' BEGIN SELECT RAISE(ABORT, 'device test refusal'); END`,
    );
    const res = await devicePost('revoke', 'Belka');
    expect(res.status).toBe(500);
    expect((await error(res)).code).toBe('internal');
    expect(tables.map((table) => h.db.select().from(table).all())).toEqual(before);
  });
});
