import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/resolve-actor.ts';
import { liveTask, liveTaskSql } from '../../src/db/live-task.ts';
import { tasks } from '../../src/db/schema.ts';
import { createTask, setTaskArchived, setTaskDeleted } from '../../src/services/tasks.ts';
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

  it('leaves a task in Trash out too, and says the same in raw SQL (LAI-1354)', () => {
    const owner = loadActor(t.db, s.userId)!;
    const live = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Live' });
    const gone = createTask(t.sqlite, t.db, owner, 'laika', { title: 'In Trash' });
    const put = createTask(t.sqlite, t.db, owner, 'laika', { title: 'Archived' });
    setTaskDeleted(t.db, owner, gone.id, true);
    setTaskArchived(t.db, owner, put.id, true);

    const viaDrizzle = t.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(liveTask())
      .all()
      .map((r) => r.id);
    const viaRaw = t.db
      .all<{ id: string }>(sql`SELECT x.id FROM tasks x WHERE ${liveTaskSql('x')}`)
      .map((r) => r.id);
    expect(viaDrizzle).toEqual([live.id]);
    expect(viaRaw).toEqual([live.id]);
    expect(() => liveTaskSql('x; DROP TABLE tasks')).toThrow(/not an alias/);
  });
});
