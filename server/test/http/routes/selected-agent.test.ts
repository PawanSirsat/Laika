import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activity,
  agents,
  handoffOffers,
  orgs,
  projects,
  tasks,
  tokens,
  users,
} from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * A task's selected agent and its work request over HTTP (SPEC §4.5, §6.4,
 * D-114 item 7, LAI-535), and `activity.agent_id` (§4.8, D-114 item 4).
 *
 * Every refusal asserts the §6.3 `code`, the `field` **and** the `reason`, so a
 * 404 from a wrong path or a 400 from a bad body cannot pass for the
 * eligibility check doing its job.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
let bob: { cookie: string; id: string };
let alpha: string;
let beta: string;

interface Auth {
  cookie?: string;
  bearer?: string;
}

async function req(path: string, init: RequestInit = {}, auth?: Auth): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  if (auth?.bearer !== undefined) headers.Authorization = `Bearer ${auth.bearer}`;
  return h.app.request(path, { ...init, headers: jsonHeaders(headers) });
}

/** Setup writes go through here, so one that fails cannot pass silently. */
async function ok(res: Response, status = 200): Promise<Record<string, unknown>> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Record<string, unknown>;
}

async function refusal(res: Response) {
  const body = (await res.json()) as {
    error: { code: string; details: { field?: unknown; reason?: unknown } | null };
  };
  return {
    status: res.status,
    code: body.error.code,
    field: body.error.details?.field,
    reason: body.error.details?.reason,
  };
}

interface Registered {
  agent: { id: string };
  token: { id: string };
  secret: string;
}

async function register(
  grants: { project_id: string; scope: 'full' | 'read_only' }[],
  cookie = bob.cookie,
  name = 'Bob’s Claude',
): Promise<Registered> {
  return (await ok(
    await req(
      '/api/v1/agents',
      {
        method: 'POST',
        body: JSON.stringify({
          display_name: name,
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

async function newTask(slug: string, auth: Auth = { cookie: bob.cookie }): Promise<string> {
  const body = await ok(
    await req(
      `/api/v1/projects/${slug}/tasks`,
      { method: 'POST', body: JSON.stringify({ title: 'Work' }) },
      auth,
    ),
    201,
  );
  return body.id as string;
}

function patch(taskId: string, body: unknown, auth: Auth = { cookie: bob.cookie }) {
  return req(`/api/v1/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) }, auth);
}

function offersOf(taskId: string) {
  return h.db.select().from(handoffOffers).where(eq(handoffOffers.taskId, taskId)).all();
}

function selections(taskId: string) {
  return h.db
    .select()
    .from(activity)
    .where(and(eq(activity.taskId, taskId), eq(activity.type, 'task.agent_selected')))
    .all();
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
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';

  const token = seedInvite(h.db, {
    orgId,
    createdBy: ownerId,
    email: 'bob@example.test',
    orgRole: 'member',
  });
  const signed = await signUp(h.app, {
    email: 'bob@example.test',
    password: PASSWORD,
    inviteToken: token,
  });
  expect(signed.status, await signed.clone().text()).toBe(200);
  bob = {
    cookie: cookieFrom(signed),
    id: h.db.select().from(users).where(eq(users.email, 'bob@example.test')).get()?.id ?? '',
  };

  for (const [slug, prefix] of [
    ['alpha', 'ALP'],
    ['beta', 'BET'],
  ] as const) {
    const created = await ok(
      await req(
        '/api/v1/projects',
        { method: 'POST', body: JSON.stringify({ name: slug, slug, prefix }) },
        { cookie: ownerCookie },
      ),
      201,
    );
    if (slug === 'alpha') alpha = created.id as string;
    else beta = created.id as string;
    await ok(
      await req(
        `/api/v1/projects/${slug}/members`,
        { method: 'POST', body: JSON.stringify({ user_id: bob.id, role: 'member' }) },
        { cookie: ownerCookie },
      ),
      201,
    );
  }
});

afterEach(() => {
  h.close();
});

describe('selecting an agent', () => {
  it('opens a work request and claims nothing: assignee, status and readiness are untouched', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask('alpha');
    const before = h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;

    const view = await ok(await patch(taskId, { selected_agent_id: agent.id }));

    expect(view).toMatchObject({
      assignee_id: null,
      status: before.status,
      status_id: before.statusId,
      ready: true,
      selected_agent: {
        id: agent.id,
        display_name: 'Bob’s Claude',
        harness: 'claude-code',
        device_label: 'Belka',
        status: 'active',
        owner: { id: bob.id, name: expect.any(String) as unknown },
      },
    });
    const after = h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
    expect(after).toMatchObject({
      assigneeId: null,
      status: before.status,
      statusId: before.statusId,
      startedAt: null,
      selectedAgentId: agent.id,
    });

    expect(offersOf(taskId)).toEqual([
      expect.objectContaining({
        kind: 'work_request',
        state: 'open',
        toAgentId: agent.id,
        createdByUserId: bob.id,
        closedAt: null,
      }),
    ]);

    const rows = selections(taskId);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payloadJson)).toEqual({ from: null, to: agent.id });
    expect(rows[0]).toMatchObject({ actorId: bob.id, actorKind: 'user', agentId: null });
  });

  it('leaves a human assignee exactly where it was', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask('alpha');
    await ok(await patch(taskId, { assignee_id: ownerId }));

    const view = await ok(await patch(taskId, { selected_agent_id: agent.id }));

    expect(view.assignee_id).toBe(ownerId);
    expect(h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.assigneeId).toBe(ownerId);
    // And selecting wrote no `task.assigned` beyond the one the assignment did.
    const assigned = h.db
      .select()
      .from(activity)
      .where(and(eq(activity.taskId, taskId), eq(activity.type, 'task.assigned')))
      .all();
    expect(assigned).toHaveLength(1);
  });

  it('the same agent again is a no-op: no second request, no second row', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask('alpha');

    await ok(await patch(taskId, { selected_agent_id: agent.id }));
    await ok(await patch(taskId, { selected_agent_id: agent.id }));

    expect(offersOf(taskId)).toHaveLength(1);
    expect(selections(taskId)).toHaveLength(1);
  });

  it('null withdraws the open request and records who withdrew it', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask('alpha');
    await ok(await patch(taskId, { selected_agent_id: agent.id }));

    const view = await ok(await patch(taskId, { selected_agent_id: null }));

    expect(view.selected_agent).toBeNull();
    expect(offersOf(taskId)).toEqual([
      expect.objectContaining({ state: 'cancelled', closedAt: expect.any(Number) as unknown }),
    ]);
    const rows = selections(taskId);
    expect(rows.map((r) => JSON.parse(r.payloadJson) as unknown)).toEqual([
      { from: null, to: agent.id },
      { from: agent.id, to: null },
    ]);
  });

  it('changing the agent cancels the first request and opens one for the second', async () => {
    const first = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'First');
    const second = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Second');
    const taskId = await newTask('alpha');

    await ok(await patch(taskId, { selected_agent_id: first.agent.id }));
    await ok(await patch(taskId, { selected_agent_id: second.agent.id }));

    const byAgent = new Map(offersOf(taskId).map((o) => [o.toAgentId, o.state]));
    expect(Object.fromEntries(byAgent)).toEqual({
      [first.agent.id]: 'cancelled',
      [second.agent.id]: 'open',
    });
  });

  it('changes freely while a person holds the task: an assignee is not a claim (LAI-541)', async () => {
    const first = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'First');
    const second = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Second');
    const taskId = await newTask('alpha');
    await ok(await patch(taskId, { selected_agent_id: first.agent.id }));
    await ok(
      await req(`/api/v1/tasks/${taskId}/claim`, { method: 'POST' }, { cookie: bob.cookie }),
    );

    const view = await ok(await patch(taskId, { selected_agent_id: second.agent.id }));
    expect((view.selected_agent as { id: string }).id).toBe(second.agent.id);
    expect(view.assignee_id).toBe(bob.id);
  });

  it('is refused while an agent session holds the live claim: that change is a hand-off (LAI-541, LAI-546)', async () => {
    const first = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'First');
    const second = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Second');
    const taskId = await newTask('alpha');
    await ok(await patch(taskId, { selected_agent_id: first.agent.id }));
    await ok(
      await req(`/api/v1/tasks/${taskId}/claim`, { method: 'POST' }, { bearer: first.secret }),
    );

    expect(await refusal(await patch(taskId, { selected_agent_id: second.agent.id }))).toEqual({
      status: 409,
      code: 'conflict',
      field: 'selected_agent_id',
      reason: 'claim_held',
    });
    expect(h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.selectedAgentId).toBe(
      first.agent.id,
    );
  });
});

describe('an agent that cannot be selected is 422 with the reason', () => {
  async function expectRefused(taskId: string, agentId: string, reason: string, auth?: Auth) {
    expect(await refusal(await patch(taskId, { selected_agent_id: agentId }, auth))).toEqual({
      status: 422,
      code: 'unprocessable',
      field: 'selected_agent_id',
      reason,
    });
    // Refused means nothing was written.
    expect(offersOf(taskId)).toEqual([]);
    expect(selections(taskId)).toEqual([]);
    expect(h.db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.selectedAgentId).toBeNull();
  }

  it('revoked', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    await ok(
      await req(`/api/v1/agents/${agent.id}/revoke`, { method: 'POST' }, { cookie: bob.cookie }),
    );
    await expectRefused(await newTask('alpha'), agent.id, 'agent_revoked');
  });

  it('no grant on the task’s project', async () => {
    const { agent } = await register([{ project_id: beta, scope: 'full' }]);
    await expectRefused(await newTask('alpha'), agent.id, 'agent_not_granted');
  });

  it('a read-only grant: it could not do the work', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'read_only' }]);
    await expectRefused(await newTask('alpha'), agent.id, 'agent_read_only');
  });

  it('another member’s agent — the hand-off policy’s default (LAI-546 opens it)', async () => {
    const adas = await register([{ project_id: alpha, scope: 'full' }], ownerCookie, 'Ada’s');
    await expectRefused(await newTask('alpha'), adas.agent.id, 'agent_other_owner');
  });

  it('another organisation’s agent', async () => {
    // The instance has one org, so the second is written directly: the check
    // must hold whether or not the API can produce the row.
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    const now = Date.now();
    h.db
      .insert(orgs)
      .values({
        id: 'other-org',
        name: 'Other',
        ownerUserId: ownerId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    h.db.update(agents).set({ orgId: 'other-org' }).where(eq(agents.id, agent.id)).run();
    await expectRefused(await newTask('alpha'), agent.id, 'agent_wrong_org');
  });

  it('an id that names no agent', async () => {
    await expectRefused(await newTask('alpha'), '01NOSUCHAGENT0000000000000', 'agent_not_found');
  });

  it('a space whose agents may not write', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask('alpha');
    h.db.update(projects).set({ agentsAllowed: false }).where(eq(projects.id, alpha)).run();
    await expectRefused(taskId, agent.id, 'agents_off');
  });

  it('a viewer may not select at all: task.write, not the eligibility check', async () => {
    const { agent } = await register([{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask('alpha');
    await ok(
      await req(
        `/api/v1/projects/alpha/members/${bob.id}`,
        { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) },
        { cookie: ownerCookie },
      ),
    );
    const res = await patch(taskId, { selected_agent_id: agent.id });
    expect(res.status).toBe(403);
    expect(offersOf(taskId)).toEqual([]);
  });
});

describe('activity.agent_id — read from the token, never back-filled', () => {
  async function legacyToken(): Promise<string> {
    const body = await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    );
    return body.secret as string;
  }

  function lastRow(taskId: string) {
    const rows = h.db.select().from(activity).where(eq(activity.taskId, taskId)).all();
    return rows[rows.length - 1]!;
  }

  it('an agent token’s write carries the agent; its owner is still the actor', async () => {
    const { agent, secret, token } = await register([{ project_id: alpha, scope: 'full' }]);
    const taskId = await newTask('alpha', { bearer: secret });

    expect(lastRow(taskId)).toMatchObject({
      type: 'task.created',
      actorId: bob.id,
      actorKind: 'agent',
      actorTokenId: token.id,
      agentId: agent.id,
    });

    await ok(await patch(taskId, { title: 'Renamed' }, { bearer: secret }));
    expect(lastRow(taskId)).toMatchObject({ type: 'task.updated', agentId: agent.id });
  });

  it('a legacy token’s write has none, and neither does a session’s', async () => {
    const secret = await legacyToken();
    const viaLegacy = await newTask('alpha', { bearer: secret });
    expect(lastRow(viaLegacy)).toMatchObject({ actorKind: 'agent', agentId: null });

    const viaCookie = await newTask('alpha');
    expect(lastRow(viaCookie)).toMatchObject({ actorKind: 'user', agentId: null });
  });

  it('an agent selecting its sibling is recorded as that agent, for its owner', async () => {
    const worker = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Worker');
    const lead = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Lead');
    const taskId = await newTask('alpha');

    await ok(await patch(taskId, { selected_agent_id: worker.agent.id }, { bearer: lead.secret }));

    expect(selections(taskId)[0]).toMatchObject({ actorId: bob.id, agentId: lead.agent.id });
    expect(offersOf(taskId)[0]).toMatchObject({
      createdByUserId: bob.id,
      toAgentId: worker.agent.id,
    });
  });

  it('the event stream’s view carries agent_id', async () => {
    const { agent, secret } = await register([{ project_id: alpha, scope: 'full' }]);
    await newTask('alpha', { bearer: secret });
    const feed = await ok(await req('/api/v1/projects/alpha/activity', {}, { cookie: bob.cookie }));
    const data = feed.data as { type: string; agent_id: string | null }[];
    expect(data.find((e) => e.type === 'task.created')?.agent_id).toBe(agent.id);
  });
});

describe('GET /agents/me/work-requests', () => {
  it('lists the calling agent’s open requests, and only its own', async () => {
    const mine = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Mine');
    const sibling = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Sibling');
    const asked = await newTask('alpha');
    const other = await newTask('alpha');
    await ok(await patch(asked, { selected_agent_id: mine.agent.id }));
    await ok(await patch(other, { selected_agent_id: sibling.agent.id }));

    const page = await ok(
      await req('/api/v1/agents/me/work-requests', {}, { bearer: mine.secret }),
    );

    expect(page.data).toEqual([
      expect.objectContaining({
        kind: 'work_request',
        state: 'open',
        task_id: asked,
        task_key: 'ALP-1',
        agent_id: mine.agent.id,
        requested_by: bob.id,
      }),
    ]);
    expect(page).toHaveProperty('next_cursor', null);
  });

  it('drops a withdrawn request and one on a project the agent no longer reaches', async () => {
    const { agent, secret } = await register([
      { project_id: alpha, scope: 'full' },
      { project_id: beta, scope: 'full' },
    ]);
    const a = await newTask('alpha');
    const b = await newTask('beta');
    await ok(await patch(a, { selected_agent_id: agent.id }));
    await ok(await patch(b, { selected_agent_id: agent.id }));
    await ok(await patch(a, { selected_agent_id: null }));
    await ok(
      await req(
        `/api/v1/agents/${agent.id}/grants`,
        { method: 'PUT', body: JSON.stringify({ grants: [{ project_id: alpha, scope: 'full' }] }) },
        { cookie: bob.cookie },
      ),
    );

    const page = await ok(await req('/api/v1/agents/me/work-requests', {}, { bearer: secret }));
    expect(page.data).toEqual([]);
  });

  it('pages through equal timestamps by (created_at, id): no duplicate, no skip', async () => {
    const { agent, secret } = await register([{ project_id: alpha, scope: 'full' }]);
    const asked: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const taskId = await newTask('alpha');
      await ok(await patch(taskId, { selected_agent_id: agent.id }));
      asked.push(taskId);
    }
    // Every request at one instant: only the id can order them now.
    h.db.update(handoffOffers).set({ createdAt: 1_800_000_000_000 }).run();
    const expected = h.db
      .select({ id: handoffOffers.id })
      .from(handoffOffers)
      .all()
      .map((r) => r.id)
      .sort()
      .reverse();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor === null ? '?limit=2' : `?limit=2&cursor=${cursor}`;
      const page = await ok(
        await req(`/api/v1/agents/me/work-requests${query}`, {}, { bearer: secret }),
      );
      const data = page.data as { id: string; task_id: string }[];
      expect(data.length).toBeLessThanOrEqual(2);
      seen.push(...data.map((r) => r.id));
      cursor = page.next_cursor as string | null;
      pages += 1;
      expect(pages, 'the cursor never ends').toBeLessThan(10);
    } while (cursor !== null);

    // Newest first, ties broken by id descending, each exactly once.
    expect(seen).toEqual(expected);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(asked.length);
  });

  it('answers a real-but-ungranted slug and a made-up one byte for byte alike: existence is not disclosed', async () => {
    const { secret } = await register([{ project_id: alpha, scope: 'full' }]);
    const ask = async (slug: string) => {
      const res = await req(
        `/api/v1/agents/me/work-requests?project=${slug}`,
        {},
        { bearer: secret },
      );
      return { status: res.status, body: await res.text() };
    };

    const real = await ask('beta');
    const madeUp = await ask('no-such-project');

    expect(real).toEqual(madeUp);
    expect(real.status).toBe(403);
    expect(JSON.parse(real.body)).toEqual({
      error: {
        code: 'forbidden',
        message: 'This agent has no access to this project',
        details: { action: 'project.read', reason: 'agent_not_granted' },
      },
    });
    // The body names neither the slug asked for nor any project id.
    expect(real.body).not.toContain('beta');
    expect(real.body).not.toContain(beta);
  });

  /** What a made-up slug answers this token: the one refusal everything below must equal. */
  async function uniformRefusal(secret: string) {
    const res = await req(
      '/api/v1/agents/me/work-requests?project=no-such-project',
      {},
      { bearer: secret },
    );
    return { status: res.status, body: await res.text() };
  }

  it('the owner losing read access to a granted project gives the same refusal as a made-up slug', async () => {
    const { agent, secret } = await register([
      { project_id: alpha, scope: 'full' },
      { project_id: beta, scope: 'full' },
    ]);
    const taskId = await newTask('beta');
    await ok(await patch(taskId, { selected_agent_id: agent.id }));
    // Granted, and readable — so the refusal below is the owner's loss, nothing else.
    await ok(await req('/api/v1/agents/me/work-requests?project=beta', {}, { bearer: secret }));

    await ok(
      await req(
        `/api/v1/projects/beta/members/${bob.id}`,
        { method: 'DELETE' },
        { cookie: ownerCookie },
      ),
    );

    const res = await req('/api/v1/agents/me/work-requests?project=beta', {}, { bearer: secret });
    const lost = { status: res.status, body: await res.text() };
    expect(lost).toEqual(await uniformRefusal(secret));
    expect(lost.status).toBe(403);
  });

  it('a token pinned narrower than its agent’s grants gives the same refusal outside the pin', async () => {
    const { agent, secret, token } = await register([
      { project_id: alpha, scope: 'full' },
      { project_id: beta, scope: 'full' },
    ]);
    const taskId = await newTask('beta');
    await ok(await patch(taskId, { selected_agent_id: agent.id }));
    // The grant reaches beta; the token's own pin does not.
    h.db
      .update(tokens)
      .set({ projectIdsJson: JSON.stringify([alpha]) })
      .where(eq(tokens.id, token.id))
      .run();

    const res = await req('/api/v1/agents/me/work-requests?project=beta', {}, { bearer: secret });
    const pinned = { status: res.status, body: await res.text() };
    expect(pinned).toEqual(await uniformRefusal(secret));
    expect(pinned.status).toBe(403);
    // Inside the pin it still answers.
    await ok(await req('/api/v1/agents/me/work-requests?project=alpha', {}, { bearer: secret }));
  });

  it('?project= narrows to one project; another the agent cannot read is refused, not empty', async () => {
    const { agent, secret } = await register([
      { project_id: alpha, scope: 'full' },
      { project_id: beta, scope: 'full' },
    ]);
    const a = await newTask('alpha');
    const b = await newTask('beta');
    await ok(await patch(a, { selected_agent_id: agent.id }));
    await ok(await patch(b, { selected_agent_id: agent.id }));

    const onlyBeta = await ok(
      await req('/api/v1/agents/me/work-requests?project=beta', {}, { bearer: secret }),
    );
    expect((onlyBeta.data as { task_id: string }[]).map((r) => r.task_id)).toEqual([b]);

    const narrow = await register([{ project_id: alpha, scope: 'full' }], bob.cookie, 'Narrow');
    expect(
      await refusal(
        await req('/api/v1/agents/me/work-requests?project=beta', {}, { bearer: narrow.secret }),
      ),
    ).toMatchObject({ status: 403, code: 'forbidden', reason: 'agent_not_granted' });
    // A slug nobody owns is the same refusal, never a 404 (no existence probe).
    expect(
      await refusal(
        await req('/api/v1/agents/me/work-requests?project=nope', {}, { bearer: secret }),
      ),
    ).toMatchObject({ status: 403, code: 'forbidden', reason: 'agent_not_granted' });
  });

  it('is 403 not_an_agent for a session and for a legacy token', async () => {
    const legacy = await ok(
      await req(
        '/api/v1/tokens',
        { method: 'POST', body: JSON.stringify({ name: 'cli', scope: 'full' }) },
        { cookie: bob.cookie },
      ),
      201,
    );
    for (const auth of [{ cookie: bob.cookie }, { bearer: legacy.secret as string }]) {
      expect(await refusal(await req('/api/v1/agents/me/work-requests', {}, auth))).toMatchObject({
        status: 403,
        code: 'forbidden',
        reason: 'not_an_agent',
      });
    }
  });
});
