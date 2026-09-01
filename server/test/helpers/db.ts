import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb, type Db } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { newId } from '../../src/db/ids.ts';
import { orgs, projects, users } from '../../src/db/schema.ts';

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

  db.insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: userId, createdAt: now, updatedAt: now })
    .run();

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

  return { orgId, userId, projectId };
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
