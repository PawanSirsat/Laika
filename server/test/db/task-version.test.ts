/**
 * The version `PATCH /tasks/:id`'s `If-Match` compares (LAI-571): every write
 * stamps `updated_at` strictly past what was there, even when the clock has not
 * moved. The route-level proof that each writer uses it is in
 * `test/http/routes/tasks.test.ts`.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { statusForCategory } from '../../src/db/project-statuses.ts';
import { tasks } from '../../src/db/schema.ts';
import { nextTaskVersion, touchTask } from '../../src/db/task-version.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let taskId: string;

function versionOf(id: string): number {
  return t.db.select({ v: tasks.updatedAt }).from(tasks).where(eq(tasks.id, id)).get()!.v;
}

beforeEach(() => {
  t = freshDb();
  const s = seed(t.db);
  taskId = newId();
  t.db
    .insert(tasks)
    .values({
      id: taskId,
      projectId: s.projectId,
      statusId: statusForCategory(t.db, s.projectId, 'backlog').id,
      number: 1,
      title: 'Versioned',
      createdBy: s.userId,
      createdVia: 'web',
      createdAt: 1_000,
      updatedAt: 1_000,
    })
    .run();
});
afterEach(() => {
  t.close();
});

describe('nextTaskVersion', () => {
  it('is the clock when the clock is ahead of the row', () => {
    t.db
      .update(tasks)
      .set({ updatedAt: nextTaskVersion(5_000) })
      .where(eq(tasks.id, taskId))
      .run();
    expect(versionOf(taskId)).toBe(5_000);
  });

  it('is one past the row in the millisecond it was stamped, and after a clock step back', () => {
    for (const now of [1_000, 1_000, 900]) {
      const before = versionOf(taskId);
      t.db
        .update(tasks)
        .set({ updatedAt: nextTaskVersion(now) })
        .where(eq(tasks.id, taskId))
        .run();
      expect(versionOf(taskId), String(now)).toBe(before + 1);
    }
  });
});

describe('touchTask', () => {
  it('moves the version of that task and no other', () => {
    const otherId = newId();
    const row = t.db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
    t.db
      .insert(tasks)
      .values({ ...row, id: otherId, number: 2 })
      .run();

    touchTask(t.db, taskId, 1_000);

    expect(versionOf(taskId)).toBe(1_001);
    expect(versionOf(otherId)).toBe(1_000);
  });
});
