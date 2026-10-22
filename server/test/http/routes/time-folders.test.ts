import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * A work folder's chosen name over HTTP (LAI-866, D-098): a collector's
 * upload may carry the name the person gave a folder, and its branch, bounded
 * and refused when they could be a path or hide a control character; the
 * board says it takes them; the person changes or clears them, signed in,
 * and confirming carries them into the entry.
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

async function mint(): Promise<string> {
  const res = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'Collector', scope: 'full' }) },
    cookie,
  );
  expect(res.status).toBe(201);
  return String(((await res.json()) as { secret: string }).secret);
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

interface Draft {
  id: string;
  folder: string | null;
  branch: string | null;
}

async function drafts(): Promise<Draft[]> {
  const res = await req(`/api/v1/me/time?day=${today()}&tz=UTC`, {}, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { drafts: Draft[] }).drafts;
}

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
  expect(
    (
      await req(
        '/api/v1/projects/laika/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'Time' }) },
        cookie,
      )
    ).status,
  ).toBe(201);
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

describe('a collector’s upload with a work folder’s name', () => {
  it('the board says it takes the name, to a token as to a session', async () => {
    const read = await req('/api/v1/me/time-settings', {}, await mint());
    expect(((await read.json()) as { folder_names: unknown }).folder_names).toBe(true);
  });

  it('takes the name and the branch on a block, and keeps them on the draft', async () => {
    const res = await req(
      '/api/v1/me/time-drafts',
      { method: 'PUT', body: upload([{ ...BLOCK, folder: 'Acme', branch: 'feature/LAI-1-x' }]) },
      await mint(),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await drafts()).map((d) => [d.folder, d.branch])).toEqual([
      ['Acme', 'feature/LAI-1-x'],
    ]);
  });

  it('refuses a name past its bound, a path separator, a control character, and any other field', async () => {
    const token = await mint();
    for (const extra of [
      { folder: 'x'.repeat(61) },
      { folder: '' },
      { folder: '/Users/someone/work/acme' },
      { folder: 'work\\acme' },
      { folder: 'Acme\tInc' },
      { folder: 'Acme‮Inc' },
      { folder: 'Acme', branch: 'has a space' },
      { folder: 'Acme', branch: 'x'.repeat(256) },
      { folder: 'Acme', folder_path: '/Users/someone/work/acme' },
      { folder: 'Acme', cwd: '/Users/someone' },
    ]) {
      const res = await req(
        '/api/v1/me/time-drafts',
        { method: 'PUT', body: upload([{ ...BLOCK, ...extra }]) },
        token,
      );
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    expect(await drafts()).toEqual([]);
  });
});

describe('the person’s hands, signed in', () => {
  it('changes and clears the name before confirming, and confirming carries it into the entry', async () => {
    const sent = await req(
      '/api/v1/me/time-drafts',
      { method: 'PUT', body: upload([{ ...BLOCK, folder: 'Acme', branch: 'main' }]) },
      await mint(),
    );
    expect(sent.status).toBe(200);
    const id = (await drafts())[0]?.id ?? '';
    const patch = async (body: unknown): Promise<Response> =>
      req(`/api/v1/me/time-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, cookie);

    const renamed = await patch({ folder: 'Acme Corp', branch: null });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await renamed.json()).toMatchObject({ folder: 'Acme Corp', branch: null });
    expect((await patch({ folder: 'a/b' })).status).toBe(422);
    // A token reads no draft and edits none: the person's hands are a session's.
    expect(
      (
        await req(
          `/api/v1/me/time-drafts/${id}`,
          { method: 'PATCH', body: JSON.stringify({ folder: 'Globex' }) },
          await mint(),
        )
      ).status,
    ).toBe(403);

    const confirmed = await req(`/api/v1/me/time-drafts/${id}/confirm`, { method: 'POST' }, cookie);
    expect(confirmed.status, await confirmed.clone().text()).toBe(201);
    expect(await confirmed.json()).toMatchObject({ folder: 'Acme Corp', branch: null });
    const day = await req(`/api/v1/me/time?day=${today()}&tz=UTC`, {}, cookie);
    const entries = ((await day.json()) as { entries: { folder: string | null }[] }).entries;
    expect(entries.map((e) => e.folder)).toEqual(['Acme Corp']);
  });
});
