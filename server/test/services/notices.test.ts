import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  memberNotices,
  orgs,
  projectMemberships,
  tasks,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { pruneNotices } from '../../src/jobs/jobs.ts';
import {
  listNotices,
  markAllNoticesRead,
  markNoticeRead,
  unreadNoticeCount,
} from '../../src/services/notices.ts';
import {
  addMember,
  createProject,
  projectIdByKeyPrefix,
  removeMember,
} from '../../src/services/projects.ts';
import { changeStatus, createTask, updateTask } from '../../src/services/tasks.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Member notices and onboarding through `addMember` (SPEC §4.87, §6.4, D-134,
 * LAI-1136): one transaction for the membership, `member.added`, the first
 * card and the notice; the recipient's own list; read and read-all; 90 days.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 5, 12);

let t: TestDb;
let adminId: string;

function makeUser(email: string, orgRole: OrgRole = 'member', isActive = 1): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email,
      name: email.split('@')[0]!,
      orgRole,
      isActive,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function newTask(slug = 'laika', title = 'First card'): string {
  return createTask(t.sqlite, t.db, actor(adminId), slug, { title }).id;
}

function page(userId: string, unread = false) {
  return listNotices(t.db, actor(userId), { limit: 50, cursor: null, unread });
}

function activityOf(type: string): (typeof activity.$inferSelect)[] {
  return t.db
    .select()
    .from(activity)
    .where(eq(activity.type, type as never))
    .all();
}

function membership(userId: string) {
  return t.db
    .select()
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.projectId, projectIdByKeyPrefix(t.db, 'LAI')!),
      ),
    )
    .get();
}

/** The `ApiError` a call throws, so its `code` and `details.reason` can be asserted. */
function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal, and the call succeeded');
}

function reasonOf(err: ApiError): unknown {
  return (err.details as { reason?: unknown } | null)?.reason;
}

beforeEach(() => {
  t = freshDb();
  adminId = makeUser('admin@example.test', 'admin');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: NOW, updatedAt: NOW })
    .run();
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Other', slug: 'other', prefix: 'OTH' });
});
afterEach(() => {
  t.close();
});

describe('adding a member writes one notice (D-134)', () => {
  it('writes the membership, member.added and one added_to_space notice with the message', () => {
    const ada = makeUser('ada@example.test');
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW, { message: 'Welcome aboard' });

    expect(membership(ada)?.role).toBe('member');
    expect(activityOf('member.added')).toHaveLength(1);
    const notices = page(ada);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: 'added_to_space',
      actor: { id: adminId, name: 'admin' },
      project: { slug: 'laika', name: 'Laika' },
      task: null,
      message: 'Welcome aboard',
      read_at: null,
    });
    expect(unreadNoticeCount(t.db, actor(ada))).toBe(1);
  });

  it('notifies on every add, message or not', () => {
    const ada = makeUser('ada@example.test');
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW);
    expect(page(ada)).toMatchObject([{ kind: 'added_to_space', message: null, task: null }]);
  });

  it('assigns the first card through the assign path, so task.assigned is written', () => {
    const ada = makeUser('ada@example.test');
    const taskId = newTask();
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW, { assignTaskId: taskId });

    const row = t.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
    expect(row.assigneeId).toBe(ada);
    const assigned = activityOf('task.assigned');
    expect(assigned).toHaveLength(1);
    expect(JSON.parse(assigned[0]!.payloadJson)).toEqual({ from: null, to: ada });
    expect(page(ada)[0]).toMatchObject({ task: { id: taskId, key: 'LAI-1', title: 'First card' } });
  });

  it('writes no notice for a self-add', () => {
    // A second admin, on no space yet (the creator is a member of both).
    const bo = makeUser('bo@example.test', 'admin');
    addMember(t.db, actor(bo), 'laika', bo, 'lead', NOW, { message: 'me' });
    expect(membership(bo)?.role).toBe('lead');
    expect(t.db.select().from(memberNotices).all()).toHaveLength(0);
  });

  it('refuses a re-add 409 and writes no second notice', () => {
    const ada = makeUser('ada@example.test');
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW);
    const err = refusal(() =>
      addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW + 1, { message: 'again' }),
    );
    expect(err.code).toBe('conflict');
    expect(page(ada)).toHaveLength(1);
    expect(activityOf('member.added')).toHaveLength(1);
  });

  it('refuses re-adding a member since deactivated 422 user_deactivated, not 409', () => {
    const ada = makeUser('ada@example.test');
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW);
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, ada)).run();
    const err = refusal(() => addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW + 1));
    expect(err.code).toBe('unprocessable');
    expect(reasonOf(err)).toBe('user_deactivated');
    expect(t.db.select().from(memberNotices).all()).toHaveLength(1);
  });

  it('refuses a deactivated person 422 user_deactivated and writes nothing', () => {
    const gone = makeUser('gone@example.test', 'member', 0);
    const err = refusal(() => addMember(t.db, actor(adminId), 'laika', gone, 'member', NOW));
    expect(err.code).toBe('unprocessable');
    expect(reasonOf(err)).toBe('user_deactivated');
    expect(membership(gone)).toBeUndefined();
    expect(activityOf('member.added')).toHaveLength(0);
  });
});

describe('the first card must be assignable (D-134)', () => {
  function expectNotAssignable(taskId: string): void {
    const ada = makeUser(`${newId()}@example.test`);
    const err = refusal(() =>
      addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW, {
        message: 'hi',
        assignTaskId: taskId,
      }),
    );
    expect(err.code).toBe('unprocessable');
    expect(reasonOf(err)).toBe('task_not_assignable');
    // ...and the add itself rolled back with it.
    expect(membership(ada)).toBeUndefined();
    expect(page(ada)).toHaveLength(0);
  }

  it('refuses a task in another space', () => {
    expectNotAssignable(newTask('other'));
  });

  it('refuses a task that is not backlog or todo', () => {
    const taskId = newTask();
    changeStatus(t.db, actor(adminId), taskId, 'in_progress');
    expectNotAssignable(taskId);
  });

  it('refuses a task that already has an assignee', () => {
    const taskId = newTask();
    updateTask(t.db, actor(adminId), taskId, { assignee_id: adminId });
    expectNotAssignable(taskId);
  });

  it('refuses an id that names no task', () => {
    expectNotAssignable(newId());
  });

  it('writes nothing else when any refusal fires', () => {
    const taskId = newTask('other');
    expectNotAssignable(taskId);
    expect(activityOf('member.added')).toHaveLength(0);
    expect(activityOf('task.assigned')).toHaveLength(0);
  });
});

describe('the add is one transaction (D-134)', () => {
  it('rolls back the membership, member.added and the assignment when the notice cannot be written', () => {
    const ada = makeUser('ada@example.test');
    const taskId = newTask();
    // Past §4.87's CHECK: the route refuses it first, so only the last write
    // in the transaction can fail here — after the three before it ran.
    expect(() =>
      addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW, {
        message: 'x'.repeat(501),
        assignTaskId: taskId,
      }),
    ).toThrow(/CHECK constraint failed: member_notices_message_check/);
    expect(membership(ada)).toBeUndefined();
    expect(activityOf('member.added')).toHaveLength(0);
    expect(activityOf('task.assigned')).toHaveLength(0);
    expect(t.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!.assigneeId).toBeNull();
    expect(t.db.select().from(memberNotices).all()).toHaveLength(0);
  });
});

describe('reading and marking notices', () => {
  let ada: string;
  let bea: string;

  beforeEach(() => {
    ada = makeUser('ada@example.test');
    bea = makeUser('bea@example.test');
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW);
    addMember(t.db, actor(adminId), 'other', ada, 'member', NOW + 1);
    addMember(t.db, actor(adminId), 'laika', bea, 'member', NOW + 2);
  });

  it('lists only the caller’s own, newest first', () => {
    expect(page(ada).map((n) => n.project?.slug)).toEqual(['other', 'laika']);
    expect(page(bea).map((n) => n.project?.slug)).toEqual(['laika']);
    expect(page(adminId)).toEqual([]);
  });

  it('marks one read idempotently, keeping its first read_at', () => {
    const [newest] = page(ada);
    markNoticeRead(t.db, actor(ada), newest!.id, NOW + 10);
    markNoticeRead(t.db, actor(ada), newest!.id, NOW + 20);
    expect(page(ada)[0]!.read_at).toBe(NOW + 10);
    expect(unreadNoticeCount(t.db, actor(ada))).toBe(1);
    expect(page(ada, true)).toHaveLength(1);
  });

  it('answers 404 for somebody else’s notice and leaves it unread', () => {
    const [beas] = page(bea);
    const err = refusal(() => markNoticeRead(t.db, actor(ada), beas!.id, NOW + 10));
    expect(err.code).toBe('not_found');
    expect(page(bea)[0]!.read_at).toBeNull();
  });

  it('marks all read idempotently, and only the caller’s', () => {
    markAllNoticesRead(t.db, actor(ada), NOW + 10);
    markAllNoticesRead(t.db, actor(ada), NOW + 20);
    expect(page(ada).map((n) => n.read_at)).toEqual([NOW + 10, NOW + 10]);
    expect(unreadNoticeCount(t.db, actor(ada))).toBe(0);
    expect(unreadNoticeCount(t.db, actor(bea))).toBe(1);
  });
});

describe('a removed member keeps the notice, not the live space (LAI-1136 review, B1)', () => {
  it('hides the space and the card once the recipient can no longer read the space', () => {
    const ada = makeUser('ada@example.test');
    const bea = makeUser('bea@example.test');
    const taskId = newTask('laika', 'Start here');
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW, {
      message: 'Welcome',
      assignTaskId: taskId,
    });
    addMember(t.db, actor(adminId), 'laika', bea, 'member', NOW + 1);
    // Positive control: while Ada is a member, both are shown, live.
    expect(page(ada)[0]).toMatchObject({
      project: { slug: 'laika' },
      task: { id: taskId, title: 'Start here' },
    });

    removeMember(t.db, actor(adminId), 'laika', ada, NOW + 2, 'unassign');
    updateTask(t.db, actor(adminId), taskId, { title: 'Secret new title' });

    const [notice] = page(ada);
    expect(notice).toMatchObject({ kind: 'added_to_space', message: 'Welcome' });
    expect(notice!.project).toBeNull();
    expect(notice!.task).toBeNull();
    expect(JSON.stringify(page(ada))).not.toContain('Secret new title');
    // Somebody still in the space reads it live.
    expect(page(bea)[0]!.project).toMatchObject({ slug: 'laika' });
  });
});

describe('retention (§11.6)', () => {
  it('deletes notices older than 90 days, read or not, and keeps younger ones', () => {
    const ada = makeUser('ada@example.test');
    addMember(t.db, actor(adminId), 'laika', ada, 'member', NOW);
    addMember(t.db, actor(adminId), 'other', ada, 'member', NOW + 2 * DAY);
    markAllNoticesRead(t.db, actor(ada), NOW + 2 * DAY);

    expect(pruneNotices(t.db, NOW + 91 * DAY).changed).toBe(1);
    expect(page(ada).map((n) => n.project?.slug)).toEqual(['other']);
    // Idempotent: nothing more to take until the second one ages out.
    expect(pruneNotices(t.db, NOW + 91 * DAY).changed).toBe(0);
    expect(pruneNotices(t.db, NOW + 93 * DAY).changed).toBe(1);
  });
});
