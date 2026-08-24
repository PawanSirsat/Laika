import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { listActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { orgs, projects } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { eventView, type EventView } from './events.ts';
import { requireProjectBySlug } from './projects.ts';

/**
 * Reading `activity` (SPEC §6.4, §4.8, §6.3).
 *
 * ## The same answer as the stream, by construction
 *
 * LAI-048 already decided who may see which row (`visibleTo`) and what a row
 * looks like on the wire (`eventView`), for `GET /events`. This module reuses
 * both rather than restating either: two different answers from one table, one
 * over SSE and one over REST, is the bug this endpoint most easily ships, and a
 * test asserts the two agree row for row.
 *
 * The rows carry `seq`, so a client can tell that a row it fetched here is one it
 * already watched arrive live.
 *
 * ## Read-only, and structurally so
 *
 * This module exports readers and nothing else, and it never will. §4.8 is
 * append-only: `db/activity.ts` offers one writer, the database refuses `UPDATE`
 * and `DELETE` by trigger, and no route below `activity` accepts a method other
 * than `GET`. A mutation path here would be a door above a locked door.
 */

/** The org this actor belongs to. Single-org deployment (§4.2), so there is one. */
function orgIdFor(db: Db): string {
  const row = db.select({ id: orgs.id }).from(orgs).limit(1).get();
  if (row === undefined) throw new ApiError('conflict', 'This Laika has not been set up yet');
  return row.id;
}

/**
 * Every project this actor may read, decided by asking `can()` about each one.
 *
 * Derived rather than expressed as a `WHERE` clause on purpose. §3.3 makes `can()`
 * the only authority, and the org-role rules it applies — implicit lead for
 * owners and admins, the viewer cap of D-006 — are not things to reimplement in
 * SQL. `projects` is an org-level table with tens of rows, and `listProjects`
 * already reads it whole for the same reason.
 *
 * The result is then pushed *into* SQL as an id list, so the feed query itself
 * stays a single indexed descending scan instead of a filter-and-refetch loop.
 */
export function visibleProjectIds(db: Db, actor: ResolvedActor): string[] {
  return db
    .select({ id: projects.id })
    .from(projects)
    .all()
    .filter((row) => can(withProject(actor, row.id), 'project.read', { projectId: row.id }))
    .map((row) => row.id);
}

export interface ListActivityOptions {
  limit: number;
  /** Keyset position, `(created_at, id)` descending (§6.3). */
  cursor: { sortKey: string | number; id: string } | null;
  /** §6.4 `?since=` — inclusive, like every other time filter in §6.3. */
  since?: number | undefined;
  taskId?: string | undefined;
}

/**
 * The opaque §6.3 cursor, read as `(created_at, seq)`.
 *
 * Its second component carries the sequence rather than the row id — see
 * `listActivity` for why the ULID is not a usable tiebreaker here. A cursor that
 * does not decode to a sequence is a client error, not a reason to silently start
 * from the top: that would send a paging client round the feed for ever.
 */
function toCursor(
  cursor: ListActivityOptions['cursor'],
): { createdAt: number; seq: number } | null {
  if (cursor === null) return null;

  const createdAt = Number(cursor.sortKey);
  const seq = Number(cursor.id);

  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(seq) || seq < 0) {
    throw ApiError.badRequest('Malformed cursor');
  }

  return { createdAt, seq };
}

/** One project's feed. Membership is the whole gate; every row is in scope. */
export function listProjectActivity(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  options: ListActivityOptions,
): EventView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  return listActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.since === undefined ? {} : { since: options.since }),
    cursor: toCursor(options.cursor),
    // One over the limit, so the route can tell whether another page exists.
    limit: options.limit + 1,
  }).map(eventView);
}

/**
 * The org-wide feed (§6.4, "org-wide, viewer+").
 *
 * ## Which permission gates it
 *
 * `member_list.read` — the one §3.1 cell that is ✓ for all four org roles, which
 * is exactly the "viewer+" this criterion asks for, and which also means a
 * deactivated user gets nothing (`can()` refuses them before any row is read).
 *
 * It is a stand-in. §3.1 has **no cell** for "read the org activity feed", which
 * is filed as LAI-111 along with the same gap on the SSE stream. The real access
 * control is per row, below, and it is the same rule the stream applies.
 */
export function listOrgActivity(
  db: Db,
  actor: ResolvedActor,
  options: ListActivityOptions,
): EventView[] {
  assertCan(actor, 'member_list.read');

  return listActivity(db, {
    orgId: orgIdFor(db),
    projectIds: visibleProjectIds(db, actor),
    // Org-scoped rows — `token.created`, `member.role_changed` — are the audit
    // trail, and §3.1 grants that to Owner and Admin (see `visibleTo`).
    includeOrgScoped: can(actor, 'audit_log.export'),
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.since === undefined ? {} : { since: options.since }),
    cursor: toCursor(options.cursor),
    limit: options.limit + 1,
  }).map(eventView);
}
