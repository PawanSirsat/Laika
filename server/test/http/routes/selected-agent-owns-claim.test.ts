import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  agentSessions,
  handoffOffers,
  orgs,
  taskClaims,
  tasks,
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
 * D-119 — the selected agent owns the claim — and D-118's session line, over
 * HTTP (LAI-586; proposal `docs/proposals/LAI-532-agent-identity-model.md`).
 *
 * D-119: *"When a task has a selected agent, only sessions of that agent may
 * claim it. Any other agent gets `409 conflict` with reason
 * `selected_for_another_agent`, naming the selected agent if the caller may see
 * it. With no selected agent, any eligible agent may claim, as today."*
 *
 * D-118: *"Each session records what actually ran, self-reported and labelled
 * as such: the underlying harness (e.g. Codex), its version, and the model."*
 *
 * Every refusal asserts the status, the §6.3 `code` **and** `details.reason`.
 * MCP's twin is `test/mcp/selected-agent-owns-claim.test.ts`.
 */

const PASSWORD = 'correct-horse-battery-staple';
const LEASE = DEFAULT_CLAIM_TIMINGS.expireMs;

let h: AuthHarness;
let ownerCookie: string;
let bob: { cookie: string; id: string };

interface Auth {
  cookie?: string;
  bearer?: string;
  generation?: number;
}

interface Registered {
  agent: { id: string; display_name: string };
  secret: string;
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

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}

async function refusal(res: Response) {
  const text = await res.text();
  const body = JSON.parse(text) as ErrorBody;
  return {
    status: res.status,
    code: body.error.code,
    reason: body.error.details?.reason,
    details: body.error.details,
    text,
  };
}

async function register(
  name: string,
  grants: { project_id: string; scope: 'full' | 'read_only' }[],
  cookie = bob.cookie,
): Promise<Registered> {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({ display_name: name, harness: 'claude-code', grants }),
      },
      { cookie },
    ),
    201,
  )) as unknown as Registered;
}

let alpha: string;

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

function select(taskId: string, agentId: string | null) {
  return req(
    `/api/v1/tasks/${taskId}`,
    { method: 'PATCH', body: JSON.stringify({ selected_agent_id: agentId }) },
    { cookie: bob.cookie },
  );
}

function claimReq(taskId: string, secret: string, sessionId?: string) {
  return req(
    `/api/v1/tasks/${taskId}/claim`,
    {
      method: 'POST',
      body: sessionId === undefined ? '' : JSON.stringify({ session_id: sessionId }),
    },
    { bearer: secret },
  );
}

async function claim(taskId: string, secret: string, sessionId?: string) {
  const res = await claimReq(taskId, secret, sessionId);
  await ok(res);
  return {
    generation: Number(res.headers.get('X-Laika-Claim-Generation')),
    session: res.headers.get('X-Laika-Agent-Session') ?? '',
  };
}

function requests(taskId: string) {
  return h.db
    .select({ toAgentId: handoffOffers.toAgentId, state: handoffOffers.state })
    .from(handoffOffers)
    .where(and(eq(handoffOffers.taskId, taskId), eq(handoffOffers.kind, 'work_request')))
    .all();
}

function claimsOf(taskId: string) {
  return h.db.select().from(taskClaims).where(eq(taskClaims.taskId, taskId)).all();
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

describe('D-119: the selected agent owns the claim', () => {
  it('the selected agent claims, and its work request is accepted', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'open' }]);

    const taken = await claim(taskId, polly.secret);

    expect(taken.generation).toBe(1);
    expect(claimsOf(taskId).map((c) => [c.agentId, c.state])).toEqual([[polly.agent.id, 'active']]);
    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'accepted' }]);
  });

  it('another agent is refused selected_for_another_agent, and nothing moves — not the task, not the request', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    const sessionsBefore = h.db.select().from(agentSessions).all().length;

    const r = await refusal(await claimReq(taskId, direct.secret));

    expect([r.status, r.code, r.reason]).toEqual([409, 'conflict', 'selected_for_another_agent']);
    // The caller may read the project, where `TaskView.selected_agent` already
    // shows the selection — so the refusal names it.
    expect(r.details).toMatchObject({
      task_id: taskId,
      selected_agent_id: polly.agent.id,
      selected_agent: {
        id: polly.agent.id,
        display_name: 'Polly · Belka',
        harness: 'claude-code',
        device_label: null,
      },
    });
    // The 2026-10-29 case: no claim beside the open request.
    expect(claimsOf(taskId)).toEqual([]);
    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'open' }]);
    const task = h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
    expect([task.status, task.assigneeId]).toEqual(['backlog', null]);
    // The refused attempt opened no session either.
    expect(h.db.select().from(agentSessions).all()).toHaveLength(sessionsBefore);

    // The selected agent can still take it.
    await claim(taskId, polly.secret);
    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'accepted' }]);
  });

  it('with no selected agent, any eligible agent claims, as before', async () => {
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();

    const taken = await claim(taskId, direct.secret);

    expect(taken.generation).toBe(1);
    expect(requests(taskId)).toEqual([]);
  });

  it('a cleared selection frees the task for any agent; a re-selection binds it again', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const first = await newTask('first');
    await ok(await select(first, polly.agent.id));
    await ok(await select(first, null));
    await claim(first, direct.secret);

    const second = await newTask('second');
    await ok(await select(second, polly.agent.id));
    await ok(await select(second, direct.agent.id));
    expect((await refusal(await claimReq(second, polly.secret))).reason).toBe(
      'selected_for_another_agent',
    );
    await claim(second, direct.secret);
  });

  it('the holder renewing its own claim is not asked again', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    const taken = await claim(taskId, polly.secret);

    const again = await claim(taskId, polly.secret, taken.session);

    expect(again.generation).toBe(taken.generation);
  });

  describe('a claim held by an agent that is not selected (taken before D-119, or before the selection)', () => {
    /**
     * The 2026-10-29 shape, written directly — the API no longer lets it
     * happen: Polly selected with an open request, while Claude Code holds a
     * live claim.
     */
    async function held() {
      const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
      const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
      const taskId = await newTask();
      const taken = await claim(taskId, direct.secret);
      h.db.update(tasks).set({ selectedAgentId: polly.agent.id }).where(eq(tasks.id, taskId)).run();
      h.db
        .insert(handoffOffers)
        .values({
          id: `wr-${taskId}`,
          taskId,
          kind: 'work_request',
          toAgentId: polly.agent.id,
          state: 'open',
          createdByUserId: bob.id,
          createdAt: Date.now(),
          closedAt: null,
        })
        .run();
      return { polly, direct, taskId, taken };
    }

    function lease(taskId: string) {
      return claimsOf(taskId).map((c) => [c.state, c.leaseExpiresAt]);
    }

    it('cannot renew it through the claim, with its own session: selected_for_another_agent', async () => {
      const { polly, direct, taskId, taken } = await held();
      const before = lease(taskId);

      const r = await refusal(await claimReq(taskId, direct.secret, taken.session));

      expect([r.status, r.code, r.reason]).toEqual([409, 'conflict', 'selected_for_another_agent']);
      expect(r.details?.selected_agent_id).toBe(polly.agent.id);
      // Not renewed: the lease is exactly what it was.
      expect(lease(taskId)).toEqual(before);
      // A new session of the same agent is refused too.
      expect((await refusal(await claimReq(taskId, direct.secret))).reason).toBe(
        'selected_for_another_agent',
      );
    });

    it('cannot change the task under it: the fence refuses selected_for_another_agent', async () => {
      const { direct, taskId, taken } = await held();

      for (const res of [
        await req(
          `/api/v1/tasks/${taskId}`,
          { method: 'PATCH', body: JSON.stringify({ title: 'mine' }) },
          { bearer: direct.secret, generation: taken.generation },
        ),
        // Finishing it into review is a change like any other.
        await req(
          `/api/v1/tasks/${taskId}/status`,
          { method: 'POST', body: JSON.stringify({ status: 'review' }) },
          { bearer: direct.secret, generation: taken.generation },
        ),
      ]) {
        const r = await refusal(res);
        expect([r.status, r.code, r.reason]).toEqual([
          409,
          'conflict',
          'selected_for_another_agent',
        ]);
      }
      const task = h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
      expect([task.title, task.status]).toEqual(['Work', 'in_progress']);
    });

    it('its heartbeat does not renew it: the claim ends released, recorded, and reported lost', async () => {
      const { polly, direct, taskId, taken } = await held();

      const beat = await ok(
        await req(
          `/api/v1/agent-sessions/${taken.session}/heartbeat`,
          { method: 'POST', body: '' },
          { bearer: direct.secret },
        ),
      );

      expect(beat.claims).toEqual([]);
      expect(
        (beat.lost as { state: string; generation: number }[]).map((c) => [c.state, c.generation]),
      ).toEqual([['released', taken.generation]]);
      expect(claimsOf(taskId).map((c) => c.state)).toEqual(['released']);
      const ended = h.db
        .select()
        .from(activity)
        .where(and(eq(activity.taskId, taskId), eq(activity.actorKind, 'system')))
        .all();
      expect(ended.map((r) => [r.type, JSON.parse(r.payloadJson) as unknown])).toEqual([
        [
          'task.updated',
          {
            field: 'claim',
            from: {
              generation: taken.generation,
              session_id: taken.session,
              agent_id: direct.agent.id,
            },
            to: null,
            reason: 'selected_for_another_agent',
          },
        ],
      ]);

      // The old holder cannot take it back by any route …
      const reclaim = await refusal(
        await req(
          `/api/v1/tasks/${taskId}/claim/reclaim`,
          { method: 'POST', body: '' },
          {
            bearer: direct.secret,
          },
        ),
      );
      expect([reclaim.status, reclaim.code, reclaim.reason]).toEqual([
        409,
        'conflict',
        'selected_for_another_agent',
      ]);
      // … and the selected agent claims at once, accepting its request.
      const next = await claim(taskId, polly.secret);
      expect(next.generation).toBe(taken.generation + 1);
      expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'accepted' }]);
    });

    it('a holder that never heartbeats again: its lease ends it released, not expired, so the selected agent is not locked out', async () => {
      const { polly, taskId, taken } = await held();

      expireClaims(h.db, Date.now() + LEASE + 1);

      expect(claimsOf(taskId).map((c) => c.state)).toEqual(['released']);
      const next = await claim(taskId, polly.secret);
      expect(next.generation).toBe(taken.generation + 1);
    });

    it('while it is live the selected agent hears claim_held — the claim is not taken over', async () => {
      const { polly, taskId } = await held();
      expect((await refusal(await claimReq(taskId, polly.secret))).reason).toBe('claim_held');
    });
  });

  it('a caller who may not claim hears that, and nothing about the selection', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const reader = await register('Reader', [{ project_id: alpha, scope: 'read_only' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));

    const r = await refusal(await claimReq(taskId, reader.secret));

    expect([r.status, r.code]).toEqual([403, 'forbidden']);
    expect(r.reason).not.toBe('selected_for_another_agent');
    expect(r.text).not.toContain(polly.agent.id);
    expect(r.text).not.toContain('Polly');
  });

  it('a selection changed while the claim lapsed binds the reclaim too', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, direct.agent.id));
    await claim(taskId, direct.secret);
    expireClaims(h.db, Date.now() + LEASE + 1);
    // No live claim now, so the selection may move (LAI-541).
    await ok(await select(taskId, polly.agent.id));

    const r = await refusal(
      await req(
        `/api/v1/tasks/${taskId}/claim/reclaim`,
        { method: 'POST', body: '' },
        {
          bearer: direct.secret,
        },
      ),
    );

    expect([r.status, r.code, r.reason]).toEqual([409, 'conflict', 'selected_for_another_agent']);
    expect(r.details?.selected_agent_id).toBe(polly.agent.id);
    expect(claimsOf(taskId).map((c) => c.state)).toEqual(['expired']);
  });

  it('changing the selection while another agent holds a live claim stays refused claim_held', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, direct.agent.id));
    await claim(taskId, direct.secret);

    const r = await refusal(await select(taskId, polly.agent.id));

    expect([r.status, r.code, r.reason]).toEqual([409, 'conflict', 'claim_held']);
    expect((await refusal(await select(taskId, null))).reason).toBe('claim_held');
  });

  it('reads and comments are never refused to another agent', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));

    const read = await ok(await req(`/api/v1/tasks/${taskId}`, {}, { bearer: direct.secret }));
    expect((read.selected_agent as { id: string }).id).toBe(polly.agent.id);
    await ok(
      await req(
        `/api/v1/tasks/${taskId}/comments`,
        { method: 'POST', body: JSON.stringify({ body_md: 'over to Polly' }) },
        { bearer: direct.secret },
      ),
      201,
    );
  });

  it('a person claiming is unchanged by a selected agent', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));

    const view = await ok(
      await req(
        `/api/v1/tasks/${taskId}/claim`,
        { method: 'POST', body: '' },
        {
          cookie: bob.cookie,
        },
      ),
    );

    expect([view.status, view.assignee_id]).toEqual(['in_progress', bob.id]);
  });
});

describe('review round 2', () => {
  function adaId(): string {
    return h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  }

  function assign(taskId: string, userId: string) {
    return req(
      `/api/v1/tasks/${taskId}`,
      { method: 'PATCH', body: JSON.stringify({ assignee_id: userId }) },
      { cookie: bob.cookie },
    );
  }

  it('a task assigned to another person: a non-selected agent hears selected_for_another_agent, not the assignee', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await assign(taskId, adaId()));
    await ok(await select(taskId, polly.agent.id));

    const r = await refusal(await claimReq(taskId, direct.secret));

    expect([r.status, r.code, r.reason]).toEqual([409, 'conflict', 'selected_for_another_agent']);
    expect(r.details?.selected_agent_id).toBe(polly.agent.id);
    expect(claimsOf(taskId)).toEqual([]);
    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'open' }]);
  });

  it('the selected agent keeps the assignee rule as before: its open request lets it claim', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await assign(taskId, adaId()));
    await ok(await select(taskId, polly.agent.id));

    await claim(taskId, polly.secret);

    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'accepted' }]);
    // A claim does not assign (D-114 item 7): Ada stays accountable.
    expect(h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.assigneeId).toBe(adaId());
  });

  it('with no selection the assignee rule answers as before', async () => {
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await assign(taskId, adaId()));

    const r = await refusal(await claimReq(taskId, direct.secret));

    expect([r.status, r.code, r.details?.assignee_id]).toEqual([409, 'conflict', adaId()]);
    expect(r.reason).toBeUndefined();
  });

  it('a reclaim accepts the work request re-issued while the claim was expired', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    const taken = await claim(taskId, polly.secret);
    expireClaims(h.db, Date.now() + LEASE + 1);
    await ok(await select(taskId, direct.agent.id));
    await ok(await select(taskId, polly.agent.id));
    expect(requests(taskId).filter((r) => r.state === 'open')).toEqual([
      { toAgentId: polly.agent.id, state: 'open' },
    ]);

    const back = await ok(
      await req(
        `/api/v1/tasks/${taskId}/claim/reclaim`,
        { method: 'POST', body: '' },
        {
          bearer: polly.secret,
        },
      ),
    );

    expect((back.claim as { generation: number }).generation).toBe(taken.generation + 1);
    expect(requests(taskId)).toEqual([
      { toAgentId: polly.agent.id, state: 'accepted' },
      { toAgentId: direct.agent.id, state: 'cancelled' },
      { toAgentId: polly.agent.id, state: 'accepted' },
    ]);
  });
});

describe('a task the caller cannot see answers exactly as one that does not exist', () => {
  /** The body with nothing but bytes: what a caller learns is exactly this. */
  async function bytes(res: Response) {
    return { status: res.status, body: await res.text() };
  }

  async function hiddenSelectedTask() {
    // Polly is selected on an alpha task; the caller has no way to see alpha.
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    return { polly, taskId };
  }

  async function betaProject(): Promise<string> {
    const beta = await ok(
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
    return beta.id as string;
  }

  const missing = '01ZZZZZZZZZZZZZZZZZZZZZZZZ';

  it('REST claim, an agent with no grant on the project', async () => {
    const { polly, taskId } = await hiddenSelectedTask();
    const outsider = await register('Codex · Strelka', [
      { project_id: await betaProject(), scope: 'full' },
    ]);

    const hidden = await bytes(await claimReq(taskId, outsider.secret));
    const none = await bytes(await claimReq(missing, outsider.secret));

    expect(hidden.status).toBe(404);
    expect(hidden).toEqual(none);
    expect(hidden.body).not.toContain(polly.agent.id);
    expect(hidden.body).not.toContain('Polly');
    expect(hidden.body).not.toContain(taskId);
  });

  it('REST claim, a personal token pinned to another project', async () => {
    const { polly, taskId } = await hiddenSelectedTask();
    const beta = await betaProject();
    const token = await ok(
      await req(
        '/api/v1/tokens',
        {
          method: 'POST',
          body: JSON.stringify({ name: 'pinned', scope: 'full', project_ids: [beta] }),
        },
        { cookie: bob.cookie },
      ),
      201,
    );

    const hidden = await bytes(await claimReq(taskId, token.secret as string));
    const none = await bytes(await claimReq(missing, token.secret as string));

    expect(hidden.status).toBe(404);
    expect(hidden).toEqual(none);
    expect(hidden.body).not.toContain(polly.agent.id);
  });

  it('REST reclaim, an agent with no grant on the project', async () => {
    const { polly, taskId } = await hiddenSelectedTask();
    const outsider = await register('Codex · Strelka', [
      { project_id: await betaProject(), scope: 'full' },
    ]);
    const reclaim = (id: string) =>
      req(
        `/api/v1/tasks/${id}/claim/reclaim`,
        { method: 'POST', body: '' },
        {
          bearer: outsider.secret,
        },
      );

    const hidden = await bytes(await reclaim(taskId));
    const none = await bytes(await reclaim(missing));

    expect(hidden.status).toBe(404);
    expect(hidden).toEqual(none);
    expect(hidden.body).not.toContain(polly.agent.id);
    expect(hidden.body).not.toContain('Polly');
  });
});

describe('no other route creates or renews a claim for an agent that is not selected', () => {
  it('a status change to in progress moves the task and takes no claim; the selected agent still can', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));

    await ok(
      await req(
        `/api/v1/tasks/${taskId}/status`,
        { method: 'POST', body: JSON.stringify({ status: 'in_progress' }) },
        { bearer: direct.secret },
      ),
    );

    expect(claimsOf(taskId)).toEqual([]);
    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'open' }]);
    const taken = await claim(taskId, polly.secret);
    expect(claimsOf(taskId).map((c) => [c.agentId, c.generation])).toEqual([
      [polly.agent.id, taken.generation],
    ]);
  });

  it('a heartbeat of a session that holds nothing takes nothing', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    const session = await ok(
      await req('/api/v1/agent-sessions', { method: 'POST', body: '' }, { bearer: direct.secret }),
      201,
    );

    const beat = await ok(
      await req(
        `/api/v1/agent-sessions/${session.id as string}/heartbeat`,
        { method: 'POST', body: '' },
        { bearer: direct.secret },
      ),
    );

    expect([beat.claims, beat.lost]).toEqual([[], []]);
    expect(claimsOf(taskId)).toEqual([]);
  });

  it('finishing into review, held by nobody: the review rule refuses it, and no claim is taken', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const direct = await register('Claude Code · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    await ok(
      await req(
        `/api/v1/tasks/${taskId}/status`,
        { method: 'POST', body: JSON.stringify({ status: 'in_progress' }) },
        { cookie: bob.cookie },
      ),
    );

    const r = await refusal(
      await req(
        `/api/v1/tasks/${taskId}/status`,
        { method: 'POST', body: JSON.stringify({ status: 'review' }) },
        { bearer: direct.secret },
      ),
    );

    // §5's review rule: only the assignee, the claim's holder, a lead or an
    // admin — an agent holding nothing is none of them.
    expect([r.status, r.code]).toEqual([403, 'forbidden']);
    expect(h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.status).toBe('in_progress');
    expect(claimsOf(taskId)).toEqual([]);
    expect(requests(taskId)).toEqual([{ toAgentId: polly.agent.id, state: 'open' }]);
  });
});

describe('D-118: a session says what ran', () => {
  async function start(secret: string, body: Record<string, unknown>) {
    return req(
      '/api/v1/agent-sessions',
      { method: 'POST', body: JSON.stringify(body) },
      {
        bearer: secret,
      },
    );
  }

  function heartbeat(secret: string, sessionId: string, body?: Record<string, unknown>) {
    return req(
      `/api/v1/agent-sessions/${sessionId}/heartbeat`,
      { method: 'POST', body: body === undefined ? '' : JSON.stringify(body) },
      { bearer: secret },
    );
  }

  it('round-trips harness, version and model; a heartbeat changes the model and keeps the rest', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const session = await ok(
      await start(polly.secret, {
        harness: 'codex',
        harness_version: '0.42.1',
        model: 'gpt-5.5',
        client_version: '1.2.0',
      }),
      201,
    );
    expect(session).toMatchObject({
      harness: 'codex',
      harness_version: '0.42.1',
      model: 'gpt-5.5',
      client_version: '1.2.0',
    });

    const beat = await ok(
      await heartbeat(polly.secret, session.id as string, { model: 'claude-opus-5-5' }),
    );
    expect(beat.session).toMatchObject({
      harness: 'codex',
      harness_version: '0.42.1',
      model: 'claude-opus-5-5',
      client_version: '1.2.0',
    });
    // No body at all is a heartbeat, as it always was, and changes nothing.
    const bare = await ok(await heartbeat(polly.secret, session.id as string));
    expect((bare.session as { model: string }).model).toBe('claude-opus-5-5');

    const agent = await ok(
      await req(`/api/v1/agents/${polly.agent.id}`, {}, { cookie: bob.cookie }),
    );
    expect(agent.sessions).toEqual([
      expect.objectContaining({
        id: session.id,
        harness: 'codex',
        harness_version: '0.42.1',
        model: 'claude-opus-5-5',
      }),
    ]);
  });

  it('refuses a malformed field 422 naming it, on start and on heartbeat', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const fieldOf = (r: { details: Record<string, unknown> | null }) =>
      // The set: an empty string fails both the length and the shape.
      [...new Set((r.details?.issues as { path: string }[] | undefined)?.map((i) => i.path))];
    for (const [field, body] of [
      ['harness', { harness: 'Codex CLI' }],
      ['harness', { harness: 'x'.repeat(65) }],
      ['harness', { harness: '' }],
      ['harness_version', { harness_version: '1.0 beta' }],
      ['model', { model: 'gpt\n5' }],
      ['model', { model: 'm'.repeat(121) }],
    ] as const) {
      const r = await refusal(await start(polly.secret, body));
      expect([r.status, r.code, fieldOf(r)], JSON.stringify(body)).toEqual([
        422,
        'unprocessable',
        [field],
      ]);
    }
    expect(h.db.select().from(agentSessions).all()).toEqual([]);

    const session = await ok(await start(polly.secret, {}), 201);
    const r = await refusal(await heartbeat(polly.secret, session.id as string, { model: 'a\tb' }));
    expect([r.status, r.code, fieldOf(r)]).toEqual([422, 'unprocessable', ['model']]);
  });

  it('another person cannot read the sessions: GET /agents/:id is 404', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    expect(
      (await req(`/api/v1/agents/${polly.agent.id}`, {}, { cookie: ownerCookie })).status,
    ).toBe(404);
  });

  it('activity rows keep the session as it was when they were written', async () => {
    const polly = await register('Polly · Belka', [{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask();
    await ok(await select(taskId, polly.agent.id));
    const session = await ok(
      await start(polly.secret, { harness: 'codex', harness_version: '0.42.1', model: 'gpt-5.5' }),
      201,
    );
    const taken = await claim(taskId, polly.secret, session.id as string);

    await ok(await heartbeat(polly.secret, session.id as string, { model: 'gpt-5.5-mini' }));
    await ok(
      await req(
        `/api/v1/tasks/${taskId}`,
        { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) },
        { bearer: polly.secret, generation: taken.generation },
      ),
    );
    await ok(
      await req(
        `/api/v1/tasks/${taskId}/status`,
        { method: 'POST', body: JSON.stringify({ status: 'review' }) },
        { bearer: polly.secret, generation: taken.generation },
      ),
    );

    const feed = await ok(await req('/api/v1/projects/alpha/activity', {}, { cookie: bob.cookie }));
    const rows = (feed.data as { type: string; agent_session: unknown; payload: unknown }[])
      .slice()
      .reverse();
    const byType = (type: string) => rows.filter((r) => r.type === type);
    const at = (model: string) => ({
      id: session.id,
      harness: 'codex',
      harness_version: '0.42.1',
      model,
    });

    // Written by Bob in the browser: no session.
    expect(byType('task.created')[0]?.agent_session).toBeNull();
    expect(byType('task.agent_selected')[0]?.agent_session).toBeNull();
    // The claim, under the model it reported then.
    expect(byType('task.status_changed')[0]?.agent_session).toEqual(at('gpt-5.5'));
    // After the heartbeat: the new model, and the earlier row unchanged.
    expect(byType('task.updated')[0]?.agent_session).toEqual(at('gpt-5.5-mini'));
    // Finishing into review releases the claim — and still says what ran.
    expect(byType('task.status_changed')[1]?.agent_session).toEqual(at('gpt-5.5-mini'));

    const stored = h.db.select().from(activity).where(eq(activity.taskId, taskId)).all();
    expect(stored.filter((r) => r.agentSessionId !== null)).toHaveLength(3);
  });
});
