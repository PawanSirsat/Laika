import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, projectMemberships, projects, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createFirstOrg, defaultPrefix, setupRequired, slugify } from '../../src/services/setup.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let ownerId: string;

beforeEach(() => {
  t = freshDb();
  ownerId = newId();
  const now = Date.now();
  // better-auth creates this in the real flow; the service takes it as given.
  t.db
    .insert(users)
    .values({
      id: ownerId,
      email: 'ada@example.test',
      name: 'Ada',
      orgRole: 'member',
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
});
afterEach(() => {
  t.close();
});

describe('setupRequired', () => {
  it('is true on an empty database and false once an org exists', () => {
    expect(setupRequired(t.db)).toBe(true);

    createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId });

    expect(setupRequired(t.db)).toBe(false);
  });
});

describe('createFirstOrg', () => {
  it('creates the org and promotes the account to Owner', () => {
    const result = createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId });

    const org = t.db.select().from(orgs).get();
    expect(org?.id).toBe(result.orgId);
    expect(org?.name).toBe('Laika');
    expect(org?.ownerUserId).toBe(ownerId);

    // Signup created the account as `member`; setup makes it the Owner.
    expect(t.db.select().from(users).get()?.orgRole).toBe('owner');
  });

  it('defaults invite_only to 1 (D-004)', () => {
    createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId });

    expect(t.db.select().from(orgs).get()?.inviteOnly).toBe(1);
  });

  it('creates no project when none is asked for', () => {
    const result = createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId });

    expect(result.projectId).toBeNull();
    expect(t.db.select().from(projects).all()).toEqual([]);
  });

  it('creates the first project, its slug and prefix, and the Owner’s membership', () => {
    const result = createFirstOrg(t.sqlite, t.db, {
      orgName: 'Laika',
      ownerId,
      projectName: 'Laika Core',
    });

    const project = t.db.select().from(projects).get();
    expect(project?.id).toBe(result.projectId);
    expect(project?.slug).toBe('laika-core');
    expect(project?.prefix).toBe('LC');

    // Without the membership the Owner holds only the implicit lead their org
    // role grants, so a later demotion would silently strip project access.
    const membership = t.db.select().from(projectMemberships).get();
    expect(membership?.userId).toBe(ownerId);
    expect(membership?.role).toBe('lead');
  });

  it('honours an explicit project prefix', () => {
    createFirstOrg(t.sqlite, t.db, {
      orgName: 'Laika',
      ownerId,
      projectName: 'Laika Core',
      projectPrefix: 'lai',
    });

    expect(t.db.select().from(projects).get()?.prefix).toBe('LAI');
  });

  it('writes org.created and project.created with the Owner as actor', () => {
    createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId, projectName: 'Laika Core' });

    const rows = t.db.select().from(activity).orderBy(activity.type).all();

    expect(rows.map((r) => r.type)).toEqual(['org.created', 'project.created']);
    for (const row of rows) {
      expect(row.actorId).toBe(ownerId);
      expect(row.actorKind).toBe('user');
    }
  });

  it('writes org.created even with no project — the audit starts at the org', () => {
    createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId });

    expect(
      t.db
        .select()
        .from(activity)
        .all()
        .map((r) => r.type),
    ).toEqual(['org.created']);
  });

  it('refuses a second run', () => {
    createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId });

    try {
      createFirstOrg(t.sqlite, t.db, { orgName: 'Second', ownerId });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('conflict');
    }
  });

  it('leaves nothing behind when it fails', () => {
    // A failure partway through must not leave an org with no project, or an
    // activity row describing something that did not happen.
    expect(() => {
      createFirstOrg(t.sqlite, t.db, {
        orgName: 'Laika',
        ownerId: 'no-such-user',
        projectName: 'Laika Core',
      });
    }).toThrow();

    expect(t.db.select().from(orgs).all()).toEqual([]);
    expect(t.db.select().from(projects).all()).toEqual([]);
    expect(t.db.select().from(activity).all()).toEqual([]);
    expect(setupRequired(t.db)).toBe(true);
  });
});

describe('slugify and defaultPrefix', () => {
  it('slugifies display names', () => {
    expect(slugify('Laika Core')).toBe('laika-core');
    expect(slugify('  Laika!  Core  ')).toBe('laika-core');
    expect(slugify('Laika')).toBe('laika');
  });

  it('derives initials for multi-word names and letters for one word', () => {
    expect(defaultPrefix('Laika Core')).toBe('LC');
    expect(defaultPrefix('Laika Core Platform')).toBe('LCP');
    expect(defaultPrefix('Laika')).toBe('LAI');
    expect(defaultPrefix('Go')).toBe('GOX');
    expect(defaultPrefix('!!!')).toBe('PRJ');
  });
});

describe('single-use under concurrency (AC3)', () => {
  it('lets exactly one of many simultaneous callers win', () => {
    // better-sqlite3 is synchronous, so this is contention on one connection
    // rather than true parallelism — `BEGIN IMMEDIATE` and the in-transaction
    // recheck are what make it safe, and both are exercised here. The
    // cross-process case is covered by db/numbering.test.ts, which runs real
    // worker threads against the same lock.
    const extraOwners = Array.from({ length: 5 }, () => {
      const id = newId();
      const now = Date.now();
      t.db
        .insert(users)
        .values({
          id,
          email: `${id}@example.test`,
          name: 'Racer',
          orgRole: 'member',
          avatarColor: '#000000',
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .run();
      return id;
    });

    const outcomes = [ownerId, ...extraOwners].map((id) => {
      try {
        createFirstOrg(t.sqlite, t.db, { orgName: 'Laika', ownerId: id });
        return 'won';
      } catch (err) {
        return err instanceof ApiError && err.code === 'conflict' ? 'conflict' : 'unexpected';
      }
    });

    expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'conflict')).toHaveLength(5);
    expect(
      t.db
        .select({ n: sql<number>`COUNT(*)` })
        .from(orgs)
        .get()?.n,
    ).toBe(1);
  });
});
