/**
 * The v1 schema, SPEC §4, in spec order so it can be diffed against the document
 * top to bottom.
 *
 * Conventions (§4 preamble):
 *  - ids are ULIDs in `text` — sortable by creation, no coordination needed;
 *  - timestamps are `integer` unix-milliseconds UTC, stored as plain numbers
 *    rather than Drizzle's `timestamp_ms` mode, because `?updated_since=<unix-ms>`
 *    (§6.3) compares them as numbers and a Date round-trip buys nothing here;
 *  - every foreign key is indexed;
 *  - every closed vocabulary gets both a TypeScript union and a SQL `CHECK`.
 *
 * better-auth owns credentials, sessions and verification (§4.1, §11.3). Nothing
 * in this file touches them — that is LAI-005.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  ACTIVITY_TYPES,
  ACTOR_KINDS,
  AI_PROVIDERS,
  CREATED_VIA,
  MEETING_REVIEW_STATUSES,
  ORG_ROLES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  SPRINT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TOKEN_SCOPES,
} from './enums.ts';

/** `CHECK (col IN ('a','b'))` — the database half of a closed vocabulary. */
function oneOf(column: string, values: readonly string[]) {
  const list = values.map((v) => `'${v}'`).join(', ');
  return sql.raw(`${column} IN (${list})`);
}

/** `CHECK (col IN (...) OR col IS NULL)` for a nullable enum column. */
function oneOfOrNull(column: string, values: readonly string[]) {
  const list = values.map((v) => `'${v}'`).join(', ');
  return sql.raw(`${column} IS NULL OR ${column} IN (${list})`);
}

/**
 * §4.16's `^[a-z0-9][a-z0-9-]{0,23}$`, as a SQLite `GLOB`.
 *
 * **`GLOB`, not `LIKE`**, for two independent reasons — measured, because the
 * first correction I wrote for this was only half right:
 *
 *  1. **`LIKE` has no character classes.** SQLite's `LIKE` understands `%` and
 *     `_` and nothing else, so `name LIKE '[a-z0-9]%'` matches a literal `[`
 *     — `'[a-z0-9]x' LIKE '[a-z0-9]%'` is true and `'ui' LIKE '[a-z0-9]%'` is
 *     false. It does not accept the wrong rows; it rejects every real one.
 *  2. **`LIKE` is case-insensitive for ASCII.** So a pattern that *does* work,
 *     like `name LIKE 'u%'`, matches `UI` too — which is the trap this
 *     constraint exists to close, and the one worth remembering.
 *
 * `GLOB` has the classes and is case-sensitive: `'UI' GLOB '[a-z0-9]*'` is
 * false, `'ui'` is true.
 *
 * Three clauses because `GLOB` has no counted repetition: the first character,
 * the allowed alphabet anywhere, and the length. SQLite does support the negated
 * `[^…]` class in `GLOB` — checked, not assumed.
 */
const TAG_NAME_GLOB =
  "name GLOB '[a-z0-9]*' AND name NOT GLOB '*[^a-z0-9-]*' AND length(name) BETWEEN 1 AND 24";

const createdAt = integer('created_at').notNull();
const updatedAt = integer('updated_at').notNull();

// ---------------------------------------------------------------- §4.1 users

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Lowercased on write (§4.1) so uniqueness is case-insensitive in practice. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    orgRole: text('org_role', { enum: ORG_ROLES }).notNull().default('member'),
    /** Derived from the id — no uploads in v1 (§4.1). */
    /** 0 = deactivated. The row is kept so history keeps its author (§4.1). */
    isActive: integer('is_active').notNull().default(1),

    // --- required by better-auth's `user` model (LAI-005) ---
    // This table *is* better-auth's user table, remapped: one identity, one row.
    // Credentials, sessions and verification live in their own tables below.
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    /** better-auth writes this; v1 has no uploads, so it stays null (§4.1). */
    image: text('image'),

    // Date-typed rather than raw numbers, because better-auth hands the adapter
    // `Date` objects. Storage is unchanged — still `integer` unix-milliseconds.
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    check('users_org_role_check', oneOf('org_role', ORG_ROLES)),
    check('users_is_active_check', sql.raw('is_active IN (0, 1)')),
  ],
);

// ----------------------------------------------------------------- §4.2 orgs

export const orgs = sqliteTable(
  'orgs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * No FK to `users`: the first-run wizard creates the org and the Owner in one
     * transaction (LAI-009), and a hard reference here would force an ordering
     * that SQLite cannot satisfy without deferred constraints.
     */
    ownerUserId: text('owner_user_id').notNull(),
    /** Default 1 — invite-only is the default posture (D-004). */
    inviteOnly: integer('invite_only').notNull().default(1),
    /**
     * Org-wide off switch for heartbeats (§4.2, LAI-207). Default **1**, which
     * matches the design's default for the first-boot toggle.
     *
     * When `0`, §4.2 says `POST /heartbeats` answers `202` and **discards**, and
     * Presence/Capacity show a **disabled** state rather than an empty one — the
     * two look identical in a naive implementation and mean opposite things.
     * D-005 makes the privacy claim; this makes it enforceable by the org rather
     * than merely promised by us.
     *
     * **The enforcement is not here and not in LAI-207.** The heartbeat write
     * path is M4 and the derived views are M5; this stores the answer and those
     * tasks honour it. `services/heartbeats.ts` and whatever builds §9.3 are the
     * two places that must read it.
     */
    presenceEnabled: integer('presence_enabled').notNull().default(1),
    aiProvider: text('ai_provider', { enum: AI_PROVIDERS }),
    aiBaseUrl: text('ai_base_url'),
    /** AES-256-GCM ciphertext under a key derived from `LAIKA_SECRET` (§12). */
    aiApiKeyEnc: text('ai_api_key_enc'),
    smtpJsonEnc: text('smtp_json_enc'),
    githubWebhookSecretEnc: text('github_webhook_secret_enc'),
    createdAt,
    updatedAt,
  },
  () => [
    check('orgs_ai_provider_check', oneOfOrNull('ai_provider', AI_PROVIDERS)),
    check('orgs_invite_only_check', sql.raw('invite_only IN (0, 1)')),
  ],
);

// ------------------------------------------------------------- §4.3 projects

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Unique, lowercase — the URL segment (§6.4 uses `/projects/:slug`). */
    slug: text('slug').notNull(),
    /** Short uppercase display key, `LAI` — unique per org (§4.3). */
    prefix: text('prefix').notNull(),
    description: text('description'),
    /**
     * `owner/name` of the git repository this project tracks (§4.3).
     *
     * Not unique: a monorepo tracked by two projects is a real case (LAI-108), so
     * §9.2's presence attribution has to cope with more than one match rather than
     * this column pretending there can only be one.
     */
    repo: text('repo'),
    visibility: text('visibility', { enum: PROJECT_VISIBILITIES }).notNull().default('private'),
    /** The shared brief served to agents by `get_project_context` (§7.1). */
    contextMd: text('context_md').notNull().default(''),
    archivedAt: integer('archived_at'),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('projects_slug_unique').on(t.slug),
    uniqueIndex('projects_org_prefix_unique').on(t.orgId, t.prefix),
    index('projects_org_id_idx').on(t.orgId),
    check('projects_visibility_check', oneOf('visibility', PROJECT_VISIBILITIES)),
  ],
);

// -------------------------------------------------- §4.4 project_memberships

export const projectMemberships = sqliteTable(
  'project_memberships',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: PROJECT_ROLES }).notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex('project_memberships_project_user_unique').on(t.projectId, t.userId),
    index('project_memberships_user_id_idx').on(t.userId),
    check('project_memberships_role_check', oneOf('role', PROJECT_ROLES)),
  ],
);

// -------------------------------------------------------------- §4.15 sprints

/**
 * Declared before `tasks` because `tasks.sprint_id` references it.
 *
 * "At most one active sprint per project" and "sprints may not overlap" are
 * write-time rules (§4.15) rather than constraints — SQLite cannot express
 * either. They belong to the sprints task, not here.
 */
export const sprints = sqliteTable(
  'sprints',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    goal: text('goal'),
    startsOn: integer('starts_on').notNull(),
    endsOn: integer('ends_on').notNull(),
    status: text('status', { enum: SPRINT_STATUSES }).notNull().default('planned'),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('sprints_project_name_unique').on(t.projectId, t.name),
    index('sprints_project_starts_on_idx').on(t.projectId, t.startsOn),
    index('sprints_project_status_idx').on(t.projectId, t.status),
    // §4.15: "At most one `active` sprint per project." A partial unique index
    // makes that true of the *data*, not merely of the code path that writes it —
    // `services/sprints.ts` still checks first, so the caller gets a 409 with the
    // conflicting sprint named rather than a constraint violation as a 500.
    uniqueIndex('sprints_one_active_per_project')
      .on(t.projectId)
      .where(sql`status = 'active'`),
    check('sprints_status_check', oneOf('status', SPRINT_STATUSES)),
    check('sprints_dates_check', sql.raw('ends_on > starts_on')),
  ],
);

// ---------------------------------------------------------------- §4.5 tasks

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Per-project sequence → the display key `LAI-42`. Allocated in `numbering.ts`. */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    /**
     * What "done" means for this task (§11.4, LAI-092).
     *
     * **Prose, not a checklist.** A checklist implies per-item state, which
     * implies who ticked each one and when — a table of its own and a
     * permissions question with it. Prose is the smaller honest step, and going
     * further later is additive rather than a migration away from this.
     *
     * Nullable because most tasks will not have one, and `NULL` is not the same
     * claim as an empty string: one says nobody specified acceptance, the other
     * says someone specified that there is none.
     */
    acceptanceMd: text('acceptance_md'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('backlog'),
    priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('p2'),
    assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** Null means *not in a sprint* — the ordinary state, never an error (§4.15). */
    sprintId: text('sprint_id').references(() => sprints.id, { onDelete: 'set null' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdVia: text('created_via', { enum: CREATED_VIA }).notNull(),
    /**
     * Provenance, not blocking (§4.6). A discovered task can be worked while its
     * parent is still open — this is deliberately *not* a dependency.
     */
    discoveredFrom: text('discovered_from'),
    branch: text('branch'),
    externalRef: text('external_ref'),
    staleFlaggedAt: integer('stale_flagged_at'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    createdAt,
    updatedAt,
  },
  (t) => [
    // §4.13, verbatim.
    uniqueIndex('tasks_project_number_unique').on(t.projectId, t.number),
    index('tasks_project_status_idx').on(t.projectId, t.status),
    index('tasks_assignee_status_idx').on(t.assigneeId, t.status),
    index('tasks_project_updated_at_idx').on(t.projectId, t.updatedAt),
    index('tasks_sprint_id_idx').on(t.sprintId),
    index('tasks_created_by_idx').on(t.createdBy),
    index('tasks_discovered_from_idx').on(t.discoveredFrom),
    check('tasks_status_check', oneOf('status', TASK_STATUSES)),
    check('tasks_priority_check', oneOf('priority', TASK_PRIORITIES)),
    check('tasks_created_via_check', oneOf('created_via', CREATED_VIA)),
    check('tasks_number_check', sql.raw('number > 0')),
    check(
      'tasks_discovered_from_check',
      sql.raw('discovered_from IS NULL OR discovered_from <> id'),
    ),
  ],
);

// --------------------------------------------------- §4.6 task_dependencies

/**
 * The pair is the primary key, which gives §4.6's "unique pair" for free.
 *
 * Self-reference is refused by a `CHECK`; cycles cannot be expressed as one and
 * are rejected at write time in `dependencies.ts`.
 */
export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /**
     * **Deliberately not renamed** when the wire field became `blocked_by`
     * (LAI-099, D-044). This is internal — nothing outside the server reads a
     * column name — and renaming a table's columns to match a field name is the
     * tail wagging the dog. §4.5 already says which direction it means.
     */
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [
    uniqueIndex('task_dependencies_pair_unique').on(t.taskId, t.dependsOnTaskId),
    index('task_dependencies_depends_on_idx').on(t.dependsOnTaskId),
    check('task_dependencies_no_self_check', sql.raw('task_id <> depends_on_task_id')),
  ],
);

// ------------------------------------------------------------- §4.7 comments

export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    bodyMd: text('body_md').notNull(),
    createdVia: text('created_via', { enum: CREATED_VIA }).notNull(),
    editedAt: integer('edited_at'),
    /** Soft delete (§4.7) — `updated_since` returns these as tombstones (§6.3). */
    deletedAt: integer('deleted_at'),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('comments_task_created_at_idx').on(t.taskId, t.createdAt),
    index('comments_author_id_idx').on(t.authorId),
    check('comments_created_via_check', oneOf('created_via', CREATED_VIA)),
  ],
);

// ------------------------------------------------------------- §4.8 activity

/**
 * Append-only. There is no update or delete path in `activity.ts`, and the
 * migration installs triggers that abort either statement outright — see
 * `migrations/` and `test/db/activity.test.ts`.
 *
 * **Nullability follows the type vocabulary (D-022).** §4.8 originally marked
 * only `task_id` nullable, which made rows the same section requires impossible
 * to insert: four of its event types have no project (`token.created`,
 * `token.revoked`, `unlisted.logged`, org-level `member.added`) and several have
 * no human actor (`webhook.commit`, `webhook.received`, every §11.6 cron job).
 *
 * So `project_id` and `actor_id` are nullable, and — the part that matters more —
 * `actor_id IS NULL` **if and only if** `actor_kind = 'system'`. Without the
 * biconditional a null is ambiguous: system-authored, or a bug that failed to set
 * the actor? For the table that feeds the audit trail, that ambiguity is the
 * whole problem. `org_id` stays NOT NULL; every event belongs to the one org.
 */
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    /** Null for org-scoped events. Nulled rather than deleted if a project goes. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    /** Null for system actors — webhooks (§6.1) and cron (§11.6). */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
    /** *Which* token, for audit (§4.8). */
    actorTokenId: text('actor_token_id'),
    type: text('type', { enum: ACTIVITY_TYPES }).notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt,
  },
  (t) => [
    index('activity_project_created_at_idx').on(t.projectId, t.createdAt),
    index('activity_task_created_at_idx').on(t.taskId, t.createdAt),
    index('activity_org_created_at_idx').on(t.orgId, t.createdAt),
    index('activity_actor_id_idx').on(t.actorId),
    check('activity_actor_kind_check', oneOf('actor_kind', ACTOR_KINDS)),
    check('activity_type_check', oneOf('type', ACTIVITY_TYPES)),
    // D-022, both directions: a system event has no actor, and a non-system
    // event must have one. Either half alone leaves a null meaning two things.
    check('activity_system_actor_check', sql.raw("(actor_id IS NULL) = (actor_kind = 'system')")),
  ],
);

// --------------------------------------------------------------- §4.9 tokens

export const tokens = sqliteTable(
  'tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** First 8 characters, so a token is identifiable in the UI (§4.9). */
    prefix: text('prefix').notNull(),
    /** SHA-256 of the secret. The secret itself is never stored (§4.9). */
    tokenHash: text('token_hash').notNull(),
    scope: text('scope', { enum: TOKEN_SCOPES }).notNull(),
    /** Null = all the user's projects (§4.9). */
    projectIdsJson: text('project_ids_json'),
    lastUsedAt: integer('last_used_at'),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
    createdAt,
  },
  (t) => [
    uniqueIndex('tokens_token_hash_unique').on(t.tokenHash),
    index('tokens_user_id_idx').on(t.userId),
    check('tokens_scope_check', oneOf('scope', TOKEN_SCOPES)),
  ],
);

// ----------------------------------------------------------- §4.10 heartbeats

/**
 * Metadata only — repo name, branch name, timestamp. Never file paths, diffs,
 * prompts or transcript content (D-005). There is deliberately no column that
 * could hold any of those.
 */
export const heartbeats = sqliteTable(
  'heartbeats',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenId: text('token_id').references(() => tokens.id, { onDelete: 'set null' }),
    repo: text('repo').notNull(),
    branch: text('branch').notNull(),
    /** Resolved server-side from the branch name (§9.2). */
    matchedTaskId: text('matched_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    createdAt,
  },
  (t) => [
    index('heartbeats_user_created_at_idx').on(t.userId, t.createdAt),
    index('heartbeats_matched_task_id_idx').on(t.matchedTaskId),
    index('heartbeats_token_id_idx').on(t.tokenId),
  ],
);

// -------------------------------------------------------------- §4.11 invites

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    /** Null for link invites (§4.11). */
    email: text('email'),
    orgRole: text('org_role', { enum: ORG_ROLES }).notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    projectRole: text('project_role', { enum: PROJECT_ROLES }),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: integer('expires_at').notNull(),
    acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: integer('accepted_at'),
    createdAt,
  },
  (t) => [
    uniqueIndex('invites_token_hash_unique').on(t.tokenHash),
    index('invites_org_id_idx').on(t.orgId),
    index('invites_email_idx').on(t.email),
    index('invites_project_id_idx').on(t.projectId),
    index('invites_created_by_idx').on(t.createdBy),
    index('invites_accepted_by_idx').on(t.acceptedBy),
    check('invites_org_role_check', oneOf('org_role', ORG_ROLES)),
    check('invites_project_role_check', oneOfOrNull('project_role', PROJECT_ROLES)),
  ],
);

// ------------------------------------------------------ §4.12 meeting_reviews

export const meetingReviews = sqliteTable(
  'meeting_reviews',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    /**
     * A hash, not the transcript. Laika stores what it needs to deduplicate and
     * nothing more — the transcript itself is not persisted (§10.2, D-005).
     */
    transcriptHash: text('transcript_hash').notNull(),
    proposalsJson: text('proposals_json').notNull(),
    status: text('status', { enum: MEETING_REVIEW_STATUSES }).notNull().default('pending'),
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: integer('reviewed_at'),
    /** Unreviewed proposals expire after 7 days (§4.12, §11.6). */
    expiresAt: integer('expires_at').notNull(),
    createdAt,
  },
  (t) => [
    index('meeting_reviews_project_status_idx').on(t.projectId, t.status),
    index('meeting_reviews_reviewed_by_idx').on(t.reviewedBy),
    check('meeting_reviews_status_check', oneOf('status', MEETING_REVIEW_STATUSES)),
  ],
);

// -------------------------------------------------------- §4.14 unlisted_work

/**
 * Written only by the `log_unlisted_work` MCP tool (§7.1): an agent noticing work
 * that belongs to no project records it here instead of inventing a task.
 *
 * Same privacy rule as heartbeats (D-005) — `note` is agent-authored prose and
 * `repo` is a name. No file contents, no diffs, no prompt text.
 */
export const unlistedWork = sqliteTable(
  'unlisted_work',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenId: text('token_id').references(() => tokens.id, { onDelete: 'set null' }),
    repo: text('repo').notNull(),
    note: text('note').notNull(),
    promotedTaskId: text('promoted_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    dismissedAt: integer('dismissed_at'),
    createdAt,
  },
  (t) => [
    index('unlisted_work_user_created_at_idx').on(t.userId, t.createdAt),
    index('unlisted_work_promoted_task_id_idx').on(t.promotedTaskId),
    index('unlisted_work_token_id_idx').on(t.tokenId),
  ],
);

// ------------------------------------------------ §4.16 tags and task_tags

/**
 * Project-scoped labels (§4.16, D-027).
 *
 * The `CHECK` exists because the failure it prevents is not a bad request — it
 * is `UI`, `Ui` and `ui` living as three separate tags, which makes a tag filter
 * worthless and cannot be undone once the rows are there. Service validation
 * alone would leave any other writer free to create them.
 */
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt,
  },
  (t) => [
    // §4.13: unique **per project**, not per org — `ui` on a server project and
    // `ui` on the web one are different concerns.
    uniqueIndex('tags_project_name_unique').on(t.projectId, t.name),
    check('tags_name_check', sql.raw(TAG_NAME_GLOB)),
  ],
);

/**
 * The join. A task has many tags and a tag has many tasks — the design applies
 * `agent` and `core` to one card, which is what settles this as a table rather
 * than a column.
 *
 * Both sides cascade: deleting a task removes its labels, and deleting a **tag**
 * removes the labels and **not the tasks** (§4.16). The composite primary key is
 * what makes applying the same tag twice impossible rather than merely unusual.
 */
export const taskTags = sqliteTable(
  'task_tags',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.tagId] }),
    // §4.13. The `?tag=` filter reads from the tag side, and the composite
    // primary key indexes `(task_id, tag_id)` only.
    index('task_tags_tag_id_idx').on(t.tagId),
  ],
);

// ------------------------------------------- better-auth: sessions, accounts,
// verifications (SPEC §4.1, §11.3 — "its tables alongside ours")
//
// Hand-written rather than generated, because the generator is a separate CLI
// package and LAI-005 admits only better-auth and its peers. The shapes are
// taken from `@better-auth/core`'s table definitions; the field names here are
// the *Drizzle property* names better-auth resolves against, which is why they
// stay camelCase while the SQL columns are snake_case.

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_unique').on(t.token),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    /** Argon2id hash for the credential provider. Never leaves this table. */
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('accounts_issuer_account_id_unique').on(t.issuer, t.accountId),
    index('accounts_user_id_idx').on(t.userId),
  ],
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('verifications_identifier_idx').on(t.identifier),
    index('verifications_expires_at_idx').on(t.expiresAt),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Verification = typeof verifications.$inferSelect;

// ------------------------------------------------- idempotency keys (§6.3)

/**
 * `Idempotency-Key` replay storage (LAI-006).
 *
 * Not in SPEC §4 because it is transport bookkeeping rather than product data —
 * no endpoint reads it, nothing references it, and a cron sweep empties it. It
 * lives in SQLite rather than memory (D-002) so a retry that arrives after a
 * restart still replays instead of writing twice.
 *
 * The primary key is `(actor_id, key)`: keys are scoped per actor, so one
 * caller's key can never collide with or replay another's.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    actorId: text('actor_id').notNull(),
    key: text('key').notNull(),
    /** sha256 of method + path + body, so a reused key with a new body is caught. */
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: text('response_body').notNull(),
    createdAt,
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.key] }),
    index('idempotency_keys_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * Who is interested in a task (SPEC §4.x, LAI-094).
 *
 * **`watching` is a column, not row-presence, and that is the whole design.**
 * §4.x says assigning, commenting on, or being mentioned in a task implies
 * watching it *unless the person has explicitly unwatched* — so three states
 * have to be distinguishable:
 *
 *  - **no row** — nothing has happened; the implicit rules decide.
 *  - **`watching = 1`** — watching, implicitly or by choice.
 *  - **`watching = 0`** — explicitly unwatched, and the implicit rules must not
 *    put them back. Deleting the row would lose exactly this, and the person who
 *    unwatched would be re-subscribed by their own next comment.
 */
export const taskWatchers = sqliteTable(
  'task_watchers',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 1 watching, 0 explicitly unwatched. See the note above. */
    watching: integer('watching').notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('task_watchers_task_user_unique').on(t.taskId, t.userId),
    // "What am I watching?" — the reverse of the row above, and the query a
    // notification list runs.
    index('task_watchers_user_id_idx').on(t.userId),
  ],
);

/**
 * Who was mentioned in a comment (SPEC §4.y, LAI-094).
 *
 * **Resolved to a user id at write time**, never stored as the typed text: a
 * person renaming themselves would otherwise silently break every past mention,
 * and two clients re-parsing the body would be free to disagree about who was
 * meant with no single place to fix it.
 */
export const commentMentions = sqliteTable(
  'comment_mentions',
  {
    id: text('id').primaryKey(),
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [
    // One mention per person per comment: `@ada @ada` is one notification.
    uniqueIndex('comment_mentions_comment_user_unique').on(t.commentId, t.userId),
    index('comment_mentions_user_id_idx').on(t.userId),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

export type User = typeof users.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectMembership = typeof projectMemberships.$inferSelect;
export type Sprint = typeof sprints.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type Heartbeat = typeof heartbeats.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type MeetingReview = typeof meetingReviews.$inferSelect;
export type UnlistedWork = typeof unlistedWork.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type TaskTag = typeof taskTags.$inferSelect;
export type TaskWatcher = typeof taskWatchers.$inferSelect;
export type CommentMention = typeof commentMentions.$inferSelect;
