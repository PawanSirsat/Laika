import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDbResult {
  db: Db;
  sqlite: Database.Database;
}

/**
 * PRAGMAs from SPEC §11.3, applied before anything else touches the connection.
 *
 * These are the one sanctioned exception to "no raw SQL" (§11.3) — Drizzle has no
 * API for them, and they must run on the raw connection at open time.
 *
 *  - `journal_mode=WAL` lets readers run while a writer holds the lock, which is
 *    what makes a single-process server with an SSE stream and cron jobs viable.
 *  - `foreign_keys=ON` is **off by default in SQLite**; without it every
 *    `references()` in the schema is documentation rather than a constraint.
 *  - `busy_timeout=5000` makes a concurrent writer wait rather than fail
 *    immediately with SQLITE_BUSY.
 *  - `synchronous=NORMAL` is the standard WAL pairing: durable across process
 *    crashes, and only at risk of losing the last commits on power loss.
 */
function applyPragmas(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
}

export interface OpenDbOptions {
  /** `:memory:` for tests; a filesystem path otherwise. */
  path: string;
  /** Create the containing directory if it does not exist. */
  createDir?: boolean;
}

export function openDb(options: OpenDbOptions): OpenDbResult {
  if (options.createDir !== false && options.path !== ':memory:') {
    mkdirSync(dirname(options.path), { recursive: true });
  }

  const sqlite = new Database(options.path);
  applyPragmas(sqlite);

  return { db: drizzle(sqlite, { schema }), sqlite };
}

/** What the PRAGMAs actually resolved to — asserted by tests, not assumed. */
export function readPragmas(sqlite: Database.Database): Record<string, unknown> {
  return {
    journal_mode: sqlite.pragma('journal_mode', { simple: true }),
    foreign_keys: sqlite.pragma('foreign_keys', { simple: true }),
    busy_timeout: sqlite.pragma('busy_timeout', { simple: true }),
    synchronous: sqlite.pragma('synchronous', { simple: true }),
  };
}
