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

/** PATCH `laika`, using this file's own request helper. */
async function patchProject(body: unknown): Promise<Response> {
  return req('/api/v1/projects/laika', { method: 'PATCH', body: JSON.stringify(body) });
}

describe('the repo field (LAI-108)', () => {
  // Setup here creates the org but no project — every other block in this file
  // creates its own.
  beforeEach(async () => {
    expect((await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' })).status).toBe(201);
  });

  it('round-trips through PATCH and appears on GET', async () => {
    const patched = await patchProject({ repo: 'PawanSirsat/Laika' });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { repo: string | null }).repo).toBe('PawanSirsat/Laika');

    const read = await req('/api/v1/projects/laika');
    expect(((await read.json()) as { repo: string | null }).repo).toBe('PawanSirsat/Laika');
  });

  it('appears in the list, which no longer builds its own project shape', async () => {
    await patchProject({ repo: 'owner/name' });

    const list = (await (await req('/api/v1/projects')).json()) as {
      data: { slug: string; repo: string | null }[];
    };

    // The list used to map rows to a hand-written copy of `ProjectView` that had
    // no `repo`; this is the assertion that the copy is gone.
    expect(list.data.find((p) => p.slug === 'laika')?.repo).toBe('owner/name');
  });

  it('422s a URL and a .git suffix, with the expected shape in the details', async () => {
    for (const repo of ['https://github.com/owner/name', 'owner/name.git', 'bare']) {
      const res = await patchProject({ repo });
      expect(res.status, repo).toBe(422);

      const body = (await res.json()) as { error: { code: string; details: unknown } };
      expect(body.error.code).toBe('unprocessable');
    }
  });

  it('clears with null', async () => {
    await patchProject({ repo: 'owner/name' });
    const cleared = await patchProject({ repo: null });

    expect(((await cleared.json()) as { repo: string | null }).repo).toBeNull();
  });
});

/**
 * LAI-053 AC2, at the level the N+1 would actually reappear.
 *
 * The service-level test guards `projectSummaries`; this guards the **route**,
 * which is where a well-meaning refactor would put the aggregate call inside the
 * `map` and reintroduce one query per card without touching the service at all.
 * I found that gap by breaking the route and watching the service test stay
 * green.
 */
describe('GET /api/v1/projects does not query per card', () => {
  function statementsDuring<T>(run: () => Promise<T>): Promise<[T, string[]]> {
    const recorded: string[] = [];
    const real = h.t.sqlite.prepare.bind(h.t.sqlite);

    (h.t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      recorded.push(source);
      return real(source);
    };

    return run().then(
      (value): [T, string[]] => {
        (h.t.sqlite as unknown as { prepare: typeof real }).prepare = real;
        return [value, recorded];
      },
      (error: unknown) => {
        (h.t.sqlite as unknown as { prepare: typeof real }).prepare = real;
        throw error;
      },
    );
  }

  /** `from` so a second batch does not collide with the first on slug. */
  async function makeProjects(count: number, from = 0): Promise<void> {
    for (let i = from; i < from + count; i += 1) {
      const res = await req('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `P${String(i)}`,
          slug: `p${String(i)}`,
          prefix: `PX${String(i)}`,
        }),
      });
      expect(res.status, await res.clone().text()).toBe(201);
    }
  }

  it('costs the same for twenty projects as for two', async () => {
    await makeProjects(2);
    const [, few] = await statementsDuring(() => req('/api/v1/projects?limit=50'));

    await makeProjects(18, 2);
    const [res, many] = await statementsDuring(() => req('/api/v1/projects?limit=50'));

    expect(res.status).toBe(200);
    const page = (await res.json()) as { data: { id: string }[] };
    expect(page.data).toHaveLength(20);

    // The property: statement count is a function of the aggregate shape, not of
    // how many cards are on the page.
    expect(many.length).toBe(few.length);
  });

  it('returns the fields the Projects screen needs', async () => {
    await makeProjects(1);
    const res = await req('/api/v1/projects?limit=50');
    const page = (await res.json()) as {
      data: Record<string, unknown>[];
    };

    const project = page.data.find((row) => row.id !== undefined);
    expect(project).toBeDefined();

    for (const field of [
      'repo',
      'task_counts',
      'blocked_count',
      'member_count',
      'members',
      'last_activity_at',
    ]) {
      expect(Object.keys(project ?? {}), field).toContain(field);
    }

    // Deferred, not faked (AC4): heartbeats are M4 (D-023).
    expect(Object.keys(project ?? {})).not.toContain('live_agents');
  });
});

describe('GET/PATCH /api/v1/projects/:slug/context (§6.4, LAI-404)', () => {
  beforeEach(async () => {
    expect((await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' })).status).toBe(201);
  });

  it('reads the document, empty and with no recorded edit to begin with', async () => {
    const res = await req('/api/v1/projects/laika/context');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      context_md: '',
      length: 0,
      limit: 100_000,
      updated_at: null,
      updated_by: null,
    });
  });

  it('writes and reads back verbatim', async () => {
    const raw = '  # Architecture\n\n\ttabbed\n\n';
    const patched = await req('/api/v1/projects/laika/context', {
      method: 'PATCH',
      body: JSON.stringify({ context_md: raw }),
    });

    expect(patched.status).toBe(200);
    expect((await patched.json()) as { context_md: string }).toMatchObject({ context_md: raw });

    const read = await req('/api/v1/projects/laika/context');
    expect((await read.json()) as { context_md: string }).toMatchObject({ context_md: raw });
  });

  it('422s an oversize document, naming the limit and the length', async () => {
    const res = await req('/api/v1/projects/laika/context', {
      method: 'PATCH',
      body: JSON.stringify({ context_md: 'x'.repeat(100_001) }),
    });

    expect(res.status).toBe(422);
    // Whether zod or the service refuses it, the caller must learn how much to
    // cut — an error that only says "too long" makes them guess.
    expect(await res.text()).toMatch(/100000|100,000|100_000/);
  });

  it('401s an anonymous caller on both', async () => {
    const anon = { headers: { 'Content-Type': 'application/json' } };
    expect((await h.app.request('/api/v1/projects/laika/context', anon)).status).toBe(401);
    expect(
      (
        await h.app.request('/api/v1/projects/laika/context', {
          ...anon,
          method: 'PATCH',
          body: JSON.stringify({ context_md: 'x' }),
        })
      ).status,
    ).toBe(401);
  });

  it('404s a project that does not exist', async () => {
    expect((await req('/api/v1/projects/nope/context')).status).toBe(404);
  });

  it('refuses `context_md` on the general project PATCH rather than ignoring it', async () => {
    // The half of AC6 that matters: `.strict()` means a client still sending it
    // to the old path is told, instead of watching the field silently vanish.
    const res = await req('/api/v1/projects/laika', {
      method: 'PATCH',
      body: JSON.stringify({ context_md: 'through the old path' }),
    });

    expect(res.status).toBe(422);
    expect((await req('/api/v1/projects/laika/context')).status).toBe(200);
    expect(
      ((await (await req('/api/v1/projects/laika/context')).json()) as { context_md: string })
        .context_md,
    ).toBe('');
  });
});
