import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { liveTask } from '../../src/db/live-task.ts';
import { tasks } from '../../src/db/schema.ts';
import { createTask, setTaskArchived } from '../../src/services/tasks.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * `liveTask()` (LAI-1353): the one condition every read of current work adds.
 * Which reads add it is `test/tooling/live-task-census.test.ts`'s.
 */

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});

afterEach(() => {
  t.close();
});

describe('liveTask', () => {
  it('keeps a live task and leaves an archived one out, on the table or an alias of it', () => {
    const owner = loadActor(t.db, s.userId)!;
    const live = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Live' });
    const put = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Put away' });
    setTaskArchived(t.db, owner, put.id, true);

    const read = () =>
      t.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, s.projectId), liveTask()))
        .all()
        .map((r) => r.id);
    expect(read()).toEqual([live.id]);

    const blocker = alias(tasks, 'blocker');
    const viaAlias = t.db
      .select({ id: blocker.id })
      .from(blocker)
      .where(liveTask(blocker))
      .all()
      .map((r) => r.id);
    expect(viaAlias).toEqual([live.id]);

    setTaskArchived(t.db, owner, put.id, false);
    expect(read().sort()).toEqual([live.id, put.id].sort());
  });
});
