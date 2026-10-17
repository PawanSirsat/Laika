/**
 * `pnpm db:generate` — `drizzle-kit generate`, numbered after the last
 * migration instead of by journal index (LAI-778).
 *
 * drizzle-kit names a new migration `<journal idx>_<name>` and writes its
 * snapshot as `meta/<journal idx>_snapshot.json`. Since LAI-771's
 * `0036_task_estimates` landed at idx 35 the tags run one ahead of the index,
 * so the bare command wrote a second `0037_*.sql` and **overwrote
 * `meta/0037_snapshot.json`** — the snapshot the next diff starts from. The
 * shipped files keep their names: production applied them, and a migration's
 * tag, hash and `when` are history (`src/db/migrations/README.md`).
 *
 * So drizzle-kit runs against a **scratch copy** of the folder, and only its
 * two new files come back, renamed to the number after the highest any
 * migration name carries — tags and files both — with its journal entry
 * appended. Nothing that existed is written but the journal, and a target
 * that exists already is refused rather than replaced. Arguments go to
 * drizzle-kit as they are (`--name`, `--custom`).
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../drizzle.config.ts';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const NUMBER = /^(\d{4})_(.+)$/;
const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(SERVER, config.out ?? 'drizzle');

/** A refusal: said, and nothing in the folder is touched. */
class Refused extends Error {}

const readJournal = (folder: string): Journal =>
  JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal;

/** The highest number on any migration name: a journal tag, a SQL file or a snapshot. */
function highestNumber(folder: string, journal: Journal): number {
  const names = [
    ...journal.entries.map((e) => e.tag),
    ...readdirSync(folder),
    ...readdirSync(join(folder, 'meta')),
  ];
  let highest = -1;
  for (const name of names) {
    const match = NUMBER.exec(name);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

/** Generates into a scratch copy and brings the new migration back. Returns what it wrote. */
function generate(args: readonly string[]): string {
  if (args.some((a) => a === '--config' || a.startsWith('--config=') || a.startsWith('--out'))) {
    throw new Refused('--config and --out are fixed by drizzle.config.ts; pass --name or --custom');
  }
  const journal = readJournal(OUT);
  const work = mkdtempSync(join(tmpdir(), 'laika-db-generate-'));
  try {
    const scratch = join(work, 'migrations');
    cpSync(OUT, scratch, { recursive: true });
    // drizzle-kit reads its snapshots as `./<out>/…`: the copy is named from
    // its own directory, which is where it runs.
    writeFileSync(
      join(work, 'drizzle.config.json'),
      JSON.stringify({
        ...config,
        schema: resolve(SERVER, String(config.schema)),
        out: './migrations',
      }),
    );
    // Its prompts (a rename or a new column?) need the terminal; its errors
    // are kept, because it exits 0 after printing one.
    const generated = spawnSync(
      join(SERVER, 'node_modules', '.bin', 'drizzle-kit'),
      ['generate', '--config=drizzle.config.json', ...args],
      { cwd: work, stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8' },
    );
    process.stderr.write(generated.stderr);
    if (generated.status !== 0) throw new Refused(`drizzle-kit exited ${String(generated.status)}`);

    const entries = readJournal(scratch).entries;
    if (entries.length === journal.entries.length) {
      if (generated.stderr.trim() !== '') throw new Refused('drizzle-kit failed; nothing written');
      return 'nothing';
    }
    const entry = entries.at(-1);
    const match = NUMBER.exec(entry?.tag ?? '');
    if (entry === undefined || match === null || entries.length !== journal.entries.length + 1) {
      throw new Refused('drizzle-kit wrote other than one new journal entry; nothing was copied');
    }

    const number = String(highestNumber(OUT, journal) + 1).padStart(4, '0');
    const tag = `${number}_${String(match[2])}`;
    const sqlTarget = join(OUT, `${tag}.sql`);
    const snapshotTarget = join(OUT, 'meta', `${number}_snapshot.json`);
    for (const target of [sqlTarget, snapshotTarget]) {
      if (existsSync(target)) throw new Refused(`${target} exists; nothing was copied`);
    }
    const last = journal.entries.at(-1);
    cpSync(join(scratch, `${entry.tag}.sql`), sqlTarget);
    cpSync(join(scratch, 'meta', `${String(match[1])}_snapshot.json`), snapshotTarget);
    journal.entries.push({
      ...entry,
      idx: (last?.idx ?? -1) + 1,
      tag,
      // The migrator applies what is newer than the last `when` it applied.
      when: Math.max(entry.when, (last?.when ?? 0) + 1),
    });
    writeFileSync(join(OUT, 'meta', '_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
    return `${tag}.sql and meta/${number}_snapshot.json`;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  const wrote = generate(process.argv.slice(2));
  process.stdout.write(
    wrote === 'nothing'
      ? 'db:generate: nothing written\n'
      : `db:generate: wrote ${wrote}; run pnpm format:fix\n`,
  );
} catch (error) {
  if (!(error instanceof Refused)) throw error;
  process.stderr.write(`db:generate: ${error.message}\n`);
  process.exitCode = 1;
}
