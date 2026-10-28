import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, orgs, taskClaims, tasks, users } from '../../../src/db/schema.ts';
import { DEFAULT_CLAIM_TIMINGS, expireClaims } from '../../../src/services/claims.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * Agent sessions, claims and the fence over HTTP (SPEC §6.4, §9.1, proposal
 * §4.2, LAI-541). `test/services/claims.test.ts` has the clock-driven cases;
 * this file has the transport: `/agent-sessions`, the claim's response
 * headers, `X-Laika-Claim-Generation`, the reclaim route, and — the census —
 * **every task-changing route, derived from the route files**, asserted fenced
 * or named as exempt with the reason.
 *
 * Every refusal asserts the status, the §6.3 `code` **and** `details.reason`.
 */

const PASSWORD = 'correct-horse-battery-staple';
const LEASE = DEFAULT_CLAIM_TIMINGS.expireMs;

let h: AuthHarness;
let ownerCookie: string;
let bob: { cookie: string; id: string };
let alpha: string;

interface Auth {
  cookie?: string;
  bearer?: string;
  generation?: number | string;
}

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  if (auth?.generation !== undefined) headers['X-Laika-Claim-Generation'] = String(auth.generation);
  return h.app.request(path, { ...init, headers: jsonHeaders(headers) });
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok(res: Response, status = 200): Promise<Record<string, unknown>> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function refusal(res: Response) {
  const body = (await res.json()) as {
    error: { code: string; details: { reason?: unknown } | null };
  };
  return { status: res.status, code: body.error.code, reason: body.error.details?.reason };
}

async function register(name = 'Bob’s Claude') {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: name,
          harness: 'claude-code',
          grants: [{ project_id: alpha, scope: 'full' }],
        }),
      },
      { cookie: bob.cookie },
    ),
    201,
  )) as unknown as { agent: { id: string }; secret: string };
}

async function legacyToken(): Promise<string> {
  const body = await ok(
    await req(
      '/api/v1/tokens',
      { method: 'POST', body: JSON.stringify({ name: 'legacy', scope: 'full' }) },
      { cookie: bob.cookie },
    ),
    201,
  );
  return body.secret as string;
}

async function newTask(title = 'Work'): Promise<string> {
  const body = await ok(
    await req(
      '/api/v1/projects/alpha/tasks',
      { method: 'POST', body: JSON.stringify({ title }) },
      { cookie: bob.cookie },
    ),
    201,
  );
  return body.id as string;
}

/** Claim as an agent; the generation and session come back in headers. */
async function claim(taskId: string, secret: string, sessionId?: string) {
  const res = await req(
    `/api/v1/tasks/${taskId}/claim`,
    {
      method: 'POST',
      body: sessionId === undefined ? '' : JSON.stringify({ session_id: sessionId }),
    },
    { bearer: secret },
  );
  const body = await ok(res);
  return {
    task: body,
    generation: Number(res.headers.get('X-Laika-Claim-Generation')),
    session: res.headers.get('X-Laika-Agent-Session') ?? '',
  };
}

function patch(taskId: string, body: unknown, auth: Auth) {
  return req(`/api/v1/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) }, auth);
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
  expect(signed.status, await signed.clone().text()).toBe(200);
  bob = {
    cookie: cookieFrom(signed),
    id: h.db.select().from(users).where(eq(users.email, 'bob@example.test')).get()?.id ?? '',
  };

  const created = await ok(
    await req(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: 'alpha', slug: 'alpha', prefix: 'ALP' }) },
      { cookie: ownerCookie },
    ),
    201,
  );
  alpha = created.id as string;
  await ok(
    await req(
      '/api/v1/projects/alpha/members',
      { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
      { cookie: ownerCookie },
    ),
    201,
  );
});

afterEach(() => {
  h.close();
});

describe('/agent-sessions', () => {
  it('opens a session for an agent’s token, with what it reports about itself', async () => {
    const { agent, secret } = await register();
    const session = await ok(
      await req(
        '/api/v1/agent-sessions',
        { method: 'POST', body: JSON.stringify({ client_version: '2.1.0', model: 'claude' }) },
        { bearer: secret },
      ),
      201,
    );
    expect(session).toMatchObject({
      agent_id: agent.id,
      client_version: '2.1.0',
      model: 'claude',
      ended_at: null,
      connection: 'live',
    });
  });

  it('refuses a person and a legacy token: not_an_agent', async () => {
    expect(
      await refusal(
        await req('/api/v1/agent-sessions', { method: 'POST' }, { cookie: bob.cookie }),
      ),
    ).toEqual({ status: 403, code: 'forbidden', reason: 'not_an_agent' });
    expect(
      await refusal(
        await req('/api/v1/agent-sessions', { method: 'POST' }, { bearer: await legacyToken() }),
      ),
    ).toEqual({ status: 403, code: 'forbidden', reason: 'not_an_agent' });
  });

  it('a heartbeat renews the session’s claims from now', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    const taken = await claim(taskId, secret);
    const before = h.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).get()!;

    const beat = await ok(
      await req(
        `/api/v1/agent-sessions/${taken.session}/heartbeat`,
        { method: 'POST' },
        {
          bearer: secret,
        },
      ),
    );

    const claims = beat.claims as { generation: number; lease_expires_at: number }[];
    expect(claims.map((c) => c.generation)).toEqual([1]);
    expect(claims[0]!.lease_expires_at).toBeGreaterThanOrEqual(before.leaseExpiresAt);
  });

  it('ending a session releases its claims', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    const taken = await claim(taskId, secret);

    const ended = await ok(
      await req(
        `/api/v1/agent-sessions/${taken.session}/end`,
        { method: 'POST' },
        {
          bearer: secret,
        },
      ),
    );

    expect(ended).toMatchObject({ end_reason: 'ended', connection: 'ended' });
    expect(h.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).get()?.state).toBe(
      'released',
    );
  });

  it('a revoked agent’s heartbeat is refused at the door and renews nothing', async () => {
    const { agent, secret } = await register();
    const taskId = await newTask();
    const taken = await claim(taskId, secret);
    const lease = h.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).get()!;

    await ok(
      await req(`/api/v1/agents/${agent.id}/revoke`, { method: 'POST' }, { cookie: bob.cookie }),
    );
    const res = await req(
      `/api/v1/agent-sessions/${taken.session}/heartbeat`,
      { method: 'POST' },
      {
        bearer: secret,
      },
    );

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    expect(
      h.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).get()?.leaseExpiresAt,
    ).toBe(lease.leaseExpiresAt);
  });
});

describe('claiming over REST', () => {
  it('answers the task, with the generation and session in headers', async () => {
    const { secret } = await register();
    const taskId = await newTask();

    const taken = await claim(taskId, secret);

    expect(taken.generation).toBe(1);
    expect(taken.session).not.toBe('');
    expect(taken.task).toMatchObject({ id: taskId, status: 'in_progress', assignee_id: bob.id });
  });

  it('two sessions of the same person race for one task: exactly one wins, the other is claim_held', async () => {
    const first = await register('First');
    const second = await register('Second');
    const taskId = await newTask();

    const [a, b] = await Promise.all([
      req(`/api/v1/tasks/${taskId}/claim`, { method: 'POST' }, { bearer: first.secret }),
      req(`/api/v1/tasks/${taskId}/claim`, { method: 'POST' }, { bearer: second.secret }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(await refusal(loser)).toEqual({ status: 409, code: 'conflict', reason: 'claim_held' });
    expect(h.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).all()).toHaveLength(
      1,
    );
  });

  it('a malformed generation header is a 400, not a guess', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    await claim(taskId, secret);

    const res = await patch(taskId, { title: 'X' }, { bearer: secret, generation: '1e0' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('the live generation changes the task', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    const taken = await claim(taskId, secret);

    const view = await ok(
      await patch(taskId, { title: 'Mine' }, { bearer: secret, generation: taken.generation }),
    );
    expect(view.title).toBe('Mine');
  });
});

describe('who else may change a claimed task', () => {
  it('a legacy token may not: claim_held, on a change and on a claim', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    await claim(taskId, secret);
    const legacy = await legacyToken();

    expect(await refusal(await patch(taskId, { title: 'X' }, { bearer: legacy }))).toEqual({
      status: 409,
      code: 'conflict',
      reason: 'claim_held',
    });
    expect(
      await refusal(
        await req(`/api/v1/tasks/${taskId}/claim`, { method: 'POST' }, { bearer: legacy }),
      ),
    ).toEqual({ status: 409, code: 'conflict', reason: 'claim_held' });
  });

  it('a person signed in reads, comments and edits; the edit is recorded as theirs', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    await claim(taskId, secret);

    await ok(await req(`/api/v1/tasks/${taskId}`, {}, { cookie: ownerCookie }));
    await ok(
      await req(
        `/api/v1/tasks/${taskId}/comments`,
        { method: 'POST', body: JSON.stringify({ body_md: 'Looks good' }) },
        { cookie: ownerCookie },
      ),
      201,
    );
    const view = await ok(
      await patch(taskId, { title: 'Edited by a person' }, { cookie: bob.cookie }),
    );
    expect(view.title).toBe('Edited by a person');

    const row = h.db
      .select()
      .from(activity)
      .where(and(eq(activity.taskId, taskId), eq(activity.type, 'task.updated')))
      .all()
      .at(-1);
    expect(row).toMatchObject({ actorKind: 'user', actorId: bob.id, agentId: null });
  });
});

describe('expiry and the explicit reclaim', () => {
  it('the expired generation stays refused after heartbeats resume; reclaim issues the next', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    const taken = await claim(taskId, secret);

    // The scan, with a clock past the lease.
    expect(expireClaims(h.db, Date.now() + LEASE + 1).changed).toBe(1);

    const beat = await ok(
      await req(
        `/api/v1/agent-sessions/${taken.session}/heartbeat`,
        { method: 'POST' },
        {
          bearer: secret,
        },
      ),
    );
    expect(beat.claims).toEqual([]);
    expect(
      await refusal(await patch(taskId, { title: 'Zombie' }, { bearer: secret, generation: 1 })),
    ).toEqual({ status: 409, code: 'conflict', reason: 'stale_claim' });

    const reclaimed = await ok(
      await req(
        `/api/v1/tasks/${taskId}/claim/reclaim`,
        { method: 'POST', body: JSON.stringify({ session_id: taken.session }) },
        { bearer: secret },
      ),
    );
    expect(reclaimed).toMatchObject({
      from_generation: 1,
      claim: { generation: 2, state: 'active' },
    });

    expect(
      await refusal(await patch(taskId, { title: 'Old' }, { bearer: secret, generation: 1 })),
    ).toEqual({ status: 409, code: 'conflict', reason: 'stale_claim' });
    expect(
      (await ok(await patch(taskId, { title: 'New' }, { bearer: secret, generation: 2 }))).title,
    ).toBe('New');
  });

  it('reclaim is an agent’s: a person is not_an_agent', async () => {
    const taskId = await newTask();
    expect(
      await refusal(
        await req(
          `/api/v1/tasks/${taskId}/claim/reclaim`,
          { method: 'POST' },
          { cookie: bob.cookie },
        ),
      ),
    ).toEqual({ status: 403, code: 'forbidden', reason: 'not_an_agent' });
  });
});

// ---------------------------------------------------------------- the census

/**
 * Every non-`GET` route the task, sprint and comment routers declare on a
 * task, **read from the source files** — so a route added later appears here
 * without anyone remembering this file, and must be classified.
 */
function declaredTaskRoutes(): string[] {
  const read = (file: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../../src/http/routes/${file}`, import.meta.url)),
      'utf8',
    );
  const found: string[] = [];
  const scan = (file: string, prefix: string, keep: (path: string) => boolean) => {
    for (const m of read(file).matchAll(/app\.(post|patch|put|delete)\('([^']+)'/g)) {
      const path = m[2]!;
      if (keep(path)) found.push(`${m[1]!.toUpperCase()} ${prefix}${path}`);
    }
  };
  scan('tasks.ts', '/tasks', (p) => p.startsWith('/:id'));
  scan('sprints.ts', '/sprints', (p) => p.includes('/tasks'));
  scan('comments.ts', '/tasks', (p) => p.includes('/comments'));
  return found.sort();
}

interface Fixture {
  taskId: string;
  other: string;
  sprint: string;
  secret: string;
}

/** Each fenced route, with the request that would change the claimed task. */
const FENCED: Record<string, (f: Fixture, auth: Auth) => Promise<Response>> = {
  'PATCH /tasks/:id': (f, a) => patch(f.taskId, { title: 'Stale' }, a),
  'POST /tasks/:id/finish': (f, a) =>
    req(
      `/api/v1/tasks/${f.taskId}/finish`,
      { method: 'POST', body: JSON.stringify({ summary: 'x' }) },
      a,
    ),
  'POST /tasks/:id/status': (f, a) =>
    req(
      `/api/v1/tasks/${f.taskId}/status`,
      { method: 'POST', body: JSON.stringify({ status: 'review' }) },
      a,
    ),
  'POST /tasks/:id/reorder': (f, a) =>
    req(
      `/api/v1/tasks/${f.taskId}/reorder`,
      { method: 'POST', body: JSON.stringify({ after_task_id: f.other }) },
      a,
    ),
  'POST /tasks/:id/dependencies': (f, a) =>
    req(
      `/api/v1/tasks/${f.taskId}/dependencies`,
      { method: 'POST', body: JSON.stringify({ blocked_by_task_id: f.other }) },
      a,
    ),
  'DELETE /tasks/:id/dependencies/:depId': (f, a) =>
    req(`/api/v1/tasks/${f.taskId}/dependencies/${f.other}`, { method: 'DELETE' }, a),
  'POST /sprints/:id/tasks': (f, a) =>
    req(
      `/api/v1/sprints/${f.sprint}/tasks`,
      { method: 'POST', body: JSON.stringify({ task_ids: [f.taskId] }) },
      a,
    ),
  'DELETE /sprints/:id/tasks/:taskId': (f, a) =>
    req(`/api/v1/sprints/${f.sprint}/tasks/${f.taskId}`, { method: 'DELETE' }, a),
};

/** Routes that change something about a task and are deliberately not fenced, and why. */
const EXEMPT: Record<string, string> = {
  'POST /tasks/:id/claim':
    'takes the claim — its own refusals (claim_held, stale_claim) are asserted above',
  'POST /tasks/:id/claim/reclaim': 'issues the next generation — asserted above',
  'POST /tasks/:id/accept':
    'session only (§3.1): no token reaches it, and a person is never fenced',
  'POST /tasks/:id/send-back':
    'session only (§3.1): no token reaches it, and a person is never fenced',
  'PUT /tasks/:id/watch': "the caller's own subscription; changes no field of the task",
  'DELETE /tasks/:id/watch': "the caller's own subscription; changes no field of the task",
  'POST /tasks/:id/comments':
    'comments are never fenced — a person or an agent may always say something',
};

describe('the live claim on task reads (LAI-568)', () => {
  /** The task's `claim` from `GET /tasks/:id`, the full list and the slim list. */
  async function claimOnReads(taskId: string) {
    const single = await ok(await req(`/api/v1/tasks/${taskId}`, {}, { cookie: bob.cookie }));
    const reads = [single.claim];
    for (const query of ['', '?fields=slim']) {
      const page = (await ok(
        await req(`/api/v1/projects/alpha/tasks${query}`, {}, { cookie: bob.cookie }),
      )) as unknown as { data: { id: string; claim: unknown }[] };
      const listed = page.data.find((v) => v.id === taskId);
      expect(listed, `task on the list${query}`).toBeDefined();
      reads.push(listed!.claim);
    }
    return reads;
  }

  it('a person reads the holder’s session, heartbeat, connection and generation', async () => {
    const { agent, secret } = await register();
    const taskId = await newTask();
    const free = await newTask('Free');
    const taken = await claim(taskId, secret);

    const reads = await claimOnReads(taskId);
    for (const read of reads) {
      expect(read).toEqual({
        generation: taken.generation,
        state: 'active',
        agent_id: agent.id,
        session_id: taken.session,
        lease_expires_at: expect.any(Number) as number,
        last_heartbeat_at: expect.any(Number) as number,
        connection: 'live',
        suspect_after_ms: DEFAULT_CLAIM_TIMINGS.suspectMs,
        device_label: null,
      });
    }
    // The claim response itself carries it too: the same view.
    expect(taken.task.claim).toMatchObject({ session_id: taken.session, generation: 1 });
    expect(await claimOnReads(free)).toEqual([null, null, null]);
  });

  it('is null on every read once the holder finishes: the claim is released', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    const taken = await claim(taskId, secret);

    await ok(
      await req(
        `/api/v1/tasks/${taskId}/finish`,
        { method: 'POST', body: JSON.stringify({ summary: 'Done' }) },
        { bearer: secret, generation: taken.generation },
      ),
    );
    expect(await claimOnReads(taskId)).toEqual([null, null, null]);
  });

  it('is null on every read once the scan expires it', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    await claim(taskId, secret);

    expect(expireClaims(h.db, Date.now() + LEASE + 1).changed).toBe(1);
    expect(await claimOnReads(taskId)).toEqual([null, null, null]);
  });
});

describe('the census: every task-changing route is fenced or named', () => {
  it('the routes read from the source are exactly FENCED and EXEMPT', () => {
    const declared = declaredTaskRoutes();
    expect(declared.length, 'no routes parsed — the census is vacuous').toBeGreaterThan(10);
    expect(declared).toEqual([...Object.keys(FENCED), ...Object.keys(EXEMPT)].sort());
  });

  async function fixture(): Promise<Fixture> {
    const { secret } = await register();
    const taskId = await newTask('Claimed');
    const other = await newTask('Other');
    const sprint = (
      await ok(
        await req(
          '/api/v1/projects/alpha/sprints',
          {
            method: 'POST',
            body: JSON.stringify({
              name: 'S1',
              starts_on: Date.UTC(2026, 0, 1),
              ends_on: Date.UTC(2026, 0, 14),
            }),
          },
          { cookie: ownerCookie },
        ),
        201,
      )
    ).id as string;
    await claim(taskId, secret);
    // What the DELETE routes remove, put there by a person — who is not fenced.
    await ok(
      await req(
        `/api/v1/tasks/${taskId}/dependencies`,
        { method: 'POST', body: JSON.stringify({ blocked_by_task_id: other }) },
        { cookie: bob.cookie },
      ),
      201,
    );
    return { taskId, other, sprint, secret };
  }

  for (const route of Object.keys(FENCED)) {
    it(`${route} refuses a stale generation with stale_claim`, async () => {
      const f = await fixture();
      if (route === 'DELETE /sprints/:id/tasks/:taskId') {
        await ok(
          await req(
            `/api/v1/sprints/${f.sprint}/tasks`,
            { method: 'POST', body: JSON.stringify({ task_ids: [f.taskId] }) },
            { cookie: bob.cookie },
          ),
        );
      }
      const before = h.db.select().from(tasks).where(eq(tasks.id, f.taskId)).get();

      expect(await refusal(await FENCED[route]!(f, { bearer: f.secret, generation: 2 }))).toEqual({
        status: 409,
        code: 'conflict',
        reason: 'stale_claim',
      });
      expect(h.db.select().from(tasks).where(eq(tasks.id, f.taskId)).get()).toEqual(before);
    });
  }
});
