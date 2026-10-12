import { and, asc, count, eq, sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { activityActor, type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { TASK_STATUSES, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { CATEGORY_LABELS, STATUS_NAME_MAX } from '../db/project-statuses.ts';
import { projectStatuses, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { requireProjectBySlug } from './projects.ts';
import { changeStatus } from './tasks.ts';

/**
 * Re-exported so `routes/project-statuses.ts` can validate a category without
 * importing `db/`, which CONVENTIONS §2 forbids for `http/routes/`.
 */
export { TASK_STATUSES } from '../db/enums.ts';

/**
 * The seeds and the category resolution live in `db/project-statuses.ts`,
 * because `numbering.ts` needs them and `db/` imports nothing above it
 * (CONVENTIONS §2). Re-exported here because this is where callers look.
 */
export {
  CATEGORY_LABELS,
  createDefaultProjectStatuses,
  DEFAULT_STATUSES,
  STATUS_NAME_MAX,
} from '../db/project-statuses.ts';

/**
 * A project's own statuses (LAI-738, D-077) — Jira's team-managed model.
 *
 * **One status is one board column.** A project names, orders and hides its
 * statuses; each belongs to one of the six fixed categories, which is what §5's
 * lifecycle and everything downstream of it reads. A task carries both: the
 * category in `tasks.status`, the status in `tasks.status_id`.
 *
 * This replaces LAI-266's board columns, whose model — a column holding a set
 * of categories — produced the four bugs that retired it: unticking a status
 * always failed, a donor column lost its primary, deleting a column merged its
 * statuses into another, and an empty column vanished from the board. A status
 * cannot be empty in the sense that broke (it is its own category's member by
 * construction), and deleting one moves **tasks**, not categories.
 *
 * ## The invariant this module holds, and the database does not
 *
 * **Every project keeps at least one status in each category.** The `tasks`
 * foreign key makes a task's status agree with its category; it cannot say
 * that a category is never left without a status, which would leave the §5
 * table pointing at a transition no column can show. `deleteProjectStatus` is
 * the only function that removes a row, and it refuses the last of a category.
 */

/** A status as the API serves it (§6.4). */
export interface ProjectStatusView {
  id: string;
  project_id: string;
  name: string;
  /** One of the six §5 categories. Fixed for the life of the status. */
  category: TaskStatus;
  /** 0-based, dense, unique in the project: the board's left-to-right order. */
  position: number;
  /** Holds work but draws no column (Cancelled, by default). */
  hidden: boolean;
  created_at: number;
  /** Tasks in this status now — what a delete would have to move. */
  task_count: number;
}

type StatusRow = typeof projectStatuses.$inferSelect;

function readStatuses(db: Db, projectId: string): ProjectStatusView[] {
  const counts = new Map(
    db
      .select({ statusId: tasks.statusId, n: count() })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .groupBy(tasks.statusId)
      .all()
      .map((r) => [r.statusId, r.n] as const),
  );

  return db
    .select()
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId))
    .orderBy(asc(projectStatuses.position))
    .all()
    .map((row) => ({
      id: row.id,
      project_id: row.projectId,
      name: row.name,
      category: row.category,
      position: row.position,
      hidden: row.hidden === 1,
      created_at: row.createdAt,
      task_count: counts.get(row.id) ?? 0,
    }));
}

function requireStatus(db: Db, projectId: string, statusId: string): StatusRow {
  const row = db
    .select()
    .from(projectStatuses)
    .where(and(eq(projectStatuses.id, statusId), eq(projectStatuses.projectId, projectId)))
    .get();

  if (row === undefined) throw ApiError.notFound('This project has no such status');
  return row;
}

function cleanName(raw: string): string {
  const name = raw.trim();

  if (name.length === 0) throw new ApiError('unprocessable', 'A status needs a name');
  if (name.length > STATUS_NAME_MAX) {
    throw new ApiError(
      'unprocessable',
      `A status name is at most ${String(STATUS_NAME_MAX)} characters`,
    );
  }

  return name;
}

/**
 * Case-insensitively, as the unique index is — with the full Unicode fold
 * here, where SQLite's `lower()` folds ASCII only. "Review" and "review" are
 * one name to anybody reading the board.
 */
function assertNameFree(db: Db, projectId: string, name: string, exceptId?: string): void {
  const wanted = name.toLowerCase();
  const clash = db
    .select({ id: projectStatuses.id, name: projectStatuses.name })
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId))
    .all()
    .find((r) => r.id !== exceptId && r.name.toLowerCase() === wanted);

  if (clash !== undefined) {
    throw new ApiError('conflict', `This project already has a status called ${clash.name}`, {
      field: 'name',
    });
  }
}

/**
 * Write `ids` as the project's order, 0..n-1.
 *
 * **Parks every row below zero first**, because SQLite checks a unique index
 * per row and has no deferrable constraint: rewriting a permutation in place
 * fails `UNIQUE constraint failed` partway through. Measured on LAI-266's
 * columns, which had the same index; the schema says not to add the CHECK
 * that would stop this.
 */
function writeOrder(db: Db, projectId: string, ids: readonly string[]): void {
  db.update(projectStatuses)
    .set({ position: sql`-(${projectStatuses.position} + 1)` })
    .where(eq(projectStatuses.projectId, projectId))
    .run();

  ids.forEach((id, i) => {
    db.update(projectStatuses).set({ position: i }).where(eq(projectStatuses.id, id)).run();
  });
}

function currentOrder(db: Db, projectId: string): string[] {
  return db
    .select({ id: projectStatuses.id })
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId))
    .orderBy(asc(projectStatuses.position))
    .all()
    .map((r) => r.id);
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
     * **`project.updated`, not a verb of its own** — the call LAI-266 made for
     * columns, for the same reasons. A status is project configuration, which
     * is what this verb names, and a verb added to `ACTIVITY_TYPES` is always
     * three owners (CLAUDE.md §4.4). `entity` is what a later filter keys on.
     */
    type: 'project.updated',
    payload: { entity: 'project_status', ...payload },
    now,
  });
}

// ------------------------------------------------------------------ reading

export function listProjectStatuses(
  db: Db,
  actor: ResolvedActor,
  slug: string,
): ProjectStatusView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  return readStatuses(db, project.id);
}

// ----------------------------------------------------------------- writing

/**
 * Ask `project.settings.edit` before anything else is looked at.
 *
 * Every write below asks it too; this exists so the **route** can ask first,
 * before validating a body. A caller who may not edit statuses should learn
 * that — `403` — rather than receive a `422` describing what a valid request
 * would have looked like (CLAUDE.md §5: `can()` before reading or writing).
 */
export function assertCanEditStatuses(db: Db, actor: ResolvedActor, slug: string): void {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });
}

export interface CreateProjectStatusInput {
  name: string;
  category: TaskStatus;
  /**
   * Where it goes, 0-based; everything from there moves one right. Absent
   * means **straight after the last status of the same category** — a new
   * in-progress status lands among the in-progress ones, not after Done.
   */
  position?: number | undefined;
}

export function createProjectStatus(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: CreateProjectStatusInput,
  now: number = Date.now(),
): ProjectStatusView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  const name = cleanName(input.name);
  if (!TASK_STATUSES.includes(input.category)) {
    throw new ApiError('unprocessable', 'A status’s category must be one of the six', {
      field: 'category',
      allowed: TASK_STATUSES,
    });
  }

  return immediateTransaction(sqlite, () => {
    assertNameFree(db, project.id, name);

    const order = currentOrder(db, project.id);
    const rows = readStatuses(db, project.id);
    let at = input.position;
    if (at === undefined) {
      const lastOfCategory = rows.filter((r) => r.category === input.category).at(-1);
      at = lastOfCategory === undefined ? order.length : lastOfCategory.position + 1;
    }
    if (!Number.isInteger(at) || at < 0 || at > order.length) {
      throw new ApiError(
        'unprocessable',
        `A position is between 0 and ${String(order.length)} for this project`,
        { field: 'position' },
      );
    }

    const id = newId();
    db.insert(projectStatuses)
      .values({
        id,
        projectId: project.id,
        name,
        category: input.category,
        // Clear of every existing position; `writeOrder` puts it where it goes.
        position: order.length,
        hidden: 0,
        createdAt: now,
      })
      .run();
    writeOrder(db, project.id, [...order.slice(0, at), id, ...order.slice(at)]);

    note(
      db,
      actor,
      project,
      { action: 'created', status_id: id, name, category: input.category },
      now,
    );

    return readStatuses(db, project.id);
  });
}

export interface UpdateProjectStatusInput {
  name?: string | undefined;
  hidden?: boolean | undefined;
}

export function updateProjectStatus(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  statusId: string,
  input: UpdateProjectStatusInput,
  now: number = Date.now(),
): ProjectStatusView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  return immediateTransaction(sqlite, () => {
    const row = requireStatus(db, project.id, statusId);
    const changes: { name?: string; hidden?: number } = {};

    if (input.name !== undefined) {
      const name = cleanName(input.name);
      if (name !== row.name) {
        assertNameFree(db, project.id, name, statusId);
        changes.name = name;
      }
    }
    if (input.hidden !== undefined && (input.hidden ? 1 : 0) !== row.hidden) {
      changes.hidden = input.hidden ? 1 : 0;
    }

    if (Object.keys(changes).length > 0) {
      db.update(projectStatuses).set(changes).where(eq(projectStatuses.id, statusId)).run();
      note(
        db,
        actor,
        project,
        {
          action: 'updated',
          status_id: statusId,
          ...(changes.name === undefined ? {} : { from_name: row.name, name: changes.name }),
          ...(changes.hidden === undefined ? {} : { hidden: changes.hidden === 1 }),
        },
        now,
      );
    }

    return readStatuses(db, project.id);
  });
}

/**
 * Put the statuses in this order — the whole list, every id exactly once.
 *
 * The whole list, not a neighbour, for LAI-266's reason: a project has a
 * handful of statuses, so rewriting all of them is free, and a client working
 * from a stale list cannot silently drop one — anything that is not a
 * permutation is refused.
 */
export function reorderProjectStatuses(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  orderedIds: readonly string[],
  now: number = Date.now(),
): ProjectStatusView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  return immediateTransaction(sqlite, () => {
    const current = currentOrder(db, project.id);
    const given = new Set(orderedIds);

    if (
      given.size !== orderedIds.length ||
      orderedIds.length !== current.length ||
      !current.every((id) => given.has(id))
    ) {
      throw new ApiError(
        'unprocessable',
        'Send every status of this project exactly once, in the order you want them',
        { expected: current.length, received: orderedIds.length },
      );
    }

    writeOrder(db, project.id, orderedIds);
    note(db, actor, project, { action: 'reordered', order: [...orderedIds] }, now);

    return readStatuses(db, project.id);
  });
}

/**
 * Delete a status, after moving every task in it to `moveTo`.
 *
 * **A task in the other category makes a real status change**, through
 * `changeStatus` — §5's table, the review rule, the dates and the activity
 * row, exactly as if the person had dragged each card. Deleting a status is
 * not a way around the lifecycle: if any one move is refused, nothing is
 * moved and nothing is deleted, and the error names the task.
 *
 * **A task in the same category** just changes column: `changeStatus` writes
 * that as a same-category move.
 *
 * Refused when the status is the last of its category (the invariant above)
 * and when `moveTo` is the status itself.
 */
export function deleteProjectStatus(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  statusId: string,
  moveTo: string,
  now: number = Date.now(),
): { data: ProjectStatusView[]; moved: number } {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });

  return immediateTransaction(sqlite, () => {
    const doomed = requireStatus(db, project.id, statusId);

    if (moveTo === statusId) {
      throw new ApiError(
        'unprocessable',
        `Move the work in ${doomed.name} to a different status before deleting it`,
        { field: 'move_to' },
      );
    }
    const target = db
      .select()
      .from(projectStatuses)
      .where(and(eq(projectStatuses.id, moveTo), eq(projectStatuses.projectId, project.id)))
      .get();
    if (target === undefined) {
      throw new ApiError(
        'unprocessable',
        'The status to move work to is not one of this project’s',
        {
          field: 'move_to',
        },
      );
    }

    const sameCategory = db
      .select({ id: projectStatuses.id })
      .from(projectStatuses)
      .where(
        and(
          eq(projectStatuses.projectId, project.id),
          eq(projectStatuses.category, doomed.category),
        ),
      )
      .all();
    if (sameCategory.length <= 1) {
      throw new ApiError(
        'conflict',
        `${doomed.name} is this project’s only ${CATEGORY_LABELS[doomed.category]} status, and every project keeps at least one`,
        { category: doomed.category },
      );
    }

    const moving = db
      .select({ id: tasks.id, number: tasks.number })
      .from(tasks)
      .where(eq(tasks.statusId, statusId))
      .orderBy(asc(tasks.number))
      .all();

    for (const task of moving) {
      try {
        changeStatus(db, actor, task.id, { status_id: moveTo }, now);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        throw new ApiError(
          error.code,
          `${doomed.name} was not deleted: ${project.prefix}-${String(task.number)} cannot move to ${target.name}. ${error.message}`,
          {
            task_id: task.id,
            ...(typeof error.details === 'object' && error.details !== null ? error.details : {}),
          },
        );
      }
    }

    db.delete(projectStatuses).where(eq(projectStatuses.id, statusId)).run();
    writeOrder(db, project.id, currentOrder(db, project.id));

    note(
      db,
      actor,
      project,
      {
        action: 'deleted',
        status_id: statusId,
        name: doomed.name,
        category: doomed.category,
        moved_to: moveTo,
        moved: moving.length,
      },
      now,
    );

    return { data: readStatuses(db, project.id), moved: moving.length };
  });
}
