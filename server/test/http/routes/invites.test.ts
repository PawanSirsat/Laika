import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db } from '../../../src/db/client.ts';
import { ERROR_STATUS } from '../../../src/errors.ts';
import { users } from '../../../src/db/schema.ts';
import { acceptUrlFor } from '../../../src/http/routes/invites.ts';
import { INVITE_TTL_MS } from '../../../src/services/invites.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  seedOrg,
  signUp,
  TEST_ORIGIN,
} from '../../helpers/auth.ts';

/**
 * LAI-071 over HTTP. The two properties worth proving at this level are that
 * accepting works **with no session** (AC6) and that a spent token is refused on
 * **every** path into the process, not only the polite one (AC3).
 */

const PASSWORD = 'correct-horse-battery';

let h: AuthHarness;
let db: Db;
let orgId: string;
let ownerId: string;
/** A signed-in Admin, landed on that role by accepting an invite.  */
let adminCookie: string;
let adminId: string;

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return h.app.request(path, {
    method: 'POST',
    headers: jsonHeaders(cookie === undefined ? {} : { Cookie: cookie }),
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie?: string): Promise<Response> {
  return h.app.request(path, {
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });
}

async function del(path: string, cookie?: string): Promise<Response> {
  return h.app.request(path, {
    method: 'DELETE',
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });
}

async function body(res: Response): Promise<Record<string, never>> {
  return (await res.json()) as Record<string, never>;
}

/** Sign somebody up through a seeded invite and return their session cookie. */
async function join(email: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<string> {
  const token = seedInvite(db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
}

beforeEach(async () => {
  h = authHarness();
  db = h.db;
  ({ orgId, ownerId } = seedOrg(db, true));

  adminCookie = await join('admin@example.test', 'admin');
  adminId = db.select().from(users).where(eq(users.email, 'admin@example.test')).get()?.id ?? '';
});

afterEach(() => {
  h.close();
});

describe('POST /api/v1/invites (AC1)', () => {
  it('creates an invite and returns the token once, with a URL to pass on', async () => {
    const res = await post(
      '/api/v1/invites',
      { email: 'New.Person@Example.test', org_role: 'member' },
      adminCookie,
    );

    expect(res.status).toBe(201);
    const created = await body(res);

    expect(created.invite).toMatchObject({
      email: 'new.person@example.test',
      org_role: 'member',
      project_id: null,
      project_role: null,
      created_by: adminId,
      // No SMTP anywhere in Laika: the UI must not say "invitation sent".
      email_sent: false,
    });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.accept_url).toBe(`${TEST_ORIGIN}/invite?token=${String(created.token)}`);
  });

  it('expires seven days out', async () => {
    const before = Date.now();
    const res = await post('/api/v1/invites', { org_role: 'viewer' }, adminCookie);
    const created = await body(res);

    const expiresAt = Number((created.invite as unknown as { expires_at: number }).expires_at);
    expect(expiresAt).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);
  });

  it('refuses an anonymous caller and a Member', async () => {
    expect((await post('/api/v1/invites', { org_role: 'member' })).status).toBe(401);

    const memberCookie = await join('member@example.test', 'member');
    const res = await post('/api/v1/invites', { org_role: 'member' }, memberCookie);

    expect(res.status).toBe(403);
    expect((await body(res)).error).toMatchObject({ code: 'forbidden' });
  });

  it('refuses an Admin inviting an Owner (§3.1, "not to Owner")', async () => {
    const res = await post(
      '/api/v1/invites',
      { email: 'escalate@example.test', org_role: 'owner' },
      adminCookie,
    );

    expect(res.status).toBe(403);
  });

  it('rejects unknown body fields rather than dropping them', async () => {
    const res = await post(
      '/api/v1/invites',
      { org_role: 'member', send_email: true },
      adminCookie,
    );

    expect(res.status).toBe(422);
  });

  it('rejects a role outside the §4.1 vocabulary', async () => {
    expect((await post('/api/v1/invites', { org_role: 'root' }, adminCookie)).status).toBe(422);
  });
});

describe('GET /api/v1/invites (AC2)', () => {
  it('lists pending invites for an Admin and refuses everyone below', async () => {
    await post('/api/v1/invites', { email: 'p1@example.test', org_role: 'member' }, adminCookie);

    const listed = await get('/api/v1/invites', adminCookie);
    expect(listed.status).toBe(200);

    const page = await body(listed);
    expect(page).toMatchObject({ next_cursor: null });
    expect((page.data as unknown as { email: string }[]).map((r) => r.email)).toContain(
      'p1@example.test',
    );

    expect((await get('/api/v1/invites')).status).toBe(401);
    const memberCookie = await join('m2@example.test', 'member');
    expect((await get('/api/v1/invites', memberCookie)).status).toBe(403);
  });

  it('never returns the token — only its hash is stored', async () => {
    const created = await body(
      await post('/api/v1/invites', { email: 'p2@example.test', org_role: 'member' }, adminCookie),
    );

    const text = await (await get('/api/v1/invites', adminCookie)).text();

    expect(text).not.toContain(String(created.token));
  });

  it('rejects a malformed include_used', async () => {
    expect((await get('/api/v1/invites?include_used=maybe', adminCookie)).status).toBe(400);
  });
});

describe('DELETE /api/v1/invites/:id (AC2)', () => {
  it('revokes a pending invite and makes its token dead', async () => {
    const created = await body(
      await post('/api/v1/invites', { email: 'rev@example.test', org_role: 'member' }, adminCookie),
    );
    const id = (created.invite as unknown as { id: string }).id;

    expect((await del(`/api/v1/invites/${id}`, adminCookie)).status).toBe(204);
    expect((await get(`/api/v1/invites/${String(created.token)}`)).status).toBe(404);
  });

  it('answers 404 for an unknown id and 401/403 for the wrong caller', async () => {
    expect((await del('/api/v1/invites/nope', adminCookie)).status).toBe(404);
    expect((await del('/api/v1/invites/nope')).status).toBe(401);

    const memberCookie = await join('m3@example.test', 'member');
    expect((await del('/api/v1/invites/nope', memberCookie)).status).toBe(403);
  });
});

describe('GET /api/v1/invites/:token — unauthenticated preview (§6.4)', () => {
  it('answers with no session at all', async () => {
    const created = await body(
      await post(
        '/api/v1/invites',
        { email: 'peek@example.test', org_role: 'viewer' },
        adminCookie,
      ),
    );

    const res = await get(`/api/v1/invites/${String(created.token)}`);

    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({
      org_name: 'Laika',
      inviter_name: 'Test User',
      org_role: 'viewer',
      email: 'peek@example.test',
    });
  });

  it('answers 404 for a made-up token', async () => {
    expect((await get('/api/v1/invites/not-a-real-token')).status).toBe(404);
  });

  it('keeps the token out of the request log', async () => {
    const created = await body(
      await post('/api/v1/invites', { email: 'log@example.test', org_role: 'member' }, adminCookie),
    );
    const token = String(created.token);

    await get(`/api/v1/invites/${token}`);

    const lines = h.log.records.filter((r) => r.event === 'http.request');
    const paths = lines.map((r) => String(r.path));

    expect(paths).toContain('/api/v1/invites/:token');
    // The whole point: hashing the token at rest is undone if the plaintext is
    // written into a log file that outlives the request.
    expect(JSON.stringify(h.log.records)).not.toContain(token);
  });
});

describe('POST /api/v1/invites/accept (AC3, AC6)', () => {
  it('creates the account with no session, on the invited role, and signs them in', async () => {
    const created = await body(
      await post(
        '/api/v1/invites',
        { email: 'joiner@example.test', org_role: 'admin' },
        adminCookie,
      ),
    );

    const res = await post('/api/v1/invites/accept', {
      token: created.token,
      name: 'Joiner',
      password: PASSWORD,
    });

    expect(res.status, await res.clone().text()).toBe(201);
    expect(await body(res)).toMatchObject({
      email: 'joiner@example.test',
      org_role: 'admin',
      project_id: null,
    });

    // The role really landed, and the cookie really works.
    const row = db.select().from(users).where(eq(users.email, 'joiner@example.test')).get();
    expect(row?.orgRole).toBe('admin');

    const me = await get('/api/v1/me', cookieFrom(res));
    expect(me.status).toBe(200);
    expect(await body(me)).toMatchObject({ id: row?.id, org_role: 'admin' });
  });

  it('refuses the replay — the second attempt gets 403, not a second account', async () => {
    const created = await body(await post('/api/v1/invites', { org_role: 'admin' }, adminCookie));

    const first = await post('/api/v1/invites/accept', {
      token: created.token,
      name: 'First',
      password: PASSWORD,
      email: 'first@example.test',
    });
    expect(first.status).toBe(201);

    const replay = await post('/api/v1/invites/accept', {
      token: created.token,
      name: 'Second',
      password: PASSWORD,
      email: 'second@example.test',
    });

    expect(replay.status).toBe(403);
    expect((await body(replay)).error).toMatchObject({ code: 'forbidden' });
    expect(
      db.select().from(users).where(eq(users.email, 'second@example.test')).get(),
    ).toBeUndefined();
  });

  it('refuses the replay on the public signup path too', async () => {
    // The hole this closes: `/auth/sign-up/email` takes an `inviteToken` and is
    // public, so an accept endpoint that consumed invites on its own would leave
    // the token spendable for ever by anyone posting straight to better-auth.
    const created = await body(await post('/api/v1/invites', { org_role: 'admin' }, adminCookie));

    const first = await signUp(h.app, {
      email: 'direct1@example.test',
      password: PASSWORD,
      inviteToken: String(created.token),
    });
    expect(first.status).toBe(200);
    expect(
      db.select().from(users).where(eq(users.email, 'direct1@example.test')).get()?.orgRole,
    ).toBe('admin');

    const second = await signUp(h.app, {
      email: 'direct2@example.test',
      password: PASSWORD,
      inviteToken: String(created.token),
    });

    expect(second.status).toBe(403);
    expect(
      db.select().from(users).where(eq(users.email, 'direct2@example.test')).get(),
    ).toBeUndefined();
  });

  it('lands the invitee in the project the invite named', async () => {
    const project = await body(
      await post(
        '/api/v1/projects',
        { name: 'Rocket', slug: 'rocket', prefix: 'RKT' },
        adminCookie,
      ),
    );
    const projectId = String(project.id);

    const created = await body(
      await post(
        '/api/v1/invites',
        {
          email: 'pilot@example.test',
          org_role: 'member',
          project_id: projectId,
          project_role: 'lead',
        },
        adminCookie,
      ),
    );

    const res = await post('/api/v1/invites/accept', {
      token: created.token,
      name: 'Pilot',
      password: PASSWORD,
    });

    expect(res.status).toBe(201);
    expect(await body(res)).toMatchObject({ project_id: projectId });

    const me = await get('/api/v1/me', cookieFrom(res));
    expect(await body(me)).toMatchObject({
      memberships: [{ project_id: projectId, role: 'lead' }],
    });
  });

  it('refuses an email that is not the one the invite was issued for', async () => {
    const created = await body(
      await post(
        '/api/v1/invites',
        { email: 'bound@example.test', org_role: 'member' },
        adminCookie,
      ),
    );

    const res = await post('/api/v1/invites/accept', {
      token: created.token,
      name: 'Impostor',
      password: PASSWORD,
      email: 'someone.else@example.test',
    });

    expect(res.status).toBe(422);
    expect(
      db.select().from(users).where(eq(users.email, 'someone.else@example.test')).get(),
    ).toBeUndefined();
  });

  it('requires an email for a link invite, which is bound to none', async () => {
    const created = await body(await post('/api/v1/invites', { org_role: 'viewer' }, adminCookie));

    expect(
      (
        await post('/api/v1/invites/accept', {
          token: created.token,
          name: 'Anyone',
          password: PASSWORD,
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await post('/api/v1/invites/accept', {
          token: created.token,
          name: 'Anyone',
          password: PASSWORD,
          email: 'anyone@example.test',
        })
      ).status,
    ).toBe(201);
  });

  it('answers 403 for a token that does not exist, before creating anything', async () => {
    const res = await post('/api/v1/invites/accept', {
      token: 'completely-made-up',
      name: 'Nobody',
      password: PASSWORD,
      email: 'nobody@example.test',
    });

    // 403 rather than 404, and identical to the answer for a spent token: an
    // unauthenticated endpoint that distinguishes them tells a guesser which of
    // their tokens are real.
    expect(res.status).toBe(403);
    expect(
      db.select().from(users).where(eq(users.email, 'nobody@example.test')).get(),
    ).toBeUndefined();
  });

  it('refuses a password shorter than better-auth accepts', async () => {
    const created = await body(
      await post(
        '/api/v1/invites',
        { email: 'weak@example.test', org_role: 'member' },
        adminCookie,
      ),
    );

    expect(
      (
        await post('/api/v1/invites/accept', {
          token: created.token,
          name: 'Weak',
          password: 'short',
        })
      ).status,
    ).toBe(422);
  });
});

describe('when the invite cannot be spent after the account exists', () => {
  it('refuses a link invite whose address already has an account, without a 500', async () => {
    // Reachable, not hypothetical: a link invite carries no address, so nothing
    // at creation time can check one. better-auth refuses the duplicate, and its
    // `APIError` is not a Hono exception — untranslated it reaches the client as
    // `internal`, reporting the caller's own mistake as a server fault.
    const created = await body(await post('/api/v1/invites', { org_role: 'member' }, adminCookie));

    const res = await post('/api/v1/invites/accept', {
      token: created.token,
      name: 'Duplicate',
      password: PASSWORD,
      email: 'admin@example.test',
    });

    expect(res.status).toBeLessThan(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
    // Not `internal`: the §6.3 vocabulary has a code for this and the client
    // needs it to tell "pick another address" from "try again later".
    const { error } = (await res.json()) as { error: { code: string } };
    const code = error.code;
    expect(ERROR_STATUS[code as keyof typeof ERROR_STATUS]).toBe(res.status);
    expect(code).not.toBe('internal');

    // The admin still has their own role: a refused accept changed nothing.
    expect(
      db.select().from(users).where(eq(users.email, 'admin@example.test')).get()?.orgRole,
    ).toBe('admin');
  });

  it('deletes the account when the invite lapses between validating and spending it', async () => {
    // The sign-up hooks read the clock twice — `before` to validate the invite,
    // `after` to spend it. A stepping clock reaches the window between them
    // deterministically. Without the cleanup the address stays taken by an
    // account that never got its role, and the invite can never be retried.
    let call = 0;
    const expiresAt = Date.now() + 60_000;
    const clock = (): number => {
      call += 1;
      // First read is inside the window, every later one is past the expiry.
      return call <= 1 ? expiresAt - 1_000 : expiresAt + 1_000;
    };

    const raced = authHarness({ now: clock });
    const seeded = seedOrg(raced.db, true);
    const token = seedInvite(raced.db, {
      orgId: seeded.orgId,
      createdBy: seeded.ownerId,
      email: 'raced@example.test',
      expiresAt,
      orgRole: 'admin',
    });

    const res = await signUp(raced.app, {
      email: 'raced@example.test',
      password: PASSWORD,
      inviteToken: token,
    });

    expect(res.status).toBe(403);
    expect(
      raced.db.select().from(users).where(eq(users.email, 'raced@example.test')).get(),
    ).toBeUndefined();

    raced.close();
  });
});

describe('acceptUrlFor', () => {
  it('builds an absolute URL from the public origin', () => {
    expect(acceptUrlFor('https://laika.example', 'abc')).toBe(
      'https://laika.example/invite?token=abc',
    );
  });

  it('does not double the slash when the origin carries one', () => {
    expect(acceptUrlFor('https://laika.example/', 'abc')).toBe(
      'https://laika.example/invite?token=abc',
    );
  });

  it('falls back to a relative URL rather than inventing localhost', () => {
    // A public URL nobody configured is not knowable from inside the process,
    // and guessing produces links an invitee cannot open (§11.7).
    expect(acceptUrlFor(undefined, 'abc')).toBe('/invite?token=abc');
    expect(acceptUrlFor('', 'abc')).toBe('/invite?token=abc');
  });

  it('escapes the token so a URL-unsafe character cannot break the query', () => {
    expect(acceptUrlFor('https://laika.example', 'a&b=c')).toBe(
      'https://laika.example/invite?token=a%26b%3Dc',
    );
  });
});
