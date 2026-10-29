import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb, type Db } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, projects, users } from '../../src/db/schema.ts';
import { createDefaultProjectStatuses, statusForCategory } from '../../src/db/project-statuses.ts';
import { type TaskStatus } from '../../src/db/enums.ts';
import { sql } from 'drizzle-orm';

export interface TestDb {
  db: Db;
  sqlite: Database.Database;
  path: string;
  close(): void;
}

/**
 * A real SQLite file with migrations applied (SPEC §13.3, LAI-003 AC9).
 *
 * A file rather than `:memory:` — WAL is not available for in-memory databases,
 * and testing against a journal mode the server never uses would leave the
 * interesting concurrency behaviour untested.
 */
export function freshDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'laika-db-'));
  const path = join(dir, 'laika.db');

  const { db, sqlite } = openDb({ path });
  runMigrations(db);

  return {
    db,
    sqlite,
    path,
    close() {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Seed {
  orgId: string;
  userId: string;
  projectId: string;
}

/** The minimum rows that satisfy the foreign keys of everything interesting. */
export function seed(db: Db, now = Date.now()): Seed {
  const userId = newId();
  const orgId = newId();
  const projectId = newId();

  // **Unless `users` is older than its newest column.** Drizzle names every
  // declared column in an INSERT — `profile_kind` (0029, LAI-743),
  // `local_activity_scope` (0031, LAI-751), `last_seen_at` (0053, LAI-981) —
  // and `migrate.test.ts` seeds databases cut back before them; there, the row
  // is written with the columns every version has, and the migrations give it
  // their defaults.
  if (hasColumn(db, 'users', 'last_seen_at')) {
    db.insert(users)
      .values({
        id: userId,
        email: 'owner@example.test',
        name: 'Owner',
        orgRole: 'owner',
        isActive: 1,
        // users.createdAt/updatedAt are Date-typed since LAI-005 (better-auth
        // hands the adapter Dates); the stored value is still integer unix-ms.
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();
  } else {
    db.run(sql`
      INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
      VALUES (${userId}, 'owner@example.test', 'Owner', 'owner', 1, ${now}, ${now})
    `);
  }

  // The same for `orgs` and 0031's `developer_insights` (LAI-751).
  if (hasColumn(db, 'orgs', 'developer_insights')) {
    db.insert(orgs)
      .values({ id: orgId, name: 'Laika', ownerUserId: userId, createdAt: now, updatedAt: now })
      .run();
  } else {
    db.run(sql`
      INSERT INTO orgs (id, name, owner_user_id, created_at, updated_at)
      VALUES (${orgId}, 'Laika', ${userId}, ${now}, ${now})
    `);
  }

  // The same for `projects`: keyed on its newest column, 0066's
  // `context_revision` (LAI-555), since a whole-row insert names every column
  // the schema has — 0051's space settings (LAI-976) included.
  if (hasColumn(db, 'projects', 'context_revision')) {
    db.insert(projects)
      .values({
        id: projectId,
        orgId,
        name: 'Laika',
        slug: 'laika',
        prefix: 'LAI',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } else {
    db.run(sql`
      INSERT INTO projects (id, org_id, name, slug, prefix, created_at, updated_at)
      VALUES (${projectId}, ${orgId}, 'Laika', 'laika', 'LAI', ${now}, ${now})
    `);
  }

  // This helper inserts the project row directly rather than going through
  // `createProject`, so it has to seed the statuses itself (LAI-738). Without
  // them no task could be created — `tasks.status_id` is NOT NULL — and the
  // suite would be testing a project the production code cannot produce.
  //
  // **Unless the table is not there yet.** `migrate.test.ts` seeds a database
  // cut back to an older migration and then migrates it forward; at that point
  // a project has no statuses because nothing had them, and 0028 gives it the
  // defaults. Seeding here would be a table that does not exist.
  if (hasTable(db, 'project_statuses')) createDefaultProjectStatuses(db, projectId, now);

  return { orgId, userId, projectId };
}

/**
 * `{ status, statusId }` for a raw `UPDATE tasks` that puts a task in a
 * category (LAI-738).
 *
 * A test that writes `status` alone is refused by `tasks_status_fk` — the
 * category and the status must agree, which is the point of the key — so the
 * two travel together. The status is the one the services would pick.
 */
export function atCategory<S extends TaskStatus>(
  db: Db,
  projectId: string,
  category: S,
): { status: S; statusId: string } {
  return { status: category, statusId: statusForCategory(db, projectId, category).id };
}

function hasColumn(db: Db, table: string, column: string): boolean {
  return db.all(sql`SELECT 1 FROM pragma_table_info(${table}) WHERE name = ${column}`).length > 0;
}

function hasTable(db: Db, name: string): boolean {
  return (
    db.all(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`).length > 0
  );
}

/**
 * The message SQLite actually produced.
 *
 * Drizzle wraps driver errors in "Failed to run the query …" and hangs the real
 * one off `cause`, so asserting on `.message` alone silently passes for *any*
 * failure — including a typo in the SQL. This walks the chain so a test that
 * claims to check a CHECK constraint really does.
 */
export function rootCauseMessage(err: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = err;
  let message = '';

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    message = current.message;
    current = (current as { cause?: unknown }).cause;
  }

  return message;
}

/** Assert that `fn` fails with a SQLite error matching `pattern`. */
export function expectSqliteError(fn: () => unknown, pattern: RegExp): void {
  let thrown: unknown;

  try {
    fn();
  } catch (err) {
    thrown = err;
  }

  if (thrown === undefined) {
    throw new Error(`Expected a SQLite error matching ${String(pattern)}, but nothing was thrown`);
  }

  const message = rootCauseMessage(thrown);
  if (!pattern.test(message)) {
    throw new Error(`Expected a SQLite error matching ${String(pattern)}, got: ${message}`);
  }
}

/**
 * Every SQL statement `run` prepares, captured off the driver (LAI-722).
 *
 * As the code **actually issues it**, not retyped in the test — the reason
 * `dependencies.test.ts` does the same: a hand-written copy keeps passing while
 * the real query does something else.
 */
export function preparedDuring(sqlite: Database.Database, run: () => unknown): string[] {
  const prepared: string[] = [];
  const real = sqlite.prepare.bind(sqlite);
  (sqlite as unknown as { prepare: typeof real }).prepare = (source: string) => {
    prepared.push(source);
    return real(source);
  };

  try {
    run();
  } finally {
    (sqlite as unknown as { prepare: typeof real }).prepare = real;
  }

  return prepared;
}

/**
 * `EXPLAIN QUERY PLAN` for every statement `run` prepares against `table`.
 *
 * Placeholders are bound with dummy values; without `sqlite_stat4` their values
 * cannot change the plan, only their count can.
 */
export function queryPlansOf(
  sqlite: Database.Database,
  table: string,
  run: () => unknown,
): string[] {
  const queries = preparedDuring(sqlite, run).filter((source) =>
    new RegExp(`\\b"?${table}"?\\b`).test(source),
  );
  if (queries.length === 0) throw new Error(`nothing was prepared against ${table}`);

  return queries.map((source) => {
    const bindings = Array.from({ length: (source.match(/\?/g) ?? []).length }, () => 'x');
    return (sqlite.prepare(`EXPLAIN QUERY PLAN ${source}`).all(...bindings) as { detail: string }[])
      .map((row) => row.detail)
      .join('\n');
  });
}
