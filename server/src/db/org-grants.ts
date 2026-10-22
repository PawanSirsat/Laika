import { eq } from 'drizzle-orm';
import { type Db } from './client.ts';
import { type Capability, CAPABILITIES, type GrantableRole, GRANTABLE_ROLES } from './enums.ts';
import { orgRoleGrants, orgs } from './schema.ts';

/**
 * The organisation's grants as stored (§4.58, LAI-958): role → capability →
 * granted. **Only the rows that exist**; a missing cell is the default, which
 * is `policy/grants.ts`'s to say and not this layer's.
 *
 * In `db/` because it reads one table and decides nothing (CONVENTIONS §2):
 * `loadActor` needs it for every request, before any service is asked.
 */
export type StoredGrants = Partial<Record<GrantableRole, Partial<Record<Capability, boolean>>>>;

export function readStoredGrants(db: Db): StoredGrants {
  // Single-org (§4.2): the one org's rows, or none before setup.
  const org = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (org === undefined) return {};

  const stored: StoredGrants = {};
  for (const row of db
    .select({
      orgRole: orgRoleGrants.orgRole,
      capability: orgRoleGrants.capability,
      granted: orgRoleGrants.granted,
    })
    .from(orgRoleGrants)
    .where(eq(orgRoleGrants.orgId, org.id))
    .all()) {
    (stored[row.orgRole] ??= {})[row.capability] = row.granted === 1;
  }
  return stored;
}

/**
 * Stored cells over a matrix of defaults: what each role holds, every role
 * present. The defaults are passed in, since they are policy.
 */
export function mergeGrants(
  stored: StoredGrants,
  defaults: Readonly<Record<GrantableRole, readonly Capability[]>>,
): Record<GrantableRole, Capability[]> {
  const merged = {} as Record<GrantableRole, Capability[]>;
  for (const role of GRANTABLE_ROLES) {
    merged[role] = CAPABILITIES.filter(
      (capability) => stored[role]?.[capability] ?? defaults[role].includes(capability),
    );
  }
  return merged;
}
