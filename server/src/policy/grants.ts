/**
 * What an owner may grant per org role, and what each grant carries (SPEC §3,
 * D-102 rule 6, LAI-958).
 *
 * A **fixed** set of capabilities, each a bundle of existing §3.1 actions: an
 * owner decides who sees analytics or manages people, never invents a
 * permission. The matrix itself is stored per org × role (§4.58) and loaded
 * onto the actor by the caller, so `can()` stays pure (§3.3 rule 2): it reads
 * `actor.orgGrants` and does no I/O.
 *
 * **Defaults are today's behaviour** — admin on, member and viewer off — and a
 * missing row or a missing matrix reads as its default. The owner holds every
 * capability, always; there is no row for them to lose one.
 */

import {
  type Capability,
  type GrantableRole,
  type OrgRole,
  type ProjectRole,
} from '../db/enums.ts';
import { type OrgAction } from './actions.ts';

/** A role → the capabilities it holds. Every grantable role is present. */
export type OrgGrants = Readonly<Record<GrantableRole, readonly Capability[]>>;

/**
 * Each capability's actions, as §3's grants table lists them.
 *
 * `open_all_projects` carries no §3.1 action: it is the implicit project role
 * §3 gives org owners and admins, and `effectiveProjectRole` reads it. An
 * action appears under at most one capability (a test holds it), so the grant
 * that decides it is never ambiguous.
 */
export const CAPABILITY_ACTIONS: Readonly<Record<Capability, readonly OrgAction[]>> = {
  see_people_analytics: ['profile.read', 'profile.activity.read', 'usage.read_people'],
  see_org_activity: ['audit_log.export'],
  open_all_projects: [],
  manage_people: ['user.invite', 'user.deactivate'],
  change_org_settings: ['org.settings.edit', 'org.time.set', 'org.developer_insights.set'],
};

/** The words a screen shows for each, so the client invents none (§11.4). */
export const CAPABILITY_LABELS: Readonly<Record<Capability, string>> = {
  see_people_analytics: "See everyone's analytics",
  see_org_activity: "See the organisation's activity history",
  open_all_projects: 'Open every project',
  manage_people: 'Manage people and invites',
  change_org_settings: 'Change organisation settings, Time and breaks',
};

/**
 * Never grantable, owner only (D-102 rules 5 and 6). Listed so `PUT
 * /org/permissions` can say so by name when a body tries, rather than calling
 * it an unknown key.
 */
export const OWNER_LOCKED_ACTIONS = [
  'org.delete',
  'org.transfer_ownership',
  'user.set_role',
  'org.permissions.manage',
] as const satisfies readonly OrgAction[];

/** Today's behaviour (D-102 rule 6): admin holds every capability. */
export const DEFAULT_GRANTS: OrgGrants = {
  admin: [
    'see_people_analytics',
    'see_org_activity',
    'open_all_projects',
    'manage_people',
    'change_org_settings',
  ],
  member: [],
  viewer: [],
};

const CAPABILITY_OF: ReadonlyMap<OrgAction, Capability> = new Map(
  (Object.entries(CAPABILITY_ACTIONS) as [Capability, readonly OrgAction[]][]).flatMap(
    ([capability, actions]) => actions.map((action) => [action, capability] as const),
  ),
);

/** The capability that decides `action`, or `null` when no grant does. */
export function capabilityOf(action: OrgAction): Capability | null {
  return CAPABILITY_OF.get(action) ?? null;
}

/**
 * Whether `orgRole` holds `capability` under `grants`.
 *
 * Owner always; an absent matrix is the default one. Takes the role and the
 * matrix rather than an actor so the catalogue can ask about every role.
 */
export function holdsCapability(
  orgRole: OrgRole,
  grants: OrgGrants | null | undefined,
  capability: Capability,
): boolean {
  if (orgRole === 'owner') return true;
  return (grants ?? DEFAULT_GRANTS)[orgRole].includes(capability);
}

/**
 * The project role an org role holds on every project without a membership
 * row — §3's implicit `lead`, now the `open_all_projects` grant.
 *
 * An org viewer granted it reads every project as a project `viewer`: §3's
 * *"may hold only the project role `viewer`"* is not something a grant lifts
 * (D-006).
 */
export function implicitProjectRole(
  orgRole: OrgRole,
  grants: OrgGrants | null | undefined,
): ProjectRole | null {
  if (!holdsCapability(orgRole, grants, 'open_all_projects')) return null;
  return orgRole === 'viewer' ? 'viewer' : 'lead';
}
