import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/http/rate-limit.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

/**
 * The Solidtime bridge over HTTP (D-088 item 10, SPEC §6.4, LAI-788): every
 * route is a signed-in session's — the person's CLI signs in for the run —
 * and refuses any token with `session_required`; an import carries a key read
 * from a description and never the description.
 */

const PASSWORD = 'correct-horse-battery-staple';
const HASH = 'a'.repeat(64);

let h: AuthHarness;
let cookie: string;
let token: string;

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

async function reasonOf(res: Response): Promise<string> {
  return (
    ((await res.json()) as { error: { details: { reason?: string } | null } }).error.details
      ?.reason ?? ''
  );
}

const today = (): string => new Date().toISOString().slice(0, 10);
const at = (hour: number): number => Date.parse(`${today()}T00:00:00Z`) + hour * 3_600_000;

function ownImport(entries: unknown[]): string {
  return JSON.stringify({
    v: 1,
    member_id: 'member-ada',
    tz: 'UTC',
    from: at(0),
    to: at(0) + 86_399_000,
    complete: true,
    entries,
  });
}

const ENTRY = { id: 'st-1', start: at(1), end: at(2), project_id: null, key: 'LAI-1', hash: HASH };

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
  expect(
    (await req('/api/v1/org/time', { method: 'PUT', body: '{"mode":"manual"}' }, cookie)).status,
  ).toBe(200);
  const minted = await req(
    '/api/v1/tokens',
    { method: 'POST', body: JSON.stringify({ name: 'CLI', scope: 'full' }) },
    cookie,
  );
  token = String(((await minted.json()) as { secret: string }).secret);
});

afterEach(() => {
  h.close();
});

const ROUTES: [string, string, string | undefined][] = [
  ['GET', `/api/v1/me/time/solidtime?since=${new Date().toISOString().slice(0, 10)}`, undefined],
  ['PUT', '/api/v1/me/time/solidtime/links', '{"member_id":"m","links":[]}'],
  ['PUT', '/api/v1/me/time/solidtime/import', undefined],
  ['GET', '/api/v1/org/time/solidtime', undefined],
  ['PUT', '/api/v1/org/time/solidtime/projects', '{"projects":[]}'],
  ['PUT', '/api/v1/org/time/solidtime/people', '{"people":[]}'],
  ['PUT', '/api/v1/org/time/solidtime/import', undefined],
];

describe('a token', () => {
  it('is refused on every route, as session_required — even the owner’s full one', async () => {
    for (const [method, path, body] of ROUTES) {
      const res = await req(
        path,
        { method, ...(method === 'GET' ? {} : { body: body ?? ownImport([]) }) },
        token,
      );
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await reasonOf(res), `${method} ${path}`).toBe('session_required');
    }
  });
});

describe('a signed-in session', () => {
  it('pulls its own entries in once, and says what it did', async () => {
    const first = await req(
      '/api/v1/me/time/solidtime/import',
      { method: 'PUT', body: ownImport([ENTRY]) },
      cookie,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      ignored: 0,
      conflicts: 0,
      flagged: [],
    });
    const again = await req(
      '/api/v1/me/time/solidtime/import',
      { method: 'PUT', body: ownImport([ENTRY]) },
      cookie,
    );
    expect(await again.json()).toMatchObject({ created: 0, unchanged: 1 });
    const day = await req(`/api/v1/me/time?day=${today()}&tz=UTC`, {}, cookie);
    const body = (await day.json()) as { entries: { source: string; task: { key: string } }[] };
    expect(body.entries.map((e) => [e.source, e.task.key])).toEqual([['import', 'LAI-1']]);
  });

  it('refuses a description, or anything else an import has no field for', async () => {
    const res = await req(
      '/api/v1/me/time/solidtime/import',
      { method: 'PUT', body: ownImport([{ ...ENTRY, description: 'LAI-1 the login page' }]) },
      cookie,
    );
    expect(res.status).toBe(422);
  });

  it('refuses a key that is not key-shaped, and a digest that is not one', async () => {
    for (const bad of [{ key: 'the login page' }, { hash: 'abc' }]) {
      const res = await req(
        '/api/v1/me/time/solidtime/import',
        { method: 'PUT', body: ownImport([{ ...ENTRY, ...bad }]) },
        cookie,
      );
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('serves the outbox, records a link, and then has nothing to push', async () => {
    const entry = await req(
      '/api/v1/me/time-entries',
      {
        method: 'POST',
        body: JSON.stringify({ day: today(), tz: 'UTC', minutes: 30, task: 'LAI-1' }),
      },
      cookie,
    );
    expect(entry.status).toBe(201);
    const { id } = (await entry.json()) as { id: string };
    // The space has no Solidtime project yet: held, and said why.
    let box = (await (
      await req(`/api/v1/me/time/solidtime?since=${today()}`, {}, cookie)
    ).json()) as { push: { entry_id: string }[]; held: { reason: string }[] };
    expect(box.held.map((x) => x.reason)).toEqual(['space_not_mapped']);

    const mapped = await req(
      '/api/v1/org/time/solidtime/projects',
      {
        method: 'PUT',
        body: JSON.stringify({
          projects: [{ solidtime_project_id: 'st-p', name: 'Laika', space: 'laika' }],
        }),
      },
      cookie,
    );
    expect(mapped.status, await mapped.clone().text()).toBe(200);
    box = (await (await req(`/api/v1/me/time/solidtime?since=${today()}`, {}, cookie)).json()) as {
      push: { entry_id: string }[];
      held: { reason: string }[];
    };
    expect(box.push.map((p) => p.entry_id)).toEqual([id]);

    const linked = await req(
      '/api/v1/me/time/solidtime/links',
      {
        method: 'PUT',
        body: JSON.stringify({
          member_id: 'member-ada',
          links: [
            { entry_id: id, revision: 1, solidtime_id: 'st-9', hash: HASH, started_at: at(9) },
          ],
        }),
      },
      cookie,
    );
    expect(linked.status, await linked.clone().text()).toBe(200);
    expect(await linked.json()).toEqual({ linked: 1, removed: 0, retired: 0 });
    box = (await (await req(`/api/v1/me/time/solidtime?since=${today()}`, {}, cookie)).json()) as {
      push: { entry_id: string }[];
      held: { reason: string }[];
    };
    expect(box.push).toEqual([]);
  });

  it('lets an owner see and set the map and the people, and pull everyone', async () => {
    const people = await req(
      '/api/v1/org/time/solidtime/people',
      { method: 'PUT', body: JSON.stringify({ people: [] }) },
      cookie,
    );
    expect(people.status).toBe(200);
    const all = await req(
      '/api/v1/org/time/solidtime/import',
      {
        method: 'PUT',
        body: JSON.stringify({
          v: 1,
          members: ['member-cara'],
          tz: 'UTC',
          from: at(0),
          to: at(0) + 86_399_000,
          complete: true,
          entries: [{ ...ENTRY, member_id: 'member-cara', key: null }],
        }),
      },
      cookie,
    );
    expect(all.status, await all.clone().text()).toBe(200);
    expect(await all.json()).toMatchObject({
      created: 1,
      not_on_laika: { people: 1, minutes: 60 },
    });
    const setup = await req('/api/v1/org/time/solidtime', {}, cookie);
    expect(await setup.json()).toMatchObject({
      closed_through: null,
      projects: [],
      people: [],
      not_on_laika: { people: 1, minutes: 60, members: [{ member_id: 'member-cara' }] },
    });
  });
});
