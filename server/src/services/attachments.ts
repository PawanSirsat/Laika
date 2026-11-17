import { and, asc, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import {
  activityActor,
  type ResolvedActor,
  type ServiceCaller,
  withProject,
} from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { attachments, comments, projects, tasks } from '../db/schema.ts';
import { type AttachmentsEnv } from '../env.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, systemPrincipal } from '../policy/can.ts';
import { requireProjectBySlug } from './projects.ts';
import { type StoreClient, storeClient, StoreUnavailableError } from './s3-client.ts';

/**
 * Attachments (§4.92, §6.4, D-150, LAI-1300): files on a project, a task and
 * a comment, kept in **the operator's** S3-compatible store.
 *
 * ## Bytes never pass through Laika
 *
 * Every request to Laika is capped at 1 MiB (§13.1), and the Ksage
 * deployment's proxy cuts a request at ~26 s. So a browser asks for an upload
 * (`createAttachment`), gets a presigned `PUT` that signs the key, the type,
 * the length and the disposition — the store itself refuses anything bigger
 * or different — uploads straight to the store, and says it is done
 * (`completeAttachment`). Laika then `HEAD`s the object and reads its first
 * sixteen bytes before calling it `ready`. Reading is a 302 to a presigned
 * `GET` (`attachmentContentUrl`), five minutes long.
 *
 * ## What a browser is shown, and what it is made to download
 *
 * A file is shown in the page only when it is a png, jpeg, gif, webp or pdf
 * **and its first bytes say so** (`inline`); everything else — SVG and HTML
 * included — is served `application/octet-stream` as a download. The store
 * answers with whatever the presigned `GET` signs as `response-content-type`,
 * and the store D-150 runs sends no `X-Content-Type-Options`, so this forced
 * type is what keeps active content from rendering on the store's origin.
 *
 * ## Markdown holds Laika's own URL, never the store's
 *
 * `/api/v1/attachments/<id>/content` — a relative URL that never expires —
 * and text that carries one links the file to its task and comment on save
 * (`linkAttachmentRefs`), as `syncMentions` reads `@` handles: REST and MCP
 * alike, with no new request field.
 *
 * ## Off unless configured
 *
 * No `LAIKA_S3_*` is no attachments: every route answers `503 unavailable`
 * with `details.reason: 'attachments_off'`, and `GET /org` says
 * `attachments: null`, so the SPA offers no attach control (D-150 item 1).
 */

/** The store, its fetch and its clock — injected by the tests, which never call a store. */
export interface AttachmentsDeps {
  /** `null` is off. */
  config: AttachmentsEnv | null;
  fetchImpl?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
}

/** How long an upload nobody finished, or a file nothing linked, is kept (§11.6). */
export const ATTACHMENT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * How long after asking an upload may still be completed. The presigned `PUT`
 * lives ten minutes; an hour is well past it and far short of the sweep's 24,
 * so a completion can never race the sweep deleting the same row.
 */
export const COMPLETE_WITHIN_MS = 60 * 60 * 1000;

/** The most a sweep does in one run, per case, so an hourly run stays short. */
const SWEEP_BATCH = 500;

/** The bytes read to decide `inline`. */
const SNIFF_BYTES = 16;

export interface AttachmentView {
  id: string;
  project_id: string;
  task_id: string | null;
  comment_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  /** Shown in the page; otherwise a download (D-150 item 4). */
  inline: boolean;
  uploaded_by: string;
  created_at: number;
  /** When the upload was confirmed; null while `pending`. */
  ready_at: number | null;
  /** `/api/v1/attachments/<id>/content` — what markdown embeds. */
  url: string;
}

/** Where and how the browser uploads: valid ten minutes. */
export interface AttachmentUploadTicketView {
  url: string;
  method: 'PUT';
  /** Sent exactly as given — the signature covers them, and the browser sets `content-length`. */
  headers: { 'content-type': string; 'content-disposition': string };
  expires_at: number;
}

export interface AttachmentUploadView {
  attachment: AttachmentView;
  upload: AttachmentUploadTicketView;
}

export interface AttachmentListView {
  data: AttachmentView[];
}

/** `GET /org`'s `attachments`, or `null` when they are off. */
export interface OrgAttachmentsView {
  max_bytes: number;
}

type AttachmentRow = typeof attachments.$inferSelect;

/** The path markdown embeds. */
export function attachmentContentPath(id: string): string {
  return `/api/v1/attachments/${id}/content`;
}

function toView(row: AttachmentRow): AttachmentView {
  return {
    id: row.id,
    project_id: row.projectId,
    task_id: row.taskId,
    comment_id: row.commentId,
    filename: row.filename,
    content_type: row.contentType,
    size_bytes: row.sizeBytes,
    inline: row.inline === 1,
    uploaded_by: row.uploadedBy,
    created_at: row.createdAt,
    ready_at: row.readyAt,
    url: attachmentContentPath(row.id),
  };
}

/** What `GET /org` says: the largest file, or `null` when attachments are off. */
export function orgAttachmentsView(config: AttachmentsEnv | null): OrgAttachmentsView | null {
  return config === null ? null : { max_bytes: config.maxBytes };
}

function off(): ApiError {
  return new ApiError('unavailable', 'Attachments are not set up on this board', {
    reason: 'attachments_off',
  });
}

/** The settings, or `503 attachments_off`. Asked first: it reads nothing. */
function requireOn(deps: AttachmentsDeps | undefined): AttachmentsEnv {
  const config = deps?.config ?? null;
  if (config === null) throw off();
  return config;
}

function storeFor(deps: AttachmentsDeps | undefined): StoreClient {
  const config = requireOn(deps);
  return storeClient({
    store: config.store,
    fetchImpl: deps?.fetchImpl,
    now: deps?.now,
    timeoutMs: deps?.timeoutMs,
  });
}

function clockOf(deps: AttachmentsDeps | undefined): number {
  return (deps?.now ?? Date.now)();
}

// ------------------------------------------------------------ names and types

/** No `/`, no `\`, no control character: a filename is shown, never a path. */
const BAD_FILENAME = /[/\\\u0000-\u001f\u007f]/;

/** `type/subtype`, the RFC 6838 characters, no parameters. */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;

/** RFC 5987's `attr-char`, so `filename*` needs no quoting. */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * An RFC 6266 `Content-Disposition`: `attachment` or `inline`, an ASCII
 * `filename` for old clients and the real name as UTF-8 `filename*`. Pure
 * ASCII, so a browser can send it as a header.
 */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  // Runs of spaces are one: SigV4 folds them when it signs a header, so a
  // fallback that kept two would be signed as other bytes than it is sent as.
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, '_').replace(/ {2,}/g, ' ');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${rfc5987(filename)}`;
}

/**
 * What the first bytes say a file is, among the five a browser may show
 * (D-150 item 4), or `null`. A declared type is believed only when these
 * agree with it.
 */
export function sniffInlineType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (from: number, text: string) =>
    [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  return null;
}

// ------------------------------------------------------------------- upload

export interface CreateAttachmentInput {
  filename: string;
  content_type: string;
  size_bytes: number;
  task_id?: string | undefined;
}

/**
 * Ask for an upload (`POST /projects/:slug/attachments`): a `pending` row and
 * a presigned `PUT`, ten minutes long, for exactly these bytes. A file over
 * the deployment's largest is `413 payload_too_large` with `max_bytes`, and a
 * `task_id` that is not this project's task is `404`, as a missing one is.
 */
export function createAttachment(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  slug: string,
  input: CreateAttachmentInput,
): AttachmentUploadView {
  const config = requireOn(deps);
  const store = storeFor(deps);
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'attachment.create', { projectId: project.id });

  const filename = input.filename;
  if (filename.length < 1 || filename.length > 255 || BAD_FILENAME.test(filename)) {
    throw new ApiError('unprocessable', 'A filename is 1–255 characters, with no / or \\', {
      field: 'filename',
      reason: 'invalid_filename',
    });
  }
  const contentType = input.content_type.trim().toLowerCase();
  if (!MEDIA_TYPE.test(contentType)) {
    throw new ApiError('unprocessable', 'content_type is a media type, such as image/png', {
      field: 'content_type',
      reason: 'invalid_content_type',
    });
  }
  if (input.size_bytes > config.maxBytes) {
    throw new ApiError('payload_too_large', 'That file is larger than this board takes', {
      max_bytes: config.maxBytes,
    });
  }
  const taskId = input.task_id ?? null;
  if (taskId !== null) {
    const task = db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    // Another project's task answers as a missing one: no task id leaks across.
    if (task?.projectId !== project.id) throw ApiError.notFound(`No task with id "${taskId}"`);
  }

  const now = clockOf(deps);
  const id = newId();
  db.insert(attachments)
    .values({
      id,
      projectId: project.id,
      taskId,
      commentId: null,
      uploadedBy: actor.userId,
      filename,
      contentType,
      sizeBytes: input.size_bytes,
      storageKey: `p/${project.id}/${id}`,
      state: 'pending',
      inline: 0,
      createdAt: now,
    })
    .run();

  const row = db.select().from(attachments).where(eq(attachments.id, id)).get()!;
  const put = store.presignPut(
    row.storageKey,
    {
      contentType,
      contentLength: row.sizeBytes,
      contentDisposition: contentDisposition('attachment', filename),
    },
    now,
  );
  return {
    attachment: toView(row),
    upload: { url: put.url, method: put.method, headers: put.headers, expires_at: put.expiresAt },
  };
}

/** A live row — not removed — or the one `404` for missing and removed alike. */
function requireLive(db: Db, id: string): AttachmentRow {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (row?.deletedAt !== null) throw ApiError.notFound(`No attachment with id "${id}"`);
  return row;
}

/** The task's project's org, for an activity row. */
function orgOf(db: Db, projectId: string): string {
  return db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()!.orgId;
}

function attachmentPayload(row: AttachmentRow) {
  return {
    attachment_id: row.id,
    filename: row.filename,
    content_type: row.contentType,
    size_bytes: row.sizeBytes,
  };
}

/**
 * The upload is done (`POST /attachments/:id/complete`). Only its uploader
 * says so, only of a `pending` one, and only within an hour of asking
 * (`upload_expired`) — `409` otherwise. Laika `HEAD`s the
 * object: missing, or another size than was asked for, is `409` and the row
 * stays `pending` for the sweep. The first sixteen bytes decide `inline`.
 * A file that named its task belongs to it from here: `attachment.added`.
 */
export async function completeAttachment(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  id: string,
): Promise<AttachmentView> {
  const store = storeFor(deps);
  const row = requireLive(db, id);
  assertCan(withProject(actor, row.projectId), 'attachment.create', {
    projectId: row.projectId,
  });
  if (row.uploadedBy !== actor.userId) {
    throw new ApiError('conflict', 'Only the person who uploaded a file completes it', {
      reason: 'not_uploader',
    });
  }
  if (row.state !== 'pending') {
    throw new ApiError('conflict', 'That upload is already complete', { reason: 'not_pending' });
  }
  if (clockOf(deps) - row.createdAt > COMPLETE_WITHIN_MS) {
    throw new ApiError('conflict', 'That upload was asked for too long ago — attach it again', {
      reason: 'upload_expired',
    });
  }

  const found = await store.head(row.storageKey);
  if (found === null) {
    throw new ApiError('conflict', 'The file has not reached the store', {
      reason: 'upload_missing',
    });
  }
  if (found.size !== row.sizeBytes) {
    throw new ApiError('conflict', 'The stored file is not the size that was asked for', {
      reason: 'size_mismatch',
      expected: row.sizeBytes,
      found: found.size,
    });
  }
  const head = await store.readRange(row.storageKey, 0, SNIFF_BYTES - 1);
  const inline = sniffInlineType(head) === row.contentType;

  const now = clockOf(deps);
  db.transaction((tx) => {
    const done = tx
      .update(attachments)
      .set({ state: 'ready', inline: inline ? 1 : 0, readyAt: now })
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.state, 'pending'),
          isNull(attachments.deletedAt),
        ),
      )
      .run();
    // Another complete, or a removal, landed while the store was asked.
    if (done.changes === 0) {
      throw new ApiError('conflict', 'That upload is already complete', { reason: 'not_pending' });
    }
    if (row.taskId !== null) {
      appendActivity(tx as unknown as Db, {
        orgId: orgOf(tx as unknown as Db, row.projectId),
        projectId: row.projectId,
        taskId: row.taskId,
        ...activityActor(actor),
        type: 'attachment.added',
        payload: attachmentPayload(row),
        now,
      });
    }
  });

  return toView(db.select().from(attachments).where(eq(attachments.id, id)).get()!);
}

// --------------------------------------------------------------------- read

/**
 * Where a ready file's bytes are (`GET /attachments/:id/content`): a
 * presigned `GET`, five minutes long, with the type and disposition the
 * store must answer with — the declared type and `inline` only for an
 * `inline` file, `application/octet-stream` and `attachment` for anything
 * else. Pending, removed, or in a project the caller cannot read, is the
 * same `404`.
 */
export function attachmentContentUrl(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  id: string,
): string {
  const store = storeFor(deps);
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  const missing = ApiError.notFound(`No attachment with id "${id}"`);
  if (row?.state !== 'ready' || row.deletedAt !== null) throw missing;
  if (!can(withProject(actor, row.projectId), 'project.read', { projectId: row.projectId })) {
    throw missing;
  }

  const inline = row.inline === 1;
  return store.presignGet(
    row.storageKey,
    {
      contentType: inline ? row.contentType : 'application/octet-stream',
      contentDisposition: contentDisposition(inline ? 'inline' : 'attachment', row.filename),
    },
    clockOf(deps),
  ).url;
}

/** A task's files (`GET /tasks/:id/attachments`): ready, not removed, oldest first. */
export function listTaskAttachments(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  taskId: string,
): AttachmentListView {
  requireOn(deps);
  const task = db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);
  assertCan(withProject(actor, task.projectId), 'project.read', { projectId: task.projectId });

  const rows = db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.taskId, taskId),
        eq(attachments.state, 'ready'),
        isNull(attachments.deletedAt),
      ),
    )
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .all();
  return { data: rows.map(toView) };
}

// ------------------------------------------------------------------- remove

/**
 * Remove a file (`DELETE /attachments/:id`): a lead any, a member one they
 * uploaded (`attachment.delete`, `ownerId` the uploader). The row is stamped
 * removed at once; the object is deleted after, **best effort** — a store
 * that is down leaves `purged_at` null, and the sweep tries again until it
 * is set. A file that belonged to a task writes `attachment.removed`.
 */
export async function deleteAttachment(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  id: string,
): Promise<void> {
  const store = storeFor(deps);
  const row = requireLive(db, id);
  assertCan(withProject(actor, row.projectId), 'attachment.delete', {
    projectId: row.projectId,
    ownerId: row.uploadedBy,
  });

  const now = clockOf(deps);
  db.transaction((tx) => {
    const removed = tx
      .update(attachments)
      .set({ deletedAt: now, deletedBy: actor.userId })
      .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)))
      .run();
    if (removed.changes === 0) throw ApiError.notFound(`No attachment with id "${id}"`);
    // Only a file that was added to the task is removed from it: a pending
    // upload that named a task never wrote `attachment.added`.
    if (row.taskId !== null && row.state === 'ready') {
      appendActivity(tx as unknown as Db, {
        orgId: orgOf(tx as unknown as Db, row.projectId),
        projectId: row.projectId,
        taskId: row.taskId,
        ...activityActor(actor),
        type: 'attachment.removed',
        payload: attachmentPayload(row),
        now,
      });
    }
  });

  try {
    await store.remove(row.storageKey);
    db.update(attachments).set({ purgedAt: now }).where(eq(attachments.id, id)).run();
  } catch {
    // The sweep retries it: `deleted_at` set and `purged_at` null.
  }
}

// ------------------------------------------------------------------ linking

/**
 * `/api/v1/attachments/<ULID>/content`, relative or absolute.
 *
 * **Any origin, not only this board's** (a deviation LAI-1300 records): one
 * deployment can be reached at more than one — Ksage serves its SPA and API on
 * one domain, ksage.kvelld.com, but a domain move leaves the old address live
 * beside the new — and the origin decides nothing here. The id does, and the
 * project, the state and *never relinks* below are what make it safe. The
 * character before the path must not be one a longer path or a host could
 * end with, so `/x/api/v1/…` is not a reference.
 */
const ATTACHMENT_REF =
  /(?<![\w.~/-])(?:https?:\/\/[^\s/"'()<>[\]]+)?\/api\/v1\/attachments\/([0-9A-HJKMNP-TV-Z]{26})\/content(?![\w/-])/g;

/** The most references one text is read for. */
const MAX_REFS = 500;

/** Every attachment id a text embeds, in order, once each. */
export function parseAttachmentRefs(md: string | null | undefined): string[] {
  if (md === null || md === undefined || md === '') return [];
  const seen = new Set<string>();
  for (const match of md.matchAll(ATTACHMENT_REF)) {
    seen.add(match[1]!);
    if (seen.size >= MAX_REFS) break;
  }
  return [...seen];
}

export interface AttachmentLinkContext {
  /** Who saved the text — the actor of any `attachment.added` it writes. */
  actor: ServiceCaller;
  projectId: string;
  taskId: string;
  /** The comment the text is, when it is one. */
  commentId?: string | null;
}

/**
 * Link the files a task's or a comment's text embeds (D-150 item 6), on every
 * save — the shape of `syncMentions`. Only a file of **the same project**,
 * `ready` and not removed, **and only one no task has yet**: its `task_id` is
 * filled — the file now belongs to the task, `attachment.added` — and, when
 * the text is a comment, its `comment_id` with it. A comment therefore owns
 * only the files **it was first to link**: a file that reached the task by
 * its upload naming the task, or by the task's own text, is never the
 * comment's, so deleting the comment cannot take it (LAI-1300 review).
 * **A file is never relinked**: one already on another task is left as it
 * is. Returns the ids it changed.
 *
 * Call it inside the write that saved the text, so a rolled-back save links
 * nothing.
 */
export function linkAttachmentRefs(
  db: Db,
  context: AttachmentLinkContext,
  md: string | null | undefined,
  now: number,
): string[] {
  const ids = parseAttachmentRefs(md);
  if (ids.length === 0) return [];

  const rows = db
    .select()
    .from(attachments)
    .where(
      and(
        inArray(attachments.id, ids),
        eq(attachments.projectId, context.projectId),
        eq(attachments.state, 'ready'),
        isNull(attachments.deletedAt),
      ),
    )
    .all();

  const commentId = context.commentId ?? null;
  const changed: string[] = [];
  let orgId: string | null = null;
  for (const row of rows) {
    // Only a file no task has yet: one this task already has was linked by
    // something else first, and one another task has is never relinked.
    if (row.taskId !== null) continue;
    const fillComment = commentId !== null && row.commentId === null;

    db.update(attachments)
      .set({ taskId: context.taskId, ...(fillComment ? { commentId } : {}) })
      .where(eq(attachments.id, row.id))
      .run();
    changed.push(row.id);

    orgId ??= orgOf(db, context.projectId);
    appendActivity(db, {
      orgId,
      projectId: context.projectId,
      taskId: context.taskId,
      ...activityActor(context.actor),
      type: 'attachment.added',
      payload: attachmentPayload(row),
      now,
    });
  }
  return changed;
}

/**
 * A deleted comment's files go with it (D-150 item 6) — **the files it first
 * linked and the deleter may remove**: `comment_id` names only those
 * (`linkAttachmentRefs`), and each is asked of `can()` as
 * `DELETE /attachments/:id` asks it, `attachment.delete` with the uploader as
 * `ownerId` — so a member deleting their own comment never takes a file
 * somebody else uploaded (LAI-1300 review). One the task's description or
 * acceptance, or another live comment on the task, still embeds stays too.
 * Each is stamped removed by whoever deleted the comment, with
 * `attachment.removed`; §11.6's sweep deletes the objects, since this runs
 * inside the comment's own write.
 */
export function removeCommentAttachments(
  db: Db,
  actor: ResolvedActor,
  context: { projectId: string; taskId: string; commentId: string },
  now: number,
): string[] {
  const rows = db
    .select()
    .from(attachments)
    .where(and(eq(attachments.commentId, context.commentId), isNull(attachments.deletedAt)))
    .all();
  if (rows.length === 0) return [];

  const task = db
    .select({ descriptionMd: tasks.descriptionMd, acceptanceMd: tasks.acceptanceMd })
    .from(tasks)
    .where(eq(tasks.id, context.taskId))
    .get();
  const others = db
    .select({ bodyMd: comments.bodyMd })
    .from(comments)
    .where(
      and(
        eq(comments.taskId, context.taskId),
        ne(comments.id, context.commentId),
        isNull(comments.deletedAt),
      ),
    )
    .all();
  const stillEmbedded = new Set(
    [task?.descriptionMd, task?.acceptanceMd, ...others.map((c) => c.bodyMd)].flatMap((md) =>
      parseAttachmentRefs(md),
    ),
  );

  const removed: string[] = [];
  const orgId = orgOf(db, context.projectId);
  const scoped = withProject(actor, context.projectId);
  for (const row of rows) {
    if (stillEmbedded.has(row.id)) continue;
    if (
      !can(scoped, 'attachment.delete', { projectId: context.projectId, ownerId: row.uploadedBy })
    ) {
      continue;
    }
    db.update(attachments)
      .set({ deletedAt: now, deletedBy: actor.userId })
      .where(eq(attachments.id, row.id))
      .run();
    removed.push(row.id);
    if (row.taskId !== null) {
      appendActivity(db, {
        orgId,
        projectId: row.projectId,
        taskId: row.taskId,
        ...activityActor(actor),
        type: 'attachment.removed',
        payload: attachmentPayload(row),
        now,
      });
    }
  }
  return removed;
}

// -------------------------------------------------------------------- sweep

const SYSTEM = systemPrincipal();

/** The run going now, per database, so a tick joins it rather than starting a second. */
const pruning = new WeakMap<Db, Promise<{ changed: number }>>();

/**
 * §11.6's hourly sweep (`attachment.prune`), as the system principal:
 *
 * 1. a `pending` row older than 24 hours — an upload nobody finished — has
 *    its object deleted, if there is one, and then the row;
 * 2. a `ready` file no task took in the 24 hours since it became ready is
 *    stamped removed;
 * 3. a removed file whose object is still stored has it deleted, and
 *    `purged_at` set — which is how a removal the store missed is retried.
 *
 * **It never touches a ready, linked, live file**, and writes no activity:
 * nobody did it. **The first store failure ends the store's part of the run**
 * — a hung store costs one timeout, not one per row — and the rows wait for
 * the next. **A run never overlaps another**: a tick while one is still going
 * joins it, as the HR sync does. Off, it does nothing.
 */
export function pruneAttachments(
  db: Db,
  deps: AttachmentsDeps | undefined,
  now: number,
): Promise<{ changed: number }> {
  const running = pruning.get(db);
  if (running !== undefined) return running;
  const run = sweep(db, deps, now).finally(() => {
    pruning.delete(db);
  });
  pruning.set(db, run);
  return run;
}

/** One run of {@link pruneAttachments}, which keeps two from overlapping. */
async function sweep(
  db: Db,
  deps: AttachmentsDeps | undefined,
  now: number,
): Promise<{ changed: number }> {
  assertCan(SYSTEM, 'system.attachment.prune');
  if ((deps?.config ?? null) === null) return { changed: 0 };
  const store = storeFor(deps);
  const cutoff = now - ATTACHMENT_GRACE_MS;
  let changed = 0;
  let storeDown = false;

  /** Delete one object; false, and the store's part of the run over, when it cannot. */
  const removeObject = async (key: string): Promise<boolean> => {
    try {
      await store.remove(key);
      return true;
    } catch (err) {
      if (!(err instanceof StoreUnavailableError)) throw err;
      storeDown = true;
      return false;
    }
  };

  const abandoned = db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(and(eq(attachments.state, 'pending'), lt(attachments.createdAt, cutoff)))
    .limit(SWEEP_BATCH)
    .all();
  for (const row of abandoned) {
    if (!(await removeObject(row.storageKey))) break;
    db.delete(attachments)
      .where(and(eq(attachments.id, row.id), eq(attachments.state, 'pending')))
      .run();
    changed += 1;
  }

  const unlinked = db
    .update(attachments)
    .set({ deletedAt: now, deletedBy: null })
    .where(
      and(
        eq(attachments.state, 'ready'),
        isNull(attachments.taskId),
        isNull(attachments.deletedAt),
        lt(attachments.readyAt, cutoff),
      ),
    )
    .run();
  changed += unlinked.changes;
  // The store said no once already: nothing more is asked of it this run.
  if (storeDown) return { changed };

  const removed = db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(and(isNotNull(attachments.deletedAt), isNull(attachments.purgedAt)))
    .limit(SWEEP_BATCH)
    .all();
  for (const row of removed) {
    if (!(await removeObject(row.storageKey))) break;
    db.update(attachments).set({ purgedAt: now }).where(eq(attachments.id, row.id)).run();
    changed += 1;
  }

  return { changed };
}
