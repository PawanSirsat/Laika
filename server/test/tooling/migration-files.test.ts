import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../../src/paths.ts';

/**
 * The migrations folder's names agree with each other (LAI-778).
 *
 * The migrator reads only the journal and the SQL, so a folder can boot fine
 * and still be damaged for the next `pnpm db:generate`: a snapshot overwritten
 * by a migration that took a number already in use, or two branches' migrations
 * that each took the same one. Both have happened (LAI-769's 0037, LAI-771's
 * 0036). Every assertion here names files **from both sides** — the journal's
 * tags and what is on disk — never a count, so a failure says which file.
 */

const MIGRATIONS = join(SERVER_ROOT, 'src', 'db', 'migrations');
const NUMBER = /^(\d{4})_/;

interface Journal {
  entries: { idx: number; when: number; tag: string }[];
}

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
) as Journal;
const tags = journal.entries.map((e) => e.tag);
const sqlFiles = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
const snapshots = readdirSync(join(MIGRATIONS, 'meta')).filter((name) =>
  name.endsWith('_snapshot.json'),
);
const numberOf = (name: string): string => NUMBER.exec(name)?.[1] ?? `(no number: ${name})`;

/** The names that share a number with another. */
function sharing(names: readonly string[]): string[] {
  const by = new Map<string, string[]>();
  for (const name of names) by.set(numberOf(name), [...(by.get(numberOf(name)) ?? []), name]);
  return [...by.values()].filter((group) => group.length > 1).flat();
}

describe('the migrations folder (LAI-778)', () => {
  it('has a SQL file for every journal tag, and a journal tag for every SQL file', () => {
    expect(tags.filter((tag) => !sqlFiles.includes(`${tag}.sql`))).toEqual([]);
    expect(sqlFiles.filter((file) => !tags.includes(file.slice(0, -'.sql'.length)))).toEqual([]);
  });

  it('gives no two migrations the same number', () => {
    expect(sharing(tags)).toEqual([]);
    expect(sharing(sqlFiles)).toEqual([]);
  });

  it("has every migration's snapshot, and no snapshot without a migration", () => {
    expect(tags.filter((tag) => !snapshots.includes(`${numberOf(tag)}_snapshot.json`))).toEqual([]);
    const numbers = new Set(tags.map(numberOf));
    expect(snapshots.filter((file) => !numbers.has(numberOf(file)))).toEqual([]);
  });

  it('numbers migrations in journal order, and the snapshots chain in that order', () => {
    // A number below one already shipped would sort a new snapshot before the
    // last, and drizzle-kit diffs against the last name in sort order.
    const unordered = tags.filter((tag, i) => i > 0 && numberOf(tag) <= numberOf(tags[i - 1]!));
    expect(unordered).toEqual([]);
    const ids = tags.map(
      (tag) =>
        JSON.parse(
          readFileSync(join(MIGRATIONS, 'meta', `${numberOf(tag)}_snapshot.json`), 'utf8'),
        ) as { id: string; prevId: string },
    );
    const broken = tags.filter((_, i) => i > 0 && ids[i]?.prevId !== ids[i - 1]?.id);
    expect(broken).toEqual([]);
  });

  it('keeps the journal in index order with `when` strictly rising', () => {
    // The migrator applies what is newer than the last `when` it applied, so
    // an older `when` after a newer one never runs on a database that has it.
    expect(journal.entries.filter((e, i) => e.idx !== i).map((e) => e.tag)).toEqual([]);
    expect(
      journal.entries
        .filter((e, i) => i > 0 && e.when <= (journal.entries[i - 1]?.when ?? Infinity))
        .map((e) => e.tag),
    ).toEqual([]);
  });
});
