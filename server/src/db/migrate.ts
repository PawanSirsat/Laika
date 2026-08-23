import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { type Db } from './client.ts';

/**
 * Generated migrations live beside this module and are resolved from
 * `import.meta.url`, never from `process.cwd()` — the server is started from a
 * different directory in dev, in test and in the container.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('migrations', import.meta.url));

/**
 * Apply every pending migration, forward-only (SPEC §11.3).
 *
 * Runs at boot rather than as a deploy step: Laika is one container with one
 * volume (D-002), so there is no separate place for a migration job to live, and
 * a server that starts against an unmigrated database is worse than one that
 * takes a moment longer to start.
 */
export function runMigrations(db: Db, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
}
