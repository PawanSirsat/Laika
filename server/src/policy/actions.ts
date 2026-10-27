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
  // D-102 rule 5 (LAI-958): what each org role may do — the owner's alone.
  'org.permissions.manage',
  'user.deactivate',
  // D-104 item 3 (LAI-981): end every session of a person without
  // deactivating them.
  'user.sign_out',
  // D-104 item 4 (LAI-983): issue somebody a one-time password-reset link.
  'user.reset_password',
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
  // D-114 (LAI-534): a person's registered agents — reading them, and
  // registering, renaming, granting, rotating and revoking them.
  'agent.read_own',
  'agent.manage_own',
  'unlisted.log_own',
  'heartbeat.send_own',
  'audit_log.export',
  'webhook.configure',
  'profile.read',
  'profile.set_kind',
  'profile.rate',
  'profile.activity.read',
  // D-102 rule 1 (LAI-957): a person's day, hours and shared local activity,
  // read by somebody else in the shape the person reads them.
  'people.analytics.read',
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
  // LAI-787: time (D-088) — the organisation's Time setting, a person's own
  // Draft my time, their collector's drafts and agents' proposals, and their
  // own drafts and confirmed entries.
  'org.time.set',
  'time_settings.read_own',
  'time_settings.set_own',
  'time_drafts.send_own',
  'time_drafts.read_own',
  'time_drafts.manage_own',
  'time_entries.read_own',
  'time_entries.write_own',
  // LAI-788: the Solidtime bridge (D-088 item 10) — a person's own CLI
  // writing their confirmed time to Solidtime and bringing back what they
  // logged there, and an owner's or admin's mapping and pull of everyone.
  'time_sync.own',
  'time_sync.map',
  'time_sync.import_all',
] as const;

/** SPEC §3.2 — gated by project role, with org owner/admin holding implicit lead. */
export const PROJECT_ACTIONS = [
  'project.members.manage',
  'project.settings.edit',
  'sprint.manage',
  'task.assign_sprint',
  // D-103 item 6 (LAI-976): creating is `task.write`'s, narrowed by the
  // space's own minimum role — so it is its own action.
  'task.create',
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
  // D-103 item 5 (LAI-976): any member may leave a space.
  'project.leave',
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
  // §11.6: time retention — drafts after 30 days, entries after three years
  // (D-088 item 11, LAI-787).
  'system.time.prune',
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
  // A person's own agents, grants included (D-114, LAI-534).
  'agent.read_own',
  'audit_log.export',
  'project.read',
  // A collector reads whether it may send before it does — with whatever
  // token it has, a `read_only` one included (LAI-751).
  'activity_sharing.read_own',
  // Token totals with no person in them (D-084 item 7, LAI-769): what an
  // agent may read about the work, like the rest of a project.
  'usage.read_org',
  'usage.read_project',
  // A collector asks whether it may draft before it sends (LAI-787), as it
  // asks whether it may share (above).
  'time_settings.read_own',
]);

export function isReadAction(action: Action): boolean {
  return READ_ACTIONS.has(action);
}

/**
 * The org-scoped actions a token **pinned to projects** keeps (SPEC §6.2,
 * audit H4): *"A token pinned to projects is refused org-wide admin actions.
 * When `project_ids_json` is set, the token keeps only the org-level reads
 * every member has and its own-record actions (its own tokens, heartbeats,
 * unlisted work, activity sharing, time settings and drafts); every other
 * org-scoped action — settings, projects, invites, members, other people's
 * tokens, org-wide history and usage — is refused, whatever the user's role."*
 *
 * An allow-list in `READ_ACTIONS`' style, and for the same reason: an org
 * action added without thought is refused to a pinned token, which is the safe
 * direction to be wrong in. `tokenAllows` in `can.ts` consults it for every
 * org action once the session-only check has run, so a session-only action
 * never needs an entry here — it is refused to every token before this list
 * is reached.
 *
 * **Three actions are deliberately not here.** `audit_log.export` and
 * `usage.read_org` are org-wide — the whole organisation's history and
 * figures, the opposite of a pin — and `project.join_public` changes a
 * membership outside the pin. A pinned token reads its projects' usage with
 * `usage.read_project` and their feeds through `project.read`, as a member
 * who is not an admin does.
 */
export const PINNED_TOKEN_ORG_ACTIONS: ReadonlySet<OrgAction> = new Set<OrgAction>([
  // The org-level reads every member holds (§3.1).
  'org.read',
  'presence.read',
  'capacity.read',
  'member_list.read',
  // The token's own record: its own tokens, heartbeats, unlisted work,
  // activity sharing, time settings and drafts.
  'token.create_own',
  'token.read_own',
  'token.revoke_own',
  'agent.read_own',
  'unlisted.log_own',
  'heartbeat.send_own',
  'activity_sharing.read_own',
  'local_activity.send_own',
  'time_settings.read_own',
  'time_drafts.send_own',
]);

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
  // **A person's day, drafts included, and their local activity** (D-102,
  // LAI-957): the profile's rule, and the rule the person's own `/me` reads
  // follow — a token, an agent's included, reads nobody's day.
  'people.analytics.read',
  // The organisation's switch (D-079, LAI-751 review; alone since D-102
  // amended): a token is how an agent acts, and an agent must not turn on the
  // collection of anybody's work.
  'org.developer_insights.set',
  // **The developer's own side** (D-079, LAI-751; D-102 amended). A token is
  // how an agent acts, so an agent must not be able to change which
  // repositories are counted, read back what was collected, or erase it:
  // each is the person's own decision, made signed in.
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
  // **Time is the person's** (D-088 items 3, 5 and 13, LAI-787). The
  // organisation's switch and the person's own are a signed-in person's, as
  // D-079's are; drafts are read and confirmed only by the person, signed in
  // — an agent may propose one (`time_drafts.send_own`) and never read or
  // confirm one; and confirmed time per person is never served to a token,
  // not even its own person's, the rule `usage.read_own` follows.
  'org.time.set',
  'time_settings.set_own',
  'time_drafts.read_own',
  'time_drafts.manage_own',
  'time_entries.read_own',
  'time_entries.write_own',
  // **The Solidtime bridge reads and writes hours per person** (LAI-788), so
  // it follows the rule above: the person's CLI signs in for it, with their
  // password, and keeps no session — a token, an agent's included, never
  // reads the hours it would push. Mapping people is an identity a person
  // vouches for, and pulling everyone writes everyone's hours.
  'time_sync.own',
  'time_sync.map',
  'time_sync.import_all',
  // **Who may do what is the owner's, signed in** (D-102, LAI-958): an
  // agent's token that could grant its own role a capability would hand its
  // person whatever it was refused.
  'org.permissions.manage',
  // **Handing the organisation over is the owner's, signed in** (D-104 item 2,
  // LAI-982): an agent's token that could transfer ownership could give the
  // whole organisation away in its person's name.
  'org.transfer_ownership',
  // **A reset link is the person's account** (D-104 item 4, LAI-983): an
  // agent's token that could mint one could sign in as anybody it named.
  'user.reset_password',
  // **Who an agent is and what it may reach are its owner's, signed in**
  // (D-114, LAI-534): a token that could register an agent, widen a grant or
  // rotate a credential could mint itself — or a sibling — more access.
  'agent.manage_own',
]);

/**
 * The org-scoped actions a registered agent's token keeps (D-114, LAI-534).
 *
 * An agent's token is **always pinned** — to the projects its grants name —
 * so it starts from {@link PINNED_TOKEN_ORG_ACTIONS}, and loses the two that
 * would let it out of its grants: minting a token (which would be its owner's
 * legacy credential, with no grant to narrow it) and revoking one of its
 * owner's other tokens. Its own credential is rotated or revoked by its owner,
 * signed in (`agent.manage_own`).
 */
export const AGENT_TOKEN_ORG_ACTIONS: ReadonlySet<OrgAction> = new Set<OrgAction>(
  [...PINNED_TOKEN_ORG_ACTIONS].filter(
    (action) => action !== 'token.create_own' && action !== 'token.revoke_own',
  ),
);
