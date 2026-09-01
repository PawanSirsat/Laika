import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.ts';
import { type AuthHarness, authHarness, cookieFrom, jsonHeaders } from '../helpers/auth.ts';

/**
 * A deactivated account stops at authentication (§4.1, §6.1, LAI-442).
 *
 * `can()` already denies a deactivated user everything (§3.3 rule 3), and every
 * route was relying on that. It works — and it answers the **wrong shape**: a
 * filter that denies each project in turn returns `200 []`, and *"you have no
 * projects"* is a different claim from *"your account is switched off"*.
 *
 * `GET /me` was the only endpoint that said the true thing, because it looked at
 * the field directly. Now the resolver does, once, for everybody.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let cookie: string;
let ownerId: string;

beforeEach(async () => {
  h = authHarness();
  const res = await h.app.request('/api/v1/setup', {
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
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()?.id ?? '';
});
afterEach(() => {
  h.close();
});

function deactivate(): void {
  // Directly, because the API refuses to deactivate the last Owner (LAI-222) —
  // and that invariant is not what this test is about.
  h.db.update(users).set({ isActive: 0 }).where(eq(users.id, ownerId)).run();
}

async function get(path: string): Promise<Response> {
  return h.app.request(path, { headers: jsonHeaders({ Cookie: cookie }) });
}

describe('an existing session stops working immediately', () => {
  it('answers 403 on GET /api/v1/projects, not 200 with an empty list', async () => {
    // **The regression this task exists to remove.** `can()` denies each project
    // in turn, so the filter empties and the response looks correct — an org
    // admin being told they belong to nothing.
    expect((await get('/api/v1/projects')).status).toBe(200);

    deactivate();

    const res = await get('/api/v1/projects');
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/deactivated/i);
  });

  it('answers the same way everywhere, not only on /me', async () => {
    deactivate();

    for (const path of ['/api/v1/me', '/api/v1/projects', '/api/v1/users', '/api/v1/org']) {
      const res = await get(path);

      // One authority, called everywhere — §3.3 rule 1's argument for `can()`,
      // applied to authentication, where there was none.
      expect(res.status, path).toBe(403);
      expect(await res.text(), path).toMatch(/deactivated/i);
    }
  });

  it('is refused at the resolver, so a route needs no check of its own', async () => {
    deactivate();

    // `/health` is unauthenticated and must keep working: the refusal belongs to
    // requests that present a credential, not to the process.
    expect((await h.app.request('/api/v1/health')).status).toBe(200);
    expect((await get('/api/v1/projects')).status).toBe(403);
  });
});

describe('signing in', () => {
  async function signIn(password: string): Promise<Response> {
    return h.app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'ada@example.test', password }),
    });
  }

  it('refuses a deactivated account and issues no session', async () => {
    deactivate();

    const res = await signIn(PASSWORD);

    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/deactivated/i);
    // The session better-auth minted is discarded with the response.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('still succeeds while the account is active', async () => {
    const res = await signIn(PASSWORD);

    // The other half: asserting only the refusal passes against an
    // implementation that refuses everybody.
    expect(res.status).toBe(200);
  });

  it('does not become an account-existence oracle', async () => {
    deactivate();

    // A **wrong** password on a deactivated account answers exactly as a wrong
    // password does on any account — the check runs *after* better-auth has
    // verified the credential, so only somebody who already proved they hold it
    // learns the account is switched off (LAI-219's property, kept).
    const wrongOnDeactivated = await signIn('not-the-password-at-all');
    const wrongOnUnknown = await h.app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'nobody@example.test', password: 'not-the-password-at-all' }),
    });

    expect(wrongOnDeactivated.status).toBe(wrongOnUnknown.status);
    expect(wrongOnDeactivated.status).not.toBe(403);
  });
});

describe('reactivation restores an unexpired session', () => {
  it('without a new sign-in', async () => {
    deactivate();
    expect((await get('/api/v1/projects')).status).toBe(403);

    h.db.update(users).set({ isActive: 1 }).where(eq(users.id, ownerId)).run();

    // **Decided, not discovered.** `loadActor` reads `is_active` from the row on
    // every request rather than trusting the session payload, so deactivation
    // takes effect immediately — and reactivation does too, by the same
    // mechanism. Requiring a fresh sign-in would mean invalidating the session,
    // which nothing does and which would make the two directions asymmetric for
    // no reason a person could act on.
    expect((await get('/api/v1/projects')).status).toBe(200);
  });
});

describe('the token path keeps its own answer', () => {
  it('401s a deactivated user’s token, where a cookie gets 403', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'agent', scope: 'full' }),
    });
    expect(minted.status).toBe(201);
    const { secret } = (await minted.json()) as { secret: string };

    deactivate();

    const viaToken = await h.app.request('/api/v1/projects', {
      headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
    });
    const viaCookie = await get('/api/v1/projects');

    // **Converged in place, not in status, and the difference is real.** A
    // refused token is a bad credential — 401. A valid cookie belonging to a
    // deactivated person is a *good* credential whose holder may do nothing —
    // 403. Both now stop at the resolver, which is what had to converge.
    expect(viaToken.status).toBe(401);
    expect(viaCookie.status).toBe(403);
  });

  it('says nothing in the body about why the token was refused', async () => {
    const minted = await h.app.request('/api/v1/tokens', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: JSON.stringify({ name: 'agent', scope: 'full' }),
    });
    const { secret } = (await minted.json()) as { secret: string };
    deactivate();

    const res = await h.app.request('/api/v1/projects', {
      headers: jsonHeaders({ Authorization: `Bearer ${secret}` }),
    });

    // Unchanged from before this task: the reason is logged, never returned,
    // because distinguishing unknown from expired from revoked is free
    // information about other people's tokens (`resolve-actor.ts`).
    expect(await res.text()).not.toMatch(/deactivated|inactive/i);
  });
});
