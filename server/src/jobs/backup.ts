import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { type JobResult } from './jobs.ts';

/**
 * The nightly SQLite snapshot (§11.6, LAI-431).
 *
 * Its own module because it is the one job that touches the filesystem, and the
 * only one whose correctness is not visible in the database it reads.
 *
 * ## Why `better-sqlite3`'s backup API and not a file copy
 *
 * Laika runs in WAL mode, so the `.db` file alone is **not** a consistent
 * snapshot — recent commits live in `-wal` until a checkpoint. Copying the three
 * files while the process is writing gives a torn read that restores as
 * corruption, and the failure appears only when somebody needs the backup.
 * `Database.backup()` is SQLite's online backup: it takes a consistent copy of a
 * live database without blocking writers.
 *
 * ## Keeping 14
 *
 * §11.6's number. Pruning is by **filename**, which sorts chronologically
 * because the name is an ISO timestamp — no `stat` call, and no dependence on
 * mtimes that a restore or an `rsync` would rewrite.
 */

/** §11.6. */
export const KEEP_BACKUPS = 14;

const PREFIX = 'laika-';
const SUFFIX = '.sqlite';

/** `laika-2026-09-02T00-45-00-000Z.sqlite` — sortable, and legal on every filesystem. */
export function backupFilename(now: number): string {
  return `${PREFIX}${new Date(now).toISOString().replace(/[:.]/g, '-')}${SUFFIX}`;
}

export interface BackupDeps {
  sqlite: Database.Database;
  dir: string;
}

/**
 * Write a snapshot and drop all but the newest `KEEP_BACKUPS`.
 *
 * `changed` is 1 — a snapshot is a thing that happened, even though no row moved.
 * It writes no `activity` row; see `jobs.ts` for why the cron's writers are the
 * four §4.8's D-022 note names and not these.
 */
export async function snapshot(deps: BackupDeps, now: number): Promise<JobResult> {
  mkdirSync(deps.dir, { recursive: true });

  await deps.sqlite.backup(join(deps.dir, backupFilename(now)));
  pruneBackups(deps.dir);

  return { changed: 1 };
}

/**
 * Keep the newest `KEEP_BACKUPS` files this job wrote, and touch nothing else.
 *
 * The prefix filter is not decoration: this deletes files, and a `dir` an
 * operator has pointed somewhere unexpected must not lose anything Laika did not
 * put there.
 */
export function pruneBackups(dir: string): number {
  const ours = readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .sort();

  const doomed = ours.slice(0, Math.max(0, ours.length - KEEP_BACKUPS));
  for (const name of doomed) rmSync(join(dir, name), { force: true });

  return doomed.length;
}
