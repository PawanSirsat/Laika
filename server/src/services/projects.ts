import { and, asc, eq, gt, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { apiFieldNames, appendActivity, latestFieldEdit } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  type ProjectColor,
  type ProjectRole,
  type TaskCreateMinRole,
  TASK_STATUSES,
  type TaskStatus,
} from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import {
  activity,
  projectContextRevisions,
  projectMemberships,
  projects,
  tasks,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type ResolvedActor, withProject, activityActor } from '../auth/resolve-actor.ts';
import { assertCan, can, projectRoleOnJoin } from '../policy/can.ts';
import { CAPABILITY_LABELS, implicitProjectRole } from '../policy/grants.ts';
// From `db/`, not `services/project-statuses.ts`: that module reads projects
// through this one, and the seed is all this needs.
import { createDefaultProjectStatuses } from '../db/project-statuses.ts';
import { noSuchProjectForAgent } from './work-requests.ts';
import {
  applyOffboardingChoice,
  assertOffboardingChoice,
  openTasksHeldBy,
  type OpenTasksChoice,
} from './offboarding.ts';

/**
 * Re-exported so `routes/projects.ts` can validate a role or a visibility
 * without importing `db/`, which CONVENTIONS §2 forbids for `http/routes/` and
 * `mcp/` alike.
 *
 * The same line, for the same reason, as `TASK_STATUSES` on `services/tasks.ts`
 * and `ORG_ROLES` on `services/invites.ts` (LAI-071, LAI-119). This file had
 * **four** retyped literals across two vocabularies — more than LAI-119 listed,
 * and found by the structural check rather than by reading the task.
 */
export {
  PROJECT_COLORS,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  TASK_CREATE_MIN_ROLES,
} from '../db/enums.ts';

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
  /** LAI-266. `null` means done work stays on the board for ever. */
  board_hide_done_days: number | null;
  /** The design's palette entry (D-103 item 4); `null` until one is picked. */
  color: ProjectColor | null;
  /** Who may create tasks here (D-103 item 6). */
  task_create_min_role: TaskCreateMinRole;
  /** Whether agent tokens may write here (D-103 item 7). */
  agents_allowed: boolean;
  /**
   * Prefixes this space carried before `prefix`, oldest first. Every key
   * under one of them still resolves to the same task (D-103 item 3).
   */
  former_prefixes: string[];
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
    board_hide_done_days: row.boardHideDoneDays,
    color: row.color,
    task_create_min_role: row.taskCreateMinRole,
    agents_allowed: row.agentsAllowed,
    former_prefixes: row.formerPrefixes,
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
 * A project this actor may read, or the **same refusal** a slug that names
 * nothing gets (LAI-555): the context document and its history must not tell
 * a caller that a project it cannot see exists. Byte for byte, so the two
 * cannot be told apart by status, code or message:
 *
 * - a person — a session or a personal token — gets the missing slug's `404`;
 * - a registered agent's token gets `403 agent_not_granted`, which is what
 *   §6.4 already answers an agent for a slug it may not use, real or made up
 *   ({@link noSuchProjectForAgent}).
 */
export function requireReadableProjectBySlug(
  db: Db,
  actor: ResolvedActor,
  slug: string,
): typeof projects.$inferSelect {
  const row = db.select().from(projects).where(eq(projects.slug, slug)).get();
  if (
    row !== undefined &&
    can(withProject(actor, row.id), 'project.read', { projectId: row.id })
  ) {
    return row;
  }
  const agent = actor.token?.agent;
  if (agent !== undefined && agent !== null) throw noSuchProjectForAgent();
  throw ApiError.notFound(`No project with slug "${slug}"`);
}

/**
 * The slug of a project this actor may read, from its id.
 *
 * Every service in this layer is addressed by slug, because that is what a URL
 * and a tool argument carry — but a task row carries a `project_id`, so anything
 * starting from a task needs this hop. One indexed lookup rather than a scan of
 * the readable list, and `project.read` is asserted here so an id that belongs
 * to a project the actor cannot see answers 404 rather than leaking its slug.
 */
export function projectSlugById(db: Db, actor: ResolvedActor, projectId: string): string {
  const row = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (row === undefined) throw ApiError.notFound(`No project with id "${projectId}"`);

  assertCan(withProject(actor, row.id), 'project.read', { projectId: row.id });
  return row.slug;
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
  /**
   * D-103 item 10. Absent is today's list, where an archived project is a
   * tombstone; `include` and `only` hand archived projects back whole.
   */
  archived?: ArchivedFilter | undefined;
}

export const ARCHIVED_FILTERS = ['include', 'only'] as const;
export type ArchivedFilter = (typeof ARCHIVED_FILTERS)[number];

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

  if (options.archived === 'only') conditions.push(isNotNull(projects.archivedAt));

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
  //
  // Asking for archived spaces widens nothing but this: whoever may restore
  // one (`project.archive`) sees it, member or not (D-103 item 10).
  const restorer = options.archived !== undefined && can(actor, 'project.archive');
  return rows
    .filter((row) => canSeeProject(actor, row.id) || (restorer && row.archivedAt !== null))
    .slice(0, options.limit + 1);
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
  /** LAI-266. Taken on create since LAI-976 — it was accepted and dropped. */
  board_hide_done_days?: number | null | undefined;
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
        boardHideDoneDays: input.board_hide_done_days ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // The creator leads it. Without an explicit row they hold only the implicit
    // lead their org role grants, so a later demotion would silently strip access.
    db.insert(projectMemberships)
      .values({ id: newId(), projectId: id, userId: actor.userId, role: 'lead', createdAt: now })
      .run();

    // A project without statuses has no board and can hold no task (LAI-738).
    // In the same transaction, so a project can never exist in that state.
    createDefaultProjectStatuses(db, id, now);

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

/**
 * `prefix` free in the org — held by no other project now, **and none before**
 * (D-103 item 3). An old prefix still resolves to its project's tasks, so a
 * second project taking it would make `LAI-42` name two tasks. `exceptId` is
 * the project being re-keyed, which may go back to a prefix it held itself.
 */
function assertPrefixFree(db: Db, orgId: string, prefix: string, exceptId?: string): void {
  const clash = db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.orgId, orgId),
        eq(projects.prefix, prefix),
        exceptId === undefined ? undefined : ne(projects.id, exceptId),
      ),
    )
    .get();

  if (clash !== undefined) {
    throw new ApiError('conflict', `A project with prefix "${prefix}" already exists`, {
      field: 'prefix',
    });
  }

  const former = db
    .select({ id: projects.id, formerPrefixes: projects.formerPrefixes })
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .all()
    .find((row) => row.id !== exceptId && row.formerPrefixes.includes(prefix));

  if (former !== undefined) {
    throw new ApiError(
      'conflict',
      `"${prefix}" was another space's prefix, and its old keys still lead there — pick another`,
      { field: 'prefix', reason: 'former' },
    );
  }
}

/**
 * The project a key's prefix names — its current prefix first, then any it
 * carried before (D-103 item 3). Every place that turns `LAI-42` into a task
 * asks this, so a re-keyed project's old keys resolve wherever new ones do.
 * Case-insensitive, as keys are typed. `orgId` narrows to one organisation
 * where the caller has it.
 */
export function projectIdByKeyPrefix(db: Db, prefix: string, orgId?: string): string | undefined {
  const wanted = prefix.toUpperCase();
  const inOrg = orgId === undefined ? undefined : eq(projects.orgId, orgId);

  const current = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.prefix, wanted), inOrg))
    .get();
  if (current !== undefined) return current.id;

  return db
    .select({ id: projects.id, formerPrefixes: projects.formerPrefixes })
    .from(projects)
    .where(inOrg)
    .all()
    .find((row) => row.formerPrefixes.includes(wanted))?.id;
}

/** Every prefix a project's keys resolve under: its own, then its former ones. */
export function keyPrefixesOf(row: {
  prefix: string;
  formerPrefixes: readonly string[];
}): string[] {
  return [row.prefix, ...row.formerPrefixes];
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
  /** Days after which finished work leaves the board; `null` never (LAI-266). */
  board_hide_done_days?: number | null | undefined;
  /** A palette entry, or `null` to clear it (D-103 item 4). */
  color?: ProjectColor | null | undefined;
  /** A new key prefix; every old key keeps resolving (D-103 item 3). */
  prefix?: string | undefined;
  task_create_min_role?: TaskCreateMinRole | undefined;
  agents_allowed?: boolean | undefined;
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
  if (input.board_hide_done_days !== undefined) {
    // `null` is "never", which is the default. A number is a count of days, so
    // zero would mean "hide it the moment it is done" — a real request, and one
    // nobody makes by accident, so it is allowed rather than special-cased.
    if (input.board_hide_done_days !== null && input.board_hide_done_days < 0) {
      throw new ApiError('unprocessable', 'Days must not be negative');
    }
    changes.boardHideDoneDays = input.board_hide_done_days;
  }
  if (input.visibility !== undefined) changes.visibility = input.visibility;
  if (input.color !== undefined) changes.color = input.color;
  if (input.task_create_min_role !== undefined) {
    changes.taskCreateMinRole = input.task_create_min_role;
  }
  if (input.agents_allowed !== undefined) changes.agentsAllowed = input.agents_allowed;

  if (input.prefix !== undefined) {
    const prefix = input.prefix.toUpperCase();
    if (prefix !== row.prefix) {
      assertPrefixFree(db, row.orgId, prefix, row.id);
      // The old prefix joins the list and the new one leaves it, so a space
      // going back to a prefix it held does not list it twice.
      changes.prefix = prefix;
      changes.formerPrefixes = [
        ...row.formerPrefixes.filter((held) => held !== prefix),
        row.prefix,
      ];
    }
  }

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
   * The revision `context_md` is (§4.68, LAI-555): `0` for a document never
   * written, then one more on every write. A write names it as
   * `base_revision`, and a stale one is refused `409`.
   */
  revision: number;
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
  const row = requireReadableProjectBySlug(db, actor, slug);

  return contextView(db, row);
}

export interface UpdateProjectContextInput {
  context_md: string;
  /**
   * The revision this write replaces (proposal §4.6, LAI-555). Not the
   * current one is `409 conflict`, `reason: stale_context_revision`, and
   * nothing is written.
   */
  base_revision: number;
  now?: number;
}

export function updateProjectContext(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: UpdateProjectContextInput,
): ProjectContextView {
  return reviseProjectContext(db, actor, slug, {
    baseRevision: input.base_revision,
    next: () => input.context_md,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export interface ReviseProjectContextInput {
  /**
   * The revision the caller read, or `null` for a write computed from the
   * current document **inside** the write — an append (LAI-555), which
   * cannot lose a simultaneous one because nothing runs between its read and
   * its write.
   */
  baseRevision: number | null;
  /**
   * Refuse a `null` base with `422`, **after** the permission check — a
   * `replace` must name what it replaces, and a caller who may not write at
   * all is told that first.
   */
  requireBase?: boolean;
  next: (current: string) => string;
  now?: number;
}

/**
 * Every write to the context document (§7.3, §4.68): one new immutable
 * revision, `projects.context_md` and `context_revision` moved to it, and one
 * `project.context_updated` row — or, on a stale `baseRevision`, a `409` and
 * no change at all.
 *
 * The check and the insert are one transaction, and the unique
 * `(project_id, revision)` index is the backstop: two writers that both read
 * revision N cannot both create N + 1.
 */
export function reviseProjectContext(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: ReviseProjectContextInput,
): ProjectContextView {
  // Read first, so a project the writer cannot see is the missing one's 404;
  // a reader who may not edit it is told `403`.
  const found = requireReadableProjectBySlug(db, actor, slug);
  assertCan(withProject(actor, found.id), 'project.settings.edit', { projectId: found.id });
  if (input.requireBase === true && input.baseRevision === null) {
    throw new ApiError(
      'unprocessable',
      '`replace` must name the `base_revision` it replaces; read it with `get_project_context`',
      { field: 'base_revision' },
    );
  }
  const now = input.now ?? Date.now();

  db.transaction(() => {
    const row = db.select().from(projects).where(eq(projects.id, found.id)).get()!;
    if (input.baseRevision !== null && input.baseRevision !== row.contextRevision) {
      throw new ApiError(
        'conflict',
        `The context document is at revision ${String(row.contextRevision)}, not ${String(input.baseRevision)}; read it again before you write`,
        {
          reason: 'stale_context_revision',
          base_revision: input.baseRevision,
          current_revision: row.contextRevision,
        },
      );
    }

    const document = input.next(row.contextMd);
    // Enforced here rather than only in the route's schema: an MCP tool reaches
    // this function without passing through zod, and a bound that only one entry
    // point applies is not a bound.
    if (document.length > CONTEXT_MD_LIMIT) {
      throw new ApiError('unprocessable', 'That context document is too long', {
        limit: CONTEXT_MD_LIMIT,
        length: document.length,
      });
    }

    const revision = row.contextRevision + 1;
    db.insert(projectContextRevisions)
      .values({
        id: newId(),
        projectId: row.id,
        revision,
        body: document,
        authorId: actor.userId,
        agentId: actor.token?.agent?.id ?? null,
        createdAt: now,
      })
      .run();
    db.update(projects)
      .set({ contextMd: document, contextRevision: revision, updatedAt: now })
      .where(eq(projects.id, row.id))
      .run();

    appendActivity(db, {
      orgId: row.orgId,
      projectId: row.id,
      ...activityActor(actor),
      // Not `project.updated` (LAI-113): the context document is the project's
      // shared brief, and an edit to it is not a settings change. It was
      // distinguishable only by `changed: ['context_md']`, which a `type` filter
      // never sees.
      type: 'project.context_updated',
      // **The `entity` / `action` payload stays, and that is not redundancy.**
      // `activity` is append-only in both directions, so every row written before
      // LAI-113 carries the old verb and is distinguishable *only* by those two
      // fields. Migrating them is not an option and not a shortcut declined — it
      // is the property the table exists to have. New rows carry both, which costs
      // a few bytes and means one payload shape across the whole table.
      // The lengths are what make this a *history* rather than a bare marker:
      // §7.3 wants a reviewer to see what changed between two agent sessions, and
      // "grew from 4k to 40k" is the version of that which costs no extra storage.
      // `revision` names the §4.68 row that holds the text itself (LAI-555).
      payload: {
        changed: ['context_md'],
        length: document.length,
        previous_length: row.contextMd.length,
        revision,
      },
      now,
    });
  });

  return contextView(db, db.select().from(projects).where(eq(projects.id, found.id)).get()!);
}

function contextView(db: Db, row: typeof projects.$inferSelect): ProjectContextView {
  const edit = latestFieldEdit(db, row.id, 'context_md');

  return {
    context_md: row.contextMd,
    revision: row.contextRevision,
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
/**
 * The name a membership row carries beside the id (LAI-984), so the history
 * export reads "who" without a join to a person who may since be renamed.
 * Null only for an id with no row, which the callers have already refused.
 */
function userNameOf(db: Db, userId: string): string | null {
  return (
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)).get()?.name ?? null
  );
}

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
    payload: { user_id: userId, user_name: userNameOf(db, userId), role },
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
    payload: { user_id: userId, user_name: userNameOf(db, userId), from: existing.role, to: role },
    now,
  });

  return listMembers(db, actor, slug);
}

/**
 * Take someone off a space (§6.4). Their open tasks there are the caller's to
 * decide (D-104 item 5, LAI-986): `openTasks` unassigns or reassigns them, and
 * without it a person holding any is `409` — see `services/offboarding.ts`.
 * The membership, the tasks and every activity row are one transaction.
 */
export function removeMember(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  userId: string,
  now: number = Date.now(),
  openTasks?: OpenTasksChoice,
): MemberView[] {
  const row = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, row.id), 'project.members.manage', { projectId: row.id });

  const existing = requireMembership(db, row.id, userId);

  if (existing.role === 'lead') assertNotLastLead(db, row.id, userId);

  db.transaction(
    () => {
      const open = openTasksHeldBy(db, userId, row.id);
      assertOffboardingChoice(db, actor, userId, open, openTasks);

      db.delete(projectMemberships).where(eq(projectMemberships.id, existing.id)).run();
      applyOffboardingChoice(db, actor, userId, open, openTasks, now);

      // A removal leaves no row behind, so `updated_since` cannot report it as a
      // tombstone — this activity row is how a catching-up client learns of it.
      appendActivity(db, {
        orgId: row.orgId,
        projectId: row.id,
        ...activityActor(actor),
        type: 'member.removed',
        payload: { user_id: userId, user_name: userNameOf(db, userId), role: existing.role },
        now,
      });
    },
    { behavior: 'immediate' },
  );

  return listMembers(db, actor, slug);
}

/** What leaving answers (D-103 item 5). */
export interface LeaveProjectView {
  slug: string;
  /**
   * `true` when the caller can still open the space after leaving — an org
   * role holding *Open every project* — so a screen does not tell an owner
   * they have lost something they have not.
   */
  implicit_access: boolean;
  /** Says so in words when `implicit_access`; `null` otherwise. */
  notice: string | null;
}

/**
 * Leave a space you are a member of (§6.4, D-103 item 5). Anyone may; the
 * last space admin is refused `409 last_lead` and told to hand over first —
 * the same rule `removeMember` keeps, said for the person it stops.
 */
export function leaveProject(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  now: number = Date.now(),
): LeaveProjectView {
  const row = requireProjectBySlug(db, slug);

  // Before `can()`: an org owner with no row would pass it on implicit lead
  // and then have nothing to leave.
  const existing = db
    .select()
    .from(projectMemberships)
    .where(
      and(eq(projectMemberships.projectId, row.id), eq(projectMemberships.userId, actor.userId)),
    )
    .get();
  if (existing === undefined) throw ApiError.notFound('You are not a member of this space');

  assertCan(withProject(actor, row.id), 'project.leave', { projectId: row.id });

  if (existing.role === 'lead') {
    assertNotLastLead(
      db,
      row.id,
      actor.userId,
      'You are the last space admin here — make someone else a space admin, then leave',
    );
  }

  db.delete(projectMemberships).where(eq(projectMemberships.id, existing.id)).run();

  appendActivity(db, {
    orgId: row.orgId,
    projectId: row.id,
    ...activityActor(actor),
    type: 'member.removed',
    payload: {
      user_id: actor.userId,
      user_name: userNameOf(db, actor.userId),
      role: existing.role,
      via: 'leave',
    },
    now,
  });

  const implicit = implicitProjectRole(actor.orgRole, actor.orgGrants) !== null;

  return {
    slug: row.slug,
    implicit_access: implicit,
    notice: implicit
      ? `You left ${row.name}, and can still open it: your organisation role holds “${CAPABILITY_LABELS.open_all_projects}”.`
      : null,
  };
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
function assertNotLastLead(
  db: Db,
  projectId: string,
  excludingUserId: string,
  message = 'A project must keep at least one lead',
): void {
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
    throw new ApiError('conflict', message, { field: 'role', reason: 'last_lead' });
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
    payload: { user_id: actor.userId, user_name: userNameOf(db, actor.userId), role, via: 'join' },
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
