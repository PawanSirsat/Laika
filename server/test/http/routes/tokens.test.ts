import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `/api/v1/tokens` and `/api/v1/users/:id/tokens` over HTTP (SPEC §6.4).
 *
 * The service tests own the rules. What is worth proving at this level is the
 * transport: which status each shape answers with, that the secret is in exactly
 * one response and no other, and that the admin paths are shut to a Member.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;

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

async function req(path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({
      ...(cookie === undefined ? {} : { Cookie: cookie }),
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });
}

async function mint(body: unknown, cookie = ownerCookie): Promise<Response> {
  return req('/api/v1/tokens', { method: 'POST', body: JSON.stringify(body) }, cookie);
}

async function json(res: Response): Promise<Record<string, never>> {
  return (await res.json()) as Record<string, never>;
}

/** Sign somebody up through a seeded invite; returns their cookie and id. */
async function join(
  email: string,
  orgRole: 'admin' | 'member' | 'viewer',
): Promise<{ cookie: string; id: string }> {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);

  return {
    cookie: cookieFrom(res),
    id: h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '',
  };
}

beforeEach(async () => {
  h = authHarness();
  ownerCookie = await setUp();

  // Both created by first-run setup; read them back rather than assuming ids.
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  orgId = h.db.select().from(orgs).get()?.id ?? '';

  expect(ownerId).not.toBe('');
  expect(orgId).not.toBe('');
});

afterEach(() => {
  h.close();
});

describe('POST /api/v1/tokens', () => {
  it('mints one and returns the secret exactly once', async () => {
    const res = await mint({ name: 'my laptop', scope: 'full' });

    expect(res.status).toBe(201);
    const created = await json(res);

    expect(created.secret).toMatch(/^lai_[0-9A-Za-z]{40}$/);
    expect(created.token).toMatchObject({
      name: 'my laptop',
      scope: 'full',
      project_ids: null,
      last_used_at: null,
      expires_at: null,
      revoked_at: null,
    });
    expect((created.token as unknown as { prefix: string }).prefix).toBe(
      String(created.secret).slice(0, 8),
    );

    // And it is nowhere else, ever again.
    const list = await req('/api/v1/tokens', {}, ownerCookie);
    expect(await list.text()).not.toContain(String(created.secret));
  });

  it('refuses an anonymous caller', async () => {
    // Deliberately not `mint(..., undefined)`: `mint`'s cookie parameter
    // defaults to the Owner's, so passing `undefined` would quietly sign the
    // request in and assert nothing. Caught by this test failing 201 vs 401.
    const res = await req('/api/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'n', scope: 'full' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown body field rather than dropping it', async () => {
    // §6.3: a silently ignored field is a client that believes it set something.
    const res = await mint({ name: 'n', scope: 'full', admin: true });
    expect(res.status).toBe(422);
  });

  it('rejects a blank name and a bad scope', async () => {
    expect((await mint({ name: '   ', scope: 'full' })).status).toBe(422);
    expect((await mint({ name: 'n', scope: 'root' })).status).toBe(422);
  });

  it('forces read_only for a viewer instead of refusing', async () => {
    const viewer = await join('viewer@example.test', 'viewer');
    const res = await mint({ name: 'v', scope: 'full' }, viewer.cookie);

    expect(res.status).toBe(201);
    expect((await json(res)).token).toMatchObject({ scope: 'read_only' });
  });

  it('422s on a project id the caller cannot scope to', async () => {
    const res = await mint({ name: 'n', scope: 'full', project_ids: ['nope'] });
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: 'unprocessable' });
  });
});

describe('GET /api/v1/tokens', () => {
  it('pages like every other list, and carries no secret or hash', async () => {
    const first = await json(await mint({ name: 'one', scope: 'full' }));
    await mint({ name: 'two', scope: 'read_only' });

    const res = await req('/api/v1/tokens', {}, ownerCookie);
    expect(res.status).toBe(200);

    const text = await res.clone().text();
    expect(text).not.toContain(String(first.secret));
    expect(text).not.toMatch(/[0-9a-f]{64}/);

    const page = await json(res);
    expect(Array.isArray(page.data)).toBe(true);
    expect(page).toHaveProperty('next_cursor');
    expect((page.data as unknown as { name: string }[]).map((row) => row.name)).toContain('one');
  });

  it('shows only your own', async () => {
    await mint({ name: 'owners', scope: 'full' });
    const member = await join('member@example.test', 'member');

    const page = await json(await req('/api/v1/tokens', {}, member.cookie));
    expect(page.data).toEqual([]);
  });

  it('refuses an anonymous caller', async () => {
    expect((await req('/api/v1/tokens')).status).toBe(401);
  });
});

describe('DELETE /api/v1/tokens/:id', () => {
  it('answers 204, and 204 again — revoking is idempotent', async () => {
    const created = await json(await mint({ name: 'n', scope: 'full' }));
    const id = (created.token as unknown as { id: string }).id;

    expect((await req(`/api/v1/tokens/${id}`, { method: 'DELETE' }, ownerCookie)).status).toBe(204);
    expect((await req(`/api/v1/tokens/${id}`, { method: 'DELETE' }, ownerCookie)).status).toBe(204);

    const page = await json(await req('/api/v1/tokens', {}, ownerCookie));
    expect((page.data as unknown as { revoked_at: number | null }[])[0]?.revoked_at).not.toBeNull();
  });

  it('404s for a token that does not exist', async () => {
    expect((await req('/api/v1/tokens/nope', { method: 'DELETE' }, ownerCookie)).status).toBe(404);
  });

  it('403s for somebody else’s', async () => {
    const created = await json(await mint({ name: 'n', scope: 'full' }));
    const id = (created.token as unknown as { id: string }).id;
    const member = await join('member2@example.test', 'member');

    expect((await req(`/api/v1/tokens/${id}`, { method: 'DELETE' }, member.cookie)).status).toBe(
      403,
    );
  });
});

describe('the admin paths (§3.1 — Owner and Admin only)', () => {
  it('lets an Admin list and revoke anyone’s', async () => {
    const created = await json(await mint({ name: 'n', scope: 'full' }));
    const id = (created.token as unknown as { id: string }).id;
    const admin = await join('admin@example.test', 'admin');

    const list = await req(`/api/v1/users/${ownerId}/tokens`, {}, admin.cookie);
    expect(list.status).toBe(200);
    expect((await json(list)).data).toHaveLength(1);

    const del = await req(
      `/api/v1/users/${ownerId}/tokens/${id}`,
      { method: 'DELETE' },
      admin.cookie,
    );
    expect(del.status).toBe(204);
  });

  it('403s a Member on both', async () => {
    const created = await json(await mint({ name: 'n', scope: 'full' }));
    const id = (created.token as unknown as { id: string }).id;
    const member = await join('member3@example.test', 'member');

    expect((await req(`/api/v1/users/${ownerId}/tokens`, {}, member.cookie)).status).toBe(403);
    expect(
      (await req(`/api/v1/users/${ownerId}/tokens/${id}`, { method: 'DELETE' }, member.cookie))
        .status,
    ).toBe(403);
  });

  it('401s an anonymous caller on both', async () => {
    expect((await req(`/api/v1/users/${ownerId}/tokens`)).status).toBe(401);
    expect((await req(`/api/v1/users/${ownerId}/tokens/x`, { method: 'DELETE' })).status).toBe(401);
  });

  it('does not shadow GET /api/v1/users', async () => {
    // `userTokenRoutes` mounts on the same prefix and is registered first.
    const res = await req('/api/v1/users', {}, ownerCookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ada@example.test');
  });
});
