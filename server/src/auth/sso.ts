import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { accounts, invites, users } from '../db/schema.ts';

/**
 * Microsoft SSO (LAI-1238): one Microsoft Entra ID tenant, and when it is
 * configured, **the only way in**.
 *
 * Configured by environment, never in the app, on purpose: an instance that is
 * SSO-only and whose identity provider is down or misconfigured is recovered
 * by unsetting the three variables and restarting, which brings passwords
 * back. A switch inside the app would be behind the very sign-in that broke.
 */
export interface MicrosoftSso {
  readonly provider: 'microsoft';
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * One directory, **by its GUID**, lowercased (LAI-1317). Every id token
   * names its tenant by GUID in `tid`, and that is what sign-in checks, so a
   * domain name would leave nothing to compare.
   */
  readonly tenantId: string;
  /**
   * `LAIKA_MICROSOFT_DIRECTORY_SYNC` (LAI-1239): add every enabled Member of the
   * directory as a Laika member, through Graph. Off unless asked for.
   */
  readonly directorySync: boolean;
}

/** How someone signs in to this instance — what `GET /setup/status` reports. */
/** `email` — email and password; `microsoft` — Microsoft SSO only. */
export type SignInMethod = 'email' | 'microsoft';

export function signInMethod(sso: MicrosoftSso | null): SignInMethod {
  return sso === null ? 'email' : 'microsoft';
}

/**
 * Microsoft's endpoints that are not one directory. Each lets an account from
 * **any** tenant — or a personal Microsoft account — authenticate, and then the
 * email Microsoft returns is whatever that tenant's admin typed, which is how
 * an outsider would claim an invited address (the "nOAuth" class). A single
 * tenant means the email comes from a directory this organisation runs.
 */
export const MULTI_TENANT_IDS = ['common', 'organizations', 'consumers'] as const;

/**
 * Microsoft's own tenant for **personal** accounts: every consumer account's
 * `tid` (LAI-1317). Configured as "the" directory, it would admit any
 * outlook.com address.
 */
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why a tenant id is refused, or `null` when it names one directory. */
export function tenantProblem(tenantId: string): string | null {
  const id = tenantId.trim().toLowerCase();
  if ((MULTI_TENANT_IDS as readonly string[]).includes(id)) {
    return `"${id}" lets accounts from any Microsoft tenant sign in; set your own directory's tenant id (a GUID)`;
  }
  if (id === CONSUMER_TENANT_ID) {
    return "is Microsoft's tenant for personal accounts; set your own directory's tenant id (a GUID)";
  }
  if (!GUID.test(id)) {
    return "is not a tenant id: your directory's GUID, such as 72f988bf-86f1-41af-91ab-2d7cd011db47 (Entra, Overview, Tenant ID). A domain name is refused: sign-in checks the GUID every token carries";
  }
  return null;
}

export interface SsoEnvProblem {
  readonly variable: string;
  readonly message: string;
}

/**
 * `LAIKA_MICROSOFT_CLIENT_ID`, `_CLIENT_SECRET` and `_TENANT_ID`: all three,
 * or none. A partial set is a mistake to say out loud at boot — silently
 * running with passwords would leave the operator believing SSO was on.
 */
export function parseMicrosoftSso(
  source: Readonly<Record<string, string | undefined>>,
): { readonly sso: MicrosoftSso | null } | { readonly problem: SsoEnvProblem } {
  const read = (name: string): string => (source[name] ?? '').trim();
  const clientId = read('LAIKA_MICROSOFT_CLIENT_ID');
  const clientSecret = read('LAIKA_MICROSOFT_CLIENT_SECRET');
  const tenantId = read('LAIKA_MICROSOFT_TENANT_ID');

  const syncRaw = read('LAIKA_MICROSOFT_DIRECTORY_SYNC').toLowerCase();
  if (syncRaw !== '' && syncRaw !== 'true' && syncRaw !== 'false') {
    return {
      problem: { variable: 'LAIKA_MICROSOFT_DIRECTORY_SYNC', message: 'is true or false' },
    };
  }
  const directorySync = syncRaw === 'true';

  const given = [clientId, clientSecret, tenantId].filter((v) => v !== '').length;
  if (given === 0) {
    if (directorySync) {
      return {
        problem: {
          variable: 'LAIKA_MICROSOFT_DIRECTORY_SYNC',
          message: 'needs Microsoft SSO — set the three LAIKA_MICROSOFT_* variables too',
        },
      };
    }
    return { sso: null };
  }
  if (given < 3) {
    const missing = (
      [
        ['LAIKA_MICROSOFT_CLIENT_ID', clientId],
        ['LAIKA_MICROSOFT_CLIENT_SECRET', clientSecret],
        ['LAIKA_MICROSOFT_TENANT_ID', tenantId],
      ] as const
    ).find(([, value]) => value === '');
    return {
      problem: {
        variable: missing?.[0] ?? 'LAIKA_MICROSOFT_CLIENT_ID',
        message:
          'is required with the other LAIKA_MICROSOFT_* variables — set all three to turn on Microsoft sign-in, or none',
      },
    };
  }

  const problem = tenantProblem(tenantId);
  if (problem !== null) {
    return { problem: { variable: 'LAIKA_MICROSOFT_TENANT_ID', message: problem } };
  }

  return {
    sso: {
      provider: 'microsoft',
      clientId,
      clientSecret,
      tenantId: tenantId.trim().toLowerCase(),
      directorySync,
    },
  };
}

/**
 * Why a sign-in's id token is refused (LAI-1317), as the `?error=` code the
 * browser is sent back with. The web has words for each (`api/auth.ts`).
 */
export type IdTokenRefusal =
  'id_token_unreadable' | 'wrong_tenant' | 'wrong_issuer' | 'wrong_audience' | 'guest_account';

/** The id token's claims, unverified, or `null` when it is not a JWT of an object. */
export function idTokenClaims(idToken: string | undefined): Record<string, unknown> | null {
  const payload = idToken?.split('.')[1];
  if (payload === undefined || payload === '') return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * **Whose token this is, checked before anyone is signed in** (LAI-1317).
 *
 * better-auth's Microsoft provider only *decodes* the id token on the code
 * flow — it came from the token endpoint over TLS — and checks neither its
 * tenant nor its audience; the callback's issuer check is skipped because the
 * provider declares no issuer. So this does, on every sign-in:
 *
 *  - `tid` is the configured directory's GUID;
 *  - `iss` is that directory's v2.0 issuer, exactly;
 *  - `aud` is this app's client id, and nothing else;
 *  - no `idp` other than `iss`: a guest's token names their **home** directory
 *    there, and a guest is somebody else's account, whatever its email says.
 *    Members carry no `idp`, and directory sync already skips guests.
 */
export function idTokenProblem(
  idToken: string | undefined,
  sso: MicrosoftSso,
): IdTokenRefusal | null {
  const claims = idTokenClaims(idToken);
  if (claims === null) return 'id_token_unreadable';

  const tenant = sso.tenantId.toLowerCase();
  if (typeof claims.tid !== 'string' || claims.tid.toLowerCase() !== tenant) return 'wrong_tenant';
  if (claims.iss !== `https://login.microsoftonline.com/${tenant}/v2.0`) return 'wrong_issuer';

  const aud = claims.aud;
  const audience = Array.isArray(aud) && aud.length === 1 ? (aud[0] as unknown) : aud;
  if (audience !== sso.clientId) return 'wrong_audience';

  if (claims.idp !== undefined && claims.idp !== claims.iss) return 'guest_account';
  return null;
}

/** Whether this person already has a Microsoft account linked (LAI-1317). */
export function hasMicrosoftAccount(db: Db, userId: string): boolean {
  return (
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'microsoft')))
      .limit(1)
      .get() !== undefined
  );
}

/** An unspent, unexpired invite addressed to exactly this email. */
export interface InviteForEmail {
  readonly id: string;
  readonly tokenHash: string;
  readonly orgRole: 'owner' | 'admin' | 'member' | 'viewer';
}

/**
 * **SSO is a way to sign in, never a way to join** (D-004, LAI-1238): a new
 * person gets an account only when an invite is waiting for the address
 * Microsoft asserts.
 *
 * Only an **email-addressed** invite counts. A link invite (`email IS NULL`)
 * is a bearer token for whoever holds it; in the SSO flow nobody presents a
 * token, so honouring one would let any member of the tenant spend an open
 * link they never received. The newest invite wins when there are several.
 */
export function inviteForEmail(db: Db, email: string, now: number): InviteForEmail | null {
  const row = db
    .select({ id: invites.id, tokenHash: invites.tokenHash, orgRole: invites.orgRole })
    .from(invites)
    .where(
      and(
        sql`lower(${invites.email}) = ${email.toLowerCase()}`,
        isNull(invites.acceptedBy),
        gt(invites.expiresAt, now),
      ),
    )
    .orderBy(sql`${invites.createdAt} desc`)
    .limit(1)
    .get();
  return row ?? null;
}

/** Whether an account already holds this email (emails are stored lowercased, §4.1). */
export function accountExists(db: Db, email: string): boolean {
  return (
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1)
      .get() !== undefined
  );
}

/** `true` unless the account exists and is switched off (§4.1, LAI-442). */
export function userIsActive(db: Db, userId: string): boolean {
  const row = db.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId)).get();
  return row === undefined || row.isActive === 1;
}
