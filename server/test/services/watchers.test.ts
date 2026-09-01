import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, taskWatchers, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { addComment, deleteComment } from '../../src/services/comments.ts';
import { addMember, createProject, removeMember } from '../../src/services/projects.ts';
import { createTask, updateTask } from '../../src/services/tasks.ts';
import {
  tasksWatchedBy,
  unwatchTask,
  watchState,
  watchTask,
  watchersOfTask,
} from '../../src/services/watchers.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let adminId: string;
let taskId: string;

function makeUser(email: string, orgRole: OrgRole = 'member'): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email,
      name: 'Person',
      orgRole,
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

function member(email: string): string {
  const id = makeUser(email);
  addMember(t.db, actor(adminId), 'laika', id, 'member');
  return id;
}

function newTask(title = 'Another thing'): string {
  return createTask(t.sqlite, t.db, actor(adminId), 'laika', { title }).id;
}

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin@example.test', 'admin');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();
  createProject(t.sqlite, t.db, actor(adminId), { name: 'Laika', slug: 'laika', prefix: 'LAI' });
  taskId = createTask(t.sqlite, t.db, actor(adminId), 'laika', { title: 'Do the thing' }).id;
});
afterEach(() => {
  t.close();
});

describe('watching explicitly (AC2)', () => {
  it('adds and removes the actor', () => {
    const adaId = member('ada@example.test');

    expect(watchersOfTask(t.db, actor(adaId), taskId)).not.toContain(adaId);

    watchTask(t.db, actor(adaId), taskId);
    expect(watchersOfTask(t.db, actor(adaId), taskId)).toContain(adaId);

    unwatchTask(t.db, actor(adaId), taskId);
    expect(watchersOfTask(t.db, actor(adaId), taskId)).not.toContain(adaId);
  });

  it('writes one row however many times it is called', () => {
    const adaId = member('ada@example.test');

    watchTask(t.db, actor(adaId), taskId);
    watchTask(t.db, actor(adaId), taskId);
    unwatchTask(t.db, actor(adaId), taskId);

    const rows = t.db.select().from(taskWatchers).where(eq(taskWatchers.userId, adaId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.watching).toBe(0);
  });

  it('refuses somebody who cannot read the project', () => {
    const outsiderId = makeUser('outsider@example.test');

    expect(() => watchTask(t.db, actor(outsiderId), taskId)).toThrow(ApiError);
  });

  it('reports whether the state was chosen or inherited', () => {
    const adaId = member('ada@example.test');

    expect(watchState(t.db, actor(adaId), taskId)).toEqual({ watching: false, explicit: false });

    addComment(t.db, actor(adaId), taskId, 'looking');
    expect(watchState(t.db, actor(adaId), taskId)).toEqual({ watching: true, explicit: false });

    unwatchTask(t.db, actor(adaId), taskId);
    expect(watchState(t.db, actor(adaId), taskId)).toEqual({ watching: false, explicit: true });
  });
});

describe('the three implicit rules (AC3)', () => {
  it('watches a task you are assigned', () => {
    const adaId = member('ada@example.test');
    updateTask(t.db, actor(adminId), taskId, { assignee_id: adaId });

    expect(watchersOfTask(t.db, actor(adaId), taskId)).toContain(adaId);
  });

  it('watches a task you comment on', () => {
    const adaId = member('ada@example.test');
    addComment(t.db, actor(adaId), taskId, 'looking at this now');

    expect(watchersOfTask(t.db, actor(adaId), taskId)).toContain(adaId);
  });

  it('watches a task you are mentioned in', () => {
    const adaId = member('ada@example.test');
    const authorId = member('author@example.test');
    addComment(t.db, actor(authorId), taskId, 'over to you @ada');

    expect(watchersOfTask(t.db, actor(adaId), taskId)).toContain(adaId);
  });

  it('stops implying once the comment is deleted', () => {
    const adaId = member('ada@example.test');
    const comment = addComment(t.db, actor(adaId), taskId, 'looking');
    expect(watchersOfTask(t.db, actor(adaId), taskId)).toContain(adaId);

    deleteComment(t.db, actor(adaId), comment.id);
    expect(watchersOfTask(t.db, actor(adminId), taskId)).not.toContain(adaId);
  });
});

describe('an explicit no survives the implicit rules — the load-bearing case', () => {
  it('does not resubscribe somebody through their own next comment', () => {
    const adaId = member('ada@example.test');

    addComment(t.db, actor(adaId), taskId, 'first');
    unwatchTask(t.db, actor(adaId), taskId);
    expect(watchersOfTask(t.db, actor(adaId), taskId)).not.toContain(adaId);

    // The behaviour that makes a person turn notifications off entirely: they
    // said no, then said something, and were signed back up by saying it.
    addComment(t.db, actor(adaId), taskId, 'and one more thing');
    expect(watchersOfTask(t.db, actor(adaId), taskId)).not.toContain(adaId);
  });

  it('does not resubscribe an assignee who opted out', () => {
    const adaId = member('ada@example.test');
    updateTask(t.db, actor(adminId), taskId, { assignee_id: adaId });
    unwatchTask(t.db, actor(adaId), taskId);

    expect(watchersOfTask(t.db, actor(adaId), taskId)).not.toContain(adaId);
    expect(tasksWatchedBy(t.db, actor(adaId))).not.toContain(taskId);
  });

  it('does not resubscribe somebody who opted out and was then mentioned', () => {
    const adaId = member('ada@example.test');
    const authorId = member('author@example.test');
    unwatchTask(t.db, actor(adaId), taskId);

    addComment(t.db, actor(authorId), taskId, 'ping @ada');
    expect(watchersOfTask(t.db, actor(adaId), taskId)).not.toContain(adaId);
  });
});

describe('the set never widens who can see anything', () => {
  it('drops a watcher who loses read access', () => {
    const adaId = member('ada@example.test');
    watchTask(t.db, actor(adaId), taskId);
    expect(watchersOfTask(t.db, actor(adminId), taskId)).toContain(adaId);

    removeMember(t.db, actor(adminId), 'laika', adaId);

    // The row is still there; they are no longer a watcher.
    expect(
      t.db.select().from(taskWatchers).where(eq(taskWatchers.userId, adaId)).all(),
    ).toHaveLength(1);
    expect(watchersOfTask(t.db, actor(adminId), taskId)).not.toContain(adaId);
  });

  it('drops a deactivated watcher', () => {
    const adaId = member('ada@example.test');
    watchTask(t.db, actor(adaId), taskId);

    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, adaId)).run();
    expect(watchersOfTask(t.db, actor(adminId), taskId)).not.toContain(adaId);
  });

  it('refuses a reader who cannot see the project', () => {
    const outsiderId = makeUser('outsider@example.test');

    expect(() => watchersOfTask(t.db, actor(outsiderId), taskId)).toThrow(ApiError);
  });
});

describe('tasks for a watcher (AC2)', () => {
  it('collects all four reasons', () => {
    const adaId = member('ada@example.test');
    const authorId = member('author@example.test');

    const assigned = newTask('assigned');
    updateTask(t.db, actor(adminId), assigned, { assignee_id: adaId });

    const commented = newTask('commented');
    addComment(t.db, actor(adaId), commented, 'a thought');

    const mentioned = newTask('mentioned');
    addComment(t.db, actor(authorId), mentioned, 'cc @ada');

    const explicit = newTask('explicit');
    watchTask(t.db, actor(adaId), explicit);

    expect(tasksWatchedBy(t.db, actor(adaId)).sort()).toEqual(
      [assigned, commented, mentioned, explicit].sort(),
    );
  });

  it('leaves out a task nobody connected them to', () => {
    const adaId = member('ada@example.test');

    expect(tasksWatchedBy(t.db, actor(adaId))).toEqual([]);
  });

  it('is own-only', () => {
    const adaId = member('ada@example.test');
    const graceId = member('grace@example.test');
    watchTask(t.db, actor(graceId), taskId);

    // Widening this needs a §3 row; it is not a service's decision.
    expect(() => tasksWatchedBy(t.db, actor(adaId), graceId)).toThrow(ApiError);
    expect(tasksWatchedBy(t.db, actor(graceId), graceId)).toEqual([taskId]);
  });
});
