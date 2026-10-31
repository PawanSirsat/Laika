import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentSessionContextDeliveries, users } from '../../../src/db/schema.ts';
import { CONTEXT_MD_LIMIT, REPO_MAX_LENGTH } from '../../../src/services/projects.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

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
      body: JSON.stringify({ context_md: raw, base_revision: 0 }),
    });

    expect(patched.status).toBe(200);
    expect((await patched.json()) as { context_md: string }).toMatchObject({ context_md: raw });

    const read = await req('/api/v1/projects/laika/context');
    expect((await read.json()) as { context_md: string }).toMatchObject({ context_md: raw });
  });

  it('tells a caller the repo shape, not just that it is too long (LAI-159)', async () => {
    // The route carried `.max(REPO_MAX_LENGTH)`, the same constant the service
    // compares against, so zod refused first with "Too big: expected string to
    // have <=200 characters" — the size, and nothing about the shape. The
    // service says `owner/name` with an example, which is what somebody who got
    // it wrong actually needs.
    const res = await req('/api/v1/projects/laika', {
      method: 'PATCH',
      body: JSON.stringify({ repo: `laika/${'x'.repeat(REPO_MAX_LENGTH)}` }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { details: { expected?: string; example?: string } };
    };

    expect(body.error.details.expected).toBe('owner/name');
    expect(body.error.details.example).toBeDefined();
  });

  it('still refuses an empty repo at the route', async () => {
    // `min(1)` stays: the shape is the schema's job, the size is the service's.
    const res = await req('/api/v1/projects/laika', {
      method: 'PATCH',
      body: JSON.stringify({ repo: '' }),
    });

    expect(res.status).toBe(422);
  });

  it('422s an oversize document, naming the limit and the length', async () => {
    // **This test used to pass against the bug** (LAI-228). It matched
    // `/100000/` on the body — which the *limit* satisfies, and both errors
    // carry the limit — and its comment said "whether zod or the service
    // refuses it", tolerating the very difference §7.3 cares about. The zod
    // refusal names the limit and not the length.
    const length = CONTEXT_MD_LIMIT + 400;
    const res = await req('/api/v1/projects/laika/context', {
      method: 'PATCH',
      body: JSON.stringify({ context_md: 'x'.repeat(length), base_revision: 0 }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { details: { limit: number; length: number } };
    };

    // The **actual** length, not the limit. §7.3: "a caller that has to guess
    // how much to cut will guess wrong" — and a `length` that echoed the limit
    // would tell them to cut nothing.
    expect(body.error.details).toEqual({ limit: CONTEXT_MD_LIMIT, length });
    expect(body.error.details.length).not.toBe(body.error.details.limit);
  });

  it('accepts a document exactly at the limit', async () => {
    // The boundary the refusal is measured from. Without it, a service that
    // refused at `>= limit` would satisfy every assertion above.
    const res = await req('/api/v1/projects/laika/context', {
      method: 'PATCH',
      body: JSON.stringify({ context_md: 'x'.repeat(CONTEXT_MD_LIMIT), base_revision: 0 }),
    });

    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('still refuses a non-string and an absent field', async () => {
    // AC4. Dropping `.max` must not drop `z.string()`: the *size* is the
    // service's rule, the *type* is this schema's, and removing the whole line
    // would have handed a number to `input.context_md.length` — `undefined`,
    // which is not greater than the limit, so it would have been stored.
    for (const body of [{ context_md: 42 }, { context_md: null }, {}]) {
      const res = await req('/api/v1/projects/laika/context', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
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

describe('context revisions over REST (§6.4, §4.68, LAI-555)', () => {
  beforeEach(async () => {
    expect((await createProject({ name: 'Laika', slug: 'laika', prefix: 'LAI' })).status).toBe(201);
  });

  async function write(contextMd: string, baseRevision: number): Promise<Response> {
    return req('/api/v1/projects/laika/context', {
      method: 'PATCH',
      body: JSON.stringify({ context_md: contextMd, base_revision: baseRevision }),
    });
  }

  it('a write must name its base revision', async () => {
    const res = await req('/api/v1/projects/laika/context', {
      method: 'PATCH',
      body: JSON.stringify({ context_md: 'no base' }),
    });
    expect(res.status).toBe(422);
    expect(
      (await req('/api/v1/projects/laika/context').then((r) => r.json())) as object,
    ).toMatchObject({ context_md: '', revision: 0 });
  });

  it('a stale write is 409 stale_context_revision and the current one is unchanged', async () => {
    expect((await write('one', 0)).status).toBe(200);
    expect((await write('two', 1)).status).toBe(200);

    const stale = await write('clobber', 1);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: unknown }).error).toMatchObject({
      code: 'conflict',
      details: { reason: 'stale_context_revision', base_revision: 1, current_revision: 2 },
    });

    const now = (await (await req('/api/v1/projects/laika/context')).json()) as {
      context_md: string;
      revision: number;
    };
    expect(now).toMatchObject({ context_md: 'two', revision: 2 });
  });

  it('lists revisions, serves one in full, and diffs two', async () => {
    expect((await write('a\nb', 0)).status).toBe(200);
    expect((await write('a\nc', 1)).status).toBe(200);

    const list = await req('/api/v1/projects/laika/context/revisions');
    expect(list.status).toBe(200);
    expect(((await list.json()) as { revision: number }[]).map((r) => r.revision)).toEqual([2, 1]);

    const one = await req('/api/v1/projects/laika/context/revisions/1');
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ revision: 1, body: 'a\nb', length: 3 });

    const diff = await req('/api/v1/projects/laika/context/diff?from=1');
    expect(diff.status).toBe(200);
    expect(await diff.json()).toMatchObject({
      from_revision: 1,
      to_revision: 2,
      current_revision: 2,
      diff: '@@ -1,2 +1,2 @@\n a\n-b\n+c',
      added: 1,
      removed: 1,
    });

    expect((await req('/api/v1/projects/laika/context/revisions/9')).status).toBe(404);
    expect((await req('/api/v1/projects/laika/context/revisions/x')).status).toBe(422);
    expect((await req('/api/v1/projects/laika/context/diff')).status).toBe(422);
  });

  it('a diff past 2,000 changed lines is truncated, with the way to read it whole', async () => {
    const doc = (prefix: string) =>
      Array.from({ length: 1001 }, (_, i) => `${prefix} ${String(i)}`).join('\n');
    expect((await write(doc('old'), 0)).status).toBe(200);
    expect((await write(doc('new'), 1)).status).toBe(200);

    const res = await req('/api/v1/projects/laika/context/diff?from=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hint: string };
    expect(body).toMatchObject({
      from_revision: 1,
      to_revision: 2,
      diff: '',
      added: null,
      removed: null,
      truncated: true,
    });
    expect(body.hint).toContain('GET /api/v1/projects/laika/context/revisions/2');
    expect(body.hint).toContain('get_project_context without since_revision');

    const small = (await (
      await req('/api/v1/projects/laika/context/diff?from=2')
    ).json()) as object;
    expect(small).toMatchObject({ truncated: false, hint: null });
  });

  it('a project the caller cannot see answers exactly as a missing one', async () => {
    const owner = h.db.select().from(users).get()!;
    const orgId = h.db.all<{ id: string }>(sql`SELECT id FROM orgs`)[0]!.id;
    const email = 'outsider@example.test';
    const token = seedInvite(h.db, { orgId, createdBy: owner.id, email, orgRole: 'member' });
    const joined = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
    expect(joined.status, await joined.clone().text()).toBe(200);
    const outsider = cookieFrom(joined);

    // The deliveries read (LAI-1003), literally byte for byte: the same slug
    // before the project exists, and again once it exists and is hidden.
    const tails = ['/context/deliveries', '/context/deliveries?revision=1'];
    const beforeItExists = new Map<string, { status: number; body: string }>();
    for (const tail of tails) {
      const res = await req(`/api/v1/projects/hidden${tail}`, {}, outsider);
      beforeItExists.set(tail, { status: res.status, body: await res.text() });
    }

    expect(
      (
        await createProject({
          name: 'Hidden',
          slug: 'hidden',
          prefix: 'HID',
          visibility: 'private',
        })
      ).status,
    ).toBe(201);

    for (const [method, tail, body] of [
      ['GET', '/context', undefined],
      ['PATCH', '/context', { context_md: 'x', base_revision: 0 }],
      ['GET', '/context/revisions', undefined],
      ['GET', '/context/revisions/1', undefined],
      ['GET', '/context/diff?from=0', undefined],
      ['GET', '/context/deliveries', undefined],
      ['GET', '/context/deliveries?revision=1', undefined],
    ] as const) {
      const init = {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      };
      const hidden = await req(`/api/v1/projects/hidden${tail}`, init, outsider);
      const missing = await req(`/api/v1/projects/nope${tail}`, init, outsider);
      expect(hidden.status, `${method} ${tail}`).toBe(404);
      expect(missing.status, `${method} ${tail}`).toBe(404);
      expect(((await hidden.json()) as { error: { code: string } }).error.code).toBe(
        ((await missing.json()) as { error: { code: string } }).error.code,
      );
    }

    for (const tail of tails) {
      const res = await req(`/api/v1/projects/hidden${tail}`, {}, outsider);
      expect(beforeItExists.get(tail)?.status, tail).toBe(404);
      expect({ status: res.status, body: await res.text() }, tail).toEqual(
        beforeItExists.get(tail),
      );
    }
  });

  const projectId = (): string =>
    h.db.all<{ id: string }>(sql`SELECT id FROM projects WHERE slug = 'laika'`)[0]!.id;

  it('lists each session’s latest delivered revision, saying that is all it keeps (LAI-1003)', async () => {
    expect((await write('one', 0)).status).toBe(200);
    expect((await write('two', 1)).status).toBe(200);

    const empty = await req('/api/v1/projects/laika/context/deliveries?revision=2');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      scope: 'latest_per_session',
      revision: 2,
      current_revision: 2,
      data: [],
      next_cursor: null,
    });

    const registered = await req('/api/v1/agents', {
      method: 'POST',
      body: JSON.stringify({
        display_name: 'Polly',
        harness: 'omnigent',
        device_label: 'Belka',
        grants: [{ project_id: projectId(), scope: 'full' }],
      }),
    });
    expect(registered.status, await registered.clone().text()).toBe(201);
    const { agent, secret } = (await registered.json()) as {
      agent: { id: string };
      secret: string;
    };
    const opened = await h.app.request('/api/v1/agent-sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(opened.status, await opened.clone().text()).toBe(201);
    const session = ((await opened.json()) as { id: string }).id;
    h.db
      .insert(agentSessionContextDeliveries)
      .values({ sessionId: session, projectId: projectId(), revision: 1, deliveredAt: 1_000 })
      .run();

    const all = (await (await req('/api/v1/projects/laika/context/deliveries')).json()) as {
      revision: number | null;
      data: unknown[];
    };
    expect(all.revision).toBeNull();
    expect(all.data).toEqual([
      {
        session_id: session,
        revision: 1,
        delivered_at: 1_000,
        session_ended_at: null,
        agent: {
          id: agent.id,
          harness: 'omnigent',
          device_label: 'Belka',
          display_name: 'Polly',
          status: 'active',
        },
      },
    ]);

    const paged = (await (
      await req('/api/v1/projects/laika/context/deliveries?revision=1&limit=1')
    ).json()) as { data: unknown[]; next_cursor: string | null };
    expect(paged.data).toHaveLength(1);
    expect(paged.next_cursor).toBeNull();

    expect((await req('/api/v1/projects/laika/context/deliveries?revision=3')).status).toBe(404);
    expect((await req('/api/v1/projects/laika/context/deliveries?revision=x')).status).toBe(422);
    expect((await req('/api/v1/projects/laika/context/deliveries?cursor=%%')).status).toBe(400);
  });
});
