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
  type AnySQLiteColumn,
  check,
  foreignKey,
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
  CHECK_OUTCOMES,
  EVIDENCE_KINDS,
  EVIDENCE_STATES,
  GITHUB_CHECK_KINDS,
  LOCAL_ACTIVITY_SCOPES,
  MEETING_REVIEW_STATUSES,
  ORG_ROLES,
  PROFILE_KINDS,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  REVIEW_DECISIONS,
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
    /**
     * `builder` or `manager` — what the member profile shows (§4.1, D-078,
     * LAI-743). A label, never a permission: `can()` does not read it.
     */
    profileKind: text('profile_kind', { enum: PROFILE_KINDS }).notNull().default('builder'),
    /**
     * The developer's own consent to send local activity counts (§4.1, D-079,
     * LAI-751). 0 by default. Set only by the person, from a web session —
     * never by an admin and never with a token, because a token is how an
     * agent acts and an agent must not be able to switch this on.
     */
    shareLocalActivity: integer('share_local_activity').notNull().default(0),
    /** Which repositories their collector counts in (§4.1, D-079). */
    localActivityScope: text('local_activity_scope', { enum: LOCAL_ACTIVITY_SCOPES })
      .notNull()
      .default('agent-repos'),

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
    // Added by 0029 as a column constraint on `ALTER TABLE … ADD`, so `users`
    // was not rebuilt to gain it — a rebuild of a table this many others
    // reference is the risk LAI-493 measured (LAI-743).
    check('users_profile_kind_check', oneOf('profile_kind', PROFILE_KINDS)),
    // Both added by 0031 as column constraints on `ALTER TABLE … ADD`, as 0029
    // added `profile_kind`'s (LAI-751).
    check('users_share_local_activity_check', sql.raw('share_local_activity IN (0, 1)')),
    check('users_local_activity_scope_check', oneOf('local_activity_scope', LOCAL_ACTIVITY_SCOPES)),
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
    /**
     * The org's half of D-079's two switches (§4.2, LAI-751). Default **0**.
     * With it off nothing local is collected for anybody, whatever each
     * developer has chosen; with it on, only the developers who turned on
     * sharing themselves send anything.
     */
    developerInsights: integer('developer_insights').notNull().default(0),
    aiProvider: text('ai_provider', { enum: AI_PROVIDERS }),
    aiBaseUrl: text('ai_base_url'),
    /** AES-256-GCM ciphertext under a key derived from `LAIKA_SECRET` (§12). */
    aiApiKeyEnc: text('ai_api_key_enc'),
    /**
     * The last four characters of the configured key, for display (§6.4, §12).
     *
     * **Stored, not derived** (LAI-447). The alternative is decrypting the key
     * to build a response, and `services/orgs.ts` refuses that for a reason
     * worth keeping: *"a serialiser that can reach plaintext is one refactor
     * away from returning it"*. Setting the key is the one moment the tail is
     * known without decrypting anything, so it is written down then.
     *
     * Not a secret. Four characters of a key identify **which** key is in place
     * to somebody who already has it, and identify nothing to anybody else —
     * which is the whole job §12 gives it: `{ configured, provider, key_last4 }`.
     */
    aiKeyLast4: text('ai_key_last4'),
    smtpJsonEnc: text('smtp_json_enc'),
    githubWebhookSecretEnc: text('github_webhook_secret_enc'),
    /**
     * §10.2's shared secret, encrypted (§12, D-052, LAI-450).
     *
     * **Its own column, not GitHub's reused.** One secret for two integrations
     * means revoking either breaks both, and a leak of one hands over the
     * other. It also has its own `SecretPurpose`, so the derived keys differ —
     * which is the property LAI-161 said could not be retrofitted, meeting the
     * first thing that would have needed it.
     */
    transcriptWebhookSecretEnc: text('transcript_webhook_secret_enc'),
    createdAt,
    updatedAt,
  },
  () => [
    check('orgs_ai_provider_check', oneOfOrNull('ai_provider', AI_PROVIDERS)),
    check('orgs_invite_only_check', sql.raw('invite_only IN (0, 1)')),
    // Added by 0031 as a column constraint on `ALTER TABLE … ADD` (LAI-751).
    check('orgs_developer_insights_check', sql.raw('developer_insights IN (0, 1)')),
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
    /**
     * Hide finished work from the board once it is this many days old
     * (LAI-266). `null` means never, and is the default.
     *
     * **A project setting rather than a per-viewer one, deliberately.** It does
     * not change how work *looks*, it removes work from the board — so if it
     * were personal, two people on the same board would disagree about whether
     * a task exists. That is D-060's *"an order only its arranger can see is a
     * private opinion wearing the board's clothes"* applied to visibility.
     *
     * The board still says what it is hiding; a filter nobody can see is worse
     * than no filter.
     */
    boardHideDoneDays: integer('board_hide_done_days'),
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

// ----------------------------------------------------- §4.20 project_statuses

/**
 * A project's own statuses — one per board column (LAI-738, D-077).
 *
 * Jira's team-managed model: a project names and orders its statuses, and each
 * belongs to one of six fixed **categories** — the `TASK_STATUSES` values. The
 * category is what everything that reasons about work reads (§5's lifecycle,
 * policy, metrics, readiness, the stale cron, MCP), so `tasks.status` keeps
 * holding it and none of them had to change. The status is what a person sees
 * and drags between.
 *
 * ## What the database holds, and what the service holds
 *
 * - **A task's status belongs to its project and agrees with its category** —
 *   in SQL, through `tasks_status_fk`, whose parent key is
 *   `(project_id, id, category)` below. A write that moved `tasks.status`
 *   without moving `status_id` is refused by the database, not by a code path
 *   remembering to.
 * - **A category cannot change** — no API takes one, and the FK above would
 *   refuse it the moment any task sat in the status.
 * - **Every project keeps at least one status in every category** — not
 *   expressible as a constraint. It is `deleteProjectStatus`'s rule, the only
 *   function that removes a row, with a test behind it.
 *
 * ## `position` may go negative, and no CHECK may forbid it
 *
 * The reorder parks every row at `-(position + 1)` before writing the new
 * order, because **SQLite checks a unique index per row, not per statement**,
 * and has no deferrable unique constraint — a permutation cannot be written in
 * place (measured on LAI-266's columns, which this table replaces). So do not
 * add `CHECK (position >= 0)`.
 *
 * ## `hidden`
 *
 * A status that holds work but draws no column. `cancelled`'s default home —
 * §11.4.1 keeps cancelled work behind a filter — and any status a lead chooses
 * to put away.
 */
export const projectStatuses = sqliteTable(
  'project_statuses',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** One of the six `TASK_STATUSES`. Fixed for the life of the row. */
    category: text('category', { enum: TASK_STATUSES }).notNull(),
    position: integer('position').notNull(),
    /** 1 = holds work but draws no column. */
    hidden: integer('hidden').notNull().default(0),
    createdAt,
  },
  (t) => [
    uniqueIndex('project_statuses_project_position_unique').on(t.projectId, t.position),
    // Case-insensitive: "Review" and "review" are one name to a person reading
    // the board. `lower()` folds ASCII only; the service compares with the
    // full Unicode fold first, so this is the backstop rather than the rule.
    uniqueIndex('project_statuses_project_name_unique').on(t.projectId, sql`lower(${t.name})`),
    // The parent side of `tasks_status_fk`. SQLite wants a unique index over
    // exactly the referenced columns, in that order — it is not redundant with
    // the primary key, it is what lets the category be checked in SQL.
    uniqueIndex('project_statuses_project_id_category_unique').on(t.projectId, t.id, t.category),
    check('project_statuses_category_check', oneOf('category', TASK_STATUSES)),
    check('project_statuses_hidden_check', sql.raw('hidden IN (0, 1)')),
    check('project_statuses_name_check', sql.raw('length(trim(name)) BETWEEN 1 AND 40')),
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
    /**
     * The **category** of the task's status (LAI-738, D-077) — what §5's
     * lifecycle, policy, readiness and metrics read. Kept in step with
     * `status_id` by the services, and by `tasks_status_fk` in SQL.
     */
    status: text('status', { enum: TASK_STATUSES }).notNull().default('backlog'),
    /**
     * The project status the task is in — the column it draws in (§4.20).
     * No default: a task's status is a row of its own project, and there is
     * no value that is right for every project.
     */
    statusId: text('status_id').notNull(),
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
    /**
     * The task this is a **subtask** of (§4.5, §4.6, D-066). Containment, not
     * blocking: `ready` ignores it and a parent's status never moves with its
     * children. **One level** — a parent is never itself a child — and that is
     * the service's rule (`assertParentAllowed`), because a CHECK cannot see
     * another row. `ON DELETE SET NULL` rather than Jira's cascade: an orphaned
     * subtask is a task someone can still see.
     */
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'set null',
    }),
    /**
     * The plan, as distinct from `started_at` / `completed_at`, which are the
     * actuals (D-066). Unix-ms with **date-only semantics** — a UTC midnight —
     * exactly as a sprint's `starts_on` (§4.15). Neither is validated against
     * the other, as Jira does not.
     */
    dueOn: integer('due_on'),
    plannedStart: integer('planned_start'),
    branch: text('branch'),
    externalRef: text('external_ref'),
    staleFlaggedAt: integer('stale_flagged_at'),
    /**
     * **Manual board order** (LAI-472, D-060, D-070): a fractional-index key
     * from `order-key.ts`, one sequence per project; a lane draws the subset
     * whose status it holds, in this order. Compared byte-wise — never give it
     * a `NOCASE` collation, which would fold `a` onto `A`.
     *
     * **Nullable only so it can be added to a populated table.** Every create
     * sets one and `backfillTaskPositions` fills any null at boot, so a served
     * task always has one. The unique index below treats nulls as distinct,
     * which is what lets the column arrive before the backfill runs.
     */
    position: text('position'),
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
    index('tasks_parent_task_id_idx').on(t.parentTaskId),
    // No two tasks in a project share a place (LAI-472). Also the index a
    // reorder's neighbour lookups read.
    uniqueIndex('tasks_project_position_unique').on(t.projectId, t.position),
    index('tasks_status_id_idx').on(t.statusId),
    // **Composite, and that is the point** (LAI-738). A plain `status_id`
    // reference would let a task hold another project's status, or a status
    // whose category disagrees with `status` — two ways for the board and the
    // lifecycle to describe one task differently. This refuses both in SQL.
    //
    // `NO ACTION`, not `RESTRICT`: deleting a project cascades into both
    // tables, and SQLite cascades in table-creation order. `RESTRICT` checks
    // immediately and would fail the project delete when `project_statuses`
    // happened to empty first; `NO ACTION` checks at the end of the statement,
    // when both are gone. Deleting a status that still holds a task is
    // refused either way — `deleteProjectStatus` moves the work first.
    foreignKey({
      columns: [t.projectId, t.statusId, t.status],
      foreignColumns: [projectStatuses.projectId, projectStatuses.id, projectStatuses.category],
      name: 'tasks_status_fk',
    }),
    check('tasks_status_check', oneOf('status', TASK_STATUSES)),
    check('tasks_priority_check', oneOf('priority', TASK_PRIORITIES)),
    check('tasks_created_via_check', oneOf('created_via', CREATED_VIA)),
    check('tasks_number_check', sql.raw('number > 0')),
    check(
      'tasks_discovered_from_check',
      sql.raw('discovered_from IS NULL OR discovered_from <> id'),
    ),
    check('tasks_parent_task_id_check', sql.raw('parent_task_id IS NULL OR parent_task_id <> id')),
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
    /**
     * **Nullable, and null means there is no Laika user** (§4.7, LAI-449).
     *
     * §10.1 mirrors a GitHub `issue_comment` into this table, and the person who
     * wrote it has no account here. D-050 refused identity mapping, so there is
     * nothing to point at — and `created_via` already carries where the comment
     * came from.
     *
     * The alternative was an org-owned "GitHub" user row, which is the sentinel
     * D-050 refused one table over: a row that means *not a person* is one
     * refactor from being treated as one, and it would appear in member lists
     * and assignee pickers on the way there.
     *
     * **Nullable is not unconstrained.** A non-null value still references a real
     * user, and `restrict` still refuses to delete one who has commented.
     */
    authorId: text('author_id').references(() => users.id, { onDelete: 'restrict' }),
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
    /**
     * **`restrict`, not `set null` (LAI-135).**
     *
     * A `SET NULL` cascade is an **UPDATE**, and §4.8's append-only trigger
     * refuses every UPDATE on this table — so deleting a project, task or user
     * that had any activity failed at runtime with
     * `activity is append-only: UPDATE is not permitted`, pointing at the audit
     * log rather than at the thing being deleted.
     *
     * The cascades were the wrong half. **A row in an append-only log must not
     * lose its subject**: "somebody did something to something" becoming
     * "somebody did something to null" is an edit, which is precisely what the
     * table forbids. `restrict` says that in the schema, refuses early, and
     * names the constraint that refused.
     *
     * It costs nothing today and encodes what is already true: tasks are
     * cancelled (§5), projects archived, users deactivated (§4.1). The two paths
     * that *do* delete a user — `removeOrphanedOwner`, `removeOrphanedInvitee` —
     * run on accounts that have written no activity, and `createFirstOrg` is
     * transactional so a failed setup rolls its `org.created` row back. Verified
     * rather than assumed.
     *
     * `heartbeats`, `unlisted_work` and `meeting_reviews` keep their `set null`:
     * same shape, different consequence, because none of them is append-only and
     * an UPDATE there is legitimate.
     */ projectId: text('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'restrict' }),
    /** Null for system actors — webhooks (§6.1) and cron (§11.6). */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'restrict' }),
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
    /**
     * The last authenticated `/mcp` request on this token, throttled like
     * `last_used_at` (D-076). §9.3 counts it as a live agent session, so an
     * agent with no heartbeat hook still shows as present.
     */
    lastMcpAt: integer('last_mcp_at'),
    /**
     * The last token-authenticated REST request that writes (anything but
     * `GET`, `HEAD` and `OPTIONS`), throttled the same way (D-081). §9.3
     * counts it like `last_mcp_at`, so an agent on the REST API or the `laika`
     * CLI shows as present too.
     */
    lastRestWriteAt: integer('last_rest_write_at'),
    /** The `AGENT_CLIENTS` slug of the client that last sent `initialize` (D-076). */
    lastClient: text('last_client'),
    /**
     * That client's own `clientInfo.name`, control and bidi characters stripped,
     * at most 64 characters. For display only; never used to authorise (D-076).
     */
    lastClientName: text('last_client_name'),
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
    // Presence and Capacity ask for "the last five minutes" by `created_at`
    // alone, which the pair above cannot serve — both scanned (LAI-722).
    index('heartbeats_created_at_idx').on(t.createdAt),
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

// ------------------------------------------------------ §4.21 member_ratings

/**
 * A rating of one member by an owner or admin: 1–5 and a short note (§4.21,
 * D-078, LAI-743).
 *
 * **Append-only, like `activity`.** A new rating supersedes the last one and
 * never edits it; triggers refuse `UPDATE`, `DELETE` and — since LAI-746 — an
 * `INSERT OR REPLACE` over an existing id, and `runMigrations` re-checks them
 * on every boot (`migrate.ts`). There is no mutation helper.
 *
 * **Private.** Nothing here reaches `activity`, so it reaches no feed, stream,
 * webhook or export; only `services/profiles.ts` reads it, behind
 * `profile.read`.
 *
 * Each rule is the database's as well as the service's — score, note length and
 * *"not themselves"* — so a writer that bypasses the service meets the same
 * refusal. No `ON DELETE`: people are deactivated, never deleted (§4.1), and a
 * rating must not outlive its author silently.
 */
export const memberRatings = sqliteTable(
  'member_ratings',
  {
    id: text('id').primaryKey(),
    /** The person rated. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** The owner or admin who rated them. */
    ratedBy: text('rated_by')
      .notNull()
      .references(() => users.id),
    score: integer('score').notNull(),
    note: text('note').notNull(),
    /**
     * The `Idempotency-Key` the rating was sent with, or null (LAI-746). A
     * retry with the same key answers from this row rather than writing a
     * second one — kept here so the note is never copied into
     * `idempotency_keys`, whose rows any keyed POST can be answered from.
     */
    idempotencyKey: text('idempotency_key'),
    createdAt,
  },
  (t) => [
    // A profile reads one person's history, newest first.
    index('member_ratings_user_created_at_idx').on(t.userId, t.createdAt),
    index('member_ratings_rated_by_idx').on(t.ratedBy),
    // `IN`, not `BETWEEN`: an INTEGER column keeps 2.5 as a REAL, and
    // `BETWEEN 1 AND 5` would let it in.
    check('member_ratings_score_check', sql.raw('score IN (1, 2, 3, 4, 5)')),
    check('member_ratings_note_check', sql.raw('length(trim(note)) > 0 AND length(note) <= 500')),
    check('member_ratings_not_self_check', sql.raw('user_id <> rated_by')),
  ],
);

// ------------------------------------------------- §4.22 board_activity_days

/**
 * One person's board actions per UTC day, by them and by their agents (§4.22,
 * D-079, LAI-751) — the heatmap's *Board* colour.
 *
 * **A rollup of `activity`, never a second source.** `appendActivity` adds to
 * it in the same transaction as every row it writes, and 0031 filled it from
 * the log in one statement, so the two cannot disagree. It exists because the
 * profile must read a year without walking the log: one person's year is at
 * most 366 rows here, found through the primary key.
 *
 * The day is UTC: Laika has no organisation time zone (§4.22).
 */
export const boardActivityDays = sqliteTable(
  'board_activity_days',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `YYYY-MM-DD`, UTC. */
    day: text('day').notNull(),
    /** Rows they wrote on a web session (`actor_kind = 'user'`). */
    bySelf: integer('by_self').notNull().default(0),
    /** Rows written with one of their tokens (`actor_kind = 'agent'`). */
    byAgents: integer('by_agents').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

// ------------------------------------------------- §4.23 local_activity_days

/**
 * A developer's local work per day, as one machine last reported it (§4.23,
 * D-079, LAI-751): prompts per agent kind, agent sessions started and commits
 * not yet on any remote. **Counts only** — there is deliberately no column
 * that could hold a prompt, a path, a repository or a branch.
 *
 * A **snapshot**, overwritten whole by the next report for the same
 * (person, collector, day), so a retry never double-counts and a commit that
 * is pushed later leaves `commits_local`.
 *
 * The key leads with (person, day) so a profile's year is one range of it;
 * `collector_id` last keeps one row per machine. Kept 400 days (§11.6).
 */
export const localActivityDays = sqliteTable(
  'local_activity_days',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `YYYY-MM-DD` in the machine's own time zone, `tz`. */
    day: text('day').notNull(),
    /** A random UUID the collector made once on that machine. */
    collectorId: text('collector_id').notNull(),
    /** The sum of `prompts_by_agent`, so a year sums without parsing JSON. */
    prompts: integer('prompts').notNull().default(0),
    /** `{ "<agent kind>": n }` — the tooltip's breakdown. */
    promptsByAgent: text('prompts_by_agent').notNull().default('{}'),
    sessions: integer('sessions').notNull().default(0),
    commitsLocal: integer('commits_local').notNull().default(0),
    /** The IANA zone the machine reported its days in. */
    tz: text('tz').notNull(),
    updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day, t.collectorId] }),
    // §11.6's retention deletes by day alone.
    index('local_activity_days_day_idx').on(t.day),
  ],
);

// ------------------------------------------------- §4.24 pushed_commit_keys

/**
 * One row per commit a developer has on a remote, as a one-way key (§4.24,
 * D-079, LAI-751): the first 16 hex characters of
 * `sha256("laika-commit:" + sha)`. Never the commit id itself. The same commit
 * seen from two machines is one key, so it counts once; a key keeps the
 * earliest day it was reported for. Kept 400 days (§11.6).
 */
export const pushedCommitKeys = sqliteTable(
  'pushed_commit_keys',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** `YYYY-MM-DD`, the author's day on the machine that reported it first. */
    day: text('day').notNull(),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    // A profile counts keys per day for one person: a covering range.
    index('pushed_commit_keys_user_day_idx').on(t.userId, t.day),
    // §11.6's retention deletes by day alone.
    index('pushed_commit_keys_day_idx').on(t.day),
  ],
);

// --------------------------------------------------------- §4.25 task_rounds

/**
 * One `finish_task` — an agent handing a task back for review, with what it
 * says it did (§4.25, D-082, LAI-758).
 *
 * **A task has as many rounds as it was finished**, numbered from 1: finished,
 * sent back, finished again is two rows, and the first is never rewritten.
 * The proof itself is `task_evidence`, one row per item.
 *
 * `client_name` is a **copy**, deliberately, where `created_by_client` is
 * derived: it is D-076's `last_client_name` at the moment of the finish, and
 * the token's current value says which agent connected last, not which one
 * finished this round.
 */
export const taskRounds = sqliteTable(
  'task_rounds',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** 1 for the first finish of this task, 2 for the next. */
    number: integer('number').notNull(),
    /** The person whose credential finished it. */
    finishedBy: text('finished_by')
      .notNull()
      .references(() => users.id),
    /** The token it arrived on; null on a web session or once the token is deleted. */
    tokenId: text('token_id').references(() => tokens.id, { onDelete: 'set null' }),
    /** What the agent called itself on that token when it finished (D-076). */
    clientName: text('client_name'),
    /** The summary and checklist, as posted in the round's comment. */
    summaryMd: text('summary_md').notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex('task_rounds_task_number_idx').on(t.taskId, t.number),
    index('task_rounds_finished_by_idx').on(t.finishedBy),
    index('task_rounds_token_id_idx').on(t.tokenId),
    check('task_rounds_number_check', sql.raw('number >= 1')),
  ],
);

// ------------------------------------------------------ §4.26 task_evidence

/**
 * One piece of a round's proof — a commit, the branch, the pull request or a
 * test run (§4.26, D-082, LAI-758).
 *
 * **Each item carries its own `state`**, `claimed` until something other than
 * the agent checks it. Step 2 (LAIKA-477) flips `state`, `state_source` and
 * `state_at` on a row; nothing else about the item changes, so it needs no
 * migration. `(kind, value)` is indexed for exactly that lookup: a webhook
 * knows a sha or a pull request URL, not a round.
 */
export const taskEvidence = sqliteTable(
  'task_evidence',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => taskRounds.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: EVIDENCE_KINDS }).notNull(),
    /** Order within the round, from 0: the order the agent sent them in. */
    position: integer('position').notNull(),
    /** The sha, the branch name, the pull request URL, or the test command. */
    value: text('value').notNull(),
    /** A commit's first line; null for every other kind. */
    detail: text('detail'),
    /** A test run's exit code; null for every other kind. */
    exitCode: integer('exit_code'),
    state: text('state', { enum: EVIDENCE_STATES }).notNull().default('claimed'),
    /** What changed `state` — `github` in step 2. Null while `claimed`. */
    stateSource: text('state_source'),
    /** When `state` last changed. Null while `claimed`. */
    stateAt: integer('state_at'),
    createdAt,
  },
  (t) => [
    index('task_evidence_round_position_idx').on(t.roundId, t.position),
    index('task_evidence_kind_value_idx').on(t.kind, t.value),
    check('task_evidence_kind_check', oneOf('kind', EVIDENCE_KINDS)),
    check('task_evidence_state_check', oneOf('state', EVIDENCE_STATES)),
    check(
      'task_evidence_exit_code_check',
      sql.raw("(kind = 'test_run') = (exit_code IS NOT NULL)"),
    ),
  ],
);

// ------------------------------------------------------- §4.27 task_reviews

/**
 * What a person did with a task waiting in review: accepted it, or sent it
 * back with a reason (§4.27, D-082, LAI-758).
 *
 * A send-back's reason is also posted as a comment, `comment_id`, so the
 * thread reads as it always did; this row is what marks that comment as a
 * send-back and what `get_task_context` reads first. A send-back stays the
 * task's current one until the next round or the next decision.
 */
export const taskReviews = sqliteTable(
  'task_reviews',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** The round decided on — the latest when it was decided; null when there was none. */
    roundId: text('round_id').references(() => taskRounds.id, { onDelete: 'set null' }),
    decision: text('decision', { enum: REVIEW_DECISIONS }).notNull(),
    /** Required for a send-back, null for an accept. */
    reasonMd: text('reason_md'),
    /** The comment the reason was posted as. */
    commentId: text('comment_id').references(() => comments.id, { onDelete: 'set null' }),
    decidedBy: text('decided_by')
      .notNull()
      .references(() => users.id),
    createdAt,
  },
  (t) => [
    index('task_reviews_task_created_at_idx').on(t.taskId, t.createdAt),
    index('task_reviews_round_id_idx').on(t.roundId),
    index('task_reviews_comment_id_idx').on(t.commentId),
    index('task_reviews_decided_by_idx').on(t.decidedBy),
    check('task_reviews_decision_check', oneOf('decision', REVIEW_DECISIONS)),
    check(
      'task_reviews_reason_check',
      sql.raw("(decision = 'sent_back') = (reason_md IS NOT NULL AND length(trim(reason_md)) > 0)"),
    ),
  ],
);

// ------------------------------------------------------ §4.28 github_commits

/**
 * A commit a GitHub delivery said exists (§4.28, D-083, LAI-766): every commit
 * of a `push`, and the head of a `pull_request`. What a commit item of a
 * round's proof is matched against — by full sha or an unambiguous prefix —
 * including a commit pushed before the agent finished. Kept 30 days from the
 * last delivery that named it.
 *
 * `branch` is the **first** branch it was seen on: a fast-forward to `main`
 * names the same commit again, and the branch it was made on is the one an
 * agent's proof names.
 */
export const githubCommits = sqliteTable(
  'github_commits',
  {
    /** `owner/name`, lowercased. */
    repo: text('repo').notNull(),
    /** The full 40-hex sha, lowercase. */
    sha: text('sha').notNull(),
    branch: text('branch'),
    /** The commit's own timestamp from the push, when it had one. */
    committedAt: integer('committed_at'),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repo, t.sha] }),
    // A prefix lookup is a range on `sha` (`>= prefix AND < prefix || 'g'`).
    index('github_commits_sha_idx').on(t.sha),
    index('github_commits_seen_at_idx').on(t.seenAt),
  ],
);

// ------------------------------------------------ §4.29 github_pull_requests

/**
 * A pull request as its newest `pull_request` delivery described it (§4.29,
 * D-083). Keyed by host, repository and number, lowercased, so the URL an
 * agent pasted matches the one GitHub sends whatever its case or suffix.
 */
export const githubPullRequests = sqliteTable(
  'github_pull_requests',
  {
    /** `github.com/owner/name#12`, lowercased. */
    key: text('key').primaryKey(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    /** GitHub's `html_url`, as sent. */
    url: text('url').notNull(),
    headSha: text('head_sha'),
    headRef: text('head_ref'),
    /** 1 once GitHub reports it merged. */
    merged: integer('merged').notNull().default(0),
    /** When GitHub says the pull request last changed. */
    eventAt: integer('event_at').notNull(),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => [
    index('github_pull_requests_head_sha_idx').on(t.headSha),
    index('github_pull_requests_seen_at_idx').on(t.seenAt),
  ],
);

// ------------------------------------------------------- §4.30 github_checks

/**
 * One CI result for one commit, as its newest delivery reported it (§4.30,
 * D-083): a check run, a workflow run or a check suite. Keyed by name, so a
 * re-run replaces the run it repeats — newest event wins — rather than leaving
 * the old failure beside the new pass.
 */
export const githubChecks = sqliteTable(
  'github_checks',
  {
    repo: text('repo').notNull(),
    headSha: text('head_sha').notNull(),
    kind: text('kind', { enum: GITHUB_CHECK_KINDS }).notNull(),
    /** The job's name, the workflow's name, or the app's slug for a suite. */
    name: text('name').notNull(),
    outcome: text('outcome', { enum: CHECK_OUTCOMES }).notNull(),
    /** GitHub's own `conclusion`, kept for the reader; null while pending. */
    conclusion: text('conclusion'),
    eventAt: integer('event_at').notNull(),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.repo, t.headSha, t.kind, t.name] }),
    index('github_checks_head_sha_idx').on(t.headSha),
    index('github_checks_seen_at_idx').on(t.seenAt),
    check('github_checks_kind_check', oneOf('kind', GITHUB_CHECK_KINDS)),
    check('github_checks_outcome_check', oneOf('outcome', CHECK_OUTCOMES)),
  ],
);

// --------------------------------------------------- §4.31 task_round_github

/**
 * What GitHub said about one round (§4.31, D-083): whether its pull request
 * was merged, and the CI line for its head commit. Written whenever the round
 * is checked, and kept with the round, so the proof reads the same after the
 * 30-day record it was computed from has gone.
 */
export const taskRoundGithub = sqliteTable('task_round_github', {
  roundId: text('round_id')
    .primaryKey()
    .references(() => taskRounds.id, { onDelete: 'cascade' }),
  /** 1 merged, 0 not merged, null when no delivery named the pull request. */
  prMerged: integer('pr_merged'),
  /** The commit CI was read for; null when the round names none. */
  ciHeadSha: text('ci_head_sha'),
  ciTotal: integer('ci_total').notNull().default(0),
  ciPassed: integer('ci_passed').notNull().default(0),
  ciFailed: integer('ci_failed').notNull().default(0),
  ciPending: integer('ci_pending').notNull().default(0),
  /** A JSON array of the names that failed, at most ten. */
  ciFailedNames: text('ci_failed_names').notNull().default('[]'),
  updatedAt,
});

// -------------------------------------------------- §4.32 token_usage_days

/**
 * Agents' token usage per day, as one machine last reported it (§4.32,
 * D-084, LAI-769): per (person, collector, day, agent, model, task) the four
 * counts the agent's own session files carry. **Counts only** — there is
 * deliberately no column that could hold a prompt, a reply, a path, a
 * repository, a branch or a session id; the task is Laika's own, resolved on
 * the way in, and anything else is unattributed (`task_id` null).
 *
 * A **snapshot per (person, collector, day)**: a report deletes that day's
 * rows for the machine and writes the new set, so a retry never counts twice
 * and a model gone from the day is gone from the table. Rows are unique per
 * (person, collector, day, agent, model, task) because the service folds a
 * report before writing; there is no key over a nullable `task_id` that
 * SQLite could enforce, so there is no primary key but the rowid.
 *
 * **Every read is one range of one index** (the Usage page's org total, a
 * project's, a person's, by agent and by model): the day and project indexes
 * carry every column those reads sum, so none of them touches the table.
 * Kept 400 days (§11.6).
 */
export const tokenUsageDays = sqliteTable(
  'token_usage_days',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** A random UUID the collector made once on that machine (§4.23's). */
    collectorId: text('collector_id').notNull(),
    /** `YYYY-MM-DD` in the machine's own time zone. */
    day: text('day').notNull(),
    /** An `AGENT_CLIENTS` slug: `claude-code`, `codex`, `gemini-cli`, … */
    agent: text('agent').notNull(),
    /** The model id the agent recorded, `[1m]`-style suffixes removed. */
    model: text('model').notNull(),
    /** The Laika task the tokens were spent on, when the collector knew it. */
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    /** The task's project, copied when the task is resolved. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Uncached input tokens. */
    input: integer('input').notNull().default(0),
    /** Output tokens, reasoning included. */
    output: integer('output').notNull().default(0),
    cacheWrite: integer('cache_write').notNull().default(0),
    cacheRead: integer('cache_read').notNull().default(0),
    updatedAt,
  },
  (t) => [
    // A report replaces (person, collector, day); a person's card is a range
    // of their days. Leads with the person, as the cascade on users needs.
    index('token_usage_days_user_day_idx').on(t.userId, t.day, t.collectorId),
    // The organisation's reads, and §11.6's retention: a range of days with
    // every summed column in the index, so no read touches the table. Agent
    // and model next, so the page's day × agent × model groups stream in
    // index order rather than sorting every row of the range.
    index('token_usage_days_day_idx').on(
      t.day,
      t.agent,
      t.model,
      t.userId,
      t.taskId,
      t.input,
      t.output,
      t.cacheWrite,
      t.cacheRead,
    ),
    // A project's reads, the same way; only rows tied to a task have one.
    index('token_usage_days_project_day_idx')
      .on(
        t.projectId,
        t.day,
        t.agent,
        t.model,
        t.userId,
        t.taskId,
        t.input,
        t.output,
        t.cacheWrite,
        t.cacheRead,
      )
      .where(sql`project_id IS NOT NULL`),
    // The cascade from a deleted task, and the task panel's read (LAI-770).
    index('token_usage_days_task_idx')
      .on(t.taskId, t.day)
      .where(sql`task_id IS NOT NULL`),
    check(
      'token_usage_days_counts_check',
      sql.raw('input >= 0 AND output >= 0 AND cache_write >= 0 AND cache_read >= 0'),
    ),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;

export type User = typeof users.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectStatus = typeof projectStatuses.$inferSelect;
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
export type MemberRating = typeof memberRatings.$inferSelect;
export type BoardActivityDay = typeof boardActivityDays.$inferSelect;
export type LocalActivityDay = typeof localActivityDays.$inferSelect;
export type PushedCommitKey = typeof pushedCommitKeys.$inferSelect;
export type TaskRound = typeof taskRounds.$inferSelect;
export type TaskEvidence = typeof taskEvidence.$inferSelect;
export type TaskReview = typeof taskReviews.$inferSelect;
export type GithubCommit = typeof githubCommits.$inferSelect;
export type GithubPullRequest = typeof githubPullRequests.$inferSelect;
export type GithubCheck = typeof githubChecks.$inferSelect;
export type TaskRoundGithub = typeof taskRoundGithub.$inferSelect;
export type TokenUsageDay = typeof tokenUsageDays.$inferSelect;
