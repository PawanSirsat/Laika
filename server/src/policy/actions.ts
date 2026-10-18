/**
 * The closed set of things anyone can ask to do, one entry per cell in the SPEC
 * §3.1 and §3.2 matrices.
 *
 * The naming is `<subject>.<verb>` and the ordering follows the tables row by
 * row, because a reviewer's job is to diff this against the spec by eye. Where
 * one spec row covers two distinct operations ("List / revoke anyone's token"),
 * it becomes two actions — the row is a formatting choice in the document, not a
 * claim that the operations are the same.
 */

/** SPEC §3.1 — gated by org role alone. */
export const ORG_ACTIONS = [
  'org.delete',
  'org.transfer_ownership',
  'org.settings.edit',
  'project.create',
  'project.archive',
  'user.invite',
  'user.set_role',
  'user.deactivate',
  'org.read',
  'presence.read',
  'capacity.read',
  'member_list.read',
  'project.join_public',
  'token.create_own',
  'token.read_own',
  'token.revoke_own',
  'token.list_any',
  'token.revoke_any',
  'unlisted.log_own',
  'heartbeat.send_own',
  'audit_log.export',
  'webhook.configure',
  'profile.read',
  'profile.set_kind',
  'profile.rate',
  'profile.activity.read',
  'org.developer_insights.set',
  'activity_sharing.read_own',
  'activity_sharing.set_own',
  'local_activity.send_own',
  'local_activity.read_own',
  'local_activity.delete_own',
  'usage.read_org',
  'usage.read_people',
  'usage.read_own',
  // LAI-773: an organisation's own API-equivalent prices, a person's own
  // alerts, and a developer's own plan limit (D-087).
  'org.model_prices.set',
  'token_alerts.own',
  'plan_limit.own',
] as const;

/** SPEC §3.2 — gated by project role, with org owner/admin holding implicit lead. */
export const PROJECT_ACTIONS = [
  'project.members.manage',
  'project.settings.edit',
  'sprint.manage',
  'task.assign_sprint',
  'task.write',
  'task.claim',
  'task.assign_other',
  'comment.create',
  'comment.edit',
  'comment.delete',
  'task.delete',
  'task.dependency.write',
  'task.watch',
  'project.read',
  'meeting_proposal.apply',
  'usage.read_project',
  // LAI-773: soft token budgets on a task, a sprint or the project.
  'budget.set',
] as const;

/**
 * SPEC §3.4 — held **only** by the system principal, and by no human role.
 *
 * These are the §11.6 cron's writes, and they are deliberately not §3.1 rows:
 * nobody expires an invite through the API, and a person who could would be
 * doing something the product does not offer. Giving them their own names is
 * what lets `can()` deny them to every role without a special case — an Owner
 * asking for `system.invite.expire` is asking for something §3.1 never grants,
 * which is rule 3 working rather than a rule being added.
 *
 * **The webhook is not here.** It performs `task.write` and `comment.create` —
 * the *same* actions a person performs on the same resources — because the
 * principal is what differs, not the operation. §3.4 says which existing actions
 * the system principal may take and adds only the ones with no human owner.
 */
export const SYSTEM_ACTIONS = [
  'system.heartbeat.prune',
  'system.task.flag_stale',
  'system.invite.expire',
  'system.meeting_review.expire',
  'system.local_activity.prune',
  // §11.6: the nightly refit of sizes and forecasts (D-085, LAI-771).
  'system.estimate.refit',
] as const;

export type OrgAction = (typeof ORG_ACTIONS)[number];
export type ProjectAction = (typeof PROJECT_ACTIONS)[number];
export type SystemAction = (typeof SYSTEM_ACTIONS)[number];
export type Action = OrgAction | ProjectAction | SystemAction;

export const ALL_ACTIONS: readonly Action[] = [
  ...ORG_ACTIONS,
  ...PROJECT_ACTIONS,
  ...SYSTEM_ACTIONS,
];

/**
 * Actions a `read_only` token may still perform (SPEC §6.2: "every `GET` the
 * user's role allows and nothing else").
 *
 * Listing the reads rather than the writes is deliberate — a new action added
 * without thought lands in the write set and is denied to read-only tokens,
 * which is the safe direction to be wrong in.
 */
export const READ_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'org.read',
  'presence.read',
  'capacity.read',
  'member_list.read',
  'token.read_own',
  'audit_log.export',
  'project.read',
  // A collector reads whether it may send before it does — with whatever
  // token it has, a `read_only` one included (LAI-751).
  'activity_sharing.read_own',
  // Token totals with no person in them (D-084 item 7, LAI-769): what an
  // agent may read about the work, like the rest of a project.
  'usage.read_org',
  'usage.read_project',
]);

export function isReadAction(action: Action): boolean {
  return READ_ACTIONS.has(action);
}

/**
 * Actions no personal access token may perform, whatever its scope or project
 * list — §3.1's `(session only)` cells (D-078, LAI-743).
 *
 * Every other token rule narrows a role; this one closes a door. A member's
 * profile carries private ratings, and a token is how an agent acts, so the
 * profile is answered only to a person signed in to the web app.
 *
 * **`profile.read` is deliberately not in `READ_ACTIONS`** although it reads.
 * The set above decides what a `read_only` token may do, and no token may do
 * this; listing it there would make the day this set is relaxed the day a
 * read-only token could read ratings.
 */
export const SESSION_ONLY_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'profile.read',
  'profile.set_kind',
  'profile.rate',
  // The heatmap is part of the profile, and follows its rule (D-078, D-079).
  'profile.activity.read',
  // The organisation's half of the consent (D-079, LAI-751 review): the
  // developer's own switch is session-only, so the one that lets it count is
  // too — a token is how an agent acts, and an agent must not turn on the
  // collection of its own person's work.
  'org.developer_insights.set',
  // **The developer's consent, and what follows from it** (D-079, LAI-751).
  // A token is how an agent acts, so an agent must not be able to switch
  // sharing on, read back what was collected, or erase it: each is the
  // person's own decision, made signed in.
  'activity_sharing.set_own',
  'local_activity.read_own',
  'local_activity.delete_own',
  // **Whoever holds the GitHub webhook secret can sign deliveries that confirm
  // an agent's proof** (D-083, LAI-753). Setting it answers it in plaintext,
  // so an agent's token must not be able to mint one and vouch for itself.
  'webhook.configure',
  // **Anybody's tokens, split by person** (D-084 item 7, LAI-769): the
  // profile's rule, because a per-person figure is about a person. A token is
  // how an agent acts, so not even the person's own token reads their own.
  'usage.read_people',
  'usage.read_own',
  // **Prices and budgets are the figures that exist to watch agents** (LAI-773):
  // an agent's token that could lower a price or raise its own task's budget
  // would silence the alert meant for its person.
  'org.model_prices.set',
  'budget.set',
  // A person's own alerts and plan limit (D-087): theirs, signed in — the
  // plan limit is never served to anybody else, an agent included.
  'token_alerts.own',
  'plan_limit.own',
]);
