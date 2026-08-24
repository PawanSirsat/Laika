import { and, asc, eq, gt, gte, or, sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type ProjectRole } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { projectMemberships, projects, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
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
      actorId: actor.userId,
      actorKind: 'user',
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
  context_md?: string | undefined;
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
  if (input.context_md !== undefined) changes.contextMd = input.context_md;

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
    actorId: actor.userId,
    actorKind: 'user',
    // Archiving is its own event: it is what removes a project from every
    // active view, and an audit reader should not have to diff a payload to
    // discover that is what happened.
    type: archiving ? 'project.archived' : 'project.updated',
    payload: { changed: Object.keys(changes) },
    now,
  });

  return projectView(db.select().from(projects).where(eq(projects.id, row.id)).get()!);
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
    actorId: actor.userId,
    actorKind: 'user',
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
    actorId: actor.userId,
    actorKind: 'user',
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
    actorId: actor.userId,
    actorKind: 'user',
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
    actorId: actor.userId,
    actorKind: 'user',
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
