import { and, count, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type MemberNoticeKind } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { memberNotices, projects, tasks, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';

/**
 * A member's notices (SPEC §4.87, D-134, LAI-1136): being added to a space,
 * with the adder's message and first card, and — once LAI-1137 lands — a
 * tool, device or token of theirs revoked by somebody else.
 *
 * **Not activity.** §4.8 gains no verb: the adder's `member.added` row is the
 * history, and this is the person being told. **A self-action writes none** —
 * nobody needs telling what they did themselves.
 *
 * Its own module, importing no other service, so every writer may notify
 * through it — `projects.ts` now, the revokes later — without an import cycle.
 * Every read and mark is `notices.own`, session only (§3.1): the caller's own
 * rows, and no path names anybody else's.
 */

/** §4.87's `message`, at most. */
export const NOTICE_MESSAGE_MAX = 500;
/** §4.87's `subject`, at most. */
export const NOTICE_SUBJECT_MAX = 120;
/** §11.6: notices are kept 90 days, read or not. */
export const NOTICE_RETENTION_DAYS = 90;

export interface WriteNoticeInput {
  /** Who is told. */
  userId: string;
  /** Who did it. */
  actorUserId: string;
  kind: MemberNoticeKind;
  projectId?: string | null;
  taskId?: string | null;
  subject?: string | null;
  message?: string | null;
  now: number;
}

/**
 * Write one notice, in the caller's transaction. Returns its id, or `null`
 * for a self-action, which writes nothing.
 */
export function writeNotice(db: Db, input: WriteNoticeInput): string | null {
  if (input.userId === input.actorUserId) return null;

  const id = newId();
  db.insert(memberNotices)
    .values({
      id,
      userId: input.userId,
      actorUserId: input.actorUserId,
      kind: input.kind,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      subject: input.subject ?? null,
      message: input.message ?? null,
      createdAt: input.now,
    })
    .run();
  return id;
}

/** One row of `GET /me/notices`. */
export interface NoticeView {
  id: string;
  kind: MemberNoticeKind;
  actor: { id: string; name: string };
  /** The space, while it exists; `null` once it is gone or for a kind with none. */
  project: { id: string; slug: string; name: string } | null;
  /** The first card, while it exists. */
  task: { id: string; key: string; title: string } | null;
  subject: string | null;
  message: string | null;
  created_at: number;
  read_at: number | null;
}

export interface ListNoticesOptions {
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  /** `true` lists unread ones only. */
  unread: boolean;
}

/**
 * The caller's own notices, newest first, one row over the limit so
 * `buildPage` can tell there is more.
 */
export function listNotices(
  db: Db,
  actor: ResolvedActor,
  options: ListNoticesOptions,
): NoticeView[] {
  assertCan(actor, 'notices.own');

  const conditions: SQL[] = [eq(memberNotices.userId, actor.userId)];
  if (options.unread) conditions.push(isNull(memberNotices.readAt));
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        lt(memberNotices.createdAt, key),
        and(eq(memberNotices.createdAt, key), lt(memberNotices.id, options.cursor.id)),
      )!,
    );
  }

  return db
    .select({
      id: memberNotices.id,
      kind: memberNotices.kind,
      actorId: memberNotices.actorUserId,
      actorName: users.name,
      projectId: projects.id,
      projectSlug: projects.slug,
      projectName: projects.name,
      projectPrefix: projects.prefix,
      taskId: tasks.id,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      subject: memberNotices.subject,
      message: memberNotices.message,
      createdAt: memberNotices.createdAt,
      readAt: memberNotices.readAt,
    })
    .from(memberNotices)
    .innerJoin(users, eq(users.id, memberNotices.actorUserId))
    .leftJoin(projects, eq(projects.id, memberNotices.projectId))
    .leftJoin(tasks, eq(tasks.id, memberNotices.taskId))
    .where(and(...conditions))
    .orderBy(desc(memberNotices.createdAt), desc(memberNotices.id))
    .limit(options.limit + 1)
    .all()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      actor: { id: r.actorId, name: r.actorName },
      project:
        r.projectId === null
          ? null
          : { id: r.projectId, slug: r.projectSlug!, name: r.projectName! },
      task:
        r.taskId === null
          ? null
          : {
              id: r.taskId,
              key: `${r.projectPrefix}-${String(r.taskNumber)}`,
              title: r.taskTitle!,
            },
      subject: r.subject,
      message: r.message,
      created_at: r.createdAt,
      read_at: r.readAt,
    }));
}

/** How many of the caller's notices are unread — the whole count, not a page's. */
export function unreadNoticeCount(db: Db, actor: ResolvedActor): number {
  assertCan(actor, 'notices.own');
  return (
    db
      .select({ n: count() })
      .from(memberNotices)
      .where(and(eq(memberNotices.userId, actor.userId), isNull(memberNotices.readAt)))
      .get()?.n ?? 0
  );
}

/**
 * Mark one of the caller's notices read. Idempotent: a notice already read
 * keeps its first `read_at`. Somebody else's, or one that does not exist, is
 * the same `404`, so an id is never confirmed to exist.
 */
export function markNoticeRead(
  db: Db,
  actor: ResolvedActor,
  noticeId: string,
  now: number = Date.now(),
): void {
  assertCan(actor, 'notices.own');
  const own = and(eq(memberNotices.id, noticeId), eq(memberNotices.userId, actor.userId));
  const row = db.select({ id: memberNotices.id }).from(memberNotices).where(own).get();
  if (row === undefined) throw ApiError.notFound('No such notice');

  db.update(memberNotices)
    .set({ readAt: now })
    .where(and(own, isNull(memberNotices.readAt)))
    .run();
}

/** Mark every unread notice of the caller's read. Idempotent. */
export function markAllNoticesRead(db: Db, actor: ResolvedActor, now: number = Date.now()): void {
  assertCan(actor, 'notices.own');
  db.update(memberNotices)
    .set({ readAt: now })
    .where(and(eq(memberNotices.userId, actor.userId), isNull(memberNotices.readAt)))
    .run();
}
