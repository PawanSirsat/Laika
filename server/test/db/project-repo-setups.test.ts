import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, openDb } from '../../src/db/client.ts';
import { newId } from '../../src/db/ids.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import { seed } from '../helpers/db.ts';

/**
 * Migration `0073` (SPEC §4.82, LAI-1066; plan LAI-1042 §K "Migration"):
 * `project_repo_setups` is **additive** — one new table and its indexes, no
 * table rebuilt and no row of any other table touched — and running the
 * migrations again over an upgraded database changes nothing.
 */

const TAG = '0073_project_repo_setups';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

/** A copy of the migrations, cut back to before `0073`. */
function folderBefore0073(): string {
  const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
  cpSync(MIGRATIONS_FOLDER, dir, {
    recursive: true,
    filter: (source) => !source.endsWith('_snapshot.json'),
  });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === TAG);
  expect(at, 'the LAI-1066 migration is in the journal').toBeGreaterThan(0);
  // The guard on this guard: the cut drops exactly 0073 and what came after
  // it — LAI-1038's capacity pings, which a 0072 database also upgrades
  // through. A later migration lands here and says so.
  expect(journal.entries.slice(at).map((e) => e.tag)).toEqual([
    TAG,
    '0074_agent_capacity',
    '0075_task_deliverables',
  ]);
  journal.entries.splice(at);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

/**
 * A copy of the migrations that ends **at** `0073`, so an upgrade through it
 * applies this migration and nothing later: 0074 rebuilds `activity` for its
 * new verb (LAI-1038), which is that migration's to prove, not this one's.
 */
function folderThrough0073(): string {
  const dir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
  cpSync(MIGRATIONS_FOLDER, dir, {
    recursive: true,
    filter: (source) => !source.endsWith('_snapshot.json'),
  });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === TAG);
  journal.entries.splice(at + 1);
  expect(journal.entries.at(-1)?.tag).toBe(TAG);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

function dbAt0072(dir: string) {
  const dbDir = mkdtempSync(join(tmpdir(), 'laika-db-'));
  const opened = openDb({ path: join(dbDir, 'laika.db') });
  cleanups.push(() => {
    opened.sqlite.close();
    rmSync(dbDir, { recursive: true, force: true });
  });
  // The boot path, cut back: it registers the SQL functions 0065–0070 call.
  runMigrations(opened.db, { migrationsFolder: dir });
  return opened;
}

/** Every table's rows, and every object's SQL, but the new table's. */
function everythingElse(db: Db) {
  const names = db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          AND name NOT IN ('project_repo_setups', '__drizzle_migrations') ORDER BY name`,
    )
    .map((r) => r.name);
  expect(names.length, 'the snapshot reads real tables').toBeGreaterThan(40);
  return {
    rows: Object.fromEntries(
      names.map((name) => [name, db.all(sql.raw(`SELECT * FROM "${name}" ORDER BY rowid`))]),
    ),
    schema: db.all(
      sql`SELECT type, name, sql FROM sqlite_master
          WHERE tbl_name NOT IN ('project_repo_setups', '__drizzle_migrations') ORDER BY name`,
    ),
  };
}

describe('0073 project_repo_setups', () => {
  it('only creates: no DROP, ALTER, rebuild or copy in its SQL', () => {
    const file = readdirSync(MIGRATIONS_FOLDER).find((f) => f.startsWith(TAG));
    expect(file, 'the migration file exists').toBeDefined();
    const text = readFileSync(join(MIGRATIONS_FOLDER, file ?? ''), 'utf8');
    expect(text).toMatch(/CREATE TABLE `project_repo_setups`/);
    // Statement by statement: `ON DELETE cascade` inside a CREATE is not a write.
    const statements = text.split('--> statement-breakpoint').map((part) => part.trim());
    expect(statements.length).toBeGreaterThan(1);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE (TABLE|INDEX) /);
    }
    expect(text).not.toMatch(/__new_/);
  });

  it('upgrades a populated 0072 database without touching another row, and again is a no-op', () => {
    const { db, sqlite } = dbAt0072(folderBefore0073());
    const s = seed(db);
    const before = everythingElse(db);
    const through = folderThrough0073();

    runMigrations(db, { migrationsFolder: through });
    expect(everythingElse(db)).toEqual(before);
    expect(db.all(sql`SELECT * FROM project_repo_setups`)).toEqual([]);

    // A row recorded after the upgrade survives running the migrations again.
    const id = newId();
    db.run(sql`
      INSERT INTO project_repo_setups (id, org_id, owner_user_id, agent_id, project_id, repo_key,
        repo_label, instructions_path, block_found, template_revision, project_match,
        prefix_match, source, checked_at)
      VALUES (${id}, ${s.orgId}, ${s.userId}, NULL, ${s.projectId}, '', NULL, 'CLAUDE.md', 1, 2,
        NULL, NULL, 'self_reported_browser', NULL)
    `);
    const upgraded = everythingElse(db);
    const migrations = db.all(sql`SELECT * FROM __drizzle_migrations`);
    runMigrations(db, { migrationsFolder: through });
    expect(everythingElse(db)).toEqual(upgraded);
    expect(db.all(sql`SELECT * FROM __drizzle_migrations`)).toEqual(migrations);
    expect(db.all(sql`SELECT id FROM project_repo_setups`)).toEqual([{ id }]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('refuses a source outside the closed set', () => {
    const { db, sqlite } = dbAt0072(folderBefore0073());
    runMigrations(db);
    const s = seed(db);
    const insert = sqlite.prepare(
      `INSERT INTO project_repo_setups (id, org_id, owner_user_id, project_id, repo_key,
         block_found, source) VALUES (?, ?, ?, ?, '', 1, ?)`,
    );
    expect(() => insert.run(newId(), s.orgId, s.userId, s.projectId, 'server_scan')).toThrow(
      /CHECK constraint failed: project_repo_setups_source_check/,
    );
    // The control: the same row with a source in the set is accepted.
    expect(insert.run(newId(), s.orgId, s.userId, s.projectId, 'local_check').changes).toBe(1);
  });
});
