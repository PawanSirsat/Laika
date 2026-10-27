import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, agents, orgs, tokens, users } from '../../../src/db/schema.ts';
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
