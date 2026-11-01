import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/client.ts';
import {
  MIGRATIONS_FOLDER,
  PRE_MIGRATION_PREFIX,
  SCHEMA_AHEAD_MARKER,
  migrationsAhead,
  runMigrations,
} from '../../src/db/migrate.ts';

/**
 * A build refuses a database a newer build has migrated (LAI-1033).
 *
 * CI's rollback puts the previous image back on the database the failed
 * deploy migrated. Drizzle applies only journal entries newer than the newest
 * applied one, so the older image used to apply nothing and boot — past 0061,
 * ignoring agent grants and claims (docs/AGENTS-ROLLOUT.md § 7). "An older
 * build" here is the real migrations folder with its newest entries cut off,
 * which is exactly what the previous image carries.
 */

let dir: string;
const open: { close: () => void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'laika-ahead-'));
});
afterEach(() => {
  for (const o of open.splice(0)) o.close();
  rmSync(dir, { recursive: true, force: true });
});

function db(name = 'laika.db') {
  const handle = openDb({ path: join(dir, name) });
  open.push({
    close: () => {
      handle.sqlite.close();
    },
  });
  return handle;
}

/** The migrations folder as a build `cut` entries older would carry it. */
function olderBuild(cut: number): { folder: string; dropped: { tag: string; when: number }[] } {
  const folder = mkdtempSync(join(dir, 'migrations-'));
  cpSync(MIGRATIONS_FOLDER, folder, {
    recursive: true,
    filter: (source) => !source.endsWith('_snapshot.json'),
  });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  const dropped = journal.entries.splice(journal.entries.length - cut);
  writeFileSync(journalPath, JSON.stringify(journal));
  // The guard on the fixture: it really is older, by exactly `cut`.
  expect(dropped).toHaveLength(cut);
  return { folder, dropped };
}

describe('a build on a database a newer build migrated', () => {
  it('refuses to start and names every migration it does not know', () => {
    const { db: d, sqlite } = db();
    runMigrations(d);
    const { folder, dropped } = olderBuild(2);

    expect(migrationsAhead(sqlite, folder).map((m) => m.createdAt)).toEqual(
      dropped.map((e) => e.when),
    );

    let message = '';
    try {
      runMigrations(d, { migrationsFolder: folder });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.startsWith(`${SCHEMA_AHEAD_MARKER}: `), message).toBe(true);
    expect(message).toContain('2 migration(s) this build does not know');
    for (const entry of dropped) expect(message).toContain(new Date(entry.when).toISOString());
  });

  it('refuses before it writes anything, snapshot included', () => {
    const { db: d, sqlite } = db();
    runMigrations(d);
    const backupDir = join(dir, 'backups');
    const before = sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get();

    expect(() => {
      runMigrations(d, {
        migrationsFolder: olderBuild(1).folder,
        backup: { sqlite, dir: backupDir },
      });
    }).toThrow(SCHEMA_AHEAD_MARKER);

    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get()).toEqual(
      before,
    );
    let snapshots: string[] = [];
    try {
      snapshots = readdirSync(backupDir).filter((n) => n.startsWith(PRE_MIGRATION_PREFIX));
    } catch {
      // No directory at all is the same answer: nothing was written.
    }
    expect(snapshots).toEqual([]);
  });
});

describe('a build on a database it knows all of', () => {
  it('starts when every applied migration is its own', () => {
    const { db: d, sqlite } = db();
    runMigrations(d);

    expect(migrationsAhead(sqlite)).toEqual([]);
    expect(() => {
      runMigrations(d);
    }).not.toThrow();
  });

  it('starts, and migrates forward, on a database an older build left behind', () => {
    // **The upgrade, which is every deploy.** An older database is behind this
    // build, never ahead of it.
    const { db: d, sqlite } = db();
    const { folder } = olderBuild(3);
    runMigrations(d, { migrationsFolder: folder });
    expect(() => {
      runMigrations(d, { migrationsFolder: folder });
    }).not.toThrow();

    runMigrations(d);
    expect(migrationsAhead(sqlite)).toEqual([]);
  });

  it('has nothing to compare on a database that has never migrated', () => {
    const { sqlite } = db();
    expect(migrationsAhead(sqlite)).toEqual([]);
  });
});

describe('the real boot path', () => {
  it(
    'exits 1 with the marker first on stderr, which host-restart.sh greps for',
    { timeout: 60_000 },
    () => {
      const { db: d } = db();
      runMigrations(d);
      for (const o of open.splice(0)) o.close();

      // An older build is simulated from the database side here: one extra
      // applied row, newer than anything this build carries.
      const handle = openDb({ path: join(dir, 'laika.db') });
      const future = Date.UTC(2099, 0, 1);
      handle.sqlite
        .prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
        .run('f'.repeat(64), future);
      handle.sqlite.close();

      const server = fileURLToPath(new URL('../..', import.meta.url));
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
        cwd: server,
        encoding: 'utf8',
        timeout: 50_000,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'development',
          // Never bound: the refusal comes before the listener. A server that
          // did start would run until the timeout and fail the status check.
          PORT: '39771',
          LAIKA_DB_PATH: join(dir, 'laika.db'),
          LAIKA_SECRET: 'x'.repeat(48),
        },
      });

      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr.startsWith(`${SCHEMA_AHEAD_MARKER}: `), result.stderr).toBe(true);
      expect(result.stderr).toContain(new Date(future).toISOString());
    },
  );
});
