/**
 * The only authority on authorisation in Laika (SPEC §3.3).
 *
 * Every route, every MCP tool, every webhook and every cron job calls
 * `assertCan` before it reads or writes. There is no internal path that skips it.
 *
 * Three properties this file is built around, in priority order:
 *
 *  1. **Pure and synchronous.** No I/O, no database, no clock. Everything the
 *     decision needs — org role, resolved project role, resource ownership — is
 *     loaded by the caller and passed in. That is what makes the whole matrix
 *     testable as a table, and what stops an authorisation check from becoming a
 *     query nobody notices in a loop.
 *  2. **Deny by default.** Unknown action, missing membership, deactivated user,
 *     unmatched case — all `false`. Every `switch` is exhaustive over a closed
 *     union, so adding an action without deciding its policy fails the build
 *     rather than silently allowing it.
 *  3. **Boring.** A `switch` per matrix, in the spec's own row order, so a
 *     reviewer can diff it against §3.1 and §3.2 by eye. This is not the place
 *     for a rules engine.
 */

import { ApiError } from '../errors.ts';
import { type OrgRole, type ProjectRole, type TokenScope } from '../db/enums.ts';
import { type Action, isReadAction, type OrgAction, type ProjectAction } from './actions.ts';
import { ORG_ACTIONS, PROJECT_ACTIONS } from './actions.ts';

export { type Action, type OrgAction, type ProjectAction } from './actions.ts';

/** The credential a token-authenticated request carries (SPEC §4.9, §6.2). */
export interface TokenContext {
  scope: TokenScope;
  /** `null` = every project the user can reach. Otherwise a whitelist. */
  projectIds: readonly string[] | null;
}

export interface Actor {
  userId: string;
  orgRole: OrgRole;
  /** `false` for a deactivated user — the row is kept for history (§4.1). */
  isActive: boolean;
  /**
   * The actor's role in the project this request concerns, already looked up by
   * the caller. `null` means "not a member" — which is a denial for every
   * project action unless org role grants implicit lead.
   */
  projectRole: ProjectRole | null;
  /** Absent or `null` when the request arrived on a session cookie (§6.1). */
  token?: TokenContext | null;
}

export interface Resource {
  /**
   * The project this action concerns. Required for every project action, and for
   * token project-restriction checks.
   */
  projectId?: string | undefined;
  /**
   * Who owns the thing being acted on — a comment's author, a token's user.
   * Compared against `actor.userId` for `self`-scoped rows in §3.2.
   */
  ownerId?: string | null | undefined;
  /** A task's creator. §3.2 lets a Member delete only tasks they created. */
  createdBy?: string | null | undefined;
  /** §3.1 "Join a `public` project" — private projects are not joinable. */
  visibility?: 'public' | 'private' | undefined;
  /** For `user.set_role`: the role being granted. Admins may not grant `owner`. */
  targetOrgRole?: OrgRole | undefined;
}

const ORG_ACTION_SET: ReadonlySet<string> = new Set(ORG_ACTIONS);
const PROJECT_ACTION_SET: ReadonlySet<string> = new Set(PROJECT_ACTIONS);

function isOrgAction(action: Action): action is OrgAction {
  return ORG_ACTION_SET.has(action);
}

function isProjectAction(action: Action): action is ProjectAction {
  return PROJECT_ACTION_SET.has(action);
}

/**
 * The project role the actor actually has, after the two structural rules in
 * SPEC §3 that are easy to get wrong:
 *
 *  - org `owner` and `admin` hold **implicit `lead`** everywhere and never need a
 *    membership row;
 *  - an org `viewer` may hold **only** project role `viewer`. A membership row
 *    saying otherwise is data corruption or an escalation attempt, and is capped
 *    here rather than trusted (D-006).
 */
export function effectiveProjectRole(actor: Actor): ProjectRole | null {
  if (actor.orgRole === 'owner' || actor.orgRole === 'admin') return 'lead';
  if (actor.projectRole === null) return null;
  if (actor.orgRole === 'viewer') return 'viewer';
  return actor.projectRole;
}

/** SPEC §3.1, row by row. */
function canOrgAction(actor: Actor, action: OrgAction, resource: Resource): boolean {
  const { orgRole } = actor;
  const isAdminUp = orgRole === 'owner' || orgRole === 'admin';

  switch (action) {
    // | Delete org data / transfer ownership | ✓ | — | — | — |
    case 'org.delete':
    case 'org.transfer_ownership':
      return orgRole === 'owner';

    // | Org settings (AI provider, SMTP, signup mode) | ✓ | ✓ | — | — |
    case 'org.settings.edit':
      return isAdminUp;

    // | Create / archive project | ✓ | ✓ | — | — |
    case 'project.create':
    case 'project.archive':
      return isAdminUp;

    // | Invite users / change org roles | ✓ | ✓ (not to Owner) | — | — |
    case 'user.invite':
      return isAdminUp;

    case 'user.set_role':
      if (orgRole === 'owner') return true;
      // The "(not to Owner)" caveat: an Admin may set any role except Owner.
      // Without this an Admin promotes themselves and the distinction is
      // decorative.
      if (orgRole === 'admin') return resource.targetOrgRole !== 'owner';
      return false;

    // | Deactivate user | ✓ | ✓ | — | — |
    case 'user.deactivate':
      return isAdminUp;

    // | View member list | ✓ | ✓ | ✓ | ✓ |
    case 'member_list.read':
      return true;

    // | Join a `public` project | ✓ | ✓ | ✓ (as member) | ✓ (as viewer) |
    // Every role may join; which project role they land on is decided by
    // `projectRoleOnJoin`, not here. A private project is never joinable.
    case 'project.join_public':
      return resource.visibility === 'public';

    // | Generate own tokens | ✓ | ✓ | ✓ | ✓ (`read_only` forced) |
    // The forcing happens at creation (see `forcedTokenScope`); a Viewer is
    // still allowed to hold a token.
    case 'token.create_own':
      return true;

    // Self-scoped: reading and revoking your own tokens is always yours to do.
    case 'token.read_own':
    case 'token.revoke_own':
      return resource.ownerId === actor.userId;

    // | List / revoke **anyone's** token | ✓ | ✓ | — | — |
    case 'token.list_any':
    case 'token.revoke_any':
      return isAdminUp;

    // | Export audit log | ✓ | ✓ | — | — |
    case 'audit_log.export':
      return isAdminUp;

    // | Configure webhooks | ✓ | ✓ | — | — |
    case 'webhook.configure':
      return isAdminUp;

    default:
      return assertNever(action);
  }
}

/** SPEC §3.2, row by row. `role` is already the effective role. */
function canProjectAction(
  actor: Actor,
  action: ProjectAction,
  resource: Resource,
  role: ProjectRole,
): boolean {
  const isLead = role === 'lead';
  const isMemberUp = role === 'lead' || role === 'member';

  switch (action) {
    // | Manage project members | ✓ | — | — |
    case 'project.members.manage':
      return isLead;

    // | Edit project settings and `context_md` | ✓ | — | — |
    case 'project.settings.edit':
      return isLead;

    // | Create / edit / delete sprints | ✓ | — | — |
    case 'sprint.manage':
      return isLead;

    // | Assign tasks into or out of a sprint | ✓ | ✓ | — |
    case 'task.assign_sprint':
      return isMemberUp;

    // | Create / edit / move any task | ✓ | ✓ | — |
    case 'task.write':
      return isMemberUp;

    // | Claim a task (`start_working`) | ✓ | ✓ | — |
    case 'task.claim':
      return isMemberUp;

    // | Assign a task to someone else | ✓ | ✓ | — |
    case 'task.assign_other':
      return isMemberUp;

    // | Add comment | ✓ | ✓ | — |
    case 'comment.create':
      return isMemberUp;

    // | Edit / delete comment | own + any | own | — |
    case 'comment.edit':
    case 'comment.delete':
      if (isLead) return true;
      if (role === 'member') return resource.ownerId === actor.userId;
      return false;

    // | Cancel / delete task | ✓ | own-created | — |
    case 'task.delete':
      if (isLead) return true;
      if (role === 'member') return resource.createdBy === actor.userId;
      return false;

    // | Add / remove dependencies | ✓ | ✓ | — |
    case 'task.dependency.write':
      return isMemberUp;

    // | Read tasks, comments, activity, capacity | ✓ | ✓ | ✓ |
    case 'project.read':
      return true;

    // | Apply a meeting-diff proposal | ✓ | ✓ | — |
    case 'meeting_proposal.apply':
      return isMemberUp;

    default:
      return assertNever(action);
  }
}

/**
 * Token scope, applied **after** the role decision and only ever narrowing it
 * (SPEC §6.2, §3.3 rule 4).
 *
 * Scope is coarse on purpose — `full` or `read_only`, plus an optional project
 * whitelist. Granular per-action scopes are an open question (§14), and building
 * them speculatively would mean a permission surface with no product behind it.
 */
function tokenAllows(actor: Actor, action: Action, resource: Resource): boolean {
  const token = actor.token;
  if (token === undefined || token === null) return true;

  // A token may be pinned to a subset of the user's projects (§4.9). An action
  // with no project is org-scoped and unaffected by that whitelist.
  if (token.projectIds !== null && resource.projectId !== undefined) {
    if (!token.projectIds.includes(resource.projectId)) return false;
  }

  return effectiveTokenScope(actor, token) === 'full' || isReadAction(action);
}

/**
 * A Viewer's token is `read_only` whatever the stored row says (SPEC §3, §4.9).
 *
 * Enforced here rather than trusted at creation time: a role can be downgraded
 * to `viewer` long after a `full` token was minted, and nothing revokes the
 * token when that happens.
 */
export function effectiveTokenScope(actor: Actor, token: TokenContext): TokenScope {
  return actor.orgRole === 'viewer' ? 'read_only' : token.scope;
}

/** The scope a newly minted token must carry for this actor (§3.1). */
export function forcedTokenScope(orgRole: OrgRole, requested: TokenScope): TokenScope {
  return orgRole === 'viewer' ? 'read_only' : requested;
}

/** The project role a user lands on when joining a public project (§3.1). */
export function projectRoleOnJoin(orgRole: OrgRole): ProjectRole {
  return orgRole === 'viewer' ? 'viewer' : 'member';
}

/**
 * The single authorisation decision.
 *
 * Order matters and is part of the contract: active check, then the role
 * decision, then token narrowing. Narrowing last is what guarantees a token can
 * never grant more than its user has.
 */
export function can(actor: Actor, action: Action, resource: Resource = {}): boolean {
  // A deactivated user keeps their rows for history but can do nothing (§4.1).
  if (!actor.isActive) return false;

  let allowed: boolean;

  if (isOrgAction(action)) {
    allowed = canOrgAction(actor, action, resource);
  } else if (isProjectAction(action)) {
    const role = effectiveProjectRole(actor);
    // Not a member and no implicit lead — nothing in §3.2 applies.
    allowed = role === null ? false : canProjectAction(actor, action, resource, role);
  } else {
    // Unreachable through the type system; reachable from untyped callers.
    return false;
  }

  if (!allowed) return false;

  return tokenAllows(actor, action, resource);
}

/**
 * `can`, but it throws (SPEC §3.3, §6.3).
 *
 * Handlers call this rather than `can` so that ignoring the answer is not
 * possible by accident — a forgotten `if` around a boolean is a silent
 * authorisation bypass, and this makes that shape impossible.
 */
export function assertCan(actor: Actor, action: Action, resource: Resource = {}): void {
  if (!can(actor, action, resource)) {
    throw new ApiError('forbidden', 'You do not have permission to perform this action', {
      action,
    });
  }
}

/** Exhaustiveness guard: adding an action without a case fails the build. */
function assertNever(value: never): false {
  void value;
  return false;
}
