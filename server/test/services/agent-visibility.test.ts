import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, resolveTokenActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { appendActivity } from '../../src/db/activity.ts';
import { type ActivityType } from '../../src/db/enums.ts';
import { orgs, projects, tasks, users } from '../../src/db/schema.ts';
import { agentLens } from '../../src/services/agent-visibility.ts';
import { registerAgent } from '../../src/services/agents.ts';
import { expireClaims } from '../../src/services/claims.ts';
import { startWorking } from '../../src/services/tasks.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../helpers/auth.ts';

/**
 * Another person's agent is missing on every activity surface (D-121 item 7,
 * LAI-1011).
 *
 * Two owners, Ada and Bea, each with a registered agent, both reading the
 * same project. Each surface is read **raw** — the body as text — so an agent
 * id anywhere in it counts, whatever field it sits in: `agent_id`, the payload,
 * a CSV cell, an SSE frame, an MCP answer. Every surface is asked three
 * things: the other owner's agent is absent; the owner's own is present (so
 * the absence is an answer, not an empty read); and once the task shows that
 * agent as selected, it is named there.
 */

const PASSWORD = 'correct-horse-battery-staple';
/** Registered names, distinct from every harness and device, so a raw-body search finds only the name. */
const ADA_NAME = 'Ada private bot';
const BEA_NAME = 'Bea private bot';

let h: AuthHarness;
let orgId: string;
let laikaId: string;
let ada: { id: string; cookie: string; agentId: string; tokenId: string; secret: string };
let bea: { id: string; cookie: string; agentId: string; tokenId: string; secret: string };
let taskId: string;
let taskKey: string;

function actorOf(userId: string): ResolvedActor {
  const a = loadActor(h.db, userId);
  if (a === null) throw new Error(`no actor ${userId}`);
  return a;
}

async function req(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function okText(res: Promise<Response>): Promise<string> {
  const done = await res;
  const text = await done.text();
  expect(done.status, text).toBe(200);
  return text;
}

function agentFor(userId: string, name: string, harness: string, device: string) {
  const created = registerAgent(h.t.sqlite, h.db, actorOf(userId), {
    displayName: name,
    harness,
    deviceLabel: device,
    grants: [{ projectId: laikaId, scope: 'full' }],
  });
  return { agentId: created.agent.id, tokenId: created.token.id, secret: created.secret };
}

/** One row written as an owner's agent, carrying agent ids in its payload too. */
function writeAs(who: { id: string; tokenId: string }, type: ActivityType, payload: unknown): void {
  appendActivity(h.db, {
    orgId,
    projectId: laikaId,
    taskId,
    actorId: who.id,
    actorKind: 'agent',
    actorTokenId: who.tokenId,
    type,
    payload,
  });
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
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  const adaCookie = cookieFrom(setup);
  const adaId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id;
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  laikaId = h.db.select().from(projects).where(eq(projects.slug, 'laika')).get()?.id ?? '';
  expect([adaId, orgId, laikaId]).not.toContain(undefined);
  expect([orgId, laikaId]).not.toContain('');

  // Bea is an admin: she reads the project and the org history, as Ada does,
  // so every surface below is one both may read.
  const invite = seedInvite(h.db, {
    orgId,
    createdBy: adaId!,
    email: 'bea@example.test',
    orgRole: 'admin',
  });
  const joined = await signUp(h.app, {
    email: 'bea@example.test',
    password: PASSWORD,
    inviteToken: invite,
  });
  expect(joined.status, await joined.clone().text()).toBe(200);
  const beaId = h.db.select().from(users).where(eq(users.email, 'bea@example.test')).get()?.id;
  expect(beaId).toBeDefined();

  ada = {
    id: adaId!,
    cookie: adaCookie,
    ...agentFor(adaId!, ADA_NAME, 'claude-code', 'Ada-laptop'),
  };
  bea = {
    id: beaId!,
    cookie: cookieFrom(joined),
    ...agentFor(beaId!, BEA_NAME, 'codex', 'Bea-laptop'),
  };

  const created = await req('/api/v1/projects/laika/tasks', ada.cookie, {
    method: 'POST',
    body: JSON.stringify({ title: 'Shared task' }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const task = (await created.json()) as { id: string; key: string };
  taskId = task.id;
  taskKey = task.key;

  // A real claim and session: Bea's agent starts work, so its rows carry the
  // session snapshot. Then the claim lapses and nothing selects the agent, so
  // the task shows it to nobody but Bea.
  startWorking(h.t.sqlite, h.db, resolveTokenActor(h.db, bea.secret, Date.now()), taskId);
  expireClaims(h.db, Date.now() + 365 * 24 * 60 * 60 * 1000);
  h.db.update(tasks).set({ selectedAgentId: null }).where(eq(tasks.id, taskId)).run();

  // Each agent writes a row, and each payload names the agent as well — the
  // claim, selection and hand-off verbs carry agent ids there (§4.8), under
  // every key the gate lists.
  writeAs(ada, 'task.claim_expired', { generation: 1, session_id: 's-ada', agent_id: ada.agentId });
  writeAs(bea, 'task.claim_expired', { generation: 2, session_id: 's-bea', agent_id: bea.agentId });
  writeAs(bea, 'task.agent_selected', { from: null, to: bea.agentId });
  writeAs(bea, 'task.handoff_offered', {
    offer_id: 'offer-1',
    kind: 'handoff',
    to_agent_id: bea.agentId,
    from_agent_id: bea.agentId,
  });
  writeAs(bea, 'task.updated', { field: 'selected_agent_id', selected_agent_id: bea.agentId });
  // Last on purpose: `sseBody` reads until this row's `"field":"claim"`.
  writeAs(bea, 'task.updated', {
    field: 'claim',
    from: { generation: 2, session_id: 's-bea', agent_id: bea.agentId },
    to: null,
  });
});

afterEach(() => {
  h.close();
});

/** Show Bea's agent on the task, as its selected agent. */
function selectBeasAgent(): void {
  h.db.update(tasks).set({ selectedAgentId: bea.agentId }).where(eq(tasks.id, taskId)).run();
}

async function sseBody(cookie: string): Promise<string> {
  // Replay from the start: the same `onEvents` path a live row takes.
  const res = await req('/api/v1/events', cookie, { headers: { 'Last-Event-ID': '0' } });
  expect(res.status).toBe(200);
  const body: ReadableStream<Uint8Array> | null = res.body;
  if (body === null) throw new Error('no stream body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  // The last row written in beforeEach carries `"field":"claim"`; once it is
  // in, every earlier row has been framed.
  while (!seen.includes('"field":"claim"')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    seen += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();
  return seen;
}

async function mcpTaskContext(secret: string): Promise<string> {
  const res = await h.app.request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_task_context', arguments: { task: taskKey } },
    }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  expect(text).toContain('recent_activity');
  return text;
}

type Reader = typeof ada;

/** Every activity surface, read raw by one reader. */
const SURFACES: Record<string, (who: Reader) => Promise<string>> = {
  'GET /projects/:slug/activity': (who) =>
    okText(req('/api/v1/projects/laika/activity', who.cookie)),
  'GET /projects/:slug/activity?task=': (who) =>
    okText(req(`/api/v1/projects/laika/activity?task=${taskId}`, who.cookie)),
  'GET /activity': (who) => okText(req('/api/v1/activity', who.cookie)),
  'GET /activity/history': (who) => okText(req('/api/v1/activity/history', who.cookie)),
  'GET /activity/history?format=csv': (who) =>
    okText(req('/api/v1/activity/history?format=csv', who.cookie)),
  'GET /events (SSE replay)': (who) => sseBody(who.cookie),
  'MCP get_task_context': (who) => mcpTaskContext(who.secret),
};

describe("another person's agent on every activity surface (D-121 item 7, LAI-1011)", () => {
  for (const [name, read] of Object.entries(SURFACES)) {
    describe(name, () => {
      it("never names the other owner's agent, and names the reader's own", async () => {
        const asAda = await read(ada);
        expect(asAda, 'Ada reads her own agent').toContain(ada.agentId);
        expect(asAda, "Ada never reads Bea's agent").not.toContain(bea.agentId);
        expect(asAda, "Ada never reads Bea's agent's registered name").not.toContain(BEA_NAME);

        const asBea = await read(bea);
        expect(asBea, 'Bea reads her own agent').toContain(bea.agentId);
        expect(asBea, "Bea never reads Ada's agent").not.toContain(ada.agentId);
        expect(asBea, "Bea never reads Ada's agent's registered name").not.toContain(ADA_NAME);
      });

      it('names it once the task shows it as selected', async () => {
        selectBeasAgent();
        expect(await read(ada)).toContain(bea.agentId);
        // Ada's agent is still not shown on that task, so Bea still may not see it.
        expect(await read(bea)).not.toContain(ada.agentId);
      });
    });
  }

  it("withholds the row's agent_id and session snapshot, and keeps the row", async () => {
    type Page = {
      data: {
        type: string;
        actor_kind: string;
        actor_id: string;
        agent_id: string | null;
        agent_session: { id: string } | null;
        agent_redacted: boolean;
        payload: Record<string, unknown>;
      }[];
    };
    const read = async (who: Reader): Promise<Page['data']> =>
      (
        JSON.parse(
          await okText(req(`/api/v1/projects/laika/activity?task=${taskId}`, who.cookie)),
        ) as Page
      ).data;

    const asAda = await read(ada);
    const beas = asAda.filter((r) => r.actor_id === bea.id);
    // The rows stay, as "an agent": the real claim's, and every written one.
    expect(beas.map((r) => r.type)).toEqual(
      expect.arrayContaining([
        'task.status_changed',
        'task.claim_expired',
        'task.agent_selected',
        'task.handoff_offered',
        'task.updated',
      ]),
    );
    for (const row of beas) {
      expect(row.actor_kind).toBe('agent');
      expect(row.agent_id).toBeNull();
      expect(row.agent_session).toBeNull();
      expect(row.agent_redacted).toBe(true);
    }
    const payloadOf = (type: string, field?: string) =>
      beas.find((r) => r.type === type && (field === undefined || r.payload.field === field))
        ?.payload;
    expect(payloadOf('task.agent_selected')).toEqual({ from: null, to: null });
    expect(payloadOf('task.handoff_offered')).toMatchObject({
      to_agent_id: null,
      from_agent_id: null,
    });
    expect(payloadOf('task.updated', 'selected_agent_id')).toMatchObject({
      selected_agent_id: null,
    });
    expect(payloadOf('task.updated', 'claim')).toMatchObject({
      from: { generation: 2, session_id: 's-bea', agent_id: null },
    });
    // The lapse the system wrote names the agent in its payload: withheld too.
    const lapse = asAda.find((r) => r.type === 'task.claim_expired' && r.actor_kind === 'system');
    expect(lapse?.payload.agent_id).toBeNull();
    expect(lapse?.agent_redacted).toBe(true);
    expect(asAda.find((r) => r.actor_id === ada.id)?.agent_id).toBe(ada.agentId);

    // Bea reads her own real session on the claim's row.
    const claimed = (await read(bea)).find(
      (r) => r.actor_id === bea.id && r.type === 'task.status_changed',
    );
    expect(claimed?.agent_id).toBe(bea.agentId);
    expect(claimed?.agent_session?.id).toEqual(expect.any(String));
    expect(claimed?.agent_redacted).toBe(false);
  });

  // The registered name rides on `token.created`, an org row: these four
  // surfaces carry org rows to an owner or admin.
  for (const name of [
    'GET /activity',
    'GET /activity/history',
    'GET /activity/history?format=csv',
    'GET /events (SSE replay)',
  ]) {
    it(`${name}: an agent token's registered name reaches its owner only`, async () => {
      const read = SURFACES[name]!;
      const asAda = await read(ada);
      expect(asAda).toContain(ADA_NAME);
      expect(asAda).not.toContain(BEA_NAME);
      const asBea = await read(bea);
      expect(asBea).toContain(BEA_NAME);
      expect(asBea).not.toContain(ADA_NAME);
    });
  }
});

describe('agentLens (the one gate)', () => {
  it('names an agent to its owner anywhere, to others only beside a task showing it', () => {
    const forAda = agentLens(h.db, ada.id, [taskId, null], [ada.agentId, bea.agentId]);
    expect(forAda.visible(null, ada.agentId)).toBe(true);
    expect(forAda.visible(taskId, bea.agentId)).toBe(false);

    selectBeasAgent();
    const after = agentLens(h.db, ada.id, [taskId, null], [bea.agentId]);
    expect(after.visible(taskId, bea.agentId)).toBe(true);
    // Shown on that task only: an org row, or another task, still does not name it.
    expect(after.visible(null, bea.agentId)).toBe(false);
    expect(after.visible('some-other-task', bea.agentId)).toBe(false);
  });

  it('names nothing to a reader with no user, and nothing it does not know', () => {
    expect(agentLens(h.db, null, [taskId], [ada.agentId]).visible(taskId, ada.agentId)).toBe(false);
    expect(
      agentLens(h.db, ada.id, [taskId], ['no-such-agent']).visible(taskId, 'no-such-agent'),
    ).toBe(false);
  });
});
