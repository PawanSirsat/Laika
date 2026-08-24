import { and, asc, eq, gt, gte, or } from 'drizzle-orm';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type CreatedVia } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { comments, projects, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

/**
 * Comments on tasks (SPEC §4.7, §6.4, §3.2).
 *
 * This is the contract `add_comment` (§7.1) wraps in M3, so the rules live here
 * and the route is transport only (CONVENTIONS §2).
 *
 * ## Activity vocabulary
 *
 * §4.8's type list is closed and has **`comment.added` only** — nothing for edit
 * or delete. Growing it is a schema change and a task of its own, so all three
 * mutations write `comment.added` and distinguish themselves in the payload:
 * `{ action: 'created' | 'edited' | 'deleted' }`.
 *
 * That is a wart, and worth naming: an audit reader filtering on `type` sees a
 * deletion labelled "added" and has to read the payload to find out otherwise.
 * `comment.edited` and `comment.deleted` are filed as LAI-110; when they land,
 * the `action` payload stays as the historical record for rows written before.
 */

export interface CommentView {
  id: string;
  task_id: string;
  author_id: string;
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

export function addComment(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  bodyMd: string,
  now: number = Date.now(),
): CommentView {
  const { task, project } = requireTaskContext(db, taskId);
  assertCan(withProject(actor, project.id), 'comment.create', { projectId: project.id });

  const id = newId();

  db.insert(comments)
    .values({
      id,
      taskId,
      authorId: actor.userId,
      bodyMd,
      createdVia: createdViaFor(actor),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId: task.id,
    actorId: actor.userId,
    actorKind: 'user',
    type: 'comment.added',
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

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId: task.id,
    actorId: actor.userId,
    actorKind: 'user',
    type: 'comment.added',
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
    actorId: actor.userId,
    actorKind: 'user',
    type: 'comment.added',
    payload: { action: 'deleted', comment_id: commentId },
    now,
  });
}

export { toView as commentView };
