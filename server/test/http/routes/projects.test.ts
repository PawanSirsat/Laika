import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../../helpers/auth.ts';

let h: AuthHarness;
let ownerCookie: string;

const PASSWORD = 'correct-horse-battery-staple';

/** Run first-run setup, which leaves us signed in as the Owner. */
async function setUp(): Promise<string> {
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

async function req(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function createProject(body: unknown, cookie = ownerCookie): Promise<Response> {
  return req('/api/v1/projects', { method: 'POST', body: JSON.stringify(body) }, cookie);
}

beforeEach(async () => {
  h = authHarness();
  ownerCookie = await setUp();
});
afterEach(() => {
  h.close();
});

describe('POST /api/v1/projects', () => {
  it('creates a project as Owner', async () => {
    const res = await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string; prefix: string };
    expect(body).toMatchObject({ slug: 'laika', prefix: 'LAI' });
  });

  it('returns conflict for a duplicate slug', async () => {
    await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' });
    const res = await createProject({ name: 'Other', slug: 'laika', prefix: 'OTH' });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('conflict');
  });

  it('returns conflict for a duplicate prefix', async () => {
    await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' });
    const res = await createProject({ name: 'Other', slug: 'other', prefix: 'LAI' });

    expect(res.status).toBe(409);
  });

  it('rejects a malformed slug and unknown fields', async () => {
    expect((await createProject({ name: 'X', slug: 'Not A Slug', prefix: 'XXX' })).status).toBe(
      422,
    );
    expect(
      (await createProject({ name: 'X', slug: 'x', prefix: 'XXX', org_id: 'sneaky' })).status,
    ).toBe(422);
  });

  it('401s an anonymous caller', async () => {
    const res = await h.app.request('/api/v1/projects', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'X', slug: 'x', prefix: 'XXX' }),
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/projects', () => {
  it('returns the §6.3 page shape', async () => {
    await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' });

    const res = await req('/api/v1/projects');
    const body = (await res.json()) as { data: unknown[]; next_cursor: string | null };

    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('next_cursor');
  });

  it('paginates with a stable cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await createProject({
        name: `P${String(i)}`,
        slug: `p-${String(i)}`,
        prefix: `P${String(i)}X`,
      });
    }

    const first = (await (await req('/api/v1/projects?limit=2')).json()) as {
      data: { slug: string }[];
      next_cursor: string;
    };
    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();

    const second = (await (
      await req(`/api/v1/projects?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`)
    ).json()) as { data: { slug: string }[] };

    const seen = [...first.data, ...second.data].map((p) => p.slug);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('returns an archived project as a tombstone', async () => {
    await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' });
    await req('/api/v1/projects/laika', {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    });

    const body = (await (await req('/api/v1/projects?updated_since=0')).json()) as {
      data: { id: string; deleted?: boolean }[];
    };

    // A client that only ever saw changed rows would otherwise keep showing it.
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ deleted: true });
  });

  it('rejects a malformed updated_since', async () => {
    expect((await req('/api/v1/projects?updated_since=yesterday')).status).toBe(400);
  });
});

describe('project detail and settings', () => {
  beforeEach(async () => {
    await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' });
  });

  it('reads and patches by slug, not id', async () => {
    expect((await req('/api/v1/projects/laika')).status).toBe(200);

    const patched = await req('/api/v1/projects/laika', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Laika Core' }),
    });

    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe('Laika Core');
  });

  it('404s an unknown slug', async () => {
    expect((await req('/api/v1/projects/nope')).status).toBe(404);
  });
});

describe('members over HTTP', () => {
  let memberId: string;

  beforeEach(async () => {
    await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' });

    // A second account, created through the ordinary invite-free signup path —
    // the org defaults to invite_only, so seed the row directly instead.
    const { users } = await import('../../../src/db/schema.ts');
    const { newId } = await import('../../../src/db/ids.ts');
    memberId = newId();
    const now = Date.now();
    h.db
      .insert(users)
      .values({
        id: memberId,
        email: 'grace@example.test',
        name: 'Grace',
        orgRole: 'member',
        avatarColor: '#222222',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
  });

  it('lists, adds, changes role and removes', async () => {
    expect(
      ((await (await req('/api/v1/projects/laika/members')).json()) as { members: unknown[] })
        .members,
    ).toHaveLength(1);

    const added = await req('/api/v1/projects/laika/members', {
      method: 'POST',
      body: JSON.stringify({ user_id: memberId, role: 'member' }),
    });
    expect(added.status).toBe(201);

    const changed = await req(`/api/v1/projects/laika/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(changed.status).toBe(200);

    const removed = await req(`/api/v1/projects/laika/members/${memberId}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { members: unknown[] }).members).toHaveLength(1);
  });

  it('rejects an invalid role value', async () => {
    const res = await req('/api/v1/projects/laika/members', {
      method: 'POST',
      body: JSON.stringify({ user_id: memberId, role: 'overlord' }),
    });

    expect(res.status).toBe(422);
  });

  it('refuses removing the last lead with conflict', async () => {
    const me = (await (await req('/api/v1/me')).json()) as { id: string };

    const res = await req(`/api/v1/projects/laika/members/${me.id}`, { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /at least one lead/,
    );
  });
});
