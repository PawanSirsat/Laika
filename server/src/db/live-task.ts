import { isNull, type SQL } from 'drizzle-orm';
import { type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { tasks } from './schema.ts';

/**
 * **A task that is still current work** (LAI-1353): not archived.
 *
 * Every read that means "the work there is" — a space's list, the ready
 * queue, a person's load, a sprint's counts, the dashboard — adds this, so
 * an archived task leaves all of them at once and comes back to all of them
 * on restore. A read of **history** (time, activity, estimates, usage) or
 * of one task by its id does not: an archived task keeps everything it did.
 *
 * `server/test/tooling/live-task-census.test.ts` names every file that reads
 * `tasks` and says which of the two it is, so a new reader cannot forget.
 *
 * Takes the table so an alias works: `liveTask(blocker)`.
 */
export function liveTask(table: { archivedAt: AnySQLiteColumn } = tasks): SQL {
  return isNull(table.archivedAt);
}
