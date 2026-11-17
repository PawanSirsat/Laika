/**
 * A whole Microsoft sign-in, through better-auth's own callback (LAI-1317).
 *
 * `sso.test.ts` drives the hooks one at a time; this drives the round trip a
 * browser makes — `sign-in/social`, then `callback/microsoft` with a code —
 * against a fake tenant behind the global `fetch` (`helpers/fake-microsoft.ts`).
 * Everything after Microsoft's token endpoint is real: better-auth's state
 * check, the link by email, the account row, the session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, users } from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';
import { authHarness, jsonHeaders, seedOrg, type AuthHarness } from '../helpers/auth.ts';
import {
  fakeMicrosoft,
  MS_SSO,
  signInWithMicrosoft,
  type FakeMicrosoft,
} from '../helpers/fake-microsoft.ts';

let h: AuthHarness;
let ms: FakeMicrosoft;
let pawanId: string;

/** How Ksage's people are stored: lowercase, as every write path leaves them (§4.1). */
const LOCAL_EMAIL = 'pawan.sirsat@kvelld.co.za';
/** How Microsoft may spell the same mailbox. */
const ASSERTED_EMAIL = 'Pawan.Sirsat@kvelld.co.za';
const PAWAN = { email: ASSERTED_EMAIL, name: 'Pawan Sirsat', oid: 'oid-pawan' } as const;

beforeEach(() => {
  ms = fakeMicrosoft();
  vi.stubGlobal('fetch', ms.fetchImpl);
  h = authHarness({ sso: MS_SSO });
  seedOrg(h.db, true);
  pawanId = newId();
  h.db
    .insert(users)
    .values({
      id: pawanId,
      email: LOCAL_EMAIL,
      name: 'Pawan',
      orgRole: 'member',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
});
afterEach(() => {
  vi.unstubAllGlobals();
  h.close();
});

function microsoftAccounts() {
  return h.db.select().from(accounts).where(eq(accounts.providerId, 'microsoft')).all();
}

async function meId(cookie: string): Promise<string> {
  const res = await h.app.request('/api/v1/me', { headers: { Cookie: cookie } });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

describe('an existing person is linked whatever case Microsoft spells their address in', () => {
  it('signs Pawan.Sirsat@ in as the existing pawan.sirsat@, with no second account', async () => {
    const usersBefore = h.db.select().from(users).all().length;

    const first = await signInWithMicrosoft(h.app, ms, PAWAN);

    // Back to the app, not better-auth's error page — `invite_required` and
    // `account_not_linked` both arrive as a redirect to `/error?error=…`.
    expect(first.response.status).toBe(302);
    expect(first.location).toBe('/');
    expect(first.location).not.toMatch(/error/);
    expect(first.cookie).not.toBe('');

    expect(await meId(first.cookie)).toBe(pawanId);
    expect(h.db.select().from(users).all()).toHaveLength(usersBefore);
    expect(microsoftAccounts().map((a) => a.userId)).toEqual([pawanId]);
    // The stored address is not rewritten to Microsoft's spelling.
    expect(h.db.select().from(users).where(eq(users.id, pawanId)).get()?.email).toBe(LOCAL_EMAIL);
  });

  it('a second sign-in finds the linked account, and still makes no other', async () => {
    await signInWithMicrosoft(h.app, ms, PAWAN);
    const again = await signInWithMicrosoft(h.app, ms, {
      ...PAWAN,
      email: 'PAWAN.SIRSAT@KVELLD.CO.ZA',
    });

    expect(again.location).toBe('/');
    expect(await meId(again.cookie)).toBe(pawanId);
    expect(microsoftAccounts()).toHaveLength(1);
  });

  it('a stranger with no invite is still refused (the control)', async () => {
    const usersBefore = h.db.select().from(users).all().length;
    const stranger = await signInWithMicrosoft(h.app, ms, {
      email: 'Someone.Else@kvelld.co.za',
      name: 'Someone Else',
      oid: 'oid-someone',
    });

    expect(stranger.location).toMatch(/error=invite_required/);
    expect(stranger.cookie).toBe('');
    expect(h.db.select().from(users).all()).toHaveLength(usersBefore);
    expect(microsoftAccounts()).toEqual([]);
  });
});

describe('Microsoft’s tokens are encrypted at rest', () => {
  /**
   * better-auth's ciphertext: XChaCha20-Poly1305 as hex, behind a `$ba$<n>$`
   * envelope when the secret is versioned.
   */
  const ENCRYPTED = /^(\$ba\$\d+\$)?[0-9a-f]{40,}$/;

  /** The `accounts` row as SQLite holds it — no adapter, no decryption. */
  function rawRow(): { access_token: string | null; refresh_token: string | null } {
    const row = h.t.sqlite
      .prepare(
        "SELECT access_token, refresh_token FROM accounts WHERE provider_id = 'microsoft' LIMIT 1",
      )
      .get() as { access_token: string | null; refresh_token: string | null } | undefined;
    if (row === undefined) throw new Error('no microsoft account row');
    return row;
  }

  it('stores neither the access token nor the refresh token in clear', async () => {
    await signInWithMicrosoft(h.app, ms, PAWAN);
    const issued = ms.issued.at(-1);
    if (issued === undefined) throw new Error('the fake issued no tokens');

    const row = rawRow();
    // Stored, not dropped — an absent column would pass the next two lines too.
    expect(row.access_token).toMatch(ENCRYPTED);
    expect(row.refresh_token).toMatch(ENCRYPTED);
    // Not the token, and no fragment of it.
    expect(row.access_token).not.toContain(issued.accessToken);
    expect(row.refresh_token).not.toContain(issued.refreshToken);
    expect(row.access_token).not.toContain('fixture-ms-');
    expect(row.refresh_token).not.toContain('fixture-ms-');
  });

  it('re-encrypts on every sign-in, and better-auth still reads the token back', async () => {
    await signInWithMicrosoft(h.app, ms, PAWAN);
    const second = await signInWithMicrosoft(h.app, ms, PAWAN);
    const issued = ms.issued.at(-1);
    if (issued === undefined) throw new Error('the fake issued no tokens');

    expect(rawRow().access_token).not.toContain('fixture-ms-');

    // Decryption: better-auth's own reader hands back the token Microsoft
    // issued on the second sign-in, so the stored value is that token,
    // encrypted, and not something unreadable.
    const accountId = microsoftAccounts()[0]?.id ?? '';
    const res = await h.app.request('/api/v1/auth/get-access-token', {
      method: 'POST',
      headers: jsonHeaders({ Cookie: second.cookie }),
      body: JSON.stringify({ accountId }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { accessToken: string }).accessToken).toBe(issued.accessToken);
  });
});
