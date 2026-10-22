import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, RateLimiter } from '../../../src/http/rate-limit.ts';
import { classify, TIME_DRAFTS_PATH } from '../../../src/http/middleware/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * Time over HTTP (D-088, SPEC §6.4, LAI-787): the switches, a collector's
 * upload and an agent's proposal with a token, and everything that reads or
 * confirms a person's time on a web session only.
 */

const PASSWORD = 'correct-horse-battery-staple';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';

let h: AuthHarness;
let cookie: string;

async function req(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  const credential =
    auth === undefined
      ? {}
      : auth.startsWith('lai_')
        ? { Authorization: `Bearer ${auth}` }
        : { Cookie: auth };
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ ...credential, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function mint(scope: 'full' | 'read_only' = 'full'): Promise<string> {
  const res = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Collector', scope }) },
    cookie,
  );
  expect(res.status).toBe(201);
  return String(((await res.json()) as { secret: string }).secret);
}

async function reasonOf(res: Response): Promise<string> {
  return (
    ((await res.json()) as { error: { details: { reason?: string } } }).error.details.reason ?? ''
  );
}

async function turnOn(): Promise<void> {
  expect(
    (
      await req(
        '/api/v1/org/time',
        { method: 'PUT', body: JSON.stringify({ mode: 'drafts' }) },
        cookie,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await req(
        '/api/v1/me/time-settings',
        { method: 'PUT', body: JSON.stringify({ draft_my_time: true }) },
        cookie,
      )
    ).status,
  ).toBe(200);
}

const today = (): string => new Date().toISOString().slice(0, 10);
const at = (hour: number): number => Date.parse(`${today()}T00:00:00Z`) + hour * 3_600_000;

function upload(blocks: unknown[]): string {
  return JSON.stringify({
    v: 1,
    collector_id: COLLECTOR,
    tz: 'UTC',
    days: [{ day: today(), blocks }],
  });
}

const BLOCK = {
  start: at(0),
  end: at(0) + 45 * 60_000,
  minutes: 45,
  task: 'LAI-1',
  signals: { prompts: 2, replies: 5, sessions: 1 },
};

beforeEach(async () => {
  h = authHarness({ rateLimiter: new RateLimiter() });
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
  const task = await req(
    '/api/v1/projects/laika/tasks',
    { method: 'POST', body: JSON.stringify({ title: 'Time' }) },
    cookie,
  );
  expect(task.status).toBe(201);
});

afterEach(() => {
  h.close();
});

describe('the switches', () => {
  it('a token reads them; only a session turns them', async () => {
    const token = await mint('read_only');
    const read = await req('/api/v1/me/time-settings', {}, token);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      org_mode: 'off',
      draft_my_time: false,
      drafting: false,
      min_sync_interval_s: 600,
      signal_times: true,
      folder_names: true,
      breaks: [],
    });
    const full = await mint();
    const set = await req(
      '/api/v1/me/time-settings',
      { method: 'PUT', body: JSON.stringify({ draft_my_time: true }) },
      full,
    );
    expect(set.status).toBe(403);
    expect(await reasonOf(set)).toBe('session_required');
    const org = await req(
      '/api/v1/org/time',
      { method: 'PUT', body: JSON.stringify({ mode: 'drafts' }) },
      full,
    );
    expect(org.status).toBe(403);
    expect(await reasonOf(org)).toBe('session_required');
    const bad = await req(
      '/api/v1/org/time',
      { method: 'PUT', body: JSON.stringify({ mode: 'always' }) },
      cookie,
    );
    expect(bad.status).toBe(422);
  });
});

describe('PUT /me/time-drafts — a collector’s blocks', () => {
  it('tells a collector drafting is off before it reads the body', async () => {
    const res = await req(
      '/api/v1/me/time-drafts',
      { method: 'PUT', body: '{"not":"a report"' },
      await mint(),
    );
    expect(res.status).toBe(403);
    expect(await reasonOf(res)).toBe('time_drafts_off');
  });

  it('takes blocks and counts, and refuses anything that could carry text', async () => {
    await turnOn();
    const token = await mint();
    const ok = await req('/api/v1/me/time-drafts', { method: 'PUT', body: upload([BLOCK]) }, token);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await ok.json()).toEqual({ accepted_days: 1, stored_blocks: 1 });
    for (const extra of [
      { prompt: 'fix the login bug' },
      { repo: 'kvell/laika' },
      { branch: 'LAI-1-x' },
      { title: 'Terminal — zsh' },
    ]) {
      const res = await req(
        '/api/v1/me/time-drafts',
        { method: 'PUT', body: upload([{ ...BLOCK, ...extra }]) },
        token,
      );
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    const signalText = await req(
      '/api/v1/me/time-drafts',
      { method: 'PUT', body: upload([{ ...BLOCK, signals: { prompts: 'many' } }]) },
      token,
    );
    expect(signalText.status).toBe(422);
    const notAKey = await req(
      '/api/v1/me/time-drafts',
      { method: 'PUT', body: upload([{ ...BLOCK, task: 'fix login' }]) },
      token,
    );
    expect(notAKey.status).toBe(422);
  });

  it('refuses a body over 16 KiB', async () => {
    await turnOn();
    const big = upload(Array.from({ length: 48 }, () => ({ ...BLOCK, padding: 'x'.repeat(400) })));
    const res = await req('/api/v1/me/time-drafts', { method: 'PUT', body: big }, await mint());
    expect(res.status).toBe(413);
  });

  it('is a report on its own bucket, not the snapshot’s', () => {
    const cred = { userId: 'u1', tokenId: 'tok1' };
    expect(classify(TIME_DRAFTS_PATH, cred, 'PUT')).toEqual({
      key: 'time-drafts:token:tok1',
      policy: LIMITS.localActivity,
    });
    expect(classify(TIME_DRAFTS_PATH, cred, 'POST').key).toBe('token:tok1');
  });
});

describe('a person’s time, on a web session', () => {
  beforeEach(turnOn);

  it('no token reads My day, confirms or writes an entry', async () => {
    const token = await mint();
    for (const [path, init] of [
      ['/api/v1/me/time', {}],
      [`/api/v1/me/time/days/${today()}/confirm`, { method: 'POST' }],
      [
        '/api/v1/me/time-entries',
        { method: 'POST', body: JSON.stringify({ day: today(), tz: 'UTC', minutes: 5 }) },
      ],
    ] as const) {
      const res = await req(path, init, token);
      expect(res.status, path).toBe(403);
      expect(await reasonOf(res), path).toBe('session_required');
    }
  });

  it('an agent proposes, the person sees it on My day and confirms the day', async () => {
    const token = await mint();
    await req('/api/v1/me/time-drafts', { method: 'PUT', body: upload([BLOCK]) }, token);
    const proposed = await req(
      '/api/v1/me/time-drafts',
      {
        method: 'POST',
        body: JSON.stringify({ minutes: 20, task: 'LAI-1', tz: 'UTC', note: 'Review' }),
      },
      token,
    );
    expect(proposed.status, await proposed.clone().text()).toBe(201);
    expect(Object.keys((await proposed.json()) as object).sort()).toEqual(['day', 'id', 'minutes']);

    const day = await req(`/api/v1/me/time?tz=UTC&day=${today()}`, {}, cookie);
    expect(day.status).toBe(200);
    const view = (await day.json()) as { drafts: { minutes: number }[]; state: string };
    expect(view.drafts.map((d) => d.minutes).sort()).toEqual([20, 45]);
    expect(view.state).toBe('drafted');

    const confirmed = await req(
      `/api/v1/me/time/days/${today()}/confirm`,
      { method: 'POST' },
      cookie,
    );
    expect(confirmed.status).toBe(200);
    const { entries } = (await confirmed.json()) as { entries: { id: string; source: string }[] };
    expect(entries.map((e) => e.source)).toEqual(['draft', 'draft']);

    const revisions = await req(
      `/api/v1/me/time-entries/${entries[0]?.id ?? ''}/revisions`,
      {},
      cookie,
    );
    expect(((await revisions.json()) as { revisions: { change: string }[] }).revisions).toEqual([
      expect.objectContaining({ change: 'created', revision: 1 }),
    ]);
  });

  it('a manual entry, edited and deleted, keeps its history', async () => {
    const made = await req(
      '/api/v1/me/time-entries',
      {
        method: 'POST',
        body: JSON.stringify({ day: today(), tz: 'UTC', minutes: 30, note: 'Client call' }),
      },
      cookie,
    );
    expect(made.status, await made.clone().text()).toBe(201);
    const { id } = (await made.json()) as { id: string };
    const edited = await req(
      `/api/v1/me/time-entries/${id}`,
      { method: 'PATCH', body: JSON.stringify({ minutes: 40, task: 'LAI-1' }) },
      cookie,
    );
    expect(await edited.json()).toMatchObject({ minutes: 40, revision: 2, task: { key: 'LAI-1' } });
    expect((await req(`/api/v1/me/time-entries/${id}`, { method: 'DELETE' }, cookie)).status).toBe(
      204,
    );
    const history = await req(`/api/v1/me/time-entries/${id}/revisions`, {}, cookie);
    expect(
      ((await history.json()) as { revisions: { change: string }[] }).revisions.map(
        (r) => r.change,
      ),
    ).toEqual(['created', 'edited', 'deleted']);
  });

  it('turning Draft my time off deletes the drafts held', async () => {
    await req('/api/v1/me/time-drafts', { method: 'PUT', body: upload([BLOCK]) }, await mint());
    await req(
      '/api/v1/me/time-settings',
      { method: 'PUT', body: JSON.stringify({ draft_my_time: false }) },
      cookie,
    );
    const view = (await (await req('/api/v1/me/time?tz=UTC', {}, cookie)).json()) as {
      drafts: unknown[];
      state: string;
    };
    expect(view.drafts).toEqual([]);
    expect(view.state).toBe('no_signal');
  });
});
