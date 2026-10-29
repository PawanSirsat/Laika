import { and, desc, eq } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import {
  agentSessionContextDeliveries,
  agentSessions,
  projectContextRevisions,
  projects,
  sprints,
  tasks,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { can } from '../policy/can.ts';
import { requireOwnOpenSession } from './claims.ts';
import { requireReadableProjectBySlug } from './projects.ts';
import { resolveTaskRef } from './tasks.ts';
import { diffLines } from './text-diff.ts';

/**
 * The context document's history and its delivery to agent sessions (SPEC
 * §4.68, §4.69, §7.3, proposal §4.6, LAI-555).
 *
 * Writes are `reviseProjectContext` in `projects.ts`; this module reads what
 * they left. Everything here follows **project read**, so a viewer sees the
 * history and a project the caller cannot read is the same `404` as one that
 * does not exist (`requireReadableProjectBySlug`).
 *
 * **Delivered, never understood.** Laika records that it *sent* a revision to
 * a session — the whole document or a diff ending at it. Whether the agent
 * read it, or acted on it, is not something the server can know, and nothing
 * here claims it.
 */

/** One revision without its text — the history list. */
export interface ContextRevisionSummaryView {
  revision: number;
  length: number;
  /** Null on a revision 1 that existed before revisions did (§4.68). */
  author_id: string | null;
  agent_id: string | null;
  created_at: number;
}

/** One revision with its text. */
export interface ContextRevisionView extends ContextRevisionSummaryView {
  body: string;
}

/** What changed between two revisions, as a unified line diff. */
export interface ContextDiffView {
  from_revision: number;
  to_revision: number;
  /** The project's current revision, so a caller sees whether `to` is it. */
  current_revision: number;
  diff: string;
  added: number;
  removed: number;
}

function readableProject(db: Db, actor: ResolvedActor, slug: string) {
  return requireReadableProjectBySlug(db, actor, slug);
}

function summary(row: typeof projectContextRevisions.$inferSelect): ContextRevisionSummaryView {
  return {
    revision: row.revision,
    length: row.body.length,
    author_id: row.authorId,
    agent_id: row.agentId,
    created_at: row.createdAt,
  };
}

/** `GET /projects/:slug/context/revisions` — newest first, no text. */
export function listContextRevisions(
  db: Db,
  actor: ResolvedActor,
  slug: string,
): ContextRevisionSummaryView[] {
  const project = readableProject(db, actor, slug);
  return db
    .select()
    .from(projectContextRevisions)
    .where(eq(projectContextRevisions.projectId, project.id))
    .orderBy(desc(projectContextRevisions.revision))
    .all()
    .map(summary);
}

/**
 * A revision's text, or `''` for revision 0 — the empty document every
 * project starts as, which has no row. A revision the project has not
 * reached is `404`.
 */
function revisionBody(db: Db, projectId: string, revision: number): string {
  if (revision === 0) return '';
  const row = db
    .select({ body: projectContextRevisions.body })
    .from(projectContextRevisions)
    .where(
      and(
        eq(projectContextRevisions.projectId, projectId),
        eq(projectContextRevisions.revision, revision),
      ),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No context revision ${String(revision)}`);
  return row.body;
}

function assertRevisionNumber(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError('unprocessable', `\`${name}\` is a revision number, 0 or more`, {
      field: name,
    });
  }
}

/** `GET /projects/:slug/context/revisions/:revision`. */
export function getContextRevision(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  revision: number,
): ContextRevisionView {
  const project = readableProject(db, actor, slug);
  assertRevisionNumber('revision', revision);
  const row = db
    .select()
    .from(projectContextRevisions)
    .where(
      and(
        eq(projectContextRevisions.projectId, project.id),
        eq(projectContextRevisions.revision, revision),
      ),
    )
    .get();
  if (row === undefined) throw ApiError.notFound(`No context revision ${String(revision)}`);
  return { ...summary(row), body: row.body };
}

/**
 * `GET /projects/:slug/context/diff?from=&to=` — `to` defaults to the
 * current revision. `from` may be 0, the empty document, so "everything" is
 * a diff too.
 */
export function diffProjectContext(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  from: number,
  to?: number,
): ContextDiffView {
  const project = readableProject(db, actor, slug);
  const target = to ?? project.contextRevision;
  assertRevisionNumber('from', from);
  assertRevisionNumber('to', target);
  if (from > target) {
    throw new ApiError('unprocessable', '`from` must not be after `to`', {
      field: 'from',
      from,
      to: target,
    });
  }

  const before = revisionBody(db, project.id, from);
  const after = revisionBody(db, project.id, target);
  return {
    from_revision: from,
    to_revision: target,
    current_revision: project.contextRevision,
    ...diffLines(before, after),
  };
}

// -------------------------------------------------------------- delivery

/**
 * Record that `revision` of this project's context was **delivered** to the
 * calling agent's own open session (§4.69). Only ever moves forward: a late
 * call that delivered an older revision does not undo a newer delivery.
 *
 * The caller has already read the project; the session is checked here, so
 * another agent's session is `404` and nothing is written.
 */
export function recordContextDelivery(
  db: Db,
  actor: ResolvedActor,
  sessionId: string,
  projectId: string,
  revision: number,
  now: number,
): void {
  const session = requireOwnOpenSession(db, actor, sessionId);
  const existing = deliveredRevision(db, session.id, projectId);
  if (existing !== null && existing >= revision) return;

  db.insert(agentSessionContextDeliveries)
    .values({ sessionId: session.id, projectId, revision, deliveredAt: now })
    .onConflictDoUpdate({
      target: [agentSessionContextDeliveries.sessionId, agentSessionContextDeliveries.projectId],
      set: { revision, deliveredAt: now },
    })
    .run();
}

/** The revision last delivered to a session in a project, or null if none. */
export function deliveredRevision(db: Db, sessionId: string, projectId: string): number | null {
  const row = db
    .select({ revision: agentSessionContextDeliveries.revision })
    .from(agentSessionContextDeliveries)
    .where(
      and(
        eq(agentSessionContextDeliveries.sessionId, sessionId),
        eq(agentSessionContextDeliveries.projectId, projectId),
      ),
    )
    .get();
  return row?.revision ?? null;
}

// ------------------------------------------------- the MCP response stamp

/**
 * `context_revision` on an MCP response (proposal §4.6): the project the call
 * was about, its current revision, and — when the call named a session — the
 * revision last delivered to that session. Null when the call was about no
 * single project, or about one this caller cannot read.
 */
export interface ContextRevisionStamp {
  project: string;
  revision: number;
  delivered_revision: number | null;
}

/** What a tool call names that can say which project it was about. */
export interface ContextStampArgs {
  project?: unknown;
  task?: unknown;
  sprint?: unknown;
  session_id?: unknown;
}

/** The project a tool call was about, by the reference it was given, or null. */
function projectIdOfCall(db: Db, actor: ResolvedActor, args: ContextStampArgs): string | null {
  if (typeof args.project === 'string') {
    return (
      db.select({ id: projects.id }).from(projects).where(eq(projects.slug, args.project)).get()
        ?.id ?? null
    );
  }
  if (typeof args.task === 'string') {
    const id = resolveTaskRef(db, args.task, actor);
    return db.select({ id: tasks.projectId }).from(tasks).where(eq(tasks.id, id)).get()?.id ?? null;
  }
  if (typeof args.sprint === 'string') {
    return (
      db.select({ id: sprints.projectId }).from(sprints).where(eq(sprints.id, args.sprint)).get()
        ?.id ?? null
    );
  }
  return null;
}

/**
 * The stamp for one tool call (proposal §4.6). Never throws: a call it cannot
 * place gets `null`, and so does a project this caller cannot read — the stamp
 * must not say more than the tool itself would. `delivered_revision` is read
 * only for the calling agent's **own** session; any other id reads as null.
 */
export function contextRevisionStamp(
  db: Db,
  actor: ResolvedActor,
  args: ContextStampArgs,
  sessionId: string | null,
): ContextRevisionStamp | null {
  let projectId: string | null;
  try {
    projectId = projectIdOfCall(db, actor, args);
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
  if (projectId === null) return null;

  const row = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (row === undefined) return null;
  if (!can(withProject(actor, row.id), 'project.read', { projectId: row.id })) return null;

  const agentId = actor.token?.agent?.id;
  const own =
    sessionId !== null &&
    agentId !== undefined &&
    db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.agentId, agentId)))
      .get() !== undefined;

  return {
    project: row.slug,
    revision: row.contextRevision,
    delivered_revision: own && sessionId !== null ? deliveredRevision(db, sessionId, row.id) : null,
  };
}

/**
 * The notice an agent behind on the context gets, at most 300 characters
 * (proposal §4.6). It names revisions, never the text: the document itself is
 * only ever sent when asked for.
 */
export function contextNotice(stamp: ContextRevisionStamp | null): string | null {
  const delivered = stamp?.delivered_revision ?? null;
  if (stamp === null || delivered === null || delivered >= stamp.revision) return null;
  return (
    `Project context changed: r${String(delivered)} → r${String(stamp.revision)}. ` +
    `Call get_project_context with since_revision: ${String(delivered)} for the diff.`
  );
}
