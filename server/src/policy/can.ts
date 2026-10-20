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
import {
  type Action,
  isReadAction,
  type OrgAction,
  type ProjectAction,
  SESSION_ONLY_ACTIONS,
  type SystemAction,
} from './actions.ts';
import { ORG_ACTIONS, PROJECT_ACTIONS, SYSTEM_ACTIONS } from './actions.ts';

export { type Action, type OrgAction, type ProjectAction } from './actions.ts';

/** The credential a token-authenticated request carries (SPEC §4.9, §6.2). */
export interface TokenContext {
  /** The `tokens` row this request arrived on — the audit trail's `token_id`. */
  id: string;
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
  /**
   * For `profile.rate`: the person being rated. §3.1's *"not themselves"* is
   * this compared with `actor.userId`, and an absent target is a denial
   * (LAI-743).
   */
  targetUserId?: string | undefined;
}

const ORG_ACTION_SET: ReadonlySet<string> = new Set(ORG_ACTIONS);
const SYSTEM_ACTION_SET: ReadonlySet<string> = new Set(SYSTEM_ACTIONS);
const PROJECT_ACTION_SET: ReadonlySet<string> = new Set(PROJECT_ACTIONS);

function isOrgAction(action: Action): action is OrgAction {
  return ORG_ACTION_SET.has(action);
}

function isProjectAction(action: Action): action is ProjectAction {
  return PROJECT_ACTION_SET.has(action);
}

function isSystemAction(action: Action): action is SystemAction {
  return SYSTEM_ACTION_SET.has(action);
}

/**
 * A trigger with no human behind it — the §11.6 cron and §10.1's webhook
 * (SPEC §3.4, D-050, LAI-448).
 *
 * ## Why it is a distinct kind and not a user
 *
 * §3.3 rule 1 says **every** write calls `assertCan`, *"webhook-triggered,
 * cron-triggered"* included, and rule 2 says the caller passes in a principal.
 * Cron had neither: eight writes and no `assertCan` at all.
 *
 * The tempting fixes are both refused by D-050. **A sentinel `userId`** — a user
 * row that means "the system" — is one refactor from being handed a real user's
 * authority, and one join from appearing in a member list. **An `orgRole`** is
 * worse: `owner` would work, and would turn a leaked webhook secret into an org
 * takeover rather than a nuisance.
 *
 * So it is its own shape with a literal discriminant. It cannot be mistaken for
 * an `Actor` by the type system, it has no role to inherit from, and it holds
 * exactly what §3.4 lists.
 *
 * ## Authority, not attribution
 *
 * This decides what a trigger may **do**. What the resulting `activity` row
 * *says* is a separate question §4.8 already answers — `actor_kind: 'system'`,
 * `actor_id: null` — and this type deliberately carries neither. Conflating them
 * is how a principal acquires an identity by accident.
 */
export interface SystemPrincipal {
  readonly kind: 'system';
  /**
   * The project a webhook delivery resolved to, or `null` for org-wide
   * maintenance.
   *
   * §10.1's *"branch → task"* can resolve to nothing — a push on `main` is a
   * normal delivery — and §9.2's rule is that it degrades rather than errors. A
   * `null` here therefore has to **deny** every project action rather than widen
   * to all of them, which is rule 3 read the only way it can be.
   */
  readonly projectId: string | null;
}

/** Everything `can()` will answer about. */
export type Principal = Actor | SystemPrincipal;

/** The §11.6 cron: org-wide maintenance, no project. */
export function systemPrincipal(projectId: string | null = null): SystemPrincipal {
  return { kind: 'system', projectId };
}

function isSystem(principal: Principal): principal is SystemPrincipal {
  return 'kind' in principal && principal.kind === 'system';
}

/**
 * SPEC §3.4's grant, in full.
 *
 * **Existing actions, not new ones, wherever a human does the same thing.** The
 * webhook moves a task and writes a comment; those are `task.write` and
 * `comment.create` on the resolved project, and giving them system-only twins
 * would mean two rules for one operation and eventually two answers.
 *
 * The `system.*` actions are the ones with no human owner: nobody expires
 * an invite through the API. They are denied to every role by construction —
 * §3.1 and §3.2 have no row for them, so `canOrgAction`/`canProjectAction` never
 * see them — which is deny-by-default doing the work rather than a special case.
 */
const SYSTEM_GRANT: ReadonlySet<Action> = new Set<Action>([
  // §11.6, the cron.
  'system.heartbeat.prune',
  'system.task.flag_stale',
  'system.invite.expire',
  'system.meeting_review.expire',
  'system.local_activity.prune',
  'system.estimate.refit',
  'system.time.prune',
  // §10.1, the webhook — project-scoped, see below.
  'task.write',
  'comment.create',
]);

/** Which of §3.4's grants need a project, and therefore a resolved delivery. */
const SYSTEM_PROJECT_SCOPED: ReadonlySet<Action> = new Set<Action>([
  'task.write',
  'comment.create',
]);

function canSystem(principal: SystemPrincipal, action: Action, resource: Resource): boolean {
  if (!SYSTEM_GRANT.has(action)) return false;
  if (!SYSTEM_PROJECT_SCOPED.has(action)) return true;

  // Scoped to the delivery that resolved. A principal with no project, or one
  // asked about a different project, does nothing — the same shape as a token's
  // project whitelist, and for the same reason.
  return (
    principal.projectId !== null &&
    resource.projectId !== undefined &&
    resource.projectId === principal.projectId
  );
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

    // | View the organisation | ✓ | ✓ | ✓ | ✓ |
    //
    // Deliberately **not** folded into `member_list.read`, which was the obvious
    // borrow and is wrong (LAI-222). "If you may see who is in the org you may
    // see its name" is true of today's payload and is not a property of the row:
    // §11.4.2's Organisation screen also carries the AI provider block, and
    // whether an org has an LLM wired up is not implied by who its members are.
    // A borrowed row would have handed the next field added to this response a
    // grant nobody reviewed — D-037's shape, in a permission matrix.
    //
    // The provider block is gated field-level on `org.settings.edit` instead;
    // see `services/orgs.ts`.
    // | Presence and capacity | ✓ | ✓ | ✓ | ✓ |
    //
    // Every role may ask. **The row does not decide what comes back** — a
    // heartbeat is only shown to somebody who can read one of the projects it
    // attributes to (§9.1), so the answer narrows to the caller rather than the
    // permission doing it. Capacity's `unlisted` narrows again, on
    // `audit_log.export`, because that is what reading unlisted work already
    // costs (LAI-432).
    //
    // Both are in `READ_ACTIONS`: they read and they are safe for a `read_only`
    // token, which is what such a token is for.
    case 'presence.read':
    case 'capacity.read':

    case 'org.read':

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

    // | Log own unlisted work | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
    //
    // Every role, because it is **your own record about your own work**: it
    // creates nothing in any project and is visible to nobody who could not
    // already read the audit log. Triage is the restricted half and follows
    // *Export audit log* below — anyone may add to the pile, few may act on it.
    //
    // The Viewer cell is ✓ rather than —, and that is deliberate: the
    // restriction on a Viewer comes from the **credential**, not the role.
    // Their token is forced to `read_only` (§4.9), and `tokenAllows` refuses
    // every non-read action — so a Viewer cannot reach this in practice while
    // the matrix still says what should happen if that forcing were relaxed.
    case 'unlisted.log_own':
      return true;

    // | Send own heartbeat | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
    //
    // The same shape as the row above, and for the same reason: presence is
    // **your own record about your own work**. It creates nothing in any
    // project, and §9.1 restricts it to token auth, so the Viewer cell is the
    // role's answer while the credential is what actually stops them.
    //
    // Metadata only (D-005, §9.1) — repo, branch, timestamp. The permission is
    // not what keeps that true; the schema and the request validation are.
    case 'heartbeat.send_own':
      return true;

    // | Export audit log | ✓ | ✓ | — | — |
    case 'audit_log.export':
      return isAdminUp;

    // | Configure webhooks | ✓ (session only) | ✓ (session only) | — | — |
    case 'webhook.configure':
      return isAdminUp;

    // | View a member's profile | ✓ (session only) | ✓ (session only) | — | — |
    // | Set a member's profile kind | ✓ (session only) | ✓ (session only) | — | — |
    //
    // Their own rows, not borrowed from `member_list.read` or `user.set_role`
    // (LAI-743): the profile carries private ratings, which nothing about the
    // member list implies, and a borrowed row hands its next field a grant
    // nobody reviewed (LAI-222's argument at `org.read`).
    //
    // "session only" is `tokenAllows`'s half, below. **The profile kind is not
    // an input here or anywhere in this file** (D-078): it is a label on the
    // profile, and a test holds every answer equal for a builder and a manager.
    case 'profile.read':
    case 'profile.set_kind':
      return isAdminUp;

    // | Rate a member | ✓ (session only, not themselves) | … | — | — |
    // A rating of yourself is refused; so is a rating of nobody in particular.
    case 'profile.rate':
      return (
        isAdminUp && resource.targetUserId !== undefined && resource.targetUserId !== actor.userId
      );

    // | View a member's activity heatmap | ✓ (session only) | ✓ (session only) | — | — |
    //
    // Its own row, not `profile.read` borrowed (D-079, LAI-751): the heatmap
    // carries counts sent from a developer's machine, which the rest of the
    // profile does not, and a borrowed row would hand them a grant nobody
    // reviewed. Today the two answer alike, as D-078 and D-079 both say.
    case 'profile.activity.read':
      return isAdminUp;

    // | Turn Developer insights on or off | ✓ (session only) | ✓ (session only) | — | — |
    //
    // The organisation's switch of D-079, its own row rather than
    // `org.settings.edit` borrowed: that one a token may hold, and this one
    // no token may (LAI-751 review).
    case 'org.developer_insights.set':
      return isAdminUp;

    // | Read own activity-sharing setting | ✓ | ✓ | ✓ | ✓ |
    // | Set own activity sharing | ✓ (session only) | … | ✓ (session only) |
    // | Send own local activity | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
    // | Read / delete own local activity | ✓ (session only) | … | ✓ (session only) |
    //
    // Every role, because it is **their own record about their own work**
    // (D-079) — the heartbeat's argument. What stops collection is the two
    // switches, which the service reads; what stops an agent consenting for
    // its person is `SESSION_ONLY_ACTIONS`, below. The Viewer's send cell is
    // the credential's refusal, exactly as for heartbeats: a Viewer's token is
    // forced `read_only`, and sending is not a read.
    case 'activity_sharing.read_own':
    case 'activity_sharing.set_own':
    case 'local_activity.send_own':
    case 'local_activity.read_own':
    case 'local_activity.delete_own':
      return true;

    // | View the organisation's token usage | ✓ | ✓ | — | — |
    // | View anyone's token usage, per person | ✓ (session only) | ✓ (session only) | — | — |
    // | View own token usage | ✓ (session only) | … | ✓ (session only) |
    //
    // D-084 item 7 (LAI-769): owners and admins see everyone, a developer
    // their own. The organisation's figure is its own row rather than
    // `audit_log.export` borrowed — the two answer alike today and mean
    // different things. A member reads a project's totals through §3.2's
    // `usage.read_project`, and never a per-person split.
    case 'usage.read_org':
    case 'usage.read_people':
      return isAdminUp;

    case 'usage.read_own':
      return true;

    // | Set API-equivalent prices | ✓ (session only) | ✓ (session only) | — | — |
    //
    // LAI-773: who may set the org's AI provider may set what its models cost.
    // Its own row, not `org.settings.edit` borrowed, because a token may hold
    // that one and must not hold this (`SESSION_ONLY_ACTIONS`).
    case 'org.model_prices.set':
      return isAdminUp;

    // | Read and dismiss own token alerts | ✓ (session only) | … | ✓ (session only) |
    // | Read and set own plan limit | ✓ (session only) | … | ✓ (session only) |
    //
    // The person's own (LAI-773, D-087): every role, and nobody else's — the
    // services ask for the caller's own rows and no row lets anyone read
    // another's.
    case 'token_alerts.own':
    case 'plan_limit.own':
      return true;

    // | Set the organisation's Time setting | ✓ (session only) | ✓ (session only) | — | — |
    //
    // D-088 item 5's organisation switch (LAI-787): its own row, not
    // `org.settings.edit` borrowed, for `org.developer_insights.set`'s reason
    // — a token may hold that one, and an agent must not turn on the drafting
    // of its own person's day.
    case 'org.time.set':
      return isAdminUp;

    // | Read own time settings | ✓ | ✓ | ✓ | ✓ |
    // | Set own Draft my time | ✓ (session only) | … | ✓ (session only) |
    // | Send own time drafts | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
    // | Read and manage own time drafts | ✓ (session only) | … | ✓ (session only) |
    // | Read and write own time entries | ✓ (session only) | … | ✓ (session only) |
    //
    // Every role: **a person's time is their own** (D-088), and the services
    // read and write the caller's own rows only — no row lets anybody read
    // another's. What stops drafting is the two switches, which the services
    // read; what stops an agent reading or confirming a draft, or reading
    // anyone's hours, is `SESSION_ONLY_ACTIONS`. The Viewer's send cell is the
    // credential's refusal, as for heartbeats and local activity.
    case 'time_settings.read_own':
    case 'time_settings.set_own':
    case 'time_drafts.send_own':
    case 'time_drafts.read_own':
    case 'time_drafts.manage_own':
    case 'time_entries.read_own':
    case 'time_entries.write_own':
      return true;

    // | Sync own time with Solidtime | ✓ (session only) | … | ✓ (session only) |
    // | Map Solidtime projects and people | ✓ (session only) | ✓ (session only) | — | — |
    // | Import everyone's Solidtime time | ✓ (session only) | ✓ (session only) | — | — |
    //
    // D-088 item 10 (LAI-788). A person's own time is theirs to sync, every
    // role, the time-entry rows' reason; the services touch the caller's own
    // entries only. Saying which Solidtime member is which person, and
    // bringing everyone's hours in, are an owner's or admin's — D-088 item 7
    // puts per-person hours with them. All three are `SESSION_ONLY_ACTIONS`.
    case 'time_sync.own':
      return true;

    case 'time_sync.map':
    case 'time_sync.import_all':
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

    // | Watch / unwatch a task | ✓ | ✓ | ✓ |
    //
    // Every project role, including `viewer`: anyone who may read a task may
    // choose to hear about it, and watching grants nothing a reader does not
    // already have.
    //
    // **Its own action, and deliberately absent from `READ_ACTIONS`** (D-047).
    // Grading it as `project.read` would conflate *who may* with *which
    // credential may* — §3.3 rule 4 exists so those can differ. §6.2 says a
    // `read_only` token permits "every GET the user's role allows and nothing
    // else", and `PUT /watch` is not a GET.
    //
    // The argument that a subscription is private to its holder is defeated by
    // `GET /tasks/:id/watchers`: **a watch is readable by other people, so it is
    // shared state**, and a credential that cannot change anything must not add
    // its holder to a list somebody else sees.
    case 'task.watch':
      return true;

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

    // | Read a project's token totals | ✓ | ✓ | ✓ |
    //
    // Totals only (D-084 item 7, LAI-769): whoever reads the project reads
    // what its tasks cost. A per-person split is §3.1's `usage.read_people`.
    case 'usage.read_project':
      return true;

    // | Set token budgets | ✓ (session only) | — | — |
    //
    // LAI-773: a lead decides what work here may cost before it is flagged —
    // as sprints are a lead's. Soft: a budget refuses nothing to anybody.
    case 'budget.set':
      return isLead;

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

  // §3.1's "session only" (D-078, LAI-743): no token of any scope, for anyone.
  // Before the whitelist and scope checks, because neither would refuse an
  // Owner's full, unscoped token — and that is the token that matters.
  if (SESSION_ONLY_ACTIONS.has(action)) return false;

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
export function can(principal: Principal, action: Action, resource: Resource = {}): boolean {
  // §3.4's principal is answered on its own table and never falls through to a
  // role, which it does not have.
  if (isSystem(principal)) return canSystem(principal, action, resource);

  const actor = principal;
  // A deactivated user keeps their rows for history but can do nothing (§4.1).
  if (!actor.isActive) return false;

  // A `system.*` action belongs to no role. Denied here rather than by omission
  // so the reason is readable: §3 grants it to nobody, and an Owner asking for
  // it is asking for something the product does not offer.
  if (isSystemAction(action)) return false;

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
export function assertCan(principal: Principal, action: Action, resource: Resource = {}): void {
  if (can(principal, action, resource)) return;

  // §3.1's "session only", said as such (LAI-751): the person may, and the
  // credential is why not. A caller told only `forbidden` cannot tell "sign
  // in to the web app" from "you may never", and a collector must stop on
  // the second and not on the first. Still `forbidden` — §6.3's vocabulary is
  // closed — with the reason in `details`, as heartbeats say `token_required`.
  if (
    !isSystem(principal) &&
    principal.token !== null &&
    principal.token !== undefined &&
    SESSION_ONLY_ACTIONS.has(action) &&
    can({ ...principal, token: null }, action, resource)
  ) {
    throw new ApiError('forbidden', 'This needs a signed-in web session, not a token', {
      action,
      reason: 'session_required',
    });
  }

  throw new ApiError('forbidden', 'You do not have permission to perform this action', {
    action,
  });
}

/** Exhaustiveness guard: adding an action without a case fails the build. */
function assertNever(value: never): false {
  void value;
  return false;
}
