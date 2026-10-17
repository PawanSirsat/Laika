import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * LAI-778. `drizzle-kit generate` names a migration by its **journal index**,
 * and since LAI-771's `0036_task_estimates` landed at idx 35 every tag runs one
 * ahead of it — so the plain command wrote `0037_<name>.sql` beside
 * `0037_token_usage.sql` and **overwrote `meta/0037_snapshot.json`**, the
 * snapshot the next diff is computed from.
 *
 * This runs the **real command**, read out of `server/package.json` as
 * `format-fix.test.ts` reads its own, in a scratch copy of the server's
 * schema, config and migrations — never in the tree. Reading it rather than
 * restating it is the point: a test with its own copy of the pipeline would
 * keep passing after someone pointed the script back at bare drizzle-kit.
 *
 * Every number below comes from **names** — the journal's tags and the files
 * on disk — never from a count, so it stays true as migrations are added.
 */

const NUMBER = /^(\d{4})_/;

function generateCommand(): string {
  const pkg = JSON.parse(readFileSync(join(SERVER_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const command = pkg.scripts['db:generate'];
  if (command === undefined) throw new Error('server/package.json has no db:generate script');
  return command;
}

interface Journal {
  entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[];
}

/** Every file under `dir`, relative, with its bytes. */
function filesOf(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    out.set(full.slice(dir.length + 1), readFileSync(full));
  }
  return out;
}

/** The highest migration number any name carries: a tag, a SQL file or a snapshot. */
function highestNumber(migrations: string, journal: Journal): number {
  const names = [
    ...journal.entries.map((e) => e.tag),
    ...readdirSync(migrations),
    ...readdirSync(join(migrations, 'meta')),
  ];
  return Math.max(...names.flatMap((n) => (NUMBER.exec(n) ? [Number(NUMBER.exec(n)?.[1])] : [])));
}

let root: string;
let migrations: string;
let before: Map<string, Buffer>;
let journalBefore: Journal;

function run(args: string): { status: number; output: string } {
  try {
    const output = execFileSync('sh', ['-c', `${generateCommand()} ${args}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH}` },
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'laika-db-generate-'));
  for (const name of ['package.json', 'drizzle.config.ts', 'scripts']) {
    if (existsSync(join(SERVER_ROOT, name))) {
      cpSync(join(SERVER_ROOT, name), join(root, name), { recursive: true });
    }
  }
  cpSync(join(SERVER_ROOT, 'src', 'db'), join(root, 'src', 'db'), { recursive: true });
  symlinkSync(join(SERVER_ROOT, 'node_modules'), join(root, 'node_modules'));
  migrations = join(root, 'src', 'db', 'migrations');
  before = filesOf(migrations);
  journalBefore = JSON.parse(
    readFileSync(join(migrations, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pnpm db:generate (LAI-778)', () => {
  it('with no schema change writes nothing at all', () => {
    const { status, output } = run('');
    expect(status, output).toBe(0);
    // Said by drizzle-kit itself: a run that crashed before diffing writes
    // nothing too, and must not pass for this.
    expect(output).toContain('No schema changes');
    const after = filesOf(migrations);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, bytes] of before) expect(after.get(path)?.equals(bytes), path).toBe(true);
  }, 120_000);

  it('writes a new migration under a number no file has, and changes no existing file but the journal', () => {
    const next = String(highestNumber(migrations, journalBefore) + 1).padStart(4, '0');
    const { status, output } = run('--custom --name probe');
    expect(status, output).toBe(0);
    expect(output).toContain(`${next}_probe.sql`);

    const after = filesOf(migrations);
    const added = [...after.keys()].filter((path) => !before.has(path)).sort();
    expect(added).toEqual([`${next}_probe.sql`, join('meta', `${next}_snapshot.json`)].sort());

    const changed = [...before].filter(([path, bytes]) => after.get(path)?.equals(bytes) !== true);
    expect(changed.map(([path]) => path)).toEqual([join('meta', '_journal.json')]);

    const journal = JSON.parse(
      readFileSync(join(migrations, 'meta', '_journal.json'), 'utf8'),
    ) as Journal;
    // The shipped entries are history: every one byte for byte, `when` included.
    expect(journal.entries.slice(0, -1)).toEqual(journalBefore.entries);
    const last = journalBefore.entries.at(-1);
    const entry = journal.entries.at(-1);
    expect(entry?.tag).toBe(`${next}_probe`);
    expect(entry?.idx).toBe((last?.idx ?? -1) + 1);
    expect(entry?.when).toBeGreaterThan(last?.when ?? Infinity);

    // The chain drizzle-kit diffs along: the new snapshot follows the last one.
    const snapshot = (name: string) =>
      JSON.parse(readFileSync(join(migrations, 'meta', name), 'utf8')) as {
        id: string;
        prevId: string;
      };
    const lastNumber = NUMBER.exec(last?.tag ?? '')?.[1] ?? '';
    expect(snapshot(`${next}_snapshot.json`).prevId).toBe(
      snapshot(`${lastNumber}_snapshot.json`).id,
    );
  }, 120_000);

  it('refuses to be pointed at another folder', () => {
    const { status, output } = run('--out=elsewhere');
    expect(status).toBe(1);
    expect(output).toContain('--config and --out are fixed by drizzle.config.ts');
  }, 60_000);
});
