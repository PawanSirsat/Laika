import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendActivity } from '../../src/db/activity.ts';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Db, openDb } from '../../src/db/client.ts';
import { ensureActivityTriggers, MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import { expectSqliteError, freshDb, seed, type TestDb } from '../helpers/db.ts';
import { eq } from 'drizzle-orm';
import { newId } from '../../src/db/ids.ts';
import { deviceLabelKey } from '../../src/db/device-label.ts';
import { comments, idempotencyKeys, taskDependencies, tasks } from '../../src/db/schema.ts';
import { createLogger } from '../../src/log.ts';
import { statusForCategory } from '../../src/db/project-statuses.ts';
import { resolveTokenActor } from '../../src/auth/resolve-actor.ts';
import { hashToken, newTokenSecret } from '../../src/auth/tokens.ts';

/**
 * The append-only guarantee survives a table rebuild (SPEC §4.8, LAI-118).
 *
 * LAI-044 already proves the triggers work *after the migrations we wrote*,
 * because each of 0003, 0004, 0005 and 0008 carries a hand-pasted copy of the
 * block. That test cannot fail for the reason this one exists: it passes exactly
 * as well when the rescue block was remembered as it would if it could never be
 * forgotten.
 *
 * So this rebuilds `activity` the way `drizzle-kit` does and **omits the rescue
 * block** — the shape of the migration nobody has written yet, and the one this
 * mechanism is for.
 */

let t: TestDb;

/**
 * At least one row, because a `BEFORE UPDATE` / `BEFORE DELETE` trigger fires
 * **per row** — against an empty table the statement matches nothing, no
 * trigger runs, and `UPDATE activity …` succeeds whether or not the guarantee
 * exists. An append-only test on an empty table asserts nothing at all.
 */
function seedOneActivityRow(): void {
  const s = seed(t.db);
  appendActivity(t.db, { orgId: s.orgId, actorKind: 'system', type: 'webhook.commit' });
}

/** SQLite bumps this on any schema edit, and not on a no-op DDL statement. */
function schemaVersion(): number {
  return t.sqlite.pragma('schema_version', { simple: true }) as number;
}

function triggerNames(): string[] {
  return t.db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'activity' ORDER BY name`,
    )
    .map((row) => row.name);
}

const BOTH = ['activity_is_append_only_no_delete', 'activity_is_append_only_no_update'];

/**
 * What `drizzle-kit` emits for any change to `activity`: build the new shape,
 * copy the rows, drop the old table, rename. SQLite drops a table's triggers
 * with the table, and nothing here puts them back — which is the point.
 */
function rebuildActivityWithoutRescuingTheTriggers(): void {
  const ddl = t.db.get<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activity'`,
  )?.sql;
  if (ddl === undefined) throw new Error('no activity table to rebuild');

  // Quoting is not ours to predict: migration 0000 wrote `activity` in
  // backticks, and every rebuild since has gone through ALTER TABLE … RENAME,
  // which makes SQLite rewrite the stored DDL in double quotes. Matching one
  // form silently rebuilt nothing and left this file asserting on a table it
  // had not touched.
  const renamed = ddl.replace(
    /^CREATE TABLE\s+(?:`activity`|"activity"|\[activity\]|activity)/i,
    'CREATE TABLE `__new_activity`',
  );
  if (renamed === ddl)
    throw new Error(`could not rename the table in its DDL: ${ddl.slice(0, 60)}`);

  t.sqlite.exec('PRAGMA foreign_keys=OFF');
  t.sqlite.exec(renamed);
  t.sqlite.exec('INSERT INTO `__new_activity` SELECT * FROM `activity`');
  t.sqlite.exec('DROP TABLE `activity`');
  t.sqlite.exec('ALTER TABLE `__new_activity` RENAME TO `activity`');
  t.sqlite.exec('PRAGMA foreign_keys=ON');
}

beforeEach(() => {
  t = freshDb();
});
afterEach(() => {
  t.close();
});

describe('booting an already-migrated database', () => {
  it('starts with both triggers, from the migrations', () => {
    expect(triggerNames()).toEqual(BOTH);
  });

  it('re-establishes nothing and changes nothing', () => {
    const definitions = () =>
      t.db.all<{ name: string; sql: string }>(
        sql`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'activity' ORDER BY name`,
      );

    const before = definitions();
    const beforeVersion = schemaVersion();

    ensureActivityTriggers(t.db);
    ensureActivityTriggers(t.db);

    // Two separate properties, and the first one is the one that is easy to
    // claim without checking (LAI-427).
    //
    // **The schema did not change at all.** SQLite bumps `schema_version` on
    // any schema edit and leaves it alone for a `CREATE TRIGGER IF NOT EXISTS`
    // that does nothing — so this is what distinguishes "no-op" from "dropped
    // and recreated with the same text".
    //
    // Comparing the stored SQL cannot do that on its own: a recreated trigger
    // is byte-identical because it is built from the same string constant.
    // `sqlite_master.rowid` cannot either — SQLite reuses the freed slot, so
    // the row comes back with the same rowid. Both were checked.
    expect(schemaVersion()).toBe(beforeVersion);

    // **And the bodies are unchanged**, which is a different property worth
    // keeping: it catches a future edit that alters what the triggers do.
    expect(definitions()).toEqual(before);
  });
});

describe('a migration that rebuilds activity and forgets the rescue block', () => {
  it('really does lose the triggers — otherwise this file proves nothing', () => {
    seedOneActivityRow();
    rebuildActivityWithoutRescuingTheTriggers();

    // Asserted before the fix rather than assumed. If the rebuild above stopped
    // dropping the triggers, every test below would pass without exercising
    // anything, and this file would be a decoration.
    expect(triggerNames()).toEqual([]);

    // And the guarantee really is gone, not merely unnamed — on a table that
    // still holds the row, so the statement has something to fire against.
    t.db.run(sql`DELETE FROM activity`);
    expect(t.db.all(sql`SELECT id FROM activity`)).toEqual([]);
  });

  it('gets them back when the invariant step runs', () => {
    rebuildActivityWithoutRescuingTheTriggers();
    expect(triggerNames()).toEqual([]);

    ensureActivityTriggers(t.db);

    expect(triggerNames()).toEqual(BOTH);
  });

  it('is append-only again, tested by writing rather than by reading a name', () => {
    seedOneActivityRow();
    rebuildActivityWithoutRescuingTheTriggers();
    ensureActivityTriggers(t.db);

    // A trigger with the right name and the wrong body would pass the check
    // above. §4.8 is about what the database refuses, so this asks it to refuse.
    expectSqliteError(
      () => t.db.run(sql`UPDATE activity SET type = 'task.created'`),
      /append-only.*UPDATE is not permitted/i,
    );
    expectSqliteError(
      () => t.db.run(sql`DELETE FROM activity`),
      /append-only.*DELETE is not permitted/i,
    );
  });

  it('does not duplicate them when the step runs again', () => {
    rebuildActivityWithoutRescuingTheTriggers();
    ensureActivityTriggers(t.db);
    ensureActivityTriggers(t.db);

    expect(triggerNames()).toEqual(BOTH);
  });
});

describe('the step is wired into boot, not just available', () => {
  it('re-establishes the triggers on a boot with no pending migrations', () => {
    // The property that matters is **unconditional**: a migration runs once and
    // cannot repair a database some later migration rebuilt, so the repair has
    // to happen on every boot. Every other test here calls the function
    // directly and would pass just as well if nothing ever called it.
    seedOneActivityRow();
    rebuildActivityWithoutRescuingTheTriggers();
    expect(triggerNames()).toEqual([]);

    runMigrations(t.db);

    expect(triggerNames()).toEqual(BOTH);
    expectSqliteError(
      () => t.db.run(sql`DELETE FROM activity`),
      /append-only.*DELETE is not permitted/i,
    );
  });
});

describe('the backfill is wired into boot too (LAI-435)', () => {
  it('recovers a task’s dates on a boot with no pending migrations', () => {
    const s = seed(t.db);
    const id = newId();
    t.db
      .insert(tasks)
      .values({
        id,
        projectId: s.projectId,
        number: 4242,
        title: 'Finished long ago',
        status: 'done',
        statusId: statusForCategory(t.db, s.projectId, 'done').id,
        priority: 'p2',
        createdBy: s.userId,
        createdVia: 'web',
        createdAt: 1000,
        updatedAt: 1000,
      })
      .run();
    appendActivity(t.db, {
      orgId: s.orgId,
      projectId: s.projectId,
      taskId: id,
      actorId: s.userId,
      actorKind: 'user',
      type: 'task.status_changed',
      payload: { from: 'todo', to: 'in_progress' },
      now: 5000,
    });

    // Same shape as the trigger test above: `backfill.test.ts` calls the
    // function directly and would pass just as well if **nothing ever called
    // it**. This is the one that fails when the line in `runMigrations` goes.
    runMigrations(t.db);

    expect(t.db.select().from(tasks).where(eq(tasks.id, id)).get()?.startedAt).toBe(5000);
  });
});

describe('refusing to continue without the guarantee', () => {
  it('throws rather than returning quietly when the triggers cannot be made', () => {
    // Everything this mechanism prevents is silent, so the one outcome it must
    // not have is failing quietly.
    t.sqlite.exec('PRAGMA foreign_keys=OFF');
    t.sqlite.exec('DROP TABLE `activity`');

    expect(() => ensureActivityTriggers(t.db)).toThrow();
  });

  it('refuses a trigger that keeps the name and the message and never fires (LAI-749)', () => {
    // A message-text check passes this: the sentence is all there, inside a
    // `SELECT` that raises nothing. Only the whole definition tells them apart.
    seedOneActivityRow();
    t.sqlite.exec('DROP TRIGGER `activity_is_append_only_no_update`');
    t.sqlite.exec(
      "CREATE TRIGGER `activity_is_append_only_no_update` BEFORE UPDATE ON `activity` BEGIN SELECT 'activity is append-only: UPDATE is not permitted (SPEC 4.8)'; END",
    );

    t.db.run(sql`UPDATE activity SET payload_json = '{"rewritten":true}'`);
    expect(t.db.all(sql`SELECT payload_json FROM activity`)).toEqual([
      { payload_json: '{"rewritten":true}' },
    ]);

    expect(() => ensureActivityTriggers(t.db)).toThrow(
      /activity_is_append_only_no_update \(present, but its stored definition differs/,
    );
  });

  it('refuses a trigger that holds the name and enforces nothing', () => {
    // The reachable version of the failure, and the one `IF NOT EXISTS` cannot
    // see: the block is hand-pasted into four migrations, and a paste that lost
    // its RAISE leaves something present, correctly named, and inert. A name
    // check would call this healthy.
    seedOneActivityRow();
    t.sqlite.exec('DROP TRIGGER `activity_is_append_only_no_delete`');
    t.sqlite.exec(
      'CREATE TRIGGER `activity_is_append_only_no_delete` BEFORE DELETE ON `activity` BEGIN SELECT 1; END',
    );

    expect(() => ensureActivityTriggers(t.db)).toThrow(
      /present, but its stored definition differs/i,
    );

    // And the state it refused really was broken, rather than merely unfamiliar.
    t.db.run(sql`DELETE FROM activity`);
    expect(t.db.all(sql`SELECT id FROM activity`)).toEqual([]);
  });
});

/**
 * What an upgrade case below may take (LAI-768). Each copies the migrations,
 * builds a database at an older version, seeds it and migrates the rest:
 * setup, not the property, is what a slow runner pays for. Measured on
 * 2026-10-20 — ~100 ms each at normal load, 1.7 to 13.9 s each under one `yes`
 * per core, and 8.4 s for the 0030 case in a loaded gate on 17 Oct, which is
 * the one that failed on vitest's 5 s default. 60 s is the bound the four
 * newest cases already carried; the four older ones now carry it too.
 */
const UPGRADE_BUDGET_MS = 60_000;

/**
 * The migrations, copied for a case to cut back — **without drizzle-kit's
 * snapshots** (LAI-768). The migrator reads `meta/_journal.json` and the `.sql`
 * files it names, and nothing else (`readMigrationFiles` in drizzle-orm). The
 * `meta/*_snapshot.json` files are drizzle-kit's record for generating the next
 * migration, and they are 3.3 MB of the folder's 3.5 MB. Under one `yes` per
 * core, copying the whole folder took 1.1 to 1.6 s per case; without them, 0.6
 * to 0.8 s — and there is that much less for the case to delete afterwards.
 */
/**
 * Every row of a table, through SQL rather than the Drizzle table (LAI-535).
 * A cut-back database lacks the columns added after its cut, and a schema
 * select names them all; this reads whatever the table has.
 */
function rawRows(db: Db, table: 'tasks' | 'activity'): Record<string, unknown>[] {
  return db.all<Record<string, unknown>>(sql.raw(`SELECT * FROM ${table} ORDER BY rowid`));
}

function copyMigrations(dir: string): void {
  cpSync(MIGRATIONS_FOLDER, dir, {
    recursive: true,
    filter: (source) => !source.endsWith('_snapshot.json'),
  });
}

/**
 * The `tasks` rebuild (LAI-493, D-066).
 *
 * Adding a CHECK to `tasks` made drizzle-kit emit its first rebuild of that
 * table: `__new_tasks`, copy, drop, rename. Six tables reference `tasks(id)`,
 * and `PRAGMA foreign_keys=OFF` around the rebuild is exactly the window in
 * which a dangling reference can be created without anything complaining. This
 * populates a database on the migration **before** the rebuild, migrates, and
 * asks SQLite itself whether every reference still resolves.
 */
describe('the tasks rebuild keeps every row and every foreign key (LAI-493)', () => {
  function folderWithoutTheLast(): string {
    const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
    copyMigrations(dir);
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    // **Cut back to just before the rebuild, not "the last one".** This popped
    // a single entry and asserted it was 0024; LAI-472 added 0025 after it, so
    // "the last" stopped meaning "the rebuild". Every entry from 0024 on goes.
    const at = journal.entries.findIndex((e) => e.tag.startsWith('0024_'));
    const dropped = journal.entries.splice(at);
    // The guard on this guard: the first entry cut must be the tasks rebuild,
    // or this proves nothing about it.
    expect(dropped[0]?.tag).toMatch(/^0024_/);
    writeFileSync(journalPath, JSON.stringify(journal));
    return dir;
  }

  it(
    'migrates a populated pre-rebuild database with nothing dangling',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: folderWithoutTheLast() });
        expect(
          db
            .all<{ name: string }>(sql`SELECT name FROM pragma_table_info('tasks')`)
            .map((r) => r.name),
        ).not.toContain('parent_task_id');

        const s = seed(db);
        const now = Date.now();
        const a = newId();
        const b = newId();
        db.run(sql`
        INSERT INTO tasks (id, project_id, number, title, status, priority, created_by, created_via, created_at, updated_at)
        VALUES (${a}, ${s.projectId}, 1, 'A', 'backlog', 'p2', ${s.userId}, 'api', ${now}, ${now}),
               (${b}, ${s.projectId}, 2, 'B', 'backlog', 'p2', ${s.userId}, 'api', ${now}, ${now})
      `);
        db.run(
          sql`INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (${b}, ${a}, ${now})`,
        );
        db.run(sql`
        INSERT INTO comments (id, task_id, author_id, body_md, created_via, created_at, updated_at)
        VALUES (${newId()}, ${a}, ${s.userId}, 'hello', 'api', ${now}, ${now})
      `);
        db.run(sql`
        INSERT INTO task_watchers (id, task_id, user_id, created_at, updated_at)
        VALUES (${newId()}, ${a}, ${s.userId}, ${now}, ${now})
      `);

        runMigrations(db);

        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        // Enforcement is back on for the connection the server goes on to use.
        expect(db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys).toBe(1);
        expect(
          db
            .select()
            .from(tasks)
            .all()
            .map((r) => r.title)
            .sort(),
        ).toEqual(['A', 'B']);
        expect(
          db.all(sql`SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ${a}`),
        ).toHaveLength(1);
        expect(db.all(sql`SELECT id FROM comments WHERE task_id = ${a}`)).toHaveLength(1);
        expect(db.all(sql`SELECT user_id FROM task_watchers WHERE task_id = ${a}`)).toHaveLength(1);
        expect(
          db
            .all<{ name: string }>(
              sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'`,
            )
            .map((r) => r.name),
        ).toContain('tasks_parent_task_id_idx');
        // The two new columns arrive null, not absent and not zero.
        expect(db.select().from(tasks).where(eq(tasks.id, a)).get()).toMatchObject({
          parentTaskId: null,
          dueOn: null,
          plannedStart: null,
        });
        // And the boot gave both a place in the project's order (LAI-472):
        // `position` arrives null with 0025 and `backfillTaskPositions` fills it,
        // in number order for two tasks of the same priority.
        const placed = db.select().from(tasks).all();
        expect(placed.every((r) => r.position !== null)).toBe(true);
        const pa = placed.find((r) => r.id === a)!.position!;
        const pb = placed.find((r) => r.id === b)!.position!;
        expect(pa < pb).toBe(true);
      } finally {
        sqlite.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * 0029 on a database at 0028 — production's migration when it was written
 * (LAI-743).
 *
 * **Additive is the property, so it is asserted directly.** drizzle-kit
 * generated a rebuild of `users` for 0029 and it was rewritten by hand to
 * `ALTER TABLE … ADD`; a rebuild would create the new table before dropping
 * the old one, so `users` would come back on a different root page. Same page,
 * same rows, every reference still resolving: nothing was copied.
 */
describe('0029 adds the member profile to a populated 0028 database (LAI-743)', () => {
  function folderAt0028(): string {
    const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
    copyMigrations(dir);
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag.startsWith('0029_'));
    const dropped = journal.entries.splice(at);
    // The guard on this guard: the first entry cut is 0029, and the last one
    // kept is 0028, or this is not the upgrade production makes.
    expect(dropped[0]?.tag).toMatch(/^0029_/);
    expect(journal.entries.at(-1)?.tag).toMatch(/^0028_/);
    writeFileSync(journalPath, JSON.stringify(journal));
    return dir;
  }

  it(
    'keeps every row, adds the column and the table, and rebuilds nothing',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: folderAt0028() });
        const columns = () =>
          db
            .all<{ name: string }>(sql`SELECT name FROM pragma_table_info('users')`)
            .map((r) => r.name);
        expect(columns()).not.toContain('profile_kind');

        const s = seed(db);
        const now = Date.now();
        const member = newId();
        db.run(sql`
        INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
        VALUES (${member}, 'bea@example.test', 'Bea', 'member', 0, ${now}, ${now})
      `);
        db.run(sql`
        INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, assignee_id, created_by, created_via, created_at, updated_at)
        VALUES (${newId()}, ${s.projectId}, 1, 'A', 'todo', ${statusForCategory(db, s.projectId, 'todo').id}, 'p2', ${member}, ${s.userId}, 'api', ${now}, ${now})
      `);
        // Raw, as the rows above: `appendActivity` names every column the
        // current schema has, and this database is cut back before them (LAI-535).
        db.run(sql`
        INSERT INTO activity (id, org_id, actor_kind, type, payload_json, created_at)
        VALUES (${newId()}, ${s.orgId}, 'system', 'webhook.commit', '{}', ${now})
      `);
        // What hangs off a person and would go with a rebuilt `users` (LAI-746):
        // better-auth's account and session rows cascade from it, and a token is
        // how their agents reach the board.
        db.run(sql`
        INSERT INTO accounts (id, user_id, issuer, account_id, provider_id, password, created_at, updated_at)
        VALUES (${newId()}, ${member}, 'credential', ${member}, 'credential', 'hash', ${now}, ${now})
      `);
        db.run(sql`
        INSERT INTO sessions (id, user_id, token, expires_at, created_at, updated_at)
        VALUES (${newId()}, ${member}, 'session-token', ${now + 86_400_000}, ${now}, ${now})
      `);
        db.run(sql`
        INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, created_at)
        VALUES (${newId()}, ${member}, 'Claude Code', 'lai_abcd', 'hash-1', 'full', ${now})
      `);
        const hanging = () => ({
          accounts: db.all(sql`SELECT id, user_id, password FROM accounts ORDER BY id`),
          sessions: db.all(sql`SELECT id, user_id, token FROM sessions ORDER BY id`),
          tokens: db.all(sql`SELECT id, user_id, token_hash FROM tokens ORDER BY id`),
        });
        const hangingBefore = hanging();
        expect(hangingBefore.accounts).toHaveLength(1);
        expect(hangingBefore.sessions).toHaveLength(1);
        expect(hangingBefore.tokens).toHaveLength(1);

        const rootpage = () =>
          db.get<{ rootpage: number }>(
            sql`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
          )?.rootpage;
        const before = rootpage();
        const users = () =>
          db.all(
            sql`SELECT id, email, name, org_role, is_active, created_at FROM users ORDER BY id`,
          );
        const usersBefore = users();

        runMigrations(db);

        expect(rootpage(), 'users was rebuilt').toBe(before);
        expect(users()).toEqual(usersBefore);
        expect(hanging()).toEqual(hangingBefore);
        expect(columns()).toContain('profile_kind');
        expect(db.all(sql`SELECT DISTINCT profile_kind FROM users`)).toEqual([
          { profile_kind: 'builder' },
        ]);
        expect(db.all(sql`SELECT id FROM tasks WHERE assignee_id = ${member}`)).toHaveLength(1);
        expect(db.all(sql`SELECT id FROM activity`)).toHaveLength(1);
        expect(db.all(sql`SELECT id FROM member_ratings`)).toEqual([]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

        // And the new table is append-only on the upgraded database, not only
        // on a fresh one: a row, then both refusals.
        db.run(sql`
        INSERT INTO member_ratings (id, user_id, rated_by, score, note, created_at)
        VALUES (${newId()}, ${member}, ${s.userId}, 4, 'Steady.', ${now})
      `);
        expectSqliteError(() => db.run(sql`UPDATE member_ratings SET score = 1`), /append-only/);
        expectSqliteError(() => db.run(sql`DELETE FROM member_ratings`), /append-only/);
      } finally {
        sqlite.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('migrates a fresh database straight through to the same shape', () => {
    // `freshDb()` runs every migration from nothing; the profile column and
    // table are simply there.
    expect(
      t.db
        .all<{ name: string }>(sql`SELECT name FROM pragma_table_info('users')`)
        .map((r) => r.name),
    ).toContain('profile_kind');
    expect(
      t.db.all(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'member_ratings'`,
      ),
    ).toHaveLength(1);
  });
});

/**
 * `member_ratings` is append-only for the same reason `activity` is, and its
 * triggers are re-established at boot the same way (LAI-743): a later rebuild
 * of the table would drop them, silently.
 */
describe('member_ratings keeps its append-only triggers across a rebuild (LAI-743)', () => {
  const RATING_TRIGGERS = [
    'member_ratings_is_append_only_no_delete',
    'member_ratings_is_append_only_no_replace',
    'member_ratings_is_append_only_no_update',
  ];
  const ratingTriggers = () =>
    t.db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'member_ratings' ORDER BY name`,
      )
      .map((row) => row.name);

  it('starts with all three, from the migrations', () => {
    expect(ratingTriggers()).toEqual(RATING_TRIGGERS);
  });

  it('gets them back from the boot step after they are lost', () => {
    t.sqlite.exec('DROP TRIGGER `member_ratings_is_append_only_no_update`');
    t.sqlite.exec('DROP TRIGGER `member_ratings_is_append_only_no_delete`');
    t.sqlite.exec('DROP TRIGGER `member_ratings_is_append_only_no_replace`');
    expect(ratingTriggers()).toEqual([]);

    ensureActivityTriggers(t.db);

    expect(ratingTriggers()).toEqual(RATING_TRIGGERS);
  });

  it('refuses one that holds the name and enforces nothing', () => {
    t.sqlite.exec('DROP TRIGGER `member_ratings_is_append_only_no_update`');
    t.sqlite.exec(
      'CREATE TRIGGER `member_ratings_is_append_only_no_update` BEFORE UPDATE ON `member_ratings` BEGIN SELECT 1; END',
    );

    expect(() => ensureActivityTriggers(t.db)).toThrow(
      /present, but its stored definition differs/i,
    );
  });

  /**
   * The review's substitute (LAI-749): the right name, the right table, the
   * right message text — and a `WHEN 0` that means it never fires. The check
   * used to look for the message in the stored SQL, found it, and let a replace
   * rewrite a rating 5 → 1. A message is not a definition.
   */
  it('refuses a substitute that keeps the message text and never fires', () => {
    const s = seed(t.db);
    const rated = newId();
    t.db.run(sql`
      INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
      VALUES (${rated}, 'bea@example.test', 'Bea', 'member', 1, 1, 1)
    `);
    const rating = newId();
    t.db.run(sql`
      INSERT INTO member_ratings (id, user_id, rated_by, score, note, created_at)
      VALUES (${rating}, ${rated}, ${s.userId}, 5, 'Great.', 1)
    `);

    t.sqlite.exec('DROP TRIGGER `member_ratings_is_append_only_no_replace`');
    t.sqlite.exec(
      "CREATE TRIGGER `member_ratings_is_append_only_no_replace` BEFORE INSERT ON `member_ratings` WHEN 0 BEGIN SELECT RAISE(ABORT, 'member_ratings is append-only: INSERT OR REPLACE is not permitted (SPEC 4.21)'); END",
    );

    // The substitute really is inert — so refusing it below is the point,
    // not an accident of a fixture that was never broken.
    t.db.run(sql`
      INSERT OR REPLACE INTO member_ratings (id, user_id, rated_by, score, note, created_at)
      VALUES (${rating}, ${rated}, ${s.userId}, 1, 'Rewritten.', 2)
    `);
    expect(t.db.all(sql`SELECT score FROM member_ratings`)).toEqual([{ score: 1 }]);

    expect(() => ensureActivityTriggers(t.db)).toThrow(
      /member_ratings_is_append_only_no_replace \(present, but its stored definition differs/,
    );
  });
});

/**
 * `0030` on a database at `0029` (LAI-746) — the state production is in if
 * LAI-743's commit ships before this one. A rating written there survives,
 * gains a null `idempotency_key`, and can no longer be replaced.
 */
describe('0030 closes INSERT OR REPLACE on a populated 0029 database (LAI-746)', () => {
  it('keeps the ratings and refuses a replace of one', { timeout: UPGRADE_BUDGET_MS }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
    copyMigrations(dir);
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const dropped = journal.entries.splice(
      journal.entries.findIndex((e) => e.tag.startsWith('0030_')),
    );
    expect(dropped[0]?.tag).toMatch(/^0030_/);
    expect(journal.entries.at(-1)?.tag).toMatch(/^0029_/);
    writeFileSync(journalPath, JSON.stringify(journal));

    const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
    const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
    try {
      runMigrations(db, { migrationsFolder: dir });
      const s = seed(db);
      const other = newId();
      db.run(sql`
        INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
        VALUES (${other}, 'bea@example.test', 'Bea', 'member', 1, 1, 1)
      `);
      const rating = newId();
      db.run(sql`
        INSERT INTO member_ratings (id, user_id, rated_by, score, note, created_at)
        VALUES (${rating}, ${other}, ${s.userId}, 3, 'Before 0030.', 1)
      `);

      runMigrations(db);

      expect(db.all(sql`SELECT id, score, note, idempotency_key FROM member_ratings`)).toEqual([
        { id: rating, score: 3, note: 'Before 0030.', idempotency_key: null },
      ]);
      expectSqliteError(() => {
        db.run(sql`
          INSERT OR REPLACE INTO member_ratings (id, user_id, rated_by, score, note, created_at)
          VALUES (${rating}, ${other}, ${s.userId}, 1, 'Rewritten.', 2)
        `);
      }, /append-only: INSERT OR REPLACE/);
      expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    } finally {
      sqlite.close();
      rmSync(dbDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('0031 adds the heatmap to a populated 0030 database (LAI-751)', () => {
  it(
    'fills the board rollup from the log in one pass, and rebuilds neither users nor orgs',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { tag: string }[];
      };
      const dropped = journal.entries.splice(
        journal.entries.findIndex((e) => e.tag.startsWith('0031_')),
      );
      // The guard on this guard: what was cut is 0031, and 0030 is the last kept.
      expect(dropped[0]?.tag).toMatch(/^0031_/);
      expect(journal.entries.at(-1)?.tag).toMatch(/^0030_/);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const bea = newId();
        db.run(sql`
        INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
        VALUES (${bea}, 'bea@example.test', 'Bea', 'member', 1, 1, 1)
      `);
        db.run(sql`
        INSERT INTO sessions (id, user_id, token, expires_at, created_at, updated_at)
        VALUES (${newId()}, ${bea}, 'session-token', ${Date.now() + 86_400_000}, 1, 1)
      `);

        // The log as it stands: a person's own rows, their agents' rows, a
        // system row, across a UTC midnight. Raw, because `appendActivity`
        // would count them itself — and 0031's table does not exist yet.
        const at = (iso: string) => Date.parse(iso);
        const rows: [string | null, 'user' | 'agent' | 'system', number][] = [
          [bea, 'user', at('2026-10-13T23:59:59.999Z')],
          [bea, 'user', at('2026-10-14T00:00:00.000Z')],
          [bea, 'agent', at('2026-10-14T09:00:00.000Z')],
          [bea, 'agent', at('2026-10-14T10:00:00.000Z')],
          [s.userId, 'user', at('2026-10-14T11:00:00.000Z')],
          [null, 'system', at('2026-10-14T12:00:00.000Z')],
        ];
        for (const [actor, kind, createdAt] of rows) {
          db.run(sql`
          INSERT INTO activity (id, org_id, actor_id, actor_kind, type, payload_json, created_at)
          VALUES (${newId()}, ${s.orgId}, ${actor}, ${kind}, 'task.updated', '{}', ${createdAt})
        `);
        }

        runMigrations(db);

        expect(
          db.all(
            sql`SELECT user_id, day, by_self, by_agents FROM board_activity_days ORDER BY day, user_id`,
          ),
        ).toEqual(
          [
            { user_id: bea, day: '2026-10-13', by_self: 1, by_agents: 0 },
            { user_id: bea, day: '2026-10-14', by_self: 1, by_agents: 2 },
            { user_id: s.userId, day: '2026-10-14', by_self: 1, by_agents: 0 },
          ].sort((a, b) => a.day.localeCompare(b.day) || a.user_id.localeCompare(b.user_id)),
        );

        // The switches arrive off, and the session hanging off Bea survived:
        // `users` was added to, not dropped and copied.
        expect(
          db.all(
            sql`SELECT share_local_activity, local_activity_scope FROM users WHERE id = ${bea}`,
          ),
        ).toEqual([{ share_local_activity: 0, local_activity_scope: 'agent-repos' }]);
        expect(db.all(sql`SELECT developer_insights FROM orgs`)).toEqual([
          { developer_insights: 0 },
        ]);
        expect(db.all(sql`SELECT user_id FROM sessions`)).toEqual([{ user_id: bea }]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * `0036` on a database at the migration before it (LAI-771, D-085).
 *
 * **Additive is the property, so it is asserted directly** — D-078 item 7's
 * lesson, and LAI-493's measurement of what a rebuild of `tasks` costs: every
 * table references it. Four nullable columns added to `tasks`, one table and
 * its indexes created; `tasks` keeps its root page, its rows and the rows
 * hanging off it, and the new table is append-only on the upgraded database
 * too, not only on a fresh one.
 */
describe('0036 adds sizes and forecasts to a populated database without rebuilding tasks (LAI-771)', () => {
  // Builds two databases from scratch: setup, not the property, is what a slow
  // runner pays for, so the bound is explicit (LAI-771, the gate on 9ea021f2).
  it(
    'keeps every task and dependency, adds the columns and the table, rebuilds nothing',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { tag: string }[];
      };
      const dropped = journal.entries.splice(
        journal.entries.findIndex((e) => e.tag.startsWith('0036_')),
      );
      // The guard on this guard: what was cut starts at 0036, and what is kept
      // ends just before it — the upgrade production makes.
      expect(dropped[0]?.tag).toMatch(/^0036_/);
      expect(journal.entries.at(-1)?.tag).toMatch(/^003[45]_/);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const columns = () =>
          db
            .all<{ name: string }>(sql`SELECT name FROM pragma_table_info('tasks')`)
            .map((r) => r.name);
        expect(columns()).not.toContain('estimate_id');

        const s = seed(db);
        const now = Date.now();
        const todo = statusForCategory(db, s.projectId, 'todo').id;
        const a = newId();
        const b = newId();
        for (const [id, number] of [
          [a, 1],
          [b, 2],
        ] as const) {
          db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${id}, ${s.projectId}, ${number}, 'A task', 'todo', ${todo}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        }
        db.run(sql`
        INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (${a}, ${b}, ${now})
      `);

        const rootpage = () =>
          db.get<{ rootpage: number }>(
            sql`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`,
          )?.rootpage;
        const before = rootpage();
        const rows = () => db.all(sql`SELECT id, number, title, status_id FROM tasks ORDER BY id`);
        const rowsBefore = rows();

        runMigrations(db);

        expect(rootpage(), 'tasks was rebuilt').toBe(before);
        expect(rows()).toEqual(rowsBefore);
        expect(db.all(sql`SELECT task_id FROM task_dependencies`)).toEqual([{ task_id: a }]);
        expect(columns()).toEqual(
          expect.arrayContaining([
            'estimate_id',
            'estimate_at_start_id',
            'size_override_id',
            'estimate_hash',
          ]),
        );
        expect(
          db.all(
            sql`SELECT estimate_id, estimate_at_start_id, size_override_id, estimate_hash FROM tasks`,
          ),
        ).toEqual([
          {
            estimate_id: null,
            estimate_at_start_id: null,
            size_override_id: null,
            estimate_hash: null,
          },
          {
            estimate_id: null,
            estimate_at_start_id: null,
            size_override_id: null,
            estimate_hash: null,
          },
        ]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

        // Append-only on the upgraded database: a row, then every refusal.
        const row = newId();
        db.run(sql`
        INSERT INTO task_estimates (id, task_id, source, level, weight, subtasks, factors_json, created_at)
        VALUES (${row}, ${a}, 'model', 'M', 1, 0, '{}', ${now})
      `);
        expectSqliteError(() => db.run(sql`UPDATE task_estimates SET level = 'XL'`), /append-only/);
        expectSqliteError(() => db.run(sql`DELETE FROM task_estimates`), /append-only/);
        expectSqliteError(
          () =>
            db.run(sql`
            INSERT OR REPLACE INTO task_estimates (id, task_id, source, level, weight, subtasks, factors_json, created_at)
            VALUES (${row}, ${a}, 'model', 'XS', 0.25, 0, '{}', ${now})
          `),
          /append-only/,
        );
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * Found by its tag's name, not its number: LAI-769's migration is numbered
 * where it landed on `master`, after LAI-771's `0036`, and its journal
 * timestamp must be newer than every one before it — Drizzle's migrator skips
 * a migration older than what it has applied, so one renumbered by hand, with
 * its old timestamp, would never run in production.
 *
 * The upgrade production makes: a database at every migration before it, with
 * rows in the tables those migrations made — LAI-771's estimates and the
 * columns it added to `tasks` included — and then this one. Additive is the
 * property, so it is asserted on every table's root page and its whole
 * contents, not a count.
 */
describe('the token-usage migration adds to a populated database (LAI-769)', () => {
  // Builds a database from scratch twice over: setup, not the property, is
  // what a slow runner pays for (LAI-768), so the bound is explicit, as 0036's is.
  it(
    'creates one table and its indexes, and changes nothing that was there',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      // Every migration newer than the one before it, at the next index, or
      // the migrator passes it over.
      journal.entries.forEach((e, i) => {
        expect(e.idx, e.tag).toBe(i);
        if (i > 0) expect(e.when, e.tag).toBeGreaterThan(journal.entries[i - 1]?.when ?? Infinity);
      });
      const at = journal.entries.findIndex((e) => /^\d{4}_token_usage$/.test(e.tag));
      expect(at, 'the token-usage migration is in the journal').toBeGreaterThan(0);
      const previous = journal.entries[at - 1];
      const dropped = journal.entries.splice(at);
      // The guard on this guard: what was cut starts with it, and the one
      // before it is kept.
      expect(dropped[0]?.tag).toMatch(/_token_usage$/);
      expect(journal.entries.at(-1)?.tag).toBe(previous?.tag);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const task = newId();
        const estimate = newId();
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${task}, ${s.projectId}, 1, 'A task', 'todo', ${statusForCategory(db, s.projectId, 'todo').id}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        db.run(sql`
          INSERT INTO task_estimates (id, task_id, source, level, weight, subtasks, factors_json, created_at)
          VALUES (${estimate}, ${task}, 'model', 'M', 1, 0, '{}', ${now})
        `);
        db.run(
          sql`UPDATE tasks SET estimate_id = ${estimate}, estimate_hash = 'h' WHERE id = ${task}`,
        );
        db.run(sql`
          INSERT INTO local_activity_days (user_id, day, collector_id, prompts, tz, updated_at)
          VALUES (${s.userId}, '2026-10-16', '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a', 3, 'UTC', 1)
        `);
        // Booted once at that migration, as production's is: the boot's own
        // backfills (a task's position, its timestamps) have filled their nulls,
        // so what changes next is this migration's doing and nothing else's.
        runMigrations(db, { migrationsFolder: dir });

        // Every table's root page and every row before: a rebuild moves the
        // first, and a copy that lost or changed a row changes the second.
        // Drizzle's own journal gains its row for this one, as for every one.
        const census = () =>
          Object.fromEntries(
            db
              .all<{ name: string; rootpage: number }>(
                sql`SELECT name, rootpage FROM sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                       AND name NOT LIKE '__drizzle%' ORDER BY name`,
              )
              .map((t) => [
                t.name,
                {
                  rootpage: t.rootpage,
                  rows: db.all(sql.raw(`SELECT * FROM "${t.name}" ORDER BY rowid`)),
                },
              ]),
          );
        const before = census();
        expect(before.token_usage_days).toBeUndefined();
        // The guard on the census: the rows it is to keep are in it.
        expect(before.task_estimates?.rows).toHaveLength(1);
        expect(before.tasks?.rows).toEqual([
          expect.objectContaining({ id: task, estimate_id: estimate, estimate_hash: 'h' }),
        ]);
        expect(before.local_activity_days?.rows).toHaveLength(1);

        // Up to and including this one: what a later migration changes is its
        // own test's (LAI-772's 0039 adds to `task_estimates`).
        journal.entries.push(dropped[0]!);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        const after = census();
        const { token_usage_days: added, ...kept } = after;
        expect(kept).toEqual(before);
        expect(added?.rows).toEqual([]);
        expect(
          db
            .all<{ name: string }>(
              sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'token_usage_days' ORDER BY name`,
            )
            .map((r) => r.name),
        ).toEqual([
          'token_usage_days_day_idx',
          'token_usage_days_project_day_idx',
          'token_usage_days_task_idx',
          'token_usage_days_user_day_idx',
        ]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        // LAI-771's history is still append-only after this one runs.
        expectSqliteError(() => db.run(sql`DELETE FROM task_estimates`), /append-only/);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * `0039` on a populated database (LAI-772, D-085): one append-only table for
 * what a claimant said, and two nullable columns on `task_estimates` for the
 * token forecast. **Additive is the property**, so it is asserted directly:
 * every table keeps its root page and every row; `task_estimates`' rows gain
 * the two columns as nulls and lose nothing; the new table is append-only on
 * the upgraded database too.
 */
describe('0039 adds token forecasts and claim estimates to a populated database (LAI-772)', () => {
  it(
    'creates one table, adds two nullable columns, and changes nothing that was there',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_token_forecasts$/.test(e.tag));
      expect(at, 'the token-forecasts migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at);
      expect(dropped[0]?.tag).toMatch(/_token_forecasts$/);
      // The database production has before this one: master's 0038 (LAI-780),
      // which landed first — this migration was regenerated on top of it.
      expect(journal.entries.at(-1)?.tag).toMatch(/^0038_tasks_external_ref_index$/);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const task = newId();
        const estimate = newId();
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${task}, ${s.projectId}, 1, 'A task', 'todo', ${statusForCategory(db, s.projectId, 'todo').id}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        db.run(sql`
          INSERT INTO task_estimates (id, task_id, source, level, weight, build_p50_ms, build_p80_ms, subtasks, factors_json, created_at)
          VALUES (${estimate}, ${task}, 'model', 'M', 1, 3600000, 7200000, 0, '{}', ${now})
        `);
        db.run(
          sql`UPDATE tasks SET estimate_id = ${estimate}, estimate_hash = 'h' WHERE id = ${task}`,
        );
        runMigrations(db, { migrationsFolder: dir });

        const census = () =>
          Object.fromEntries(
            db
              .all<{ name: string; rootpage: number }>(
                sql`SELECT name, rootpage FROM sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                       AND name NOT LIKE '__drizzle%' ORDER BY name`,
              )
              .map((t) => [
                t.name,
                {
                  rootpage: t.rootpage,
                  rows: db.all(sql.raw(`SELECT * FROM "${t.name}" ORDER BY rowid`)),
                },
              ]),
          );
        const before = census();
        expect(before.task_claim_estimates).toBeUndefined();
        expect(before.task_estimates?.rows).toHaveLength(1);

        // Up to and including this one: what a later migration adds is its
        // own test's (LAI-773's 0040 creates tables of its own).
        journal.entries.push(dropped[0]!);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        const after = census();
        const { task_claim_estimates: added, task_estimates: estimates, ...kept } = after;
        const { task_estimates: estimatesBefore, ...keptBefore } = before;
        expect(kept).toEqual(keptBefore);
        expect(added?.rows).toEqual([]);
        expect(estimates?.rootpage).toBe(estimatesBefore?.rootpage);
        expect(estimates?.rows).toEqual(
          (estimatesBefore?.rows as Record<string, unknown>[]).map((r) => ({
            ...r,
            tokens_p50: null,
            tokens_p80: null,
          })),
        );
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        db.run(sql`
          INSERT INTO task_claim_estimates (id, task_id, level, confidence, created_at)
          VALUES ('c1', ${task}, 'S', 'green', ${now})
        `);
        expectSqliteError(
          () => db.run(sql`UPDATE task_claim_estimates SET level = 'XL'`),
          /append-only/,
        );
        expectSqliteError(() => db.run(sql`DELETE FROM task_claim_estimates`), /append-only/);
        expectSqliteError(
          () =>
            db.run(
              sql`INSERT INTO task_claim_estimates (id, task_id, level, created_at) VALUES ('c2', ${task}, NULL, ${now})`,
            ),
          /CHECK constraint failed/,
        );
        expectSqliteError(() => db.run(sql`DELETE FROM task_estimates`), /append-only/);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * `0040` on a populated database (LAI-773, D-087): nine new tables and one new
 * partial index on `token_usage_days`. **Additive is the property**, asserted
 * directly: every table that was there keeps its root page and every row —
 * `token_usage_days` included, which gains an index and nothing else — and
 * the new tables arrive empty.
 */
describe('0040 adds budgets, alerts, telemetry and plan limits to a populated database (LAI-773)', () => {
  it(
    'creates its tables and one index, and changes nothing that was there',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_token_phase5$/.test(e.tag));
      expect(at, 'the token-phase5 migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at);
      expect(dropped[0]?.tag).toMatch(/_token_phase5$/);
      expect(journal.entries.at(-1)?.tag).toMatch(/^0039_token_forecasts$/);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const task = newId();
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${task}, ${s.projectId}, 1, 'A task', 'todo', ${statusForCategory(db, s.projectId, 'todo').id}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        db.run(sql`
          INSERT INTO token_usage_days (user_id, collector_id, day, agent, model, task_id, project_id, input, output, cache_write, cache_read, updated_at)
          VALUES (${s.userId}, '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a', '2026-10-16', 'claude-code', 'claude-opus-5-5', ${task}, ${s.projectId}, 1, 2, 3, 4, ${now})
        `);
        runMigrations(db, { migrationsFolder: dir });

        const census = () =>
          Object.fromEntries(
            db
              .all<{ name: string; rootpage: number }>(
                sql`SELECT name, rootpage FROM sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                       AND name NOT LIKE '__drizzle%' ORDER BY name`,
              )
              .map((t) => [
                t.name,
                {
                  rootpage: t.rootpage,
                  rows: db.all(sql.raw(`SELECT * FROM "${t.name}" ORDER BY rowid`)),
                },
              ]),
          );
        const before = census();
        const created = [
          'org_model_prices',
          'plan_limits',
          'token_alert_dismissals',
          'token_alerts',
          'token_arrivals',
          'token_budgets',
          'token_session_days',
          'token_session_skips',
          'token_telemetry_series',
          'token_usage_zones',
        ];
        for (const table of created) expect(before[table], table).toBeUndefined();
        // The guard on the census: the rows it is to keep are in it.
        expect(before.token_usage_days?.rows).toHaveLength(1);

        journal.entries.push(dropped[0]!);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        const after = census();
        const kept = Object.fromEntries(
          Object.entries(after).filter(([name]) => !created.includes(name)),
        );
        expect(kept).toEqual(before);
        for (const table of created) expect(after[table]?.rows, table).toEqual([]);
        expect(
          db
            .all<{ name: string }>(
              sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'token_usage_days' ORDER BY name`,
            )
            .map((r) => r.name),
        ).toEqual([
          'token_usage_days_day_idx',
          'token_usage_days_project_day_idx',
          'token_usage_days_task_idx',
          'token_usage_days_telemetry_idx',
          'token_usage_days_user_day_idx',
        ]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * `0043` on a populated database (LAI-815, D-091): an `automated` flag on
 * `token_usage_days`, and its day and project indexes re-created with it.
 * **Additive is the property**: the table is altered, not rebuilt — its root
 * page and every row stay, each row now `automated = 0` — and every other
 * table, the tasks its rows point at included, is untouched. A rebuild is what
 * would cascade (the Drizzle migrator keeps foreign keys on, LAI-768), so the
 * root page is the instrument.
 */
describe('0043 marks automated token rows on a populated database (LAI-815)', () => {
  it(
    'adds the column, keeps every row as a person’s, and rebuilds nothing',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_token_usage_automated$/.test(e.tag));
      expect(at, 'the automated-flag migration is in the journal').toBeGreaterThan(0);
      // 0043 alone comes back: a later migration's own tables are not its
      // census's business (LAI-831's 0044 added two, and read as a change).
      const dropped = journal.entries.splice(at).slice(0, 1);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const task = newId();
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${task}, ${s.projectId}, 1, 'A task', 'todo', ${statusForCategory(db, s.projectId, 'todo').id}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        for (const [taskId, projectId] of [
          [task, s.projectId],
          [null, null],
        ]) {
          db.run(sql`
            INSERT INTO token_usage_days (user_id, collector_id, day, agent, model, task_id, project_id, input, output, cache_write, cache_read, updated_at)
            VALUES (${s.userId}, '6f1c2a4e-0b7d-4c1e-9a55-3c8f1e2d4b6a', '2026-10-16', 'claude-code', 'claude-opus-5-5', ${taskId}, ${projectId}, 1, 2, 3, 4, ${now})
          `);
        }
        // What every boot does beside the migrations (a new task's position),
        // done before the census, so the census sees only 0043.
        runMigrations(db, { migrationsFolder: dir });

        const census = () =>
          Object.fromEntries(
            db
              .all<{ name: string; rootpage: number }>(
                sql`SELECT name, rootpage FROM sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                       AND name NOT LIKE '__drizzle%' ORDER BY name`,
              )
              .map((t) => [
                t.name,
                {
                  rootpage: t.rootpage,
                  rows: db.all<Record<string, unknown>>(
                    sql.raw(`SELECT * FROM "${t.name}" ORDER BY rowid`),
                  ),
                },
              ]),
          );
        const before = census();
        // The guard on the census: the rows it is to keep are in it.
        expect(before.token_usage_days?.rows).toHaveLength(2);
        expect(before.tasks?.rows).toHaveLength(1);
        expect(before.token_usage_days?.rows[0]).not.toHaveProperty('automated');

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        const after = census();
        const { token_usage_days: usage, ...kept } = after;
        const { token_usage_days: usageBefore, ...keptBefore } = before;
        expect(kept).toEqual(keptBefore);
        expect(usage?.rootpage).toBe(usageBefore?.rootpage);
        expect(usage?.rows).toEqual(usageBefore?.rows.map((r) => ({ ...r, automated: 0 })));
        expect(
          db
            .all<{ name: string }>(
              sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'token_usage_days' ORDER BY name`,
            )
            .map((r) => r.name),
        ).toEqual([
          'token_usage_days_day_idx',
          'token_usage_days_project_day_idx',
          'token_usage_days_task_idx',
          'token_usage_days_telemetry_idx',
          'token_usage_days_user_day_idx',
        ]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

/**
 * `0044` on a populated database (LAI-831): `time_breaks` and `time_undo`,
 * two new tables of a person's own time. **Additive is the property**: two
 * tables appear, empty, and every table already there keeps its root page and
 * every row — a person's drafts and confirmed entries included. A rebuild is
 * what would cascade (the Drizzle migrator keeps foreign keys on, LAI-768), so
 * the root page is the instrument.
 */
describe('0044 adds breaks and undo on a populated database (LAI-831)', () => {
  it('creates two empty tables and rebuilds nothing', { timeout: UPGRADE_BUDGET_MS }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
    copyMigrations(dir);
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((e) => /^\d{4}_time_breaks_and_undo$/.test(e.tag));
    expect(at, 'the breaks-and-undo migration is in the journal').toBeGreaterThan(0);
    const dropped = journal.entries.splice(at).slice(0, 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
    const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
    try {
      runMigrations(db, { migrationsFolder: dir });
      const s = seed(db);
      const now = Date.now();
      const entry = newId();
      db.run(sql`
        INSERT INTO time_entries (id, user_id, day, tz, minutes, source, revision, created_at, updated_at)
        VALUES (${entry}, ${s.userId}, '2026-10-20', 'UTC', 30, 'manual', 1, ${now}, ${now})
      `);
      db.run(sql`
        INSERT INTO time_drafts (id, user_id, source, collector_id, day, tz, started_at, ended_at, minutes, signals, state, origin_id, origin_started_at, origin_ended_at, origin_minutes, created_at, updated_at)
        VALUES (${newId()}, ${s.userId}, 'collector', 'c', '2026-10-20', 'UTC', ${now}, ${now + 1_800_000}, 30, '{"prompts":2}', 'pending', 'o', ${now}, ${now + 1_800_000}, 30, ${now}, ${now})
      `);
      // What every boot does beside the migrations, done before the census.
      runMigrations(db, { migrationsFolder: dir });

      const census = () =>
        Object.fromEntries(
          db
            .all<{ name: string; rootpage: number }>(
              sql`SELECT name, rootpage FROM sqlite_master
                   WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                     AND name NOT LIKE '__drizzle%' ORDER BY name`,
            )
            .map((t) => [
              t.name,
              {
                rootpage: t.rootpage,
                rows: db.all<Record<string, unknown>>(
                  sql.raw(`SELECT * FROM "${t.name}" ORDER BY rowid`),
                ),
              },
            ]),
        );
      const before = census();
      // The guard on the census: the rows it is to keep are in it.
      expect(before.time_drafts?.rows).toHaveLength(1);
      expect(before.time_entries?.rows).toHaveLength(1);
      expect(before).not.toHaveProperty('time_breaks');
      expect(before).not.toHaveProperty('time_undo');

      journal.entries.push(...dropped);
      writeFileSync(journalPath, JSON.stringify(journal));
      runMigrations(db, { migrationsFolder: dir });

      const { time_breaks: breaks, time_undo: undo, ...kept } = census();
      expect(kept).toEqual(before);
      expect(breaks?.rows).toEqual([]);
      expect(undo?.rows).toEqual([]);
      expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    } finally {
      sqlite.close();
      rmSync(dbDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `0047` on a populated database (LAI-866): a work folder's chosen name and
 * its branch, two columns on `time_drafts` and two on `time_entries`.
 * **Additive is the property, and here it is the safety**: rebuilding
 * `time_entries` trips `time_entry_revisions`' triggers, which name it, and a
 * rebuild with foreign keys on would cascade its revisions away. So every
 * table keeps its root page and every row, the four columns arrive null, and
 * the entry is still kept three years — tested by deleting it.
 */
describe('0047 adds a work folder’s name to a populated database (LAI-866)', () => {
  it('adds four null columns and rebuilds nothing', { timeout: UPGRADE_BUDGET_MS }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
    copyMigrations(dir);
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const at = journal.entries.findIndex((e) => /^\d{4}_work_folder_names$/.test(e.tag));
    expect(at, 'the work-folder migration is in the journal').toBeGreaterThan(0);
    const dropped = journal.entries.splice(at).slice(0, 1);
    writeFileSync(journalPath, JSON.stringify(journal));

    const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
    const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
    try {
      runMigrations(db, { migrationsFolder: dir });
      const s = seed(db);
      const now = Date.now();
      const day = new Date(now).toISOString().slice(0, 10);
      const entry = newId();
      db.run(sql`
        INSERT INTO time_entries (id, user_id, day, tz, minutes, source, source_ref, revision, created_at, updated_at)
        VALUES (${entry}, ${s.userId}, ${day}, 'UTC', 30, 'draft', 'd1', 1, ${now}, ${now})
      `);
      db.run(sql`
        INSERT INTO time_entry_revisions (id, entry_id, revision, change, changed_by, day, tz, minutes, created_at)
        VALUES (${newId()}, ${entry}, 1, 'created', ${s.userId}, ${day}, 'UTC', 30, ${now})
      `);
      db.run(sql`
        INSERT INTO time_drafts (id, user_id, source, collector_id, day, tz, started_at, ended_at, minutes, signals, state, entry_id, origin_id, origin_started_at, origin_ended_at, origin_minutes, created_at, updated_at)
        VALUES ('d1', ${s.userId}, 'collector', '', ${day}, 'UTC', ${now}, ${now + 1_800_000}, 30, '{"prompts":2}', 'confirmed', ${entry}, 'd1', ${now}, ${now + 1_800_000}, 30, ${now}, ${now})
      `);
      // What every boot does beside the migrations, done before the census.
      runMigrations(db, { migrationsFolder: dir });

      const census = () =>
        Object.fromEntries(
          db
            .all<{ name: string; rootpage: number }>(
              sql`SELECT name, rootpage FROM sqlite_master
                   WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                     AND name NOT LIKE '__drizzle%' ORDER BY name`,
            )
            .map((t) => [
              t.name,
              {
                rootpage: t.rootpage,
                rows: db.all<Record<string, unknown>>(
                  sql.raw(`SELECT * FROM "${t.name}" ORDER BY rowid`),
                ),
              },
            ]),
        );
      const before = census();
      // The guard on the census: the rows it is to keep are in it.
      expect(before.time_entries?.rows).toHaveLength(1);
      expect(before.time_entry_revisions?.rows).toHaveLength(1);
      expect(before.time_drafts?.rows).toHaveLength(1);
      expect(before.time_entries?.rows[0]).not.toHaveProperty('folder');

      journal.entries.push(...dropped);
      writeFileSync(journalPath, JSON.stringify(journal));
      runMigrations(db, { migrationsFolder: dir });

      const { time_drafts: drafts, time_entries: entries, ...kept } = census();
      const { time_drafts: draftsBefore, time_entries: entriesBefore, ...keptBefore } = before;
      expect(kept).toEqual(keptBefore);
      expect(drafts?.rootpage).toBe(draftsBefore?.rootpage);
      expect(entries?.rootpage).toBe(entriesBefore?.rootpage);
      const named = (r: Record<string, unknown>) => ({ ...r, folder: null, branch: null });
      expect(drafts?.rows).toEqual(draftsBefore?.rows.map(named));
      expect(entries?.rows).toEqual(entriesBefore?.rows.map(named));
      expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      // Still kept three years, and its history still append-only.
      expectSqliteError(
        () => db.run(sql`DELETE FROM time_entries WHERE id = ${entry}`),
        /three years/,
      );
      expectSqliteError(
        () => db.run(sql`DELETE FROM time_entry_revisions WHERE entry_id = ${entry}`),
        /append-only/,
      );
    } finally {
      sqlite.close();
      rmSync(dbDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('D-093 completed_at migration (LAI-822)', () => {
  const TAG = '0045_done_completed_at';
  // Building and upgrading real files needs an I/O budget under shared-machine load.
  const UPGRADE_TIMEOUT_MS = 30_000;
  const migrationSql = () => readFileSync(join(MIGRATIONS_FOLDER, `${TAG}.sql`), 'utf8');

  /** A file at the immediately preceding version, with production's foreign keys. */
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'lai822-fixture-'));
    const folder = join(dir, 'migrations');
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    const at = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(at, 'the completion migration is registered').toBeGreaterThan(0);
    journal.entries.splice(at);
    writeFileSync(journalPath, JSON.stringify(journal));
    const handle = openDb({ path: join(dir, 'original.sqlite') });
    runMigrations(handle.db, { migrationsFolder: folder });
    const seeded = seed(handle.db, 1000);
    let number = 0;
    const task = (status: 'done' | 'review', completedAt: number | null = null) => {
      number += 1;
      const id = newId();
      // Raw SQL, never the Drizzle table: this database is cut back before
      // TAG, and a schema insert names every column added since (LAI-535).
      handle.db.run(sql`
        INSERT INTO tasks (id, project_id, number, title, status, status_id, created_by, created_via, position, created_at, updated_at, completed_at)
        VALUES (${id}, ${seeded.projectId}, ${number}, 'Snapshot fixture', ${status},
                ${statusForCategory(handle.db, seeded.projectId, status).id}, ${seeded.userId}, 'api',
                ${`k${String(number)}`}, 1000, 2000, ${completedAt})
      `);
      return id;
    };
    const moved = (
      taskId: string,
      from: string,
      to: string,
      now: number,
      type: 'task.status_changed' | 'task.updated' = 'task.status_changed',
    ) => {
      handle.db.run(sql`
        INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, type, payload_json, created_at)
        VALUES (${newId()}, ${seeded.orgId}, ${seeded.projectId}, ${taskId}, ${seeded.userId}, 'user',
                ${type}, ${JSON.stringify({ from, to })}, ${now})
      `);
    };
    const createdDone = task('done');
    // The old boot recovery ignores unreadable payloads too: no date to recover.
    handle.db.run(sql`
      INSERT INTO activity (id, org_id, project_id, task_id, actor_kind, type, payload_json, created_at)
      VALUES (${newId()}, ${seeded.orgId}, ${seeded.projectId}, ${createdDone}, 'system',
              'task.status_changed', '{invalid', 16000)
    `);
    const historical = task('done');
    // Deliberately out of insertion order: latest means timestamp, not rowid.
    moved(historical, 'review', 'done', 9000);
    moved(historical, 'review', 'done', 5000);
    moved(historical, 'done', 'review', 6000);
    moved(historical, 'done', 'done', 11_000);
    moved(historical, 'review', 'done', 12_000, 'task.updated');
    const sameCategoryOnly = task('done');
    moved(sameCategoryOnly, 'done', 'done', 13_000);
    const stamped = task('done', 3000);
    moved(stamped, 'review', 'done', 14_000);
    const reopened = task('review');
    moved(reopened, 'review', 'done', 4000);
    moved(reopened, 'done', 'review', 5000);
    const reopenedStamped = task('review', 4000);
    const unrelated = task('done');
    // References that a tasks table rebuild could cascade away or set null.
    handle.db
      .insert(comments)
      .values({
        id: newId(),
        taskId: historical,
        authorId: seeded.userId,
        bodyMd: 'Keep this reference',
        createdVia: 'web',
        createdAt: 2000,
        updatedAt: 2000,
      })
      .run();
    handle.db
      .insert(taskDependencies)
      .values({
        taskId: createdDone,
        dependsOnTaskId: historical,
        createdAt: 2000,
      })
      .run();
    handle.db
      .update(tasks)
      .set({ parentTaskId: historical, discoveredFrom: historical })
      .where(eq(tasks.id, createdDone))
      .run();
    // No qualifying event on this task: another task's events must not leak in.
    moved(unrelated, 'todo', 'review', 15_000);
    return {
      ...handle,
      dir,
      createdDone,
      historical,
      sameCategoryOnly,
      stamped,
      reopened,
      reopenedStamped,
      unrelated,
    };
  }

  it('logs zero rows when applying to a fresh database', () => {
    const empty = openDb({ path: ':memory:' });
    try {
      const lines: string[] = [];
      runMigrations(empty.db, { logger: createLogger((line) => lines.push(line)) });
      expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toMatchObject([
        { event: 'db.completed_at_backfilled', migration: TAG, count: 0 },
      ]);
    } finally {
      empty.sqlite.close();
    }
  });

  it(
    'runs on an upgrade copy, snapshots first, and logs the rows it set once',
    () => {
      const f = fixture();
      const path = join(f.dir, 'copy.sqlite');
      f.sqlite.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
      const copy = openDb({ path });
      try {
        const lines: string[] = [];
        const logger = createLogger((line) => lines.push(line));
        const backupDir = join(f.dir, 'backups');
        runMigrations(copy.db, {
          logger,
          backup: { sqlite: copy.sqlite, dir: backupDir, now: 20_000 },
        });
        const messages = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(messages()).toMatchObject([
          { event: 'db.completed_at_backfilled', migration: TAG, count: 4 },
        ]);
        const count = (db: typeof copy.db) =>
          rawRows(db, 'tasks').filter((r) => r.status === 'done' && r.completed_at === null).length;
        expect(count(f.db)).toBe(4);
        expect(count(copy.db)).toBe(0);
        const snapshot = openDb({
          path: join(backupDir, 'pre-migration-1970-01-01T00-00-20-000Z.sqlite'),
        });
        try {
          expect(count(snapshot.db)).toBe(4);
        } finally {
          snapshot.sqlite.close();
        }
        const after = rawRows(copy.db, 'tasks');
        runMigrations(copy.db, {
          logger,
          backup: { sqlite: copy.sqlite, dir: backupDir, now: 30_000 },
        });
        expect(messages()).toHaveLength(1);
        expect(rawRows(copy.db, 'tasks')).toEqual(after);
        expect(copy.sqlite.prepare(migrationSql()).run().changes).toBe(0);
      } finally {
        copy.sqlite.close();
        f.sqlite.close();
        rmSync(f.dir, { recursive: true, force: true });
      }
    },
    UPGRADE_TIMEOUT_MS,
  );

  it(
    'fills only unstamped done tasks, preserves references, and changes zero rows on replay',
    () => {
      const f = fixture();
      try {
        const before = rawRows(f.db, 'tasks');
        const history = rawRows(f.db, 'activity');
        const refs = f.db.select().from(taskDependencies).all();
        const notes = f.db.select().from(comments).all();
        const missing = () =>
          rawRows(f.db, 'tasks').filter((r) => r.status === 'done' && r.completed_at === null)
            .length;
        expect(missing()).toBe(4);
        expect(f.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
        const schemaVersionBefore = f.sqlite.pragma('schema_version', { simple: true });
        const applied = f.sqlite.prepare(migrationSql()).run();
        expect(applied.changes).toBe(4);
        expect(missing()).toBe(0);
        expect(f.sqlite.pragma('schema_version', { simple: true })).toBe(schemaVersionBefore);
        const after = rawRows(f.db, 'tasks');
        const expected = new Map<unknown, number | null>([
          [f.createdDone, 1000],
          [f.historical, 9000],
          [f.sameCategoryOnly, 1000],
          [f.stamped, 3000],
          [f.reopened, null],
          [f.reopenedStamped, 4000],
          [f.unrelated, 1000],
        ]);
        expect(after).toEqual(before.map((r) => ({ ...r, completed_at: expected.get(r.id) })));
        expect(rawRows(f.db, 'activity')).toEqual(history);
        expect(f.db.select().from(taskDependencies).all()).toEqual(refs);
        expect(f.db.select().from(comments).all()).toEqual(notes);
        expect(f.sqlite.pragma('foreign_key_check')).toEqual([]);
        expect(f.sqlite.prepare(migrationSql()).run().changes).toBe(0);
        expect(rawRows(f.db, 'tasks')).toEqual(after);
      } finally {
        f.sqlite.close();
        rmSync(f.dir, { recursive: true, force: true });
      }
    },
    UPGRADE_TIMEOUT_MS,
  );
});

describe('0060 maps the kinds onto the design’s eight on a populated database (LAI-516)', () => {
  it(
    'rewrites every old kind in place, rebuilds only the timers, keeps every row and refuses the old names',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_time_entry_kinds_design$/.test(e.tag));
      expect(at, 'the kinds migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at).slice(0, 1);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const day = new Date(now).toISOString().slice(0, 10);
        // One entry of each of the first eight kinds, each with a revision that
        // says the same; and a timer on one of the names that goes.
        const OLD = [
          'meeting',
          'call',
          'review',
          'planning',
          'learning',
          'support',
          'admin',
          'other',
        ];
        const ids = OLD.map(() => newId());
        OLD.forEach((kind, i) => {
          db.run(sql`
          INSERT INTO time_entries (id, user_id, day, tz, minutes, source, source_ref, kind, revision, created_at, updated_at)
          VALUES (${ids[i]}, ${s.userId}, ${day}, 'UTC', ${10 + i}, 'manual', NULL, ${kind}, 1, ${now + i}, ${now + i})
        `);
          db.run(sql`
          INSERT INTO time_entry_revisions (id, entry_id, revision, change, changed_by, day, tz, minutes, kind, created_at)
          VALUES (${newId()}, ${ids[i]}, 1, 'created', ${s.userId}, ${day}, 'UTC', ${10 + i}, ${kind}, ${now + i})
        `);
        });
        db.run(sql`
        INSERT INTO time_timers (user_id, task_id, kind, title, tz, started_at, resumed_at, paused_at, accumulated_ms, updated_at)
        VALUES (${s.userId}, NULL, 'planning', 'Sprint shape', 'UTC', ${now}, ${now}, NULL, 0, ${now})
      `);
        runMigrations(db, { migrationsFolder: dir });

        const census = () =>
          Object.fromEntries(
            db
              .all<{ name: string; rootpage: number }>(
                sql`SELECT name, rootpage FROM sqlite_master
                   WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                     AND name NOT LIKE '__drizzle%' ORDER BY name`,
              )
              .map((t) => [
                t.name,
                {
                  rootpage: t.rootpage,
                  rows: db.all<Record<string, unknown>>(
                    sql.raw(`SELECT * FROM "${t.name}" ORDER BY rowid`),
                  ),
                },
              ]),
          );
        const before = census();
        expect(before.time_entries?.rows.map((r) => r.kind)).toEqual(OLD);
        expect(before.time_entry_revisions?.rows.map((r) => r.kind)).toEqual(OLD);
        expect(before.time_timers?.rows.map((r) => r.kind)).toEqual(['planning']);

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        const NEW = [
          'meeting',
          'meeting',
          'review',
          'thinking',
          'research',
          'support',
          'admin',
          'work',
        ];
        const after = census();
        const {
          time_entries: entries,
          time_entry_revisions: revisions,
          time_timers: timers,
          ...kept
        } = after;
        const {
          time_entries: entriesBefore,
          time_entry_revisions: revisionsBefore,
          time_timers: timersBefore,
          ...keptBefore
        } = before;
        // Nothing else moved; the two tables without a CHECK were not rebuilt.
        expect(kept).toEqual(keptBefore);
        expect(entries?.rootpage).toBe(entriesBefore?.rootpage);
        expect(revisions?.rootpage).toBe(revisionsBefore?.rootpage);
        const mapped = (rows: Record<string, unknown>[] | undefined) =>
          rows?.map((r, i) => ({ ...r, kind: NEW[i] }));
        expect(entries?.rows).toEqual(mapped(entriesBefore?.rows));
        expect(revisions?.rows).toEqual(mapped(revisionsBefore?.rows));
        // The timer survived its table's rebuild, on its new name.
        expect(timers?.rows).toEqual(timersBefore?.rows.map((r) => ({ ...r, kind: 'thinking' })));
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        // The new CHECK: a design kind is admitted, an old name is not.
        db.run(sql`UPDATE time_timers SET kind = 'pairing' WHERE user_id = ${s.userId}`);
        expectSqliteError(
          () => db.run(sql`UPDATE time_timers SET kind = 'call' WHERE user_id = ${s.userId}`),
          /CHECK constraint failed/,
        );
        // Still kept three years, and its history still append-only — the
        // trigger the migration dropped for its one UPDATE is back.
        expectSqliteError(
          () => db.run(sql`DELETE FROM time_entries WHERE id = ${ids[0] ?? ''}`),
          /three years/,
        );
        expectSqliteError(
          () =>
            db.run(
              sql`UPDATE time_entry_revisions SET kind = 'admin' WHERE entry_id = ${ids[0] ?? ''}`,
            ),
          /append-only/,
        );
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0061 adds registered agents to a populated database with legacy tokens (LAI-534)', () => {
  it(
    'adds a nullable tokens.agent_id without rebuilding tokens, and legacy tokens still resolve',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_registered_agents$/.test(e.tag));
      expect(at, 'the agents migration is in the journal').toBeGreaterThan(0);
      // 0061 alone comes back, as 0043's case does: 0062 (LAI-535) rebuilds
      // `activity`, which is not this census's business.
      const dropped = journal.entries.splice(at).slice(0, 1);
      // The guard on this guard: the cut is exactly this migration.
      expect(dropped.map((e) => e.tag)).toEqual([expect.stringMatching(/_registered_agents$/)]);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const secret = newTokenSecret();
        const tokenId = newId();
        // Written as the pre-0061 schema has it: no agent_id column to name.
        db.run(sql`
          INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, project_ids_json, created_at)
          VALUES (${tokenId}, ${s.userId}, 'legacy', ${secret.slice(0, 8)}, ${hashToken(secret)}, 'full', NULL, ${now})
        `);
        db.run(sql`
          INSERT INTO activity (id, org_id, project_id, actor_id, actor_kind, actor_token_id, type, payload_json, created_at)
          VALUES (${newId()}, ${s.orgId}, NULL, ${s.userId}, 'agent', ${tokenId}, 'token.created', '{}', ${now})
        `);

        const rootpage = (name: string) =>
          db.get<{ rootpage: number }>(
            sql`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
          )?.rootpage;
        const tokensBefore = db.all<Record<string, unknown>>(sql`SELECT * FROM tokens`);
        const activityBefore = db.all<Record<string, unknown>>(sql`SELECT * FROM activity`);
        const tokensPage = rootpage('tokens');

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        // Additive: the same table, every row kept, the new column null.
        expect(rootpage('tokens')).toBe(tokensPage);
        expect(db.all(sql`SELECT * FROM tokens`)).toEqual(
          tokensBefore.map((row) => ({ ...row, agent_id: null })),
        );
        // The attribution that a rebuild of `tokens` would have nulled is intact.
        expect(db.all(sql`SELECT * FROM activity`)).toEqual(activityBefore);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

        // The legacy token resolves exactly as before, with no agent.
        const actor = resolveTokenActor(db, secret, now);
        expect(actor.userId).toBe(s.userId);
        expect(actor.token).toMatchObject({ id: tokenId, scope: 'full', projectIds: null });
        expect(actor.token?.agent ?? null).toBeNull();

        // And the reference landed with its cascade: an agent row removed takes
        // its tokens with it, never leaving them as their owner's own.
        const agentId = newId();
        db.run(sql`
          INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, status, created_at)
          VALUES (${agentId}, ${s.orgId}, ${s.userId}, 'a', 'other', 'active', ${now})
        `);
        db.run(sql`UPDATE tokens SET agent_id = ${agentId} WHERE id = ${tokenId}`);
        db.run(sql`DELETE FROM agents WHERE id = ${agentId}`);
        expect(db.all(sql`SELECT id FROM tokens WHERE id = ${tokenId}`)).toEqual([]);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('runMigrations purges pre-LAI-534 idempotency rows before the port is bound (round 3)', () => {
  function seedRows(db: TestDb['db']): void {
    for (const actorId of ['01OLDUSER', 'v2:user:01NEWUSER']) {
      db.insert(idempotencyKeys)
        .values({
          actorId,
          key: 'k',
          requestHash: 'h',
          responseStatus: 201,
          responseBody: actorId === '01OLDUSER' ? '{"secret":"lai_old"}' : '{}',
          createdAt: 1,
          expiresAt: Date.now() + 60_000,
        })
        .run();
    }
  }

  it('deletes them on a boot with nothing to migrate, and says so', () => {
    const t2 = freshDb();
    try {
      seedRows(t2.db);
      const lines: string[] = [];
      runMigrations(t2.db, { logger: createLogger((line) => lines.push(line)) });
      expect(
        t2.db
          .select()
          .from(idempotencyKeys)
          .all()
          .map((r) => r.actorId),
      ).toEqual(['v2:user:01NEWUSER']);
      expect(lines.map((l) => JSON.parse(l) as { event: string; rows?: number })).toContainEqual(
        expect.objectContaining({ event: 'db.idempotency_purged', rows: 1 }),
      );
    } finally {
      t2.close();
    }
  });

  it('fails the boot when the purge fails, rather than serving with them on disk', () => {
    const t2 = freshDb();
    try {
      seedRows(t2.db);
      t2.db.run(sql`
        CREATE TRIGGER refuse_purge BEFORE DELETE ON idempotency_keys
        BEGIN SELECT RAISE(ABORT, 'purge refused for the test'); END
      `);
      expect(() => runMigrations(t2.db)).toThrow(/purge refused for the test/);
      expect(t2.db.select().from(idempotencyKeys).all()).toHaveLength(2);
    } finally {
      t2.close();
    }
  });
});

describe('0062 selects agents and attributes activity on a populated database (LAI-535)', () => {
  it('never back-fills activity.agent_id: the copy step does not name it', () => {
    const file = readdirSync(MIGRATIONS_FOLDER).find((f) =>
      /^\d{4}_selected_agent_work_requests\.sql$/.test(f),
    );
    expect(file, 'the LAI-535 migration exists').toBeDefined();
    const text = readFileSync(join(MIGRATIONS_FOLDER, file!), 'utf8');

    const copy = text.split('\n').find((line) => line.startsWith('INSERT INTO `__new_activity`'));
    expect(copy, 'the rebuild copies activity').toBeDefined();
    // The column exists in the new table and is never written by the copy, so
    // every old row lands with it null — no invented agent (D-114 item 6).
    expect(text).toMatch(/`agent_id` text,/);
    expect(copy).not.toContain('agent_id');
    // And nothing else in the migration writes it.
    expect(text).not.toMatch(/UPDATE\s+`?activity`?/i);
  });

  it(
    'keeps every activity row and its rowid with agent_id null, adds tasks.selected_agent_id in place',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) =>
        /^\d{4}_selected_agent_work_requests$/.test(e.tag),
      );
      expect(at, 'the LAI-535 migration is in the journal').toBeGreaterThan(0);
      // This one alone comes back, so a later migration is not read as its change.
      const dropped = journal.entries.splice(at).slice(0, 1);
      // The guard on this guard: the cut is exactly this migration.
      expect(dropped.map((e) => e.tag)).toEqual([
        expect.stringMatching(/_selected_agent_work_requests$/),
      ]);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        // drizzle's own migrator for the cut-back database: `runMigrations`
        // follows the pass with boot backfills that read `activity` through
        // the *current* schema, which names a column this database does not
        // have yet. The upgrade below is `runMigrations`, as a boot is.
        migrate(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const agentId = newId();
        const tokenId = newId();
        const taskId = newId();
        const statusId = db.get<{ id: string }>(
          sql`SELECT id FROM project_statuses WHERE project_id = ${s.projectId} AND category = 'backlog' LIMIT 1`,
        ).id;

        // Written as the pre-0062 schema has it. The token *is* an agent's —
        // and its old activity row must still not be credited to the agent.
        db.run(sql`
          INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, status, created_at)
          VALUES (${agentId}, ${s.orgId}, ${s.userId}, 'a', 'other', 'active', ${now})
        `);
        db.run(sql`
          INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, project_ids_json, created_at, agent_id)
          VALUES (${tokenId}, ${s.userId}, 'a', 'lai_abcd', ${newId()}, 'full', NULL, ${now}, ${agentId})
        `);
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${taskId}, ${s.projectId}, 1, 'Old', 'backlog', ${statusId}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        for (const kind of ['user', 'agent'] as const) {
          db.run(sql`
            INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, actor_token_id, type, payload_json, created_at)
            VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, ${s.userId}, ${kind},
                    ${kind === 'agent' ? tokenId : null}, 'task.updated', '{}', ${now})
          `);
        }

        const rootpage = (name: string) =>
          db.get<{ rootpage: number }>(
            sql`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
          )?.rootpage;
        const activityBefore = db.all<Record<string, unknown>>(
          sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`,
        );
        const tasksBefore = db.all<Record<string, unknown>>(sql`SELECT * FROM tasks`);
        const tasksPage = rootpage('tasks');

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        // activity: rebuilt for the CHECK, every row and rowid kept, agent_id null.
        expect(db.all(sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`)).toEqual(
          activityBefore.map((row) => ({ ...row, agent_id: null })),
        );
        // tasks: altered in place, not rebuilt.
        expect(rootpage('tasks')).toBe(tasksPage);
        expect(db.all(sql`SELECT * FROM tasks`)).toEqual(
          // `position` is the boot backfill's (LAI-472), which the upgrade runs.
          tasksBefore.map((row) => ({
            ...row,
            selected_agent_id: null,
            position: expect.any(String) as unknown,
          })),
        );
        expect(db.all(sql`SELECT * FROM handoff_offers`)).toEqual([]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

        // The rebuild did not cost the append-only guarantee.
        // On the driver, not through drizzle, whose wrapper hides the message.
        expect(() => sqlite.prepare(`UPDATE activity SET payload_json = '{"x":1}'`).run()).toThrow(
          /append-only/,
        );
        // The new verb is accepted.
        db.run(sql`
          INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, agent_id, type, payload_json, created_at)
          VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, ${s.userId}, 'agent', ${agentId}, 'task.agent_selected', '{}', ${now})
        `);
        // And the selection is a wish: losing the agent clears it, not the task.
        // (Via a second agent with no activity: `activity.agent_id` restricts.)
        const spare = newId();
        db.run(sql`
          INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, status, created_at)
          VALUES (${spare}, ${s.orgId}, ${s.userId}, 'b', 'other', 'active', ${now})
        `);
        db.run(sql`UPDATE tasks SET selected_agent_id = ${spare} WHERE id = ${taskId}`);
        db.run(sql`DELETE FROM agents WHERE id = ${spare}`);
        expect(db.get(sql`SELECT selected_agent_id AS v FROM tasks WHERE id = ${taskId}`)).toEqual({
          v: null,
        });
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0063 adds agent sessions and task claims on a populated database (LAI-541)', () => {
  it(
    'keeps every activity row, its rowid and its agent_id; the new tables start empty and hold their rules',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_agent_sessions_task_claims$/.test(e.tag));
      expect(at, 'the LAI-541 migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at).slice(0, 1);
      expect(dropped.map((e) => e.tag)).toEqual([
        expect.stringMatching(/_agent_sessions_task_claims$/),
      ]);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        migrate(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const agentId = newId();
        const tokenId = newId();
        const taskId = newId();
        const statusId = db.get<{ id: string }>(
          sql`SELECT id FROM project_statuses WHERE project_id = ${s.projectId} AND category = 'in_progress' LIMIT 1`,
        ).id;

        // As the 0062 schema has them: an agent, its token, a task, and
        // history credited to the agent — which the rebuild must carry over.
        db.run(sql`
          INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, status, created_at)
          VALUES (${agentId}, ${s.orgId}, ${s.userId}, 'a', 'other', 'active', ${now})
        `);
        db.run(sql`
          INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, project_ids_json, created_at, agent_id)
          VALUES (${tokenId}, ${s.userId}, 'a', 'lai_abcd', ${newId()}, 'full', NULL, ${now}, ${agentId})
        `);
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${taskId}, ${s.projectId}, 1, 'Held', 'in_progress', ${statusId}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        for (const kind of ['user', 'agent'] as const) {
          db.run(sql`
            INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, actor_token_id, agent_id, type, payload_json, created_at)
            VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, ${s.userId}, ${kind},
                    ${kind === 'agent' ? tokenId : null}, ${kind === 'agent' ? agentId : null},
                    'task.agent_selected', '{}', ${now})
          `);
        }
        const activityBefore = db.all<Record<string, unknown>>(
          sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`,
        );

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        // activity: rebuilt for the CHECK — every row, rowid and agent_id kept.
        expect(db.all(sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`)).toEqual(
          activityBefore,
        );
        expect(activityBefore.some((r) => r.agent_id === agentId)).toBe(true);
        expect(db.all(sql`SELECT * FROM agent_sessions`)).toEqual([]);
        expect(db.all(sql`SELECT * FROM task_claims`)).toEqual([]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        expect(() => sqlite.prepare(`UPDATE activity SET payload_json = '{"x":1}'`).run()).toThrow(
          /append-only/,
        );

        // The two new verbs are accepted.
        for (const type of ['task.claim_expired', 'task.claim_reclaimed']) {
          db.run(sql`
            INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, type, payload_json, created_at)
            VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, NULL, 'system', ${type}, '{}', ${now})
          `);
        }

        // One live claim per task, by the partial unique index; a terminal one
        // beside it is fine.
        const sessionId = newId();
        sqlite
          .prepare(
            `INSERT INTO agent_sessions (id, agent_id, token_id, started_at, last_heartbeat_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(sessionId, agentId, tokenId, now, now);
        const claim = sqlite.prepare(
          `INSERT INTO task_claims (id, task_id, session_id, agent_id, generation, lease_expires_at, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        claim.run(newId(), taskId, sessionId, agentId, 1, now, 'expired', now);
        claim.run(newId(), taskId, sessionId, agentId, 2, now, 'active', now);
        expect(() => claim.run(newId(), taskId, sessionId, agentId, 3, now, 'paused', now)).toThrow(
          /UNIQUE/,
        );
        // A generation is per task and never reused.
        expect(() =>
          claim.run(newId(), taskId, sessionId, agentId, 2, now, 'released', now),
        ).toThrow(/UNIQUE/);
        // An ended session says why, and only an ended one does.
        expect(() =>
          sqlite.prepare(`UPDATE agent_sessions SET ended_at = ? WHERE id = ?`).run(now, sessionId),
        ).toThrow(/CHECK/);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0064 adds the session line on a populated database (LAI-586, D-118)', () => {
  it(
    'keeps every activity and agent_sessions row as it was; the new columns start null and are never back-filled',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) =>
        /^\d{4}_agent_session_harness_model$/.test(e.tag),
      );
      expect(at, 'the LAI-586 migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at).slice(0, 1);
      expect(dropped.map((e) => e.tag)).toEqual([
        expect.stringMatching(/_agent_session_harness_model$/),
      ]);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        migrate(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const agentId = newId();
        const tokenId = newId();
        const taskId = newId();
        const sessionId = newId();
        const statusId = db.get<{ id: string }>(
          sql`SELECT id FROM project_statuses WHERE project_id = ${s.projectId} AND category = 'in_progress' LIMIT 1`,
        ).id;

        // As the 0063 schema has them: an agent with a session that reported a
        // model, a claim, and history — including a row the agent wrote.
        db.run(sql`
          INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, status, created_at)
          VALUES (${agentId}, ${s.orgId}, ${s.userId}, 'Polly · Belka', 'other', 'active', ${now})
        `);
        db.run(sql`
          INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, project_ids_json, created_at, agent_id)
          VALUES (${tokenId}, ${s.userId}, 'a', 'lai_abcd', ${newId()}, 'full', NULL, ${now}, ${agentId})
        `);
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${taskId}, ${s.projectId}, 1, 'Held', 'in_progress', ${statusId}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        db.run(sql`
          INSERT INTO agent_sessions (id, agent_id, token_id, started_at, last_heartbeat_at, client_version, model)
          VALUES (${sessionId}, ${agentId}, ${tokenId}, ${now}, ${now}, '1.2.0', 'gpt-5.5')
        `);
        db.run(sql`
          INSERT INTO task_claims (id, task_id, session_id, agent_id, generation, lease_expires_at, state, created_at)
          VALUES (${newId()}, ${taskId}, ${sessionId}, ${agentId}, 1, ${now}, 'active', ${now})
        `);
        for (const kind of ['user', 'agent'] as const) {
          db.run(sql`
            INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, actor_token_id, agent_id, type, payload_json, created_at)
            VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, ${s.userId}, ${kind},
                    ${kind === 'agent' ? tokenId : null}, ${kind === 'agent' ? agentId : null},
                    'task.updated', '{}', ${now})
          `);
        }
        const before = {
          activity: db.all<Record<string, unknown>>(
            sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`,
          ),
          sessions: db.all<Record<string, unknown>>(sql`SELECT * FROM agent_sessions`),
          claims: db.all<Record<string, unknown>>(sql`SELECT * FROM task_claims`),
        };
        expect(before.activity).toHaveLength(2);

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        const blank = {
          agent_session_id: null,
          session_harness: null,
          session_harness_version: null,
          session_model: null,
        };
        // Every row, rowid and value kept — the agent's own row included,
        // which gets no session guessed for it.
        expect(db.all(sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`)).toEqual(
          before.activity.map((row) => ({ ...row, ...blank })),
        );
        expect(db.all(sql`SELECT * FROM agent_sessions`)).toEqual(
          before.sessions.map((row) => ({ ...row, harness: null, harness_version: null })),
        );
        expect(db.all(sql`SELECT * FROM task_claims`)).toEqual(before.claims);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        // Still append-only.
        expect(() => sqlite.prepare(`UPDATE activity SET session_model = 'x'`).run()).toThrow(
          /append-only/,
        );
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0065 adds recognised devices on a populated database (LAI-590)', () => {
  it(
    'keeps every agent row; every label already in use starts recognised, keyed as requests key it',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_recognised_agent_devices$/.test(e.tag));
      expect(at, 'the LAI-590 migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at).slice(0, 1);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        migrate(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const other = newId();
        db.run(sql`
          INSERT INTO users (id, email, name, org_role, is_active, created_at, updated_at)
          VALUES (${other}, 'other@example.test', 'Other', 'member', 1, ${now}, ${now})
        `);
        // Unicode case, padding, null and blank: the key must be the one
        // `deviceLabelKey` gives a request, not SQLite's ASCII-only lower().
        const rows: [string, string | null, number][] = [
          [s.userId, '  BÉLKA ', now + 3],
          [s.userId, 'bélka', now + 1],
          [s.userId, null, now + 5],
          [s.userId, '', now + 4],
          [other, 'Strelka', now + 2],
        ];
        for (const [owner, label, at] of rows) {
          db.run(sql`
            INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, device_label, status, created_at)
            VALUES (${newId()}, ${s.orgId}, ${owner}, 'a', 'other', ${label}, 'active', ${at})
          `);
        }
        const before = db.all(sql`SELECT * FROM agents ORDER BY id`);

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        expect(db.all(sql`SELECT * FROM agents ORDER BY id`)).toEqual(before);
        expect(
          db.all(
            sql`SELECT owner_user_id, label_key, created_at FROM recognised_agent_devices ORDER BY owner_user_id, label_key`,
          ),
        ).toEqual(
          [
            { owner_user_id: s.userId, label_key: '', created_at: now + 4 },
            { owner_user_id: s.userId, label_key: 'bélka', created_at: now + 1 },
            { owner_user_id: other, label_key: 'strelka', created_at: now + 2 },
          ].sort((x, y) =>
            x.owner_user_id === y.owner_user_id
              ? x.label_key < y.label_key
                ? -1
                : 1
              : x.owner_user_id < y.owner_user_id
                ? -1
                : 1,
          ),
        );
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0066 adds context revisions to a populated database (LAI-555)', () => {
  it(
    'makes each non-empty context_md revision 1, keeps context_md, rebuilds nothing',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_project_context_revisions$/.test(e.tag));
      expect(at, 'the revisions migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at).slice(0, 1);
      // The guard on this guard: the cut is exactly this migration.
      expect(dropped.map((e) => e.tag)).toEqual([
        expect.stringMatching(/_project_context_revisions$/),
      ]);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        // Written as the pre-0066 schema has it, raw: no context_revision.
        const edited = newId();
        const unedited = newId();
        db.run(sql`
          INSERT INTO projects (id, org_id, name, slug, prefix, created_at, updated_at)
          VALUES (${edited}, ${s.orgId}, 'Edited', 'edited', 'EDT', 1000, 5000),
                 (${unedited}, ${s.orgId}, 'Unedited', 'unedited', 'UNE', 1000, 7000)
        `);
        db.run(sql`UPDATE projects SET context_md = 'old brief' WHERE id = ${unedited}`);
        db.run(sql`UPDATE projects SET context_md = '# The brief' WHERE id = ${edited}`);
        // Two edits, the later one by the person who wrote what is there now;
        // and an unrelated project update that must not count.
        for (const [at, payload] of [
          [2000, '{"changed":["context_md"],"length":3,"previous_length":0}'],
          [3000, '{"changed":["context_md"],"length":11,"previous_length":3}'],
          [4000, '{"changed":["name"]}'],
        ] as const) {
          db.run(sql`
            INSERT INTO activity (id, org_id, project_id, actor_id, actor_kind, type, payload_json, created_at)
            VALUES (${newId()}, ${s.orgId}, ${edited}, ${s.userId}, 'user',
              ${payload.includes('context_md') ? 'project.context_updated' : 'project.updated'},
              ${payload}, ${at})
          `);
        }

        const rootpage = (name: string) =>
          db.get<{ rootpage: number }>(
            sql`SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
          )?.rootpage;
        const projectsBefore = db.all<Record<string, unknown>>(
          sql`SELECT * FROM projects ORDER BY id`,
        );
        const activityBefore = db.all<Record<string, unknown>>(sql`SELECT * FROM activity`);
        const projectsPage = rootpage('projects');

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        // Additive: the same table, every row kept, `context_md` untouched —
        // so a rollback still has the document — and the revision set.
        expect(rootpage('projects')).toBe(projectsPage);
        expect(db.all(sql`SELECT * FROM projects ORDER BY id`)).toEqual(
          projectsBefore.map((row) => ({
            ...row,
            context_revision: row.context_md === '' ? 0 : 1,
          })),
        );
        expect(db.all(sql`SELECT * FROM activity`)).toEqual(activityBefore);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);

        const revisions = db.all<Record<string, unknown>>(
          sql`SELECT project_id, revision, body, author_id, agent_id, created_at
              FROM project_context_revisions ORDER BY body`,
        );
        expect(revisions).toEqual([
          {
            project_id: edited,
            revision: 1,
            body: '# The brief',
            author_id: s.userId,
            agent_id: null,
            created_at: 3000,
          },
          {
            project_id: unedited,
            revision: 1,
            body: 'old brief',
            author_id: null,
            agent_id: null,
            created_at: 7000,
          },
        ]);
        const ids = db.all<{ id: string }>(sql`SELECT id FROM project_context_revisions`);
        expect(ids.every((r) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(r.id))).toBe(true);

        // And the rows are immutable from the first boot.
        expectSqliteError(
          () => db.run(sql`UPDATE project_context_revisions SET body = 'rewritten'`),
          /append-only: UPDATE/,
        );
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0068 widens handoff_offers on a populated 0067 database (LAI-546)', () => {
  it(
    'keeps every work request, task and activity row; cancelled requests read selection_changed',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_handoff_offers$/.test(e.tag));
      expect(at, 'the LAI-546 migration is in the journal').toBeGreaterThan(0);
      const dropped = journal.entries.splice(at).slice(0, 1);
      // The guard on this guard: the cut is exactly this migration.
      expect(dropped.map((e) => e.tag)).toEqual([expect.stringMatching(/_handoff_offers$/)]);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        // 0065's and 0066's steps call the functions `runMigrations`
        // registers; drizzle's own migrator for the cut-back needs them too.
        sqlite.function('laika_device_label_key', { deterministic: true }, (label) =>
          deviceLabelKey(typeof label === 'string' ? label : null),
        );
        sqlite.function('laika_new_id', { deterministic: false }, () => newId());
        migrate(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const agentId = newId();
        const taskId = newId();
        const statusId = db.get<{ id: string }>(
          sql`SELECT id FROM project_statuses WHERE project_id = ${s.projectId} AND category = 'backlog' LIMIT 1`,
        ).id;

        // Written as the 0066 schema has them: raw SQL, because the current
        // schema names columns this database does not have yet.
        db.run(sql`
          INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, status, created_at)
          VALUES (${agentId}, ${s.orgId}, ${s.userId}, 'a', 'other', 'active', ${now})
        `);
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at, selected_agent_id)
          VALUES (${taskId}, ${s.projectId}, 1, 'Old', 'backlog', ${statusId}, 'p2', ${s.userId}, 'api', ${now}, ${now}, ${agentId})
        `);
        const offers = [
          ['open', null],
          ['cancelled', now + 1],
          ['accepted', now + 2],
        ] as const;
        for (const [state, closedAt] of offers) {
          db.run(sql`
            INSERT INTO handoff_offers (id, task_id, kind, to_agent_id, state, created_by_user_id, created_at, closed_at)
            VALUES (${newId()}, ${taskId}, 'work_request', ${agentId}, ${state}, ${s.userId}, ${now}, ${closedAt})
          `);
        }
        db.run(sql`
          INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, type, payload_json, created_at)
          VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, ${s.userId}, 'user', 'task.agent_selected', '{}', ${now})
        `);

        const offersBefore = db.all<Record<string, unknown>>(
          sql`SELECT * FROM handoff_offers ORDER BY created_at, closed_at`,
        );
        const tasksBefore = db.all<Record<string, unknown>>(sql`SELECT * FROM tasks`);
        const activityBefore = db.all<Record<string, unknown>>(
          sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`,
        );

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        expect(db.all(sql`SELECT * FROM handoff_offers ORDER BY created_at, closed_at`)).toEqual(
          offersBefore.map((row) => ({
            ...row,
            idempotency_key: null,
            from_session_id: null,
            from_claim_generation: null,
            checkpoint_id: null,
            checkpoint_commit_sha: null,
            reason: null,
            note_hash: null,
            requires_approval: 0,
            approved_by_user_id: null,
            approved_at: null,
            expires_at: null,
            accepted_session_id: null,
            accepted_claim_id: null,
            receiver_commit_sha: null,
            closed_reason: row.state === 'cancelled' ? 'selection_changed' : null,
          })),
        );
        expect(db.all(sql`SELECT * FROM tasks`)).toEqual(
          tasksBefore.map((row) => ({
            ...row,
            handoff_count: 0,
            position: expect.any(String) as unknown,
          })),
        );
        expect(db.all(sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`)).toEqual(
          activityBefore,
        );
        expect(db.all(sql`SELECT * FROM project_handoff_policies`)).toEqual([]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        // The rebuilt activity table is still append-only, and takes the new verbs.
        expect(() => sqlite.prepare(`UPDATE activity SET payload_json = '{"x":1}'`).run()).toThrow(
          /append-only/,
        );
        db.run(sql`
          INSERT INTO activity (id, org_id, project_id, task_id, actor_id, actor_kind, type, payload_json, created_at)
          VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${taskId}, NULL, 'system', 'task.recovered', '{}', ${now})
        `);
        // One live hand-off or recovery per task, by the new partial index.
        const live = () =>
          sqlite
            .prepare(
              `INSERT INTO handoff_offers (id, task_id, kind, state, created_by_user_id, created_at)
               VALUES (?, ?, 'recovery', 'open', ?, ?)`,
            )
            .run(newId(), taskId, s.userId, now);
        live();
        expect(live).toThrow(/UNIQUE/);
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0067 and 0068 keep context revisions on a populated 0066 database (Phase 3 integration)', () => {
  it(
    'a database at 0066 — revisions, deliveries, activity — upgrades with every row kept',
    { timeout: UPGRADE_BUDGET_MS },
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
      copyMigrations(dir);
      const journalPath = join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const at = journal.entries.findIndex((e) => /^\d{4}_checkpoints$/.test(e.tag));
      expect(at, 'the checkpoints migration is in the journal').toBeGreaterThan(0);
      // Production stands at the context revisions; everything after it is cut.
      expect(journal.entries[at - 1]?.tag).toMatch(/_project_context_revisions$/);
      const dropped = journal.entries.splice(at);
      // The guard on this guard: the cut is exactly the two Phase 3 migrations
      // and LAI-553's agent events, which a 0066 database also upgrades through.
      expect(dropped.map((e) => e.tag)).toEqual([
        expect.stringMatching(/_checkpoints$/),
        expect.stringMatching(/_handoff_offers$/),
        expect.stringMatching(/_agent_events$/),
      ]);
      writeFileSync(journalPath, JSON.stringify(journal));

      const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
      const { db, sqlite } = openDb({ path: join(dbDir, 'laika.db') });
      try {
        runMigrations(db, { migrationsFolder: dir });
        const s = seed(db);
        const now = Date.now();
        const agentId = newId();
        const tokenId = newId();
        const sessionId = newId();
        const taskId = newId();
        const statusId = db.get<{ id: string }>(
          sql`SELECT id FROM project_statuses WHERE project_id = ${s.projectId} AND category = 'backlog' LIMIT 1`,
        ).id;

        // Written as the 0066 schema has them: raw SQL, because the current
        // schema names columns this database does not have yet.
        db.run(sql`
          INSERT INTO agents (id, org_id, owner_user_id, display_name, harness, status, created_at)
          VALUES (${agentId}, ${s.orgId}, ${s.userId}, 'a', 'other', 'active', ${now})
        `);
        db.run(sql`
          INSERT INTO tokens (id, user_id, name, prefix, token_hash, scope, project_ids_json, created_at, agent_id)
          VALUES (${tokenId}, ${s.userId}, 'a', 'lai_abcd', ${newId()}, 'full', NULL, ${now}, ${agentId})
        `);
        db.run(sql`
          INSERT INTO agent_sessions (id, agent_id, token_id, started_at, last_heartbeat_at)
          VALUES (${sessionId}, ${agentId}, ${tokenId}, ${now}, ${now})
        `);
        db.run(sql`
          INSERT INTO tasks (id, project_id, number, title, status, status_id, priority, created_by, created_via, created_at, updated_at)
          VALUES (${taskId}, ${s.projectId}, 1, 'Old', 'backlog', ${statusId}, 'p2', ${s.userId}, 'api', ${now}, ${now})
        `);
        db.run(sql`
          UPDATE projects SET context_md = 'second', context_revision = 2 WHERE id = ${s.projectId}
        `);
        for (const [revision, body] of [
          [1, 'first'],
          [2, 'second'],
        ] as const) {
          db.run(sql`
            INSERT INTO project_context_revisions (id, project_id, revision, body, author_id, agent_id, created_at)
            VALUES (${newId()}, ${s.projectId}, ${revision}, ${body}, ${s.userId},
                    ${revision === 2 ? agentId : null}, ${now + revision})
          `);
          db.run(sql`
            INSERT INTO activity (id, org_id, project_id, actor_id, actor_kind, type, payload_json, created_at)
            VALUES (${newId()}, ${s.orgId}, ${s.projectId}, ${s.userId}, 'user', 'project.context_updated',
                    ${`{"changed":["context_md"],"revision":${String(revision)}}`}, ${now + revision})
          `);
        }
        db.run(sql`
          INSERT INTO agent_session_context_deliveries (session_id, project_id, revision, delivered_at)
          VALUES (${sessionId}, ${s.projectId}, 2, ${now + 3})
        `);

        const read = () => ({
          projects: db.all<Record<string, unknown>>(sql`SELECT * FROM projects ORDER BY id`),
          revisions: db.all<Record<string, unknown>>(
            sql`SELECT * FROM project_context_revisions ORDER BY project_id, revision`,
          ),
          deliveries: db.all<Record<string, unknown>>(
            sql`SELECT * FROM agent_session_context_deliveries`,
          ),
          sessions: db.all<Record<string, unknown>>(sql`SELECT * FROM agent_sessions`),
          activity: db.all<Record<string, unknown>>(
            sql`SELECT rowid AS seq, * FROM activity ORDER BY rowid`,
          ),
        });
        const before = read();
        expect(before.revisions).toHaveLength(2);
        expect(before.deliveries).toHaveLength(1);
        const tasksBefore = db.all<Record<string, unknown>>(sql`SELECT * FROM tasks`);

        journal.entries.push(...dropped);
        writeFileSync(journalPath, JSON.stringify(journal));
        runMigrations(db, { migrationsFolder: dir });

        // 0067 and 0068 rebuild `activity`; nothing of LAI-555's is touched.
        expect(read()).toEqual(before);
        expect(db.all(sql`SELECT * FROM tasks`)).toEqual(
          tasksBefore.map((row) => ({
            ...row,
            handoff_count: 0,
            position: expect.any(String) as unknown,
          })),
        );
        expect(db.all(sql`SELECT * FROM task_checkpoints`)).toEqual([]);
        expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
        // Every journal entry is applied, once.
        expect(db.get<{ n: number }>(sql`SELECT count(*) AS n FROM __drizzle_migrations`).n).toBe(
          journal.entries.length,
        );
        // The revisions are still immutable, and the rebuilt activity still append-only.
        expectSqliteError(
          () => db.run(sql`UPDATE project_context_revisions SET body = 'rewritten'`),
          /append-only: UPDATE/,
        );
        expect(() => sqlite.prepare(`UPDATE activity SET payload_json = '{"x":1}'`).run()).toThrow(
          /append-only/,
        );
      } finally {
        sqlite.close();
        rmSync(dbDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
