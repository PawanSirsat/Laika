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
]);

export function isReadAction(action: Action): boolean {
  return READ_ACTIONS.has(action);
}
