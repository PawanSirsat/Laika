import { eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type UserPhotoType } from '../db/enums.ts';
import { userDirectory } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can } from '../policy/can.ts';
import { type AttachmentsDeps, storeFor } from './attachments.ts';
import { PHOTO_MAX_BYTES } from './people-sync.ts';

/**
 * What Microsoft's directory says of people, as Laika serves it (D-161,
 * LAI-1330): one read of everyone's job title, department, manager and photo
 * version for the client's look-store, and each photo's bytes.
 *
 * **Who may read is who may see the people**: `member_list.read`, every role
 * (§3.1) — never wider. The photo is answered by Laika from the operator's
 * store, as a space icon is (D-152), so `img-src 'self'` covers it and no
 * view of anyone reaches Microsoft or the store's own origin.
 */

/** How long a browser may keep a photo whose URL names its current version — an icon's year. */
export const PHOTO_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** For a URL that does not name the current version: always asked again. */
export const PHOTO_STALE_CACHE_CONTROL = 'private, no-cache';

/** One person's entry. */
export interface PersonDirectoryView {
  /**
   * `?v=` for `GET /users/:id/photo`: the stored photo's version, or null when
   * there is none to ask for — no photo, or no store to read it from.
   */
  photo_v: number | null;
  job_title: string | null;
  department: string | null;
  /** Their manager's Laika user id, when the directory names one who is a user. */
  manager_id: string | null;
}

/** `GET /api/v1/people/directory`: every synced person, by user id. */
export interface PeopleDirectoryView {
  people: Record<string, PersonDirectoryView>;
}

/** `GET /api/v1/people/directory`. */
export function getPeopleDirectory(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
): PeopleDirectoryView {
  assertCan(actor, 'member_list.read');
  const stored = (deps?.config ?? null) !== null;
  const people: Record<string, PersonDirectoryView> = {};
  for (const row of db.select().from(userDirectory).all()) {
    people[row.userId] = {
      photo_v: stored && row.photoKey !== null ? row.photoUpdatedAt : null,
      job_title: row.jobTitle,
      department: row.department,
      manager_id: row.managerUserId,
    };
  }
  return { people };
}

export interface UserPhotoBytes {
  body: Uint8Array;
  contentType: UserPhotoType;
  /** Whether the URL asked for named the photo's current version. */
  current: boolean;
}

/**
 * A person's photo (`GET /users/:id/photo`), read from the store and answered
 * by Laika. A caller who may not see people, a person with no photo, no
 * store, and an object the store no longer has are **the same `404`**: the
 * answer says nothing about who exists to someone who may not see them.
 */
export async function readUserPhoto(
  db: Db,
  actor: ResolvedActor,
  deps: AttachmentsDeps | undefined,
  userId: string,
  version: string | undefined,
): Promise<UserPhotoBytes> {
  const missing = () => ApiError.notFound('No photo for that person');
  if (!can(actor, 'member_list.read')) throw missing();
  if ((deps?.config ?? null) === null) throw missing();
  const row = db.select().from(userDirectory).where(eq(userDirectory.userId, userId)).get();
  if (row?.photoKey == null || row.photoType === null) throw missing();
  const store = storeFor(deps);
  // `HEAD` first: a ranged `GET` of a missing object is the store failing to
  // answer, a 503, where a missing photo is this route's 404.
  if ((await store.head(row.photoKey)) === null) throw missing();
  const body = await store.readRange(row.photoKey, 0, PHOTO_MAX_BYTES - 1);
  return {
    body,
    contentType: row.photoType,
    current: version === String(row.photoUpdatedAt ?? ''),
  };
}
