import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { invites, users } from '../db/schema.ts';

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
  /** One directory: a tenant GUID or one of its verified domains. */
  readonly tenantId: string;
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

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Why a tenant id is refused, or `null` when it names one directory. */
export function tenantProblem(tenantId: string): string | null {
  const id = tenantId.trim().toLowerCase();
  if ((MULTI_TENANT_IDS as readonly string[]).includes(id)) {
    return `"${id}" lets accounts from any Microsoft tenant sign in; set your own directory's tenant id (a GUID) or verified domain`;
  }
  if (!GUID.test(id) && !DOMAIN.test(id)) {
    return 'is not a tenant id (a GUID such as 72f988bf-86f1-41af-91ab-2d7cd011db47) or a verified domain';
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

  const given = [clientId, clientSecret, tenantId].filter((v) => v !== '').length;
  if (given === 0) return { sso: null };
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

  return { sso: { provider: 'microsoft', clientId, clientSecret, tenantId: tenantId.trim() } };
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
