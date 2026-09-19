import { and, asc, eq, sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { activityActor, type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { TASK_STATUSES, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { boardColumns, boardColumnStatuses } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { requireProjectBySlug } from './projects.ts';

/**
 * Re-exported so `routes/board-columns.ts` can validate a status without
 * importing `db/`, which CONVENTIONS §2 forbids for `http/routes/`. The same
 * line, for the same reason, as `services/tasks.ts` and `services/sprints.ts`.
 */
export { TASK_STATUSES } from '../db/enums.ts';

/**
 * The board's lanes, as configuration (LAI-266).
 *
 * Before this, a column *was* a status: the client held a frozen five-value
 * array and the CSS grid said `repeat(5, …)`. A column is now a per-project,
 * named, ordered grouping of one or more statuses — Jira's model, and the reason
 * it is safe. `TASK_STATUSES` did not change, so throughput, capacity, the stale
 * cron and every MCP tool go on meaning exactly what they meant.
 *
 * ## The invariant, and which half the database holds
 *
 * **Every status belongs to exactly one column in a project.** The primary key
 * `(project_id, status)` gives *at most one* — a card can never draw in two
 * lanes. *At least one* is not expressible in SQLite and lives here, in the
 * three functions that can break it: `setColumnStatuses` moves rather than
 * copies, `deleteBoardColumn` refuses to run without somewhere to put the
 * orphans, and `createBoardColumn` starts a column empty rather than stealing.
 *
 * Saying which half is where matters more than it looks. A reader who believes
 * the PK does both jobs will eventually write the fourth function.
 *
 * ## `cancelled` and the hidden column
 *
 * §11.4.1: *"`cancelled` is hidden behind a filter, not a column."* It still
 * needs a home, or the mapping is partial and the invariant above is false by
 * construction. So it gets a real column with `hidden = 1`: the statuses stay
 * total, and the board draws exactly what it drew before. A lead who un-hides it
 * has chosen to see cancelled work, which is a feature.
 *
 * ## Where LAI-267 and LAI-268 land
 *
 * Both were filed against a table that did not exist — a WIP limit per column,
 * and a named reviewer per column. **They belong on `board_columns`**, as
 * columns on that row. Neither is built here; this note exists so the next
 * person does not create a third table to hold them.
 */

/** A column and the statuses it draws, primary first. */
export interface BoardColumnView {
  id: string;
  project_id: string;
  name: string;
  position: number;
  hidden: boolean;
  statuses: TaskStatus[];
  /**
   * What a drop on this column sets — the first status, by definition.
   *
   * **`null` when the column holds nothing**, which is a real state rather than
   * a defensive one: `createBoardColumn` makes an empty column on purpose, and
   * moving a status out of a column can empty it. A drop on such a lane has no
   * answer, and the client must refuse it rather than pick one. An earlier draft
   * defaulted this to `'backlog'` and described the case as unreachable; it is
   * reached by the first thing anybody does with the feature.
   */
  primary_status: TaskStatus | null;
}

export const COLUMN_NAME_MAX = 40;

interface Seed {
  name: string;
  /** Primary first — the order is the contract, not a detail. */
  statuses: readonly TaskStatus[];
  hidden?: boolean;
}

/**
 * What a **new** project gets: four lanes, plus `cancelled`'s hidden home.
 *
 * **`todo` is listed before `backlog` deliberately, and it is not cosmetic.**
 * The first status is the primary — what a drop sets and what the lane's colour
 * comes from — so the order decides two visible things:
 *
 *  - a card dropped on "To do" becomes `todo`, which is what the label says. Had
 *    `backlog` been first, the List view's pill would read *Backlog* on a card
 *    the board shows under *To do*, which is the kind of disagreement people
 *    report as a bug;
 *  - the client has no `.lane-dot-backlog` rule — its absence is asserted on
 *    purpose — so a "To do" column whose primary is `backlog` draws the grey
 *    fallback dot. With `todo` first the default board is chromatically
 *    identical to the one this replaced.
 */
export const DEFAULT_COLUMNS: readonly Seed[] = [
  { name: 'To do', statuses: ['todo', 'backlog'] },
  { name: 'In progress', statuses: ['in_progress'] },
  { name: 'Review', statuses: ['review'] },
  { name: 'Done', statuses: ['done'] },
  { name: 'Cancelled', statuses: ['cancelled'], hidden: true },
];

/**
 * What a project that **predates** this table gets.
 *
 * Five lanes, one status each, named exactly as the client's `COLUMN_LABELS`
 * named them. Not `DEFAULT_COLUMNS`: upgrading must not reshape a board somebody
 * is already using, and silently merging their Backlog and To do lanes on boot
 * is the worst outcome this feature could have. A lead who wants the four-column
 * shape can merge them in two clicks; nobody can undo it being done to them.
 */
export const BACKFILL_COLUMNS: readonly Seed[] = [
  { name: 'Backlog', statuses: ['backlog'] },
  { name: 'To do', statuses: ['todo'] },
  { name: 'In progress', statuses: ['in_progress'] },
  { name: 'Review', statuses: ['review'] },
  { name: 'Done', statuses: ['done'] },
  { name: 'Cancelled', statuses: ['cancelled'], hidden: true },
];

/**
 * Write a seed set for a project that has none.
 *
 * **No `can()`, and that is not an exception to §5's rule.** It reads and writes
 * nothing the caller has not already been authorised for: every caller is inside
 * a transaction that has just created the project, or is the migration backfill
 * acting as no one. There is no actor to ask about and no resource that existed
 * before this call. `createProject` has already answered `project.create`.
 *
 * Exported because three callers need it and the third is the one that gets
 * missed: `createProject`, first-boot setup, and the test `seed()` helper.
 */
export function createDefaultBoardColumns(
  db: Db,
  projectId: string,
  now: number,
  seeds: readonly Seed[] = DEFAULT_COLUMNS,
): void {
  seeds.forEach((seed, position) => {
    const id = newId();

    db.insert(boardColumns)
      .values({
        id,
        projectId,
        name: seed.name,
        position,
        hidden: seed.hidden === true ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(boardColumnStatuses)
      .values(
        seed.statuses.map((status, i) => ({
          projectId,
          status,
          columnId: id,
          isPrimary: i === 0 ? 1 : 0,
          createdAt: now,
        })),
      )
      .run();
  });
}

function rowsToViews(
  columns: { id: string; projectId: string; name: string; position: number; hidden: number }[],
  mappings: { status: TaskStatus; columnId: string; isPrimary: number }[],
): BoardColumnView[] {
  return columns.map((column) => {
    const mine = mappings.filter((m) => m.columnId === column.id);
    // Primary first, then the rest in a stable order so two reads agree.
    const ordered = [...mine].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return b.isPrimary - a.isPrimary;
      return TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status);
    });
    const statuses = ordered.map((m) => m.status);

    return {
      id: column.id,
      project_id: column.projectId,
      name: column.name,
      position: column.position,
      hidden: column.hidden === 1,
      statuses,
      primary_status: statuses[0] ?? null,
    };
  });
}

function readBoard(db: Db, projectId: string): BoardColumnView[] {
  const columns = db
    .select({
      id: boardColumns.id,
      projectId: boardColumns.projectId,
      name: boardColumns.name,
      position: boardColumns.position,
      hidden: boardColumns.hidden,
    })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.position))
    .all();

  const mappings = db
    .select({
      status: boardColumnStatuses.status,
      columnId: boardColumnStatuses.columnId,
      isPrimary: boardColumnStatuses.isPrimary,
    })
    .from(boardColumnStatuses)
    .where(eq(boardColumnStatuses.projectId, projectId))
    .all();

  return rowsToViews(columns, mappings);
}

function requireColumn(db: Db, projectId: string, columnId: string) {
  const row = db
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))
    .get();

  if (row === undefined) throw new ApiError('not_found', 'No such board column');
  return row;
}

function cleanName(raw: string): string {
  const name = raw.trim();

  if (name.length === 0) throw new ApiError('unprocessable', 'A column needs a name');
  if (name.length > COLUMN_NAME_MAX) {
    throw new ApiError('unprocessable', `A column name is at most ${COLUMN_NAME_MAX} characters`);
  }

  return name;
}

function assertNameFree(db: Db, projectId: string, name: string, exceptId?: string): void {
  const clash = db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.projectId, projectId), eq(boardColumns.name, name)))
    .get();

  if (clash !== undefined && clash.id !== exceptId) {
    throw new ApiError('conflict', `This space already has a column called ${name}`);
  }
}

function note(
  db: Db,
  actor: ResolvedActor,
  project: { id: string; orgId: string },
  payload: Record<string, unknown>,
  now: number,
): void {
  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    ...activityActor(actor),
    /*
     * **`project.updated`, not a verb of its own.** §4.8's vocabulary is closed
     * and growing it is a `docs/SPEC.md` change — and CLAUDE.md §4.4's rule is
     * blunt about the cost: *"a verb added to `ACTIVITY_TYPES` is always three
     * owners, because the client mirrors the list and the dashboard needs
     * wording for it."* D-060 declined one for the same feature family.
     *
     * Apply §4.8's own test — *could a reader answer "when did this happen?"
     * without inspecting a payload?* — and a column rename is project
     * configuration, which is what this verb already names. `sprints.ts` rode
     * under it for the same reason before LAI-113 gave sprints their own verbs.
     *
     * `entity` is what a later filter keys on if that ever happens here.
     */
    type: 'project.updated',
    payload: { entity: 'board_column', ...payload },
    now,
  });
}

// ------------------------------------------------------------------ reading

export function listBoardColumns(db: Db, actor: ResolvedActor, slug: string): BoardColumnView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  return readBoard(db, project.id);
}

// ----------------------------------------------------------------- writing

/**
 * A new column, appended at the end, **holding nothing**.
 *
 * Starting empty is the point: a column that claimed statuses on creation would
 * take them from whichever column has them, so every "add a column" would
 * silently be a re-mapping of the board. The lane renders empty and the lead
 * then chooses what goes in it.
 */
export function createBoardColumn(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: { name: string },
  now: number = Date.now(),
): BoardColumnView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  const name = cleanName(input.name);

  return immediateTransaction(sqlite, () => {
    assertNameFree(db, project.id, name);

    const last = db
      .select({ position: boardColumns.position })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, project.id))
      .orderBy(asc(boardColumns.position))
      .all()
      .at(-1);

    const id = newId();
    db.insert(boardColumns)
      .values({
        id,
        projectId: project.id,
        name,
        position: (last?.position ?? -1) + 1,
        hidden: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    note(db, actor, project, { action: 'created', board_column_id: id, name }, now);

    return readBoard(db, project.id);
  });
}

export function updateBoardColumn(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  columnId: string,
  input: { name?: string | undefined; hidden?: boolean | undefined },
  now: number = Date.now(),
): BoardColumnView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  return immediateTransaction(sqlite, () => {
    const column = requireColumn(db, project.id, columnId);
    const changes: { name?: string; hidden?: number; updatedAt: number } = { updatedAt: now };

    if (input.name !== undefined) {
      const name = cleanName(input.name);
      assertNameFree(db, project.id, name, columnId);
      changes.name = name;
    }

    if (input.hidden !== undefined) changes.hidden = input.hidden ? 1 : 0;

    db.update(boardColumns).set(changes).where(eq(boardColumns.id, columnId)).run();

    note(
      db,
      actor,
      project,
      {
        action: 'renamed',
        board_column_id: columnId,
        name: changes.name ?? column.name,
      },
      now,
    );

    return readBoard(db, project.id);
  });
}

/**
 * Put these statuses in this column, taking them from wherever they were.
 *
 * **A move, not an add.** The upsert below is what makes totality mechanical: a
 * status row always exists and only ever changes which column it points at, so
 * there is no sequence of calls that leaves one homeless. Deleting-then-inserting
 * would open a window where it is, and a failure inside that window would close
 * on a board missing a status.
 *
 * Returns the **whole board**, because moving a status changes two columns and a
 * client that re-derived the other one would be guessing.
 */
export function setColumnStatuses(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  columnId: string,
  statuses: readonly TaskStatus[],
  now: number = Date.now(),
): BoardColumnView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  if (statuses.length === 0) {
    throw new ApiError('unprocessable', 'A column needs at least one status');
  }

  const unique = [...new Set(statuses)];
  if (unique.length !== statuses.length) {
    throw new ApiError('unprocessable', 'A status can only be listed once in a column');
  }

  return immediateTransaction(sqlite, () => {
    requireColumn(db, project.id, columnId);

    /*
     * **A donor column left holding nothing is fine**, and an earlier draft
     * refused it. That was wrong twice over: `createBoardColumn` produces an
     * empty column deliberately, so empty is already a legal state; and the
     * refusal blocked the ordinary case — moving `done` into a "Review & done"
     * column necessarily empties `Done`, which is exactly what the person
     * dragging the checkbox meant.
     *
     * What must never happen is a *status* left holding nothing, and that is a
     * different check — the one below.
     */

    // Clear this column's primary first: the partial unique index allows one
    // `is_primary = 1` per column, and the upsert below sets the new one.
    db.update(boardColumnStatuses)
      .set({ isPrimary: 0 })
      .where(eq(boardColumnStatuses.columnId, columnId))
      .run();

    unique.forEach((status, i) => {
      db.run(
        sql`INSERT INTO ${boardColumnStatuses} (project_id, status, column_id, is_primary, created_at)
            VALUES (${project.id}, ${status}, ${columnId}, ${i === 0 ? 1 : 0}, ${now})
            ON CONFLICT(project_id, status)
            DO UPDATE SET column_id = excluded.column_id, is_primary = excluded.is_primary`,
      );
    });

    // Anything this column held and no longer claims must go somewhere. It
    // cannot simply be dropped, so it stays put only if still listed — and the
    // loop above has already re-pointed everything that is.
    const stranded = db
      .select({ status: boardColumnStatuses.status })
      .from(boardColumnStatuses)
      .where(eq(boardColumnStatuses.columnId, columnId))
      .all()
      .filter((r) => !unique.includes(r.status));

    if (stranded.length > 0) {
      throw new ApiError(
        'unprocessable',
        `Give ${stranded.map((s) => s.status).join(', ')} a column before taking ${unique.join(', ')}`,
      );
    }

    note(
      db,
      actor,
      project,
      { action: 'statuses_changed', board_column_id: columnId, statuses: [...unique] },
      now,
    );

    return readBoard(db, project.id);
  });
}

/**
 * Delete a column, after sending its statuses somewhere.
 *
 * **`reassignToColumnId` is required rather than optional**, even when the column
 * is empty. Making it conditional would mean the client has to know which case
 * it is in before it can build the request, and getting that wrong is how a
 * status ends up in no column — the failure this whole module is arranged
 * around. The database agrees: the foreign key is `RESTRICT`, so a delete that
 * skipped the reassignment would fail as a 500 rather than a sentence.
 */
export function deleteBoardColumn(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  columnId: string,
  reassignToColumnId: string,
  now: number = Date.now(),
): { columns: BoardColumnView[]; reassigned: TaskStatus[] } {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  if (reassignToColumnId === columnId) {
    throw new ApiError('unprocessable', 'Move the statuses to a different column');
  }

  return immediateTransaction(sqlite, () => {
    requireColumn(db, project.id, columnId);
    requireColumn(db, project.id, reassignToColumnId);

    const total = db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, project.id))
      .all().length;

    if (total <= 1) {
      throw new ApiError('conflict', 'A space needs at least one column');
    }

    const moving = db
      .select({ status: boardColumnStatuses.status })
      .from(boardColumnStatuses)
      .where(eq(boardColumnStatuses.columnId, columnId))
      .all()
      .map((r) => r.status);

    // Reparent before deleting. Not belt-and-braces: with `ON DELETE restrict`
    // the delete below fails outright if anything still points here.
    db.update(boardColumnStatuses)
      .set({ columnId: reassignToColumnId, isPrimary: 0 })
      .where(eq(boardColumnStatuses.columnId, columnId))
      .run();

    db.delete(boardColumns).where(eq(boardColumns.id, columnId)).run();

    // The target may now have no primary — it did not necessarily have one of
    // the moved statuses, and the reparent above cleared their flags. Give it
    // the first of its statuses in canonical order.
    const target = db
      .select({ status: boardColumnStatuses.status, isPrimary: boardColumnStatuses.isPrimary })
      .from(boardColumnStatuses)
      .where(eq(boardColumnStatuses.columnId, reassignToColumnId))
      .all();

    if (!target.some((r) => r.isPrimary === 1) && target.length > 0) {
      const first = [...target].sort(
        (a, b) => TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status),
      )[0]!;

      db.update(boardColumnStatuses)
        .set({ isPrimary: 1 })
        .where(
          and(
            eq(boardColumnStatuses.columnId, reassignToColumnId),
            eq(boardColumnStatuses.status, first.status),
          ),
        )
        .run();
    }

    // Close the gap this left, so positions stay a dense permutation.
    db.select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, project.id))
      .orderBy(asc(boardColumns.position))
      .all()
      .forEach((row, i) => {
        db.update(boardColumns).set({ position: i }).where(eq(boardColumns.id, row.id)).run();
      });

    note(
      db,
      actor,
      project,
      {
        action: 'deleted',
        board_column_id: columnId,
        reassigned_to: reassignToColumnId,
        statuses: moving,
      },
      now,
    );

    return { columns: readBoard(db, project.id), reassigned: moving };
  });
}

/**
 * Put the columns in this order — the whole list, every id exactly once.
 *
 * ## Why the positions go negative first
 *
 * `UNIQUE(project_id, position)` is worth having: it makes "position is a
 * permutation" true of the data rather than merely of the code path that writes
 * it, which is the same argument `sprints_one_active_per_project` makes. The
 * price is that a permutation cannot be written in place.
 *
 * **SQLite checks a unique index per row, not per statement and not at commit,
 * and has no deferrable unique constraint.** Measured, not recalled: a single
 * `CASE` update and a naive per-row rewrite inside one transaction both fail
 * `UNIQUE constraint failed` partway through any order that is not an append.
 * So every row is parked outside the occupied range first, and the target order
 * is then written into empty space.
 *
 * This is why `board_columns` carries no `CHECK (position >= 0)`, and why the
 * schema says so.
 *
 * ## Why the whole list, when LAI-472 will move one card at a time
 *
 * A project has four to eight columns, so rewriting all of them is free and a
 * dense `0..n-1` needs no rebalancing. Cards are different — thousands of them,
 * and LAI-472's criterion is explicitly that a move writes *one* row — so the
 * two will not match and should not be made to.
 *
 * The whole list also removes a failure the neighbour form has: a client working
 * from a stale board cannot silently drop a column, because anything that is not
 * a permutation is refused.
 */
export function reorderBoardColumns(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  orderedIds: readonly string[],
  now: number = Date.now(),
): BoardColumnView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  return immediateTransaction(sqlite, () => {
    const current = db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, project.id))
      .all()
      .map((r) => r.id);

    const given = new Set(orderedIds);

    if (
      given.size !== orderedIds.length ||
      orderedIds.length !== current.length ||
      !current.every((id) => given.has(id))
    ) {
      throw new ApiError(
        'unprocessable',
        'Send every column of this space exactly once, in the order you want them',
        { expected: current.length, received: orderedIds.length },
      );
    }

    // Phase 1 — park outside the occupied range.
    db.update(boardColumns)
      .set({ position: sql`-(${boardColumns.position} + 1)` })
      .where(eq(boardColumns.projectId, project.id))
      .run();

    // Phase 2 — write the target order into the space that is now empty.
    orderedIds.forEach((id, i) => {
      db.update(boardColumns).set({ position: i, updatedAt: now }).where(eq(boardColumns.id, id)).run();
    });

    note(db, actor, project, { action: 'reordered', order: [...orderedIds] }, now);

    return readBoard(db, project.id);
  });
}
