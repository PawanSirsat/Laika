import { and, desc, eq, lt, or } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import {
  agentSessionContextDeliveries,
  agents,
  agentSessions,
  projectContextRevisions,
  projects,
  sprints,
  tasks,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { can } from '../policy/can.ts';
import { type AgentReader, agentLens, agentReader } from './agent-visibility.ts';
import { requireOwnOpenSession } from './claims.ts';
import { requireReadableProjectBySlug } from './projects.ts';
import { resolveTaskRef } from './tasks.ts';
import { diffLines, MAX_EDIT_DISTANCE } from './text-diff.ts';

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
  /**
   * The registered agent whose token wrote it — to its owner only. A revision
   * belongs to no task, so no task can show another person's agent here
   * (D-121 item 7, LAI-1012): to anyone else it is null with `agent_redacted`.
   */
  agent_id: string | null;
  /** An agent wrote it and this reader may not see which: *an agent*. */
  agent_redacted: boolean;
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
  /** Empty when nothing changed, and when `truncated`. */
  diff: string;
  /** Null when `truncated`. */
  added: number | null;
  removed: number | null;
  /**
   * More than {@link MAX_EDIT_DISTANCE} lines changed, so no diff is sent
   * (LAI-555 review): REST and MCP answer the same, with `hint` saying how
   * to read the revision whole.
   */
  truncated: boolean;
  /** Null unless `truncated`. */
  hint: string | null;
}

function readableProject(db: Db, actor: ResolvedActor, slug: string) {
  return requireReadableProjectBySlug(db, actor, slug);
}

type RevisionRow = typeof projectContextRevisions.$inferSelect;

/** Revisions as `reader` may see them: each agent through the one gate, beside no task. */
function summaries(
  db: Db,
  reader: AgentReader,
  rows: readonly RevisionRow[],
): ContextRevisionSummaryView[] {
  const lens = agentLens(
    db,
    reader,
    [],
    rows.flatMap((r) => (r.agentId === null ? [] : [r.agentId])),
  );
  return rows.map((row) => {
    const hidden = row.agentId !== null && !lens.visible(null, row.agentId);
    return {
      revision: row.revision,
      length: row.body.length,
      author_id: row.authorId,
      agent_id: hidden ? null : row.agentId,
      agent_redacted: hidden,
      created_at: row.createdAt,
    };
  });
}

/** `GET /projects/:slug/context/revisions` — newest first, no text. */
export function listContextRevisions(
  db: Db,
  actor: ResolvedActor,
  slug: string,
): ContextRevisionSummaryView[] {
  const project = readableProject(db, actor, slug);
  const rows = db
    .select()
    .from(projectContextRevisions)
    .where(eq(projectContextRevisions.projectId, project.id))
    .orderBy(desc(projectContextRevisions.revision))
    .all();
  return summaries(db, agentReader(actor), rows);
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
  return { ...summaries(db, agentReader(actor), [row])[0]!, body: row.body };
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
  const lines = diffLines(before, after);
  return {
    from_revision: from,
    to_revision: target,
    current_revision: project.contextRevision,
    ...lines,
    hint: lines.truncated
      ? `More than ${MAX_EDIT_DISTANCE.toLocaleString('en')} lines changed between revision ${String(from)} and ${String(target)}, so no diff is sent. Read revision ${String(target)} whole: GET /api/v1/projects/${slug}/context/revisions/${String(target)}, or get_project_context without since_revision.`
      : null,
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

// ------------------------------------------------ who it was delivered to

/**
 * The agent a delivery row names, to a reader who may see it (D-120, D-121):
 * the reader's **own** agent. Another person's agent is missing to everyone
 * else (D-121 item 7), so its row carries `agent: null` and no id or label an
 * agent route would answer `404` for — the rule a round's `agent` follows
 * (LAI-1001), with no task here to make anyone else's agent visible.
 */
export interface ContextDeliveryAgentView {
  id: string;
  harness: string;
  device_label: string | null;
  /** The agent's registered name — served only to its owner (D-120), who this is. */
  display_name: string;
  /** A revoked agent's sessions stay listed, with its label. */
  status: string;
}

/** One session's **latest** delivery in a project (§4.69). */
export interface ContextDeliveryView {
  session_id: string;
  /** The revision last delivered to the session — never one before it. */
  revision: number;
  /** When the server sent it. Sent, never read or understood (§4.69). */
  delivered_at: number;
  /** Null while the session is open. */
  session_ended_at: number | null;
  /** The session's agent when it is the reader's own; null otherwise. */
  agent: ContextDeliveryAgentView | null;
}

/**
 * `GET /projects/:slug/context/deliveries` (§6.4, LAI-1003). §4.69 keeps one
 * row per (session, project): the revision **last** delivered. So this says
 * which revision each session has now, and is not a history — a session later
 * given N+1 is no longer listed under N. `scope` says so on every answer.
 */
export interface ContextDeliveriesView {
  scope: 'latest_per_session';
  /** The filter asked for, or null for every session. */
  revision: number | null;
  current_revision: number;
  data: ContextDeliveryView[];
  next_cursor: string | null;
}

export interface ListContextDeliveriesOptions {
  /** Only sessions whose latest delivery is this revision; it must exist. */
  revision: number | null;
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
}

/**
 * The page under `GET /projects/:slug/context/deliveries`, newest delivery
 * first, `limit + 1` rows so the route can tell whether another page follows.
 *
 * Project read first (`requireReadableProjectBySlug` calls `can()`), so a
 * project the caller cannot read is the missing slug's answer and nothing is
 * read. A revision the project has not reached is the revision read's `404`.
 * Three statements whatever the page holds: the project, the revision (when
 * filtered) and one join for the rows and their agents.
 */
export function listContextDeliveries(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  options: ListContextDeliveriesOptions,
): { project: typeof projects.$inferSelect; rows: ContextDeliveryView[] } {
  const project = readableProject(db, actor, slug);
  if (options.revision !== null) {
    assertRevisionNumber('revision', options.revision);
    const reached = db
      .select({ id: projectContextRevisions.id })
      .from(projectContextRevisions)
      .where(
        and(
          eq(projectContextRevisions.projectId, project.id),
          eq(projectContextRevisions.revision, options.revision),
        ),
      )
      .get();
    if (reached === undefined) {
      throw ApiError.notFound(`No context revision ${String(options.revision)}`);
    }
  }

  const d = agentSessionContextDeliveries;
  const conditions = [eq(d.projectId, project.id)];
  if (options.revision !== null) conditions.push(eq(d.revision, options.revision));
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(lt(d.deliveredAt, key), and(eq(d.deliveredAt, key), lt(d.sessionId, options.cursor.id)))!,
    );
  }

  const reader = actor.userId;
  const rows = db
    .select({
      sessionId: d.sessionId,
      revision: d.revision,
      deliveredAt: d.deliveredAt,
      endedAt: agentSessions.endedAt,
      agentId: agents.id,
      ownerUserId: agents.ownerUserId,
      harness: agents.harness,
      deviceLabel: agents.deviceLabel,
      displayName: agents.displayName,
      status: agents.status,
    })
    .from(d)
    .innerJoin(agentSessions, eq(agentSessions.id, d.sessionId))
    .innerJoin(agents, eq(agents.id, agentSessions.agentId))
    .where(and(...conditions))
    .orderBy(desc(d.deliveredAt), desc(d.sessionId))
    .limit(options.limit + 1)
    .all();

  return {
    project,
    rows: rows.map((row) => ({
      session_id: row.sessionId,
      revision: row.revision,
      delivered_at: row.deliveredAt,
      session_ended_at: row.endedAt,
      agent:
        row.ownerUserId === reader
          ? {
              id: row.agentId,
              harness: row.harness,
              device_label: row.deviceLabel,
              display_name: row.displayName,
              status: row.status,
            }
          : null,
    })),
  };
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
