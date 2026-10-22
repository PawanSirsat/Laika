import { desc, eq } from 'drizzle-orm';
import { activityActor, type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type Capability, CAPABILITIES, type GrantableRole, GRANTABLE_ROLES } from '../db/enums.ts';
import { mergeGrants, readStoredGrants } from '../db/org-grants.ts';
import { requireOrgId } from '../db/orgs.ts';
import { orgRoleGrants } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type OrgAction } from '../policy/actions.ts';
import { assertCan } from '../policy/can.ts';
import {
  CAPABILITY_ACTIONS,
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  DEFAULT_GRANTS,
  type OrgGrants,
  OWNER_LOCKED_ACTIONS,
} from '../policy/grants.ts';
import { ACTION_LABELS } from './permissions.ts';

/**
 * `GET` and `PUT /api/v1/org/permissions` (SPEC §6.4, D-102 rule 6, LAI-958):
 * what the owner has granted each org role.
 *
 * The matrix is a **fixed** set of capabilities × admin, member and viewer.
 * The owner holds every capability and is not a column that can change; the
 * owner-locked actions are listed so a screen can say so, and a body naming
 * one is refused by name. What each capability lets a role do is `can()`'s,
 * through `policy/grants.ts` — and `GET /api/v1/permissions` answers from the
 * same matrix, so the two cannot disagree.
 */

/** One grantable capability, as a screen lists it. */
export interface CapabilityView {
  id: Capability;
  label: string;
  /** One line saying what it lets a role do (LAI-985). */
  description: string;
  /** The §3.1 actions it carries. Empty for *Open every project*: a project role. */
  actions: OrgAction[];
}

/** An action no grant reaches. */
export interface OwnerLockedView {
  action: OrgAction;
  /** Its §3.1 row. */
  label: string | null;
}

/** The wire shape of both endpoints. */
export interface OrgPermissionsView {
  roles: GrantableRole[];
  capabilities: CapabilityView[];
  /** Role → capability → on. Every role and every capability, always: `PUT` takes this back. */
  grants: Record<GrantableRole, Record<Capability, boolean>>;
  owner_locked: OwnerLockedView[];
  /** The last change, or `null` while every cell is still its default. */
  updated_at: number | null;
  updated_by: string | null;
}

function matrixOf(grants: OrgGrants): Record<GrantableRole, Record<Capability, boolean>> {
  const matrix = {} as Record<GrantableRole, Record<Capability, boolean>>;
  for (const role of GRANTABLE_ROLES) {
    matrix[role] = {} as Record<Capability, boolean>;
    for (const capability of CAPABILITIES) {
      matrix[role][capability] = grants[role].includes(capability);
    }
  }
  return matrix;
}

function view(db: Db): OrgPermissionsView {
  const grants = mergeGrants(readStoredGrants(db), DEFAULT_GRANTS);
  const last = db
    .select({ updatedAt: orgRoleGrants.updatedAt, setBy: orgRoleGrants.setBy })
    .from(orgRoleGrants)
    .where(eq(orgRoleGrants.orgId, requireOrgId(db)))
    .orderBy(desc(orgRoleGrants.updatedAt))
    .limit(1)
    .get();

  return {
    roles: [...GRANTABLE_ROLES],
    capabilities: CAPABILITIES.map((id) => ({
      id,
      label: CAPABILITY_LABELS[id],
      description: CAPABILITY_DESCRIPTIONS[id],
      actions: [...CAPABILITY_ACTIONS[id]],
    })),
    grants: matrixOf(grants),
    owner_locked: OWNER_LOCKED_ACTIONS.map((action) => ({
      action,
      label: ACTION_LABELS[action],
    })),
    updated_at: last?.updatedAt ?? null,
    updated_by: last?.setBy ?? null,
  };
}

/**
 * Anyone signed in: who may do what here is a fact about the organisation,
 * `org.read`'s, as `GET /api/v1/permissions` is.
 */
export function getOrgPermissions(db: Db, actor: ResolvedActor): OrgPermissionsView {
  assertCan(actor, 'org.read');
  return view(db);
}

/** `PUT`'s body as the route parsed it: JSON objects of booleans, unchecked keys. */
export type GrantsInput = Record<string, Record<string, boolean>>;

const LOCKED: ReadonlySet<string> = new Set(OWNER_LOCKED_ACTIONS);
const ROLES: ReadonlySet<string> = new Set(GRANTABLE_ROLES);
const KNOWN: ReadonlySet<string> = new Set(CAPABILITIES);

/**
 * The whole matrix, or `422` saying which cell is wrong. Every role and every
 * capability must be present: a partial body would leave a reader unable to
 * tell "left alone" from "forgot", and the screen sends what it shows.
 */
function validate(input: GrantsInput): OrgGrants {
  const grants = {} as Record<GrantableRole, Capability[]>;

  for (const role of Object.keys(input)) {
    if (role === 'owner') {
      throw new ApiError(
        'unprocessable',
        'The owner holds every capability, and that cannot be changed',
        { field: 'grants.owner' },
      );
    }
    if (!ROLES.has(role)) {
      throw new ApiError('unprocessable', `"${role}" is not a role that can be granted to`, {
        field: `grants.${role}`,
      });
    }
  }

  for (const role of GRANTABLE_ROLES) {
    const cells = input[role];
    if (cells === undefined) {
      throw new ApiError('unprocessable', `Every role must be sent; "${role}" is missing`, {
        field: `grants.${role}`,
      });
    }

    for (const key of Object.keys(cells)) {
      if (LOCKED.has(key)) {
        throw new ApiError('unprocessable', `"${key}" is the owner's alone and cannot be granted`, {
          field: `grants.${role}.${key}`,
          reason: 'owner_locked',
        });
      }
      if (!KNOWN.has(key)) {
        throw new ApiError('unprocessable', `"${key}" is not a capability`, {
          field: `grants.${role}.${key}`,
        });
      }
    }

    const missing = CAPABILITIES.filter((capability) => cells[capability] === undefined);
    if (missing.length > 0) {
      throw new ApiError('unprocessable', `Every capability must be sent for "${role}"`, {
        field: `grants.${role}`,
        missing,
      });
    }

    grants[role] = CAPABILITIES.filter((capability) => cells[capability] === true);
  }

  return grants;
}

function same(a: OrgGrants, b: OrgGrants): boolean {
  return GRANTABLE_ROLES.every(
    (role) => a[role].length === b[role].length && a[role].every((c) => b[role].includes(c)),
  );
}

/**
 * Replace the matrix (owner only, signed in — `org.permissions.manage`).
 *
 * Every cell is written, so the stored matrix says what the owner chose and
 * no longer leans on the defaults. **One audit row**, `member.role_changed`
 * with `scope: "org_permissions"` and the whole matrix before and after: it
 * is what an owner changing roles writes, and a new verb would be three
 * owners (CLAUDE.md §4.4) for a row nobody yet filters on. A body that
 * changes nothing writes nothing.
 */
export function setOrgPermissions(
  db: Db,
  actor: ResolvedActor,
  input: GrantsInput,
  now: number = Date.now(),
): OrgPermissionsView {
  assertCan(actor, 'org.permissions.manage');
  const to = validate(input);
  const orgId = requireOrgId(db);
  const from = mergeGrants(readStoredGrants(db), DEFAULT_GRANTS);

  if (!same(from, to)) {
    db.transaction(() => {
      for (const orgRole of GRANTABLE_ROLES) {
        for (const capability of CAPABILITIES) {
          const granted = to[orgRole].includes(capability) ? 1 : 0;
          db.insert(orgRoleGrants)
            .values({ orgId, orgRole, capability, granted, setBy: actor.userId, updatedAt: now })
            .onConflictDoUpdate({
              target: [orgRoleGrants.orgId, orgRoleGrants.orgRole, orgRoleGrants.capability],
              set: { granted, setBy: actor.userId, updatedAt: now },
            })
            .run();
        }
      }

      appendActivity(db, {
        orgId,
        // Org-scoped, as an org role change is (§4.8).
        projectId: null,
        ...activityActor(actor),
        type: 'member.role_changed',
        payload: { scope: 'org_permissions', from, to },
        now,
      });
    });
  }

  return view(db);
}
