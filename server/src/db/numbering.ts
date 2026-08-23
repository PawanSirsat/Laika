import { sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { type Db } from './client.ts';
import { tasks } from './schema.ts';

/**
 * Per-project task numbering — the `LAI-42` in every display key (SPEC §4.5).
 *
 * ## Why this is not `MAX(number) + 1`
 *
 * The obvious version reads the maximum, adds one, then inserts. Under WAL,
 * SQLite serialises writers but **readers do not block**, so two concurrent
 * creates both read `41`, both compute `42`, and the second insert either
 * duplicates the number or trips the unique index — on a board where two agents
 * creating tasks at the same moment is the normal case, not the edge case.
 *
 * A deferred transaction does not fix it either: `BEGIN` alone takes no write
 * lock, so the `SELECT MAX` still happens before the lock is acquired, and
 * `busy_timeout` then cheerfully retries the *write* with a stale number.
 *
 * ## What this does instead
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, so the read and the write are
 * inside the same exclusive window and a second writer waits (up to
 * `busy_timeout`) rather than reading stale state. The unique index on
 * `(project_id, number)` is the backstop that turns any remaining mistake into a
 * loud failure instead of two tasks called `LAI-42`.
 *
 * ## Why numbers have no gaps
 *
 * The number is derived from the rows that exist, inside the transaction that
 * inserts the row. If the transaction rolls back, nothing was consumed. A
 * separate counter table would leak a number on every rollback.
 */

/** The next number for a project. Must be called inside an IMMEDIATE transaction. */
export function nextTaskNumber(db: Db, projectId: string): number {
  const row = db
    .select({ next: sql<number>`COALESCE(MAX(${tasks.number}), 0) + 1` })
    .from(tasks)
    .where(sql`${tasks.projectId} = ${projectId}`)
    .get();

  return row?.next ?? 1;
}

/**
 * Run `fn` inside a `BEGIN IMMEDIATE` transaction.
 *
 * better-sqlite3's `db.transaction()` defaults to a deferred `BEGIN`; `.immediate`
 * is what makes the read-then-write above safe. Drizzle's own `db.transaction()`
 * does not expose the mode, so this reaches for the underlying connection — the
 * transaction boundary only, not queries, which still go through Drizzle.
 */
export function immediateTransaction<T>(sqlite: Database.Database, fn: () => T): T {
  return sqlite.transaction(fn).immediate();
}

export interface CreateTaskNumbered {
  projectId: string;
  id: string;
  title: string;
  createdBy: string;
  createdVia: 'web' | 'mcp' | 'api' | 'webhook' | 'meeting';
  descriptionMd?: string | null;
  priority?: 'p1' | 'p2' | 'p3';
  discoveredFrom?: string | null;
  now?: number;
}

/**
 * Insert a task with the next number for its project, atomically.
 *
 * Callers that need to write an `activity` row in the same transaction should use
 * `immediateTransaction` directly and call `nextTaskNumber` inside it — that is
 * LAI-011's job. This helper exists so LAI-003 can prove the numbering property.
 */
export function createTaskWithNumber(
  sqlite: Database.Database,
  db: Db,
  input: CreateTaskNumbered,
): { id: string; number: number } {
  return immediateTransaction(sqlite, () => {
    const number = nextTaskNumber(db, input.projectId);
    const timestamp = input.now ?? Date.now();

    db.insert(tasks)
      .values({
        id: input.id,
        projectId: input.projectId,
        number,
        title: input.title,
        descriptionMd: input.descriptionMd ?? null,
        priority: input.priority ?? 'p2',
        createdBy: input.createdBy,
        createdVia: input.createdVia,
        discoveredFrom: input.discoveredFrom ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    return { id: input.id, number };
  });
}
