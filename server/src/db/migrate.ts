import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
export function runMigrations(db: Db, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
  ensureActivityTriggers(db);
}
