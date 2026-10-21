import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * When a block's prompts and commits happened, over HTTP (LAI-834, D-096):
 * numbers by five minutes in a collector's upload — nothing that could carry
 * text — and the day's SIGNALS lane served to the person alone, signed in.
 */

const PASSWORD = 'correct-horse-battery-staple';
const COLLECTOR = '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a';
const BUCKET = 5 * 60_000;

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

async function mint(): Promise<string> {
  const res = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Collector', scope: 'full' }) },
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

const today = (): string => new Date().toISOString().slice(0, 10);
const at = (hour: number, minute = 0): number =>
  Date.parse(`${today()}T00:00:00Z`) + hour * 3_600_000 + minute * 60_000;
const bucket = (ms: number): number => Math.floor(ms / BUCKET);

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
  end: at(0, 45),
  minutes: 45,
  task: 'LAI-1',
  signals: { prompts: 2, replies: 5, sessions: 1, commits: 1 },
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
  for (const [path, body] of [
    ['/api/v1/org/time', { mode: 'drafts' }],
    ['/api/v1/me/time-settings', { draft_my_time: true }],
  ] as const) {
    expect((await req(path, { method: 'PUT', body: JSON.stringify(body) }, cookie)).status).toBe(
      200,
    );
  }
});

afterEach(() => {
  h.close();
});

describe('PUT /me/time-drafts — when its prompts and commits happened', () => {
  it('takes them as numbers by five minutes, and refuses anything that could carry text', async () => {
    const token = await mint();
    const timed = {
      ...BLOCK,
      at: { prompts: [[bucket(at(0, 10)), 2]], commits: [[bucket(at(0, 40)), 1]] },
    };
    const ok = await req('/api/v1/me/time-drafts', { method: 'PUT', body: upload([timed]) }, token);
    expect(ok.status, await ok.clone().text()).toBe(200);

    for (const at of [
      { prompts: [['fix the login bug', 1]] },
      { prompts: [[bucket(BLOCK.start), 'two']] },
      { prompts: [[bucket(BLOCK.start), 1, 'kvell/laika']] },
      { prompts: [[bucket(BLOCK.start), 0]] },
      { replies: [[bucket(BLOCK.start), 1]] },
      { messages: ['LAI-1: wait for the sidebar'] },
      'at nine',
    ]) {
      const res = await req(
        '/api/v1/me/time-drafts',
        { method: 'PUT', body: upload([{ ...BLOCK, at }]) },
        token,
      );
      expect(res.status, JSON.stringify(at)).toBe(422);
    }

    const outside = await req(
      '/api/v1/me/time-drafts',
      {
        method: 'PUT',
        body: upload([{ ...BLOCK, at: { prompts: [[bucket(at(1, 0)), 1]] } }]),
      },
      token,
    );
    expect(outside.status).toBe(422);
    expect(await reasonOf(outside)).toBe('invalid_blocks');
  });
});

describe('GET /me/time — the SIGNALS lane', () => {
  it('serves the day’s lane to the person signed in, and to no token', async () => {
    const token = await mint();
    const timed = {
      ...BLOCK,
      at: { prompts: [[bucket(at(0, 10)), 2]], commits: [[bucket(at(0, 40)), 1]] },
    };
    expect(
      (await req('/api/v1/me/time-drafts', { method: 'PUT', body: upload([timed]) }, token)).status,
    ).toBe(200);

    const mine = await req(`/api/v1/me/time?day=${today()}&tz=UTC`, {}, cookie);
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { signal_times: unknown }).signal_times).toEqual({
      prompts: [[bucket(at(0, 10)) * BUCKET, 2]],
      commits: [[bucket(at(0, 40)) * BUCKET, 1]],
    });

    const byToken = await req(`/api/v1/me/time?day=${today()}&tz=UTC`, {}, token);
    expect(byToken.status).toBe(403);
  });

  it('tells a collector, in the switches, that the board takes them', async () => {
    const read = await req('/api/v1/me/time-settings', {}, await mint());
    expect(read.status).toBe(200);
    expect(((await read.json()) as { signal_times: unknown }).signal_times).toBe(true);
  });
});
