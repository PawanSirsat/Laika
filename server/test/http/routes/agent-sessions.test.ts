import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  orgs,
  taskClaims,
  taskDependencies,
  tasks,
  taskTags,
  users,
} from '../../../src/db/schema.ts';
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

/**
 * D-120 allows one active agent per harness per device, so each fixture agent
 * after a test's first is on a device of its own; the first keeps the label
 * the assertions name.
 */
let fixtureAgents = 0;
const fixtureDevice = (first: string | null): string | null =>
  fixtureAgents++ === 0 ? first : `device-${fixtureAgents}`;

async function register(name = 'Bob’s Claude') {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: name,
          harness: 'claude-code',
          device_label: fixtureDevice(null),
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
  fixtureAgents = 0;
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
    // A claim never assigns (D-114 item 7): unassigned stays unassigned.
    expect(taken.task).toMatchObject({ id: taskId, status: 'in_progress', assignee_id: null });
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
 * **Every mounted mutating route, read from the app's own route table** —
 * `h.app.routes`, what Hono actually serves, not a regex over the route files
 * (LAI-541 review). A route added anywhere, under any prefix, appears here
 * and must be classified: FENCED (probed below, the task left exactly as it
 * was) or NOT_FENCED with the reason. The reasons say why the route cannot
 * change a claimed task through a token, which is the property.
 */
function mountedMutations(): string[] {
  const methods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return [
    ...new Set(
      h.app.routes.filter((r) => methods.has(r.method)).map((r) => `${r.method} ${r.path}`),
    ),
  ].sort();
}

interface Fixture {
  taskId: string;
  key: string;
  other: string;
  sprint: string;
  otherSprint: string;
  statusId: string;
  spareStatusId: string;
  agentSecret: string;
  siblingSecret: string;
  adaLegacy: string;
  bobLegacy: string;
}

type Probe = (f: Fixture) => Promise<Response>;

/** A stale generation from the holder's own agent. */
const asHolder = (f: Fixture): Auth => ({ bearer: f.agentSecret, generation: 2 });
/** The owner's legacy token — the token that may administer the space. */
const asAdmin = (f: Fixture): Auth => ({ bearer: f.adaLegacy });

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

/** Each fenced route, with the request that would change the claimed task, and the reason it is refused with. */
const FENCED: Record<string, { probe: Probe; reason: 'stale_claim' | 'claim_held' }> = {
  'PATCH /api/v1/tasks/:id': {
    probe: (f) => patch(f.taskId, { title: 'Stale' }, asHolder(f)),
    reason: 'stale_claim',
  },
  // §4.70 (LAI-545): a save passes the fence before anything about it is read.
  'POST /api/v1/tasks/:id/checkpoints': {
    probe: (f) =>
      req(
        `/api/v1/tasks/${f.taskId}/checkpoints`,
        json('POST', {
          id: '01JFENCEXXXXXXXXXXXXXXXXXX',
          idempotency_key: 'fence-probe',
          repo: 'kvelld/laika',
          branch: 'fenced',
          commit_sha: 'f'.repeat(40),
          manifest: [],
        }),
        asHolder(f),
      ),
    reason: 'stale_claim',
  },
  // §4.73 (LAI-546): an offer passes the fence before the checkpoint or the
  // receiver is read.
  'POST /api/v1/tasks/:id/handoff-offers': {
    probe: (f) =>
      req(
        `/api/v1/tasks/${f.taskId}/handoff-offers`,
        json('POST', {
          idempotency_key: 'fence-offer',
          to_agent_id: '01JRECEIVERXXXXXXXXXXXXXXX',
          checkpoint_id: '01JFENCEXXXXXXXXXXXXXXXXXX',
          reason: 'fenced',
        }),
        asHolder(f),
      ),
    reason: 'stale_claim',
  },
  'POST /api/v1/tasks/:id/finish': {
    probe: (f) =>
      req(`/api/v1/tasks/${f.taskId}/finish`, json('POST', { summary: 'x' }), asHolder(f)),
    reason: 'stale_claim',
  },
  'POST /api/v1/tasks/:id/status': {
    probe: (f) =>
      req(`/api/v1/tasks/${f.taskId}/status`, json('POST', { status: 'review' }), asHolder(f)),
    reason: 'stale_claim',
  },
  'POST /api/v1/tasks/:id/reorder': {
    probe: (f) =>
      req(
        `/api/v1/tasks/${f.taskId}/reorder`,
        json('POST', { after_task_id: f.other }),
        asHolder(f),
      ),
    reason: 'stale_claim',
  },
  'POST /api/v1/tasks/:id/dependencies': {
    probe: (f) =>
      req(
        `/api/v1/tasks/${f.taskId}/dependencies`,
        json('POST', { blocked_by_task_id: f.other }),
        asHolder(f),
      ),
    reason: 'stale_claim',
  },
  'DELETE /api/v1/tasks/:id/dependencies/:depId': {
    probe: (f) =>
      req(`/api/v1/tasks/${f.taskId}/dependencies/${f.other}`, { method: 'DELETE' }, asHolder(f)),
    reason: 'stale_claim',
  },
  'POST /api/v1/sprints/:id/tasks': {
    probe: (f) =>
      // Into the *other* sprint: moving it is the change.
      req(
        `/api/v1/sprints/${f.otherSprint}/tasks`,
        json('POST', { task_ids: [f.taskId] }),
        asHolder(f),
      ),
    reason: 'stale_claim',
  },
  'DELETE /api/v1/sprints/:id/tasks/:taskId': {
    probe: (f) =>
      req(`/api/v1/sprints/${f.sprint}/tasks/${f.taskId}`, { method: 'DELETE' }, asHolder(f)),
    reason: 'stale_claim',
  },
  // Indirect: each of these changes the claimed task without naming it.
  'DELETE /api/v1/sprints/:id': {
    probe: (f) => req(`/api/v1/sprints/${f.sprint}`, { method: 'DELETE' }, asAdmin(f)),
    reason: 'claim_held',
  },
  'DELETE /api/v1/projects/:slug/statuses/:id': {
    probe: (f) =>
      req(
        `/api/v1/projects/alpha/statuses/${f.statusId}`,
        json('DELETE', { move_to: f.spareStatusId }),
        asAdmin(f),
      ),
    reason: 'claim_held',
  },
  'PATCH /api/v1/projects/:slug/tags/:name': {
    probe: (f) =>
      req('/api/v1/projects/alpha/tags/held', json('PATCH', { name: 'renamed' }), asAdmin(f)),
    reason: 'claim_held',
  },
  'DELETE /api/v1/projects/:slug/tags/:name': {
    probe: (f) => req('/api/v1/projects/alpha/tags/held', { method: 'DELETE' }, asAdmin(f)),
    reason: 'claim_held',
  },
  'DELETE /api/v1/projects/:slug/members/:userId': {
    probe: (f) =>
      req(
        `/api/v1/projects/alpha/members/${bob.id}`,
        json('DELETE', { open_tasks: 'unassign' }),
        asAdmin(f),
      ),
    reason: 'claim_held',
  },
  'PATCH /api/v1/users/:id': {
    probe: (f) =>
      req(
        `/api/v1/users/${bob.id}`,
        json('PATCH', { is_active: false, open_tasks: 'unassign' }),
        asAdmin(f),
      ),
    reason: 'claim_held',
  },
};

/**
 * The presence heartbeat writes the matched task's branch. It never fails —
 * a beat always lands (§9.1) — so for a claimed task the branch is simply not
 * written, for anyone but the holder. Probed separately below.
 */
const BRANCH_WRITE = 'POST /api/v1/heartbeats';

/** Every other mutating route, and why it cannot change a claimed task through a token. */
const NOT_FENCED: Record<string, string> = {
  'POST /api/v1/tasks/:id/claim':
    'takes the claim — its refusals (claim_held, stale_claim) are asserted above',
  'POST /api/v1/tasks/:id/claim/reclaim':
    'issues the next generation — asserted above and in services/claims.test.ts',
  'POST /api/v1/tasks/:id/accept':
    'session only (§3.1): no token reaches it, and a person is never fenced',
  'POST /api/v1/tasks/:id/send-back':
    'session only (§3.1): no token reaches it, and a person is never fenced',
  'PUT /api/v1/tasks/:id/budget': 'session only (budget.set, §3.1)',
  'PUT /api/v1/tasks/:id/watch': "the caller's own subscription; changes no field of the task",
  'DELETE /api/v1/tasks/:id/watch': "the caller's own subscription; changes no field of the task",
  'POST /api/v1/tasks/:id/comments':
    'comments are never fenced (§6.3) — anyone who may read may speak',
  'PATCH /api/v1/comments/:id': 'comments are never fenced (§6.3)',
  'DELETE /api/v1/comments/:id': 'comments are never fenced (§6.3)',
  'POST /api/v1/projects/:slug/tasks': 'creates a task — nothing holds it yet',
  'POST /api/v1/unlisted/:id/promote': 'creates a task — nothing holds it yet',
  'POST /api/v1/meeting-reviews/:id/apply':
    'session-driven, and applies through createTask, changeStatus and updateTask — each of which runs the fence itself',
  'POST /api/v1/meeting-reviews/:id/discard': 'changes the review, not a task',
  'POST /webhooks/github': 'the system principal (§3.4, §10.1): evidence, not work — never fenced',
  'POST /webhooks/transcript': 'files a meeting review, not a task change',
  'PATCH /api/v1/sprints/:id':
    'the sprint’s own fields; completing it does not touch its tasks (§7.1)',
  'PUT /api/v1/sprints/:id/budget': 'session only (budget.set, §3.1)',
  'POST /api/v1/projects/:slug/sprints': 'a new sprint holds no task',
  'POST /api/v1/projects/:slug/statuses': 'a new status holds no task',
  'PATCH /api/v1/projects/:slug/statuses/:id':
    'a status’s name and visibility; no task row changes',
  'PUT /api/v1/projects/:slug/statuses/order': 'column order only; no task row changes',
  'PATCH /api/v1/projects/:slug': 'project fields and archiving; no task row changes',
  'PATCH /api/v1/projects/:slug/context': 'the project brief, not a task',
  'PUT /api/v1/projects/:slug/budget': 'session only (budget.set, §3.1)',
  'POST /api/v1/projects': 'a new project holds no task',
  'POST /api/v1/projects/:slug/join': 'a membership; no task row changes',
  'POST /api/v1/projects/:slug/leave': 'a membership; leaving moves none of the leaver’s tasks',
  'POST /api/v1/projects/:slug/members': 'a membership; no task row changes',
  'PATCH /api/v1/projects/:slug/members/:userId': 'a role; no task row changes',
  'POST /api/v1/agent-sessions': 'the agent’s own session (§4.65)',
  'POST /api/v1/agent-sessions/:id/heartbeat': 'renews only the session’s own claims',
  'POST /api/v1/agent-sessions/:id/end': 'releases only the session’s own claims',
  'POST /api/v1/agents': 'session only (agent.manage_own)',
  'PATCH /api/v1/agents/:id': 'session only (agent.manage_own)',
  'PUT /api/v1/agents/:id/grants': 'session only (agent.manage_own)',
  'PUT /api/v1/agents/:id/checkpoint-consent':
    'session only (agent.manage_own), a setting of the agent',
  'DELETE /api/v1/agents/:id/checkpoint-consent':
    'session only (agent.manage_own), a setting of the agent',
  'POST /api/v1/handoff-offers/:id/approve':
    'session only (task.handoff.approve); a person is never fenced (§6.3)',
  'POST /api/v1/handoff-offers/:id/accept':
    'the receiver takes a new claim in the accept’s own transaction; the sender’s claim is the one it ends (§4.73)',
  'POST /api/v1/handoff-offers/:id/decline':
    'the receiver answers an offer it does not hold a claim for; the sender’s paused claim resumes',
  'POST /api/v1/handoff-offers/:id/cancel':
    'closes an offer; the sender’s paused claim resumes, no task field changes',
  'PUT /api/v1/projects/:slug/handoff-policy': 'a project setting; no task row changes',
  'POST /api/v1/checkpoints/:id/refs':
    'a re-tag changes no task, only which ref is the checkpoint’s newest (§3.2) — it needs no claim',
  'POST /api/v1/agents/:id/rotate-token': 'session only (agent.manage_own)',
  'POST /api/v1/agents/:id/revoke': 'session only (agent.manage_own); its claims lapse, never move',
  'POST /api/v1/agents/devices/confirm':
    'session only (agent.manage_own); records the owner’s statement about a label, touches no task',
  'POST /api/v1/agents/devices/revoke':
    'session only (agent.manage_own); revokes each agent as /agents/:id/revoke does, its claims lapse',
  'POST /api/v1/agents/me/events/ack':
    'presence, as a heartbeat is (§4.77, LAI-553): records a delivery state, touches no task',
  'POST /api/v1/tokens': 'a credential, not a task',
  'DELETE /api/v1/tokens/:id': 'a credential, not a task',
  'DELETE /api/v1/users/:id/tokens/:tokenId': 'a credential, not a task',
  'POST /api/v1/users/:id/ratings': 'session only; a profile, not a task',
  'POST /api/v1/users/:id/reset-link': 'session only; an account, not a task',
  'POST /api/v1/users/:id/sign-out': 'ends sessions; no task row changes',
  'PATCH /api/v1/users/:id/profile': 'session only; a profile, not a task',
  'POST /api/v1/heartbeats': 'see BRANCH_WRITE: the beat lands, the claimed branch is not written',
  'POST /api/v1/invites': 'an invite, not a task',
  'POST /api/v1/invites/:id/reissue': 'an invite, not a task',
  'POST /api/v1/invites/accept': 'an account, not a task',
  'DELETE /api/v1/invites/:id': 'an invite, not a task',
  'DELETE /api/v1/unlisted/:id': 'unlisted work belongs to no task',
  'POST /api/v1/setup': 'first boot; no task exists',
  'POST /api/v1/password-resets/consume': 'an account, not a task',
  'POST /api/v1/auth/*': 'sign-in and sign-out, not a task',
  'PATCH /api/v1/org': 'organisation settings, not a task',
  'PUT /api/v1/org/permissions': 'session only (org.permissions.manage)',
  'POST /api/v1/org/transfer-ownership': 'session only (org.transfer_ownership)',
  'POST /api/v1/org/github-webhook': 'a webhook secret, not a task',
  'DELETE /api/v1/org/github-webhook': 'a webhook secret, not a task',
  'PUT /api/v1/org/model-prices/:model': 'session only (org.model_prices.set)',
  'DELETE /api/v1/org/model-prices/:model': 'session only (org.model_prices.set)',
  'PUT /api/v1/org/time': 'session only (org.time.set)',
  'PUT /api/v1/org/time/breaks': 'session only (org.time.set)',
  'PUT /api/v1/org/time/solidtime/import': 'session only (time_sync.import_all); time, not a task',
  'PUT /api/v1/org/time/solidtime/people': 'session only (time_sync.map)',
  'PUT /api/v1/org/time/solidtime/projects': 'session only (time_sync.map)',
  'POST /api/v1/otlp/v1/logs': 'telemetry, not a task',
  'POST /api/v1/otlp/v1/metrics': 'telemetry, not a task',
  'POST /api/v1/otlp/v1/traces': 'telemetry, not a task',
  'PUT /api/v1/me/activity-sharing': 'the caller’s own settings',
  'PUT /api/v1/me/local-activity': 'the caller’s own local counts',
  'DELETE /api/v1/me/local-activity': 'the caller’s own local counts',
  'PUT /api/v1/me/plan-limit': 'the caller’s own settings',
  'DELETE /api/v1/me/plan-limit': 'the caller’s own settings',
  'POST /api/v1/me/token-alerts/:id/dismiss': 'the caller’s own alerts',
  'PUT /api/v1/me/time-settings': 'the caller’s own time',
  'PUT /api/v1/me/time-drafts': 'the caller’s own time',
  'POST /api/v1/me/time-drafts': 'the caller’s own time',
  'DELETE /api/v1/me/time-drafts': 'the caller’s own time',
  'PATCH /api/v1/me/time-drafts/:id': 'the caller’s own time',
  'POST /api/v1/me/time-drafts/:id/split': 'the caller’s own time',
  'POST /api/v1/me/time-drafts/:id/dismiss': 'the caller’s own time',
  'POST /api/v1/me/time-drafts/:id/confirm': 'the caller’s own time',
  'POST /api/v1/me/time/days/:day/confirm': 'the caller’s own time',
  'PUT /api/v1/me/time/days/:day/note': 'the caller’s own time',
  'POST /api/v1/me/time/timer': 'the caller’s own time',
  'POST /api/v1/me/time/timer/pause': 'the caller’s own time',
  'POST /api/v1/me/time/timer/resume': 'the caller’s own time',
  'POST /api/v1/me/time/timer/stop': 'the caller’s own time',
  'DELETE /api/v1/me/time/timer': 'the caller’s own time',
  'POST /api/v1/me/time/undo': 'the caller’s own time',
  'POST /api/v1/me/time-breaks': 'the caller’s own time',
  'DELETE /api/v1/me/time-breaks/:id': 'the caller’s own time',
  'POST /api/v1/me/time-entries': 'the caller’s own time',
  'PATCH /api/v1/me/time-entries/:id': 'the caller’s own time',
  'DELETE /api/v1/me/time-entries/:id': 'the caller’s own time',
  'PUT /api/v1/me/time/solidtime/links': 'the caller’s own time',
  'PUT /api/v1/me/time/solidtime/import': 'the caller’s own time',
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
        heartbeat_age_ms: expect.any(Number) as number,
        connection: 'live',
        suspect_after_ms: DEFAULT_CLAIM_TIMINGS.suspectMs,
        device_label: null,
        // The session the claim opened reported nothing (LAI-593).
        harness: null,
        harness_version: null,
        model: null,
      });
    }
    // The claim response itself carries it too: the same view.
    expect(taken.task.claim).toMatchObject({ session_id: taken.session, generation: 1 });
    expect(await claimOnReads(free)).toEqual([null, null, null]);
  });

  it('carries what the holding session reported, and a heartbeat’s new model on the next read (LAI-593)', async () => {
    const { secret } = await register();
    const taskId = await newTask();
    const session = await ok(
      await req(
        '/api/v1/agent-sessions',
        json('POST', {
          harness: 'claude-code',
          harness_version: '2.1.0',
          model: 'claude-opus-5-5',
        }),
        { bearer: secret },
      ),
      201,
    );
    await claim(taskId, secret, session.id as string);

    for (const read of await claimOnReads(taskId)) {
      expect(read).toMatchObject({
        session_id: session.id,
        harness: 'claude-code',
        harness_version: '2.1.0',
        model: 'claude-opus-5-5',
      });
    }

    await ok(
      await req(
        `/api/v1/agent-sessions/${String(session.id)}/heartbeat`,
        json('POST', { model: 'claude-sonnet-5' }),
        { bearer: secret },
      ),
    );
    for (const read of await claimOnReads(taskId)) {
      expect(read).toMatchObject({ harness: 'claude-code', model: 'claude-sonnet-5' });
    }
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

  describe('never reaches a caller who cannot read the task', () => {
    /** A second project Bob is a member of, so a restriction is the only thing in the way. */
    async function beta(): Promise<string> {
      const created = await ok(
        await req(
          '/api/v1/projects',
          { method: 'POST', body: JSON.stringify({ name: 'beta', slug: 'beta', prefix: 'BET' }) },
          { cookie: ownerCookie },
        ),
        201,
      );
      await ok(
        await req(
          '/api/v1/projects/beta/members',
          { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
          { cookie: ownerCookie },
        ),
        201,
      );
      return created.id as string;
    }

    /** Bob's token pinned to `projectIds`; `null` is his unpinned one. */
    async function bobToken(projectIds: string[] | null): Promise<string> {
      return (
        await ok(
          await req(
            '/api/v1/tokens',
            json('POST', { name: 'reader', scope: 'full', project_ids: projectIds }),
            { cookie: bob.cookie },
          ),
          201,
        )
      ).secret as string;
    }

    /** Bob's agent granted only `projectIds`. */
    async function agentOn(projectIds: string[]): Promise<string> {
      return (
        await ok(
          await req(
            '/api/v1/agents',
            json('POST', {
              display_name: 'Elsewhere',
              harness: 'claude-code',
              device_label: fixtureDevice(null),
              grants: projectIds.map((project_id) => ({ project_id, scope: 'full' })),
            }),
            { cookie: bob.cookie },
          ),
          201,
        )
      ).secret as string;
    }

    /**
     * Every task read as `secret`: the single read and the alpha list refuse
     * `403` on `project.read` with `reason`, and the cross-project list
     * succeeds without the task. No answer carries the holder's session id.
     */
    async function readsAs(secret: string, taskId: string, session: string, reason?: string) {
      const refusedAs = async (res: Response) => {
        const text = await res.clone().text();
        const body = JSON.parse(text) as {
          error: { code: string; details: { action?: string; reason?: string } };
        };
        expect([res.status, body.error.code, body.error.details]).toEqual([
          403,
          'forbidden',
          { action: 'project.read', ...(reason === undefined ? {} : { reason }) },
        ]);
        return text;
      };
      const singleText = await refusedAs(
        await req(`/api/v1/tasks/${taskId}`, {}, { bearer: secret }),
      );
      const listedText = await refusedAs(
        await req('/api/v1/projects/alpha/tasks', {}, { bearer: secret }),
      );

      const all = await req('/api/v1/tasks', {}, { bearer: secret });
      const allText = await all.clone().text();
      const page = (await ok(all)) as unknown as { data: { id: string }[] };
      expect(page.data.map((v) => v.id)).not.toContain(taskId);

      for (const text of [singleText, listedText, allText]) expect(text).not.toContain(session);
    }

    /** The control: `secret` reads the claim on the single read and the cross-project list. */
    async function readsClaim(secret: string, taskId: string, session: string) {
      const single = await ok(await req(`/api/v1/tasks/${taskId}`, {}, { bearer: secret }));
      expect(single.claim).toMatchObject({ session_id: session });
      const page = (await ok(await req('/api/v1/tasks', {}, { bearer: secret }))) as unknown as {
        data: { id: string; claim: unknown }[];
      };
      expect(page.data.find((v) => v.id === taskId)?.claim).toMatchObject({ session_id: session });
    }

    it('a token pinned to another project', async () => {
      const betaId = await beta();
      const { secret } = await register();
      const taskId = await newTask();
      const taken = await claim(taskId, secret);

      // Positive control: Bob's unpinned token reads the claim, so the refusal
      // below is the pin and nothing else.
      await readsClaim(await bobToken(null), taskId, taken.session);

      await readsAs(await bobToken([betaId]), taskId, taken.session);
    });

    it('nor what the holding session reported (LAI-593)', async () => {
      const betaId = await beta();
      const { secret } = await register();
      const taskId = await newTask();
      const canary = 'model-canary-lai-593';
      const session = await ok(
        await req('/api/v1/agent-sessions', json('POST', { model: canary }), { bearer: secret }),
        201,
      );
      await claim(taskId, secret, session.id as string);

      // Positive control: Bob's unpinned token reads the model on the claim.
      const unpinned = await bobToken(null);
      const single = await ok(await req(`/api/v1/tasks/${taskId}`, {}, { bearer: unpinned }));
      expect(single.claim).toMatchObject({ model: canary });

      await readsAs(await bobToken([betaId]), taskId, canary);
    });

    it('an agent with no grant on the task’s project', async () => {
      const betaId = await beta();
      const { secret } = await register();
      const taskId = await newTask();
      const taken = await claim(taskId, secret);

      // Positive control: an agent granted alpha reads it.
      await readsClaim(await agentOn([alpha]), taskId, taken.session);

      await readsAs(await agentOn([betaId]), taskId, taken.session, 'agent_not_granted');
    });
  });
});

async function bearerSecret(cookie: string, name: string): Promise<string> {
  return (
    await ok(await req('/api/v1/tokens', json('POST', { name, scope: 'full' }), { cookie }), 201)
  ).secret as string;
}

/**
 * A claimed task with everything an indirect change could reach: assigned to
 * Bob (whose agent holds it), in a sprint, tagged, blocked by another task,
 * in a status a second one of the same category could absorb.
 */
async function fixture(): Promise<Fixture> {
  const agentSecret = (await register('Holder')).secret;
  const siblingSecret = (await register('Sibling')).secret;
  const adaLegacy = await bearerSecret(ownerCookie, 'ada-legacy');
  const bobLegacy = await bearerSecret(bob.cookie, 'bob-legacy');

  const created = await ok(
    await req('/api/v1/projects/alpha/tasks', json('POST', { title: 'Claimed', tags: ['held'] }), {
      cookie: bob.cookie,
    }),
    201,
  );
  const taskId = created.id as string;
  const other = await newTask('Other');
  const sprint = (
    await ok(
      await req(
        '/api/v1/projects/alpha/sprints',
        json('POST', {
          name: 'S1',
          starts_on: Date.UTC(2026, 0, 1),
          ends_on: Date.UTC(2026, 0, 14),
        }),
        { cookie: ownerCookie },
      ),
      201,
    )
  ).id as string;
  const otherSprint = (
    await ok(
      await req(
        '/api/v1/projects/alpha/sprints',
        json('POST', {
          name: 'S2',
          starts_on: Date.UTC(2026, 0, 15),
          ends_on: Date.UTC(2026, 0, 28),
        }),
        { cookie: ownerCookie },
      ),
      201,
    )
  ).id as string;
  await ok(await patch(taskId, { assignee_id: bob.id }, { cookie: bob.cookie }));
  await ok(
    await req(`/api/v1/sprints/${sprint}/tasks`, json('POST', { task_ids: [taskId] }), {
      cookie: bob.cookie,
    }),
  );
  await ok(
    await req(`/api/v1/tasks/${taskId}/dependencies`, json('POST', { blocked_by_task_id: other }), {
      cookie: bob.cookie,
    }),
    201,
  );
  await claim(taskId, agentSecret);
  const spare = await ok(
    await req(
      '/api/v1/projects/alpha/statuses',
      json('POST', { name: 'Doing too', category: 'in_progress' }),
      {
        cookie: ownerCookie,
      },
    ),
    201,
  );
  const statusId = h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!.statusId;
  return {
    taskId,
    key: created.key as string,
    other,
    sprint,
    statusId,
    spareStatusId: (spare.data as { id: string; name: string }[]).find(
      (st) => st.name === 'Doing too',
    )!.id,
    otherSprint,
    agentSecret,
    siblingSecret,
    adaLegacy,
    bobLegacy,
  };
}

/** What a fenced request must leave exactly as it was. */
function snapshot(taskId: string) {
  return {
    task: h.db.select().from(tasks).where(eq(tasks.id, taskId)).get(),
    tags: h.db.select().from(taskTags).where(eq(taskTags.taskId, taskId)).all(),
    deps: h.db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId)).all(),
  };
}

describe('the census: every mounted mutating route is fenced or named', () => {
  it('the app’s route table is exactly FENCED and NOT_FENCED', () => {
    const mounted = mountedMutations();
    expect(mounted.length, 'no routes read — the census is vacuous').toBeGreaterThan(50);
    expect(mounted).toEqual([...Object.keys(FENCED), ...Object.keys(NOT_FENCED)].sort());
    expect(Object.keys(NOT_FENCED)).toContain(BRANCH_WRITE);
  });

  for (const [route, { probe, reason }] of Object.entries(FENCED)) {
    it(`${route} is refused ${reason}, and changes nothing`, async () => {
      const f = await fixture();
      const before = snapshot(f.taskId);

      expect(await refusal(await probe(f))).toEqual({ status: 409, code: 'conflict', reason });
      expect(snapshot(f.taskId)).toEqual(before);
    });
  }

  async function branchFixture() {
    const f = await fixture();
    await ok(
      await req('/api/v1/projects/alpha', json('PATCH', { repo: 'acme/alpha' }), {
        cookie: ownerCookie,
      }),
    );
    const branchOf = () => h.db.select().from(tasks).where(eq(tasks.id, f.taskId)).get()?.branch;
    const beat = (secret: string, branch: string, generation?: number) =>
      req(
        '/api/v1/heartbeats',
        json('POST', { repo: 'acme/alpha', branch: `${f.key.toLowerCase()}-${branch}` }),
        { bearer: secret, ...(generation === undefined ? {} : { generation }) },
      );
    return { f, branchOf, beat };
  }

  it(`${BRANCH_WRITE}: a sibling agent and a legacy token cannot rewrite a claimed task’s branch; its holder can, with its generation`, async () => {
    const { f, branchOf, beat } = await branchFixture();
    const before = branchOf();

    for (const secret of [f.siblingSecret, f.bobLegacy]) {
      expect((await beat(secret, 'hijack')).status).toBe(202);
      expect(branchOf()).toBe(before);
    }
    expect((await beat(f.agentSecret, 'mine', 1)).status).toBe(202);
    expect(branchOf()).toBe(`${f.key.toLowerCase()}-mine`);
  });

  it(`${BRANCH_WRITE}: the holder with no generation or a stale one writes nothing — the beat still lands`, async () => {
    const { f, branchOf, beat } = await branchFixture();
    const before = branchOf();

    for (const generation of [undefined, 2]) {
      expect((await beat(f.agentSecret, 'stale', generation)).status).toBe(202);
      expect(branchOf()).toBe(before);
    }
  });

  it(`${BRANCH_WRITE}: the holder whose lease is overdue writes nothing, even with the live generation`, async () => {
    const { f, branchOf, beat } = await branchFixture();
    const before = branchOf();
    // Lapsed, not yet scanned: the fence's own lapse test refuses it.
    h.db
      .update(taskClaims)
      .set({ leaseExpiresAt: Date.now() - 1 })
      .where(eq(taskClaims.taskId, f.taskId))
      .run();

    expect((await beat(f.agentSecret, 'overdue', 1)).status).toBe(202);
    expect(branchOf()).toBe(before);
  });

  it(`${BRANCH_WRITE}: after a reclaim the old generation writes nothing; the new one does`, async () => {
    const { f, branchOf, beat } = await branchFixture();
    const before = branchOf();
    expect(expireClaims(h.db, Date.now() + LEASE + 1).changed).toBe(1);
    const reclaimed = await ok(
      await req(
        `/api/v1/tasks/${f.taskId}/claim/reclaim`,
        { method: 'POST' },
        { bearer: f.agentSecret },
      ),
    );
    expect(reclaimed).toMatchObject({ from_generation: 1, claim: { generation: 2 } });

    expect((await beat(f.agentSecret, 'old', 1)).status).toBe(202);
    expect(branchOf()).toBe(before);
    expect((await beat(f.agentSecret, 'new', 2)).status).toBe(202);
    expect(branchOf()).toBe(`${f.key.toLowerCase()}-new`);
  });

  // **Both checks on the one line** (integration of LAI-534 and LAI-541): the
  // branch write needs the agent's grant (`can(task.write)`, #102) AND the
  // live claim's fence (#107). Each case below passes one check and fails the
  // other, so dropping either check turns exactly one of them red.
  it(`${BRANCH_WRITE}: the live holder with its generation but a read_only grant writes nothing — the grant refuses`, async () => {
    const { f, branchOf, beat } = await branchFixture();
    const before = branchOf();
    const holder = h.db.select().from(taskClaims).where(eq(taskClaims.taskId, f.taskId)).get()!;
    await ok(
      await req(
        `/api/v1/agents/${holder.agentId}/grants`,
        json('PUT', { grants: [{ project_id: alpha, scope: 'read_only' }] }),
        { cookie: bob.cookie },
      ),
    );

    // The claim fence passes: the live claim, its holder, its generation.
    expect((await beat(f.agentSecret, 'read-only', holder.generation)).status).toBe(202);
    expect(branchOf()).toBe(before);
  });

  it(`${BRANCH_WRITE}: a sibling with a full grant, outside the claim, writes nothing — the claim refuses`, async () => {
    const { f, branchOf, beat } = await branchFixture();
    const before = branchOf();
    const holder = h.db.select().from(taskClaims).where(eq(taskClaims.taskId, f.taskId)).get()!;

    // The grant passes: the sibling is granted `full` on alpha, as the holder
    // is, and it even sends the live generation.
    expect((await beat(f.siblingSecret, 'sibling', holder.generation)).status).toBe(202);
    expect(branchOf()).toBe(before);
    // And the holder, both checks passing, does write.
    expect((await beat(f.agentSecret, 'holder', holder.generation)).status).toBe(202);
    expect(branchOf()).toBe(`${f.key.toLowerCase()}-holder`);
  });
});
