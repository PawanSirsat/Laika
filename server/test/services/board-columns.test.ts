import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { backfillBoardColumns } from '../../src/db/backfill.ts';
import { TASK_STATUSES, type OrgRole, type TaskStatus } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  boardColumns,
  boardColumnStatuses,
  orgs,
  projects,
  users,
} from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  createBoardColumn,
  deleteBoardColumn,
  listBoardColumns,
  createDefaultBoardColumns,
  reorderBoardColumns,
  setColumnStatuses,
  updateBoardColumn,
  type BoardColumnView,
} from '../../src/services/board-columns.ts';
import { addMember, createProject } from '../../src/services/projects.ts';
import { expectSqliteError, freshDb, type TestDb } from '../helpers/db.ts';

/**
 * Board columns (LAI-266).
 *
 * The invariant is the point of the whole module — **every status belongs to
 * exactly one column** — and it is split across two enforcers, so it is asserted
 * as two separate things. The primary key gives *at most one*; the service gives
 * *at least one*. A single set-equality check would pass for a service that
 * dropped one status and invented another, which is why the property run below
 * asserts both halves rather than comparing sorted lists once.
 */

let t: TestDb;
let adminId: string;
let memberId: string;
let viewerId: string;

function makeUser(orgRole: OrgRole): string {
  const id = newId();
  const now = Date.now();
  t.db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: 'Person',
      orgRole,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function expectApiError(fn: () => unknown, code: string): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) {
      expect(err.code, err.message).toBe(code);
      return err;
    }
    throw err;
  }
  throw new Error(`Expected an ApiError with code ${code}`);
}

function board(): BoardColumnView[] {
  return listBoardColumns(t.db, actor(adminId), 'laika');
}

function byName(name: string): BoardColumnView {
  const found = board().find((c) => c.name === name);
  if (found === undefined) throw new Error(`no column called ${name}; have ${names().join(', ')}`);
  return found;
}

function names(): string[] {
  return board().map((c) => c.name);
}

/** Read the mappings out of the table, not out of the service's own answer. */
function mappings(projectId: string): { status: TaskStatus; columnId: string }[] {
  return t.db
    .select({ status: boardColumnStatuses.status, columnId: boardColumnStatuses.columnId })
    .from(boardColumnStatuses)
    .where(eq(boardColumnStatuses.projectId, projectId))
    .all();
}

let projectId: string;

beforeEach(() => {
  t = freshDb();
  const now = Date.now();
  adminId = makeUser('admin');
  memberId = makeUser('member');
  viewerId = makeUser('viewer');
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Laika', ownerUserId: adminId, createdAt: now, updatedAt: now })
    .run();

  projectId = createProject(t.sqlite, t.db, actor(adminId), {
    name: 'Laika',
    slug: 'laika',
    prefix: 'LAI',
  }).id;

  addMember(t.db, actor(adminId), 'laika', memberId, 'member');
  addMember(t.db, actor(adminId), 'laika', viewerId, 'viewer');
});

afterEach(() => {
  t.close();
});

describe('a new project', () => {
  it('gets four visible lanes plus a hidden home for cancelled', () => {
    const columns = board();

    expect(columns.filter((c) => !c.hidden).map((c) => c.name)).toEqual([
      'To do',
      'In progress',
      'Review',
      'Done',
    ]);
    expect(columns.filter((c) => c.hidden).map((c) => c.name)).toEqual(['Cancelled']);
  });

  it('gives To do a primary of todo, not backlog', () => {
    // Not a detail. The primary is what a drop sets and where the lane's colour
    // comes from, and the client has no `.lane-dot-backlog` rule — so had the
    // seed order been the enum's, a column labelled "To do" would drop cards
    // into `backlog` and draw itself grey.
    const todo = byName('To do');

    expect(todo.primary_status).toBe('todo');
    expect(todo.statuses).toEqual(['todo', 'backlog']);
  });

  it('maps every status exactly once', () => {
    expect(
      mappings(projectId)
        .map((m) => m.status)
        .sort(),
    ).toEqual([...TASK_STATUSES].sort());
  });
});

describe('the invariant, under any sequence of edits', () => {
  /**
   * A deterministic pseudo-random walk. **A fixed seed**, so a failure is
   * reproducible rather than a story about a build that went red once.
   */
  function rng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  it('leaves every status in exactly one column after 200 operations', () => {
    const next = rng(20260919);
    let created = 0;

    for (let step = 0; step < 200; step += 1) {
      const columns = board();
      const pick = <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)]!;
      const roll = next();

      try {
        if (roll < 0.2) {
          created += 1;
          createBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', {
            name: `Lane ${String(created)}`,
          });
        } else if (roll < 0.35) {
          updateBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', pick(columns).id, {
            name: `Renamed ${String(step)}`,
          });
        } else if (roll < 0.65) {
          const target = pick(columns);
          const take = [...TASK_STATUSES].filter(() => next() < 0.4);
          if (take.length > 0) {
            setColumnStatuses(t.sqlite, t.db, actor(adminId), 'laika', target.id, take);
          }
        } else if (roll < 0.8 && columns.length > 1) {
          const victim = pick(columns);
          const target = pick(columns.filter((c) => c.id !== victim.id));
          deleteBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', victim.id, target.id);
        } else {
          const shuffled = [...columns].sort(() => next() - 0.5).map((c) => c.id);
          reorderBoardColumns(t.sqlite, t.db, actor(adminId), 'laika', shuffled);
        }
      } catch (err) {
        // A refusal is a legitimate outcome — the walk generates illegal moves
        // on purpose. What must never happen is a refusal that half-applied, so
        // the assertions below still run on every iteration.
        if (!(err instanceof ApiError)) throw err;
      }

      const rows = mappings(projectId);

      // Totality — the half SQL cannot express.
      expect([...rows].map((m) => m.status).sort(), `step ${String(step)}: totality`).toEqual(
        [...TASK_STATUSES].sort(),
      );

      // At most one — the half the primary key holds. Asserted separately
      // because a service that dropped `review` and added a second `done` would
      // satisfy a sorted-list comparison of the wrong shape but not this.
      expect(new Set(rows.map((m) => m.status)).size, `step ${String(step)}: no duplicates`).toBe(
        TASK_STATUSES.length,
      );

      // Every mapping points at a column of this project that still exists.
      const live = new Set(board().map((c) => c.id));
      for (const row of rows) {
        expect(live.has(row.columnId), `step ${String(step)}: ${row.status} is orphaned`).toBe(
          true,
        );
      }

      // Positions stay a dense permutation, which is what the reorder park and
      // the delete gap-closing are for.
      const positions = board().map((c) => c.position);
      expect(positions, `step ${String(step)}: positions`).toEqual(positions.map((_, i) => i));

      // The primary is the first status, and `null` exactly when there is none.
      // An empty column is legal — `createBoardColumn` makes one — so this
      // asserts the relationship rather than the presence.
      for (const column of board()) {
        expect(column.primary_status, `step ${String(step)}: ${column.name}`).toBe(
          column.statuses[0] ?? null,
        );
      }
    }
  });
});

describe('the database holds its half even when the service is bypassed', () => {
  it('refuses a mapping pointing at another project’s column', () => {
    const other = createProject(t.sqlite, t.db, actor(adminId), {
      name: 'Other',
      slug: 'other',
      prefix: 'OTH',
    });
    const theirs = listBoardColumns(t.db, actor(adminId), 'other')[0]!;

    // The composite foreign key is the only thing standing between this and a
    // board that draws another project's lane. It is a construct this repo had
    // not used before LAI-266, so it is proved rather than assumed.
    //
    // **One row, and a non-primary one.** Re-pointing the whole project at one
    // column trips the one-primary unique index first, so the test would pass
    // for a schema with no composite key at all — the assertion has to be
    // reachable only by the constraint it names.
    expectSqliteError(() => {
      t.db
        .update(boardColumnStatuses)
        .set({ columnId: theirs.id })
        .where(
          and(
            eq(boardColumnStatuses.projectId, projectId),
            eq(boardColumnStatuses.status, 'backlog'),
          ),
        )
        .run();
    }, /FOREIGN KEY constraint failed/);

    expect(other.id).not.toBe(projectId);
    // `backlog` is not a primary in the default seed — `todo` leads "To do" —
    // so the row above really is the non-primary one this test needs.
    expect(byName('To do').primary_status).toBe('todo');
  });

  it('reparents a deleted column’s statuses rather than dropping them', () => {
    /*
     * **This is where the invariant actually lives, and the test says so.**
     *
     * The mapping's foreign key is `CASCADE`, not `RESTRICT`, so a raw
     * `DELETE FROM board_columns` *would* take its statuses with it — see the
     * schema docblock for the measurement that forced that choice. The database
     * therefore does not hold this half, and pretending otherwise with a
     * constraint test that cannot fail would be worse than having none.
     *
     * What holds it is the service reparenting first, and the property run
     * above driving two hundred operations against the table. This asserts the
     * mechanism directly: after a delete, every status the column held is
     * somewhere else, and none has vanished.
     */
    const review = byName('Review');
    const target = byName('In progress');
    const held = review.statuses;

    expect(held.length).toBeGreaterThan(0);

    deleteBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', review.id, target.id);

    const after = mappings(projectId);
    expect([...after].map((m) => m.status).sort()).toEqual([...TASK_STATUSES].sort());
    for (const status of held) {
      expect(after.find((m) => m.status === status)?.columnId).toBe(target.id);
    }
  });

  it('does not stand in the way of deleting a project', () => {
    /*
     * `RESTRICT` on the mapping's column reference could deadlock a project
     * delete, so both tables also cascade to `projects` in their own right.
     * Proved here rather than assumed.
     *
     * **Deliberately not `createProject`'s project.** A project cannot be
     * deleted at all today, and board columns have nothing to do with it:
     * `activity.project_id` is `ON DELETE restrict` (`schema.ts`), every
     * creation writes a `project.created` row, and `activity` is append-only by
     * trigger so the row cannot be cleared first. That is LAI-154's subject.
     * Using a bare project row keeps this test about the two tables it names
     * instead of quietly asserting somebody else's bug.
     */
    const bare = newId();
    const now = Date.now();
    t.db
      .insert(projects)
      .values({
        id: bare,
        orgId: t.db.select().from(orgs).get()!.id,
        name: 'Bare',
        slug: 'bare',
        prefix: 'BAR',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    createDefaultBoardColumns(t.db, bare, now);

    expect(mappings(bare).length).toBe(TASK_STATUSES.length);

    t.db.delete(projects).where(eq(projects.id, bare)).run();

    expect(mappings(bare)).toEqual([]);
    expect(t.db.select().from(boardColumns).where(eq(boardColumns.projectId, bare)).all()).toEqual(
      [],
    );
  });

  it('refuses two primaries in one column', () => {
    const done = byName('Done');

    expectSqliteError(() => {
      t.db
        .insert(boardColumnStatuses)
        .values({
          projectId,
          status: 'cancelled',
          columnId: done.id,
          isPrimary: 1,
          createdAt: Date.now(),
        })
        .run();
    }, /UNIQUE constraint failed/);
  });

  it('refuses two columns at the same position', () => {
    expectSqliteError(() => {
      t.db
        .update(boardColumns)
        .set({ position: 0 })
        .where(eq(boardColumns.id, byName('Done').id))
        .run();
    }, /UNIQUE constraint failed/);
  });
});

describe('reordering', () => {
  it('survives a full reversal', () => {
    // The naive implementations both fail here and nowhere else: SQLite checks
    // a unique index per row, so a straight rewrite collides partway through
    // any order that is not an append. This is the test that catches a "fix"
    // that removes the negative parking.
    const before = board().map((c) => c.id);

    reorderBoardColumns(t.sqlite, t.db, actor(adminId), 'laika', [...before].reverse());

    expect(board().map((c) => c.id)).toEqual([...before].reverse());
    expect(board().map((c) => c.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('survives sixty consecutive permutations', () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let i = 0; i < 60; i += 1) {
      const order = [...board().map((c) => c.id)].sort(() => next() - 0.5);
      reorderBoardColumns(t.sqlite, t.db, actor(adminId), 'laika', order);

      expect(
        board().map((c) => c.id),
        `round ${String(i)}`,
      ).toEqual(order);
      expect(board().map((c) => c.position)).toEqual(order.map((_, n) => n));
    }
  });

  it('refuses a list that is not a permutation of the board', () => {
    const ids = board().map((c) => c.id);
    const unchanged = [...ids];

    // A short list, a duplicate, and an id from somewhere else. Each is what a
    // client working from a stale board would send, and each would silently
    // drop or duplicate a lane if the check were a length comparison alone.
    for (const bad of [ids.slice(1), [...ids.slice(1), ids[1]!], [...ids.slice(1), newId()]]) {
      expectApiError(
        () => reorderBoardColumns(t.sqlite, t.db, actor(adminId), 'laika', bad),
        'unprocessable',
      );
    }

    expect(board().map((c) => c.id)).toEqual(unchanged);
  });
});

describe('deleting', () => {
  it('requires somewhere for the statuses to go, and says what moved', () => {
    const review = byName('Review');
    const inProgress = byName('In progress');

    const result = deleteBoardColumn(
      t.sqlite,
      t.db,
      actor(adminId),
      'laika',
      review.id,
      inProgress.id,
    );

    expect(result.reassigned).toEqual(['review']);
    expect(names()).not.toContain('Review');
    expect(byName('In progress').statuses.sort()).toEqual(['in_progress', 'review']);
  });

  it('refuses to send a column’s statuses to itself', () => {
    const review = byName('Review');
    expectApiError(
      () => deleteBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', review.id, review.id),
      'unprocessable',
    );
  });

  it('refuses to delete the last column', () => {
    // Walk the board down to one, then try. A board with no columns has nowhere
    // to put the statuses and no way back through the API.
    for (;;) {
      const columns = board();
      if (columns.length === 1) break;
      deleteBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', columns[0]!.id, columns[1]!.id);
    }

    const last = board()[0]!;
    expectApiError(
      () => deleteBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', last.id, last.id),
      'unprocessable',
    );
    expect(board()).toHaveLength(1);
    // And it still holds everything.
    expect([...last.statuses].sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('gives the receiving column a primary if it had lost one', () => {
    const done = byName('Done');
    const cancelled = byName('Cancelled');

    deleteBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', cancelled.id, done.id);

    const after = byName('Done');
    expect(after.statuses).toContain('cancelled');
    expect(after.primary_status).toBe('done');
  });
});

describe('editing statuses', () => {
  it('moves a status rather than copying it', () => {
    const review = byName('Review');

    setColumnStatuses(t.sqlite, t.db, actor(adminId), 'laika', review.id, ['review', 'done']);

    expect(byName('Review').statuses).toEqual(['review', 'done']);
    // `done` left `Done`, it was not duplicated — and `Done` is now an empty
    // lane, which is a legal state rather than a failure.
    expect(byName('Done').statuses).toEqual([]);
    expect(byName('Done').primary_status).toBeNull();
  });

  it('lets a move empty the column the status came from', () => {
    // An empty lane is a legal state — `createBoardColumn` produces one — so
    // this is not a special case to guard, it is the ordinary consequence of
    // moving the only status out of a column. An earlier draft refused it and
    // thereby blocked the most obvious edit the feature exists for.
    const review = byName('Review');

    setColumnStatuses(t.sqlite, t.db, actor(adminId), 'laika', review.id, ['review', 'done']);

    expect(byName('Done').statuses).toEqual([]);
    expect(
      mappings(projectId)
        .map((m) => m.status)
        .sort(),
    ).toEqual([...TASK_STATUSES].sort());
  });

  it('refuses an empty list', () => {
    expectApiError(
      () => setColumnStatuses(t.sqlite, t.db, actor(adminId), 'laika', byName('Done').id, []),
      'unprocessable',
    );
  });

  it('puts the first status of the list in charge', () => {
    const todo = byName('To do');

    setColumnStatuses(t.sqlite, t.db, actor(adminId), 'laika', todo.id, ['backlog', 'todo']);

    expect(byName('To do').primary_status).toBe('backlog');
    expect(byName('To do').statuses).toEqual(['backlog', 'todo']);
  });
});

describe('permission', () => {
  it('lets a viewer read the board', () => {
    expect(listBoardColumns(t.db, actor(viewerId), 'laika').length).toBeGreaterThan(0);
  });

  it('refuses every mutation to a member and a viewer', () => {
    for (const who of [memberId, viewerId]) {
      const target = byName('Review');

      expectApiError(
        () => createBoardColumn(t.sqlite, t.db, actor(who), 'laika', { name: 'QA' }),
        'forbidden',
      );
      expectApiError(
        () => updateBoardColumn(t.sqlite, t.db, actor(who), 'laika', target.id, { name: 'QA' }),
        'forbidden',
      );
      expectApiError(
        () => setColumnStatuses(t.sqlite, t.db, actor(who), 'laika', target.id, ['review']),
        'forbidden',
      );
      expectApiError(
        () => deleteBoardColumn(t.sqlite, t.db, actor(who), 'laika', target.id, byName('Done').id),
        'forbidden',
      );
      expectApiError(
        () =>
          reorderBoardColumns(
            t.sqlite,
            t.db,
            actor(who),
            'laika',
            board().map((c) => c.id),
          ),
        'forbidden',
      );
    }
  });
});

describe('naming', () => {
  it('refuses two columns with the same name in one project', () => {
    expectApiError(
      () => createBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', { name: 'Review' }),
      'conflict',
    );
  });

  it('refuses a blank name', () => {
    expectApiError(
      () => createBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', { name: '   ' }),
      'unprocessable',
    );
  });

  it('creates a column holding nothing, so nothing is stolen', () => {
    const before = mappings(projectId);

    createBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', { name: 'QA' });

    expect(byName('QA').statuses).toEqual([]);
    expect(mappings(projectId)).toEqual(before);
  });
});

describe('activity', () => {
  it('writes project.updated rather than a verb of its own', () => {
    // A new `ACTIVITY_TYPES` verb is three owners (CLAUDE.md §4.4) and D-060
    // declined one for the same reason. This asserts the decision rather than
    // the implementation: what matters is that no new verb was needed.
    createBoardColumn(t.sqlite, t.db, actor(adminId), 'laika', { name: 'QA' });

    const rows = t.db.select().from(activity).all();
    const mine = rows.filter((r) => (r.payloadJson ?? '').includes('board_column'));

    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) expect(row.type).toBe('project.updated');
  });
});

describe('the backfill', () => {
  it('reproduces the board a project already had, not the new default', () => {
    // The promise this makes to anybody upgrading: their board does not change
    // shape. `DEFAULT_COLUMNS` merges Backlog and To do, which is the better
    // default and would be a silent edit to a live board.
    t.db.delete(boardColumnStatuses).where(eq(boardColumnStatuses.projectId, projectId)).run();
    t.db.delete(boardColumns).where(eq(boardColumns.projectId, projectId)).run();

    expect(backfillBoardColumns(t.db)).toBe(1);

    expect(
      board()
        .filter((c) => !c.hidden)
        .map((c) => c.name),
    ).toEqual(['Backlog', 'To do', 'In progress', 'Review', 'Done']);
    expect(
      mappings(projectId)
        .map((m) => m.status)
        .sort(),
    ).toEqual([...TASK_STATUSES].sort());
  });

  it('leaves a project that already has columns alone, on every boot', () => {
    const before = board();

    expect(backfillBoardColumns(t.db)).toBe(0);
    expect(backfillBoardColumns(t.db)).toBe(0);

    expect(board()).toEqual(before);
  });
});
