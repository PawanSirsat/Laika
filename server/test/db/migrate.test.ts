import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendActivity } from '../../src/db/activity.ts';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/client.ts';
import { ensureActivityTriggers, MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import { expectSqliteError, freshDb, seed, type TestDb } from '../helpers/db.ts';
import { eq } from 'drizzle-orm';
import { newId } from '../../src/db/ids.ts';
import { tasks } from '../../src/db/schema.ts';
import { statusForCategory } from '../../src/db/project-statuses.ts';

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
        appendActivity(db, { orgId: s.orgId, actorKind: 'system', type: 'webhook.commit' });
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
      const dropped = journal.entries.splice(at);
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
