import { eq, sql } from 'drizzle-orm';
import { type MicrosoftSso } from '../auth/sso.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { orgs, users } from '../db/schema.ts';

/**
 * **Every member of the Microsoft directory is a Laika member** (LAI-1239,
 * the owner's choice): read the tenant's enabled Member accounts through
 * Microsoft Graph and add anyone Laika does not have yet, as `member`, with no
 * password — they sign in with Microsoft, which links by that email.
 *
 * - **App permission**: the Entra app's own token (client credentials) with
 *   Graph's `User.Read.All` *application* permission, granted once by a tenant
 *   admin. No signed-in person is needed, which is what lets this run on a
 *   schedule.
 * - **Enabled Members only**: no guests, no disabled accounts — asked of Graph
 *   and checked again here, so a filter Graph ignores cannot widen it.
 * - **Additive**: an existing person is never touched — not their role, not
 *   their name, not their active flag. Removing or disabling someone in
 *   Microsoft does not deactivate them here; that is a separate decision.
 * - **Opt-in**: `LAIKA_MICROSOFT_DIRECTORY_SYNC=true`, on top of Microsoft SSO.
 *   Adding a whole tenant should never switch itself on.
 */

/** One directory account, as Laika needs it. */
export interface DirectoryMember {
  readonly id: string;
  readonly name: string;
  /** Lowercased: `mail`, or the UPN when the account has no mailbox. */
  readonly email: string;
}

export interface DirectoryDeps {
  /** Injected by the tests, which never call Microsoft. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/** A failure said by its code alone — never a token, a secret or Graph's body. */
export class DirectoryError extends Error {
  constructor(readonly code: string) {
    super(`microsoft directory: ${code}`);
    this.name = 'DirectoryError';
  }
}

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Graph's page cap for `/users`: the fewest round trips a large tenant can take. */
const PAGE = 999;

/** The app's own Graph token (client credentials, `.default` scope). */
async function appToken(sso: MicrosoftSso, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(
    `${LOGIN}/${encodeURIComponent(sso.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: sso.clientId,
        client_secret: sso.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    },
  ).catch(() => {
    throw new DirectoryError('token_unreachable');
  });
  if (!response.ok) throw new DirectoryError(`token_${String(response.status)}`);
  const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  if (typeof body?.access_token !== 'string') throw new DirectoryError('token_malformed');
  return body.access_token;
}

interface GraphUser {
  readonly id?: unknown;
  readonly displayName?: unknown;
  readonly mail?: unknown;
  readonly userPrincipalName?: unknown;
  readonly accountEnabled?: unknown;
  readonly userType?: unknown;
}

/** A Graph user as a member, or `null` when it is not one Laika should add. */
export function memberOf(user: GraphUser): DirectoryMember | null {
  if (user.accountEnabled !== true || user.userType !== 'Member') return null;
  if (typeof user.id !== 'string') return null;
  const address =
    typeof user.mail === 'string' && user.mail.includes('@')
      ? user.mail
      : typeof user.userPrincipalName === 'string'
        ? user.userPrincipalName
        : '';
  const email = address.trim().toLowerCase();
  // A UPN with `#EXT#` is a guest's, whatever `userType` said.
  if (!email.includes('@') || email.includes('#ext#')) return null;
  const name =
    typeof user.displayName === 'string' && user.displayName.trim() !== ''
      ? user.displayName.trim()
      : (email.split('@')[0] ?? email);
  return { id: user.id, name, email };
}

/**
 * Every enabled Member account in the tenant, following Graph's paging.
 *
 * The filter is an *advanced* query (`accountEnabled` and `userType` together),
 * which Graph serves only with `ConsistencyLevel: eventual` and `$count`.
 */
export async function readDirectory(
  sso: MicrosoftSso,
  deps: DirectoryDeps = {},
): Promise<DirectoryMember[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const token = await appToken(sso, fetchImpl);
  const query = new URLSearchParams({
    $select: 'id,displayName,mail,userPrincipalName,accountEnabled,userType',
    $filter: "accountEnabled eq true and userType eq 'Member'",
    $count: 'true',
    $top: String(PAGE),
  });
  let next: string | null = `${GRAPH}/users?${query.toString()}`;
  const members: DirectoryMember[] = [];
  const seen = new Set<string>();

  // A bound, so a Graph that keeps answering a nextLink cannot loop for ever.
  for (let page = 0; next !== null && page < 500; page++) {
    const response: Response = await fetchImpl(next, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
    }).catch(() => {
      throw new DirectoryError('graph_unreachable');
    });
    // 403 is the one an operator can fix: User.Read.All not granted.
    if (response.status === 403) throw new DirectoryError('graph_forbidden_grant_user_read_all');
    if (!response.ok) throw new DirectoryError(`graph_${String(response.status)}`);
    const body = (await response.json().catch(() => null)) as {
      value?: unknown;
      '@odata.nextLink'?: unknown;
    } | null;
    if (body === null || !Array.isArray(body.value)) throw new DirectoryError('graph_malformed');
    for (const user of body.value as GraphUser[]) {
      const member = memberOf(user);
      if (member !== null && !seen.has(member.email)) {
        seen.add(member.email);
        members.push(member);
      }
    }
    const link = body['@odata.nextLink'];
    next = typeof link === 'string' && link.startsWith(`${GRAPH}/`) ? link : null;
  }
  return members;
}

export interface DirectorySyncResult {
  /** People added this run. */
  readonly added: number;
  /** Directory members Laika already had. */
  readonly existing: number;
}

/**
 * Add the members Laika does not have (§4.1's `users`, lowercased email).
 *
 * Nothing before first boot: there is no org to add anyone to, and the owner
 * is made by setup, not by the directory.
 */
export function addDirectoryMembers(
  db: Db,
  members: readonly DirectoryMember[],
  now: number,
): DirectorySyncResult {
  const org = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (org === undefined) return { added: 0, existing: 0 };

  let added = 0;
  let existing = 0;
  for (const member of members) {
    const taken = db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, member.email))
      .get();
    if (taken !== undefined) {
      existing += 1;
      continue;
    }
    db.transaction((tx) => {
      const id = newId();
      tx.insert(users)
        .values({
          id,
          email: member.email,
          name: member.name,
          orgRole: 'member',
          isActive: 1,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .run();
      // The same verb an invite writes, by the system (§11.6's cron), so the
      // audit log says who arrived and how without a verb of its own.
      appendActivity(tx as unknown as Db, {
        orgId: org.id,
        actorId: null,
        actorKind: 'system',
        type: 'member.added',
        payload: {
          user_id: id,
          user_name: member.name,
          org_role: 'member',
          via: 'microsoft_directory',
        },
        now,
      });
    });
    added += 1;
  }
  return { added, existing };
}

/** The scheduled run: nothing unless directory sync is switched on. */
export async function runDirectorySync(
  db: Db,
  sso: MicrosoftSso | null,
  deps: DirectoryDeps = {},
): Promise<DirectorySyncResult> {
  if (sso?.directorySync !== true) return { added: 0, existing: 0 };
  const members = await readDirectory(sso, deps);
  return addDirectoryMembers(db, members, (deps.now ?? Date.now)());
}
