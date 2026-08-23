import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  seedInvite,
  seedOrg,
  setCookieHeaders,
  signIn,
  signUp,
} from '../helpers/auth.ts';

let h: AuthHarness;

beforeEach(() => {
  h = authHarness();
});
afterEach(() => {
  h.close();
});

const PASSWORD = 'correct-horse-battery-staple';

describe('sign-in → /me → sign-out (LAI-005 AC8)', () => {
  it('walks the whole session lifecycle', async () => {
    // No org row yet, so signup is open — LAI-009 is what creates the org.
    const created = await signUp(h.app, { email: 'ada@example.test', password: PASSWORD });
    expect(created.status).toBe(200);

    const signedIn = await signIn(h.app, 'ada@example.test', PASSWORD);
    expect(signedIn.status).toBe(200);

    const cookie = cookieFrom(signedIn);
    expect(cookie).not.toBe('');

    const me = await h.app.request('/api/v1/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);

    const body = (await me.json()) as Record<string, unknown>;
    expect(body.email).toBe('ada@example.test');
    expect(body.org_role).toBe('member');
    expect(body.is_active).toBe(true);
    expect(body.memberships).toEqual([]);

    const signedOut = await h.app.request('/api/v1/auth/sign-out', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
    });
    expect(signedOut.status).toBe(200);

    // Server-side invalidation: the same cookie must stop working.
    const after = await h.app.request('/api/v1/me', { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });

  it('returns the §6.3 envelope on an anonymous /me', async () => {
    const res = await h.app.request('/api/v1/me');

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('unauthorized');
    expect('details' in body.error).toBe(true);
  });

  it('treats a garbage cookie as anonymous rather than as an error', async () => {
    const res = await h.app.request('/api/v1/me', {
      headers: { Cookie: 'better-auth.session_token=not-a-real-token' },
    });

    expect(res.status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    await signUp(h.app, { email: 'ada@example.test', password: PASSWORD });

    const res = await signIn(h.app, 'ada@example.test', 'wrong-password-entirely');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('session cookie attributes (SPEC §6.1)', () => {
  it('is HttpOnly, SameSite=Lax, and not Secure on localhost', async () => {
    await signUp(h.app, { email: 'ada@example.test', password: PASSWORD });
    const res = await signIn(h.app, 'ada@example.test', PASSWORD);

    const cookies = setCookieHeaders(res);
    expect(cookies.length).toBeGreaterThan(0);

    const session = cookies.find((c) => c.includes('session_token'));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    // secureCookies:false in the harness — a Secure cookie over plain HTTP is
    // simply dropped by the browser, which makes local development impossible.
    expect(session).not.toMatch(/Secure/i);
  });

  it('never puts the password anywhere in the response', async () => {
    const res = await signUp(h.app, { email: 'ada@example.test', password: PASSWORD });
    const raw = await res.text();

    expect(raw).not.toContain(PASSWORD);
    expect(raw.toLowerCase()).not.toContain('argon');
  });
});

describe('invite-only signup (SPEC §4.2, D-004, AC4)', () => {
  it('rejects signup with no invite when the org is invite-only', async () => {
    seedOrg(h.db, true);

    const res = await signUp(h.app, { email: 'stranger@example.test', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/invite/i);
  });

  it('accepts signup with a valid invite', async () => {
    const { orgId, ownerId } = seedOrg(h.db, true);
    const token = seedInvite(h.db, { orgId, createdBy: ownerId });

    const res = await signUp(h.app, {
      email: 'invited@example.test',
      password: PASSWORD,
      inviteToken: token,
    });

    expect(res.status).toBe(200);
  });

  it('rejects an expired invite', async () => {
    const { orgId, ownerId } = seedOrg(h.db, true);
    const token = seedInvite(h.db, { orgId, createdBy: ownerId, expiresAt: Date.now() - 1000 });

    const res = await signUp(h.app, {
      email: 'late@example.test',
      password: PASSWORD,
      inviteToken: token,
    });

    expect(res.status).toBe(403);
  });

  it('rejects an invite addressed to a different email', async () => {
    const { orgId, ownerId } = seedOrg(h.db, true);
    const token = seedInvite(h.db, { orgId, createdBy: ownerId, email: 'intended@example.test' });

    const res = await signUp(h.app, {
      email: 'someone-else@example.test',
      password: PASSWORD,
      inviteToken: token,
    });

    expect(res.status).toBe(403);
  });

  it('accepts a link invite (no email) from anyone holding the token', async () => {
    const { orgId, ownerId } = seedOrg(h.db, true);
    const token = seedInvite(h.db, { orgId, createdBy: ownerId, email: null });

    const res = await signUp(h.app, {
      email: 'anyone@example.test',
      password: PASSWORD,
      inviteToken: token,
    });

    expect(res.status).toBe(200);
  });

  it('rejects a made-up invite token', async () => {
    seedOrg(h.db, true);

    const res = await signUp(h.app, {
      email: 'forger@example.test',
      password: PASSWORD,
      inviteToken: 'inv_completely-made-up',
    });

    expect(res.status).toBe(403);
  });

  it('allows open signup when the org has invite_only = 0', async () => {
    seedOrg(h.db, false);

    const res = await signUp(h.app, { email: 'open@example.test', password: PASSWORD });

    expect(res.status).toBe(200);
  });
});

describe('signup cannot grant itself privilege', () => {
  it('ignores an org_role smuggled into the signup body', async () => {
    const res = await h.app.request('/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email: 'sneaky@example.test',
        password: PASSWORD,
        name: 'Sneaky',
        orgRole: 'owner',
        isActive: 1,
      }),
    });

    // The signup succeeds and the smuggled fields are dropped: `input: false`
    // on the additional fields keeps them off the public payload, so a caller
    // cannot set their own role no matter what they send.
    expect(res.status).toBe(200);

    const signedIn = await signIn(h.app, 'sneaky@example.test', PASSWORD);
    const me = await h.app.request('/api/v1/me', { headers: { Cookie: cookieFrom(signedIn) } });
    const body = (await me.json()) as { org_role: string; is_active: boolean };

    expect(body.org_role).toBe('member');
    expect(body.is_active).toBe(true);
  });

  it('lands a legitimate signup on org_role member, never higher', async () => {
    await signUp(h.app, { email: 'plain@example.test', password: PASSWORD });

    const signedIn = await signIn(h.app, 'plain@example.test', PASSWORD);
    const me = await h.app.request('/api/v1/me', { headers: { Cookie: cookieFrom(signedIn) } });
    const body = (await me.json()) as { org_role: string };

    expect(body.org_role).toBe('member');
  });
});
