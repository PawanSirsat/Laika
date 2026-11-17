import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { activity, projects } from '../../src/db/schema.ts';
import {
  discardIconObject,
  readProjectIcon,
  removeProjectIcon,
} from '../../src/services/project-icons.ts';
import {
  parseIconEmoji,
  projectIconPath,
  projectIconView,
  updateProject,
} from '../../src/services/projects.ts';
import { fakeAttachments, fakeS3, type FakeS3 } from '../helpers/fake-s3.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `services/project-icons.ts` and the icon half of `services/projects.ts`
 * (D-152, LAI-1311), below the routes: the view's order, the emoji rule, the
 * version a read is cached by, and the best-effort deletes that must never
 * fail a change already made. The round trip through HTTP is
 * `test/http/routes/project-icons.test.ts`.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

describe('projectIconView', () => {
  const row = { slug: 'laika', iconKey: null, iconEmoji: null, iconUpdatedAt: null };

  it('is the image, else the emoji, else null', () => {
    expect(projectIconView(row)).toBeNull();
    expect(projectIconView({ ...row, iconEmoji: '🚀', iconUpdatedAt: 5 })).toEqual({ emoji: '🚀' });
    expect(
      projectIconView({ ...row, iconKey: 'p/x/icon/y', iconEmoji: '🚀', iconUpdatedAt: 7 }),
    ).toEqual({ url: projectIconPath('laika', 7), updated_at: 7 });
    expect(projectIconPath('laika', 7)).toBe('/api/v1/projects/laika/icon?v=7');
  });
});

describe('parseIconEmoji', () => {
  it('takes exactly one emoji, trimmed', () => {
    expect(parseIconEmoji(' 🚀 ')).toBe('🚀');
    expect(parseIconEmoji('🏳️‍🌈')).toBe('🏳️‍🌈');
  });

  it('refuses words, a bare digit, two emoji and anything past 32 code points', () => {
    for (const bad of ['a', '42', '🚀🚀', '🚀 x', '\u200d', '👍🏽'.repeat(17)]) {
      let refused: unknown;
      try {
        parseIconEmoji(bad);
      } catch (err) {
        refused = err;
      }
      expect(refused, JSON.stringify(bad)).toMatchObject({
        code: 'unprocessable',
        details: { field: 'icon_emoji', reason: 'invalid_icon_emoji' },
      });
    }
  });
});

describe('the image, below the routes', () => {
  let t: TestDb;
  let s: Seed;
  let owner: ResolvedActor;
  let fake: FakeS3;

  beforeEach(() => {
    t = freshDb();
    s = seed(t.db);
    owner = loadActor(t.db, s.userId)!;
    fake = fakeS3();
  });
  afterEach(() => {
    t.close();
  });

  const deps = () => ({ config: fakeAttachments(), fetchImpl: fake.fetchImpl });

  /** An image already in the store, as `completeProjectIcon` leaves one. */
  function stored(key = `p/${s.projectId}/icon/01M7NB3PN15NBHEPSNB8VPBTZJ`, at = 1000): string {
    fake.objects.set(key, { body: PNG, contentType: 'image/png', contentDisposition: 'inline' });
    t.db
      .update(projects)
      .set({ iconKey: key, iconType: 'image/png', iconEmoji: null, iconUpdatedAt: at })
      .where(eq(projects.id, s.projectId))
      .run();
    return key;
  }

  it('reads the bytes, and says whether the URL named the current version', async () => {
    stored(undefined, 1234);
    const current = await readProjectIcon(t.db, owner, deps(), 'laika', '1234');
    expect(current.body).toEqual(PNG);
    expect(current.contentType).toBe('image/png');
    expect(current.current).toBe(true);
    expect((await readProjectIcon(t.db, owner, deps(), 'laika', '999')).current).toBe(false);
    expect((await readProjectIcon(t.db, owner, deps(), 'laika', undefined)).current).toBe(false);
  });

  it('an emoji set over an image drops it, and names the key for the caller to delete', () => {
    const key = stored();
    const view = updateProject(t.db, owner, 'laika', { icon_emoji: '🌱', now: 2000 });
    expect(view.icon).toEqual({ emoji: '🌱' });
    const row = t.db.select().from(projects).where(eq(projects.id, s.projectId)).get()!;
    expect([row.iconKey, row.iconType, row.iconUpdatedAt]).toEqual([null, null, 2000]);
    // The object is the route's to delete (`updateProjectDropping`), not this call's.
    expect(fake.objects.has(key)).toBe(true);
  });

  it('removing a space with no icon writes nothing and asks the store nothing', async () => {
    const before = t.db.select().from(activity).all().length;
    const row = await removeProjectIcon(t.db, owner, deps(), 'laika');
    expect(row.iconKey).toBeNull();
    expect(t.db.select().from(activity).all().length).toBe(before);
    expect(fake.requests).toEqual([]);
  });

  it('a store that is down never fails a removal already made', async () => {
    const key = stored();
    fake.intercept = () => new Response('STORE-SECRET-WORDS', { status: 500 });
    const row = await removeProjectIcon(t.db, owner, deps(), 'laika');
    expect([row.iconKey, row.iconEmoji]).toEqual([null, null]);
    // The DELETE was tried, refused, and the object stays behind.
    expect(fake.of('DELETE').length).toBe(1);
    expect(fake.objects.has(key)).toBe(true);
  });

  it('discardIconObject asks nothing of a board with no store, and swallows a refusal', async () => {
    await discardIconObject({ config: null, fetchImpl: fake.fetchImpl }, 'p/x/icon/y');
    await discardIconObject(undefined, 'p/x/icon/y');
    expect(fake.requests).toEqual([]);

    fake.intercept = () => new Response('', { status: 503 });
    await expect(discardIconObject(deps(), 'p/x/icon/y')).resolves.toBeUndefined();
    expect(fake.of('DELETE').length).toBe(1);
  });
});
