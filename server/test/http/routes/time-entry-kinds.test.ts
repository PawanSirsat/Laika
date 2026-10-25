import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * What a typed entry says it was (D-108, LAI-897): a kind from the list, a
 * title, a description — taken by `POST` and `PATCH /me/time-entries`,
 * answered by the view, copied into every revision; and a span sent with a
 * create held to its own day, as an edit's always was.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(`/api/v1${path}`, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function ok(path: string, init: RequestInit, status: number): Promise<Response> {
  const res = await req(path, init);
  expect(res.status, `${init.method ?? 'GET'} ${path}: ${await res.clone().text()}`).toBe(status);
  return res;
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
const patch = (body: unknown) => ({ method: 'PATCH', body: JSON.stringify(body) });

const today = (): string => new Date().toISOString().slice(0, 10);
const at = (hour: number, minute = 0): number =>
  Date.parse(`${today()}T00:00:00Z`) + (hour * 60 + minute) * 60_000;

interface Entry {
  id: string;
  minutes: number;
  task: { key: string } | null;
  note: string | null;
  kind: string | null;
  title: string | null;
  description: string | null;
  revision: number;
}

interface Revision {
  revision: number;
  change: string;
  kind: string | null;
  title: string | null;
  description: string | null;
  note: string | null;
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
  await ok('/org/time', { method: 'PUT', body: JSON.stringify({ mode: 'manual' }) }, 200);
  await ok('/projects/laika/tasks', post({ title: 'Standup notes' }), 201);
});

afterEach(() => {
  h.close();
});

describe('a typed entry says what it was', () => {
  it('carries kind, title and description from the create, and its first revision copies them', async () => {
    const made = (await (
      await ok(
        '/me/time-entries',
        post({
          day: today(),
          tz: 'UTC',
          minutes: 30,
          started_at: at(10),
          ended_at: at(10, 30),
          kind: 'meeting',
          title: '  Standup  ',
          description: 'Who is on what this week',
        }),
        201,
      )
    ).json()) as Entry;
    expect(made).toMatchObject({
      kind: 'meeting',
      title: 'Standup',
      description: 'Who is on what this week',
      note: null,
      task: null,
    });
    const { revisions } = (await (
      await ok(`/me/time-entries/${made.id}/revisions`, {}, 200)
    ).json()) as { revisions: Revision[] };
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revision: 1,
      change: 'created',
      kind: 'meeting',
      title: 'Standup',
      description: 'Who is on what this week',
    });
  });

  it('an entry nobody typed a kind for has none, and a card and a kind go together', async () => {
    const plain = (await (
      await ok('/me/time-entries', post({ day: today(), tz: 'UTC', minutes: 15 }), 201)
    ).json()) as Entry;
    expect(plain).toMatchObject({ kind: null, title: null, description: null });

    const onCard = (await (
      await ok(
        '/me/time-entries',
        post({ day: today(), tz: 'UTC', minutes: 45, task: 'LAI-1', kind: 'review' }),
        201,
      )
    ).json()) as Entry;
    expect(onCard.task?.key).toBe('LAI-1');
    expect(onCard.kind).toBe('review');
    expect(onCard.title).toBeNull();
  });

  it('PATCH changes kind and title as one revision; null clears each; an empty title is null', async () => {
    const made = (await (
      await ok(
        '/me/time-entries',
        post({ day: today(), tz: 'UTC', minutes: 20, kind: 'support', title: 'Customer call' }),
        201,
      )
    ).json()) as Entry;
    const edited = (await (
      await ok(
        `/me/time-entries/${made.id}`,
        patch({ kind: 'support', title: 'Support call', description: 'Reset their token' }),
        200,
      )
    ).json()) as Entry;
    expect(edited).toMatchObject({
      revision: 2,
      kind: 'support',
      title: 'Support call',
      description: 'Reset their token',
    });
    const cleared = (await (
      await ok(`/me/time-entries/${made.id}`, patch({ kind: null, title: '   ' }), 200)
    ).json()) as Entry;
    expect(cleared).toMatchObject({
      revision: 3,
      kind: null,
      title: null,
      description: 'Reset their token',
    });
    // The same again changes nothing and writes no revision.
    const same = (await (
      await ok(`/me/time-entries/${made.id}`, patch({ kind: null }), 200)
    ).json()) as Entry;
    expect(same.revision).toBe(3);
    const { revisions } = (await (
      await ok(`/me/time-entries/${made.id}/revisions`, {}, 200)
    ).json()) as { revisions: Revision[] };
    expect(revisions.map((r) => [r.revision, r.kind, r.title])).toEqual([
      [1, 'support', 'Customer call'],
      [2, 'support', 'Support call'],
      [3, null, null],
    ]);
  });

  it('refuses a kind it does not know, a title over 120, a description over 2000, and a key it does not take', async () => {
    const base = { day: today(), tz: 'UTC', minutes: 10 };
    for (const body of [
      { ...base, kind: 'lunch' },
      { ...base, title: 'x'.repeat(121) },
      { ...base, description: 'x'.repeat(2001) },
      { ...base, label: 'Meeting' },
    ]) {
      const res = await req('/me/time-entries', post(body));
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(422);
    }
    const made = (await (await ok('/me/time-entries', post(base), 201)).json()) as Entry;
    for (const body of [{ kind: 'lunch' }, { title: 'x'.repeat(121) }, { heading: 'x' }]) {
      const res = await req(`/me/time-entries/${made.id}`, patch(body));
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(422);
    }
  });

  it('a span sent with a create must lie on its own day', async () => {
    const res = await req(
      '/me/time-entries',
      post({
        day: today(),
        tz: 'UTC',
        minutes: 30,
        started_at: at(10) + 2 * 86_400_000,
        ended_at: at(10, 30) + 2 * 86_400_000,
        kind: 'meeting',
        title: 'Elsewhere',
      }),
    );
    expect(res.status, await res.clone().text()).toBe(422);
    const { error } = (await res.json()) as { error: { details?: { reason?: string } } };
    expect(error.details?.reason).toBe('outside_day');
  });
});
