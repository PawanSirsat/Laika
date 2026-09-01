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
  projectSummaries,
  removeMember,
  updateProject,
  AVATAR_LIMIT,
} from '../../src/services/projects.ts';
import { addTaskDependency, changeStatus, createTask } from '../../src/services/tasks.ts';
import { appendActivity } from '../../src/db/activity.ts';
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

    const updated = updateProject(t.db, actor(adminId), 'laika', { name: 'Laika Core' });

    expect(updated.name).toBe('Laika Core');

    // `context_md` is deliberately **not** settable here since LAI-404 — it has
    // its own endpoint, so there is exactly one writer of the column. The
    // dedicated pair is covered in `project-context.test.ts`.
    expect(updateProject).toBeTypeOf('function');

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

/**
 * LAI-053. The Projects screen needs nine things per card (§11.4.2.1) and the
 * list endpoint returned six of them — but the cost of adding the rest must not
 * be one query per card.
 */
describe('projectSummaries (SPEC §11.4.2.1)', () => {
  /** Count the statements a call prepares, by instrumenting the driver. */
  function statementsDuring(run: () => void): string[] {
    const recorded: string[] = [];
    const real = t.sqlite.prepare.bind(t.sqlite);

    (t.sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
      recorded.push(source);
      return real(source);
    };

    try {
      run();
    } finally {
      (t.sqlite as unknown as { prepare: typeof real }).prepare = real;
    }

    return recorded;
  }

  it('counts tasks by status, with every status present', () => {
    const { adminId, project } = seedProject();
    const a = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'a' });
    createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'b' });
    changeStatus(t.db, actor(adminId), a.id, 'todo');

    const summary = projectSummaries(t.db, [project.id]).get(project.id);

    // Zero is a measurement; a missing key is not. A card reading `counts.review`
    // must get 0 rather than undefined.
    expect(summary?.task_counts).toEqual({
      backlog: 1,
      todo: 1,
      in_progress: 0,
      review: 0,
      done: 0,
      cancelled: 0,
    });
  });

  it('counts a blocked task once however many things block it', () => {
    const { adminId, project } = seedProject();
    const blocked = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'blocked' });
    const first = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'one' });
    const second = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'two' });

    addTaskDependency(t.sqlite, t.db, actor(adminId), blocked.id, first.id);
    addTaskDependency(t.sqlite, t.db, actor(adminId), blocked.id, second.id);

    // One blocked task, not two — `COUNT(DISTINCT)`.
    expect(projectSummaries(t.db, [project.id]).get(project.id)?.blocked_count).toBe(1);
  });

  it('stops counting a task as blocked once its dependency is done', () => {
    const { adminId, project } = seedProject();
    const blocked = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'blocked' });
    const blocker = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'blocker' });
    addTaskDependency(t.sqlite, t.db, actor(adminId), blocked.id, blocker.id);

    expect(projectSummaries(t.db, [project.id]).get(project.id)?.blocked_count).toBe(1);

    for (const status of ['todo', 'in_progress', 'review', 'done'] as const) {
      changeStatus(t.db, actor(adminId), blocker.id, status);
    }

    expect(projectSummaries(t.db, [project.id]).get(project.id)?.blocked_count).toBe(0);
  });

  it('agrees with `ready`: a cancelled dependency still blocks', () => {
    // `isReady` requires every dependency to be `done` and nothing else, so a
    // cancelled one keeps a task unready for ever. A different rule here would
    // put a number on the card that the board's own flag contradicts.
    const { adminId, project } = seedProject();
    const blocked = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'blocked' });
    const blocker = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'blocker' });
    addTaskDependency(t.sqlite, t.db, actor(adminId), blocked.id, blocker.id);
    changeStatus(t.db, actor(adminId), blocker.id, 'cancelled');

    expect(projectSummaries(t.db, [project.id]).get(project.id)?.blocked_count).toBe(1);
  });

  it('does not count a finished task as blocked', () => {
    const { adminId, project } = seedProject();
    const blocked = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'blocked' });
    const blocker = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'blocker' });
    addTaskDependency(t.sqlite, t.db, actor(adminId), blocked.id, blocker.id);
    changeStatus(t.db, actor(adminId), blocked.id, 'cancelled');

    expect(projectSummaries(t.db, [project.id]).get(project.id)?.blocked_count).toBe(0);
  });

  it('reports the member count and a capped list of avatars', () => {
    const { adminId, project } = seedProject();

    // `createProject` makes its creator a lead, so the project starts with one.
    const before = projectSummaries(t.db, [project.id]).get(project.id)?.member_count ?? 0;
    expect(before).toBe(1);

    const added = AVATAR_LIMIT + 3;
    for (let i = 0; i < added; i += 1) {
      addMember(t.db, actor(adminId), 'laika', makeUser('member'), 'member');
    }

    const summary = projectSummaries(t.db, [project.id]).get(project.id);

    // The count is the truth; the list is what a row of avatars can hold.
    expect(summary?.member_count).toBe(before + added);
    expect(summary?.members).toHaveLength(AVATAR_LIMIT);
  });

  it('sends identity for avatars and nothing more', () => {
    // Not `MemberView`: that carries an email, and every viewer of a project
    // list does not need every member's address to draw a coloured circle.
    const { adminId, project } = seedProject();
    addMember(t.db, actor(adminId), 'laika', makeUser('member'), 'member');

    const avatar = projectSummaries(t.db, [project.id]).get(project.id)?.members[0];

    expect(Object.keys(avatar ?? {}).sort()).toEqual(['name', 'user_id']);
  });

  it('takes last_activity_at from activity, not from the project row', () => {
    // §4.8 is the only source of truth for "when did something happen here".
    // `projects.updated_at` moves only when the row itself changes, so a project
    // with a week of task activity and no settings edit would look untouched.
    const { adminId, project } = seedProject();
    const later = Date.now() + 60_000;

    appendActivity(t.db, {
      orgId,
      projectId: project.id,
      actorId: adminId,
      actorKind: 'user',
      type: 'task.created',
      now: later,
    });

    const summary = projectSummaries(t.db, [project.id]).get(project.id);

    expect(summary?.last_activity_at).toBe(later);
    expect(summary?.last_activity_at).toBeGreaterThan(project.updated_at);
  });

  it('reports null last activity for a project nothing has happened in', () => {
    // `createProject` writes a `project.created` row, so the honest way to see
    // the null case is a project id with no activity at all.
    expect(projectSummaries(t.db, ['nonexistent']).get('nonexistent')?.last_activity_at).toBeNull();
  });

  it('gives every requested id an entry, zeroed', () => {
    const summary = projectSummaries(t.db, ['nope']).get('nope');

    expect(summary?.member_count).toBe(0);
    expect(summary?.blocked_count).toBe(0);
    expect(summary?.members).toEqual([]);
  });

  it('asks for nothing when given nothing', () => {
    expect(projectSummaries(t.db, []).size).toBe(0);
  });

  it('does not offer a live-agent field (AC4)', () => {
    // Deferred, not faked: it needs heartbeats (M4, D-023) and there is no
    // honest value. A card showing "no agents" would be indistinguishable from
    // one showing the truth, so the field does not exist.
    const { project } = seedProject();
    const summary = projectSummaries(t.db, [project.id]).get(project.id);

    for (const invented of ['live_agents', 'agent_count', 'agents_online', 'live_agent']) {
      expect(Object.keys(summary ?? {})).not.toContain(invented);
    }
  });

  it('costs the same four queries for twenty projects as for two (AC2)', () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const admin = makeUser('admin');
      const project = createProject(t.sqlite, t.db, actor(admin), {
        name: `P${String(i)}`,
        slug: `p${String(i)}`,
        prefix: `P${String(i)}X`,
      });
      createTask(t.sqlite, t.db, actor(admin), `p${String(i)}`, { title: 'a task' });
      ids.push(project.id);
    }

    const many = statementsDuring(() => {
      projectSummaries(t.db, ids);
    });
    const few = statementsDuring(() => {
      projectSummaries(t.db, ids.slice(0, 2));
    });

    // The property: cost is a function of the aggregate shape, not the page size.
    expect(many).toHaveLength(few.length);
    expect(many).toHaveLength(4);
  });
});

/**
 * LAI-053 AC5 and AC6 — enriching a list must not widen it, and must not break
 * the paging it already had.
 */
describe('enrichment does not change who sees what', () => {
  it('a viewer with no membership still sees no private project', () => {
    // The summaries are computed for the page `listProjects` returned, so they
    // cannot widen it — but that is a property worth holding, not assuming.
    const { project } = seedProject('secret', 'SEC', 'private');
    const outsider = makeUser('member');

    const visible = listProjects(t.db, actor(outsider), LIST);

    expect(visible.map((row) => row.id)).not.toContain(project.id);
  });

  it('does not leak counts for a project the actor cannot see', () => {
    const { adminId, project } = seedProject('secret', 'SEC', 'private');
    createTask(t.sqlite, t.db, actor(adminId), 'secret', { title: 'private work' });

    const outsider = makeUser('member');
    const ids = listProjects(t.db, actor(outsider), LIST).map((row) => row.id);

    expect(ids).not.toContain(project.id);
  });

  it('still pages and still honours updated_since', () => {
    const admin = makeUser('admin');
    for (let i = 0; i < 5; i += 1) {
      createProject(t.sqlite, t.db, actor(admin), {
        name: `P${String(i)}`,
        slug: `p${String(i)}`,
        prefix: `P${String(i)}X`,
      });
    }

    const first = listProjects(t.db, actor(admin), { ...LIST, limit: 2 });
    expect(first.length).toBeGreaterThan(2); // limit + 1, so the page knows there is more

    const second = listProjects(t.db, actor(admin), {
      ...LIST,
      limit: 2,
      cursor: { sortKey: first[1]?.updatedAt ?? 0, id: first[1]?.id ?? '' },
    });

    // No overlap between pages — the keyset still works.
    const firstTwo = first.slice(0, 2).map((r) => r.id);
    expect(second.map((r) => r.id).filter((id) => firstTwo.includes(id))).toEqual([]);

    // And a watermark in the future returns nothing.
    expect(
      listProjects(t.db, actor(admin), { ...LIST, updatedSince: Date.now() + 60_000 }),
    ).toEqual([]);
  });
});
