/**
 * The closed vocabularies from SPEC §4, in one place.
 *
 * Each is a `const` tuple so it serves three purposes at once: Drizzle's `enum`
 * option (which produces the TypeScript union), the SQL `CHECK` constraint that
 * enforces it in the database, and a runtime list for validation. Declaring them
 * once is what stops the three from drifting apart.
 */

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PROJECT_ROLES = ['lead', 'member', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_VISIBILITIES = ['public', 'private'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

/** SPEC §4.5 and §5. `backlog` is unrefined; `todo` is groomed. */
export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['p1', 'p2', 'p3'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** How a row came to exist — the same enum on `tasks` and `comments` (§4.5, §4.7). */
export const CREATED_VIA = ['web', 'mcp', 'api', 'webhook', 'meeting'] as const;
export type CreatedVia = (typeof CREATED_VIA)[number];

/**
 * §4.8 and D-022. `user` = session cookie, `agent` = token-authenticated,
 * `system` = no human at all — cron (§11.6) or an inbound webhook (§10).
 *
 * `system` exists so that a null `actor_id` means "no person did this" rather
 * than "somebody forgot to set it". The `activity` check constraint ties the two
 * together in both directions; see the table definition.
 */
export const ACTOR_KINDS = ['user', 'agent', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * §4.8. Adding a type here is a schema change, deliberately — it rebuilds the
 * `activity` table's CHECK constraint.
 *
 * `project.updated`, `project.archived` and `member.removed` were added by
 * LAI-010; `task.dependency_removed` by LAI-011; `comment.edited` and
 * `comment.deleted` by LAI-110. Each task needs a verb for every mutation it
 * performs (§4.8: this table is the audit trail).
 */
export const ACTIVITY_TYPES = [
  'org.created',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.dependency_added',
  'task.dependency_removed',
  'comment.added',
  'comment.edited',
  'comment.deleted',
  'project.created',
  'project.updated',
  'project.archived',
  'member.added',
  'member.role_changed',
  'member.removed',
  'token.created',
  'token.revoked',
  'heartbeat.session',
  'webhook.commit',
  'webhook.received',
  'meeting.applied',
  'unlisted.logged',
  // ## Growing this list never rewrites what is already written
  //
  // `activity` is append-only **in both directions**. Rows written before a verb
  // existed keep the verb they were written with, and a reader of old history
  // needs `payload.action` to interpret them.
  //
  // **The instinct to backfill — so that a `type` filter returns complete
  // history — is reasonable and wrong.** A partial history genuinely looks like
  // a bug, which is exactly why the temptation is worth naming here. But
  // rewriting rows to hide that the vocabulary was once wrong would break the
  // one property this table exists to have, and an audit trail that edits its
  // own past is not one. The honest cost of a late verb is that old rows keep
  // the old one.
  //
  // LAI-113. Three features filed their audit trail under a verb that did not
  // name them: sprints and the context document rode `project.updated`,
  // promotion and dismissal rode `unlisted.logged`. An audit reader filtering on
  // `type` — the obvious query, and what §4.13's indexes are for — could not see
  // any of them.
  'sprint.created',
  'sprint.updated',
  'sprint.deleted',
  'sprint.tasks_changed',
  'project.context_updated',
  'unlisted.promoted',
  'unlisted.dismissed',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const TOKEN_SCOPES = ['full', 'read_only'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const AI_PROVIDERS = ['anthropic', 'openai_compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const MEETING_REVIEW_STATUSES = ['pending', 'applied', 'expired'] as const;
export type MeetingReviewStatus = (typeof MEETING_REVIEW_STATUSES)[number];

export const SPRINT_STATUSES = ['planned', 'active', 'completed'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];
