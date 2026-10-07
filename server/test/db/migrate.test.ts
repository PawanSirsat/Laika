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

    expect(() => ensureActivityTriggers(t.db)).toThrow(/present but does not abort/i);

    // And the state it refused really was broken, rather than merely unfamiliar.
    t.db.run(sql`DELETE FROM activity`);
    expect(t.db.all(sql`SELECT id FROM activity`)).toEqual([]);
  });
});

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
    cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    // **Cut back to just before the rebuild, not "the last one".** This popped
    // a single entry and asserted it was 0024; LAI-472 added 0025 after it, so
    // "the last" stopped meaning "the rebuild". Every entry from 0024 on goes.
    const at = journal.entries.findIndex((e) => /^0024_/.test(e.tag));
    const dropped = journal.entries.splice(at);
    // The guard on this guard: the first entry cut must be the tasks rebuild,
    // or this proves nothing about it.
    expect(dropped[0]?.tag).toMatch(/^0024_/);
    writeFileSync(journalPath, JSON.stringify(journal));
    return dir;
  }

  it('migrates a populated pre-rebuild database with nothing dangling', () => {
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
  });
});
