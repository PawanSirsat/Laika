import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../src/db/client.ts';
import { TASK_STATUSES, type TaskStatus } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import {
  CATEGORY_LABELS,
  createDefaultProjectStatuses,
  DEFAULT_STATUSES,
  statusForCategory,
} from '../../src/db/project-statuses.ts';
import { projects, projectStatuses, tasks } from '../../src/db/schema.ts';
import { expectSqliteError, freshDb, seed, type TestDb } from '../helpers/db.ts';

/** Crockford base32, 26 characters — what `newId()` produces. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function statusesOf(db: Db, projectId: string) {
  return db
    .select({
      id: projectStatuses.id,
      name: projectStatuses.name,
      category: projectStatuses.category,
      position: projectStatuses.position,
      hidden: projectStatuses.hidden,
    })
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId))
    .orderBy(projectStatuses.position)
    .all();
}

/** `[name, category, hidden]` in position order — the shape a board draws. */
function board(db: Db, projectId: string): [string, TaskStatus, number][] {
  return statusesOf(db, projectId).map((s) => [s.name, s.category, s.hidden]);
}

// ------------------------------------------------------------------ the seed

describe('a new project’s statuses', () => {
  let t: TestDb;
  beforeEach(() => {
    t = freshDb();
  });
  afterEach(() => t.close());

  it('are the six categories, in order, named as the board names them, Cancelled hidden', () => {
    const s = seed(t.db);

    expect(board(t.db, s.projectId)).toEqual([
      ['Backlog', 'backlog', 0],
      ['To do', 'todo', 0],
      ['In progress', 'in_progress', 0],
      ['Review', 'review', 0],
      ['Done', 'done', 0],
      ['Cancelled', 'cancelled', 1],
    ]);
    expect(DEFAULT_STATUSES.map((d) => d.category)).toEqual([...TASK_STATUSES]);
    expect(statusesOf(t.db, s.projectId).every((r) => ULID.test(r.id))).toBe(true);
  });

  it('resolve a category to its first visible status, else the first hidden one', () => {
    const s = seed(t.db);
    const now = Date.now();
    // A hidden review status ahead of the visible one, and a second visible.
    t.db.run(
      sql`UPDATE project_statuses SET position = position + 10 WHERE project_id = ${s.projectId}`,
    );
    t.db
      .insert(projectStatuses)
      .values([
        {
          id: newId(),
          projectId: s.projectId,
          name: 'Parked',
          category: 'review',
          position: 0,
          hidden: 1,
          createdAt: now,
        },
        {
          id: newId(),
          projectId: s.projectId,
          name: 'QA',
          category: 'review',
          position: 1,
          hidden: 0,
          createdAt: now,
        },
      ])
      .run();

    expect(statusForCategory(t.db, s.projectId, 'review').name).toBe('QA');
    // Every cancelled status is hidden, so the first of any visibility.
    expect(statusForCategory(t.db, s.projectId, 'cancelled')).toMatchObject({
      name: 'Cancelled',
      hidden: true,
    });
  });
});

// ------------------------------------------------------- what SQL refuses

describe('the database holds a task’s status to its project and category', () => {
  let t: TestDb;
  let s: ReturnType<typeof seed>;
  beforeEach(() => {
    t = freshDb();
    s = seed(t.db);
  });
  afterEach(() => t.close());

  function insertTask(status: TaskStatus, statusId: string, projectId = s.projectId) {
    const now = Date.now();
    t.db
      .insert(tasks)
      .values({
        id: newId(),
        projectId,
        number: Math.floor(Math.random() * 1e9) + 1,
        title: 'x',
        status,
        statusId,
        createdBy: s.userId,
        createdVia: 'api',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  it('accepts a status of the task’s own project and category', () => {
    insertTask('todo', statusForCategory(t.db, s.projectId, 'todo').id);
    expect(t.db.select().from(tasks).all()).toHaveLength(1);
  });

  it('refuses a status whose category disagrees with tasks.status', () => {
    expectSqliteError(
      () => insertTask('done', statusForCategory(t.db, s.projectId, 'todo').id),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('refuses another project’s status', () => {
    const other = newId();
    const now = Date.now();
    t.db
      .insert(projects)
      .values({
        id: other,
        orgId: s.orgId,
        name: 'Other',
        slug: 'other',
        prefix: 'OTH',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    createDefaultProjectStatuses(t.db, other, now);

    expectSqliteError(
      () => insertTask('todo', statusForCategory(t.db, other, 'todo').id),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('refuses a second status of the same name, whatever its case', () => {
    expectSqliteError(
      () =>
        t.db
          .insert(projectStatuses)
          .values({
            id: newId(),
            projectId: s.projectId,
            name: 'REVIEW',
            category: 'review',
            position: 99,
            createdAt: Date.now(),
          })
          .run(),
      /UNIQUE constraint failed/,
    );
  });

  it('refuses deleting a status a task still holds', () => {
    const todo = statusForCategory(t.db, s.projectId, 'todo').id;
    insertTask('todo', todo);
    expectSqliteError(
      () => t.db.delete(projectStatuses).where(eq(projectStatuses.id, todo)).run(),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('lets a project with tasks be deleted — the two cascades do not trip each other', () => {
    insertTask('todo', statusForCategory(t.db, s.projectId, 'todo').id);
    t.db.delete(projects).where(eq(projects.id, s.projectId)).run();

    expect(t.db.select().from(tasks).all()).toEqual([]);
    expect(t.db.select().from(projectStatuses).all()).toEqual([]);
  });
});

// ------------------------------------------------------------ the migration

/**
 * What a case below, and its setup, may take (LAI-848). LAI-841's loaded gate
 * failed two of these at 10.5 and 13.3 s against vitest's 5 s test and 10 s
 * hook defaults. Shrunk to 150 / 300 ms in a loaded run, both bounds were
 * crossed: `Hook timed out` on the per-case setup (then: copy every migration,
 * snapshots included, and migrate to 0027) and `Test timed out` on the body.
 * The setup is now one template copied per case, and no per-case hook crossed
 * 300 ms after; the body is 0028 onwards, which is the property, and still
 * crossed 150 ms. 60 s is the bound LAI-768 gave migrate.test's upgrade cases.
 */
const MIGRATION_BUDGET = { timeout: 60_000 };

/**
 * 0028 copies today's board into statuses and drops the board (LAI-738).
 *
 * The database is migrated to 0027, populated the way LAI-266's columns could
 * actually be left — including the shapes its bugs produced — then migrated
 * forward. Raw SQL throughout, because the tables being read no longer exist
 * in `schema.ts`.
 */
describe('migration 0028 turns board columns into project statuses', MIGRATION_BUDGET, () => {
  let dir: string;
  let db: Db;
  let close: () => void;
  const now = 1_790_000_000_000;

  /** The migrations up to 0027, without drizzle-kit's snapshots (as LAI-768). */
  function folderBefore0028(cut: string): void {
    cpSync(MIGRATIONS_FOLDER, cut, {
      recursive: true,
      filter: (source) => !source.endsWith('_snapshot.json'),
    });
    const journalPath = join(cut, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag.startsWith('0028_'));
    const dropped = journal.entries.splice(at);
    // The guard on the guard: the first entry cut must be this migration.
    expect(dropped[0]?.tag).toBe('0028_project_statuses');
    writeFileSync(journalPath, JSON.stringify(journal));
  }

  let userId: string;
  let orgId: string;
  let template: string;
  let templateDir: string;

  function project(slug: string): string {
    const id = newId();
    db.run(sql`INSERT INTO projects (id, org_id, name, slug, prefix, created_at, updated_at)
               VALUES (${id}, ${orgId}, ${slug}, ${slug}, ${slug.toUpperCase()}, ${now}, ${now})`);
    return id;
  }

  /** A column and its statuses; `primary` names which is flagged, or none. */
  function column(
    projectId: string,
    name: string,
    position: number,
    statuses: TaskStatus[],
    options: { hidden?: boolean; primary?: TaskStatus | null } = {},
  ): void {
    const id = newId();
    db.run(sql`INSERT INTO board_columns (id, project_id, name, position, hidden, created_at, updated_at)
               VALUES (${id}, ${projectId}, ${name}, ${position}, ${options.hidden === true ? 1 : 0}, ${now}, ${now})`);
    const primary = options.primary === undefined ? statuses[0] : options.primary;
    for (const status of statuses) {
      db.run(sql`INSERT INTO board_column_statuses (project_id, status, column_id, is_primary, created_at)
                 VALUES (${projectId}, ${status}, ${id}, ${status === primary ? 1 : 0}, ${now})`);
    }
  }

  let number = 0;
  /** One task per category given, returning id → category. */
  function tasksIn(projectId: string, categories: readonly TaskStatus[]): Map<string, TaskStatus> {
    const made = new Map<string, TaskStatus>();
    for (const category of categories) {
      const id = newId();
      number += 1;
      db.run(sql`INSERT INTO tasks (id, project_id, number, title, status, priority, created_by, created_via, position, created_at, updated_at)
                 VALUES (${id}, ${projectId}, ${number}, ${category}, ${category}, 'p2', ${userId}, 'api', ${`a${String(number).padStart(4, '0')}`}, ${now}, ${now})`);
      made.set(id, category);
    }
    return made;
  }

  // One seeded database at 0027, built once; each case starts from a copy of
  // the file and migrates it forward itself (LAI-848).
  beforeAll(() => {
    templateDir = mkdtempSync(join(tmpdir(), 'laika-mig-'));
    const cut = join(templateDir, 'migrations');
    folderBefore0028(cut);
    template = join(templateDir, 'at-0027.db');
    const opened = openDb({ path: template });
    runMigrations(opened.db, { migrationsFolder: cut });

    const s = seed(opened.db, now);
    userId = s.userId;
    orgId = s.orgId;
    // `seed` made a project with no columns on this database (the helper
    // skips statuses when the table is absent) — the no-columns case below.
    expect(
      opened.db
        .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .map((r) => r.name),
    ).toEqual(expect.arrayContaining(['board_columns', 'board_column_statuses']));
    opened.sqlite.close();
    // Closing the last connection checkpoints the WAL into the file; a copy of
    // the file alone would otherwise miss whatever was still in it.
    expect(existsSync(`${template}-wal`)).toBe(false);
  }, MIGRATION_BUDGET.timeout);

  afterAll(() => {
    rmSync(templateDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'laika-db-'));
    copyFileSync(template, join(dir, 'laika.db'));
    const opened = openDb({ path: join(dir, 'laika.db') });
    db = opened.db;
    close = () => opened.sqlite.close();
  }, MIGRATION_BUDGET.timeout);

  afterEach(() => {
    close();
    rmSync(dir, { recursive: true, force: true });
  }, MIGRATION_BUDGET.timeout);

  /** Every task kept its category, and sits in the first status of it by position. */
  function expectTasksPlaced(projectId: string, made: Map<string, TaskStatus>): void {
    const statuses = statusesOf(db, projectId);
    for (const [id, category] of made) {
      const row = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
      expect(row.status, `task ${category}`).toBe(category);
      const first = statuses.find((s) => s.category === category)!;
      expect(row.statusId, `task ${category}`).toBe(first.id);
    }
  }

  it('keeps a board of one-status columns exactly as it looked', () => {
    const p = project('plain');
    ['Backlog', 'To do', 'In progress', 'Review', 'Done'].forEach((name, i) =>
      column(p, name, i, [TASK_STATUSES[i]!]),
    );
    column(p, 'Cancelled', 5, ['cancelled'], { hidden: true });
    const made = tasksIn(p, TASK_STATUSES);

    runMigrations(db);

    expect(board(db, p)).toEqual([
      ['Backlog', 'backlog', 0],
      ['To do', 'todo', 0],
      ['In progress', 'in_progress', 0],
      ['Review', 'review', 0],
      ['Done', 'done', 0],
      ['Cancelled', 'cancelled', 1],
    ]);
    expect(statusesOf(db, p).map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expectTasksPlaced(p, made);
  });

  it('splits a several-status column: the primary keeps its name, the rest follow it', () => {
    const p = project('multi');
    // DEFAULT_COLUMNS as LAI-266 seeded a new project: To do = [todo, backlog].
    column(p, 'To do', 0, ['todo', 'backlog']);
    column(p, 'In progress', 1, ['in_progress']);
    column(p, 'Review', 2, ['review']);
    column(p, 'Done', 3, ['done']);
    column(p, 'Cancelled', 4, ['cancelled'], { hidden: true });
    const made = tasksIn(p, ['backlog', 'todo', 'done']);

    runMigrations(db);

    expect(board(db, p)).toEqual([
      ['To do', 'todo', 0],
      ['Backlog', 'backlog', 0],
      ['In progress', 'in_progress', 0],
      ['Review', 'review', 0],
      ['Done', 'done', 0],
      ['Cancelled', 'cancelled', 1],
    ]);
    // The backlog task is in Backlog, not swept into To do.
    expectTasksPlaced(p, made);
  });

  it('drops an empty column, keeps a hidden one hidden, and closes the gaps', () => {
    const p = project('gaps');
    column(p, 'Backlog', 0, ['backlog']);
    column(p, 'Ideas', 1, []);
    column(p, 'To do', 2, ['todo']);
    column(p, 'Doing', 3, ['in_progress']);
    column(p, 'Waiting on QA', 4, ['review'], { hidden: true });
    column(p, 'Shipped', 6, ['done']);
    column(p, 'Cancelled', 7, ['cancelled'], { hidden: true });
    const made = tasksIn(p, ['in_progress', 'review', 'done']);

    runMigrations(db);

    expect(board(db, p)).toEqual([
      ['Backlog', 'backlog', 0],
      ['To do', 'todo', 0],
      ['Doing', 'in_progress', 0],
      ['Waiting on QA', 'review', 1],
      ['Shipped', 'done', 0],
      ['Cancelled', 'cancelled', 1],
    ]);
    expect(statusesOf(db, p).map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expectTasksPlaced(p, made);
  });

  it('orders a column with no primary flag canonically, suffixes a clash, and gives a missing category a hidden home', () => {
    const p = project('odd');
    column(p, 'Backlog', 0, ['backlog']);
    column(p, 'To do', 1, ['todo']);
    // LAI-618's donor bug: the column survived with neither status primary.
    column(p, 'Work', 2, ['review', 'in_progress'], { primary: null });
    // A column a lead named "review", holding done — clashes with the Review
    // status the Work column's second status becomes. The lead's name wins;
    // the generated label moves.
    column(p, 'review', 3, ['done']);
    // No column holds `cancelled`.
    const made = tasksIn(p, ['in_progress', 'review', 'done', 'cancelled']);

    runMigrations(db);

    expect(board(db, p)).toEqual([
      ['Backlog', 'backlog', 0],
      ['To do', 'todo', 0],
      ['Work', 'in_progress', 0],
      ['Review (2)', 'review', 0],
      ['review', 'done', 0],
      ['Cancelled', 'cancelled', 1],
    ]);
    expectTasksPlaced(p, made);
  });

  it('never fails on a clash: an existing "X (2)" pushes on to "X (3)", and a 39-character name is cut to fit 40', () => {
    const p = project('clash');
    // `in_progress` keeps the column's name; `review`, the second status, is
    // generated as "Review" — which three columns below already claim.
    column(p, 'Doing', 0, ['in_progress', 'review']);
    column(p, 'Review', 1, ['done']);
    column(p, 'Review (2)', 2, ['backlog']);
    // Two 39-character names that differ only in case — legal under the old
    // case-sensitive index, one name under the new case-insensitive one.
    const long = 'Q'.repeat(39);
    column(p, long, 3, ['todo']);
    column(p, long.toLowerCase(), 4, ['cancelled']);
    const made = tasksIn(p, TASK_STATUSES);

    runMigrations(db);

    const after = board(db, p);
    expect(after).toEqual([
      ['Doing', 'in_progress', 0],
      ['Review (3)', 'review', 0],
      ['Review', 'done', 0],
      ['Review (2)', 'backlog', 0],
      [long, 'todo', 0],
      [`${'q'.repeat(36)} (2)`, 'cancelled', 0],
    ]);
    // The cut is exact: 36 + " (2)" is the whole 40.
    expect(after[5]![0]).toHaveLength(40);
    expect(new Set(after.map(([name]) => name.toLowerCase())).size).toBe(after.length);
    expectTasksPlaced(p, made);
  });

  it('passes the reviewer’s repro: a generated "Backlog" behind a lead’s "Backlog" and "Backlog (2)"', () => {
    const p = project('repro');
    column(p, 'X', 0, ['in_progress', 'backlog']);
    column(p, 'Backlog', 1, ['review']);
    column(p, 'Backlog (2)', 2, ['done']);
    const made = tasksIn(p, TASK_STATUSES);

    runMigrations(db);

    expect(board(db, p)).toEqual([
      ['X', 'in_progress', 0],
      ['Backlog (3)', 'backlog', 0],
      ['Backlog', 'review', 0],
      ['Backlog (2)', 'done', 0],
      ['To do', 'todo', 1],
      ['Cancelled', 'cancelled', 1],
    ]);
    expectTasksPlaced(p, made);
  });

  it('suffixes two long names that share their first 34 characters without colliding, and moves on when the cut ones meet', () => {
    // 40 characters each; the second of each pair differs only in case.
    const a1 = `${'A'.repeat(34)}bbbbbb`;
    const a2 = `${'A'.repeat(34)}cccccc`;
    const pa = project('shared34');
    column(pa, a1, 0, ['todo']);
    column(pa, a1.toUpperCase(), 1, ['backlog']);
    column(pa, a2, 2, ['review']);
    column(pa, a2.toUpperCase(), 3, ['done']);
    // Sharing 36: both cut to the same 36 characters, so the second suffix
    // must move on to (3).
    const z1 = `${'Z'.repeat(36)}abcd`;
    const z2 = `${'Z'.repeat(36)}efgh`;
    const pz = project('shared36');
    column(pz, z1, 0, ['todo']);
    column(pz, z1.toUpperCase(), 1, ['backlog']);
    column(pz, z2, 2, ['review']);
    column(pz, z2.toUpperCase(), 3, ['done']);

    runMigrations(db);

    expect(
      board(db, pa)
        .slice(0, 4)
        .map(([name]) => name),
    ).toEqual([a1, `${'A'.repeat(34)}BB (2)`, a2, `${'A'.repeat(34)}CC (2)`]);
    expect(
      board(db, pz)
        .slice(0, 4)
        .map(([name]) => name),
    ).toEqual([z1, `${'Z'.repeat(36)} (2)`, z2, `${'Z'.repeat(36)} (3)`]);
    for (const p of [pa, pz]) {
      expect(board(db, p).every(([name]) => name.length <= 40)).toBe(true);
    }
  });

  it('names a no-primary column after the status whose label it is — OnRoute’s "TO DO" = [todo, backlog]', () => {
    const p = project('onroute');
    column(p, 'TO DO', 0, ['todo', 'backlog'], { primary: null });
    column(p, 'Doing', 1, ['in_progress']);
    column(p, 'Review', 2, ['review']);
    column(p, 'Done', 3, ['done']);
    column(p, 'Cancelled', 4, ['cancelled'], { hidden: true });
    const made = tasksIn(p, ['todo', 'backlog']);

    runMigrations(db);

    expect(board(db, p).slice(0, 2)).toEqual([
      ['TO DO', 'todo', 0],
      ['Backlog', 'backlog', 0],
    ]);
    expectTasksPlaced(p, made);
  });

  it('hides the generated status of any category no column held, not only Cancelled', () => {
    const p = project('noreview');
    column(p, 'Backlog', 0, ['backlog']);
    column(p, 'To do', 1, ['todo']);
    column(p, 'Doing', 2, ['in_progress']);
    column(p, 'Done', 3, ['done']);
    column(p, 'Cancelled', 4, ['cancelled'], { hidden: true });
    const made = tasksIn(p, ['review']);

    runMigrations(db);

    expect(board(db, p)).toEqual([
      ['Backlog', 'backlog', 0],
      ['To do', 'todo', 0],
      ['Doing', 'in_progress', 0],
      ['Done', 'done', 0],
      ['Cancelled', 'cancelled', 1],
      ['Review', 'review', 1],
    ]);
    expectTasksPlaced(p, made);
  });

  it('lets a suffix minted for an earlier typed clash take a lead’s own "X (2)", which then moves on', () => {
    // What the `named` comment in 0028 says, held to it: typed names do not
    // all survive, and none of this fails.
    const p = project('typed');
    column(p, 'X', 0, ['todo']);
    column(p, 'x', 1, ['backlog']);
    column(p, 'X (2)', 2, ['review']);

    runMigrations(db);

    expect(
      board(db, p)
        .slice(0, 3)
        .map(([name]) => name),
    ).toEqual(['X', 'x (2)', 'X (2) (2)']);
  });

  it('gives an archived project and a project with no tasks their statuses like any other', () => {
    const archived = project('old');
    db.run(sql`UPDATE projects SET archived_at = ${now} WHERE id = ${archived}`);
    column(archived, 'Doing', 0, ['in_progress']);
    const made = tasksIn(archived, ['in_progress', 'done']);
    const empty = project('empty');
    column(empty, 'Only', 0, ['todo']);

    runMigrations(db);

    expect(board(db, archived).map(([name, category]) => [name, category])).toEqual([
      ['Doing', 'in_progress'],
      ['Backlog', 'backlog'],
      ['To do', 'todo'],
      ['Review', 'review'],
      ['Done', 'done'],
      ['Cancelled', 'cancelled'],
    ]);
    expectTasksPlaced(archived, made);
    expect(new Set(statusesOf(db, empty).map((s) => s.category))).toEqual(new Set(TASK_STATUSES));
  });

  it('survives every project at once, clashes and all, with nothing dangling', () => {
    // The scenarios above, in one database: the recursion names each project
    // independently, so one project's names never push another's.
    const a = project('alpha');
    const b = project('beta');
    for (const p of [a, b]) {
      column(p, 'Doing', 0, ['in_progress', 'review']);
      column(p, 'Review', 1, ['done']);
      column(p, 'Review (2)', 2, ['backlog']);
    }
    tasksIn(a, TASK_STATUSES);
    tasksIn(b, TASK_STATUSES);

    runMigrations(db);

    for (const p of [a, b]) {
      expect(
        board(db, p)
          .slice(0, 4)
          .map(([name]) => name),
      ).toEqual(['Doing', 'Review (3)', 'Review', 'Review (2)']);
    }
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it('gives a project with no columns at all the six defaults, as it was already drawing them', () => {
    const p = db.select({ id: projects.id }).from(projects).where(eq(projects.slug, 'laika')).get()!
      .id;
    const made = tasksIn(p, ['backlog', 'cancelled']);

    runMigrations(db);

    expect(board(db, p)).toEqual(
      DEFAULT_STATUSES.map((d) => [CATEGORY_LABELS[d.category], d.category, d.hidden ? 1 : 0]),
    );
    expectTasksPlaced(p, made);
  });

  it('drops the board tables, loses no task or anything hanging off one, and leaves nothing dangling', () => {
    const p = project('keep');
    column(p, 'To do', 0, ['todo', 'backlog']);
    column(p, 'Done', 1, ['done']);
    const made = tasksIn(p, ['backlog', 'done']);
    const [a, b] = [...made.keys()];
    db.run(
      sql`INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (${b!}, ${a!}, ${now})`,
    );
    db.run(sql`INSERT INTO comments (id, task_id, author_id, body_md, created_via, created_at, updated_at)
               VALUES (${newId()}, ${a!}, ${userId}, 'hello', 'api', ${now}, ${now})`);
    db.run(sql`INSERT INTO task_watchers (id, task_id, user_id, created_at, updated_at)
               VALUES (${newId()}, ${a!}, ${userId}, ${now}, ${now})`);

    runMigrations(db);

    const tables = db
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => r.name);
    expect(tables).toContain('project_statuses');
    expect(tables).not.toContain('board_columns');
    expect(tables).not.toContain('board_column_statuses');

    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    expect(db.select().from(tasks).all()).toHaveLength(made.size);
    expect(db.all(sql`SELECT 1 FROM task_dependencies WHERE task_id = ${b!}`)).toHaveLength(1);
    expect(db.all(sql`SELECT 1 FROM comments WHERE task_id = ${a!}`)).toHaveLength(1);
    expect(db.all(sql`SELECT 1 FROM task_watchers WHERE task_id = ${a!}`)).toHaveLength(1);

    // Every id the migration minted is a ULID, and none repeats.
    const ids = db
      .select({ id: projectStatuses.id })
      .from(projectStatuses)
      .all()
      .map((r) => r.id);
    expect(
      ids.every((id) => ULID.test(id)),
      ids.join(' '),
    ).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // Every project has every category — the invariant the service then keeps.
    const perProject = db.all<{ project_id: string; n: number }>(
      sql`SELECT project_id, count(DISTINCT category) AS n FROM project_statuses GROUP BY project_id`,
    );
    expect(perProject.every((r) => r.n === 6)).toBe(true);
  });
});
