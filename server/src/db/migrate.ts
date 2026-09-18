import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { backfillTaskTimestamps } from './backfill.ts';
import { type Db } from './client.ts';

/**
 * Generated migrations live beside this module and are resolved from
 * `import.meta.url`, never from `process.cwd()` — the server is started from a
 * different directory in dev, in test and in the container.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('migrations', import.meta.url));

/**
 * `activity` is append-only (SPEC §4.8), and two triggers are what make that
 * true rather than merely intended.
 *
 * ## Why this is not left to the migrations
 *
 * SQLite drops a table's triggers **with the table**, and `drizzle-kit`
 * implements any change to `activity` as a rebuild: create the new shape, copy
 * the rows, drop the old table, rename. It does not know these triggers exist,
 * so it does not recreate them. Every vocabulary growth so far — 0003, 0004,
 * 0005, 0008 — has therefore carried a hand-pasted copy of the block below, and
 * has needed one for the guarantee to survive that migration.
 *
 * Four for four is not reassuring. LAI-044's behavioural test caught the
 * omission each time, which is the only reason it never shipped, but a
 * guarantee that depends on remembering to paste twenty lines is one distracted
 * afternoon from being gone — and the failure is silent, because a table
 * without these triggers behaves exactly like one with them until somebody
 * writes the `UPDATE` they were there to stop.
 *
 * ## Why `IF NOT EXISTS` inside a migration would not have fixed it
 *
 * It reads like the answer and it is not. After a rebuild the trigger genuinely
 * does not exist, so `IF NOT EXISTS` creates it — but only in a migration that
 * someone remembered to put it in, which is the thing being forgotten. And a
 * migration runs **once**: it cannot re-establish anything on a database that
 * was rebuilt by some later migration. The guard is a no-op in exactly the case
 * that matters.
 *
 * So the mechanism is not a guard, it is the **unconditional** step below,
 * running after every boot's migration pass. `IF NOT EXISTS` appears in the SQL
 * only so re-running it is free.
 *
 * ## Why not enforce it in application code instead
 *
 * `db/activity.ts` already exposes no mutation path, so a code-level check would
 * only restate what the module shape says. The triggers exist precisely for the
 * code that *bypasses* that module — a future service importing the table
 * directly, or a `DELETE` typed into a SQLite shell against the volume. Moving
 * the guarantee into TypeScript would trade a real one for a convention.
 */
const APPEND_ONLY_TRIGGERS = [
  {
    name: 'activity_is_append_only_no_update',
    /** The clause that does the work. A trigger without it enforces nothing. */
    aborts: 'UPDATE is not permitted',
    create: `CREATE TRIGGER IF NOT EXISTS \`activity_is_append_only_no_update\`
BEFORE UPDATE ON \`activity\`
BEGIN
  SELECT RAISE(ABORT, 'activity is append-only: UPDATE is not permitted (SPEC 4.8)');
END`,
  },
  {
    name: 'activity_is_append_only_no_delete',
    aborts: 'DELETE is not permitted',
    create: `CREATE TRIGGER IF NOT EXISTS \`activity_is_append_only_no_delete\`
BEFORE DELETE ON \`activity\`
BEGIN
  SELECT RAISE(ABORT, 'activity is append-only: DELETE is not permitted (SPEC 4.8)');
END`,
  },
] as const;

/**
 * Put §4.8's append-only triggers back if a migration rebuilt them away, and
 * refuse to continue if what is there does not actually enforce anything.
 *
 * Idempotent: on an already-correct database both statements are no-ops and
 * nothing is rewritten — no drop, no recreate, so a boot does not churn
 * `sqlite_master` and the triggers keep their identity.
 *
 * ## Why the check is about the body and not about the name
 *
 * `IF NOT EXISTS` only asks whether *something* holds the name. A trigger that
 * exists with the wrong body satisfies it and is never replaced — and that is a
 * reachable state, not a hypothetical one: the block has been hand-pasted into
 * four migrations, and a paste that lost its `RAISE` would create a trigger that
 * is present, correctly named, and enforces nothing. A name check would call
 * that healthy.
 *
 * So the post-condition reads each trigger's stored SQL and looks for the clause
 * that does the work.
 *
 * ## Why it throws rather than repairing
 *
 * A missing trigger is an accident of how SQLite rebuilds tables, and creating
 * it is the fix. A **wrong** one is a mistake in a migration, and silently
 * rewriting a database object at boot would hide the mistake while leaving the
 * migration that caused it in the tree, to be applied again on the next clean
 * install. Refusing to start is the same posture as the missing case and for the
 * same reason: everything this function exists to prevent is silent, so the one
 * outcome it must not have is failing quietly. A server running without §4.8 is
 * worse than a server that does not run.
 */
export function ensureActivityTriggers(db: Db): void {
  for (const trigger of APPEND_ONLY_TRIGGERS) db.run(sql.raw(trigger.create));

  const bodies = new Map(
    db
      .all<{ name: string; sql: string | null }>(
        sql`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'activity'`,
      )
      .map((row) => [row.name, row.sql ?? '']),
  );

  const broken = APPEND_ONLY_TRIGGERS.filter(
    (trigger) => !(bodies.get(trigger.name) ?? '').includes(trigger.aborts),
  ).map((trigger) =>
    bodies.has(trigger.name) ? `${trigger.name} (present but does not abort)` : trigger.name,
  );

  if (broken.length > 0) {
    throw new Error(
      `activity is append-only (SPEC §4.8) and its triggers are not enforcing it: ${broken.join(', ')}. Refusing to start without the guarantee.`,
    );
  }
}

/**
 * Apply every pending migration, forward-only (SPEC §11.3), then re-establish
 * the invariants migrations cannot express.
 *
 * Runs at boot rather than as a deploy step: Laika is one container with one
 * volume (D-002), so there is no separate place for a migration job to live, and
 * a server that starts against an unmigrated database is worse than one that
 * takes a moment longer to start.
 *
 * The trigger step runs **after** the pending migrations and on every boot, not
 * only when something was applied — see `ensureActivityTriggers` for why the
 * unconditional part is the whole mechanism.
 */
/**
 * A pre-upgrade copy, kept out of the nightly fourteen (LAI-468).
 *
 * **A different prefix from `laika-`, and that is the whole mechanism.**
 * `pruneBackups` keeps §11.6's fourteen by filename among files it recognises;
 * a pre-upgrade copy it could delete is precisely the one you wanted. The
 * prefixes do not overlap, so the nightly prune cannot reach these — and a test
 * asserts that rather than leaving it to the reader to notice.
 */
export const PRE_MIGRATION_PREFIX = 'pre-migration-';

/** `pre-migration-2026-09-10T01-30-00-000Z.sqlite` — sorts, and reads as itself. */
export function preMigrationFilename(now: number): string {
  return `${PRE_MIGRATION_PREFIX}${new Date(now).toISOString().replace(/[:.]/g, '-')}.sqlite`;
}

/**
 * Which migrations this database has not applied yet.
 *
 * Drizzle decides by timestamp: it records each applied migration's `when` from
 * the journal as `created_at`, and applies every entry newer than the newest
 * row. **This asks the same question the migrator will ask**, rather than a
 * second one that could disagree with it — a snapshot taken because *this*
 * thinks there is work, when the migrator disagrees, is a file written on every
 * boot for ever.
 *
 * Returns tags rather than a count so a failure can name them.
 */
export function pendingMigrations(
  sqlite: Database.Database,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): string[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries?: { when?: number; tag?: string }[] };

  const entries = journal.entries ?? [];

  // The table does not exist before the first migration, and then everything is
  // pending — which is the correct answer for a database that has never run one.
  const present = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('__drizzle_migrations');
  if (present === undefined) return entries.map((e) => e.tag ?? '(untagged)');

  const last = sqlite.prepare('SELECT MAX(created_at) AS at FROM "__drizzle_migrations"').get() as
    { at: number | null } | undefined;
  const applied = last?.at ?? 0;

  return entries.filter((e) => (e.when ?? 0) > applied).map((e) => e.tag ?? '(untagged)');
}

/**
 * Copy the database, synchronously, before anything changes its shape.
 *
 * **`VACUUM INTO` rather than `Database.backup()`**, which is what the nightly
 * job uses. That one is SQLite's *online* backup: asynchronous, and built to
 * copy a database while other connections write to it. Neither property is
 * wanted here. At this point in boot we are the only connection and the port is
 * not bound, so there is nothing to avoid blocking — and `runMigrations` is
 * called synchronously by `index.ts` before anything is awaited. Making the
 * whole boot path async to reach an online backup, for a copy taken while
 * nothing is online, is the wrong trade.
 *
 * `VACUUM INTO` writes one consistent file with no `-wal` or `-shm` beside it,
 * which is the shape LAI-466's restore drill proves is restorable.
 */
export function snapshotBeforeMigrations(
  sqlite: Database.Database,
  dir: string,
  now: number,
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, preMigrationFilename(now));

  // `VACUUM INTO` takes a string literal, not a bound parameter. The path is
  // ours — derived from the configured database path — but the doubling is
  // still here, because a directory with an apostrophe in it is a legal
  // directory and a silent truncation would be a very confusing bug.
  sqlite.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);

  return path;
}

export interface RunMigrationsOptions {
  migrationsFolder?: string;
  /**
   * Take a snapshot first. Absent in tests that do not care, and **present on
   * the boot path**, which is the one that matters — see `index.ts`.
   */
  backup?: { sqlite: Database.Database; dir: string; now?: number };
}

/**
 * Migrate, and copy the database first if there is anything to migrate.
 *
 * ## Why a snapshot here and not only nightly
 *
 * §11.6's job runs on a schedule. **The riskiest moment in a self-hosted
 * product's life is the first boot after an upgrade**, and until LAI-468 it was
 * the one moment with no fresh copy behind it — a nightly snapshot can be
 * twenty-three hours old when the schema changes.
 *
 * **SQLite's DDL is transactional, so a single failed statement rolls back** —
 * which is why this is worth doing carefully rather than assuming it is
 * covered. `migrate()` applies files **in sequence**: three of five succeeding
 * and the fourth failing leaves a database that is neither version, and no
 * transaction spans the sequence. The snapshot is for that case.
 *
 * ## Only when there is work
 *
 * A snapshot on every restart would write a file per boot and, if it shared the
 * nightly prefix, push §11.6's fourteen real ones out within a day of
 * crash-looping. So it is taken only when `pendingMigrations` is non-empty, and
 * a test asserts both directions.
 */
export function runMigrations(db: Db, options: RunMigrationsOptions = {}): void {
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
  const backup = options.backup;

  let snapshotPath: string | null = null;
  if (backup !== undefined) {
    const pending = pendingMigrations(backup.sqlite, migrationsFolder);
    if (pending.length > 0) {
      snapshotPath = snapshotBeforeMigrations(backup.sqlite, backup.dir, backup.now ?? Date.now());
    }
  }

  try {
    migrate(db, { migrationsFolder });
    ensureActivityTriggers(db);

    // Recovers `started_at` / `completed_at` from the audit trail for tasks that
    // moved before LAI-126 began stamping them. Here rather than in a `.sql`
    // migration because it reads `payload_json`, whose format `db/activity.ts`
    // owns — see `backfill.ts`. Idempotent by construction: it only fills a null.
    //
    // **Inside the protected window deliberately.** It is not a `.sql` migration
    // and it does write, and "idempotent by construction" is a property of
    // today's implementation rather than of the step.
    backfillTaskTimestamps(db);
  } catch (cause) {
    if (snapshotPath === null) throw cause;

    // **The path goes in the error.** The operator is reading a crash log at
    // this moment, not listing a backup directory — and a snapshot they do not
    // know about is one they will not use.
    throw new Error(
      `Migration failed. The database as it was before this boot is at ${snapshotPath} ` +
        `— restore that file before retrying (see the restore drill in docs).`,
      { cause },
    );
  }
}
