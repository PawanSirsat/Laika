import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FREE_ATTEMPTS, SignInThrottle } from '../../../src/auth/sign-in-throttle.ts';
import { activity, orgs, passwordResets, sessions, users } from '../../../src/db/schema.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signIn,
  signUp,
} from '../../helpers/auth.ts';

/**
 * Admin-issued one-time password-reset links (D-104 item 4, LAI-983), end to
 * end through real better-auth: the link is issued, the person sets a password
 * with it, and signs in with that password and not the old one.
 */

const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-brand-new-long-passphrase';

let h: AuthHarness;
let ownerCookie: string;
let ownerId: string;
let clock: number;

interface ErrorBody {
  error: { code: string; details: { reason?: string; retry_after_seconds?: number } | null };
}

beforeEach(async () => {
  clock = Date.now();
  h = authHarness({ passwordResetThrottle: new SignInThrottle(() => clock) });
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
  expect(res.status, await res.clone().text()).toBe(201);
  ownerCookie = cookieFrom(res);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
});
afterEach(() => {
  h.close();
});

async function join(
  email: string,
  orgRole: 'admin' | 'member',
): Promise<{ id: string; cookie: string }> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return {
    id: h.db.select().from(users).where(eq(users.email, email)).get()!.id,
    cookie: cookieFrom(res),
  };
}

async function issue(userId: string, headers: Record<string, string> = { Cookie: ownerCookie }) {
  return h.app.request(`/api/v1/users/${userId}/reset-link`, {
    method: 'POST',
    headers: jsonHeaders(headers),
  });
}

/** Issue and return the token, asserting the issue worked. */
async function issueToken(userId: string): Promise<string> {
  const res = await issue(userId);
  expect(res.status, await res.clone().text()).toBe(201);
  const { url } = (await res.json()) as { url: string };
  return new URL(url).searchParams.get('token')!;
}

async function consume(token: string, newPassword = NEW_PASSWORD): Promise<Response> {
  return h.app.request('/api/v1/password-resets/consume', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

async function refusal(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

describe('issuing a link', () => {
  it('answers 201 with the page URL and an expiry within 24 hours, once', async () => {
    const grace = await join('grace@example.test', 'member');

    const before = Date.now();
    const res = await issue(grace.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string; expires_at: number };

    expect(Object.keys(body).sort()).toEqual(['expires_at', 'url']);
    expect(new URL(body.url).pathname).toBe('/reset-password');
    expect(body.expires_at).toBeGreaterThan(before);
    expect(body.expires_at).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
  });

  it('stores only the hash: the token appears in no column', async () => {
    const grace = await join('grace@example.test', 'member');
    const token = await issueToken(grace.id);

    const rows = h.db.select().from(passwordResets).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    // The row is the log: who issued it, for whom.
    expect(rows[0]).toMatchObject({ userId: grace.id, createdBy: ownerId, usedAt: null });
    // §4.8 gains no verb for it.
    expect(
      h.db
        .select()
        .from(activity)
        .all()
        .map((r) => r.type),
    ).not.toContain('user.reset_link_issued');
  });

  it('never for the owner unless the caller is the owner', async () => {
    const admin = await join('admin@example.test', 'admin');

    const byAdmin = await issue(ownerId, { Cookie: admin.cookie });
    expect(byAdmin.status).toBe(403);
    expect((await refusal(byAdmin)).code).toBe('forbidden');

    expect((await issue(ownerId)).status).toBe(201);
  });

  it('lets an admin issue one for a member, by default', async () => {
    const admin = await join('admin@example.test', 'admin');
    const grace = await join('grace@example.test', 'member');

    expect((await issue(grace.id, { Cookie: admin.cookie })).status).toBe(201);
  });

  it('403s a member, and 404s nobody', async () => {
    const grace = await join('grace@example.test', 'member');
    const hedy = await join('hedy@example.test', 'member');

    const res = await issue(grace.id, { Cookie: hedy.cookie });
    expect(res.status).toBe(403);
    expect((await refusal(res)).code).toBe('forbidden');

    const nobody = await issue('usr_nobody');
    expect(nobody.status).toBe(404);
    expect((await refusal(nobody)).code).toBe('not_found');
  });

  it('403s the owner’s own token: session only', async () => {
    const grace = await join('grace@example.test', 'member');
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: ownerCookie }),
      body: JSON.stringify({ name: 'An agent', scope: 'full' }),
    });
    expect(minted.status, await minted.clone().text()).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    const res = await issue(grace.id, { Authorization: `Bearer ${secret}` });
    expect(res.status).toBe(403);
    expect(await refusal(res)).toMatchObject({
      code: 'forbidden',
      details: { reason: 'session_required' },
    });
    expect(h.db.select().from(passwordResets).all()).toHaveLength(0);
  });

  it('422s a deactivated person: reactivate first', async () => {
    const grace = await join('grace@example.test', 'member');
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, grace.id)).run();

    const res = await issue(grace.id);
    expect(res.status).toBe(422);
    expect((await refusal(res)).details?.reason).toBe('inactive');
  });
});

describe('using a link', () => {
  it('sets the password: the new one signs in, the old one does not', async () => {
    const grace = await join('grace@example.test', 'member');
    const token = await issueToken(grace.id);

    const res = await consume(token);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ user_id: grace.id, sessions_ended: 1 });

    expect((await signIn(h.app, 'grace@example.test', NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(h.app, 'grace@example.test', PASSWORD)).status).toBe(401);
  });

  it('ends every session the person had', async () => {
    const grace = await join('grace@example.test', 'member');
    const second = cookieFrom(await signIn(h.app, 'grace@example.test', PASSWORD));
    const token = await issueToken(grace.id);

    expect((await consume(token)).status).toBe(200);

    for (const cookie of [grace.cookie, second]) {
      const me = await h.app.request('/api/v1/me', { headers: jsonHeaders({ Cookie: cookie }) });
      expect(me.status).toBe(401);
    }
    expect(h.db.select().from(sessions).where(eq(sessions.userId, grace.id)).all()).toEqual([]);
  });

  it('works once: a used link is refused 409 used', async () => {
    const grace = await join('grace@example.test', 'member');
    const token = await issueToken(grace.id);
    expect((await consume(token)).status).toBe(200);

    const again = await consume(token, 'yet-another-long-passphrase');
    expect(again.status).toBe(409);
    expect(await refusal(again)).toMatchObject({ code: 'conflict', details: { reason: 'used' } });
    // The second password did not take.
    expect((await signIn(h.app, 'grace@example.test', 'yet-another-long-passphrase')).status).toBe(
      401,
    );
  });

  it('refuses an expired link 409 expired, and changes nothing', async () => {
    const grace = await join('grace@example.test', 'member');
    const token = await issueToken(grace.id);
    h.db
      .update(passwordResets)
      .set({ expiresAt: Date.now() - 1 })
      .run();

    const res = await consume(token);
    expect(res.status).toBe(409);
    expect(await refusal(res)).toMatchObject({ code: 'conflict', details: { reason: 'expired' } });
    expect((await signIn(h.app, 'grace@example.test', PASSWORD)).status).toBe(200);
    expect(h.db.select().from(passwordResets).get()?.usedAt).toBeNull();
  });

  it('refuses a link a newer one replaced, 409 revoked', async () => {
    const grace = await join('grace@example.test', 'member');
    const first = await issueToken(grace.id);
    const second = await issueToken(grace.id);

    const res = await consume(first);
    expect(res.status).toBe(409);
    expect((await refusal(res)).details?.reason).toBe('revoked');
    expect((await consume(second)).status).toBe(200);
  });

  it('404s a token that matches nothing', async () => {
    const res = await consume('not-a-real-token');
    expect(res.status).toBe(404);
    expect(await refusal(res)).toMatchObject({ code: 'not_found', details: { reason: 'unknown' } });
  });

  it('403s a link for somebody deactivated since it was issued', async () => {
    const grace = await join('grace@example.test', 'member');
    const token = await issueToken(grace.id);
    h.db.update(users).set({ isActive: 0 }).where(eq(users.id, grace.id)).run();

    const res = await consume(token);
    expect(res.status).toBe(403);
    expect((await refusal(res)).details?.reason).toBe('inactive');
  });

  it('validates the password as setup does: under 12 is 422 and the link survives', async () => {
    const grace = await join('grace@example.test', 'member');
    const token = await issueToken(grace.id);

    expect((await consume(token, 'too-short')).status).toBe(422);
    expect((await consume(token)).status).toBe(200);
  });
});

describe('throttled like sign-in (§6.1)', () => {
  it('backs off after the free attempts, with retry_after_seconds, and says nothing of which links exist', async () => {
    for (let i = 0; i < FREE_ATTEMPTS; i++) {
      expect((await consume(`guess-${String(i)}`)).status).toBe(404);
    }

    const res = await consume('guess-next');
    expect(res.status).toBe(429);
    const error = await refusal(res);
    expect(error.code).toBe('rate_limited');
    expect(error.details?.retry_after_seconds).toBeGreaterThan(0);
  });

  it('keeps one person’s failed link from slowing another’s', async () => {
    const grace = await join('grace@example.test', 'member');
    const hedy = await join('hedy@example.test', 'member');
    const graces = await issueToken(grace.id);
    expect((await consume(graces)).status).toBe(200);
    for (let i = 0; i < FREE_ATTEMPTS; i++) expect((await consume(graces)).status).toBe(409);
    expect((await consume(graces)).status).toBe(429);

    const hedys = await issueToken(hedy.id);
    expect((await consume(hedys)).status).toBe(200);
  });

  it('does not count a too-short password as an attempt', async () => {
    const grace = await join('grace@example.test', 'member');
    const token = await issueToken(grace.id);
    for (let i = 0; i < FREE_ATTEMPTS + 2; i++) {
      expect((await consume(token, 'short')).status).toBe(422);
    }
    expect((await consume(token)).status).toBe(200);
  });

  it('clears after the delay', async () => {
    for (let i = 0; i <= FREE_ATTEMPTS; i++) await consume(`guess-${String(i)}`);
    expect((await consume('guess-again')).status).toBe(429);

    clock += 16 * 60 * 1000;
    expect((await consume('guess-again')).status).toBe(404);
  });
});
