import { eq, sql, type SQL } from 'drizzle-orm';

import { type Db } from './client.ts';
import { tasks } from './schema.ts';

/**
 * The `updated_at` a write to a task stamps: the clock, or one past the value
 * already there if the clock has not moved past it (LAI-571).
 *
 * `updated_at` is the version `PATCH /tasks/:id`'s `If-Match` compares, so
 * every write that changes what a task read shows must move it **strictly**.
 * A bare `now` does not: a write in the same millisecond as a client's read
 * leaves `updated_at` equal to the token that client holds, and its stale
 * PATCH then overwrites the write it never saw.
 */
export function nextTaskVersion(now: number): SQL<number> {
  return sql<number>`max(${now}, ${tasks.updatedAt} + 1)`;
}

/**
 * Advance a task's version for a write that lands outside the task row — its
 * tags or its dependencies — so a precondition taken before it goes stale.
 */
export function touchTask(db: Db, taskId: string, now: number): void {
  db.update(tasks)
    .set({ updatedAt: nextTaskVersion(now) })
    .where(eq(tasks.id, taskId))
    .run();
}
