import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { projectMemberships, timeDrafts, timeEntries, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { createTask } from '../../src/services/tasks.ts';
import { getTaskTime } from '../../src/services/task-time.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * The confirmed time on a task (`GET /tasks/:id/time`, LAI-1122): live
 * confirmed entries summed, with how many entries and how many people — never
 * who — for anyone who may read the task. A draft is its person's alone and is
 * never counted; a deleted entry is not either.
 */

const NOW = Date.UTC(2026, 10, 4, 12);
const DAY = '2026-11-04';

let t: TestDb;
let owner: string;
let projectId: string;

function makeUser(name: string, orgRole: OrgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name.toLowerCase()}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function member(userId: string, role: 'lead' | 'member' | 'viewer' = 'member'): void {
  t.db
    .insert(projectMemberships)
    .values({ id: newId(), projectId, userId, role, createdAt: NOW })
    .run();
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function entry(
  userId: string,
  taskId: string | null,
  minutes: number,
  extra: { deletedAt?: number } = {},
): void {
  t.db
    .insert(timeEntries)
    .values({
      id: newId(),
      userId,
      taskId,
      projectId: taskId === null ? null : projectId,
      day: DAY,
      tz: 'UTC',
      minutes,
      source: 'manual',
      deletedAt: extra.deletedAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function draft(userId: string, taskId: string, minutes: number): void {
  t.db
    .insert(timeDrafts)
    .values({
      id: newId(),
      userId,
      source: 'collector',
      day: DAY,
      tz: 'UTC',
      minutes,
      taskId,
      projectId,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
  return 'no error';
}

const newTask = (title: string) =>
  createTask(t.sqlite, t.db, actor(owner), 'laika', { title, now: NOW });

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db, NOW);
  owner = s.userId;
  projectId = s.projectId;
});

afterEach(() => {
  t.close();
});

describe('getTaskTime', () => {
  it('sums the confirmed entries on the task, by entries and people, and nothing else', () => {
    const bea = makeUser('Bea', 'member');
    member(bea);
    const task = newTask('Time on a task');
    const other = newTask('Another task');
    entry(owner, task.id, 50);
    entry(owner, task.id, 30);
    entry(bea, task.id, 50);
    // None of these is this task's confirmed time.
    entry(bea, task.id, 600, { deletedAt: NOW });
    entry(bea, other.id, 45);
    entry(bea, null, 20);
    draft(bea, task.id, 240);

    expect(getTaskTime(t.db, actor(owner), task.id)).toEqual({
      total_minutes: 130,
      people: 2,
      entries: 3,
    });
    // A member reads the same totals.
    expect(getTaskTime(t.db, actor(bea), task.id)).toEqual({
      total_minutes: 130,
      people: 2,
      entries: 3,
    });
  });

  it('never counts a draft, even one on the task that nobody confirmed', () => {
    const task = newTask('Only drafted');
    draft(owner, task.id, 90);
    expect(getTaskTime(t.db, actor(owner), task.id)).toEqual({
      total_minutes: 0,
      people: 0,
      entries: 0,
    });
  });

  it('answers zeros for a task with no time, never a missing figure', () => {
    const task = newTask('Nothing logged');
    expect(getTaskTime(t.db, actor(owner), task.id)).toEqual({
      total_minutes: 0,
      people: 0,
      entries: 0,
    });
  });

  it('names nobody: the answer carries counts, not people', () => {
    const task = newTask('Whose time');
    entry(owner, task.id, 15);
    const view = getTaskTime(t.db, actor(owner), task.id);
    expect(Object.keys(view).sort()).toEqual(['entries', 'people', 'total_minutes']);
    expect(JSON.stringify(view)).not.toContain(owner);
  });

  it('refuses somebody outside the project, and an unknown task', () => {
    const task = newTask('Private time');
    entry(owner, task.id, 15);
    const outsider = makeUser('Dee', 'member');
    expect(refusal(() => getTaskTime(t.db, actor(outsider), task.id))).toBe('forbidden');
    expect(refusal(() => getTaskTime(t.db, actor(owner), 'no-such-task'))).toBe('not_found');
  });
});
