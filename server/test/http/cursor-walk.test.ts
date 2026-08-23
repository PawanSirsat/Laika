import { and, asc, gt, or, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/db/ids.ts';
import { tasks } from '../../src/db/schema.ts';
import { buildPage, type Cursor, decodeCursor } from '../../src/http/pagination.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let s: Seed;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

let nextNumber = 1;

function insertTask(title: string, updatedAt: number): string {
  const id = newId();
  t.db
    .insert(tasks)
    .values({
      id,
      projectId: s.projectId,
      number: nextNumber++,
      title,
      createdBy: s.userId,
      createdVia: 'api',
      createdAt: updatedAt,
      updatedAt,
    })
    .run();
  return id;
}

beforeEach(() => {
  nextNumber = 1;
});

/**
 * One page of `tasks`, ordered by `(updated_at, id)` — the keyset comparison the
 * cursor encodes. Fetches `limit + 1` so `buildPage` can tell whether another
 * page exists.
 */
function fetchPage(limit: number, cursor: Cursor | null) {
  const keyset =
    cursor === null
      ? undefined
      : or(
          gt(tasks.updatedAt, Number(cursor.sortKey)),
          and(sql`${tasks.updatedAt} = ${Number(cursor.sortKey)}`, gt(tasks.id, cursor.id)),
        );

  const rows = t.db
    .select({ id: tasks.id, title: tasks.title, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(keyset)
    .orderBy(asc(tasks.updatedAt), asc(tasks.id))
    .limit(limit + 1)
    .all();

  return buildPage(rows, limit, (row) => ({ sortKey: row.updatedAt, id: row.id }));
}

function walk(limit: number, onPage?: (pageIndex: number) => void): string[] {
  const seen: string[] = [];
  let cursor: Cursor | null = null;
  let page = 0;

  for (;;) {
    const result = fetchPage(limit, cursor);
    seen.push(...result.data.map((r) => r.id));

    if (result.next_cursor === null) break;
    cursor = decodeCursor(result.next_cursor);

    onPage?.(page++);
    if (page > 500) throw new Error('cursor walk did not terminate');
  }

  return seen;
}

describe('cursor walk (SPEC §6.3, LAI-006 AC8)', () => {
  it('sees every row exactly once on a quiet table', () => {
    const ids = Array.from({ length: 25 }, (_, i) => insertTask(`t${String(i)}`, 1_000 + i));

    const seen = walk(10);

    expect(seen).toEqual(ids);
    expect(new Set(seen).size).toBe(ids.length);
  });

  it('sees every pre-existing row exactly once while rows are being inserted', () => {
    // The property that makes this keyset and not an offset: inserting during a
    // walk must not cause a pre-existing row to be skipped or repeated.
    const original = Array.from({ length: 30 }, (_, i) =>
      insertTask(`orig${String(i)}`, 1_000 + i),
    );

    let inserted = 0;
    const seen = walk(7, () => {
      // Insert *behind* the reader — the case an OFFSET would shift.
      insertTask(`new${String(inserted)}`, 1_000 + inserted * 2);
      inserted++;
    });

    expect(inserted).toBeGreaterThan(0);

    // No duplicates anywhere in the walk.
    expect(new Set(seen).size).toBe(seen.length);

    // And every original row was seen.
    for (const id of original) {
      expect(seen, `missing ${id}`).toContain(id);
    }
  });

  it('is stable when many rows share a sort key', () => {
    // Same `updated_at` for all of them: without the id tiebreaker the walk
    // either loops forever or skips rows.
    const ids = Array.from({ length: 20 }, () => insertTask('same', 5_000)).sort();

    const seen = walk(6);

    expect(seen.sort()).toEqual(ids);
  });

  it('terminates on an empty table', () => {
    expect(walk(10)).toEqual([]);
  });

  it('does not repeat the boundary row across pages', () => {
    const ids = Array.from({ length: 6 }, (_, i) => insertTask(`t${String(i)}`, 1_000 + i));

    const first = fetchPage(3, null);
    const second = fetchPage(3, decodeCursor(first.next_cursor!));

    expect(first.data.map((r) => r.id)).toEqual(ids.slice(0, 3));
    expect(second.data.map((r) => r.id)).toEqual(ids.slice(3));
  });
});
