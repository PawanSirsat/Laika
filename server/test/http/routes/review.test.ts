import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { orgs, taskClaims, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * The review gate over HTTP (§6.4, D-082, LAI-758): the refusal an agent's
 * token gets on every REST door into done, `POST /tasks/:id/finish` with its
 * proof, the rounds read, the queue, and the two decisions a session makes.
 *
 * The service tests own the rules; this file is the transport — status codes,
 * the `details.reason` a client branches on, and that a token reaching a
 * route by REST gets exactly the MCP answer.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let secret: string;

interface TaskBody {
  id: string;
  key: string;
  status: string;
  status_name: string;
  send_back: { reason_md: string } | null;
}

async function asSession(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function asToken(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({
      Authorization: `Bearer ${secret}`,
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });
}

/** A call that must succeed — a broken setup must not satisfy a refusal test. */
async function must(res: Promise<Response>, expected = 200): Promise<Response> {
  const answered = await res;
  expect(answered.status, await answered.clone().text()).toBe(expected);
  return answered;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function newTask(): Promise<TaskBody> {
  return json<TaskBody>(
    await must(
      asSession('/api/v1/projects/core/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Work' }),
      }),
      201,
    ),
  );
}

/** Claimed and finished by the token, with proof: waiting in review. */
async function finished(proof: Record<string, unknown> = {}): Promise<TaskBody> {
  const task = await newTask();
  await must(asToken(`/api/v1/tasks/${task.id}/claim`, { method: 'POST' }));
  return json<TaskBody>(
    await must(
      asToken(`/api/v1/tasks/${task.id}/finish`, {
        method: 'POST',
        body: JSON.stringify({ summary: 'Did it', ...proof }),
      }),
    ),
  );
}

async function doneStatusId(): Promise<string> {
  const statuses = await json<{ data: { id: string; category: string }[] }>(
    await must(asSession('/api/v1/projects/core/statuses')),
  );
  return statuses.data.find((s) => s.category === 'done')!.id;
}

async function expectAgentRefused(res: Response): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(403);
  const body = await json<{ error: { code: string; message: string; details: unknown } }>(res);
  expect(body.error.code).toBe('forbidden');
  expect(body.error.details).toMatchObject({ reason: 'agent_cannot_mark_done' });
  expect(body.error.message).toContain('finish_task');
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
  cookie = cookieFrom(setup);
  await must(
    asSession('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Core', slug: 'core', prefix: 'COR' }),
    }),
    201,
  );
  const minted = await must(
    asSession('/api/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Codex', scope: 'full' }),
    }),
    201,
  );
  secret = (await json<{ secret: string }>(minted)).secret;
});

afterEach(() => {
  h.close();
});

describe('a token is refused every REST door into done (LAIKA-455)', () => {
  it('POST /tasks/:id/status by status and by status_id', async () => {
    const task = await finished();

    await expectAgentRefused(
      await asToken(`/api/v1/tasks/${task.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'done' }),
      }),
    );
    await expectAgentRefused(
      await asToken(`/api/v1/tasks/${task.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status_id: await doneStatusId() }),
      }),
    );
    const after = await json<TaskBody>(await must(asSession(`/api/v1/tasks/${task.id}`)));
    expect(after.status).toBe('review');
  });

  it('POST /projects/:slug/tasks with a done status', async () => {
    for (const body of [{ status: 'done' }, { status_id: await doneStatusId() }]) {
      await expectAgentRefused(
        await asToken('/api/v1/projects/core/tasks', {
          method: 'POST',
          body: JSON.stringify({ title: 'Straight to done', ...body }),
        }),
      );
    }
  });

  it('a replay of a session’s done move under the same key, by the same person’s token', async () => {
    const task = await finished();
    const key = { 'Idempotency-Key': 'move-it-1' };
    const body = JSON.stringify({ status: 'done' });

    await must(
      asSession(`/api/v1/tasks/${task.id}/status`, { method: 'POST', body, headers: key }),
    );
    const replay = await asToken(`/api/v1/tasks/${task.id}/status`, {
      method: 'POST',
      body,
      headers: key,
    });

    expect(replay.headers.get('Idempotent-Replay')).toBeNull();
    await expectAgentRefused(replay);
  });

  it('still replays a token’s own stored answer', async () => {
    const key = { 'Idempotency-Key': 'create-1' };
    const body = JSON.stringify({ title: 'Mine' });
    const first = await must(
      asToken('/api/v1/projects/core/tasks', { method: 'POST', body, headers: key }),
      201,
    );
    const again = await must(
      asToken('/api/v1/projects/core/tasks', { method: 'POST', body, headers: key }),
      201,
    );

    expect(again.headers.get('Idempotent-Replay')).toBe('true');
    expect((await json<TaskBody>(again)).id).toBe((await json<TaskBody>(first)).id);
  });
});

describe('POST /tasks/:id/finish and GET /tasks/:id/rounds (LAIKA-476)', () => {
  it('names the registered agent that finished: harness and device, never its name (D-120)', async () => {
    const projects = await json<{ data: { id: string; slug: string }[] }>(
      await must(asSession('/api/v1/projects')),
    );
    const core = projects.data.find((p) => p.slug === 'core');
    expect(core).toBeDefined();
    const registered = await json<{ agent: { id: string }; secret: string }>(
      await must(
        asSession('/api/v1/agents', {
          method: 'POST',
          body: JSON.stringify({
            display_name: 'Polly',
            harness: 'omnigent',
            device_label: 'Belka',
            grants: [{ project_id: core?.id, scope: 'full' }],
          }),
        }),
        201,
      ),
    );
    const asAgent = async (
      path: string,
      init: RequestInit = {},
      generation?: string,
    ): Promise<Response> =>
      h.app.request(path, {
        ...init,
        headers: jsonHeaders({
          Authorization: `Bearer ${registered.secret}`,
          ...(generation === undefined ? {} : { 'X-Laika-Claim-Generation': generation }),
        }),
      });

    const byAgent = await newTask();
    const claimed = await must(asAgent(`/api/v1/tasks/${byAgent.id}/claim`, { method: 'POST' }));
    const generation = claimed.headers.get('X-Laika-Claim-Generation') ?? '';
    expect(generation).not.toBe('');
    await must(
      asAgent(
        `/api/v1/tasks/${byAgent.id}/finish`,
        { method: 'POST', body: JSON.stringify({ summary: 'Did it' }) },
        generation,
      ),
    );
    interface Rounds {
      rounds: {
        client_name: string | null;
        agent: { id: string; harness: string; device_label: string | null } | null;
      }[];
    }
    const mine = await json<Rounds>(await must(asSession(`/api/v1/tasks/${byAgent.id}/rounds`)));
    expect(mine.rounds[0]?.agent).toEqual({
      id: registered.agent.id,
      harness: 'omnigent',
      device_label: 'Belka',
    });
    expect(mine.rounds[0]?.client_name).toBe('Polly');

    // A legacy token is no registered agent: nothing to name.
    const legacy = await finished();
    const theirs = await json<Rounds>(await must(asSession(`/api/v1/tasks/${legacy.id}/rounds`)));
    expect(theirs.rounds[0]?.agent).toBeNull();
    expect(theirs.rounds[0]?.client_name).toBe('Codex');
  });

  it('moves to review and stores the proof, each item claimed', async () => {
    const task = await finished({
      commits: [{ sha: 'abcdef1234567', message: 'feat: x' }],
      branch: 'build-review-gate',
      pull_request: 'https://github.com/PawanSirsat/Laika/pull/1',
      tests: [{ command: 'pnpm test', exit_code: 0 }],
    });
    expect(task.status).toBe('review');

    const rounds = await json<{
      rounds: {
        number: number;
        client_name: string | null;
        commits: { sha: string; state: string }[];
        branch: { name: string; state: string } | null;
        pull_request: { url: string; state: string } | null;
        tests: { command: string; exit_code: number; state: string }[];
      }[];
      send_back: unknown;
    }>(await must(asSession(`/api/v1/tasks/${task.id}/rounds`)));

    expect(rounds.send_back).toBeNull();
    expect(rounds.rounds).toHaveLength(1);
    expect(rounds.rounds[0]).toMatchObject({
      number: 1,
      client_name: 'Codex',
      commits: [{ sha: 'abcdef1234567', state: 'claimed' }],
      branch: { name: 'build-review-gate', state: 'claimed' },
      pull_request: { url: 'https://github.com/PawanSirsat/Laika/pull/1', state: 'claimed' },
      tests: [{ command: 'pnpm test', exit_code: 0, state: 'claimed' }],
    });
  });

  it('refuses proof over the limits with the field named, and moves nothing', async () => {
    const task = await newTask();
    await must(asToken(`/api/v1/tasks/${task.id}/claim`, { method: 'POST' }));

    for (const proof of [
      { commits: Array.from({ length: 51 }, () => ({ sha: 'abcdef1' })) },
      { tests: [{ command: 'x'.repeat(501), exit_code: 0 }] },
      { pull_request: 'ftp://example.test/pr' },
    ]) {
      const res = await asToken(`/api/v1/tasks/${task.id}/finish`, {
        method: 'POST',
        body: JSON.stringify({ summary: 'Did it', ...proof }),
      });
      expect(res.status, JSON.stringify(proof).slice(0, 60)).toBe(422);
    }
    const after = await json<TaskBody>(await must(asSession(`/api/v1/tasks/${task.id}`)));
    expect(after.status).toBe('in_progress');
  });
});

describe('the decisions and the queue (LAIKA-478)', () => {
  it('lists what waits, and a session accepts it into the first done status', async () => {
    const task = await finished({ tests: [{ command: 'pnpm test', exit_code: 1 }] });

    const queue = await json<{
      tasks: {
        task: { key: string };
        round: { number: number } | null;
        can_decide: boolean;
        cue: unknown;
      }[];
      truncated: boolean;
    }>(await must(asSession('/api/v1/review')));
    expect(queue.truncated).toBe(false);
    expect(queue.tasks.map((i) => [i.task.key, i.round?.number, i.can_decide])).toEqual([
      ['COR-1', 1, true],
    ]);
    // A project with no hours yet has no forecast to be fast against (LAI-772).
    expect(queue.tasks[0]?.cue).toBeNull();

    const accepted = await json<TaskBody>(
      await must(asSession(`/api/v1/tasks/${task.id}/accept`, { method: 'POST' })),
    );
    expect(accepted).toMatchObject({ status: 'done', status_name: 'Done' });
    const empty = await json<{ tasks: unknown[] }>(await must(asSession('/api/v1/review')));
    expect(empty.tasks).toEqual([]);
  });

  it('sends back with a required reason that the task then carries', async () => {
    const task = await finished();

    const missing = await asSession(`/api/v1/tasks/${task.id}/send-back`, {
      method: 'POST',
      body: JSON.stringify({ reason: '   ' }),
    });
    expect(missing.status).toBe(422);

    const back = await json<TaskBody>(
      await must(
        asSession(`/api/v1/tasks/${task.id}/send-back`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Tests are red' }),
        }),
      ),
    );
    expect(back).toMatchObject({
      status: 'in_progress',
      send_back: { reason_md: 'Tests are red' },
    });

    const thread = await json<{ data: { body_md: string; sent_back: boolean }[] }>(
      await must(asSession(`/api/v1/tasks/${task.id}/comments`)),
    );
    expect(thread.data.filter((c) => c.sent_back).map((c) => c.body_md)).toEqual(['Tests are red']);
  });

  it('refuses both decisions to a token, session_required, and nothing moves', async () => {
    const task = await finished();

    for (const [path, body] of [
      [`/api/v1/tasks/${task.id}/accept`, undefined],
      [`/api/v1/tasks/${task.id}/send-back`, JSON.stringify({ reason: 'No' })],
    ] as const) {
      const res = await asToken(path, { method: 'POST', ...(body === undefined ? {} : { body }) });
      expect(res.status, path).toBe(403);
      const error = (await json<{ error: { details: unknown } }>(res)).error;
      expect(error.details).toMatchObject({ reason: 'session_required' });
    }
    const after = await json<TaskBody>(await must(asSession(`/api/v1/tasks/${task.id}`)));
    expect(after.status).toBe('review');
  });

  it('never replays a session’s decision to a token holding its key', async () => {
    const task = await finished();
    const key = { 'Idempotency-Key': 'accept-1' };
    await must(asSession(`/api/v1/tasks/${task.id}/accept`, { method: 'POST', headers: key }));

    const replay = await asToken(`/api/v1/tasks/${task.id}/accept`, {
      method: 'POST',
      headers: key,
    });
    expect(replay.headers.get('Idempotent-Replay')).toBeNull();
    expect(replay.status).toBe(403);
  });
});

describe('a round names another person’s agent only where the task already shows it (LAI-1001)', () => {
  interface RoundShape {
    client_name: string | null;
    agent: { id: string; harness: string; device_label: string | null } | null;
    by_registered_agent: boolean;
  }

  /** Bob, a member of `core`, whose agent "Bob's secret rig" finishes a task Ada can read. */
  async function bobsAgentFinishes(select: boolean) {
    const orgId = h.db.select().from(orgs).get()?.id ?? '';
    const adaId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id;
    const invite = seedInvite(h.db, {
      orgId,
      createdBy: adaId ?? '',
      email: 'bob@example.test',
      orgRole: 'member',
    });
    const signed = await signUp(h.app, {
      email: 'bob@example.test',
      password: PASSWORD,
      inviteToken: invite,
    });
    expect(signed.status, await signed.clone().text()).toBe(200);
    const bobCookie = cookieFrom(signed);
    const bobId = h.db.select().from(users).where(eq(users.email, 'bob@example.test')).get()?.id;
    const projects = await json<{ data: { id: string; slug: string }[] }>(
      await must(asSession('/api/v1/projects')),
    );
    const core = projects.data.find((p) => p.slug === 'core')?.id ?? '';
    await must(
      asSession('/api/v1/projects/core/members', {
        method: 'POST',
        body: JSON.stringify({ user_id: bobId, role: 'member' }),
      }),
      201,
    );
    const asBob = async (
      path: string,
      init: RequestInit = {},
      bearer?: string,
      generation?: string,
    ): Promise<Response> =>
      h.app.request(path, {
        ...init,
        headers: jsonHeaders({
          ...(bearer === undefined ? { Cookie: bobCookie } : { Authorization: `Bearer ${bearer}` }),
          ...(generation === undefined ? {} : { 'X-Laika-Claim-Generation': generation }),
        }),
      });
    const rig = await json<{ agent: { id: string }; secret: string }>(
      await must(
        asBob('/api/v1/agents', {
          method: 'POST',
          body: JSON.stringify({
            display_name: 'Bob’s secret rig',
            harness: 'codex',
            device_label: 'Bob’s laptop',
            grants: [{ project_id: core, scope: 'full' }],
          }),
        }),
        201,
      ),
    );

    const task = await newTask();
    if (select) {
      await must(
        asBob(`/api/v1/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ selected_agent_id: rig.agent.id }),
        }),
      );
    }
    const claimed = await must(
      asBob(`/api/v1/tasks/${task.id}/claim`, { method: 'POST' }, rig.secret),
    );
    const generation = claimed.headers.get('X-Laika-Claim-Generation') ?? '';
    expect(generation).not.toBe('');
    await must(
      asBob(
        `/api/v1/tasks/${task.id}/finish`,
        { method: 'POST', body: JSON.stringify({ summary: 'Did it' }) },
        rig.secret,
        generation,
      ),
    );
    const read = async (as: 'ada' | 'bob') => {
      const get = (path: string) => (as === 'ada' ? asSession(path) : asBob(path));
      const rawRounds = await (await must(get(`/api/v1/tasks/${task.id}/rounds`))).text();
      const rawQueue = await (await must(get('/api/v1/review'))).text();
      const rounds = JSON.parse(rawRounds) as { rounds: RoundShape[] };
      const queue = JSON.parse(rawQueue) as {
        tasks: { task: { id: string }; round: RoundShape | null }[];
      };
      return {
        rounds: rounds.rounds[0],
        queue: queue.tasks.find((t) => t.task.id === task.id)?.round,
        rawRounds,
        rawQueue,
      };
    };
    return { rig, task, read, asBob };
  }

  it('Ada reads a round Bob’s unselected agent finished: an agent, never which one', async () => {
    const { read } = await bobsAgentFinishes(false);
    const ada = await read('ada');
    for (const round of [ada.rounds, ada.queue]) {
      expect(round).toBeDefined();
      expect(round?.agent).toBeNull();
      expect(round?.by_registered_agent).toBe(true);
    }
    for (const round of [ada.rounds, ada.queue]) expect(round?.client_name).toBeNull();
    // Nothing in either raw answer names Bob's agent, its harness or its device.
    for (const raw of [ada.rawRounds, ada.rawQueue]) {
      expect(raw).not.toContain('Bob’s secret rig');
      expect(raw).not.toContain('Bob’s laptop');
      expect(raw).not.toContain('codex');
    }
  });

  it('Bob reads the same rounds and sees his own agent on both endpoints', async () => {
    const { rig, read } = await bobsAgentFinishes(false);
    const bob = await read('bob');
    for (const round of [bob.rounds, bob.queue]) {
      // His own agent's name is his to read.
      expect(round?.client_name).toBe('Bob’s secret rig');
      expect(round?.agent).toEqual({
        id: rig.agent.id,
        harness: 'codex',
        device_label: 'Bob’s laptop',
      });
    }
  });

  it('Ada sees Bob’s agent where the task already shows it: its selected agent', async () => {
    const { rig, task, read } = await bobsAgentFinishes(true);
    const ada = await read('ada');
    for (const round of [ada.rounds, ada.queue]) {
      expect(round?.agent?.id).toBe(rig.agent.id);
      // Shown by harness and device; the registered name is Bob's alone (D-120).
      expect(round?.client_name).toBeNull();
    }
    for (const raw of [ada.rawRounds, ada.rawQueue]) expect(raw).not.toContain('Bob’s secret rig');

    // The task view's selected agent: harness, device and owner, never the name.
    interface Selected {
      selected_agent: {
        display_name: string | null;
        harness: string;
        device_label: string | null;
        owner: { name: string };
      } | null;
    }
    const rawView = await (await must(asSession(`/api/v1/tasks/${task.id}`))).text();
    expect(rawView).not.toContain('Bob’s secret rig');
    expect((JSON.parse(rawView) as Selected).selected_agent).toMatchObject({
      display_name: null,
      harness: 'codex',
      device_label: 'Bob’s laptop',
    });
    const rawList = await (await must(asSession('/api/v1/projects/core/tasks'))).text();
    expect(rawList).not.toContain('Bob’s secret rig');
  });

  it('Ada sees Bob’s agent while it holds the task’s live claim', async () => {
    const { rig, task, read, asBob } = await bobsAgentFinishes(false);
    await must(
      asSession(`/api/v1/tasks/${task.id}/send-back`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'One more thing' }),
      }),
    );
    expect((await read('ada')).rounds?.agent).toBeNull();
    // Bob's agent takes it back: now the task itself shows that agent.
    await must(asBob(`/api/v1/tasks/${task.id}/claim`, { method: 'POST' }, rig.secret));
    expect((await read('ada')).rounds?.agent?.id).toBe(rig.agent.id);
  });

  it('a claim whose lease lapsed names nobody, exactly as the task view stops showing it', async () => {
    const { rig, task, read, asBob } = await bobsAgentFinishes(false);
    await must(
      asSession(`/api/v1/tasks/${task.id}/send-back`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'One more thing' }),
      }),
    );
    await must(asBob(`/api/v1/tasks/${task.id}/claim`, { method: 'POST' }, rig.secret));
    expect((await read('ada')).rounds?.agent?.id).toBe(rig.agent.id);

    // The lease runs out; the expiry scan has not run yet.
    h.db.update(taskClaims).set({ leaseExpiresAt: 1 }).where(eq(taskClaims.taskId, task.id)).run();
    const view = await json<{ claim: unknown; selected_agent: unknown }>(
      await must(asSession(`/api/v1/tasks/${task.id}`)),
    );
    expect(view.claim).toBeNull();
    expect(view.selected_agent).toBeNull();
    const ada = await read('ada');
    expect(ada.rounds?.agent).toBeNull();
    expect(ada.rounds?.client_name).toBeNull();
    expect(ada.rawRounds).not.toContain('Bob’s secret rig');
  });

  it('created_by_client: a task Bob’s agent created is unnamed to Ada, named to Bob', async () => {
    const { rig, asBob } = await bobsAgentFinishes(false);
    const made = await json<{ id: string; key: string }>(
      await must(
        asBob(
          '/api/v1/projects/core/tasks',
          { method: 'POST', body: JSON.stringify({ title: 'Made by the rig' }) },
          rig.secret,
        ),
        201,
      ),
    );
    interface Shown {
      created_via: string;
      created_by_client: string | null;
    }
    const rawAda = await (await must(asSession(`/api/v1/tasks/${made.id}`))).text();
    const ada = JSON.parse(rawAda) as Shown;
    expect(ada.created_by_client).toBeNull();
    expect(ada.created_via).not.toBe('web');
    expect(rawAda).not.toContain('Bob’s secret rig');
    const listed = await (await must(asSession('/api/v1/projects/core/tasks'))).text();
    expect(listed).not.toContain('Bob’s secret rig');

    const bob = await json<Shown>(await must(asBob(`/api/v1/tasks/${made.id}`)));
    expect(bob.created_by_client).toBe('Bob’s secret rig');

    // Selected on the task, the agent is shown there by harness and device;
    // its registered name stays Bob's (D-120).
    await must(
      asBob(`/api/v1/tasks/${made.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ selected_agent_id: rig.agent.id }),
      }),
    );
    const shownRaw = await (await must(asSession(`/api/v1/tasks/${made.id}`))).text();
    expect((JSON.parse(shownRaw) as Shown).created_by_client).toBeNull();
    expect(shownRaw).not.toContain('Bob’s secret rig');
  });

  it('created_by_client: a legacy token’s name is shown as before', async () => {
    const task = await newTaskAsToken();
    const view = await json<{ created_by_client: string | null }>(
      await must(asSession(`/api/v1/tasks/${task.id}`)),
    );
    expect(view.created_by_client).toBe('Codex');
  });

  it('Bob reads his own selected agent with its name; Ada’s agent is refused naming it by harness and device', async () => {
    const { rig, task, asBob } = await bobsAgentFinishes(true);
    const bobView = await json<{ selected_agent: { display_name: string | null } | null }>(
      await must(asBob(`/api/v1/tasks/${task.id}`)),
    );
    expect(bobView.selected_agent?.display_name).toBe('Bob’s secret rig');

    // A task selected for Bob's agent, and Ada's own agent tries to claim it.
    const fresh = await newTask();
    await must(
      asBob(`/api/v1/tasks/${fresh.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ selected_agent_id: rig.agent.id }),
      }),
    );
    const projects = await json<{ data: { id: string; slug: string }[] }>(
      await must(asSession('/api/v1/projects')),
    );
    const core = projects.data.find((p) => p.slug === 'core')?.id ?? '';
    const mine = await json<{ secret: string }>(
      await must(
        asSession('/api/v1/agents', {
          method: 'POST',
          body: JSON.stringify({
            display_name: 'Ada’s own',
            harness: 'omnigent',
            device_label: 'Belka',
            grants: [{ project_id: core, scope: 'full' }],
          }),
        }),
        201,
      ),
    );
    const refused = await h.app.request(`/api/v1/tasks/${fresh.id}/claim`, {
      method: 'POST',
      headers: jsonHeaders({ Authorization: `Bearer ${mine.secret}` }),
    });
    const raw = await refused.text();
    expect(refused.status, raw).toBe(409);
    const body = JSON.parse(raw) as {
      error: { message: string; details: { reason: string; selected_agent: unknown } };
    };
    expect(body.error.details.reason).toBe('selected_for_another_agent');
    expect(body.error.message).toContain('codex · Bob’s laptop');
    expect(body.error.details.selected_agent).toMatchObject({
      display_name: null,
      harness: 'codex',
      device_label: 'Bob’s laptop',
    });
    expect(raw).not.toContain('Bob’s secret rig');
  });
});

async function newTaskAsToken(): Promise<{ id: string }> {
  return json<{ id: string }>(
    await must(
      asToken('/api/v1/projects/core/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'By the legacy token' }),
      }),
      201,
    ),
  );
}
