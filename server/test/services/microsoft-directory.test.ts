/**
 * Every enabled Member of the Microsoft directory as a Laika member (LAI-1239).
 *
 * Graph is never called: `fetch` is a fake that answers the token endpoint
 * and the `/users` pages, and records what it was asked, so the request
 * shape — client credentials, the advanced-query header, the filter — is
 * asserted, not assumed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { type MicrosoftSso } from '../../src/auth/sso.ts';
import { activity, users } from '../../src/db/schema.ts';
import { readEnv } from '../../src/env.ts';
import {
  addDirectoryMembers,
  DirectoryError,
  memberOf,
  readDirectory,
  runDirectorySync,
} from '../../src/services/microsoft-directory.ts';
import { seedOrg } from '../helpers/auth.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const SSO: MicrosoftSso = {
  provider: 'microsoft',
  clientId: '11111111-2222-3333-4444-555555555555',
  clientSecret: 'the-client-secret',
  tenantId: TENANT,
  directorySync: true,
};
const NOW = 1_800_000_000_000;
const GRAPH = 'https://graph.microsoft.com/v1.0';

const member = (id: string, mail: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: `Person ${id}`,
  mail,
  userPrincipalName: mail ?? `${id}@kvelld.onmicrosoft.com`,
  accountEnabled: true,
  userType: 'Member',
  ...extra,
});

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A Graph that answers a token and then the given pages, in order. */
function fakeGraph(
  pages: readonly unknown[][],
  options: { tokenStatus?: number; usersStatus?: number } = {},
) {
  const calls: Call[] = [];
  let page = 0;
  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.includes('/oauth2/v2.0/token')) {
      const status = options.tokenStatus ?? 200;
      return Promise.resolve(
        new Response(JSON.stringify(status === 200 ? { access_token: 'graph-token' } : {}), {
          status,
        }),
      );
    }
    if (options.usersStatus !== undefined) {
      return Promise.resolve(new Response('{}', { status: options.usersStatus }));
    }
    const value = pages[page] ?? [];
    page += 1;
    const next = page < pages.length ? `${GRAPH}/users?$skiptoken=p${String(page)}` : undefined;
    return Promise.resolve(
      new Response(JSON.stringify({ value, ...(next ? { '@odata.nextLink': next } : {}) }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

let t: TestDb;
beforeEach(() => {
  t = freshDb();
});
afterEach(() => {
  t.close();
});

describe('reading the directory through Graph', () => {
  it('asks for the app’s own token, then every page of enabled Members', async () => {
    const { fetchImpl, calls } = fakeGraph([
      [member('a', 'Ada@Kvelld.co.za'), member('b', 'bo@kvelld.co.za')],
      [member('c', null)],
    ]);
    const members = await readDirectory(SSO, { fetch: fetchImpl });

    expect(members.map((m) => m.email)).toEqual([
      'ada@kvelld.co.za',
      'bo@kvelld.co.za',
      'c@kvelld.onmicrosoft.com',
    ]);

    const token = calls[0];
    expect(token?.url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    const form = new URLSearchParams(token?.init?.body as string);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('https://graph.microsoft.com/.default');
    expect(form.get('client_id')).toBe(SSO.clientId);

    const first = calls[1];
    const url = new URL(first?.url ?? '');
    expect(url.pathname).toBe('/v1.0/users');
    expect(url.searchParams.get('$filter')).toBe("accountEnabled eq true and userType eq 'Member'");
    expect(url.searchParams.get('$count')).toBe('true');
    const headers = first?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer graph-token');
    expect(headers.ConsistencyLevel).toBe('eventual');
    // The second page is the nextLink Graph gave, followed as given.
    expect(calls[2]?.url).toBe(`${GRAPH}/users?$skiptoken=p1`);
  });

  it('keeps out guests and disabled accounts even if Graph sent them', () => {
    expect(memberOf(member('g', 'guest@other.com', { userType: 'Guest' }))).toBeNull();
    expect(memberOf(member('d', 'gone@kvelld.co.za', { accountEnabled: false }))).toBeNull();
    expect(
      memberOf(
        member('x', null, { userPrincipalName: 'guest_other.com#EXT#@kvelld.onmicrosoft.com' }),
      ),
    ).toBeNull();
    expect(memberOf(member('ok', 'ok@kvelld.co.za'))?.email).toBe('ok@kvelld.co.za');
  });

  it('says what an operator can fix when User.Read.All is not granted', async () => {
    const { fetchImpl } = fakeGraph([], { usersStatus: 403 });
    await expect(readDirectory(SSO, { fetch: fetchImpl })).rejects.toThrow(
      'graph_forbidden_grant_user_read_all',
    );
  });

  it('a refused token is a code, never the secret', async () => {
    const { fetchImpl } = fakeGraph([], { tokenStatus: 401 });
    let message = '';
    try {
      await readDirectory(SSO, { fetch: fetchImpl });
    } catch (err) {
      expect(err).toBeInstanceOf(DirectoryError);
      message = (err as Error).message;
    }
    expect(message).toBe('microsoft directory: token_401');
    expect(message).not.toContain(SSO.clientSecret);
  });
});

describe('adding the directory’s members to Laika', () => {
  it('adds the new ones as members with no password, and leaves everyone else alone', () => {
    const { ownerId } = seedOrg(t.db, true);
    const result = addDirectoryMembers(
      t.db,
      [
        { id: 'a', name: 'Ada', email: 'ada@kvelld.co.za' },
        // The owner seedOrg made, by another spelling of the same address.
        { id: 'o', name: 'Someone Else', email: 'Existing-Owner@example.test'.toLowerCase() },
      ],
      NOW,
    );
    expect(result).toEqual({ added: 1, existing: 1 });

    const ada = t.db.select().from(users).where(eq(users.email, 'ada@kvelld.co.za')).get();
    expect(ada?.orgRole).toBe('member');
    expect(ada?.isActive).toBe(1);
    // The owner is untouched: not renamed, not re-roled.
    const owner = t.db.select().from(users).where(eq(users.id, ownerId)).get();
    expect(owner?.name).toBe('Existing Owner');
    expect(owner?.orgRole).toBe('owner');

    const added = t.db.select().from(activity).where(eq(activity.type, 'member.added')).all();
    expect(added).toHaveLength(1);
    expect(added[0]?.actorKind).toBe('system');
    expect(JSON.parse(added[0]?.payloadJson ?? '{}')).toMatchObject({
      user_id: ada?.id,
      org_role: 'member',
      via: 'microsoft_directory',
    });
  });

  it('a second run adds nobody twice', () => {
    seedOrg(t.db, true);
    const people = [{ id: 'a', name: 'Ada', email: 'ada@kvelld.co.za' }];
    addDirectoryMembers(t.db, people, NOW);
    expect(addDirectoryMembers(t.db, people, NOW + 1)).toEqual({ added: 0, existing: 1 });
  });

  it('adds nobody before first boot — there is no org yet', () => {
    expect(
      addDirectoryMembers(t.db, [{ id: 'a', name: 'Ada', email: 'ada@kvelld.co.za' }], NOW),
    ).toEqual({ added: 0, existing: 0 });
    expect(t.db.select().from(users).all()).toEqual([]);
  });

  it('does nothing at all unless directory sync is switched on', async () => {
    seedOrg(t.db, true);
    const { fetchImpl, calls } = fakeGraph([[member('a', 'ada@kvelld.co.za')]]);
    await runDirectorySync(t.db, { ...SSO, directorySync: false }, { fetch: fetchImpl });
    await runDirectorySync(t.db, null, { fetch: fetchImpl });
    expect(calls).toEqual([]);

    const result = await runDirectorySync(t.db, SSO, { fetch: fetchImpl, now: () => NOW });
    expect(result.added).toBe(1);
  });
});

describe('LAIKA_MICROSOFT_DIRECTORY_SYNC', () => {
  const base = {
    NODE_ENV: 'test',
    LAIKA_SECRET: 'x'.repeat(40),
    LAIKA_PUBLIC_URL: 'http://localhost:3000',
    LAIKA_MICROSOFT_CLIENT_ID: SSO.clientId,
    LAIKA_MICROSOFT_CLIENT_SECRET: SSO.clientSecret,
    LAIKA_MICROSOFT_TENANT_ID: TENANT,
  };

  it('is off unless it says true', () => {
    expect(readEnv(base).sso?.directorySync).toBe(false);
    expect(readEnv({ ...base, LAIKA_MICROSOFT_DIRECTORY_SYNC: 'false' }).sso?.directorySync).toBe(
      false,
    );
    expect(readEnv({ ...base, LAIKA_MICROSOFT_DIRECTORY_SYNC: 'TRUE' }).sso?.directorySync).toBe(
      true,
    );
  });

  it('refuses anything else, and refuses to run without SSO', () => {
    expect(() => readEnv({ ...base, LAIKA_MICROSOFT_DIRECTORY_SYNC: 'yes' })).toThrow(
      /LAIKA_MICROSOFT_DIRECTORY_SYNC.*true or false/,
    );
    expect(() =>
      readEnv({
        NODE_ENV: 'test',
        LAIKA_SECRET: 'x'.repeat(40),
        LAIKA_PUBLIC_URL: 'http://localhost:3000',
        LAIKA_MICROSOFT_DIRECTORY_SYNC: 'true',
      }),
    ).toThrow(/LAIKA_MICROSOFT_DIRECTORY_SYNC.*needs Microsoft SSO/);
  });
});
