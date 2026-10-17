import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idempotencyKeys, memberRatings, orgs, projects, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
} from '../../helpers/auth.ts';

/**
 * `/api/v1/users/:id/profile` and `/api/v1/users/:id/ratings` over HTTP (SPEC
 * §6.4, §3.1, D-078, LAI-743).
 *
 * The service tests own the figures. What is proven here is the door: every
 * credential a request can arrive on, against every one of the three
 * endpoints, with the exact status **and** code — and `details.action`, which
 * only `can()` writes, so a `403` from anywhere else cannot satisfy it.
 *
 * Every setup write goes through `ok()`, which asserts its status: a fixture
 * that silently failed to mint a token would make "the token is refused" pass
 * for the wrong reason.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let orgId: string;
let laikaId: string;

interface Person {
  cookie: string;
  id: string;
}

let admin: Person;
let member: Person;
let viewer: Person;

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

/** A setup write that must succeed, or the test is about something else. */
async function ok(res: Promise<Response>, status = 200): Promise<Record<string, unknown>> {
  const done = await res;
  expect(done.status, await done.clone().text()).toBe(status);
  return (await done.json()) as Record<string, unknown>;
}

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<Person> {
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  const id = h.db.select().from(users).where(eq(users.email, email)).get()?.id ?? '';
  expect(id).not.toBe('');
  return { cookie: cookieFrom(res), id };
}

async function mint(cookie: string, body: Record<string, unknown>): Promise<string> {
  const created = await ok(
    req('/api/v1/tokens', { method: 'POST', body: JSON.stringify(body) }, cookie),
    201,
  );
  const secret = String(created.secret);
  expect(secret).toMatch(/^lai_/);
  return secret;
}

/** The three endpoints, each as the request that should succeed for an admin. */
function calls(
  target: string,
): { name: string; action: string; init: RequestInit; path: string; ok: number }[] {
  return [
    {
      name: 'GET profile',
      action: 'profile.read',
      path: `/api/v1/users/${target}/profile`,
      init: {},
      ok: 200,
    },
    {
      name: 'PATCH profile',
      action: 'profile.set_kind',
      path: `/api/v1/users/${target}/profile`,
      init: { method: 'PATCH', body: JSON.stringify({ profile_kind: 'manager' }) },
      ok: 200,
    },
    {
      name: 'POST ratings',
      action: 'profile.rate',
      path: `/api/v1/users/${target}/ratings`,
      init: { method: 'POST', body: JSON.stringify({ score: 4, note: 'Steady delivery.' }) },
      ok: 201,
    },
  ];
}

async function errorOf(res: Response): Promise<{ code: string; details?: { action?: string } }> {
  return ((await res.json()) as { error: { code: string; details?: { action?: string } } }).error;
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
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  ownerCookie = cookieFrom(setup);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
  orgId = h.db.select().from(orgs).get()?.id ?? '';
  laikaId = h.db.select().from(projects).where(eq(projects.slug, 'laika')).get()?.id ?? '';
  expect([ownerId, orgId, laikaId]).not.toContain('');

  admin = await join('ari@example.test', 'admin');
  member = await join('bea@example.test', 'member');
  viewer = await join('vic@example.test', 'viewer');
});

afterEach(() => {
  h.close();
});

describe('who may call the three endpoints (§3.1, LAI-743)', () => {
  it('lets an owner and an admin, signed in, do all three', async () => {
    for (const who of [ownerCookie, admin.cookie]) {
      for (const call of calls(member.id)) {
        const res = await req(call.path, call.init, who);
        expect(res.status, `${call.name}: ${await res.clone().text()}`).toBe(call.ok);
      }
    }
  });

  it('refuses a member and a viewer, forbidden by profile.*', async () => {
    for (const who of [member, viewer]) {
      for (const call of calls(admin.id)) {
        const res = await req(call.path, call.init, who.cookie);
        expect(res.status, call.name).toBe(403);
        expect(await errorOf(res), call.name).toMatchObject({
          code: 'forbidden',
          details: { action: call.action },
        });
      }
    }
  });

  it('refuses every token: an owner’s full one, an admin’s project-scoped and read-only ones', async () => {
    const tokens = {
      'owner, full, unscoped': await mint(ownerCookie, { name: 'Claude Code', scope: 'full' }),
      'admin, full, project-scoped': await mint(admin.cookie, {
        name: 'Codex',
        scope: 'full',
        project_ids: [laikaId],
      }),
      'admin, read only': await mint(admin.cookie, { name: 'Reader', scope: 'read_only' }),
    };

    // The tokens work: each reads the member list, so a refusal below is the
    // profile's, not a broken credential.
    for (const [kind, secret] of Object.entries(tokens)) {
      expect((await req('/api/v1/users', {}, secret)).status, kind).toBe(200);
    }

    for (const [kind, secret] of Object.entries(tokens)) {
      for (const call of calls(member.id)) {
        const res = await req(call.path, call.init, secret);
        expect(res.status, `${kind} / ${call.name}`).toBe(403);
        expect(await errorOf(res), `${kind} / ${call.name}`).toMatchObject({
          code: 'forbidden',
          details: { action: call.action },
        });
      }
    }
  });

  it('401s a caller who is not signed in', async () => {
    for (const call of calls(member.id)) {
      const res = await req(call.path, call.init);
      expect(res.status, call.name).toBe(401);
      expect((await errorOf(res)).code).toBe('unauthorized');
    }
  });

  it('answers a member forbidden whether or not the id exists; only an admin hears not_found', async () => {
    for (const call of calls('usr_nobody')) {
      const asMember = await req(call.path, call.init, member.cookie);
      expect(asMember.status, call.name).toBe(403);

      const asAdmin = await req(call.path, call.init, admin.cookie);
      expect(asAdmin.status, call.name).toBe(404);
      expect((await errorOf(asAdmin)).code).toBe('not_found');
    }
  });

  it('refuses an admin rating themselves', async () => {
    const res = await req(
      `/api/v1/users/${admin.id}/ratings`,
      { method: 'POST', body: JSON.stringify({ score: 5, note: 'Me.' }) },
      admin.cookie,
    );
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({
      code: 'forbidden',
      details: { action: 'profile.rate' },
    });
  });
});

describe('the bodies (§6.3, LAI-743)', () => {
  it('sets a kind without telling a member anything changed (LAI-746)', async () => {
    // The kind is not in the member list's shape, so bumping `updated_at`
    // would hand every member's catch-up a row that looks unchanged — an
    // unexplained edit, and a hint that something about that person moved.
    // Pinned old first, so a bump cannot hide inside the same millisecond.
    h.db
      .update(users)
      .set({ updatedAt: new Date(1_000) })
      .where(eq(users.id, member.id))
      .run();

    await ok(
      req(
        `/api/v1/users/${member.id}/profile`,
        { method: 'PATCH', body: JSON.stringify({ profile_kind: 'manager' }) },
        ownerCookie,
      ),
    );

    const page = await ok(req('/api/v1/users?updated_since=2000', {}, viewer.cookie));
    expect((page.data as { id: string }[]).map((u) => u.id)).not.toContain(member.id);
    // The kind did change — so the silence above is the timestamp, not a
    // write that never happened.
    expect(h.db.select().from(users).where(eq(users.id, member.id)).get()?.profileKind).toBe(
      'manager',
    );
  });

  it('returns the profile, and the profile with the new kind after a PATCH', async () => {
    const before = await ok(req(`/api/v1/users/${member.id}/profile`, {}, ownerCookie));
    expect(before).toMatchObject({ user: { id: member.id, profile_kind: 'builder' } });
    expect(before).toHaveProperty('agents');

    const after = await ok(
      req(
        `/api/v1/users/${member.id}/profile`,
        { method: 'PATCH', body: JSON.stringify({ profile_kind: 'manager' }) },
        ownerCookie,
      ),
    );
    expect(after).toMatchObject({ user: { profile_kind: 'manager' } });
    expect(after).not.toHaveProperty('agents');
  });

  it('answers 201 with the rating, and the profile then carries it first', async () => {
    await ok(
      req(
        `/api/v1/users/${member.id}/ratings`,
        { method: 'POST', body: JSON.stringify({ score: 3, note: 'Earlier.' }) },
        admin.cookie,
      ),
      201,
    );
    const created = await ok(
      req(
        `/api/v1/users/${member.id}/ratings`,
        { method: 'POST', body: JSON.stringify({ score: 5, note: 'Later.' }) },
        ownerCookie,
      ),
      201,
    );
    expect(created).toMatchObject({
      score: 5,
      note: 'Later.',
      rated_by: { id: ownerId, name: 'Ada' },
    });

    const profile = await ok(req(`/api/v1/users/${member.id}/profile`, {}, admin.cookie));
    expect((profile.ratings as { note: string }[]).map((r) => r.note)).toEqual([
      'Later.',
      'Earlier.',
    ]);
  });

  it('refuses bad ratings 422, unknown fields included', async () => {
    for (const body of [
      { score: 0, note: 'Low.' },
      { score: 6, note: 'High.' },
      { score: 2.5, note: 'Half.' },
      { score: '4', note: 'A string.' },
      { score: 4 },
      { score: 4, note: '   ' },
      { score: 4, note: 'x'.repeat(501) },
      { score: 4, note: 'Fine.', visible_to: 'everyone' },
    ]) {
      const res = await req(
        `/api/v1/users/${member.id}/ratings`,
        { method: 'POST', body: JSON.stringify(body) },
        ownerCookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await errorOf(res)).code).toBe('unprocessable');
    }
  });

  it('refuses a profile kind that is not one, 422', async () => {
    for (const body of [
      { profile_kind: 'admin' },
      {},
      { profile_kind: 'manager', org_role: 'owner' },
    ]) {
      const res = await req(
        `/api/v1/users/${member.id}/profile`,
        { method: 'PATCH', body: JSON.stringify(body) },
        ownerCookie,
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('405s the methods that are not built', async () => {
    const ratings = await req(`/api/v1/users/${member.id}/ratings`, {}, ownerCookie);
    expect(ratings.status).toBe(405);
    expect(ratings.headers.get('Allow')).toBe('POST');

    const del = await req(`/api/v1/users/${member.id}/profile`, { method: 'DELETE' }, ownerCookie);
    expect(del.status).toBe(405);
    expect(del.headers.get('Allow')).toContain('PATCH');
  });
});

describe('a rating reaches nothing but the profile (D-078, LAI-743)', () => {
  const NOTE = 'A remark only admins should ever read.';

  async function rate(): Promise<void> {
    await ok(
      req(
        `/api/v1/users/${member.id}/ratings`,
        { method: 'POST', body: JSON.stringify({ score: 2, note: NOTE }) },
        ownerCookie,
      ),
      201,
    );
  }

  it('is in no feed, member list, capacity, presence or /me answer', async () => {
    await rate();
    // A project change after it, so the feeds below are not empty by accident.
    await ok(
      req(
        '/api/v1/projects/laika/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'Later work' }) },
        ownerCookie,
      ),
      201,
    );

    for (const [path, who] of [
      ['/api/v1/activity', ownerCookie],
      ['/api/v1/projects/laika/activity', ownerCookie],
      ['/api/v1/users', member.cookie],
      ['/api/v1/users?include_inactive=true', ownerCookie],
      ['/api/v1/capacity', member.cookie],
      ['/api/v1/presence', ownerCookie],
      ['/api/v1/me', member.cookie],
    ] as const) {
      const text = await (await req(path, {}, who)).text();
      expect(text, path).not.toContain(NOTE);
      expect(text, path).not.toMatch(/rating|profile_kind/);
    }

    // Capacity carries the profile **kind** to an owner or admin since LAI-767,
    // on the profile's own `profile.read` (a member's answer is checked above),
    // and never a rating to anybody.
    const capacity = await (await req('/api/v1/capacity', {}, ownerCookie)).text();
    expect(capacity).not.toContain(NOTE);
    expect(capacity).not.toMatch(/rating/);
    expect(capacity).toMatch(/profile_kind/);

    // The feed did read something, so the absence above is an answer.
    expect(await (await req('/api/v1/activity', {}, ownerCookie)).text()).toContain('Later work');
  });

  it('is not on the live stream', async () => {
    const stream = await req('/api/v1/events', {}, ownerCookie);
    expect(stream.status).toBe(200);
    const body: ReadableStream<Uint8Array> | null = stream.body;
    if (body === null) throw new Error('no stream body');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let seen = '';

    await rate();
    await ok(
      req(
        '/api/v1/projects/laika/tasks',
        { method: 'POST', body: JSON.stringify({ title: 'Sentinel after the rating' }) },
        ownerCookie,
      ),
      201,
    );

    // Read until the sentinel arrives: everything written before it, the
    // rating included, has had its chance to be streamed.
    while (!seen.includes('Sentinel after the rating')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();

    expect(seen).toContain('Sentinel after the rating');
    expect(seen).not.toContain(NOTE);
  });

  it('is not offered or answered by any MCP tool', async () => {
    await rate();
    const secret = await mint(ownerCookie, { name: 'Claude Code', scope: 'full' });

    const rpc = async (body: Record<string, unknown>): Promise<string> => {
      const res = await h.app.request('/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
      });
      expect(res.status).toBe(200);
      return res.text();
    };

    const list = await rpc({ method: 'tools/list', params: {} });
    const names = [...list.matchAll(/"name":"(laika_[a-z_]+|[a-z_]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => /rating|profile/.test(n ?? ''))).toEqual([]);

    const whoami = await rpc({
      method: 'tools/call',
      params: { name: 'laika_whoami', arguments: {} },
    });
    expect(whoami).toContain('ada@example.test');
    expect(whoami).not.toContain(NOTE);
  });
});

/**
 * `Idempotency-Key` on `POST /users/:id/ratings` (§6.3, §4.21, LAI-746).
 *
 * The generic store answers a keyed POST **before the route runs**, keyed by
 * user rather than by credential — so a token holding a session's key and body
 * was handed the session's `201`, note included, without `can()` ever being
 * asked; and the note sat in `idempotency_keys` for a day. The ratings route
 * now keeps its own key on the rating, asked after the permission.
 */
describe('a retried rating (LAI-746)', () => {
  const NOTE = 'A private remark sent twice.';
  const body = JSON.stringify({ score: 4, note: NOTE });

  async function post(auth: string, key: string, sent = body): Promise<Response> {
    return req(
      `/api/v1/users/${member.id}/ratings`,
      { method: 'POST', body: sent, headers: { 'Idempotency-Key': key } },
      auth,
    );
  }

  it('is never replayed to a token, even with the session’s key and body', async () => {
    expect((await post(ownerCookie, 'attempt-1')).status).toBe(201);
    const token = await mint(ownerCookie, { name: 'Claude Code', scope: 'full' });

    const res = await post(token, 'attempt-1');

    expect(res.headers.get('Idempotent-Replay')).toBeNull();
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({
      code: 'forbidden',
      details: { action: 'profile.rate' },
    });
  });

  it('leaves no copy of the note in idempotency_keys', async () => {
    expect((await post(ownerCookie, 'attempt-1')).status).toBe(201);
    expect((await post(ownerCookie, 'attempt-1')).status).toBe(201);

    const stored = h.db.select().from(idempotencyKeys).all();
    expect(stored.filter((row) => row.responseBody.includes(NOTE))).toEqual([]);
    // And the rating itself is where the key went.
    expect(
      h.db
        .select()
        .from(memberRatings)
        .all()
        .map((r) => r.idempotencyKey),
    ).toEqual(['attempt-1']);
  });

  it('answers a retry with the rating it already wrote, and writes no second one', async () => {
    const first = await ok(post(ownerCookie, 'attempt-1'), 201);
    const again = await post(ownerCookie, 'attempt-1');

    expect(again.status).toBe(201);
    expect(again.headers.get('Idempotent-Replay')).toBe('true');
    expect(((await again.json()) as { id: string }).id).toBe(first.id);
    expect(h.db.select().from(memberRatings).all()).toHaveLength(1);
  });

  it('refuses the same key with a different rating, 409', async () => {
    expect((await post(ownerCookie, 'attempt-1')).status).toBe(201);

    const res = await post(ownerCookie, 'attempt-1', JSON.stringify({ score: 2, note: NOTE }));

    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('conflict');
    expect(h.db.select().from(memberRatings).all()).toHaveLength(1);
  });

  it('keeps one rater’s key from answering another’s', async () => {
    expect((await post(ownerCookie, 'shared-key')).status).toBe(201);
    const res = await post(admin.cookie, 'shared-key');

    expect(res.status).toBe(201);
    expect(res.headers.get('Idempotent-Replay')).toBeNull();
    expect(h.db.select().from(memberRatings).all()).toHaveLength(2);
  });

  it('refuses a key longer than 255 characters rather than storing it', async () => {
    const res = await post(ownerCookie, 'k'.repeat(256));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('bad_request');
    expect(h.db.select().from(memberRatings).all()).toHaveLength(0);
  });
});
