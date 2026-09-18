import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/client.ts';
import {
  MIGRATIONS_FOLDER,
  PRE_MIGRATION_PREFIX,
  pendingMigrations,
  runMigrations,
} from '../../src/db/migrate.ts';
import { pruneBackups, KEEP_BACKUPS, backupFilename } from '../../src/jobs/backup.ts';
import { users } from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';

/**
 * A copy of the database before the schema changes (M7, LAI-468).
 *
 * §11.6's job snapshots on a schedule. **The riskiest moment in a self-hosted
 * product's life is the first boot after an upgrade**, and it was the one moment
 * with no fresh copy behind it — a nightly snapshot can be twenty-three hours
 * old when the schema moves.
 *
 * LAI-466 proved a snapshot restores. This makes sure there is one to restore.
 */

const NOW = Date.UTC(2026, 8, 10, 1, 30);

let dir: string;
let backupDir: string;
const open: { close: () => void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'laika-premig-'));
  backupDir = join(dir, 'backups');
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

const snapshots = (): string[] =>
  readdirSync(backupDir).filter((n) => n.startsWith(PRE_MIGRATION_PREFIX));

describe('a snapshot is taken when, and only when, there is something to migrate', () => {
  it('writes one on a database that has never migrated', () => {
    const { db: d, sqlite } = db();

    // Everything is pending, which is the right answer for a fresh file.
    expect(pendingMigrations(sqlite).length).toBeGreaterThan(20);

    runMigrations(d, { backup: { sqlite, dir: backupDir, now: NOW } });

    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0]).toBe(`${PRE_MIGRATION_PREFIX}2026-09-10T01-30-00-000Z.sqlite`);
  });

  it('writes none on a restart with an unchanged schema', () => {
    // **The other direction, and it is the one that matters operationally.** A
    // snapshot per boot fills the directory, and a crash-loop would do it in
    // minutes.
    const { db: d, sqlite } = db();
    runMigrations(d, { backup: { sqlite, dir: backupDir, now: NOW } });
    expect(snapshots()).toHaveLength(1);

    expect(pendingMigrations(sqlite)).toEqual([]);
    runMigrations(d, { backup: { sqlite, dir: backupDir, now: NOW + 60_000 } });
    runMigrations(d, { backup: { sqlite, dir: backupDir, now: NOW + 120_000 } });

    expect(snapshots(), 'a restart with nothing pending wrote a snapshot').toHaveLength(1);
  });

  it('asks the same question the migrator asks', () => {
    // `pendingMigrations` and `migrate()` must agree, or a snapshot gets written
    // on every boot for ever because one of them thinks there is work.
    const { db: d, sqlite } = db();
    runMigrations(d);

    const applied = (
      sqlite.prepare('SELECT COUNT(*) AS n FROM "__drizzle_migrations"').get() as { n: number }
    ).n;
    const onDisk = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql')).length;

    expect(applied).toBe(onDisk);
    expect(pendingMigrations(sqlite)).toEqual([]);
  });
});

describe('the nightly prune cannot delete a pre-upgrade copy', () => {
  it('leaves it alone while pruning its own fourteen', () => {
    // §11.6 keeps fourteen by filename. **A pre-upgrade copy a nightly prune can
    // delete is the one you wanted**, so the prefixes do not overlap — and this
    // asserts it rather than leaving a reader to notice.
    const { db: d, sqlite } = db();
    runMigrations(d, { backup: { sqlite, dir: backupDir, now: NOW } });
    expect(snapshots()).toHaveLength(1);

    // Well past the limit, so the prune definitely runs.
    for (let i = 0; i < KEEP_BACKUPS + 5; i++) {
      writeFileSync(join(backupDir, backupFilename(NOW + i * 86_400_000)), 'x');
    }

    const deleted = pruneBackups(backupDir);

    expect(deleted).toBe(5);
    expect(snapshots(), 'the nightly prune deleted the pre-upgrade copy').toHaveLength(1);
  });
});

describe('a failed migration', () => {
  /**
   * A folder whose **second** migration throws, the first having succeeded.
   *
   * That ordering is the case the snapshot exists for. SQLite's DDL is
   * transactional so a single bad statement rolls back — but `migrate()` applies
   * files *in sequence* with no transaction spanning them, so `0000` lands,
   * `0001` fails, and the database is neither version.
   *
   * `when` is parameterised because drizzle decides what is pending by
   * timestamp: values older than the newest applied row are treated as already
   * done, and the migration silently does not run. That cost a debugging round
   * here, and it is the same trap as the cap's window — a comparison against
   * stored state that quietly answers "nothing to do".
   */
  function brokenFolder(when = 1): string {
    const broken = join(dir, `broken-migrations-${String(when)}`);
    mkdirSync(join(broken, 'meta'), { recursive: true });

    const journal = {
      version: '7',
      dialect: 'sqlite',
      entries: [
        { idx: 0, version: '6', when, tag: '0000_fine', breakpoints: true },
        { idx: 1, version: '6', when: when + 1, tag: '0001_broken', breakpoints: true },
      ],
    };
    writeFileSync(join(broken, 'meta', '_journal.json'), JSON.stringify(journal));
    writeFileSync(join(broken, '0000_fine.sql'), 'CREATE TABLE kept (id text primary key);');
    // Valid enough to be read, invalid enough to throw when applied.
    writeFileSync(join(broken, '0001_broken.sql'), 'CREATE TABLE kept (id text primary key);');

    return broken;
  }

  it('leaves the snapshot in place and names its path in the error', () => {
    // The operator is reading a crash log at this moment, not listing a
    // directory — a snapshot they do not know about is one they will not use.
    const { db: d, sqlite } = db();
    const migrationsFolder = brokenFolder();

    let thrown: unknown;
    try {
      runMigrations(d, { migrationsFolder, backup: { sqlite, dir: backupDir, now: NOW } });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;

    // Asserted on the path, not merely that something threw: a bare
    // `toThrow()` here would pass on the original SQLite error, which names no
    // snapshot at all.
    expect(message).toContain(PRE_MIGRATION_PREFIX);
    expect(message).toContain(backupDir);
    expect((thrown as Error).cause, 'the original failure was discarded').toBeDefined();

    // And the file is really there, with the name the message gave.
    const named = message.split(' ').find((w) => w.includes(PRE_MIGRATION_PREFIX)) ?? '';
    expect(readdirSync(backupDir)).toContain(named.slice(named.lastIndexOf('/') + 1));
  });

  it('leaves a snapshot that boots, which is the point of taking it', () => {
    // A path in an error is worth nothing if the file behind it is not usable.
    // LAI-466 proves a restored snapshot serves; this proves *this* snapshot is
    // one of those.
    const { db: d, sqlite } = db();
    const id = newId();
    runMigrations(d);
    d.insert(users)
      .values({
        id,
        email: `${id}@example.test`,
        name: 'Ada',
        orgRole: 'owner',
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      })
      .run();

    // Now a "new version" arrives whose migration fails.
    expect(() =>
      runMigrations(d, {
        // Newer than every real migration, or drizzle treats them as applied.
        migrationsFolder: brokenFolder(9_000_000_000_000),
        backup: { sqlite, dir: backupDir, now: NOW },
      }),
    ).toThrow(/pre-migration-/);

    const taken = join(backupDir, snapshots()[0] ?? '');
    const restored = join(dir, 'restored.db');
    copyFileSync(taken, restored);

    const back = db('restored.db');
    expect(back.sqlite.prepare('SELECT name FROM users WHERE id = ?').get(id)).toEqual({
      name: 'Ada',
    });
    // The schema came with it — a copy that lost the journal would re-run
    // everything against populated tables on the next boot.
    expect(pendingMigrations(back.sqlite)).toEqual([]);
  });
});
