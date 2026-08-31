import { and, asc, eq, gt, gte, inArray, isNull, or } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { type ResolvedActor, withProject } from '../auth/resolve-actor.ts';
import { apiFieldNames, appendActivity } from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  addDependency,
  dependencyEdges,
  DependencyError,
  type DependencyEdges,
} from '../db/dependencies.ts';
import { type TaskPriority, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction, nextTaskNumber } from '../db/numbering.ts';
import { projects, taskDependencies, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { commentCounts } from './comments.ts';
import { normaliseTagNames, setTaskTags, tagsForTasks, taskIdsWithTag } from './tags.ts';
import { requireProjectBySlug } from './projects.ts';
import { assertTransition, isReady } from './task-lifecycle.ts';

/**
 * Tasks (SPEC §4.5, §5, §6.4) — creation, listing, transitions, claiming and
 * dependency links.
 *
 * Every function takes an `Actor`, calls `assertCan` before touching anything,
 * and writes exactly one `activity` row per mutation. Routes are transport only
 * (CONVENTIONS §2), so the M3 MCP tools reuse these unchanged (SPEC §7).
 */

export interface TaskView {
  id: string;
  key: string;
  project_id: string;
  number: number;
  title: string;
  description_md: string | null;
  /** What "done" means here — prose, nullable (§4.5, LAI-092). */
  acceptance_md: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  /** Null is the ordinary state: not in a sprint, never "no sprint yet" (§4.5). */
  sprint_id: string | null;
  created_by: string;
  created_via: string;
  discovered_from: string | null;
  ready: boolean;
  /**
   * Live comments on this task — **derived at read time, never stored**
   * (LAI-072). Excludes soft-deleted ones, so it cannot disagree with the thread
   * the reader opens.
   */
  comment_count: number;
  /** Project-scoped labels, sorted (§4.16). Empty when none are applied. */
  tags: string[];
  /**
   * Ids this task is **blocked by** — the forward edge of §4.6.
   *
   * Named `dependencies` rather than `blocked_by` because that is the wire
   * contract clients already read; renaming it is a breaking change and belongs
   * in its own task, not smuggled in beside a new field. `blocks` below is the
   * other direction and they are deliberately not merged.
   */
  dependencies: string[];
  /**
   * Ids this task **blocks** — the reverse edge, read through §4.13's
   * `task_dependencies(depends_on_task_id)` index (LAI-091).
   *
   * The opposite meaning to `dependencies`, and the question that makes someone
   * go and unblock other people. A task holding up three others used to show
   * nothing at all.
   */
  blocks: string[];
  created_at: number;
  updated_at: number;
}

type TaskRow = typeof tasks.$inferSelect;

/**
 * Everything a page of task views needs from other tables, in a fixed number of
 * queries rather than a number that grows with the page (LAI-091).
 *
 * Before this, `toView` read one task's dependencies and then their statuses,
 * per row — so a 50-task board issued 101 queries to render. It is now three,
 * whatever the page size: the tasks, both dependency directions, and the
 * statuses of everything referenced.
 */
interface ViewContext {
  readonly edges: DependencyEdges;
  /** Status of every task named by an edge, for the §4.5 readiness rule. */
  readonly statuses: ReadonlyMap<string, TaskStatus>;
  /** Live comment count per task (LAI-072). */
  readonly comments: ReadonlyMap<string, number>;
  /** Tags per task (§4.16, LAI-079). */
  readonly tags: ReadonlyMap<string, string[]>;
}

function loadViewContext(db: Db, rows: readonly TaskRow[]): ViewContext {
  const edges = dependencyEdges(
    db,
    rows.map((row) => row.id),
  );

  // Only the blocked-by side is needed: readiness depends on what blocks you and
  // never on what you block. Loading the other side's statuses would be work
  // that no rule reads.
  const referenced = [...new Set([...edges.blockedBy.values()].flat())];

  const statuses = new Map<string, TaskStatus>(
    referenced.length === 0
      ? []
      : db
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.id, referenced))
          .all()
          .map((r) => [r.id, r.status] as const),
  );

  const ids = rows.map((row) => row.id);

  return { edges, statuses, comments: commentCounts(db, ids), tags: tagsForTasks(db, ids) };
}

function toView(row: TaskRow, prefix: string, context: ViewContext): TaskView {
  const deps = context.edges.blockedBy.get(row.id) ?? [];
  const statuses = deps
    .map((id) => context.statuses.get(id))
    .filter((status): status is TaskStatus => status !== undefined);

  return {
    id: row.id,
    // The display key humans and agents use: `LAI-42` (§4.5).
    key: `${prefix}-${String(row.number)}`,
    project_id: row.projectId,
    number: row.number,
    title: row.title,
    description_md: row.descriptionMd,
    acceptance_md: row.acceptanceMd,
    status: row.status,
    priority: row.priority,
    assignee_id: row.assigneeId,
    sprint_id: row.sprintId,
    created_by: row.createdBy,
    created_via: row.createdVia,
    discovered_from: row.discoveredFrom,
    // §4.5's rule, unchanged by LAI-091: readiness is a function of what blocks
    // this task. `blocks` is deliberately not an input — a task holding up ten
    // others is no less ready to be picked up itself.
    ready: isReady({
      status: row.status,
      assigneeId: row.assigneeId,
      dependencyStatuses: statuses,
    }),
    dependencies: deps,
    blocks: context.edges.blocks.get(row.id) ?? [],
    comment_count: context.comments.get(row.id) ?? 0,
    tags: context.tags.get(row.id) ?? [],
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** One task's view, loading only what that task needs. */
function viewOne(db: Db, row: TaskRow, prefix: string): TaskView {
  return toView(row, prefix, loadViewContext(db, [row]));
}

/** Load a task and the project it belongs to, or 404. */
function requireTask(
  db: Db,
  taskId: string,
): { task: TaskRow; project: typeof projects.$inferSelect } {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (task === undefined) throw ApiError.notFound(`No task with id "${taskId}"`);

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (project === undefined) throw ApiError.notFound('That task belongs to no project');

  return { task, project };
}

export function getTask(db: Db, actor: ResolvedActor, taskId: string): TaskView {
  const { task, project } = requireTask(db, taskId);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  return viewOne(db, task, project.prefix);
}

export interface CreateTaskInput {
  title: string;
  description_md?: string | undefined;
  acceptance_md?: string | undefined;
  tags?: readonly string[] | undefined;
  priority?: TaskPriority | undefined;
  status?: TaskStatus | undefined;
  assignee_id?: string | undefined;
  discovered_from?: string | undefined;
  created_via?: 'web' | 'mcp' | 'api' | 'webhook' | 'meeting' | undefined;
  now?: number;
}

export function createTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  slug: string,
  input: CreateTaskInput,
): TaskView {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'task.write', { projectId: project.id });

  const now = input.now ?? Date.now();

  return immediateTransaction(sqlite, () => {
    // Inside the write lock: `nextTaskNumber` reads MAX(number), and a deferred
    // transaction would let two creates read the same value (LAI-003).
    const number = nextTaskNumber(db, project.id);
    const id = newId();

    db.insert(tasks)
      .values({
        id,
        projectId: project.id,
        number,
        title: input.title,
        descriptionMd: input.description_md ?? null,
        acceptanceMd: input.acceptance_md ?? null,
        status: input.status ?? 'backlog',
        priority: input.priority ?? 'p2',
        assigneeId: input.assignee_id ?? null,
        createdBy: actor.userId,
        createdVia: input.created_via ?? 'api',
        // Provenance, not a dependency (§4.6) — see `discovered_from` below.
        discoveredFrom: input.discovered_from ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Inside the same transaction as the insert: a task that exists without the
    // labels it was created with is a half-applied create, and the caller has no
    // way to tell which half landed.
    if (input.tags !== undefined) {
      setTaskTags(db, {
        taskId: id,
        projectId: project.id,
        names: normaliseTagNames(input.tags),
        now,
      });
    }

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId: id,
      actorId: actor.userId,
      actorKind: 'user',
      type: 'task.created',
      payload: { key: `${project.prefix}-${String(number)}`, title: input.title },
      now,
    });

    return viewOne(db, db.select().from(tasks).where(eq(tasks.id, id)).get()!, project.prefix);
  });
}

export interface ListTasksFilter {
  status?: TaskStatus | undefined;
  /** §4.16's `?tag=` — a tag name, normalised before it is looked up. */
  tag?: string | undefined;
  assignee?: string | undefined;
  priority?: TaskPriority | undefined;
  /** `true` returns only ready tasks, `false` only unready ones (§4.5). */
  ready?: boolean | undefined;
  /** A sprint id, or `none` for tasks in no sprint (§4.15, §6.4). */
  sprint?: string | undefined;
  updatedSince?: number | null;
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
}

export function listTasks(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  filter: ListTasksFilter,
): TaskView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const conditions = [eq(tasks.projectId, project.id)];

  if (filter.status !== undefined) conditions.push(eq(tasks.status, filter.status));
  if (filter.priority !== undefined) conditions.push(eq(tasks.priority, filter.priority));
  if (filter.assignee !== undefined) {
    // `assignee=none` is the only way to ask for unassigned work over a query
    // string, where every value is a string and "" is indistinguishable from
    // absent.
    conditions.push(
      filter.assignee === 'none' ? isNull(tasks.assigneeId) : eq(tasks.assigneeId, filter.assignee),
    );
  }
  if (filter.sprint !== undefined) {
    // `sprint=none` for the same reason as `assignee=none`: over a query string
    // every value is a string and "" cannot be told apart from absent.
    conditions.push(
      filter.sprint === 'none' ? isNull(tasks.sprintId) : eq(tasks.sprintId, filter.sprint),
    );
  }
  if (filter.tag !== undefined) {
    // Resolved to ids first so the filter is an indexed `IN` over the tag side —
    // §4.13's `task_tags(tag_id)` index exists for exactly this. An unknown tag
    // yields an empty list, which `inArray` renders as `WHERE false`.
    conditions.push(inArray(tasks.id, taskIdsWithTag(db, project.id, filter.tag)));
  }

  if (filter.updatedSince !== null && filter.updatedSince !== undefined) {
    conditions.push(gte(tasks.updatedAt, filter.updatedSince));
  }
  if (filter.cursor !== null) {
    const key = Number(filter.cursor.sortKey);
    conditions.push(
      or(gt(tasks.updatedAt, key), and(eq(tasks.updatedAt, key), gt(tasks.id, filter.cursor.id)))!,
    );
  }

  const rows = db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(tasks.updatedAt), asc(tasks.id))
    .all();

  // One context for the whole page — the point of LAI-091's batching.
  const context = loadViewContext(db, rows);
  const views = rows.map((row) => toView(row, project.prefix, context));

  // `ready` is derived, so it cannot be a SQL predicate without duplicating the
  // rule (§4.5). Filtering after the query keeps one definition of readiness.
  const filtered =
    filter.ready === undefined ? views : views.filter((v) => v.ready === filter.ready);

  return filtered.slice(0, filter.limit + 1);
}

export interface UpdateTaskInput {
  title?: string | undefined;
  description_md?: string | undefined;
  /**
   * `null` clears it, absent leaves it alone — different requests, as `goal` on
   * a sprint already is. An empty string would store "acceptance is nothing",
   * which is a claim nobody meant to make.
   */
  acceptance_md?: string | null | undefined;
  /** Replaces the whole set — `PATCH { tags }` reads as "these are its tags". */
  tags?: readonly string[] | undefined;
  priority?: TaskPriority | undefined;
  assignee_id?: string | null | undefined;
  now?: number;
}

/**
 * PATCH. Deliberately **not** a status change — that is `changeStatus`, because
 * §5 makes transitions a validated operation and a generic field update would
 * route around the table.
 */
export function updateTask(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  input: UpdateTaskInput,
): TaskView {
  const { task, project } = requireTask(db, taskId);
  const scoped = withProject(actor, project.id);
  assertCan(scoped, 'task.write', { projectId: project.id });

  const now = input.now ?? Date.now();
  const changes: Record<string, unknown> = {};

  if (input.title !== undefined) changes.title = input.title;
  if (input.description_md !== undefined) changes.descriptionMd = input.description_md;
  if (input.acceptance_md !== undefined) changes.acceptanceMd = input.acceptance_md;
  if (input.priority !== undefined) changes.priority = input.priority;

  const reassigning = input.assignee_id !== undefined && input.assignee_id !== task.assigneeId;
  if (reassigning) {
    assertCan(scoped, 'task.assign_other', { projectId: project.id });
    changes.assigneeId = input.assignee_id;
  }

  // Tags are not a column, so they are not in `changes` — they are applied
  // separately and get their own activity row naming the field (§4.16, D-027).
  const tagChange =
    input.tags === undefined
      ? null
      : setTaskTags(db, {
          taskId,
          projectId: project.id,
          names: normaliseTagNames(input.tags),
          now,
        });

  if (tagChange !== null) {
    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      actorId: actor.userId,
      actorKind: 'user',
      // `task.updated` with the field named — the shape `sprint_id` uses, and
      // deliberately not a seventh §4.8 verb (D-027).
      type: 'task.updated',
      payload: { field: 'tags', from: tagChange.from, to: tagChange.to },
      now,
    });
  }

  if (Object.keys(changes).length === 0) {
    return viewOne(db, db.select().from(tasks).where(eq(tasks.id, taskId)).get()!, project.prefix);
  }

  db.update(tasks)
    .set({ ...changes, updatedAt: now })
    .where(eq(tasks.id, taskId))
    .run();

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    actorId: actor.userId,
    actorKind: 'user',
    // §5: "A task may be reassigned while in_progress — that is `task.assigned`,
    // not a status change."
    type: reassigning ? 'task.assigned' : 'task.updated',
    payload: reassigning
      ? { from: task.assigneeId, to: input.assignee_id ?? null }
      : { changed: apiFieldNames(tasks, Object.keys(changes)) },
    now,
  });

  return viewOne(db, db.select().from(tasks).where(eq(tasks.id, taskId)).get()!, project.prefix);
}

/**
 * Claim: compare-and-swap (SPEC §5, AC3).
 *
 * The API twin of the file-move lock the build sessions use by hand — getting it
 * wrong puts two agents on one task. The swap runs inside `BEGIN IMMEDIATE` and
 * the `UPDATE` itself carries `assignee_id IS NULL`, so the check and the write
 * cannot be separated by another writer. A loser is told **who** holds it, since
 * "conflict" alone does not tell an agent what to do next.
 */
export function claimTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): TaskView {
  const { project } = requireTask(db, taskId);
  assertCan(withProject(actor, project.id), 'task.claim', { projectId: project.id });

  return immediateTransaction(sqlite, () => {
    const changed = db
      .update(tasks)
      .set({ assigneeId: actor.userId, status: 'in_progress', startedAt: now, updatedAt: now })
      .where(and(eq(tasks.id, taskId), isNull(tasks.assigneeId)))
      .run();

    if (changed.changes === 0) {
      const current = db.select().from(tasks).where(eq(tasks.id, taskId)).get();

      throw new ApiError('conflict', 'That task is already claimed', {
        assignee_id: current?.assigneeId ?? null,
        status: current?.status ?? null,
      });
    }

    const after = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      actorId: actor.userId,
      actorKind: 'user',
      type: 'task.status_changed',
      payload: { from: 'todo', to: 'in_progress', assignee_id: actor.userId, via: 'claim' },
      now,
    });

    return viewOne(db, after, project.prefix);
  });
}

export function changeStatus(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  to: TaskStatus,
  now: number = Date.now(),
): TaskView {
  const { task, project } = requireTask(db, taskId);
  const scoped = withProject(actor, project.id);
  assertCan(scoped, 'task.write', { projectId: project.id });

  assertTransition(task.status, to);

  // §5: moving to `review` requires the assignee, a project lead, or org
  // Admin/Owner. The task text said "assignee, Admin or Owner" and omitted lead;
  // the spec wins (D-011).
  if (to === 'review') {
    const isAssignee = task.assigneeId === actor.userId;
    const isLeadOrAbove =
      scoped.projectRole === 'lead' || actor.orgRole === 'owner' || actor.orgRole === 'admin';

    if (!isAssignee && !isLeadOrAbove) {
      throw new ApiError(
        'forbidden',
        'Only the assignee, a project lead or an admin may send a task to review',
      );
    }
  }

  db.update(tasks)
    .set({
      status: to,
      updatedAt: now,
      ...(to === 'done' ? { completedAt: now } : {}),
    })
    .where(eq(tasks.id, taskId))
    .run();

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    actorId: actor.userId,
    actorKind: 'user',
    type: 'task.status_changed',
    payload: { from: task.status, to },
    now,
  });

  return viewOne(db, db.select().from(tasks).where(eq(tasks.id, taskId)).get()!, project.prefix);
}

export function addTaskDependency(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  dependsOnTaskId: string,
  now: number = Date.now(),
): TaskView {
  const { project } = requireTask(db, taskId);
  assertCan(withProject(actor, project.id), 'task.dependency.write', { projectId: project.id });

  // Both ends must exist, or a typo silently creates an unsatisfiable blocker.
  requireTask(db, dependsOnTaskId);

  try {
    addDependency(sqlite, db, taskId, dependsOnTaskId, now);
  } catch (err) {
    if (err instanceof DependencyError) {
      throw new ApiError(err.reason === 'duplicate' ? 'conflict' : 'unprocessable', err.message, {
        reason: err.reason,
      });
    }
    throw err;
  }

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    actorId: actor.userId,
    actorKind: 'user',
    type: 'task.dependency_added',
    payload: { depends_on: dependsOnTaskId },
    now,
  });

  return getTask(db, actor, taskId);
}

export function removeTaskDependency(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  dependsOnTaskId: string,
  now: number = Date.now(),
): TaskView {
  const { project } = requireTask(db, taskId);
  assertCan(withProject(actor, project.id), 'task.dependency.write', { projectId: project.id });

  const removed = db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, taskId),
        eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
      ),
    )
    .run();

  if (removed.changes === 0) throw ApiError.notFound('That dependency does not exist');

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    actorId: actor.userId,
    actorKind: 'user',
    type: 'task.dependency_removed',
    payload: { depends_on: dependsOnTaskId },
    now,
  });

  return getTask(db, actor, taskId);
}
