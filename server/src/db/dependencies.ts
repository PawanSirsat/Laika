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

/**
 * Both directions of the dependency graph for a whole page of tasks, in **one**
 * query (SPEC §4.6, §4.13 — LAI-091).
 *
 * ## Why both directions, and why they must stay apart
 *
 * `task_dependencies(task_id, depends_on_task_id)` is read forwards to answer
 * *"what blocks me"* and backwards to answer *"what am I holding up"*. §4.13
 * requires an index on `depends_on_task_id` whose **only** purpose is that
 * reverse lookup, and until now nothing performed it. The two answers mean
 * opposite things: merging them would make a task that blocks three others look
 * blocked by three others, which is worse than showing neither.
 *
 * ## Why `UNION ALL` rather than one `WHERE … OR …`
 *
 * Both plan identically — SQLite uses `MULTI-INDEX OR` and reaches the same two
 * indexes, confirmed by `EXPLAIN QUERY PLAN` in the tests. The difference is
 * correctness at the caller: with `OR`, an edge whose **both** endpoints are on
 * the page comes back as a single row that has to be classified twice, and
 * working out which side matched is re-deriving in TypeScript what SQL already
 * knew. `UNION ALL` emits that edge once per direction and labels it, so the
 * caller cannot get it wrong.
 */
export interface DependencyEdges {
  /** Task id → the ids it depends on. Sorted, so a view is stable. */
  readonly blockedBy: ReadonlyMap<string, string[]>;
  /** Task id → the ids that depend on **it**. The §4.13 reverse read. */
  readonly blocks: ReadonlyMap<string, string[]>;
}

export function dependencyEdges(db: Db, taskIds: readonly string[]): DependencyEdges {
  const blockedBy = new Map<string, string[]>();
  const blocks = new Map<string, string[]>();

  for (const id of taskIds) {
    blockedBy.set(id, []);
    blocks.set(id, []);
  }

  if (taskIds.length === 0) return { blockedBy, blocks };

  const ids = sql.join(
    taskIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const rows = db.all<{ owner: string; other: string; reverse: number }>(
    sql`SELECT task_id AS owner, depends_on_task_id AS other, 0 AS reverse
          FROM task_dependencies WHERE task_id IN (${ids})
        UNION ALL
        SELECT depends_on_task_id AS owner, task_id AS other, 1 AS reverse
          FROM task_dependencies WHERE depends_on_task_id IN (${ids})`,
  );

  for (const row of rows) {
    (row.reverse === 1 ? blocks : blockedBy).get(row.owner)?.push(row.other);
  }

  for (const list of [...blockedBy.values(), ...blocks.values()]) list.sort();

  return { blockedBy, blocks };
}

/** Ids this task directly depends on. */
export function directDependencies(db: Db, taskId: string): string[] {
  return db
    .all<{ depends_on_task_id: string }>(
      sql`SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ${taskId} ORDER BY depends_on_task_id`,
    )
    .map((r) => r.depends_on_task_id);
}
