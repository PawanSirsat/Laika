import { sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { type Db } from './client.ts';
import { immediateTransaction } from './numbering.ts';
import { taskDependencies } from './schema.ts';

/**
 * Task dependency writes (SPEC §4.6): the pair is unique, self-reference is
 * refused, and cycles are rejected at write time.
 *
 * `discovered_from` is a *different* relationship — provenance on `tasks`, not a
 * dependency — so a discovered task never blocks on its parent.
 */

export class DependencyError extends Error {
  readonly reason: 'self' | 'cycle' | 'duplicate';

  constructor(reason: 'self' | 'cycle' | 'duplicate', message: string) {
    super(message);
    this.name = 'DependencyError';
    this.reason = reason;
  }
}

/**
 * Does `from` already reach `to` by following `depends_on` edges?
 *
 * A recursive CTE rather than a walk in TypeScript: the alternative is one query
 * per level, which turns a deep graph into a query storm. This is raw SQL through
 * Drizzle's `sql` template, inside the db layer — never in a route handler
 * (CLAUDE.md §5).
 */
export function dependsOnTransitively(db: Db, from: string, to: string): boolean {
  const rows = db.all<{ reached: string }>(sql`
    WITH RECURSIVE reachable(reached) AS (
      SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ${from}
      UNION
      SELECT d.depends_on_task_id
        FROM task_dependencies d
        JOIN reachable r ON d.task_id = r.reached
    )
    SELECT reached FROM reachable WHERE reached = ${to} LIMIT 1
  `);

  return rows.length > 0;
}

/**
 * Add `task depends on dependsOn`, refusing self-reference, duplicates and cycles.
 *
 * The check and the insert share one `BEGIN IMMEDIATE` transaction. Without that,
 * two concurrent writers each see an acyclic graph and together create a cycle —
 * the check would be honest and the result still wrong.
 */
export function addDependency(
  sqlite: Database.Database,
  db: Db,
  taskId: string,
  dependsOnTaskId: string,
  now: number = Date.now(),
): void {
  if (taskId === dependsOnTaskId) {
    throw new DependencyError('self', 'A task cannot depend on itself');
  }

  immediateTransaction(sqlite, () => {
    // A cycle is exactly "the thing I am about to depend on already depends on
    // me", transitively.
    if (dependsOnTransitively(db, dependsOnTaskId, taskId)) {
      throw new DependencyError(
        'cycle',
        `Adding this dependency would create a cycle: ${dependsOnTaskId} already depends on ${taskId}`,
      );
    }

    try {
      db.insert(taskDependencies).values({ taskId, dependsOnTaskId, createdAt: now }).run();
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new DependencyError('duplicate', 'That dependency already exists');
      }
      throw err;
    }
  });
}

/** Ids this task directly depends on. */
export function directDependencies(db: Db, taskId: string): string[] {
  return db
    .all<{ depends_on_task_id: string }>(
      sql`SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ${taskId} ORDER BY depends_on_task_id`,
    )
    .map((r) => r.depends_on_task_id);
}
