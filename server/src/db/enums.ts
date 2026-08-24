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
 * LAI-010, which needs a verb for every mutation it performs (§4.8: this table
 * is the audit trail). SPEC §4.8's list needs the matching edit — see LAI-107.
 */
export const ACTIVITY_TYPES = [
  'org.created',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.dependency_added',
  'comment.added',
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
