/**
 * Microsoft SSO (LAI-1238): one Entra ID tenant, SSO-only when configured,
 * invited people only.
 *
 * The Microsoft round trip itself cannot run here — it needs Microsoft — so
 * the tests drive the pieces that decide everything around it, with a real
 * database and a real better-auth: the env contract, the endpoints that must
 * refuse, first boot without a password, and the hooks every social sign-in
 * passes through (called exactly as better-auth calls them, with the request
 * context's `path`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseMicrosoftSso, tenantProblem, type MicrosoftSso } from '../../src/auth/sso.ts';
import { readEnv, EnvError } from '../../src/env.ts';
import { invites, orgs, users } from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';
import {
  authHarness,
  jsonHeaders,
  seedInvite,
  seedOrg,
  signIn,
  signUp,
  type AuthHarness,
} from '../helpers/auth.ts';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const SSO: MicrosoftSso = {
  provider: 'microsoft',
  clientId: '11111111-2222-3333-4444-555555555555',
  clientSecret: 'a-client-secret-value',
  tenantId: TENANT,
  directorySync: false,
  meetingsSync: false,
};
const ENV_BASE = {
  NODE_ENV: 'test',
  LAIKA_SECRET: 'x'.repeat(40),
  LAIKA_PUBLIC_URL: 'http://localhost:3000',
} as const;

/** A social sign-in's request context, as better-auth hands it to a database hook. */
const CALLBACK = { path: '/callback/:id' };

let h: AuthHarness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
});

function sso(): AuthHarness {
  h = authHarness({ sso: SSO });
  return h;
}

/** The hooks better-auth runs, from the configured instance itself. */
function hooks(harness: AuthHarness) {
  const db = harness.auth.options.databaseHooks;
  if (db?.user?.create?.before === undefined || db.user.create.after === undefined) {
    throw new Error('the user.create hooks are not configured');
  }
  if (db.session?.create?.before === undefined) {
    throw new Error('the session.create hook is not configured');
  }
  return {
    userBefore: db.user.create.before,
    userAfter: db.user.create.after,
    sessionBefore: db.session.create.before,
  };
}

function newUser(email: string) {
  const now = new Date();
  return {
    id: newId(),
    email,
    name: 'New Person',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The code a hook refuses with. A better-auth `APIError` carries it on
 * `body.code`; the hooks throw before they return a promise, so the call is
 * made in here, inside the `try`.
 */
async function codeOf(call: () => unknown): Promise<string | undefined> {
  try {
    await call();
  } catch (err) {
    return (err as { body?: { code?: string } }).body?.code ?? 'no code';
  }
  return undefined;
}

describe('the env contract: all three LAIKA_MICROSOFT_* or none', () => {
  it('none set is password sign-in', () => {
    expect(parseMicrosoftSso({})).toEqual({ sso: null });
    expect(readEnv({ ...ENV_BASE }).sso).toBeNull();
  });

  it('all three set is Microsoft, with the values trimmed', () => {
    const env = readEnv({
      ...ENV_BASE,
      LAIKA_MICROSOFT_CLIENT_ID: ` ${SSO.clientId} `,
      LAIKA_MICROSOFT_CLIENT_SECRET: SSO.clientSecret,
      LAIKA_MICROSOFT_TENANT_ID: TENANT,
    });
    expect(env.sso).toEqual(SSO);
  });

  it('a partial set refuses to start, naming the missing variable', () => {
    expect(() =>
      readEnv({
        ...ENV_BASE,
        LAIKA_MICROSOFT_CLIENT_ID: SSO.clientId,
        LAIKA_MICROSOFT_TENANT_ID: TENANT,
      }),
    ).toThrow(/LAIKA_MICROSOFT_CLIENT_SECRET/);
  });

  it('never echoes the client secret into the error', () => {
    let message = '';
    try {
      readEnv({ ...ENV_BASE, LAIKA_MICROSOFT_CLIENT_SECRET: 'super-secret-value' });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      message = (err as Error).message;
    }
    expect(message).toMatch(/LAIKA_MICROSOFT_CLIENT_ID/);
    expect(message).not.toContain('super-secret-value');
  });

  it.each(['common', 'organizations', 'consumers', 'Common'])(
    'refuses the multi-tenant endpoint %s',
    (tenant) => {
      expect(tenantProblem(tenant)).toMatch(/any Microsoft tenant/);
      expect(() =>
        readEnv({
          ...ENV_BASE,
          LAIKA_MICROSOFT_CLIENT_ID: SSO.clientId,
          LAIKA_MICROSOFT_CLIENT_SECRET: SSO.clientSecret,
          LAIKA_MICROSOFT_TENANT_ID: tenant,
        }),
      ).toThrow(/LAIKA_MICROSOFT_TENANT_ID.*any Microsoft tenant/);
    },
  );

  it('takes a tenant GUID or a verified domain, and nothing else', () => {
    expect(tenantProblem(TENANT)).toBeNull();
    expect(tenantProblem('contoso.onmicrosoft.com')).toBeNull();
    expect(tenantProblem('kvelld.co.za')).toBeNull();
    expect(tenantProblem('not a tenant')).toMatch(/not a tenant id/);
    expect(tenantProblem('')).toMatch(/not a tenant id/);
  });
});

describe('an SSO-only instance refuses every password path', () => {
  it('better-auth’s email sign-in and sign-up answer sso_only, in words', async () => {
    const harness = sso();
    seedOrg(harness.db, true);

    const signInRes = await signIn(harness.app, 'existing-owner@example.test', 'a-long-password-1');
    expect(signInRes.status).toBe(403);
    expect(await signInRes.text()).toMatch(/signs in with Microsoft only/);

    const signUpRes = await signUp(harness.app, {
      email: 'someone@example.test',
      password: 'a-long-password-1',
    });
    expect(signUpRes.status).toBe(403);
    expect(await signUpRes.text()).toMatch(/signs in with Microsoft only/);
  });

  it.each([
    ['/api/v1/invites/accept', { token: 'inv_x', name: 'A', password: 'a-long-password-1' }],
    ['/api/v1/password-resets/consume', { token: 'r', password: 'a-long-password-1' }],
  ])('%s answers 403 sso_only', async (path, body) => {
    const harness = sso();
    seedOrg(harness.db, true);
    const res = await harness.app.request(path, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { details: { reason?: string }; message: string } };
    expect(json.error.details.reason).toBe('sso_only');
    expect(json.error.message).toMatch(/Microsoft only/);
  });

  it('a password instance still signs in with a password (the control)', async () => {
    h = authHarness();
    // Set up first (the API answers 409 until then), and open, so no invite is needed.
    seedOrg(h.db, false);
    await signUp(h.app, { email: 'first@example.test', password: 'a-long-password-1' });
    const res = await signIn(h.app, 'first@example.test', 'a-long-password-1');
    expect(res.status).toBe(200);
  });
});

describe('GET /setup/status says how people sign in', () => {
  it('microsoft on an SSO instance', async () => {
    const harness = sso();
    const body = (await (await harness.app.request('/api/v1/setup/status')).json()) as {
      sign_in: string;
    };
    expect(body.sign_in).toBe('microsoft');
  });

  it('email otherwise — never the word "password" in this public body (setup.test.ts)', async () => {
    h = authHarness();
    const body = (await (await h.app.request('/api/v1/setup/status')).json()) as {
      sign_in: string;
    };
    expect(body.sign_in).toBe('email');
  });
});

describe('first boot on an SSO-only instance', () => {
  const setup = {
    org_name: 'Kvelld',
    owner_name: 'Ada Owner',
    owner_email: 'Ada@Kvelld.example',
  };

  it('creates the org and its owner with no password and no session', async () => {
    const harness = sso();
    const res = await harness.app.request('/api/v1/setup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(setup),
    });
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()).toEqual([]);

    const owner = harness.db
      .select()
      .from(users)
      .where(eq(users.email, 'ada@kvelld.example'))
      .get();
    expect(owner?.orgRole).toBe('owner');
    expect(harness.db.select().from(orgs).get()?.ownerUserId).toBe(owner?.id);
  });

  it('refuses a password sent anyway', async () => {
    const harness = sso();
    const res = await harness.app.request('/api/v1/setup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...setup, owner_password: 'a-long-password-1' }),
    });
    expect(res.status).toBe(422);
    expect(harness.db.select().from(users).all()).toEqual([]);
  });
});

describe('a Microsoft sign-in joins only with an invite for that address', () => {
  it('refuses a new address with no invite waiting', async () => {
    const harness = sso();
    seedOrg(harness.db, true);
    const { userBefore } = hooks(harness);
    expect(
      await codeOf(() => userBefore(newUser('stranger@example.test'), CALLBACK as never)),
    ).toBe('invite_required');
  });

  it('does not honour a link invite, which nobody presented', async () => {
    const harness = sso();
    const { orgId, ownerId } = seedOrg(harness.db, true);
    seedInvite(harness.db, { orgId, createdBy: ownerId, email: null });
    const { userBefore } = hooks(harness);
    expect(await codeOf(() => userBefore(newUser('anyone@example.test'), CALLBACK as never))).toBe(
      'invite_required',
    );
  });

  it('refuses an expired invite', async () => {
    const harness = sso();
    const { orgId, ownerId } = seedOrg(harness.db, true);
    seedInvite(harness.db, {
      orgId,
      createdBy: ownerId,
      email: 'late@example.test',
      expiresAt: Date.now() - 1000,
    });
    const { userBefore } = hooks(harness);
    expect(await codeOf(() => userBefore(newUser('late@example.test'), CALLBACK as never))).toBe(
      'invite_required',
    );
  });

  it('never spends an owner invite', async () => {
    const harness = sso();
    const { orgId, ownerId } = seedOrg(harness.db, true);
    seedInvite(harness.db, {
      orgId,
      createdBy: ownerId,
      email: 'boss@example.test',
      orgRole: 'owner',
    });
    const { userBefore } = hooks(harness);
    expect(await codeOf(() => userBefore(newUser('boss@example.test'), CALLBACK as never))).toBe(
      'use_transfer',
    );
  });

  it('admits the invited address, case-insensitively, and spends the invite with its role', async () => {
    const harness = sso();
    const { orgId, ownerId } = seedOrg(harness.db, true);
    seedInvite(harness.db, {
      orgId,
      createdBy: ownerId,
      email: 'new.admin@example.test',
      orgRole: 'admin',
    });
    const { userBefore, userAfter } = hooks(harness);

    const user = newUser('New.Admin@Example.test');
    const result = (await userBefore(user, CALLBACK as never)) as { data: { email: string } };
    expect(result.data.email).toBe('new.admin@example.test');

    // better-auth writes the row between the two hooks.
    harness.db
      .insert(users)
      .values({ ...user, email: result.data.email, orgRole: 'member', emailVerified: true })
      .run();
    await userAfter({ ...user, email: result.data.email }, CALLBACK as never);

    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()?.orgRole).toBe(
      'admin',
    );
    const invite = harness.db.select().from(invites).get();
    expect(invite?.acceptedBy).toBe(user.id);
  });

  it('leaves internal creation alone — first boot has no request behind it', async () => {
    const harness = sso();
    const { userBefore } = hooks(harness);
    const result = (await userBefore(newUser('owner@example.test'), undefined as never)) as {
      data: { email: string };
    };
    expect(result.data.email).toBe('owner@example.test');
  });

  it('a password instance is not gated this way (the control)', async () => {
    h = authHarness();
    seedOrg(h.db, true);
    const { userBefore } = hooks(h);
    const result = (await userBefore(newUser('anyone@example.test'), CALLBACK as never)) as {
      data: { email: string };
    };
    expect(result.data.email).toBe('anyone@example.test');
  });
});

describe('an existing person links their Microsoft account by email', () => {
  /*
   * Found against a real tenant (account_not_linked): better-auth links only
   * when the local email is verified, and Laika verifies none. The link
   * itself runs in Microsoft's callback, which cannot run here, so the
   * options better-auth reads at that moment are what is asserted.
   */
  it('trusts Microsoft and does not wait on a local verification Laika never does', () => {
    const harness = sso();
    expect(harness.auth.options.account?.accountLinking).toMatchObject({
      enabled: true,
      trustedProviders: ['microsoft'],
      allowDifferentEmails: false,
      requireLocalEmailVerified: false,
    });
  });

  it('links nothing on a password instance (the control)', () => {
    h = authHarness();
    expect(h.auth.options.account?.accountLinking?.enabled).toBe(false);
  });
});

describe('a deactivated account gets no session from Microsoft', () => {
  it('refuses the session, and allows an active one', async () => {
    const harness = sso();
    const { ownerId } = seedOrg(harness.db, true);
    const { sessionBefore } = hooks(harness);
    const session = {
      id: newId(),
      userId: ownerId,
      token: 't',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await expect(sessionBefore(session as never)).resolves.toBeDefined();

    harness.db.update(users).set({ isActive: 0 }).where(eq(users.id, ownerId)).run();
    expect(await codeOf(() => sessionBefore(session as never))).toBe('forbidden');
  });
});
