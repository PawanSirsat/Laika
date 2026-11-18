import { eq } from 'drizzle-orm';
import { activityActor, type ResolvedActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { PROJECT_ICON_TYPES, type ProjectIconType } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { projects } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import {
  type AttachmentsDeps,
  type AttachmentUploadTicketView,
  clockOf,
  contentDisposition,
  requireOn,
  sniffInlineType,
  storeFor,
} from './attachments.ts';
import { requireReadableProjectBySlug } from './projects.ts';

/**
 * A space's icon (D-152, LAI-1311): an **image** in the operator's store, or
 * an **emoji**, and otherwise the space's first letter on its colour, which
 * the client draws and nothing here stores.
 *
 * ## One icon at a time
 *
 * A space holds an image or an emoji, never both: setting either clears the
 * other, and an image that is replaced or cleared has its object deleted
 * from the store. `projectIconView` still ranks an image over an emoji, so a
 * row that somehow held both would show the image.
 *
 * ## The image reuses the attachments store, not a second client
 *
 * Asking (`askProjectIcon`) returns a presigned `PUT` for a new key,
 * `p/<project_id>/icon/<upload_id>`, signed for exactly the declared type and
 * length, through `services/s3-client.ts` as attachments do. Completing
 * (`completeProjectIcon`) `HEAD`s the object and reads its first bytes: a
 * png, jpeg or webp whose bytes agree with its declared type, at most
 * {@link PROJECT_ICON_MAX_BYTES}. **Never SVG**: an SVG can carry script, and
 * nothing here could prove one harmless.
 *
 * Nothing is stored between asking and completing: the upload id names the
 * key, under this space's own prefix, and completing proves the object is
 * there. **An image put and never completed is normal** since LAI-1321: Space
 * settings stages a cropped image when *Use this* is pressed and completes it
 * only on Save, so one that is discarded, replaced before Save, or left when
 * the page closes stays in the store — at most a megabyte, and only an owner
 * or admin can make one — until the sweep of leftover images (LAI-1324)
 * removes it.
 *
 * ## Read through Laika, not redirected
 *
 * `GET /projects/:slug/icon` answers the image's bytes itself
 * (`readProjectIcon`), so `img-src 'self'` covers it and a page drawing
 * thirty marks makes thirty requests that a cache keeps, not thirty
 * redirects to presigned URLs that change every time. The URL carries
 * `?v=<icon_updated_at>`, which is what lets the answer be cached for a year.
 *
 * ## Off without a store
 *
 * A deployment with no `LAIKA_S3_*` (the AWS board) answers asking,
 * completing and reading an image `503 unavailable` with
 * `details.reason: 'attachments_off'`; removing still clears the icon, and
 * emoji and letter work everywhere.
 */

/** The largest icon image (D-152). An icon is drawn at most a few dozen pixels across. */
export const PROJECT_ICON_MAX_BYTES = 1024 * 1024;

/** How long a browser may keep an icon whose URL names its current version. */
export const ICON_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** For a URL that does not name the current version: always asked again. */
export const ICON_STALE_CACHE_CONTROL = 'private, no-cache';

/** The bytes read to prove a type — attachments' sixteen. */
const SNIFF_BYTES = 16;

/** A ULID, as `newId` makes them. */
const UPLOAD_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Where and how the browser uploads an icon: valid ten minutes. */
export interface ProjectIconUploadView {
  /** What `POST /projects/:slug/icon/complete` names. */
  upload_id: string;
  /** An attachment's ticket, exactly: the same store, signed the same way. */
  upload: AttachmentUploadTicketView;
  /** The largest icon this board takes. */
  max_bytes: number;
}

type ProjectRow = typeof projects.$inferSelect;

// ------------------------------------------------------------------- image

/** A space the caller may read and whose icon they may change, or the refusal. */
function requireIconWritable(db: Db, actor: ResolvedActor, slug: string): ProjectRow {
  const row = requireReadableProjectBySlug(db, actor, slug);
  assertCan(actor, 'project.icon.write');
  return row;
}

function iconKeyFor(projectId: string, uploadId: string): string {
  return `p/${projectId}/icon/${uploadId}`;
}

function isIconType(value: string): value is ProjectIconType {
  return (PROJECT_ICON_TYPES as readonly string[]).includes(value);
}

/** The largest icon this deployment takes: a megabyte, or less if its attachments are smaller. */
function maxIconBytes(deps: AttachmentsDeps | undefined): number {
  return Math.min(PROJECT_ICON_MAX_BYTES, requireOn(deps).maxBytes);
}

export interface AskProjectIconInput {
  content_type: string;
  size_bytes: number;
}

/**
 * Ask to upload an icon image (`POST /projects/:slug/icon`): a presigned
 * `PUT`, ten minutes long, for exactly this type and length. png, jpeg or
 * webp (`422 unsupported_type` otherwise, SVG included); over the largest is
 * `413 payload_too_large` with `max_bytes`. Nothing is written yet.
 */
export function askProjectIcon(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  slug: string,
  input: AskProjectIconInput,
): ProjectIconUploadView {
  const store = storeFor(deps);
  const max = maxIconBytes(deps);
  const row = requireIconWritable(db, actor, slug);

  const contentType = input.content_type.trim().toLowerCase();
  if (!isIconType(contentType)) {
    throw new ApiError('unprocessable', 'An icon is a PNG, JPEG or WebP image', {
      field: 'content_type',
      reason: 'unsupported_type',
      allowed: PROJECT_ICON_TYPES,
    });
  }
  if (input.size_bytes > max) {
    throw new ApiError('payload_too_large', 'An icon is at most 1 MB', { max_bytes: max });
  }

  const now = clockOf(deps);
  const uploadId = newId();
  const put = store.presignPut(
    iconKeyFor(row.id, uploadId),
    {
      contentType,
      contentLength: input.size_bytes,
      contentDisposition: contentDisposition('inline', `icon.${contentType.slice(6)}`),
    },
    now,
  );
  return {
    upload_id: uploadId,
    upload: { url: put.url, method: put.method, headers: put.headers, expires_at: put.expiresAt },
    max_bytes: max,
  };
}

export interface CompleteProjectIconInput {
  upload_id: string;
  content_type: string;
  size_bytes: number;
}

/**
 * The image is uploaded (`POST /projects/:slug/icon/complete`). The object
 * must be there (`409 upload_missing`), the size that was asked for
 * (`409 size_mismatch`), and its first bytes must prove the declared type
 * (`422 type_mismatch`). Then it is the space's icon: any emoji is cleared,
 * the image it replaces is deleted from the store, and `project.updated` is
 * written. Completing the upload that already is the icon changes nothing
 * and checks nothing, so it can never delete the live object.
 */
export async function completeProjectIcon(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  slug: string,
  input: CompleteProjectIconInput,
): Promise<ProjectRow> {
  const store = storeFor(deps);
  const max = maxIconBytes(deps);
  const row = requireIconWritable(db, actor, slug);

  if (!UPLOAD_ID.test(input.upload_id)) {
    throw ApiError.notFound(`No icon upload with id "${input.upload_id}"`);
  }
  const contentType = input.content_type.trim().toLowerCase();
  if (!isIconType(contentType)) {
    throw new ApiError('unprocessable', 'An icon is a PNG, JPEG or WebP image', {
      field: 'content_type',
      reason: 'unsupported_type',
      allowed: PROJECT_ICON_TYPES,
    });
  }

  const key = iconKeyFor(row.id, input.upload_id);
  // The icon already is this upload: nothing to check, and above all nothing
  // to delete — a wrong type below would remove the object the row points at.
  if (key === row.iconKey) return row;
  const found = await store.head(key);
  if (found === null) {
    throw new ApiError('conflict', 'The image has not reached the store', {
      reason: 'upload_missing',
    });
  }
  if (found.size !== input.size_bytes || found.size > max) {
    throw new ApiError('conflict', 'The stored image is not the size that was asked for', {
      reason: 'size_mismatch',
      expected: input.size_bytes,
      found: found.size,
    });
  }
  const head = await store.readRange(key, 0, SNIFF_BYTES - 1);
  if (sniffInlineType(head) !== contentType) {
    // Not ours to keep: the store is left as it was before the ask.
    await store.remove(key).catch(() => undefined);
    throw new ApiError('unprocessable', 'That file is not the image type it says it is', {
      field: 'content_type',
      reason: 'type_mismatch',
    });
  }

  const now = clockOf(deps);
  const previous = db
    .select({ iconKey: projects.iconKey })
    .from(projects)
    .where(eq(projects.id, row.id))
    .get()?.iconKey;
  db.transaction((tx) => {
    tx.update(projects)
      .set({
        iconKey: key,
        iconType: contentType,
        iconEmoji: null,
        iconUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(projects.id, row.id))
      .run();
    appendActivity(tx as unknown as Db, {
      orgId: row.orgId,
      projectId: row.id,
      ...activityActor(actor),
      type: 'project.updated',
      payload: { changed: ['icon'] },
      now,
    });
  });

  if (previous !== null && previous !== undefined && previous !== key) {
    await discardIconObject(deps, previous);
  }
  return db.select().from(projects).where(eq(projects.id, row.id)).get()!;
}

/**
 * Take the icon away (`DELETE /projects/:slug/icon`): the image and the emoji
 * alike, so the space shows its letter. The image's object is deleted after,
 * best effort. A space with no icon is left as it is, and nothing is written.
 */
export async function removeProjectIcon(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  slug: string,
): Promise<ProjectRow> {
  const row = requireIconWritable(db, actor, slug);
  if (row.iconKey === null && row.iconEmoji === null) return row;

  const now = clockOf(deps);
  db.transaction((tx) => {
    tx.update(projects)
      .set({ iconKey: null, iconType: null, iconEmoji: null, iconUpdatedAt: now, updatedAt: now })
      .where(eq(projects.id, row.id))
      .run();
    appendActivity(tx as unknown as Db, {
      orgId: row.orgId,
      projectId: row.id,
      ...activityActor(actor),
      type: 'project.updated',
      payload: { changed: ['icon'] },
      now,
    });
  });

  if (row.iconKey !== null) await discardIconObject(deps, row.iconKey);
  return db.select().from(projects).where(eq(projects.id, row.id)).get()!;
}

/**
 * Delete an icon image nothing names any more, best effort: a store that is
 * down, or switched off since, leaves the object behind rather than failing a
 * change that is already made.
 */
export async function discardIconObject(
  deps: AttachmentsDeps | undefined,
  key: string,
): Promise<void> {
  if ((deps?.config ?? null) === null) return;
  try {
    await storeFor(deps).remove(key);
  } catch {
    // Left in the store; the change it belonged to stands.
  }
}

export interface ProjectIconBytes {
  body: Uint8Array;
  contentType: ProjectIconType;
  /** Whether the URL asked for named the icon's current version. */
  current: boolean;
}

/**
 * An icon image's bytes (`GET /projects/:slug/icon`), read from the store
 * and answered by Laika. A space the caller cannot read, one with no image,
 * and one whose object the store no longer has are the same `404`.
 */
export async function readProjectIcon(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  slug: string,
  version: string | undefined,
): Promise<ProjectIconBytes> {
  const store = storeFor(deps);
  const row = requireReadableProjectBySlug(db, actor, slug);
  if (row.iconKey === null || row.iconType === null) {
    throw ApiError.notFound(`Space "${slug}" has no icon image`);
  }
  // `HEAD` first: a ranged `GET` of a missing object is the store failing to
  // answer to `readRange`, a 503, where a missing image is this route's 404.
  if ((await store.head(row.iconKey)) === null) {
    throw ApiError.notFound(`Space "${slug}" has no icon image`);
  }
  const body = await store.readRange(row.iconKey, 0, PROJECT_ICON_MAX_BYTES - 1);
  return {
    body,
    contentType: row.iconType,
    current: version === String(row.iconUpdatedAt ?? ''),
  };
}
