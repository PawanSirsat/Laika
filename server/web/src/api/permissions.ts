import { request } from './client.ts';

/**
 * Who may do what (SPEC §6.4, LAI-885; the screen is LAI-950).
 *
 * **Every cell is `can()`'s answer**, computed on the server about a synthetic
 * actor holding each role — so this file declares the shape and nothing else.
 * No role, action or label is listed here: a client copy of §3 is exactly the
 * second source of truth the endpoint exists to retire, and the screen renders
 * whatever roles and actions the response names, including ones this client
 * has never heard of.
 *
 * The shapes mirror `server/src/services/permissions.ts`; the field lists are
 * compared against it in `test/api/permissions.test.ts`.
 */

/** `yes`, `no` or `conditional` today. Typed open, so a fourth is rendered rather than dropped. */
export type Holding = string;

/** One action and which built-in roles hold it. */
export interface PermissionRow {
  readonly action: string;
  readonly scope: 'org' | 'project';
  /** The SPEC §3.1 / §3.2 row, or `null` for an action no row grants yet. */
  readonly label: string | null;
  /** No token may perform it, whatever its scope. */
  readonly session_only: boolean;
  /** A `read_only` token may perform it. */
  readonly read_only: boolean;
  /** Set when some role is `conditional`; says what the condition is. */
  readonly condition: string | null;
  /** Org roles for an `org` row, project roles for a `project` row. */
  readonly roles: Readonly<Record<string, Holding>>;
}

/** The caller's actions in one project they are a member of. */
export interface ProjectGrants {
  readonly project_id: string;
  /** The effective role — an org viewer's membership is capped at `viewer`. */
  readonly role: string | null;
  readonly actions: readonly string[];
}

/** The wire shape of `GET /api/v1/permissions`. */
export interface Permissions {
  readonly org_roles: readonly string[];
  readonly project_roles: readonly string[];
  readonly permissions: readonly PermissionRow[];
  readonly me: {
    readonly org_role: string;
    readonly credential: 'session' | 'token';
    /** `'all'`, or a token's project whitelist (§4.9). */
    readonly project_scope: 'all' | readonly string[];
    /** `lead` for an Owner or Admin on every project in scope, else `null`. */
    readonly implicit_project_role: string | null;
    /** Org actions the caller may take on this credential. */
    readonly actions: readonly string[];
    /** Project actions per membership this credential may read. */
    readonly projects: readonly ProjectGrants[];
  };
}

export function getPermissions(signal?: AbortSignal): Promise<Permissions> {
  return request<Permissions>('/permissions', signal === undefined ? {} : { signal });
}

/**
 * Who can do what — what the owner has granted each org role (SPEC §6.4,
 * D-102 rule 6, LAI-958; the grid is LAI-960).
 *
 * Mirrors `server/src/services/org-permissions.ts`; the three shapes are
 * paired in `test/api/view-type-drift.test.ts`. Roles and capabilities are
 * typed open, as above: the grid draws whatever the response names.
 */

/** One grantable capability, as the grid lists it. */
export interface Capability {
  readonly id: string;
  readonly label: string;
  /** The §3.1 actions it carries. Empty for one that is a project role. */
  readonly actions: readonly string[];
}

/** An action no grant reaches: the owner's alone. */
export interface OwnerLocked {
  readonly action: string;
  /** Its §3.1 row, or `null` for an action no row names yet. */
  readonly label: string | null;
}

/** Role → capability → on. */
export type Grants = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

/** The wire shape of `GET` and `PUT /api/v1/org/permissions`. */
export interface OrgPermissions {
  /** The roles a grant can be given to. The owner is not one: they hold everything. */
  readonly roles: readonly string[];
  readonly capabilities: readonly Capability[];
  /** Every role and every capability, always — `PUT` takes it back whole. */
  readonly grants: Grants;
  readonly owner_locked: readonly OwnerLocked[];
  /** The last change, or `null` while every cell is still its default. */
  readonly updated_at: number | null;
  readonly updated_by: string | null;
}

export function getOrgPermissions(signal?: AbortSignal): Promise<OrgPermissions> {
  return request<OrgPermissions>('/org/permissions', signal === undefined ? {} : { signal });
}

/** Replace the whole matrix (the owner, signed in). Answers the matrix as stored. */
export function setOrgPermissions(grants: Grants): Promise<OrgPermissions> {
  return request<OrgPermissions>('/org/permissions', { method: 'PUT', body: { grants } });
}
