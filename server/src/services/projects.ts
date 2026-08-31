import { and, asc, eq, gt, gte, inArray, or, sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { apiFieldNames, appendActivity, latestFieldEdit } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type ProjectRole, TASK_STATUSES, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { activity, projectMemberships, projects, tasks, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type ResolvedActor, withProject, activityActor } from '../auth/resolve-actor.ts';
import { assertCan, can, projectRoleOnJoin } from '../policy/can.ts';

/**
 * Projects and their memberships (SPEC §4.3, §4.4, §6.4).
 *
 * Every function here takes an `Actor`, calls `assertCan` before it touches
 * anything, and writes exactly one `activity` row per mutation. Routes are
 * transport only (CONVENTIONS §2), which is what lets the M3 MCP tools reuse
 * these unchanged (SPEC §7).
 */

export interface ProjectView {
  id: string;
  slug: string;
  prefix: string;
  name: string;
  description: string | null;
  /** `owner/name`, or null. See `assertRepoShape` for why the shape is enforced. */
  repo: string | null;
  visibility: 'public' | 'private';
  context_md: string;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Just enough of a person to draw an avatar (§11.4.2.1, LAI-053).
 *
 * Id and display name, and deliberately **not** `MemberView` — that carries an
 * email, and sending every member's address to every viewer of a project list so
 * a card can draw a coloured circle is a privacy and payload mistake. The colour
 * itself is derived from the id client-side (§4.1, LAI-018), so it is not sent
 * either.
 */
export interface AvatarView {
  user_id: string;
  name: string;
}

/** The per-project numbers the Projects screen needs (§11.4.2.1). */
export interface ProjectSummary extends ProjectView {
  /** Live tasks by §4.5 status. Every status is present, zero included. */
  task_counts: Record<TaskStatus, number>;
  /** Tasks with at least one dependency that is not `done` (§4.5, derived). */
  blocked_count: number;
  member_count: number;
  /** The first few members by name, for avatars. See `AVATAR_LIMIT`. */
  members: AvatarView[];
  /** Newest `activity` row for this project, or null if nothing has happened. */
  last_activity_at: number | null;
}

/**
 * How many members a card shows before it stops being a row of avatars.
 *
 * `member_count` carries the real total, so a card can render "+7" without the
 * list growing with the team. Sending every member of every project on every
 * page load is the shape this exists to avoid.
 */
export const AVATAR_LIMIT = 5;

export interface MemberView {
  user_id: string;
  email: string;
  name: string;
  role: ProjectRole;
  created_at: number;
}

/**
 * The one place a project row becomes a `ProjectView`.
 *
 * Exported because `routes/projects.ts` had grown a hand-written copy of this
 * mapping for its tombstone path, and the two drifted the moment §4.3's `repo`
 * column arrived (LAI-108) — the duplicate simply did not have the field. One
 * mapping means the next column cannot do that.
 */
export function projectView(row: typeof projects.$inferSelect): ProjectView {
  return {
    id: row.id,
    slug: row.slug,
    prefix: row.prefix,
    name: row.name,
    description: row.description,
    repo: row.repo,
    visibility: row.visibility,
    context_md: row.contextMd,
    archived_at: row.archivedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** The org this actor belongs to. Single-org deployment (§4.2), so there is one. */
function orgIdFor(db: Db): string {
  const row = db
    .select({ id: sql<string>`id` })
    .from(sql`orgs`)
    .limit(1)
    .get();
  if (row === undefined) throw new ApiError('conflict', 'This Laika has not been set up yet');
  return row.id;
}

/** Load a project by its URL identity, or 404. */
export function requireProjectBySlug(db: Db, slug: string): typeof projects.$inferSelect {
  const row = db.select().from(projects).where(eq(projects.slug, slug)).get();
  if (row === undefined) throw ApiError.notFound(`No project with slug "${slug}"`);
  return row;
}

/**
 * A project is visible to org owners and admins, and to anyone holding a
 * membership. §3.2's "View project | ✓ | ✓ | assigned | assigned".
 *
 * Public projects are *joinable* by any org member (§3.1) but not readable until
 * they join — otherwise `visibility` would be the access control and membership
 * would mean nothing.
 */
export function canSeeProject(actor: ResolvedActor, projectId: string): boolean {
  return can(withProject(actor, projectId), 'project.read', { projectId });
}

export interface ListProjectsOptions {
  limit: number;
  /** Keyset cursor from LAI-006: `(updated_at, id)`. */
  cursor: { sortKey: string | number; id: string } | null;
  updatedSince: number | null;
}

/**
 * Projects this actor may see, ordered by `(updated_at, id)` so the LAI-006
 * cursor is stable, and one row over the limit so `buildPage` can tell whether
 * another page exists.
 */
export function listProjects(
  db: Db,
  actor: ResolvedActor,
  options: ListProjectsOptions,
): (typeof projects.$inferSelect)[] {
  const conditions = [];

  if (options.updatedSince !== null) {
    conditions.push(gte(projects.updatedAt, options.updatedSince));
  }

  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        gt(projects.updatedAt, key),
        and(eq(projects.updatedAt, key), gt(projects.id, options.cursor.id)),
      ),
    );
  }

  const rows = db
    .select()
    .from(projects)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(projects.updatedAt), asc(projects.id))
    .all();

  // Filtered in code rather than SQL: `can()` is the only authority (§3.3), and
  // duplicating its rules into a WHERE clause is how the two drift apart.
  return rows.filter((row) => canSeeProject(actor, row.id)).slice(0, options.limit + 1);
}

/**
 * The per-project numbers for a whole page, in **four** aggregate queries —
 * never one per card (LAI-053).
 *
 * Each is grouped over the page's project ids, so the cost is a function of how
 * many *statuses* and *members* exist rather than of how many projects are
 * listed. A 50-project page costs the same four round trips as a 2-project one,
 * which is asserted rather than claimed.
 *
 * **The live-agent indicator is deliberately absent.** It needs heartbeats
 * (M4, D-023) and there is no honest value to send — a card that showed "no
 * agents" would be indistinguishable from one that showed the truth, so the
 * field does not exist and the screen renders the indicator only when it does.
 */
export function projectSummaries(
  db: Db,
  projectIds: readonly string[],
): Map<string, Omit<ProjectSummary, keyof ProjectView>> {
  const empty = (): Omit<ProjectSummary, keyof ProjectView> => ({
    task_counts: Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>,
    blocked_count: 0,
    member_count: 0,
    members: [],
    last_activity_at: null,
  });

  const summaries = new Map(projectIds.map((id) => [id, empty()]));
  if (projectIds.length === 0) return summaries;

  const ids = [...projectIds];

  // 1. Tasks by status.
  for (const row of db
    .select({ projectId: tasks.projectId, status: tasks.status, total: sql<number>`COUNT(*)` })
    .from(tasks)
    .where(inArray(tasks.projectId, ids))
    .groupBy(tasks.projectId, tasks.status)
    .all()) {
    const summary = summaries.get(row.projectId);
    if (summary !== undefined) summary.task_counts[row.status] = row.total;
  }

  // 2. Blocked: a live task with at least one dependency that is not `done`.
  //    `COUNT(DISTINCT)` because a task blocked by three things is still one
  //    blocked task. Matches `isReady` in task-lifecycle.ts — a **cancelled**
  //    dependency still blocks, because that rule requires `done` and nothing
  //    else, and disagreeing here would put a different number on the card than
  //    the board's own `ready` flag implies.
  for (const row of db.all<{ projectId: string; total: number }>(
    sql`SELECT t.project_id AS projectId, COUNT(DISTINCT t.id) AS total
          FROM tasks t
          JOIN task_dependencies d ON d.task_id = t.id
          JOIN tasks dep ON dep.id = d.depends_on_task_id
         WHERE t.project_id IN (${sql.join(
           ids.map((id) => sql`${id}`),
           sql`, `,
         )})
           AND t.status NOT IN ('done', 'cancelled')
           AND dep.status <> 'done'
         GROUP BY t.project_id`,
  )) {
    const summary = summaries.get(row.projectId);
    if (summary !== undefined) summary.blocked_count = row.total;
  }

  // 3. Members, ordered so the avatars a card shows are stable between reads.
  for (const row of db
    .select({
      projectId: projectMemberships.projectId,
      userId: users.id,
      name: users.name,
    })
    .from(projectMemberships)
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .where(inArray(projectMemberships.projectId, ids))
    .orderBy(asc(projectMemberships.projectId), asc(users.name), asc(users.id))
    .all()) {
    const summary = summaries.get(row.projectId);
    if (summary === undefined) continue;

    summary.member_count += 1;
    if (summary.members.length < AVATAR_LIMIT) {
      summary.members.push({ user_id: row.userId, name: row.name });
    }
  }

  // 4. Last activity. §4.8 is the only source of truth for "when did something
  //    happen here" — `projects.updated_at` moves only when the row itself
  //    changes, so a project with a week of task activity and no settings edit
  //    would look untouched.
  for (const row of db
    .select({ projectId: activity.projectId, last: sql<number>`MAX(${activity.createdAt})` })
    .from(activity)
    .where(inArray(activity.projectId, ids))
    .groupBy(activity.projectId)
    .all()) {
    const summary = row.projectId === null ? undefined : summaries.get(row.projectId);
    if (summary !== undefined) summary.last_activity_at = row.last;
  }

  return summaries;
}

/** A project row plus its summary, for the list endpoint. */
export function projectSummaryView(
  row: typeof projects.$inferSelect,
  summary: Omit<ProjectSummary, keyof ProjectView> | undefined,
): ProjectSummary {
  return {
    ...projectView(row),
    task_counts: summary?.task_counts ?? ({} as Record<TaskStatus, number>),
    blocked_count: summary?.blocked_count ?? 0,
    member_count: summary?.member_count ?? 0,
    members: summary?.members ?? [],
    last_activity_at: summary?.last_activity_at ?? null,
  };
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  prefix: string;
  description?: string | undefined;
  visibility?: 'public' | 'private' | undefined;
  now?: number;
}

export function createProject(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  input: CreateProjectInput,
): ProjectView {
  assertCan(actor, 'project.create');

  const now = input.now ?? Date.now();
  const orgId = orgIdFor(db);
  const slug = input.slug.toLowerCase();
  const prefix = input.prefix.toUpperCase();

  return immediateTransaction(sqlite, () => {
    // Checked inside the write lock so two simultaneous creates cannot both see
    // a free slug. The unique indexes are the backstop; this produces the §6.3
    // `conflict` rather than a raw constraint error.
    assertSlugFree(db, slug);
    assertPrefixFree(db, orgId, prefix);

    const id = newId();

    db.insert(projects)
      .values({
        id,
        orgId,
        name: input.name,
        slug,
        prefix,
        description: input.description ?? null,
        visibility: input.visibility ?? 'private',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // The creator leads it. Without an explicit row they hold only the implicit
    // lead their org role grants, so a later demotion would silently strip access.
    db.insert(projectMemberships)
      .values({ id: newId(), projectId: id, userId: actor.userId, role: 'lead', createdAt: now })
      .run();

    appendActivity(db, {
      orgId,
      projectId: id,
      ...activityActor(actor),
      type: 'project.created',
      payload: { name: input.name, slug, prefix },
      now,
    });

    return projectView(db.select().from(projects).where(eq(projects.id, id)).get()!);
  });
}

function assertSlugFree(db: Db, slug: string): void {
  const clash = db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get();
  if (clash !== undefined) {
    throw new ApiError('conflict', `A project with slug "${slug}" already exists`, {
      field: 'slug',
    });
  }
}

function assertPrefixFree(db: Db, orgId: string, prefix: string): void {
  const clash = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.prefix, prefix)))
    .get();

  if (clash !== undefined) {
    throw new ApiError('conflict', `A project with prefix "${prefix}" already exists`, {
      field: 'prefix',
    });
  }
}

export function getProject(db: Db, actor: ResolvedActor, slug: string): ProjectView {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.read', { projectId: row.id });
  return projectView(row);
}

/**
 * `owner/name` and nothing else (§4.3).
 *
 * §4.3 gives this column one job: map an incoming heartbeat's `repo` (§9.1) to a
 * project. The plugin sends the repository as `owner/name`, so a value stored in
 * any other shape can never match and the project silently gets no presence —
 * the worst kind of failure, because the field looks set.
 *
 * **Rejected rather than normalised.** Accepting
 * `https://github.com/owner/name.git` and rewriting it would mean deciding which
 * hosts and which URL forms are legitimate, which is product nobody has asked
 * for. A 422 naming the expected shape costs the caller one edit and costs Laika
 * no guesses. The message includes an example, because "invalid format" on a
 * field like this is a puzzle.
 *
 * A `.git` suffix is called out separately: it satisfies the character rules but
 * would still never match what the plugin sends, and it is the second most likely
 * thing someone pastes.
 *
 * **What is deliberately not checked.** Each segment must *start* alphanumeric,
 * which is what rejects `./name` and `../owner/name` — the same family of mistake
 * as a URL. Trailing punctuation is allowed: whether `name-` is a legal
 * repository is the host's rule, hosts differ, and reimplementing GitHub's
 * naming policy for GitLab and Gitea as well would be a guess dressed as
 * validation.
 */
const REPO_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Long enough for any real `owner/name`; short enough not to be a text field. */
export const REPO_MAX_LENGTH = 200;

export function assertRepoShape(repo: string): void {
  const detail = { repo, expected: 'owner/name', example: 'PawanSirsat/Laika' };

  if (repo.length > REPO_MAX_LENGTH) {
    throw new ApiError(
      'unprocessable',
      `repo must be at most ${String(REPO_MAX_LENGTH)} characters`,
      detail,
    );
  }

  if (repo.endsWith('.git')) {
    throw new ApiError(
      'unprocessable',
      'repo must not end in ".git" — it is matched against what the plugin reports, which does not',
      detail,
    );
  }

  if (!REPO_SHAPE.test(repo)) {
    throw new ApiError(
      'unprocessable',
      'repo must be "owner/name" — not a URL, and not a bare name',
      detail,
    );
  }
}

/**
 * `repo` is deliberately **not unique** (LAI-108).
 *
 * A monorepo tracked by two projects — a frontend project and a backend project
 * over one repository — is a real arrangement, and a unique index would forbid it
 * to buy an unambiguous heartbeat match. The ambiguity is better handled where it
 * is understood: §9.2 resolves a task from the *branch*, so a heartbeat already
 * has a second signal, and attributing to every matching project is a defensible
 * answer that a constraint here would have taken off the table.
 *
 * The consequence is that the presence work must handle more than one match. It is
 * filed as LAI-116 rather than left to be discovered.
 */
export interface UpdateProjectInput {
  name?: string | undefined;
  description?: string | undefined;
  /** `owner/name`; `null` clears it. Absent leaves it alone. */
  repo?: string | null | undefined;
  visibility?: 'public' | 'private' | undefined;
  /** `true` archives, `false` restores. Absent leaves it alone. */
  archived?: boolean | undefined;
  now?: number;
}

export function updateProject(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: UpdateProjectInput,
): ProjectView {
  const row = requireProjectBySlug(db, slug);
  const scoped = withProject(actor, row.id);
  assertCan(scoped, 'project.settings.edit', { projectId: row.id });

  const now = input.now ?? Date.now();
  const changes: Record<string, unknown> = {};

  if (input.name !== undefined) changes.name = input.name;
  if (input.description !== undefined) changes.description = input.description;
  if (input.repo !== undefined) {
    if (input.repo !== null) assertRepoShape(input.repo);
    changes.repo = input.repo;
  }
  if (input.visibility !== undefined) changes.visibility = input.visibility;

  const archiving = input.archived === true && row.archivedAt === null;
  const restoring = input.archived === false && row.archivedAt !== null;

  if (archiving) {
    assertCan(scoped, 'project.archive');
    changes.archivedAt = now;
  }
  if (restoring) {
    assertCan(scoped, 'project.archive');
    changes.archivedAt = null;
  }

  if (Object.keys(changes).length === 0) return projectView(row);

  db.update(projects)
    .set({ ...changes, updatedAt: now })
    .where(eq(projects.id, row.id))
    .run();

  appendActivity(db, {
    orgId: row.orgId,
    projectId: row.id,
    ...activityActor(actor),
    // Archiving is its own event: it is what removes a project from every
    // active view, and an audit reader should not have to diff a payload to
    // discover that is what happened.
    type: archiving ? 'project.archived' : 'project.updated',
    payload: { changed: apiFieldNames(projects, Object.keys(changes)) },
    now,
  });

  return projectView(db.select().from(projects).where(eq(projects.id, row.id)).get()!);
}

// ------------------------------------------- the shared context document (§7.3)

/**
 * The one document per project that stops every teammate re-explaining the same
 * architecture to their own agent (SPEC §7.3).
 *
 * ## Why this is not `PATCH /projects/:slug` with one more field
 *
 * It was, until LAI-404, and `context_md` has been **removed from that path**
 * rather than left beside this one. Two writers of one column is two places to
 * enforce the size bound and two shapes of audit row, and the task asked for
 * exactly one. Nothing was using the general path for it: §6.4 specifies this
 * pair, and the SPA only ever reads the field.
 *
 * The permission is unchanged — §3.1's cell is "Edit project settings **and
 * `context_md`**", one row governing both, so this is `project.settings.edit`
 * like every other setting. Reading follows project read, so a viewer sees it.
 */
export interface ProjectContextView {
  context_md: string;
  /**
   * How long it is, so a client can show the budget before it truncates an
   * agent's context window rather than after (§7.3).
   */
  length: number;
  limit: number;
  /**
   * When the document was last edited and by whom — **`null` when no edit has
   * been recorded**, which is the honest answer for a project whose context has
   * never been written through this endpoint.
   *
   * Read from `activity` rather than a column on `projects`:
   * `projects.updated_at` moves when the project is renamed and would answer a
   * different question, and a denormalised copy is a copy that can drift.
   */
  updated_at: number | null;
  updated_by: string | null;
}

/**
 * §7.3's bound, and §14 question 7's answer.
 *
 * 100,000 characters — not invented here: it is the limit the `PATCH
 * /projects/:slug` zod schema has enforced since LAI-006, now made the service's
 * rule so both entry points cannot disagree about it. §7.3 says a context
 * document that silently blows an agent's context window is worse than no
 * document, so exceeding it is a `422` naming the limit **and the actual
 * length** — a caller that has to guess how much to cut will guess wrong.
 */
export const CONTEXT_MD_LIMIT = 100_000;

export function getProjectContext(db: Db, actor: ResolvedActor, slug: string): ProjectContextView {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.read', { projectId: row.id });

  return contextView(db, row);
}

export interface UpdateProjectContextInput {
  context_md: string;
  now?: number;
}

export function updateProjectContext(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: UpdateProjectContextInput,
): ProjectContextView {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.settings.edit', { projectId: row.id });

  // Enforced here rather than only in the route's schema: an MCP tool reaches
  // this function without passing through zod, and a bound that only one entry
  // point applies is not a bound.
  if (input.context_md.length > CONTEXT_MD_LIMIT) {
    throw new ApiError('unprocessable', 'That context document is too long', {
      limit: CONTEXT_MD_LIMIT,
      length: input.context_md.length,
    });
  }

  const now = input.now ?? Date.now();
  const previous = row.contextMd;

  db.update(projects)
    .set({ contextMd: input.context_md, updatedAt: now })
    .where(eq(projects.id, row.id))
    .run();

  appendActivity(db, {
    orgId: row.orgId,
    projectId: row.id,
    ...activityActor(actor),
    // `project.updated`, not a verb of its own: §4.8's vocabulary is closed and
    // growing it is a change to `docs/SPEC.md`, which is not this session's to
    // make (`schema-spec-drift.test.ts` enforces the pair in both directions).
    // Same reason `services/sprints.ts` rides under this verb.
    type: 'project.updated',
    // The lengths are what make this a *history* rather than a bare marker:
    // §7.3 wants a reviewer to see what changed between two agent sessions, and
    // "grew from 4k to 40k" is the version of that which costs no extra storage.
    payload: {
      changed: ['context_md'],
      length: input.context_md.length,
      previous_length: previous.length,
    },
    now,
  });

  return contextView(db, db.select().from(projects).where(eq(projects.id, row.id)).get()!);
}

function contextView(db: Db, row: typeof projects.$inferSelect): ProjectContextView {
  const edit = latestFieldEdit(db, row.id, 'context_md');

  return {
    context_md: row.contextMd,
    length: row.contextMd.length,
    limit: CONTEXT_MD_LIMIT,
    updated_at: edit?.createdAt ?? null,
    updated_by: edit?.actorId ?? null,
  };
}

export function listMembers(db: Db, actor: ResolvedActor, slug: string): MemberView[] {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.read', { projectId: row.id });

  return db
    .select({
      user_id: projectMemberships.userId,
      email: users.email,
      name: users.name,
      role: projectMemberships.role,
      created_at: projectMemberships.createdAt,
    })
    .from(projectMemberships)
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .where(eq(projectMemberships.projectId, row.id))
    .orderBy(asc(users.email))
    .all();
}

/**
 * §4.4: a user whose org role is `viewer` may hold **only** project role
 * `viewer`. Enforced here as well as capped in `can()` — this is the write path,
 * and refusing the row is better than storing one that gets silently downgraded
 * on every read.
 */
function assertRoleAllowedForUser(db: Db, userId: string, role: ProjectRole): void {
  const target = db
    .select({ orgRole: users.orgRole })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (target === undefined) throw ApiError.notFound('No such user');

  if (target.orgRole === 'viewer' && role !== 'viewer') {
    throw new ApiError('unprocessable', 'An org viewer may only hold the project role "viewer"', {
      field: 'role',
    });
  }
}

export function addMember(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  userId: string,
  role: ProjectRole,
  now: number = Date.now(),
): MemberView[] {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.members.manage', { projectId: row.id });
  assertRoleAllowedForUser(db, userId, role);

  const existing = db
    .select({ id: projectMemberships.id })
    .from(projectMemberships)
    .where(and(eq(projectMemberships.projectId, row.id), eq(projectMemberships.userId, userId)))
    .get();

  if (existing !== undefined) {
    throw new ApiError('conflict', 'That user is already a member of this project');
  }

  db.insert(projectMemberships)
    .values({ id: newId(), projectId: row.id, userId, role, createdAt: now })
    .run();

  appendActivity(db, {
    orgId: row.orgId,
    projectId: row.id,
    ...activityActor(actor),
    type: 'member.added',
    payload: { user_id: userId, role },
    now,
  });

  return listMembers(db, actor, slug);
}

export function changeMemberRole(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  userId: string,
  role: ProjectRole,
  now: number = Date.now(),
): MemberView[] {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.members.manage', { projectId: row.id });
  assertRoleAllowedForUser(db, userId, role);

  const existing = requireMembership(db, row.id, userId);

  if (existing.role === 'lead' && role !== 'lead') {
    assertNotLastLead(db, row.id, userId);
  }

  db.update(projectMemberships).set({ role }).where(eq(projectMemberships.id, existing.id)).run();

  appendActivity(db, {
    orgId: row.orgId,
    projectId: row.id,
    ...activityActor(actor),
    type: 'member.role_changed',
    payload: { user_id: userId, from: existing.role, to: role },
    now,
  });

  return listMembers(db, actor, slug);
}

export function removeMember(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  userId: string,
  now: number = Date.now(),
): MemberView[] {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.members.manage', { projectId: row.id });

  const existing = requireMembership(db, row.id, userId);

  if (existing.role === 'lead') assertNotLastLead(db, row.id, userId);

  db.delete(projectMemberships).where(eq(projectMemberships.id, existing.id)).run();

  // A removal leaves no row behind, so `updated_since` cannot report it as a
  // tombstone — this activity row is how a catching-up client learns of it.
  appendActivity(db, {
    orgId: row.orgId,
    projectId: row.id,
    ...activityActor(actor),
    type: 'member.removed',
    payload: { user_id: userId, role: existing.role },
    now,
  });

  return listMembers(db, actor, slug);
}

function requireMembership(
  db: Db,
  projectId: string,
  userId: string,
): typeof projectMemberships.$inferSelect {
  const row = db
    .select()
    .from(projectMemberships)
    .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
    .get();

  if (row === undefined) throw ApiError.notFound('That user is not a member of this project');
  return row;
}

/**
 * A project must keep at least one `lead` (AC5).
 *
 * Org owners and admins hold implicit lead everywhere, so a project can never be
 * literally unreachable — but the explicit membership is the durable fact. Losing
 * the last one means the project's leadership depends on somebody's org role,
 * which is exactly the silent coupling §4.4 memberships exist to avoid.
 */
function assertNotLastLead(db: Db, projectId: string, excludingUserId: string): void {
  const remaining = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, projectId),
        eq(projectMemberships.role, 'lead'),
        sql`${projectMemberships.userId} <> ${excludingUserId}`,
      ),
    )
    .get();

  if ((remaining?.n ?? 0) === 0) {
    throw new ApiError('conflict', 'A project must keep at least one lead', {
      field: 'role',
    });
  }
}

/** §3.1 "Join a `public` project". The role depends on the joiner's org role. */
export function joinPublicProject(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  now: number = Date.now(),
): MemberView[] {
  const row = requireProjectBySlug(db, slug);

  assertCan(actor, 'project.join_public', { projectId: row.id, visibility: row.visibility });

  const already = db
    .select({ id: projectMemberships.id })
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, row.id), eq(projectMemberships.userId, actor.userId)),
    )
    .get();

  if (already !== undefined) throw new ApiError('conflict', 'You are already a member');

  const role = projectRoleOnJoin(actor.orgRole);

  db.insert(projectMemberships)
    .values({ id: newId(), projectId: row.id, userId: actor.userId, role, createdAt: now })
    .run();

  appendActivity(db, {
    orgId: row.orgId,
    projectId: row.id,
    ...activityActor(actor),
    type: 'member.added',
    payload: { user_id: actor.userId, role, via: 'join' },
    now,
  });

  return listMembers(
    db,
    { ...actor, memberships: [...actor.memberships, { projectId: row.id, role }] },
    slug,
  );
}

/** Archived projects are the soft-delete of §6.3 for this resource. */
export function archivedTombstones(rows: (typeof projects.$inferSelect)[]): string[] {
  return rows.filter((r) => r.archivedAt !== null).map((r) => r.id);
}
