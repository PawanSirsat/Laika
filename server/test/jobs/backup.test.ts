import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { users } from '../../src/db/schema.ts';
import { backupFilename, KEEP_BACKUPS, pruneBackups, snapshot } from '../../src/jobs/backup.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The nightly snapshot (§11.6, LAI-431).
 *
 * **A snapshot nobody has restored is a file, not a backup** — so the test that
 * matters opens the written file as a database and reads a row out of it.
 */

const NOW = 1_800_000_000_000;

let t: TestDb;
let dir: string;

beforeEach(() => {
  t = freshDb();
  dir = mkdtempSync(join(tmpdir(), 'laika-backup-'));
});
afterEach(() => {
  t.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedUser(name: string): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name,
      orgRole: 'member',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

describe('the snapshot is restorable', () => {
  it('writes a file another process can open and read a row from', async () => {
    seedUser('Ada Lovelace');

    await snapshot({ sqlite: t.sqlite, dir }, NOW);

    const [file] = readdirSync(dir);
    expect(file, 'no snapshot was written').toBeDefined();

    // The whole criterion: open it as a database, from scratch, and get the row
    // back. A file of the right size and name proves nothing.
    const restored = new Database(join(dir, file!), { readonly: true });
    const row = restored.prepare('SELECT name FROM users LIMIT 1').get() as { name: string };
    restored.close();

    expect(row.name).toBe('Ada Lovelace');
  });

  it('captures writes made in WAL mode, which a file copy would miss', async () => {
    // Laika runs in WAL, so recent commits live in `-wal` until a checkpoint and
    // the `.db` file alone is not a consistent snapshot. `Database.backup()` is
    // SQLite's online backup and sees them; copying the file would not.
    seedUser('Before');
    await snapshot({ sqlite: t.sqlite, dir }, NOW);
    seedUser('After');
    await snapshot({ sqlite: t.sqlite, dir }, NOW + 1000);

    const files = readdirSync(dir).sort();
    const latest = new Database(join(dir, files[files.length - 1]!), { readonly: true });
    const names = (latest.prepare('SELECT name FROM users').all() as { name: string }[]).map(
      (r) => r.name,
    );
    latest.close();

    expect(names).toContain('After');
  });

  it('creates the directory if it is not there', async () => {
    const nested = join(dir, 'backups');

    await snapshot({ sqlite: t.sqlite, dir: nested }, NOW);

    expect(readdirSync(nested)).toHaveLength(1);
  });
});

describe('keeping 14 (§11.6)', () => {
  function fakeBackups(count: number): void {
    for (let i = 0; i < count; i += 1) {
      writeFileSync(join(dir, backupFilename(NOW + i * 1000)), 'x');
    }
  }

  it('keeps the newest 14 and deletes the rest', () => {
    fakeBackups(20);

    expect(pruneBackups(dir)).toBe(6);

    const left = readdirSync(dir).sort();
    expect(left).toHaveLength(KEEP_BACKUPS);
    // Sorted by name, and the name is an ISO timestamp — so the newest survive
    // without a `stat` call, and without depending on mtimes that a restore or
    // an rsync would rewrite.
    expect(left[left.length - 1]).toBe(backupFilename(NOW + 19 * 1000));
  });

  it('deletes nothing when there are 14 or fewer', () => {
    fakeBackups(KEEP_BACKUPS);

    expect(pruneBackups(dir)).toBe(0);
    expect(readdirSync(dir)).toHaveLength(KEEP_BACKUPS);
  });

  it('never touches a file it did not write', () => {
    fakeBackups(20);
    // **Names that sort before every backup**, so they would be first to go if
    // the prefix filter were dropped. My first version used `operator-notes.txt`
    // and `laika.sqlite`, which sort *after* `laika-…` and survived by luck —
    // the test named the right property and could not fail for it.
    writeFileSync(join(dir, 'AAA-operator-notes.txt'), 'do not delete');
    writeFileSync(join(dir, '000-restore-instructions.md'), 'nor this');

    pruneBackups(dir);

    // This function deletes files. A directory an operator has pointed somewhere
    // unexpected must not lose anything Laika did not put there.
    const left = readdirSync(dir);
    expect(left).toContain('AAA-operator-notes.txt');
    expect(left).toContain('000-restore-instructions.md');
  });

  it('names files in an order that sorts chronologically', () => {
    const early = backupFilename(NOW);
    const late = backupFilename(NOW + 86_400_000);

    expect([late, early].sort()).toEqual([early, late]);
    expect(early).not.toContain(':');
  });
});
