import { and, asc, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  activityActor,
  isSystemPrincipal,
  type ResolvedActor,
  type ServiceCaller,
  withProject,
} from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type CreatedVia } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { comments, projects, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { syncMentions } from './mentions.ts';

/**
 * Comments on tasks (SPEC §4.7, §6.4, §3.2).
 *
 * This is the contract `add_comment` (§7.1) wraps in M3, so the rules live here
 * and the route is transport only (CONVENTIONS §2).
 *
 * ## Activity vocabulary
 *
 * Each mutation writes its own verb — `comment.added`, `comment.edited`,
 * `comment.deleted` (LAI-110). Until then all three wrote `comment.added` and
 * distinguished themselves in the payload, which meant an audit reader filtering
 * on `type` — the obvious query, and what the indexes on that table are for — saw
 * a deletion labelled "added".
 *
 * **The `action` payload field stays.** Rows written before LAI-110 carry
 * `{ action: 'created' | 'edited' | 'deleted' }` as their *only* distinguishing
 * mark, so dropping it would make that history unreadable — an audit trail that
 * loses its old entries when the vocabulary grows is not an audit trail. New rows
 * carry both, which costs a few bytes and means one payload shape across the whole
 * table.
 */

export interface CommentView {
  id: string;
  task_id: string;
  author_id: string | null;
  body_md: string;
  created_via: CreatedVia;
  /** Non-null once edited, so a UI can say "edited" without comparing timestamps. */
  edited_at: number | null;
  created_at: number;
  updated_at: number;
}

type CommentRow = typeof comments.$inferSelect;

function toView(row: CommentRow): CommentView {
  return {
    id: row.id,
    task_id: row.taskId,
    author_id: row.authorId,
    body_md: row.bodyMd,
    created_via: row.createdVia,
    edited_at: row.editedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** How the request arrived (§4.7). A token-authenticated caller is an agent. */
export function createdViaFor(actor: ResolvedActor): CreatedVia {
  return actor.token === null || actor.token === undefined ? 'web' : 'api';
}

/**
 * A mirrored comment has no author, and therefore no editor and no deleter
 * (§3.2, §10.1, LAI-449).
 *
 * **Explicit, rather than falling out of the `ownerId` comparison.** §3.2's two
 * cells are *own* and *own + any*: `null === actor.userId` is false, so the
 * *own* half already refuses — but a project **lead** holds *any*, falls
 * through, and would be allowed. `can()` answering "yes" there is not wrong; it
 * is answering a question about a comment that has an owner.
 *
 * The reason it must be nobody: this row is a record of what somebody said on
 * GitHub. **Editing it would make Laika assert that a person said something they
 * did not**, and deleting it drops half of a conversation whose other half lives
 * somewhere Laika does not control. Neither is a permission a role should carry.
 *
 * `409` rather than `403`: it is not that this actor may not: it is that the
 * request does not apply to this comment, whoever is asking.
 */
function assertHasAuthor(comment: { authorId: string | null }): void {
  if (comment.authorId === null) {
    throw new ApiError('conflict', 'A mirrored comment has no author and cannot be changed here', {
      reason: 'no_local_author',
    });
  }
}

function requireTaskContext(db: Db, taskId: string) {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (project === undefined) throw ApiError.notFound('That task belongs to no project');

  return { task, project };
}

function requireCommentContext(db: Db, commentId: string) {
  const comment = db.select().from(comments).where(eq(comments.id, commentId)).get();
  if (comment === undefined) throw ApiError.notFound(`No comment with id "${commentId}"`);

  const { task, project } = requireTaskContext(db, comment.taskId);
  return { comment, task, project };
}

export interface ListCommentsOptions {
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  updatedSince: number | null;
}

/**
 * Comments on a task, **oldest first** — a conversation reads forwards, unlike
 * the activity feed. The cursor is `(created_at, id)` to match that order.
 *
 * Soft-deleted rows are returned only when catching up via `updated_since`, and
 * the caller turns those into §6.3 tombstones. A plain read never shows them.
 */
export function listComments(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  options: ListCommentsOptions,
): CommentRow[] {
  const { project } = requireTaskContext(db, taskId);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const conditions = [eq(comments.taskId, taskId)];

  if (options.updatedSince !== null) {
    conditions.push(gte(comments.updatedAt, options.updatedSince));
  }

  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        gt(comments.createdAt, key),
        and(eq(comments.createdAt, key), gt(comments.id, options.cursor.id)),
      )!,
    );
  }

  const rows = db
    .select()
    .from(comments)
    .where(and(...conditions))
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .all();

  // Without a watermark a deleted comment is simply gone; with one it still has
  // to be reported, or a catching-up client keeps showing something that was
  // removed (§6.3).
  const visible = options.updatedSince === null ? rows.filter((r) => r.deletedAt === null) : rows;

  return visible.slice(0, options.limit + 1);
}

/**
 * How many live comments each of these tasks has, in **one** query (LAI-072).
 *
 * ## Derived, never stored
 *
 * A counter column would be a second source of truth that drifts from the rows
 * the moment any write path forgets it — and §4.7's soft delete means "the
 * number of comments" is already a question with two answers. Counting at read
 * time cannot disagree with the thread the reader then opens, which is the
 * failure worth avoiding: a card promising three comments that opens onto two is
 * a bug nobody can explain from the UI.
 *
 * ## Soft-deleted comments do not count
 *
 * `deleted_at IS NULL`, matching what `listComments` shows a reader by default.
 * The one place that deliberately returns deleted rows is a `updated_since`
 * catch-up, which needs the tombstone (§6.3) — a *count* has no such need, so it
 * has no such exception.
 *
 * Returns an entry for every id asked about, zero included, so a caller never
 * has to tell "no comments" from "not loaded".
 */
export function commentCounts(db: Db, taskIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>(taskIds.map((id) => [id, 0]));
  if (taskIds.length === 0) return counts;

  const rows = db
    .select({ taskId: comments.taskId, total: sql<number>`COUNT(*)` })
    .from(comments)
    .where(and(inArray(comments.taskId, [...taskIds]), isNull(comments.deletedAt)))
    .groupBy(comments.taskId)
    .all();

  for (const row of rows) counts.set(row.taskId, row.total);

  return counts;
}

export function addComment(
  db: Db,
  actor: ServiceCaller,
  taskId: string,
  bodyMd: string,
  now: number = Date.now(),
): CommentView {
  const { task, project } = requireTaskContext(db, taskId);
  assertCan(withProject(actor, project.id), 'comment.create', { projectId: project.id });

  const id = newId();
  // **No author, and `webhook` says why** (§10.1, LAI-449). The two fields are
  // set together on purpose: a null author with `created_via: 'web'` would be a
  // row nobody can explain.
  const system = isSystemPrincipal(actor);

  db.insert(comments)
    .values({
      id,
      taskId,
      authorId: system ? null : actor.userId,
      bodyMd,
      createdVia: system ? 'webhook' : createdViaFor(actor),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // After the insert, because `comment_mentions.comment_id` is a foreign key.
  syncMentions(db, id, project.id, bodyMd, now);

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId: task.id,
    ...activityActor(actor),
    type: 'comment.added',
    // `action` is redundant with `type` for rows written from LAI-110 onward, and
    // load-bearing for every row written before it. See the module comment.
    payload: { action: 'created', comment_id: id },
    now,
  });

  return toView(db.select().from(comments).where(eq(comments.id, id)).get()!);
}

export function editComment(
  db: Db,
  actor: ResolvedActor,
  commentId: string,
  bodyMd: string,
  now: number = Date.now(),
): CommentView {
  const { comment, task, project } = requireCommentContext(db, commentId);

  if (comment.deletedAt !== null) {
    throw new ApiError('conflict', 'That comment has been deleted');
  }

  assertHasAuthor(comment);

  // §3.2: a member edits their own; a lead and org Admin/Owner may edit any.
  // `ownerId` is what `can()` compares against for the `own` cells.
  assertCan(withProject(actor, project.id), 'comment.edit', {
    projectId: project.id,
    ownerId: comment.authorId,
  });

  db.update(comments)
    .set({ bodyMd, editedAt: now, updatedAt: now })
    .where(eq(comments.id, commentId))
    .run();

  // Re-derived, not merged: a name the edit removed is no longer a mention (§4.19).
  syncMentions(db, commentId, project.id, bodyMd, now);

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId: task.id,
    ...activityActor(actor),
    type: 'comment.edited',
    payload: { action: 'edited', comment_id: commentId },
    now,
  });

  return toView(db.select().from(comments).where(eq(comments.id, commentId)).get()!);
}

/**
 * Soft delete (§4.7): `deleted_at` is set and the row stays.
 *
 * The row is retained because it is referenced by the activity trail and because
 * a hard delete would make `updated_since` unable to report the removal at all —
 * the same problem membership removal has in LAI-010, avoided here because §4.7
 * gave comments a `deleted_at`.
 */
export function deleteComment(
  db: Db,
  actor: ResolvedActor,
  commentId: string,
  now: number = Date.now(),
): void {
  const { comment, task, project } = requireCommentContext(db, commentId);

  if (comment.deletedAt !== null) {
    throw new ApiError('conflict', 'That comment has already been deleted');
  }

  assertHasAuthor(comment);

  assertCan(withProject(actor, project.id), 'comment.delete', {
    projectId: project.id,
    ownerId: comment.authorId,
  });

  db.update(comments)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(comments.id, commentId))
    .run();

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId: task.id,
    ...activityActor(actor),
    type: 'comment.deleted',
    payload: { action: 'deleted', comment_id: commentId },
    now,
  });
}

export { toView as commentView };
