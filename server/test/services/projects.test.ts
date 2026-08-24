import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { activity, orgs, projectMemberships, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  addMember,
  changeMemberRole,
  createProject,
  getProject,
  joinPublicProject,
  listMembers,
  listProjects,
  removeMember,
  updateProject,
} from '../../src/services/projects.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let orgId: string;

function makeUser(orgRole: OrgRole): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole,
      avatarColor: '#123456',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

/** The actor exactly as the auth middleware builds it — memberships and all. */
function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error(`no such user ${userId}`);
  return loaded;
}

/** A project created by an admin, so the fixtures are not themselves under test. */
function seedProject(slug = 'laika', prefix = 'LAI', visibility?: 'public' | 'private') {
  const adminId = makeUser('admin');
  const project = createProject(t.sqlite, t.db, actor(adminId), {
    name: 'Laika',
    slug,
    prefix,
    ...(visibility === undefined ? {} : { visibility }),
  });
  return { adminId, project };
}

const LIST = { limit: 50, cursor: null, updatedSince: null };

beforeEach(() => {
  t = freshDb();
  orgId = newId();
  const now = Date.now();
  const ownerId = makeUser('owner');
  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: ownerId, createdAt: now, updatedAt: now })
    .run();
});
afterEach(() => {
  t.close();
});

describe('createProject (AC2)', () => {
  it('creates a project and makes the creator its lead', () => {
    const { adminId, project } = seedProject();

    expect(project.slug).toBe('laika');
    expect(project.prefix).toBe('LAI');
    expect(listMembers(t.db, actor(adminId), 'laika')).toEqual([
      expect.objectContaining({ user_id: adminId, role: 'lead' }),
    ]);
  });

  it('lowercases the slug and uppercases the prefix', () => {
    const adminId = makeUser('admin');
    const project = createProject(t.sqlite, t.db, actor(adminId), {
      name: 'Laika',
      slug: 'Laika-Core',
      prefix: 'lai',
    });

    expect(project.slug).toBe('laika-core');
    expect(project.prefix).toBe('LAI');
  });

  it('refuses a duplicate slug with conflict', () => {
    seedProject('laika', 'LAI');
    const adminId = makeUser('admin');

    try {
      createProject(t.sqlite, t.db, actor(adminId), {
        name: 'Other',
        slug: 'laika',
        prefix: 'OTH',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
      expect((err as ApiError).details).toMatchObject({ field: 'slug' });
    }
  });

  it('refuses a duplicate prefix with conflict', () => {
    seedProject('laika', 'LAI');
    const adminId = makeUser('admin');

    try {
      createProject(t.sqlite, t.db, actor(adminId), {
        name: 'Other',
        slug: 'other',
        prefix: 'LAI',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
      expect((err as ApiError).details).toMatchObject({ field: 'prefix' });
    }
  });

  it('writes one project.created row', () => {
    seedProject();

    const rows = t.db.select().from(activity).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('project.created');
  });

  it('refuses Member and Viewer (§3.1)', () => {
    for (const role of ['member', 'viewer'] as const) {
      const id = makeUser(role);
      expect(() =>
        createProject(t.sqlite, t.db, actor(id), { name: 'X', slug: `x-${role}`, prefix: 'XXX' }),
      ).toThrow(ApiError);
    }
  });
});

describe('listProjects (AC1)', () => {
  it('shows org owners and admins everything, without a membership', () => {
    seedProject('one', 'ONE');
    seedProject('two', 'TWO');

    for (const role of ['owner', 'admin'] as const) {
      const id = makeUser(role);
      expect(
        listProjects(t.db, actor(id), LIST)
          .map((p) => p.slug)
          .sort(),
      ).toEqual(['one', 'two']);
    }
  });

  it('shows a Member only the projects they belong to', () => {
    const { adminId } = seedProject('one', 'ONE');
    seedProject('two', 'TWO');

    const memberId = makeUser('member');
    addMember(t.db, actor(adminId), 'one', memberId, 'member');

    expect(listProjects(t.db, actor(memberId), LIST).map((p) => p.slug)).toEqual(['one']);
  });

  it('shows a non-member nothing', () => {
    seedProject();
    const outsider = makeUser('member');

    expect(listProjects(t.db, actor(outsider), LIST)).toEqual([]);
  });

  it('filters by updated_since', () => {
    seedProject('one', 'ONE');
    const admin = makeUser('admin');

    const before = listProjects(t.db, actor(admin), { ...LIST, updatedSince: Date.now() + 1000 });
    expect(before).toEqual([]);

    const all = listProjects(t.db, actor(admin), { ...LIST, updatedSince: 0 });
    expect(all).toHaveLength(1);
  });
});

describe('getProject and updateProject (AC3)', () => {
  it('lets a member read and refuses a non-member (§3.2)', () => {
    const { adminId } = seedProject();
    const memberId = makeUser('member');
    const outsider = makeUser('member');
    addMember(t.db, actor(adminId), 'laika', memberId, 'member');

    expect(getProject(t.db, actor(memberId), 'laika').slug).toBe('laika');
    expect(() => getProject(t.db, actor(outsider), 'laika')).toThrow(ApiError);
  });

  it('404s an unknown slug', () => {
    const admin = makeUser('admin');
    expect(() => getProject(t.db, actor(admin), 'nope')).toThrow(/No project with slug/);
  });

  it('updates settings and writes project.updated', () => {
    const { adminId } = seedProject();

    const updated = updateProject(t.db, actor(adminId), 'laika', {
      name: 'Laika Core',
      context_md: '# Brief',
    });

    expect(updated.name).toBe('Laika Core');
    expect(updated.context_md).toBe('# Brief');

    const types = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types).toEqual(['project.created', 'project.updated']);
  });

  it('archives with its own verb, and restores', () => {
    const { adminId } = seedProject();

    const archived = updateProject(t.db, actor(adminId), 'laika', { archived: true });
    expect(archived.archived_at).not.toBeNull();

    const restored = updateProject(t.db, actor(adminId), 'laika', { archived: false });
    expect(restored.archived_at).toBeNull();

    // Archiving is what removes a project from every active view; an audit
    // reader should not have to diff a payload to discover that happened.
    const types = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types).toEqual(['project.created', 'project.archived', 'project.updated']);
  });

  it('writes no activity when nothing actually changed', () => {
    const { adminId } = seedProject();

    updateProject(t.db, actor(adminId), 'laika', {});

    expect(t.db.select().from(activity).all()).toHaveLength(1);
  });

  it('refuses a plain Member editing settings (§3.2 lead-only)', () => {
    const { adminId } = seedProject();
    const memberId = makeUser('member');
    addMember(t.db, actor(adminId), 'laika', memberId, 'member');

    expect(() => updateProject(t.db, actor(memberId), 'laika', { name: 'Nope' })).toThrow(ApiError);
  });
});

describe('membership management (AC4)', () => {
  it('adds, changes role and removes, each with its own verb', () => {
    const { adminId } = seedProject();
    const memberId = makeUser('member');

    addMember(t.db, actor(adminId), 'laika', memberId, 'member');
    changeMemberRole(t.db, actor(adminId), 'laika', memberId, 'viewer');
    removeMember(t.db, actor(adminId), 'laika', memberId);

    const types = t.db
      .select()
      .from(activity)
      .all()
      .map((r) => r.type);
    expect(types).toEqual([
      'project.created',
      'member.added',
      'member.role_changed',
      'member.removed',
    ]);
  });

  it('refuses adding the same user twice', () => {
    const { adminId } = seedProject();
    const memberId = makeUser('member');

    addMember(t.db, actor(adminId), 'laika', memberId, 'member');

    expect(() => addMember(t.db, actor(adminId), 'laika', memberId, 'member')).toThrow(ApiError);
  });

  it('refuses a project role above viewer for an org viewer (§4.4)', () => {
    const { adminId } = seedProject();
    const viewerId = makeUser('viewer');

    // Refused at the write path, not merely capped on read — a stored row that
    // gets silently downgraded is a lie in the database.
    expect(() => addMember(t.db, actor(adminId), 'laika', viewerId, 'lead')).toThrow(
      /may only hold the project role/,
    );
    expect(() => addMember(t.db, actor(adminId), 'laika', viewerId, 'viewer')).not.toThrow();
  });

  it('refuses a plain Member managing members', () => {
    const { adminId } = seedProject();
    const memberId = makeUser('member');
    const otherId = makeUser('member');
    addMember(t.db, actor(adminId), 'laika', memberId, 'member');

    expect(() => addMember(t.db, actor(memberId), 'laika', otherId, 'member')).toThrow(ApiError);
  });

  it('404s removing someone who is not a member', () => {
    const { adminId } = seedProject();
    const strangerId = makeUser('member');

    expect(() => removeMember(t.db, actor(adminId), 'laika', strangerId)).toThrow(/not a member/);
  });
});

describe('the last lead cannot be removed (AC5)', () => {
  it('refuses removing the only lead', () => {
    const { adminId } = seedProject();

    try {
      removeMember(t.db, actor(adminId), 'laika', adminId);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('conflict');
      expect((err as ApiError).message).toMatch(/at least one lead/);
    }
  });

  it('refuses demoting the only lead', () => {
    const { adminId } = seedProject();

    expect(() => changeMemberRole(t.db, actor(adminId), 'laika', adminId, 'member')).toThrow(
      /at least one lead/,
    );
  });

  it('allows removing a lead once another exists', () => {
    const { adminId } = seedProject();
    const secondId = makeUser('admin');

    addMember(t.db, actor(adminId), 'laika', secondId, 'lead');

    expect(() => removeMember(t.db, actor(adminId), 'laika', adminId)).not.toThrow();
    expect(listMembers(t.db, actor(secondId), 'laika')).toHaveLength(1);
  });

  it('leaves the membership in place when the refusal fires', () => {
    const { adminId } = seedProject();

    try {
      removeMember(t.db, actor(adminId), 'laika', adminId);
    } catch {
      // expected
    }

    expect(t.db.select().from(projectMemberships).all()).toHaveLength(1);
  });
});

describe('joining a public project (§3.1)', () => {
  it('lets an org member join a public project as member', () => {
    seedProject('open', 'OPN', 'public');
    const memberId = makeUser('member');

    joinPublicProject(t.db, actor(memberId), 'open');

    expect(listProjects(t.db, actor(memberId), LIST).map((p) => p.slug)).toEqual(['open']);
  });

  it('lets an org viewer join, but only as viewer', () => {
    seedProject('open', 'OPN', 'public');
    const viewerId = makeUser('viewer');

    const members = joinPublicProject(t.db, actor(viewerId), 'open');

    expect(members.find((m) => m.user_id === viewerId)?.role).toBe('viewer');
  });

  it('refuses joining a private project', () => {
    seedProject('closed', 'CLS', 'private');
    const memberId = makeUser('member');

    expect(() => joinPublicProject(t.db, actor(memberId), 'closed')).toThrow(ApiError);
  });

  it('refuses joining twice', () => {
    seedProject('open', 'OPN', 'public');
    const memberId = makeUser('member');

    joinPublicProject(t.db, actor(memberId), 'open');
    expect(() => joinPublicProject(t.db, actor(memberId), 'open')).toThrow(/already a member/);
  });
});
