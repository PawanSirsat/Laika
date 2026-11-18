import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { userDirectory, users } from '../../src/db/schema.ts';
import { getPeopleDirectory, readUserPhoto } from '../../src/services/people-directory.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import { fakeAttachments, fakeS3, type FakeS3 } from '../helpers/fake-s3.ts';

/**
 * What the directory serves (D-161, LAI-1330): everyone's entry to whoever
 * may see people, and a photo's bytes — the same `404` for no photo, no
 * store, an object gone and a caller who may not see people.
 */

const NOW = Date.UTC(2026, 10, 18, 12);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let s3: FakeS3;
let ada: string;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW - 60_000);
  owner = loadActor(t.db, s.userId)!;
  s3 = fakeS3();
  ada = newId();
  t.db
    .insert(users)
    .values({
      id: ada,
      email: 'ada@example.test',
      name: 'Ada',
      orgRole: 'viewer',
      isActive: 1,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  t.db
    .insert(userDirectory)
    .values({
      userId: s.userId,
      entraOid: 'oid-owner',
      jobTitle: 'Director',
      department: 'Leadership',
      managerUserId: null,
      accountEnabled: 1,
      seenAt: NOW,
      photoKey: `u/${s.userId}/photo/one`,
      photoType: 'image/jpeg',
      photoEtag: '"W/1"',
      photoUpdatedAt: NOW,
      updatedAt: NOW,
    })
    .run();
  t.db
    .insert(userDirectory)
    .values({
      userId: ada,
      jobTitle: 'Engineer',
      managerUserId: s.userId,
      seenAt: NOW,
      updatedAt: NOW,
    })
    .run();
  s3.objects.set(`u/${s.userId}/photo/one`, {
    body: JPEG,
    contentType: 'image/jpeg',
    contentDisposition: 'inline',
  });
});
afterEach(() => {
  t.close();
});

function storeDeps() {
  return { config: fakeAttachments(), fetchImpl: s3.fetchImpl, now: () => NOW };
}

describe('the directory', () => {
  it('is everyone synced, by user id, for every role that may see people', () => {
    const viewer = loadActor(t.db, ada)!;
    expect(getPeopleDirectory(t.db, viewer, storeDeps())).toEqual({
      people: {
        [s.userId]: {
          photo_v: NOW,
          job_title: 'Director',
          department: 'Leadership',
          manager_id: null,
          manager_name: null,
        },
        [ada]: {
          photo_v: null,
          job_title: 'Engineer',
          department: null,
          manager_id: s.userId,
          manager_name: 'Owner',
        },
      },
    });
  });

  it('names no photo version with no store, so nobody is sent to a 404', () => {
    expect(getPeopleDirectory(t.db, owner, { config: null }).people[s.userId]?.photo_v).toBeNull();
  });
});

describe('a photo', () => {
  it('is the stored bytes and type, current when the version asked for is the latest', async () => {
    const viewer = loadActor(t.db, ada)!;
    const photo = await readUserPhoto(t.db, viewer, storeDeps(), s.userId, String(NOW));
    expect(photo).toEqual({ body: JPEG, contentType: 'image/jpeg', current: true });
    expect((await readUserPhoto(t.db, viewer, storeDeps(), s.userId, '1')).current).toBe(false);
    expect((await readUserPhoto(t.db, viewer, storeDeps(), s.userId, undefined)).current).toBe(
      false,
    );
  });

  it('is 404 for someone with no photo, with no store, and for an object the store lost', async () => {
    await expect(readUserPhoto(t.db, owner, storeDeps(), ada, undefined)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      readUserPhoto(t.db, owner, { config: null }, s.userId, undefined),
    ).rejects.toMatchObject({ code: 'not_found' });
    s3.objects.clear();
    await expect(
      readUserPhoto(t.db, owner, storeDeps(), s.userId, undefined),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is the same 404 — not a 403 — to a caller who may not see people', async () => {
    const viewer = loadActor(t.db, ada)!;
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, ada)).run();
    // The actor as a request would carry it after the deactivation.
    const gone = { ...viewer, isActive: false };
    await expect(
      readUserPhoto(t.db, gone, storeDeps(), s.userId, String(NOW)),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(s3.of('GET')).toHaveLength(0);
  });
});
