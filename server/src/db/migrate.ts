import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  backfillTaskPositions,
  backfillTaskTimestamps,
  purgeUnversionedIdempotencyKeys,
} from './backfill.ts';
import { type Db } from './client.ts';
import { deviceLabelKey } from './device-label.ts';
import { newId } from './ids.ts';
import { type Logger } from '../log.ts';

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
    table: 'activity',
    create: `CREATE TRIGGER IF NOT EXISTS \`activity_is_append_only_no_update\`
BEFORE UPDATE ON \`activity\`
BEGIN
  SELECT RAISE(ABORT, 'activity is append-only: UPDATE is not permitted (SPEC 4.8)');
END`,
  },
  {
    name: 'activity_is_append_only_no_delete',
    table: 'activity',
    create: `CREATE TRIGGER IF NOT EXISTS \`activity_is_append_only_no_delete\`
BEFORE DELETE ON \`activity\`
BEGIN
  SELECT RAISE(ABORT, 'activity is append-only: DELETE is not permitted (SPEC 4.8)');
END`,
  },
  // §4.21's ratings are append-only for `activity`'s reason, and lose their
  // triggers to a rebuild the same way, so they ride the same step (LAI-743).
  {
    name: 'member_ratings_is_append_only_no_update',
    table: 'member_ratings',
    create: `CREATE TRIGGER IF NOT EXISTS \`member_ratings_is_append_only_no_update\`
BEFORE UPDATE ON \`member_ratings\`
BEGIN
  SELECT RAISE(ABORT, 'member_ratings is append-only: UPDATE is not permitted (SPEC 4.21)');
END`,
  },
  {
    name: 'member_ratings_is_append_only_no_delete',
    table: 'member_ratings',
    create: `CREATE TRIGGER IF NOT EXISTS \`member_ratings_is_append_only_no_delete\`
BEFORE DELETE ON \`member_ratings\`
BEGIN
  SELECT RAISE(ABORT, 'member_ratings is append-only: DELETE is not permitted (SPEC 4.21)');
END`,
  },
  // `INSERT OR REPLACE` is a delete the two above never see: SQLite fires no
  // `BEFORE DELETE` for a replace while `recursive_triggers` is off (LAI-746).
  {
    name: 'member_ratings_is_append_only_no_replace',
    table: 'member_ratings',
    create: `CREATE TRIGGER IF NOT EXISTS \`member_ratings_is_append_only_no_replace\`
BEFORE INSERT ON \`member_ratings\`
WHEN EXISTS (SELECT 1 FROM \`member_ratings\` WHERE \`id\` = NEW.\`id\`)
BEGIN
  SELECT RAISE(ABORT, 'member_ratings is append-only: INSERT OR REPLACE is not permitted (SPEC 4.21)');
END`,
  },
  // §4.32's estimates are history the same way (D-085, LAI-771): the
  // estimate in force when work started is what every accuracy figure is
  // measured against, so it must not be edited, removed or replaced.
  {
    name: 'task_estimates_is_append_only_no_update',
    table: 'task_estimates',
    create: `CREATE TRIGGER IF NOT EXISTS \`task_estimates_is_append_only_no_update\`
BEFORE UPDATE ON \`task_estimates\`
BEGIN
  SELECT RAISE(ABORT, 'task_estimates is append-only: UPDATE is not permitted (SPEC 4.32)');
END`,
  },
  {
    name: 'task_estimates_is_append_only_no_delete',
    table: 'task_estimates',
    create: `CREATE TRIGGER IF NOT EXISTS \`task_estimates_is_append_only_no_delete\`
BEFORE DELETE ON \`task_estimates\`
BEGIN
  SELECT RAISE(ABORT, 'task_estimates is append-only: DELETE is not permitted (SPEC 4.32)');
END`,
  },
  {
    name: 'task_estimates_is_append_only_no_replace',
    table: 'task_estimates',
    create: `CREATE TRIGGER IF NOT EXISTS \`task_estimates_is_append_only_no_replace\`
BEFORE INSERT ON \`task_estimates\`
WHEN EXISTS (SELECT 1 FROM \`task_estimates\` WHERE \`id\` = NEW.\`id\`)
BEGIN
  SELECT RAISE(ABORT, 'task_estimates is append-only: INSERT OR REPLACE is not permitted (SPEC 4.32)');
END`,
  },
  // §4.34's claim estimates are what was said, kept to score against what
  // happened (D-085 item 4, LAI-772): the same three triggers.
  {
    name: 'task_claim_estimates_is_append_only_no_update',
    table: 'task_claim_estimates',
    create: `CREATE TRIGGER IF NOT EXISTS \`task_claim_estimates_is_append_only_no_update\`
BEFORE UPDATE ON \`task_claim_estimates\`
BEGIN
  SELECT RAISE(ABORT, 'task_claim_estimates is append-only: UPDATE is not permitted (SPEC 4.34)');
END`,
  },
  {
    name: 'task_claim_estimates_is_append_only_no_delete',
    table: 'task_claim_estimates',
    create: `CREATE TRIGGER IF NOT EXISTS \`task_claim_estimates_is_append_only_no_delete\`
BEFORE DELETE ON \`task_claim_estimates\`
BEGIN
  SELECT RAISE(ABORT, 'task_claim_estimates is append-only: DELETE is not permitted (SPEC 4.34)');
END`,
  },
  {
    name: 'task_claim_estimates_is_append_only_no_replace',
    table: 'task_claim_estimates',
    create: `CREATE TRIGGER IF NOT EXISTS \`task_claim_estimates_is_append_only_no_replace\`
BEFORE INSERT ON \`task_claim_estimates\`
WHEN EXISTS (SELECT 1 FROM \`task_claim_estimates\` WHERE \`id\` = NEW.\`id\`)
BEGIN
  SELECT RAISE(ABORT, 'task_claim_estimates is append-only: INSERT OR REPLACE is not permitted (SPEC 4.34)');
END`,
  },
  // §4.49's revisions are a time entry's history (D-088 item 6, LAI-787): the
  // same three, except that a revision goes with its entry — the delete is
  // refused only while the entry still exists, so retention's cascade passes.
  {
    name: 'time_entry_revisions_is_append_only_no_update',
    table: 'time_entry_revisions',
    create: `CREATE TRIGGER IF NOT EXISTS \`time_entry_revisions_is_append_only_no_update\`
BEFORE UPDATE ON \`time_entry_revisions\`
BEGIN
  SELECT RAISE(ABORT, 'time_entry_revisions is append-only: UPDATE is not permitted (SPEC 4.49)');
END`,
  },
  {
    name: 'time_entry_revisions_is_append_only_no_delete',
    table: 'time_entry_revisions',
    create: `CREATE TRIGGER IF NOT EXISTS \`time_entry_revisions_is_append_only_no_delete\`
BEFORE DELETE ON \`time_entry_revisions\`
WHEN EXISTS (SELECT 1 FROM \`time_entries\` WHERE \`id\` = OLD.\`entry_id\`)
BEGIN
  SELECT RAISE(ABORT, 'time_entry_revisions is append-only: DELETE is not permitted while its entry exists (SPEC 4.49)');
END`,
  },
  {
    name: 'time_entry_revisions_is_append_only_no_replace',
    table: 'time_entry_revisions',
    create: `CREATE TRIGGER IF NOT EXISTS \`time_entry_revisions_is_append_only_no_replace\`
BEFORE INSERT ON \`time_entry_revisions\`
WHEN EXISTS (SELECT 1 FROM \`time_entry_revisions\` WHERE \`id\` = NEW.\`id\`)
BEGIN
  SELECT RAISE(ABORT, 'time_entry_revisions is append-only: INSERT OR REPLACE is not permitted (SPEC 4.49)');
END`,
  },
  // §4.68's context revisions are a project brief's history (LAI-555): the
  // same three as §4.49's — a revision goes with its project, so the delete
  // is refused only while the project still exists.
  {
    name: 'project_context_revisions_is_append_only_no_update',
    table: 'project_context_revisions',
    create: `CREATE TRIGGER IF NOT EXISTS \`project_context_revisions_is_append_only_no_update\`
BEFORE UPDATE ON \`project_context_revisions\`
BEGIN
  SELECT RAISE(ABORT, 'project_context_revisions is append-only: UPDATE is not permitted (SPEC 4.68)');
END`,
  },
  {
    name: 'project_context_revisions_is_append_only_no_delete',
    table: 'project_context_revisions',
    create: `CREATE TRIGGER IF NOT EXISTS \`project_context_revisions_is_append_only_no_delete\`
BEFORE DELETE ON \`project_context_revisions\`
WHEN EXISTS (SELECT 1 FROM \`projects\` WHERE \`id\` = OLD.\`project_id\`)
BEGIN
  SELECT RAISE(ABORT, 'project_context_revisions is append-only: DELETE is not permitted while its project exists (SPEC 4.68)');
END`,
  },
  {
    name: 'project_context_revisions_is_append_only_no_replace',
    table: 'project_context_revisions',
    create: `CREATE TRIGGER IF NOT EXISTS \`project_context_revisions_is_append_only_no_replace\`
BEFORE INSERT ON \`project_context_revisions\`
WHEN EXISTS (SELECT 1 FROM \`project_context_revisions\` WHERE \`id\` = NEW.\`id\`)
BEGIN
  SELECT RAISE(ABORT, 'project_context_revisions is append-only: INSERT OR REPLACE is not permitted (SPEC 4.68)');
END`,
  },
  // §4.48's entries are kept three years (D-088 item 11, BCEA s31): nothing
  // deletes one younger — a person's delete is `deleted_at` and a revision —
  // and only §11.6's retention removes an older one, its revisions with it.
  {
    name: 'time_entries_kept_three_years',
    table: 'time_entries',
    create: `CREATE TRIGGER IF NOT EXISTS \`time_entries_kept_three_years\`
BEFORE DELETE ON \`time_entries\`
WHEN OLD.\`day\` >= date('now', '-3 years')
BEGIN
  SELECT RAISE(ABORT, 'time_entries are kept three years: DELETE is not permitted before then (SPEC 4.48)');
END`,
  },
  // A delete trigger cannot see `INSERT OR REPLACE` (LAI-746's hole): with
  // `recursive_triggers` off the row a replace removes fires none, and the
  // cascade then takes its revisions. An entry is replaced by its id or by
  // its unique `(user_id, source, source_ref)`, so both are refused (LAI-787
  // review B2). Retention deletes; nothing replaces.
  {
    name: 'time_entries_no_replace',
    table: 'time_entries',
    create: `CREATE TRIGGER IF NOT EXISTS \`time_entries_no_replace\`
BEFORE INSERT ON \`time_entries\`
WHEN EXISTS (SELECT 1 FROM \`time_entries\` WHERE \`id\` = NEW.\`id\` OR (NEW.\`source_ref\` IS NOT NULL AND \`user_id\` = NEW.\`user_id\` AND \`source\` = NEW.\`source\` AND \`source_ref\` = NEW.\`source_ref\`))
BEGIN
  SELECT RAISE(ABORT, 'time_entries are kept three years: INSERT OR REPLACE is not permitted (SPEC 4.48)');
END`,
  },
] as const;

/**
 * Put §4.8's append-only triggers back if a migration rebuilt them away, and
 * refuse to continue if what is there does not actually enforce anything.
 *
 * **§4.21's `member_ratings` too, since LAI-743, §4.32's `task_estimates`
 * since LAI-771, §4.34's `task_claim_estimates` since LAI-772, and §4.48–§4.49's
 * time entries and their revisions since LAI-787** — the name
 * stayed, because the mechanism is the same one and a rename would touch every
 * caller for no change in behaviour.
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
 * So the post-condition reads each trigger's stored SQL and compares the
 * **whole definition** with the one `create` writes — table, timing, `WHEN`,
 * body, `RAISE(ABORT, …)` — after normalising only what does not change
 * meaning: quoting, whitespace, case, `IF NOT EXISTS`, a trailing `;`.
 *
 * **Not a search for the message, which it was until LAI-749.** The review
 * replaced the replace trigger with one that kept the message text inside a
 * `WHEN 0` that never fires; the substring was there, the check passed, and an
 * `INSERT OR REPLACE` rewrote a rating 5 → 1. A message is not a definition.
 * Every trigger any migration has written normalises to exactly its `create`
 * (checked when this changed), so the stricter check refuses only a trigger
 * nothing here wrote.
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
  // **A table no migration has created yet has nothing to protect.**
  // `member_ratings` arrives in 0029, and a database migrated only part of the
  // way — which `migrate.test.ts` builds on purpose — has no table to put a
  // trigger on. `activity` has existed since 0000, so it is never skipped and
  // its absence still refuses to start.
  const triggers = APPEND_ONLY_TRIGGERS.filter(
    (trigger) => trigger.table === 'activity' || tableExists(db, trigger.table),
  );

  for (const trigger of triggers) db.run(sql.raw(trigger.create));

  const bodies = new Map(
    db
      .all<{ name: string; sql: string | null }>(
        sql`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('activity', 'member_ratings', 'task_estimates', 'task_claim_estimates', 'time_entry_revisions', 'time_entries')`,
      )
      .map((row) => [row.name, row.sql ?? '']),
  );

  const broken = triggers
    .filter(
      (trigger) =>
        normaliseTrigger(bodies.get(trigger.name) ?? '') !== normaliseTrigger(trigger.create),
    )
    .map((trigger) =>
      bodies.has(trigger.name)
        ? `${trigger.name} (present, but its stored definition differs from the one this step creates — it may not abort as §4.8 needs)`
        : trigger.name,
    );

  if (broken.length > 0) {
    throw new Error(
      `activity (SPEC §4.8), member_ratings (§4.21), task_estimates (§4.32), task_claim_estimates (§4.34) and time_entry_revisions (§4.49) are append-only, and time_entries (§4.48) are kept three years and never replaced; their triggers are not enforcing it: ${broken.join(', ')}. Refusing to start without the guarantee.`,
    );
  }
}

/**
 * A trigger's definition with quoting, whitespace, case, `IF NOT EXISTS` and a
 * trailing `;` removed, for comparing with the one this step creates.
 *
 * **A comparison, not a proof of equivalence.** It strips every quote and
 * every space — inside string literals too — so two definitions that differ
 * only there normalise equal: a message with an escaped quote, or with its
 * spacing changed, passes as the same trigger. What it does catch is any other
 * difference — table, timing, `WHEN`, body — and a stored trigger it calls
 * different is refused, never trusted (LAI-749, reworded by LAI-751).
 */
function normaliseTrigger(text: string): string {
  return text
    .replace(/\bif\s+not\s+exists\b/gi, '')
    .replace(/[`"]/g, '')
    .replace(/;\s*$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function tableExists(db: Db, name: string): boolean {
  return (
    db.all(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`).length > 0
  );
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
  logger?: Pick<Logger, 'info'>;
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

  // D-093 requires a count for the one-off UPDATE. Count around the migrator,
  // before the older boot recovery runs; the SQL file itself stays UPDATE-only.
  // A fresh database has no tasks table yet and therefore no rows to recover.
  const completionMigration = '0045_done_completed_at';
  const hasTasks = db.get(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`);
  const countMissingCompletions = () =>
    db.get<{ n: number }>(
      sql`SELECT count(*) AS n FROM tasks WHERE status = 'done' AND completed_at IS NULL`,
    )?.n ?? 0;
  const completionBefore =
    options.logger !== undefined &&
    pendingMigrations(db.$client, migrationsFolder).includes(completionMigration)
      ? hasTasks === undefined
        ? 0
        : countMissingCompletions()
      : null;

  let snapshotPath: string | null = null;
  if (backup !== undefined) {
    const pending = pendingMigrations(backup.sqlite, migrationsFolder);
    if (pending.length > 0) {
      snapshotPath = snapshotBeforeMigrations(backup.sqlite, backup.dir, backup.now ?? Date.now());
    }
  }

  try {
    // **`PRAGMA foreign_keys` is a no-op inside a transaction, and drizzle's
    // migrator opens one** (`BEGIN` in `sqlite-core/dialect`, around every
    // file). So the `PRAGMA foreign_keys=OFF` drizzle-kit writes at the top of
    // a table rebuild never takes effect, and `DROP TABLE` then performs its
    // implicit `DELETE FROM` with foreign keys **on** — every `ON DELETE
    // CASCADE` row in a referencing table goes with the old table, silently.
    // LAI-493's rebuild of `tasks` was the first of a table something
    // references, and `migrate.test.ts` found the dependency rows gone.
    //
    // Enforcement is switched off here, **outside** the transaction, where the
    // pragma works, and switched back on whatever happens; the check below
    // then asks SQLite whether anything is dangling, which is the question the
    // rebuild's `PRAGMA foreign_keys=ON` was meant to be followed by.
    db.run(sql`PRAGMA foreign_keys = OFF`);
    try {
      // SQLite lower()/trim() are ASCII-only. The devices migration uses the
      // same Unicode normalisation as requests, inside the migration's own
      // transaction, so only labels present at upgrade start recognised.
      db.$client.function('laika_device_label_key', { deterministic: true }, (label) =>
        deviceLabelKey(typeof label === 'string' ? label : null),
      );
      // LAI-555's revision 1 rows take the id a request would mint.
      db.$client.function('laika_new_id', { deterministic: false }, () => newId());
      migrate(db, { migrationsFolder });
    } finally {
      db.run(sql`PRAGMA foreign_keys = ON`);
    }
    const dangling = db.all(sql`PRAGMA foreign_key_check`);
    if (dangling.length > 0) {
      throw new Error(
        `Migrations left ${String(dangling.length)} dangling foreign key reference(s); refusing to boot on a database that cannot be trusted. First: ${JSON.stringify(dangling[0])}`,
      );
    }

    if (completionBefore !== null) {
      options.logger?.info('db.completed_at_backfilled', {
        migration: completionMigration,
        count: completionBefore - countMissingCompletions(),
      });
    }

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

    // There is no status backfill here, and its absence is deliberate
    // (LAI-738). LAI-266's columns were seeded by a boot step because their
    // ids needed ULIDs; 0028 builds its ULIDs in SQL, so copying the old board
    // into `project_statuses` happens inside the migration that drops it —
    // never a window where a project has neither.

    // Gives every task a place in its project's manual order (LAI-472, D-070),
    // in the order the board already shows. Here for the same reason as the
    // timestamp backfill — the keys are computed — and idempotent the same way: it only
    // fills a null.
    backfillTaskPositions(db);

    // **Idempotency rows written before LAI-534 may hold plaintext secrets**
    // (Codex review of PR #102, round 3). Deleted here, before `index.ts`
    // binds the port, and inside the protected window, so a failure fails the
    // boot rather than leaving a server answering with them still on disk.
    // Idempotent: once clean it deletes nothing.
    const purged = purgeUnversionedIdempotencyKeys(db);
    if (purged > 0) options.logger?.info('db.idempotency_purged', { rows: purged });
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
