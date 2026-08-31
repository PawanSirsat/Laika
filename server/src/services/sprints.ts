import { and, asc, eq, gt, gte, inArray, lte, ne, or, type SQL } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { type ResolvedActor, withProject, activityActor } from '../auth/resolve-actor.ts';
import { appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import { type SprintStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction } from '../db/numbering.ts';
import { projects, sprints, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { requireProjectBySlug } from './projects.ts';
import { getTask, type TaskView } from './tasks.ts';

/**
 * Sprints (SPEC §4.15, §6.4, §3.2, D-013) — dates and a goal, nothing else.
 *
 * **Story points are still a non-goal** (§1.1, D-013). Nothing here estimates,
 * and `/capacity` (§9.3) answers "who is free" from measurement rather than from
 * a velocity model. If a future change to this file starts carrying numbers that
 * are not dates, that is the line being crossed.
 *
 * ## Activity vocabulary
 *
 * §4.8's list is closed and has no sprint verb. Following LAI-047's precedent —
 * growing it is a schema change and therefore its own task — the two mutations
 * are recorded as the nearest true statement:
 *
 *  - **the sprint itself** → `project.updated`, payload
 *    `{ entity: 'sprint', action, sprint_id, name }`. A sprint is a project-level
 *    artefact, so this is stretched but not false.
 *  - **a task moving in or out** → `task.updated`, payload
 *    `{ field: 'sprint_id', from, to }`. This one needs no apology: it *is* a
 *    task update, and it is the row a board wants anyway.
 *
 * `sprint.created` / `sprint.updated` / `sprint.deleted` are filed as LAI-113.
 *
 * ## Dates are inclusive at both ends
 *
 * §4.15 says "integer unix-ms, date-only semantics in the project's timezone" and
 * stops there. A sprint that *ends on* the 14th includes the 14th — that is what
 * a person filling in the field means — so the range is `[starts_on, ends_on]`
 * and the next sprint starts on the 15th. Overlap is therefore
 * `new.starts_on <= other.ends_on && new.ends_on >= other.starts_on`.
 *
 * One consequence, inherited from the `ends_on > starts_on` CHECK that LAI-003
 * shipped: the shortest expressible sprint is two days. A single-day sprint would
 * need `ends_on == starts_on`, which the constraint refuses.
 */

export interface SprintView {
  id: string;
  project_id: string;
  name: string;
  goal: string | null;
  starts_on: number;
  ends_on: number;
  status: SprintStatus;
  created_at: number;
  updated_at: number;
}

type SprintRow = typeof sprints.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

function toView(row: SprintRow): SprintView {
  return {
    id: row.id,
    project_id: row.projectId,
    name: row.name,
    goal: row.goal,
    starts_on: row.startsOn,
    ends_on: row.endsOn,
    status: row.status,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** Load a sprint and its project, or 404. */
function requireSprint(db: Db, sprintId: string): { sprint: SprintRow; project: ProjectRow } {
  const sprint = db.select().from(sprints).where(eq(sprints.id, sprintId)).get();
  if (sprint === undefined) throw ApiError.notFound(`No sprint with id "${sprintId}"`);

  const project = db.select().from(projects).where(eq(projects.id, sprint.projectId)).get();
  if (project === undefined) throw ApiError.notFound('That sprint belongs to no project');

  return { sprint, project };
}

// ------------------------------------------------------------------ the rules

/**
 * §4.15: sprints of one project may not overlap.
 *
 * Not fussiness — D-014's timeline draws one bar per sprint on a single track
 * precisely because this holds. Allowing overlap turns a rendering pass into a
 * layout solver, so it is worth defending even when someone asks for it.
 *
 * There is no database constraint for this: it compares a row against every other
 * row, which SQLite cannot express as a CHECK. It runs inside the same
 * `BEGIN IMMEDIATE` as the write, so two concurrent creates cannot both pass it.
 */
function assertNoOverlap(
  db: Db,
  projectId: string,
  startsOn: number,
  endsOn: number,
  excludingId?: string,
): void {
  const conditions: SQL[] = [
    eq(sprints.projectId, projectId),
    lte(sprints.startsOn, endsOn),
    gte(sprints.endsOn, startsOn),
  ];
  if (excludingId !== undefined) conditions.push(ne(sprints.id, excludingId));

  const clash = db
    .select()
    .from(sprints)
    .where(and(...conditions))
    .get();

  if (clash !== undefined) {
    throw new ApiError('conflict', `Those dates overlap sprint "${clash.name}"`, {
      sprint_id: clash.id,
      name: clash.name,
      starts_on: clash.startsOn,
      ends_on: clash.endsOn,
    });
  }
}

/** §4.15: at most one `active` sprint per project. */
function assertNoOtherActive(db: Db, projectId: string, excludingId?: string): void {
  const conditions: SQL[] = [eq(sprints.projectId, projectId), eq(sprints.status, 'active')];
  if (excludingId !== undefined) conditions.push(ne(sprints.id, excludingId));

  const active = db
    .select()
    .from(sprints)
    .where(and(...conditions))
    .get();

  if (active !== undefined) {
    throw new ApiError('conflict', `Sprint "${active.name}" is already active`, {
      sprint_id: active.id,
      name: active.name,
    });
  }
}

/**
 * `ends_on` after `starts_on`, both required (§4.15).
 *
 * Checked here as well as by the database CHECK, because the service is the
 * contract the MCP tools call in M3 and a constraint violation surfacing as a
 * 500 is not an answer a caller can act on.
 */
function assertDatesOrdered(startsOn: number, endsOn: number): void {
  if (endsOn > startsOn) return;

  throw new ApiError('unprocessable', 'ends_on must be after starts_on', {
    starts_on: startsOn,
    ends_on: endsOn,
  });
}

// -------------------------------------------------------------------- reading

export interface ListSprintsOptions {
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  updatedSince: number | null;
  status?: SprintStatus | undefined;
}

/**
 * Ordered by `(starts_on, id)` rather than the `updated_at` the other lists use.
 *
 * A sprint list is a calendar: every screen that reads it — the Sprints board,
 * D-014's timeline — wants it chronologically, and re-sorting client-side would
 * make the cursor meaningless.
 */
export function listSprints(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  options: ListSprintsOptions,
): SprintView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const conditions: SQL[] = [eq(sprints.projectId, project.id)];

  if (options.status !== undefined) conditions.push(eq(sprints.status, options.status));
  if (options.updatedSince !== null) conditions.push(gte(sprints.updatedAt, options.updatedSince));
  if (options.cursor !== null) {
    const key = Number(options.cursor.sortKey);
    conditions.push(
      or(
        gt(sprints.startsOn, key),
        and(eq(sprints.startsOn, key), gt(sprints.id, options.cursor.id)),
      )!,
    );
  }

  return db
    .select()
    .from(sprints)
    .where(and(...conditions))
    .orderBy(asc(sprints.startsOn), asc(sprints.id))
    .limit(options.limit + 1)
    .all()
    .map(toView);
}

export function getSprint(db: Db, actor: ResolvedActor, sprintId: string): SprintView {
  const { sprint, project } = requireSprint(db, sprintId);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  return toView(sprint);
}

// -------------------------------------------------------------------- writing

export interface CreateSprintInput {
  name: string;
  goal?: string | null | undefined;
  starts_on: number;
  ends_on: number;
  status?: SprintStatus | undefined;
  now?: number;
}

export function createSprint(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: CreateSprintInput,
): SprintView {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'sprint.manage', { projectId: project.id });

  assertDatesOrdered(input.starts_on, input.ends_on);

  const now = input.now ?? Date.now();
  const status = input.status ?? 'planned';

  return immediateTransaction(sqlite, () => {
    // Both checks read other rows, so they belong inside the write lock: two
    // concurrent creates that each read before the other wrote would both pass.
    assertNoOverlap(db, project.id, input.starts_on, input.ends_on);
    if (status === 'active') assertNoOtherActive(db, project.id);
    assertNameFree(db, project.id, input.name);

    const id = newId();

    db.insert(sprints)
      .values({
        id,
        projectId: project.id,
        name: input.name,
        goal: input.goal ?? null,
        startsOn: input.starts_on,
        endsOn: input.ends_on,
        status,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    recordSprintChange(db, project, actor, 'created', { id, name: input.name }, now);

    return toView(db.select().from(sprints).where(eq(sprints.id, id)).get()!);
  });
}

export interface UpdateSprintInput {
  name?: string | undefined;
  goal?: string | null | undefined;
  starts_on?: number | undefined;
  ends_on?: number | undefined;
  status?: SprintStatus | undefined;
  now?: number;
}

/**
 * PATCH.
 *
 * Status is an ordinary field here rather than a validated transition as it is
 * for tasks (§5): §4.15 states one rule about sprint status — at most one active
 * per project — and inventing a transition table it does not describe would be
 * making up product. Reopening a completed sprint is therefore allowed.
 *
 * **Completing a sprint does not touch its tasks** (§4.15, D-013). Unfinished
 * work stays unfinished and is moved deliberately, not swept. That is not a
 * branch below — it is the absence of one, which is why it is stated here and
 * asserted in the tests.
 */
export function updateSprint(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  sprintId: string,
  input: UpdateSprintInput,
): SprintView {
  const { sprint, project } = requireSprint(db, sprintId);
  assertCan(withProject(actor, project.id), 'sprint.manage', { projectId: project.id });

  const startsOn = input.starts_on ?? sprint.startsOn;
  const endsOn = input.ends_on ?? sprint.endsOn;
  assertDatesOrdered(startsOn, endsOn);

  const now = input.now ?? Date.now();

  return immediateTransaction(sqlite, () => {
    const changed: string[] = [];

    if (input.name !== undefined && input.name !== sprint.name) {
      assertNameFree(db, project.id, input.name, sprint.id);
      changed.push('name');
    }
    if (input.goal !== undefined && (input.goal ?? null) !== sprint.goal) changed.push('goal');
    if (startsOn !== sprint.startsOn || endsOn !== sprint.endsOn) {
      assertNoOverlap(db, project.id, startsOn, endsOn, sprint.id);
      changed.push('dates');
    }
    if (input.status !== undefined && input.status !== sprint.status) {
      if (input.status === 'active') assertNoOtherActive(db, project.id, sprint.id);
      changed.push('status');
    }

    if (changed.length === 0) return toView(sprint);

    db.update(sprints)
      .set({
        name: input.name ?? sprint.name,
        goal: input.goal === undefined ? sprint.goal : input.goal,
        startsOn,
        endsOn,
        status: input.status ?? sprint.status,
        updatedAt: now,
      })
      .where(eq(sprints.id, sprintId))
      .run();

    recordSprintChange(
      db,
      project,
      actor,
      'updated',
      { id: sprintId, name: input.name ?? sprint.name, changed },
      now,
    );

    return toView(db.select().from(sprints).where(eq(sprints.id, sprintId)).get()!);
  });
}

/**
 * Delete.
 *
 * §4.15: this sets `sprint_id = NULL` on the sprint's tasks and **never deletes a
 * task**. The nulling is the `ON DELETE set null` foreign key from LAI-003 rather
 * than an UPDATE here — the guarantee is worth more in the schema, where it also
 * holds for a `DELETE` typed into a SQLite shell.
 *
 * No `task.updated` row per released task: a fifty-task sprint would write fifty
 * audit rows describing one human action. The sprint's own row carries the count.
 */
export function deleteSprint(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  sprintId: string,
  now: number = Date.now(),
): void {
  const { sprint, project } = requireSprint(db, sprintId);
  assertCan(withProject(actor, project.id), 'sprint.manage', { projectId: project.id });

  immediateTransaction(sqlite, () => {
    const released = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.sprintId, sprintId))
      .all();

    db.delete(sprints).where(eq(sprints.id, sprintId)).run();

    recordSprintChange(
      db,
      project,
      actor,
      'deleted',
      { id: sprintId, name: sprint.name, tasks_released: released.length },
      now,
    );
  });
}

// ------------------------------------------------------- tasks in and out

/**
 * Assign tasks into a sprint (§6.4 `POST /sprints/:id/tasks`).
 *
 * **All or nothing.** An unknown id, or one belonging to another project, rejects
 * the whole request inside the transaction. A bulk assignment that half-applied
 * would leave the caller unable to tell which half without re-reading every task,
 * and retrying would be neither safe nor idempotent.
 */
export function addTasksToSprint(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  sprintId: string,
  taskIds: readonly string[],
  now: number = Date.now(),
): TaskView[] {
  const { sprint, project } = requireSprint(db, sprintId);
  assertCan(withProject(actor, project.id), 'task.assign_sprint', { projectId: project.id });

  const unique = [...new Set(taskIds)];

  immediateTransaction(sqlite, () => {
    const rows =
      unique.length === 0 ? [] : db.select().from(tasks).where(inArray(tasks.id, unique)).all();

    const missing = unique.filter((id) => !rows.some((row) => row.id === id));
    if (missing.length > 0) {
      throw ApiError.notFound('No task with that id', { task_ids: missing });
    }

    const foreign = rows.filter((row) => row.projectId !== sprint.projectId).map((row) => row.id);
    if (foreign.length > 0) {
      throw new ApiError(
        'unprocessable',
        'Those tasks belong to a different project than the sprint',
        { task_ids: foreign, project_id: sprint.projectId },
      );
    }

    for (const row of rows) {
      if (row.sprintId === sprintId) continue;

      db.update(tasks).set({ sprintId, updatedAt: now }).where(eq(tasks.id, row.id)).run();

      recordTaskMove(db, project, actor, row.id, row.sprintId, sprintId, now);
    }
  });

  return unique.map((id) => getTask(db, actor, id));
}

export function removeTaskFromSprint(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  sprintId: string,
  taskId: string,
  now: number = Date.now(),
): TaskView {
  const { project } = requireSprint(db, sprintId);
  assertCan(withProject(actor, project.id), 'task.assign_sprint', { projectId: project.id });

  immediateTransaction(sqlite, () => {
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);

    // Addressed as a member of *this* sprint, so a task that is not in it is a
    // wrong URL rather than a no-op — silently succeeding would tell a caller
    // their removal worked when they had the wrong sprint.
    if (task.sprintId !== sprintId) {
      throw ApiError.notFound('That task is not in this sprint', {
        task_id: taskId,
        sprint_id: sprintId,
      });
    }

    db.update(tasks).set({ sprintId: null, updatedAt: now }).where(eq(tasks.id, taskId)).run();

    recordTaskMove(db, project, actor, taskId, sprintId, null, now);
  });

  return getTask(db, actor, taskId);
}

// -------------------------------------------------------------------- helpers

/** `sprints_project_name_unique` as a 409 rather than a constraint violation. */
function assertNameFree(db: Db, projectId: string, name: string, excludingId?: string): void {
  const conditions: SQL[] = [eq(sprints.projectId, projectId), eq(sprints.name, name)];
  if (excludingId !== undefined) conditions.push(ne(sprints.id, excludingId));

  const taken = db
    .select({ id: sprints.id })
    .from(sprints)
    .where(and(...conditions))
    .get();

  if (taken !== undefined) {
    throw new ApiError('conflict', `This project already has a sprint called "${name}"`, {
      name,
      sprint_id: taken.id,
    });
  }
}

function recordSprintChange(
  db: Db,
  project: ProjectRow,
  actor: ResolvedActor,
  action: 'created' | 'updated' | 'deleted',
  detail: { id: string; name: string; changed?: string[]; tasks_released?: number },
  now: number,
): void {
  const { id, ...rest } = detail;

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    ...activityActor(actor),
    // See the module comment: §4.8 has no sprint verb, and growing it is LAI-113.
    type: 'project.updated',
    payload: { entity: 'sprint', action, sprint_id: id, ...rest },
    now,
  });
}

function recordTaskMove(
  db: Db,
  project: ProjectRow,
  actor: ResolvedActor,
  taskId: string,
  from: string | null,
  to: string | null,
  now: number,
): void {
  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    ...activityActor(actor),
    type: 'task.updated',
    payload: { field: 'sprint_id', from, to },
    now,
  });
}
