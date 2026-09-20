import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKFILL_COLUMNS,
  createDefaultBoardColumns,
  DEFAULT_COLUMNS,
} from '../../src/db/board-columns.ts';
import { TASK_STATUSES } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { boardColumns, boardColumnStatuses, orgs, projects } from '../../src/db/schema.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The two seed sets a board can start from (LAI-266).
 *
 * They live in `db/` rather than beside the service because `db/backfill.ts`
 * needs them and CONVENTIONS §2 makes `db/` the bottom layer — a backfill
 * reaching up into `services/` inverts that.
 *
 * **The difference between the two is the substance of this file.** A new
 * project gets four lanes with `backlog` folded into "To do"; a project that
 * predates the table gets the five it was already showing. Applying the new
 * default to an existing board would silently merge two of somebody's lanes
 * during a routine upgrade, and nobody can undo that.
 */

let t: TestDb;
let projectId: string;

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  const orgId = newId();
  projectId = newId();

  t.db
    .insert(orgs)
    .values({ id: orgId, name: 'Laika', ownerUserId: newId(), createdAt: now, updatedAt: now })
    .run();
  t.db
    .insert(projects)
    .values({
      id: projectId,
      orgId,
      name: 'Bare',
      slug: 'bare',
      prefix: 'BAR',
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

afterEach(() => {
  t.close();
});

function written() {
  const columns = t.db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .all()
    .sort((a, b) => a.position - b.position);

  const mappings = t.db
    .select()
    .from(boardColumnStatuses)
    .where(eq(boardColumnStatuses.projectId, projectId))
    .all();

  return { columns, mappings };
}

describe('both seed sets', () => {
  it('cover every status exactly once', () => {
    // Totality is the invariant the whole feature rests on, and a seed that
    // missed a status would start a project already broken.
    for (const [label, seeds] of [
      ['default', DEFAULT_COLUMNS],
      ['backfill', BACKFILL_COLUMNS],
    ] as const) {
      const statuses = seeds.flatMap((s) => [...s.statuses]);

      expect([...statuses].sort(), `${label}: totality`).toEqual([...TASK_STATUSES].sort());
      expect(new Set(statuses).size, `${label}: no duplicates`).toBe(TASK_STATUSES.length);
    }
  });

  it('keep cancelled out of sight', () => {
    // §11.4.1: "`cancelled` is hidden behind a filter, not a column." It still
    // needs a home or the mapping is partial — so it gets a hidden one.
    for (const seeds of [DEFAULT_COLUMNS, BACKFILL_COLUMNS]) {
      const holder = seeds.find((s) => s.statuses.includes('cancelled'));

      expect(holder?.hidden).toBe(true);
      expect(seeds.filter((s) => s.hidden !== true).flatMap((s) => [...s.statuses])).not.toContain(
        'cancelled',
      );
    }
  });
});

describe('the default set, for a new project', () => {
  it('is four visible lanes', () => {
    expect(DEFAULT_COLUMNS.filter((s) => s.hidden !== true).map((s) => s.name)).toEqual([
      'To do',
      'In progress',
      'Review',
      'Done',
    ]);
  });

  it('leads To do with todo, not backlog', () => {
    /*
     * **Not cosmetic, and the reason is two visible things.** The first status
     * is the primary: what a drop sets, and where the lane's colour comes from.
     * The client has no `.lane-dot-backlog` rule — its absence is asserted on
     * purpose — so a column labelled "To do" whose primary were `backlog` would
     * drop cards into `backlog` and draw itself grey.
     */
    const todo = DEFAULT_COLUMNS.find((s) => s.name === 'To do');

    expect(todo?.statuses[0]).toBe('todo');
    expect(todo?.statuses).toEqual(['todo', 'backlog']);
  });
});

describe('the backfill set, for a project that predates the table', () => {
  it('is the five lanes the board was already showing', () => {
    // These names are the client's own `STATUS_LABELS`, in its own order. If
    // this list drifts, somebody's board silently renames itself on upgrade.
    expect(BACKFILL_COLUMNS.filter((s) => s.hidden !== true).map((s) => s.name)).toEqual([
      'Backlog',
      'To do',
      'In progress',
      'Review',
      'Done',
    ]);
  });

  it('gives each lane exactly one status, unlike the new default', () => {
    // The contrast *is* the promise: no lane is merged with another.
    for (const seed of BACKFILL_COLUMNS) {
      expect(seed.statuses, seed.name).toHaveLength(1);
    }

    expect(DEFAULT_COLUMNS.some((s) => s.statuses.length > 1)).toBe(true);
  });
});

describe('createDefaultBoardColumns', () => {
  it('writes dense positions from zero', () => {
    createDefaultBoardColumns(t.db, projectId, 1);

    expect(written().columns.map((c) => c.position)).toEqual(DEFAULT_COLUMNS.map((_, i) => i));
  });

  it('marks exactly one primary per column, and it is the first status', () => {
    createDefaultBoardColumns(t.db, projectId, 1);

    const { columns, mappings } = written();

    for (const column of columns) {
      const mine = mappings.filter((m) => m.columnId === column.id);
      const primaries = mine.filter((m) => m.isPrimary === 1);

      expect(primaries, column.name).toHaveLength(1);

      const seed = DEFAULT_COLUMNS.find((s) => s.name === column.name);
      expect(primaries[0]?.status, column.name).toBe(seed?.statuses[0]);
    }
  });

  it('takes the seed it is given rather than always the default', () => {
    createDefaultBoardColumns(t.db, projectId, 1, BACKFILL_COLUMNS);

    expect(written().columns.map((c) => c.name)).toEqual(BACKFILL_COLUMNS.map((s) => s.name));
  });
});
