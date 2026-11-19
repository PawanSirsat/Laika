import { and, isNull, type SQL, sql } from 'drizzle-orm';
import { type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { tasks } from './schema.ts';

/**
 * **A task that is still current work** (LAI-1353, LAI-1354): neither
 * archived nor in the space's Trash.
 *
 * Every read that means "the work there is" — a space's list, the ready
 * queue, a person's load, a sprint's counts, the dashboard — adds this, so
 * an archived or deleted task leaves all of them at once and comes back to
 * all of them on restore. A read of **history** (time, activity, estimates,
 * usage) or of one task by its id does not: it keeps everything it did.
 *
 * `server/test/tooling/live-task-census.test.ts` names every file that reads
 * `tasks` and says which of the two it is, so a new reader cannot forget.
 *
 * Takes the table so an alias works: `liveTask(blocker)`.
 */
export function liveTask(
  table: { archivedAt: AnySQLiteColumn; deletedAt: AnySQLiteColumn } = tasks,
): SQL {
  return and(isNull(table.archivedAt), isNull(table.deletedAt))!;
}

/**
 * The same condition for a raw-SQL read, on the alias it names
 * (`liveTaskSql('t')` → `t.archived_at IS NULL AND t.deleted_at IS NULL`).
 * One place, so a raw read cannot learn half of it.
 */
export function liveTaskSql(alias: string): SQL {
  if (!/^[a-z_]+$/.test(alias)) throw new Error(`not an alias: ${alias}`);
  return sql.raw(`${alias}.archived_at IS NULL AND ${alias}.deleted_at IS NULL`);
}
