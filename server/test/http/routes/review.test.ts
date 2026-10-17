import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

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
