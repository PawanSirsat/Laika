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
import {
  type AgentGrantScope,
  type AgentStatus,
  type OrgRole,
  type ProjectRole,
  type TaskCreateMinRole,
  type TokenScope,
} from '../db/enums.ts';
import {
  type Action,
  AGENT_TOKEN_ORG_ACTIONS,
  isReadAction,
  type OrgAction,
  PINNED_TOKEN_ORG_ACTIONS,
  type ProjectAction,
  SESSION_ONLY_ACTIONS,
  type SystemAction,
} from './actions.ts';
import { ORG_ACTIONS, PROJECT_ACTIONS, SYSTEM_ACTIONS } from './actions.ts';
import { capabilityOf, holdsCapability, implicitProjectRole, type OrgGrants } from './grants.ts';

export { type Action, type OrgAction, type ProjectAction } from './actions.ts';

/** The credential a token-authenticated request carries (SPEC §4.9, §6.2). */
export interface TokenContext {
  /** The `tokens` row this request arrived on — the audit trail's `token_id`. */
  id: string;
  scope: TokenScope;
  /** `null` = every project the user can reach. Otherwise a whitelist. */
  projectIds: readonly string[] | null;
  /**
   * The registered agent this token is the credential of (D-114, LAI-534), or
   * absent / `null` for a legacy token. Loaded from `tokens.agent_id` and
   * nothing else: no header, parameter or body field can put one here.
   */
  agent?: AgentContext | null | undefined;
}

/** A registered agent, as the token that carries it presents it (§4.63). */
export interface AgentContext {
  id: string;
  displayName: string;
  harness: string;
  deviceLabel: string | null;
  status: AgentStatus;
  /** Project id → the agent's grant there (§4.64). Absent = no access. */
  grants: ReadonlyMap<string, AgentGrantScope>;
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
  /**
   * The organisation's grants, every role's (§3, §4.58, LAI-958), loaded by
   * the caller with the actor. Absent or `null` means the defaults — today's
   * behaviour — which is what an org whose owner never changed them has.
   * The whole matrix rather than the actor's own row, so the catalogue can
   * answer for every role from the actor it already has.
   */
  orgGrants?: OrgGrants | null | undefined;
  /**
   * Each project's own rules (D-103 items 6 and 7, LAI-976), by project id,
   * loaded by the caller with the actor as the grants are. A project absent
   * from the map — or no map at all — has the defaults: members create tasks,
   * agents may write. `can()` reads the entry for `resource.projectId`, so a
   * caller cannot ask about one project with another's rules.
   */
  projectRules?: ReadonlyMap<string, ProjectRules> | null | undefined;
}

/** What a space decides for itself (§4.3, D-103). */
export interface ProjectRules {
  /** Who may create tasks: `member` (and up) or `lead` only. Viewers never. */
  taskCreateMinRole: TaskCreateMinRole;
  /** `false`: an agent token may only read in this project. People are unaffected. */
  agentsAllowed: boolean;
}

export const DEFAULT_PROJECT_RULES: ProjectRules = {
  taskCreateMinRole: 'member',
  agentsAllowed: true,
};

export function rulesFor(actor: Actor, projectId: string | undefined): ProjectRules {
  if (projectId === undefined) return DEFAULT_PROJECT_RULES;
  return actor.projectRules?.get(projectId) ?? DEFAULT_PROJECT_RULES;
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
  /**
   * For `user.invite`: the role the invite grants. Anyone but an owner may
   * invite only as `member` or `viewer` (D-102 rule 5, LAI-958).
   */
  targetOrgRole?: OrgRole | undefined;
  /**
   * For `profile.rate` and `people.analytics.read`: the person being rated or
   * read. §3.1's *"not themselves"* is this compared with `actor.userId`, and
   * an absent target is a denial (LAI-743, LAI-957).
   */
  targetUserId?: string | undefined;
}

const ORG_ACTION_SET: ReadonlySet<string> = new Set(ORG_ACTIONS);
const SYSTEM_ACTION_SET: ReadonlySet<string> = new Set(SYSTEM_ACTIONS);
const PROJECT_ACTION_SET: ReadonlySet<string> = new Set(PROJECT_ACTIONS);

function isOrgAction(action: Action): action is OrgAction {
  return ORG_ACTION_SET.has(action);
}

/** §6.2 (audit H4): the org actions a project-pinned token keeps. */
function isPinnedTokenOrgAction(action: OrgAction): boolean {
  return PINNED_TOKEN_ORG_ACTIONS.has(action);
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
  'system.claim.expire',
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
 *  - an org role holding *Open every project* has an **implicit** project role
 *    everywhere and never needs a membership row — `lead`, which is what org
 *    `owner` always and `admin` by default hold (LAI-958);
 *  - an org `viewer` may hold **only** project role `viewer`. A membership row
 *    saying otherwise is data corruption or an escalation attempt, and is capped
 *    here rather than trusted (D-006) — and so is the grant.
 */
export function effectiveProjectRole(actor: Actor): ProjectRole | null {
  const implicit = implicitProjectRole(actor.orgRole, actor.orgGrants);
  if (implicit === 'lead') return 'lead';
  if (actor.projectRole === null) return implicit;
  if (actor.orgRole === 'viewer') return 'viewer';
  return actor.projectRole;
}

/**
 * Whether the actor's org role holds the capability that decides `action`
 * (§3's grants, LAI-958). Called only for the actions a capability carries;
 * every other §3.1 row is answered by its role alone, as before.
 */
function granted(actor: Actor, action: OrgAction): boolean {
  const capability = capabilityOf(action);
  return capability !== null && holdsCapability(actor.orgRole, actor.orgGrants, capability);
}

/** SPEC §3.1, row by row. */
function canOrgAction(actor: Actor, action: OrgAction, resource: Resource): boolean {
  const { orgRole } = actor;
  const isAdminUp = orgRole === 'owner' || orgRole === 'admin';

  switch (action) {
    // | Delete org data | ✓ | — | — | — |
    // | Transfer ownership | ✓ (session only) | — | — | — |
    // | Change org roles | ✓ | — | — | — |
    // | Set what each role may do | ✓ (session only) | — | — | — |
    //
    // Owner only and never grantable (D-102 rules 5 and 6, LAI-958): a role
    // that could change roles or grants could give itself anything else.
    case 'org.delete':
    case 'org.transfer_ownership':
    case 'user.set_role':
    case 'org.permissions.manage':
      return orgRole === 'owner';

    // | Org settings (AI provider, SMTP, signup mode) | ✓ | ✓ | — | — |
    //
    // From here, a row that a capability carries (§3's grants, LAI-958) is
    // answered by the grant: the owner always, and the Admin cell is the
    // default — `granted` reads the organisation's actual matrix.
    case 'org.settings.edit':
      return granted(actor, action);

    // | Create / archive project | ✓ | ✓ | — | — |
    //
    // *Create and archive spaces* (D-104 item 6, LAI-985).
    case 'project.create':
    case 'project.archive':
      return granted(actor, action);

    // | Invite users | ✓ | ✓ (as member or viewer) | — | — |
    //
    // An invite is a role grant with a delay on it, so only the owner invites
    // an admin or an owner (D-102 rule 5): a role that may not change roles
    // must not mint them either. **No `targetOrgRole` is listing or revoking**,
    // which grants no role and is the grant's alone.
    case 'user.invite':
      if (!granted(actor, action)) return false;
      if (orgRole === 'owner' || resource.targetOrgRole === undefined) return true;
      return resource.targetOrgRole === 'member' || resource.targetOrgRole === 'viewer';

    // | Deactivate user | ✓ | ✓ | — | — |
    case 'user.deactivate':
      return granted(actor, action);

    // | Sign a person out everywhere | ✓ | ✓ | ✓ (themselves) | ✓ (themselves) |
    //
    // Anyone may end their own sessions; ending somebody else's is the power
    // to deactivate them, short of doing it (D-104 item 3, LAI-981), so it is
    // carried with `user.deactivate` by *Deactivate people and reset access*
    // (LAI-985).
    case 'user.sign_out':
      return resource.targetUserId === actor.userId || granted(actor, action);

    // | Issue a password-reset link | ✓ (session only) | ✓ (session only, not for the owner) | — | — |
    //
    // D-104 item 4 (LAI-983): a link for the owner is the owner's account, so
    // only the owner issues one — the `user.invite` shape, on the target's
    // role. Carried by *Deactivate people and reset access* (LAI-985).
    case 'user.reset_password':
      if (!granted(actor, action)) return false;
      return orgRole === 'owner' || resource.targetOrgRole !== 'owner';

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

    // | Read own agents | ✓ | ✓ | ✓ | ✓ |
    // | Register and manage own agents | ✓ (session only) | … | ✓ (session only) |
    //
    // D-114 (LAI-534): **a person's agents are their own**, every role, and
    // nobody else's — the service reads and writes the caller's own rows only,
    // as for time entries, so no row lets anyone reach another's agent. What
    // stops an agent from managing itself or a sibling is `SESSION_ONLY_ACTIONS`.
    case 'agent.read_own':
    case 'agent.manage_own':
      return true;

    // | List / revoke **anyone's** token | ✓ | ✓ | — | — |
    //
    // *Manage anyone's tokens* (D-104 item 6, LAI-985).
    case 'token.list_any':
    case 'token.revoke_any':
      return granted(actor, action);

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
      return granted(actor, action);

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
    //
    // Reading is *See everyone's analytics* (LAI-958); setting the kind is
    // not part of seeing, and stays the Admin's.
    case 'profile.read':
      return granted(actor, action);

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
      return granted(actor, action);

    // | View a member's day, time and shared activity | ✓ (session only, not themselves) | … | — | — |
    //
    // D-102 rule 1 (LAI-957): My day and the local activity a person reads
    // of their own, read for them — *See everyone's analytics*. **Not
    // themselves**: a person reads their own on `/me`, where nothing is
    // logged, and a self-read here would write a view log row saying they
    // looked at themselves. An absent target is a denial, as for a rating.
    case 'people.analytics.read':
      return (
        granted(actor, action) &&
        resource.targetUserId !== undefined &&
        resource.targetUserId !== actor.userId
      );

    // | Turn Developer insights on or off | ✓ (session only) | ✓ (session only) | — | — |
    //
    // The organisation's switch of D-079, its own row rather than
    // `org.settings.edit` borrowed: that one a token may hold, and this one
    // no token may (LAI-751 review). Granted with it, as one capability.
    case 'org.developer_insights.set':
      return granted(actor, action);

    // | Read own activity-sharing setting | ✓ | ✓ | ✓ | ✓ |
    // | Set own local-activity scope | ✓ (session only) | … | ✓ (session only) |
    // | Send own local activity | ✓ | ✓ | ✓ | ✓ (`read_only` forced, so never in practice) |
    // | Read / delete own local activity | ✓ (session only) | … | ✓ (session only) |
    //
    // Every role, because it is **their own record about their own work**
    // (D-079) — the heartbeat's argument. What stops collection is the
    // organisation's switch alone (D-102 amended), which the service reads;
    // what stops an agent acting for its person is `SESSION_ONLY_ACTIONS`. The Viewer's send cell is
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
      return isAdminUp;

    // Per person is *See everyone's analytics* (LAI-958).
    case 'usage.read_people':
      return granted(actor, action);

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
      return granted(actor, action);

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

    // | Create tasks | ✓ | ✓ (unless space admins only) | — |
    //
    // D-103 item 6: the space decides between its members and its leads.
    // A viewer is below both, so never.
    case 'task.create':
      return rulesFor(actor, resource.projectId).taskCreateMinRole === 'lead' ? isLead : isMemberUp;

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

    // | Edit / move any task | ✓ | ✓ | — |
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

    // | Leave a project | ✓ | ✓ | ✓ |
    //
    // D-103 item 5. The last lead is refused by the service (409
    // `last_lead`), not here: that is a fact about the other rows, which a
    // pure function is not given.
    case 'project.leave':
      return true;

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

  // §6.2 (audit H4): a token pinned to projects is refused org-wide admin
  // actions, whatever the user's role. The pin used to be read only against a
  // project, so an Admin's token pinned to one project still invited, created
  // projects and edited the organisation — a project filter on an org
  // credential, which §3.3 says a token never is. The classification is the
  // one `can()` already dispatches on, never re-derived from the name.
  if (token.projectIds !== null && isOrgAction(action) && !isPinnedTokenOrgAction(action)) {
    return false;
  }

  // A token may be pinned to a subset of the user's projects (§4.9). An action
  // with no project is org-scoped and answered above; one with a project is
  // answered by the whitelist.
  if (token.projectIds !== null && resource.projectId !== undefined) {
    if (!token.projectIds.includes(resource.projectId)) return false;
  }

  if (!agentGrantAllows(token, action, resource)) return false;

  return effectiveTokenScope(actor, token) === 'full' || isReadAction(action);
}

/** Why an agent's grant refuses an action, or `null` when it does not (D-114). */
export type AgentRefusal = 'agent_token' | 'agent_not_granted' | 'agent_read_only';

/**
 * D-114's agent step, inside the token narrowing: effective access is the
 * owner's permissions ∩ the agent's grant for the project ∩ the token's scope
 * and pin. The owner's half is the role decision `can()` already made; the
 * token's is the rest of `tokenAllows`; this is the grant's.
 *
 * - **An agent's token is always pinned** — to the projects its grants name —
 *   so of the org actions it keeps only {@link AGENT_TOKEN_ORG_ACTIONS}.
 * - **A project action needs a grant for that project**, and a `read_only`
 *   grant keeps the reads, as a `read_only` token does.
 * - **A project action with no project is refused**: there is no grant to read.
 *
 * The project's hand-off policy (proposal §4.5) is not read here: it governs
 * delegation and transfer only, none of which exists yet, and it must never
 * narrow a read or a comment.
 */
export function agentRefusal(
  token: TokenContext,
  action: Action,
  resource: Resource,
): AgentRefusal | null {
  const agent = token.agent;
  if (agent === undefined || agent === null) return null;

  if (isOrgAction(action)) return AGENT_TOKEN_ORG_ACTIONS.has(action) ? null : 'agent_token';
  if (!isProjectAction(action)) return 'agent_token';

  const grant = resource.projectId === undefined ? undefined : agent.grants.get(resource.projectId);
  if (grant === undefined) return 'agent_not_granted';
  if (grant === 'read_only' && !isReadAction(action)) return 'agent_read_only';
  return null;
}

function agentGrantAllows(token: TokenContext, action: Action, resource: Resource): boolean {
  return agentRefusal(token, action, resource) === null;
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

  if (!agentsMay(actor, action, resource)) return false;

  return tokenAllows(actor, action, resource);
}

/**
 * D-103 item 7 (LAI-976): in a space whose agents are off, a token — which is
 * how an agent acts (§7) — reads and does nothing else. A narrowing, like the
 * token's own scope, so a person on a web session is never touched by it.
 */
export function agentsMay(actor: Actor, action: Action, resource: Resource): boolean {
  if (actor.token === null || actor.token === undefined) return true;
  if (!isProjectAction(action)) return true;
  if (rulesFor(actor, resource.projectId).agentsAllowed) return true;
  return isReadAction(action);
}

/**
 * D-103 item 7 on its own, for a write that no project action authorises
 * (LAI-976 review). Deactivating someone is `user.deactivate`, an org
 * action, and it moves their tasks in every space — so the space rule has to
 * be asked of each space those tasks are in, without asking a role question
 * the caller's org authority has already answered.
 */
export function assertAgentsMay(actor: Actor, action: Action, resource: Resource): void {
  if (agentsMay(actor, action, resource)) return;
  throw new ApiError('forbidden', 'This space does not let agents make changes', {
    action,
    reason: 'agents_off',
  });
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

  // §6.2's pin (audit H4), said as such for the same reason: the person may,
  // and the same token unpinned may, so the pin is why not — a caller told
  // only `forbidden` cannot tell "mint a token without a project list" from
  // "you may never". Compared against the token unpinned rather than the
  // person, so a `read_only` pinned token refused a write is told nothing
  // the pin did not do.
  if (
    !isSystem(principal) &&
    principal.token !== null &&
    principal.token !== undefined &&
    principal.token.projectIds !== null &&
    isOrgAction(action) &&
    !isPinnedTokenOrgAction(action) &&
    can({ ...principal, token: { ...principal.token, projectIds: null } }, action, resource)
  ) {
    throw new ApiError(
      'forbidden',
      'This token is pinned to projects and cannot act on the organisation',
      { action, reason: 'project_pinned' },
    );
  }

  // D-114's agent grant, said as such for the same reason: the person may,
  // and the same token with no agent may, so the agent's grant is why not. An
  // agent told only `forbidden` cannot tell "ask your owner for this project"
  // from "your owner may not either".
  if (
    !isSystem(principal) &&
    principal.token?.agent !== null &&
    principal.token?.agent !== undefined
  ) {
    const refusal = agentRefusal(principal.token, action, resource);
    if (
      refusal !== null &&
      can({ ...principal, token: { ...principal.token, agent: null } }, action, resource)
    ) {
      throw new ApiError('forbidden', AGENT_REFUSAL_MESSAGES[refusal], {
        action,
        reason: refusal,
      });
    }
  }

  // D-103's two space rules, said as such for the same reason: an agent told
  // only `forbidden` cannot tell "this space keeps agents out" from "you may
  // not", and a member cannot tell "space admins only" from either.
  if (!isSystem(principal)) {
    const rules = rulesFor(principal, resource.projectId);
    const relaxed = { ...principal, projectRules: null };

    if (!agentsMay(principal, action, resource) && can(relaxed, action, resource)) {
      throw new ApiError('forbidden', 'This space does not let agents make changes', {
        action,
        reason: 'agents_off',
      });
    }

    if (
      action === 'task.create' &&
      rules.taskCreateMinRole === 'lead' &&
      can(relaxed, action, resource)
    ) {
      throw new ApiError('forbidden', 'Only space admins may create tasks in this space', {
        action,
        reason: 'task_create_min_role',
        task_create_min_role: rules.taskCreateMinRole,
      });
    }
  }

  throw new ApiError('forbidden', 'You do not have permission to perform this action', {
    action,
  });
}

const AGENT_REFUSAL_MESSAGES: Readonly<Record<AgentRefusal, string>> = {
  agent_token: "An agent's token cannot do this; its owner can, signed in",
  agent_not_granted: 'This agent has no access to this project',
  agent_read_only: 'This agent may only read in this project',
};

/** Exhaustiveness guard: adding an action without a case fails the build. */
function assertNever(value: never): false {
  void value;
  return false;
}
