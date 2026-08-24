import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, projects, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  assertRepoShape,
  createProject,
  getProject,
  REPO_MAX_LENGTH,
  updateProject,
} from '../../src/services/projects.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * §4.3's `repo` column (LAI-108).
 *
 * A separate file from `projects.test.ts` because it is a separate subject: the
 * shape rule exists to serve §9.1's presence match, and the uniqueness question is
 * a product decision rather than CRUD behaviour.
 */

let t: TestDb;
let adminId: string;

function makeUser(): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole: 'admin',
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function expectApiError(fn: () => unknown, code: string, message?: RegExp): ApiError {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    expect(err.code).toBe(code);
    if (message !== undefined) expect(err.message).toMatch(message);
    return err;
  }
  throw new Error(`Expected an ApiError with code "${code}", but nothing was thrown`);
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
});
afterEach(() => {
  t.close();
});

describe('the column exists and round-trips (AC1, AC2)', () => {
  it('is null on a project that has never set it', () => {
    expect(getProject(t.db, actor(adminId), 'laika').repo).toBeNull();
  });

  it('is set and returned by PATCH', () => {
    const updated = updateProject(t.db, actor(adminId), 'laika', { repo: 'PawanSirsat/Laika' });

    expect(updated.repo).toBe('PawanSirsat/Laika');
    expect(getProject(t.db, actor(adminId), 'laika').repo).toBe('PawanSirsat/Laika');
  });

  it('keeps the case it was given', () => {
    // §9.2 already matches branch prefixes case-insensitively, so the comparison
    // can be too; rewriting the value would make `PawanSirsat/Laika` display
    // wrongly for the sake of a match that does not need it.
    updateProject(t.db, actor(adminId), 'laika', { repo: 'PawanSirsat/Laika' });

    expect(t.db.select().from(projects).where(eq(projects.slug, 'laika')).get()?.repo).toBe(
      'PawanSirsat/Laika',
    );
  });

  it('is cleared by null, and left alone when absent', () => {
    updateProject(t.db, actor(adminId), 'laika', { repo: 'owner/name' });

    // Absent: a PATCH about something else must not wipe it.
    expect(updateProject(t.db, actor(adminId), 'laika', { name: 'Renamed' }).repo).toBe(
      'owner/name',
    );

    expect(updateProject(t.db, actor(adminId), 'laika', { repo: null }).repo).toBeNull();
  });

  it('is lead-or-above, like every other project setting', () => {
    const outsider = makeUser();
    t.db.update(users).set({ orgRole: 'member' }).where(eq(users.id, outsider)).run();

    expectApiError(
      () => updateProject(t.db, actor(outsider), 'laika', { repo: 'owner/name' }),
      'forbidden',
    );
  });
});

describe('the shape is enforced, not guessed at (AC3)', () => {
  it.each([
    'owner/name',
    'PawanSirsat/Laika',
    'my-org/my.repo_v2',
    'a/b',
    'org123/repo-2024.1',
    // Trailing punctuation is accepted on purpose. Whether `name-` is a legal
    // repository is the *host's* rule and hosts differ; this check exists to
    // reject URLs and bare names so §9.1's match can work, not to reimplement
    // GitHub's naming policy for GitLab and Gitea too.
    'owner/name-',
  ])('accepts %s', (repo) => {
    expect(() => {
      assertRepoShape(repo);
    }).not.toThrow();
    expect(updateProject(t.db, actor(adminId), 'laika', { repo }).repo).toBe(repo);
  });

  it.each([
    ['a full HTTPS URL', 'https://github.com/owner/name'],
    ['an SSH remote', 'git@github.com:owner/name'],
    ['a bare name', 'name'],
    ['three segments', 'host/owner/name'],
    ['a missing owner', '/name'],
    ['a missing name', 'owner/'],
    // Each segment must *start* alphanumeric: that is what rejects path-like and
    // hidden-file input, which is the same family of mistake as a URL.
    ['a leading dot', '.owner/name'],
    ['a relative path', '../owner/name'],
    ['whitespace inside', 'owner/my repo'],
  ])('rejects %s', (_label, repo) => {
    const err = expectApiError(
      () => updateProject(t.db, actor(adminId), 'laika', { repo }),
      'unprocessable',
    );

    // "invalid format" on a field like this is a puzzle; the caller gets the
    // shape and an example.
    expect(err.details).toMatchObject({ expected: 'owner/name', example: 'PawanSirsat/Laika' });
  });

  it('rejects a .git suffix by name, because it is the second thing people paste', () => {
    const err = expectApiError(
      () => updateProject(t.db, actor(adminId), 'laika', { repo: 'owner/name.git' }),
      'unprocessable',
      /must not end in "\.git"/,
    );

    expect(err.details).toMatchObject({ repo: 'owner/name.git' });
  });

  it('rejects something longer than the cap', () => {
    const long = `owner/${'x'.repeat(REPO_MAX_LENGTH)}`;

    expectApiError(
      () => updateProject(t.db, actor(adminId), 'laika', { repo: long }),
      'unprocessable',
      /at most 200 characters/,
    );
  });

  it('leaves the stored value untouched when a bad one is rejected', () => {
    updateProject(t.db, actor(adminId), 'laika', { repo: 'owner/good' });

    expectApiError(
      () => updateProject(t.db, actor(adminId), 'laika', { repo: 'https://github.com/owner/bad' }),
      'unprocessable',
    );

    expect(getProject(t.db, actor(adminId), 'laika').repo).toBe('owner/good');
  });
});

describe('two projects may track the same repo — decided, not left silent (AC4)', () => {
  it('allows it, because a monorepo split across two projects is a real case', () => {
    createProject(t.sqlite, t.db, actor(adminId), {
      name: 'Laika Web',
      slug: 'laika-web',
      prefix: 'WEB',
    });

    updateProject(t.db, actor(adminId), 'laika', { repo: 'PawanSirsat/Laika' });
    const second = updateProject(t.db, actor(adminId), 'laika-web', { repo: 'PawanSirsat/Laika' });

    expect(second.repo).toBe('PawanSirsat/Laika');

    const sharing = t.db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.repo, 'PawanSirsat/Laika'))
      .all()
      .map((row) => row.slug)
      .sort();

    expect(sharing).toEqual(['laika', 'laika-web']);
  });

  it('has no unique index on repo, so nothing enforces the opposite by accident', () => {
    // The decision lives in the schema's absence of a constraint, which is easy to
    // reverse by mistake. Asserting it means a future `uniqueIndex` has to argue
    // with this test rather than quietly forbid the monorepo case.
    const indexes = t.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='projects'")
      .all() as { sql: string | null }[];

    expect(indexes.filter((row) => row.sql?.includes('repo') === true)).toEqual([]);
  });
});
