import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MicrosoftSso } from '../../../src/auth/sso.ts';
import { newId } from '../../../src/db/ids.ts';
import { orgs, users } from '../../../src/db/schema.ts';
import { resetDirectoryRun } from '../../../src/services/microsoft-directory.ts';
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
import {
  fakeMicrosoft,
  type FakeMicrosoft,
  MS_SSO,
  signInWithMicrosoft,
} from '../../helpers/fake-microsoft.ts';

/**
 * `GET /api/v1/org/sso` and `POST /api/v1/org/sso/directory-sync` (§6.4,
 * LAI-1239, LAI-1317).
 *
 * `services/sso-settings.test.ts` owns the rules; this is that the routes are
 * mounted, that `can()`'s answer and the service's codes reach the wire, and
 * that the body is the shape the web reads. On an SSO instance nobody has a
 * password, so people sign in the way they will in production: through
 * better-auth's Microsoft callback, against a fake tenant behind the global
 * `fetch` that also serves Graph — **no test calls Microsoft**.
 */

const PASSWORD = 'correct-horse-battery-staple';
const SYNC_ON: MicrosoftSso = { ...MS_SSO, directorySync: true };

interface ErrorBody {
  error: { code: string; message: string };
}

interface SsoBody {
  sign_in: string;
  microsoft: {
    tenant_id: string;
    client_id: string;
    redirect_uri: string;
    directory_sync: {
      enabled: boolean;
      every_minutes: number;
      last_run: {
        at: number;
        ok: boolean;
        added: number;
        existing: number;
        error: string | null;
      } | null;
    };
  } | null;
}

let h: AuthHarness;

beforeEach(() => {
  resetDirectoryRun();
});
afterEach(() => {
  vi.unstubAllGlobals();
  h.close();
});

function get(cookie?: string): Promise<Response> {
  return Promise.resolve(
    h.app.request('/api/v1/org/sso', {
      headers: cookie === undefined ? {} : { Cookie: cookie },
    }),
  );
}

function syncNow(cookie: string): Promise<Response> {
  return Promise.resolve(
    h.app.request('/api/v1/org/sso/directory-sync', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: cookie }),
      body: '{}',
    }),
  );
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as ErrorBody).error.code;
}

describe('on a password instance', () => {
  let owner: string;
  let member: string;

  beforeEach(async () => {
    h = authHarness();
    const res = await h.app.request('/api/v1/setup', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        org_name: 'Kvell Dynamics',
        owner_name: 'Ada',
        owner_email: 'ada@example.test',
        owner_password: PASSWORD,
      }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    owner = cookieFrom(res);

    const ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
    const orgId = h.db.select().from(orgs).get()!.id;
    const token = seedInvite(h.db, { orgId, createdBy: ownerId, email: 'mo@example.test' });
    const joined = await signUp(h.app, {
      email: 'mo@example.test',
      password: PASSWORD,
      inviteToken: token,
    });
    expect(joined.status, await joined.clone().text()).toBe(200);
    member = cookieFrom(joined);
  });

  it('GET answers the owner email sign-in and no Microsoft half', async () => {
    const res = await get(owner);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sign_in: 'email', microsoft: null });
  });

  it('refuses a member 403, by can() (org.settings.edit)', async () => {
    const res = await get(member);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('forbidden');

    const sync = await syncNow(member);
    expect(sync.status).toBe(403);
    expect(await codeOf(sync)).toBe('forbidden');
  });

  it('refuses nobody-signed-in 401', async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe('unauthorized');
  });

  it('Sync now is 409 with directory sync off, and says how to turn it on', async () => {
    const res = await syncNow(owner);
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as ErrorBody;
    expect(error.code).toBe('conflict');
    expect(error.message).toMatch(/LAIKA_MICROSOFT_DIRECTORY_SYNC=true/);
  });
});

describe('on a Microsoft SSO instance', () => {
  let ms: FakeMicrosoft;

  /** Sign a seeded person in through Microsoft; the session cookie. */
  async function signInAs(email: string, oid: string): Promise<string> {
    const signedIn = await signInWithMicrosoft(h.app, ms, { email, name: email, oid });
    expect(signedIn.location, 'the Microsoft sign-in ended on an error').toBe('/');
    return signedIn.cookie;
  }

  function start(sso: MicrosoftSso): void {
    ms = fakeMicrosoft(sso);
    vi.stubGlobal('fetch', ms.fetchImpl);
    h = authHarness({ sso });
    // `existing-owner@example.test`, made by first boot's shape.
    seedOrg(h.db, true);
  }

  function seedMember(email: string): void {
    h.db
      .insert(users)
      .values({
        id: newId(),
        email,
        name: 'Mo',
        orgRole: 'member',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }

  it('GET answers what to register in Entra, and never the client secret', async () => {
    start(SYNC_ON);
    const owner = await signInAs('Existing-Owner@example.test', 'oid-owner');

    const res = await get(owner);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(MS_SSO.clientSecret);
    expect(JSON.parse(text) as SsoBody).toEqual({
      sign_in: 'microsoft',
      microsoft: {
        tenant_id: MS_SSO.tenantId,
        client_id: MS_SSO.clientId,
        redirect_uri: `${TEST_ORIGIN}/api/v1/auth/callback/microsoft`,
        directory_sync: { enabled: true, every_minutes: 15, last_run: null },
      },
    });
  });

  it('Sync now adds the directory’s new members and answers the run', async () => {
    start(SYNC_ON);
    const owner = await signInAs('existing-owner@example.test', 'oid-owner');
    ms.users = [
      {
        id: 'graph-1',
        displayName: 'Nomsa Dlamini',
        mail: 'Nomsa.Dlamini@kvelld.co.za',
        userPrincipalName: 'nomsa.dlamini@kvelld.co.za',
        accountEnabled: true,
        userType: 'Member',
      },
      {
        id: 'graph-2',
        displayName: 'Existing Owner',
        mail: 'existing-owner@example.test',
        userPrincipalName: 'existing-owner@example.test',
        accountEnabled: true,
        userType: 'Member',
      },
    ];

    const res = await syncNow(owner);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as SsoBody;
    expect(body.microsoft?.directory_sync.last_run).toMatchObject({
      ok: true,
      added: 1,
      existing: 1,
      error: null,
    });

    const added = h.db
      .select()
      .from(users)
      .where(eq(users.email, 'nomsa.dlamini@kvelld.co.za'))
      .get();
    expect(added?.orgRole).toBe('member');
    // And the GET reads the same run back.
    const after = (await (await get(owner)).json()) as SsoBody;
    expect(after.microsoft?.directory_sync.last_run?.added).toBe(1);
  });

  it('Sync now is 409 when the instance has SSO but not directory sync', async () => {
    start(MS_SSO);
    const owner = await signInAs('existing-owner@example.test', 'oid-owner');

    const res = await syncNow(owner);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('conflict');
    expect(ms.calls.filter((url) => url.includes('graph.microsoft.com'))).toEqual([]);
  });

  it('refuses a member 403 on both, and Graph is never asked', async () => {
    start(SYNC_ON);
    seedMember('mo@kvelld.co.za');
    const member = await signInAs('Mo@kvelld.co.za', 'oid-mo');
    const before = ms.calls.length;

    const res = await get(member);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('forbidden');

    const sync = await syncNow(member);
    expect(sync.status).toBe(403);
    expect(await codeOf(sync)).toBe('forbidden');
    // The sign-in's own token call is all the fake ever saw.
    expect(ms.calls.slice(before)).toEqual([]);
  });
});
