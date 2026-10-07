import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import {
  activityActor,
  isAgentPrincipal,
  isSystemPrincipal,
  type ResolvedActor,
  type ServiceCaller,
  withProject,
} from '../auth/resolve-actor.ts';
import { apiFieldNames, appendActivity, creatingClientNames } from '../db/activity.ts';
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
import { backfillTaskPositions, lastPosition } from '../db/backfill.ts';
import { keyAfter, keyBetween } from '../db/order-key.ts';
import { projects, taskDependencies, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { addComment, commentCounts } from './comments.ts';
import { normaliseTagNames, setTaskTags, tagsForTasks, taskIdsWithTag } from './tags.ts';
import { requireProjectBySlug } from './projects.ts';
import { assertTransition, isReady, type TransitionRule } from './task-lifecycle.ts';

/**
 * Tasks (SPEC §4.5, §5, §6.4) — creation, listing, transitions, claiming and
 * dependency links.
 *
 * Every function takes an `Actor`, calls `assertCan` before touching anything,
 * and writes exactly one `activity` row per mutation. Routes are transport only
 * (CONVENTIONS §2), so the M3 MCP tools reuse these unchanged (SPEC §7).
 */

/**
 * Re-exported so callers can validate a status or priority without importing
 * `db/`, which CONVENTIONS §2 forbids for `http/routes/` and `mcp/` alike.
 *
 * The same line, for the same reason, as `ORG_ROLES` on `services/invites.ts`:
 * a route or a tool that retypes a closed vocabulary makes a copy nothing
 * checks against the original. LAI-119 converges the two route files that
 * still do.
 */
export { CREATED_VIA, TASK_PRIORITIES, TASK_STATUSES } from '../db/enums.ts';

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
  /**
   * The **named client** that created it — `mira-cli`, not `api` (§4.9, LAI-093).
   *
   * Derived from the `task.created` activity row's `actor_token_id`, never
   * stored: `tokens.name` is the one place that name lives, and a copy here
   * would drift the moment somebody renamed or revoked the token.
   *
   * `null` when there is no client to name — a browser session, a task created
   * before tokens existed, or a token since deleted. All three mean the same
   * thing to a reader, and none of them is "unknown": the channel is known and
   * the client is not, so `created_via` alone is the honest rendering.
   */
  created_by_client: string | null;
  discovered_from: string | null;
  /**
   * The task's place in its project's **manual order** (§4.5, LAI-472, D-070):
   * an opaque key that sorts byte-wise. A lane draws its tasks in this order.
   * Compare it, never parse it. `null` only for a row written outside the
   * services before the boot backfill reached it — never on a running server.
   */
  position: string | null;
  /**
   * The task this is a subtask of, or null (§4.5, D-066). One level deep,
   * same project; `ready` ignores it. Children are found with `?parent=`.
   */
  parent_task_id: string | null;
  /**
   * The plan — unix-ms at a UTC midnight, date-only like a sprint's
   * `starts_on` (§4.15) — as distinct from `started_at` / `completed_at`,
   * which are what happened (D-066). "Overdue" is the reader's to derive.
   */
  due_on: number | null;
  planned_start: number | null;
  /** Last branch seen working on it, written by the plugin (§4.5, LAI-286). */
  branch: string | null;
  /** e.g. a GitHub PR URL (§4.5, LAI-286). */
  external_ref: string | null;
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
   * When work actually began and ended — unix ms, null until it happens
   * (§4.5, LAI-126).
   *
   * **These are actuals, not a plan, and the distinction is load-bearing.**
   * D-014 gives tasks no dates on purpose, so the timeline stays a rendering
   * pass over sprint boundaries rather than a scheduling engine. These record
   * what *happened*, where a Gantt bar asserts what is *planned* to happen —
   * exposing them does not reverse D-014, and drawing task bars from them is a
   * separate decision that needs the owner, not a UI change.
   *
   * `started_at` is set the **first** time a task enters `in_progress` and is
   * not moved again by a later re-entry: a task that goes back for rework
   * started when it started, and overwriting it would silently shorten every
   * cycle time computed from it (LAI-124).
   */
  started_at: number | null;
  completed_at: number | null;
  /**
   * When the nightly job last flagged this task as stale — unix ms, null when
   * it has not (§11.7, LAI-208).
   *
   * **The stored timestamp, not a derived boolean**, and the difference is the
   * point. `ready` is computed here because §4.5's rule must have one definition
   * (a second one on the client would drift); staleness is not computed anywhere
   * — a job wrote it down. Sending `stale: true` would throw away the only
   * information the row actually holds, and the UI cannot invent a date it was
   * never sent. §11.4.1's marker wants to say *how* stale.
   */
  stale_flagged_at: number | null;
  /**
   * Ids this task is **blocked by** — the forward edge of §4.6.
   *
   * Was `dependencies` until LAI-099. Next to `blocks`, that name did not say
   * which direction it meant and needed a spec sentence to disambiguate; this
   * one says it. The two are deliberately not merged.
   */
  blocked_by: string[];
  /**
   * Ids this task **blocks** — the reverse edge, read through §4.13's
   * `task_dependencies(depends_on_task_id)` index (LAI-091).
   *
   * The opposite meaning to `blocked_by`, and the question that makes someone
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
  /** Named client per task, joined from `activity` → `tokens` (LAI-093). */
  readonly clients: ReadonlyMap<string, string>;
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

  return {
    edges,
    statuses,
    comments: commentCounts(db, ids),
    tags: tagsForTasks(db, ids),
    clients: creatingClientNames(db, ids),
  };
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
    created_by_client: context.clients.get(row.id) ?? null,
    discovered_from: row.discoveredFrom,
    parent_task_id: row.parentTaskId,
    due_on: row.dueOn,
    planned_start: row.plannedStart,
    branch: row.branch,
    external_ref: row.externalRef,
    // §4.5's rule, unchanged by LAI-091: readiness is a function of what blocks
    // this task. `blocks` is deliberately not an input — a task holding up ten
    // others is no less ready to be picked up itself.
    ready: isReady({
      status: row.status,
      assigneeId: row.assigneeId,
      dependencyStatuses: statuses,
    }),
    blocked_by: deps,
    blocks: context.edges.blocks.get(row.id) ?? [],
    comment_count: context.comments.get(row.id) ?? 0,
    tags: context.tags.get(row.id) ?? [],
    started_at: row.startedAt,
    completed_at: row.completedAt,
    stale_flagged_at: row.staleFlaggedAt,
    position: row.position,
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

/**
 * The one-level rule for subtasks (§4.5, D-066), asked before a parent is
 * written. `taskId` is absent on create — the task does not exist yet, so it
 * cannot have children.
 *
 * Three refusals, all `422 unprocessable` with `details.reason` naming which:
 * - `self` — a task cannot contain itself;
 * - `project` — the parent is missing **or** in another project. One answer
 *   for both, so a task id from a project the caller cannot read is not
 *   confirmed to exist by the shape of the error;
 * - `depth` — the parent has a parent, or this task has children. A CHECK
 *   cannot see another row, so this lives here rather than in the schema.
 */
function assertParentAllowed(
  db: Db,
  input: { taskId: string | null; projectId: string; parentId: string },
): void {
  if (input.taskId !== null && input.parentId === input.taskId) {
    throw parentRefused('self', 'A task cannot be a subtask of itself');
  }

  const parent = db
    .select({ projectId: tasks.projectId, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(eq(tasks.id, input.parentId))
    .get();
  if (parent?.projectId !== input.projectId) {
    throw parentRefused('project', 'The parent must be a task on the same project');
  }
  if (parent.parentTaskId !== null) {
    throw parentRefused('depth', 'That task is itself a subtask — subtasks go one level deep');
  }

  if (input.taskId !== null) {
    const child = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parentTaskId, input.taskId))
      .limit(1)
      .get();
    if (child !== undefined) {
      throw parentRefused(
        'depth',
        'This task has subtasks of its own — subtasks go one level deep',
      );
    }
  }
}

function parentRefused(reason: 'self' | 'project' | 'depth', message: string): ApiError {
  return new ApiError('unprocessable', message, { field: 'parent_task_id', reason });
}

/**
 * `n/m done` for a parent (§4.6, D-066): `done` counts the children at `done`,
 * `total` leaves out `cancelled` — dropped work is not undone work. One
 * definition, used by `get_task_context` and mirrored by the client, so the
 * two cannot disagree about what a cancelled subtask does to the bar.
 */
export function subtaskProgress(subtasks: readonly { status: TaskStatus }[]): {
  done: number;
  total: number;
} {
  return {
    done: subtasks.filter((t) => t.status === 'done').length,
    total: subtasks.filter((t) => t.status !== 'cancelled').length,
  };
}

/**
 * A task named the way a person names one — `LAI-42` — or by its id.
 *
 * §7 asks MCP responses to use **display keys, not raw ULIDs**, wherever a human
 * will read them. That has to run both ways: a tool that prints `LAI-42` and
 * then refuses to accept `LAI-42` back has taught the agent a name it cannot
 * use. Ids stay valid because that is what the REST API hands out.
 *
 * Lives here rather than in `mcp/` because the write tools take the same
 * reference (LAI-408: `start_working({ task })`), and a second parser is a
 * second set of rules about what `LAI-42` means.
 */
const TASK_KEY = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

export function resolveTaskRef(db: Db, ref: string): string {
  const match = TASK_KEY.exec(ref.trim());
  if (match === null) return ref;

  const [, prefix, number] = match;
  if (prefix === undefined || number === undefined) return ref;

  const project = db
    .select({ id: projects.id })
    .from(projects)
    // Prefixes are stored upper-case (§4.3), and a person typing `lai-42` means
    // the same task as one typing `LAI-42`.
    .where(eq(projects.prefix, prefix.toUpperCase()))
    .get();

  if (project === undefined) return ref;

  const row = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.number, Number(number))))
    .get();

  // Falls through to the original string when nothing matches, so the caller
  // raises its own "no such task" rather than this inventing one.
  return row?.id ?? ref;
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
  /** Makes this a subtask of that task — one level, same project (D-066). */
  parent_task_id?: string | undefined;
  /** Unix-ms at a UTC midnight (§4.5). */
  due_on?: number | undefined;
  planned_start?: number | undefined;
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
    // Inside the write lock, so the parent cannot gain a parent of its own
    // between the check and the insert.
    const parentId = input.parent_task_id ?? null;
    if (parentId !== null) {
      assertParentAllowed(db, { taskId: null, projectId: project.id, parentId });
    }

    // Inside the write lock: `nextTaskNumber` reads MAX(number), and a deferred
    // transaction would let two creates read the same value (LAI-003).
    const number = nextTaskNumber(db, project.id);
    const id = newId();

    db.insert(tasks)
      .values({
        id,
        projectId: project.id,
        number,
        // The end of the project's order, so it lands at the bottom of its
        // lane (LAI-472, D-070). Inside the write lock for the reason the
        // number is: two creates must not read the same last key.
        position: keyAfter(lastPosition(db, project.id)),
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
        parentTaskId: parentId,
        dueOn: input.due_on ?? null,
        plannedStart: input.planned_start ?? null,
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
      ...activityActor(actor),
      type: 'task.created',
      // The parent is named only when there is one, so a top-level task's row
      // is the row it always was (§4.8, D-066).
      payload: {
        key: `${project.prefix}-${String(number)}`,
        title: input.title,
        ...(parentId === null ? {} : { parent_task_id: parentId }),
      },
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
  /** A task id: only its subtasks (§6.4, D-066). */
  parent?: string | undefined;
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
  if (filter.parent !== undefined) {
    // One more `AND` before the cursor predicate, so paging is unchanged;
    // §4.13's `tasks(parent_task_id)` index serves it.
    conditions.push(eq(tasks.parentTaskId, filter.parent));
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
  /** `null` detaches it from its parent; a string re-parents it (D-066). */
  parent_task_id?: string | null | undefined;
  /** `null` clears; unix-ms at a UTC midnight sets (§4.5). */
  due_on?: number | null | undefined;
  planned_start?: number | null | undefined;
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
  if (input.due_on !== undefined && input.due_on !== task.dueOn) changes.dueOn = input.due_on;
  if (input.planned_start !== undefined && input.planned_start !== task.plannedStart) {
    changes.plannedStart = input.planned_start;
  }

  if (input.parent_task_id !== undefined && input.parent_task_id !== task.parentTaskId) {
    // Not inside `BEGIN IMMEDIATE` — `updateTask` takes `db` only. The window
    // is two concurrent PATCHes forming a two-deep chain, recorded in LAI-493
    // as accepted rather than threading `sqlite` through every caller.
    if (input.parent_task_id !== null) {
      assertParentAllowed(db, {
        taskId,
        projectId: project.id,
        parentId: input.parent_task_id,
      });
    }
    changes.parentTaskId = input.parent_task_id;
  }

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
      ...activityActor(actor),
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
    ...activityActor(actor),
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
      ...activityActor(actor),
      type: 'task.status_changed',
      payload: { from: 'todo', to: 'in_progress', assignee_id: actor.userId, via: 'claim' },
      now,
    });

    return viewOne(db, after, project.prefix);
  });
}

export function changeStatus(
  db: Db,
  actor: ServiceCaller,
  taskId: string,
  to: TaskStatus,
  now: number = Date.now(),
  /**
   * Which §5 table applies. Defaults to asking the principal, which is what
   * every caller wants except `finishTask` — see its docblock.
   */
  rule: TransitionRule = isAgentPrincipal(actor) ? 'agent' : 'human',
): TaskView {
  const { task, project } = requireTask(db, taskId);
  const scoped = withProject(actor, project.id);
  assertCan(scoped, 'task.write', { projectId: project.id });

  // §5's table, widened for a person and unchanged for a program (LAI-266).
  // `isAgentPrincipal` reads `actor.token`, **not** `isSystemPrincipal` — a
  // token-bearing agent is an ordinary actor, so the obvious predicate would
  // have handed MCP the human rule. The branch below is a different question
  // and keeps its own test.
  assertTransition(task.status, to, rule);

  // §5: moving to `review` requires the assignee, a project lead, or org
  // Admin/Owner. The task text said "assignee, Admin or Owner" and omitted lead;
  // the spec wins (D-011).
  //
  // ## The system principal is not held to it (D-051, §10.1, LAI-446)
  //
  // **§5's restriction constrains people**, and its neighbouring bullet gives
  // the reason: *"`done` is never set by `finish_task`. Agents do not
  // self-certify."* A merged pull request is **external evidence** — somebody
  // else reviewed it and merged it — so refusing it would apply a rule against
  // self-certification to the opposite of self-certification.
  //
  // What keeps that narrow is D-050, not this branch: anything reaching here as
  // a system principal is a **verified delivery, on a project the branch
  // resolved to, holding `task.write` and nothing else**. It cannot widen into
  // "the system may do anything" without §3.4 changing, and §3.4 is a document
  // somebody reads.
  if (to === 'review' && !isSystemPrincipal(actor)) {
    const isAssignee = task.assigneeId === actor.userId;
    const isLeadOrAbove =
      (isSystemPrincipal(scoped) ? null : scoped.projectRole) === 'lead' ||
      actor.orgRole === 'owner' ||
      actor.orgRole === 'admin';

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
      // `claimTask` already stamps this, but claiming is not the only way into
      // `in_progress` — a lead moving somebody else's task gets here instead,
      // and before LAI-126 that task started work with `started_at` still null.
      //
      // `=== null` and not an unconditional set: the first entry is the start.
      // A task sent back from review and picked up again did not start twice,
      // and overwriting would silently shorten every cycle time (LAI-124).
      ...(to === 'in_progress' && task.startedAt === null ? { startedAt: now } : {}),
      // **The latest arrival at `done`, and it is not cleared on a reopen**
      // (LAI-146). Deliberately asymmetric with `started_at` above, which keeps
      // its *first* value — and the asymmetry is the thing a reader assumes is a
      // bug, so it is written down here and in §6.4.
      //
      // `started_at` answers "when did work begin", and it did begin then: a
      // task sent back for rework did not start twice. `completed_at` answers
      // "when did this last reach done", and a task done twice was completed
      // the second time — a cycle-time calculation that lost the second
      // completion would be wrong about the task's whole history, not just its
      // end.
      //
      // **A reopened task therefore carries a `completed_at` while it is not
      // done**, which is a fact about its history rather than a claim about its
      // state. `status` answers "is it done now", and nothing else should: a
      // reader inferring completion from a timestamp would already be wrong for
      // a `cancelled` task, which never had one.
      ...(to === 'done' ? { completedAt: now } : {}),
    })
    .where(eq(tasks.id, taskId))
    .run();

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    ...activityActor(actor),
    type: 'task.status_changed',
    payload: { from: task.status, to },
    now,
  });

  return viewOne(db, db.select().from(tasks).where(eq(tasks.id, taskId)).get()!, project.prefix);
}

export interface FinishTaskInput {
  /** What was done. Posted as a comment by the same actor, in the same write. */
  summary: string;
  /** Optional acceptance walk-through, appended under the summary. */
  checklist?: readonly string[] | undefined;
  now?: number;
}

/**
 * Hand finished work back for review (SPEC §7.1 `finish_task`, §5).
 *
 * **Stops at `review`, never `done`.** §7.2: agents do not close their own work.
 * That is not enforced by hoping the caller passes `review` — this function has
 * no status parameter, so `done` is unreachable through it.
 *
 * ## Why this is a service and not two calls from the tool
 *
 * It is `changeStatus` plus `addComment`, and doing that from the MCP layer
 * would leave a task sitting in `review` with no summary whenever the second
 * write failed — a reviewer opening it would find nothing saying what was done.
 * One transaction, so either both land or neither does.
 *
 * Both halves keep their own `can()`: `changeStatus` checks the transition,
 * `addComment` checks `comment.create`. Neither is re-checked here, for the same
 * reason `promoteUnlisted` does not re-check `task.write` — a second opinion
 * about the same question is a second thing to keep in step.
 */
export function finishTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  input: FinishTaskInput,
): TaskView {
  const now = input.now ?? Date.now();

  return immediateTransaction(sqlite, () => {
    // The transition is validated by §5's own table, so finishing a task that
    // was never started fails here rather than being quietly allowed.
    //
    // **`'agent'` is pinned rather than derived** (LAI-266). This is reached
    // from the MCP tool only, whose actor always carries a token, so deriving
    // would give the same answer today — but the parameter is a `ResolvedActor`
    // and a cookie-authed caller would silently get the widened table, which
    // makes the sentence above false. Pinning keeps it true whoever calls.
    const task = changeStatus(db, actor, taskId, 'review', now, 'agent');

    addComment(db, actor, taskId, finishSummary(input), now);

    // Read back: the comment moved `updated_at` and added to `comment_count`,
    // and returning the pre-comment view would show a task that does not match
    // what the next read gives.
    return getTask(db, actor, task.id);
  });
}

/** The summary, with the checklist under it when there is one. */
function finishSummary(input: FinishTaskInput): string {
  const checklist = input.checklist ?? [];
  if (checklist.length === 0) return input.summary;

  return [input.summary, '', ...checklist.map((line) => `- [x] ${line}`)].join('\n');
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
    ...activityActor(actor),
    type: 'task.dependency_added',
    // **Deliberately still `depends_on`** after LAI-099 renamed the wire field
    // to `blocked_by` (D-044). `activity` is append-only in both directions, so
    // every row already written keeps this key for ever; renaming it here would
    // give the table two vocabularies for one fact and make old history readable
    // only by someone who knows the cut-over date. LAI-045's read-time
    // translation is not a way round it — that normalises the *spelling* of
    // names inside `changed`, and its own comment says broadening it is worse.
    // Still `depends_on`, for the append-only reason given above (D-044).
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
    ...activityActor(actor),
    type: 'task.dependency_removed',
    payload: { depends_on: dependsOnTaskId },
    now,
  });

  return getTask(db, actor, taskId);
}

export interface ReorderTaskInput {
  /** The card it lands **directly below**. */
  after_task_id?: string | undefined;
  /** The card it lands **directly above**. */
  before_task_id?: string | undefined;
  now?: number;
}

/**
 * Move one card in its project's manual order (§6.4, LAI-472, D-060, D-070).
 *
 * **Addressed by neighbours, never an index** — an index is stale the moment
 * anyone else drags. The card is placed **immediately after `after_task_id`**
 * in the project's sequence, or immediately before `before_task_id` when only
 * that is sent. A lane is a filtered view of that one sequence, so this lands
 * the card between the two cards the reader dropped it between, in every lane
 * that shows them. And two drops into one gap at once land side by side
 * rather than computing the same key: the second reads the first's write,
 * because both run under `BEGIN IMMEDIATE`.
 *
 * **Writes one row.** The new key is computed between two existing keys
 * (`order-key.ts`), so no other card moves and no other `updated_at` changes.
 * The moved card's `updated_at` does change — its place is part of what it
 * is, and an `updated_since` catch-up must see it.
 *
 * Refusals: `422` when neither neighbour is sent, a neighbour is the card
 * itself, missing, or in another project; `409` when `after` sorts after
 * `before` — the board the reader dragged on has changed since, and guessing
 * would put the card somewhere nobody chose. A drop where the card already is
 * writes nothing.
 */
export function reorderTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  input: ReorderTaskInput,
): TaskView {
  const { project } = requireTask(db, taskId);
  assertCan(withProject(actor, project.id), 'task.write', { projectId: project.id });

  const afterId = input.after_task_id;
  const beforeId = input.before_task_id;
  if (afterId === undefined && beforeId === undefined) {
    throw new ApiError('unprocessable', 'Send after_task_id, before_task_id, or both');
  }
  const now = input.now ?? Date.now();

  return immediateTransaction(sqlite, () => {
    // Neighbours from before LAI-472 get places first, so there is an order
    // to read. A no-op on a running server, where the boot backfill has run.
    backfillTaskPositions(db, project.id);

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
    const neighbour = (id: string | undefined, which: string) => {
      if (id === undefined) return undefined;
      if (id === taskId) {
        throw new ApiError('unprocessable', `A card cannot be placed relative to itself`, {
          [which]: id,
        });
      }
      const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
      // Missing and another project's are one answer, so the shape of the
      // error does not confirm that a task the caller cannot read exists.
      if (row === undefined || row.projectId !== project.id) {
        throw new ApiError('unprocessable', `No task "${id}" in this project`, { [which]: id });
      }
      return row;
    };
    const after = neighbour(afterId, 'after_task_id');
    const before = neighbour(beforeId, 'before_task_id');

    if (after !== undefined && before !== undefined && after.position! >= before.position!) {
      throw new ApiError(
        'conflict',
        'The board changed while you were dragging — reload to see the current order',
        { after_task_id: after.id, before_task_id: before.id },
      );
    }

    const others = and(eq(tasks.projectId, project.id), ne(tasks.id, taskId));
    let lower: string | null;
    let upper: string | null;
    if (after !== undefined) {
      lower = after.position!;
      const next = db
        .select({ position: tasks.position })
        .from(tasks)
        .where(and(others, gt(tasks.position, lower)))
        .orderBy(asc(tasks.position))
        .limit(1)
        .get();
      upper = next?.position ?? null;
    } else {
      upper = before!.position!;
      const previous = db
        .select({ position: tasks.position })
        .from(tasks)
        .where(and(others, lt(tasks.position, upper)))
        .orderBy(desc(tasks.position))
        .limit(1)
        .get();
      lower = previous?.position ?? null;
    }

    const current = task.position!;
    const alreadyThere = (lower === null || lower < current) && (upper === null || current < upper);
    if (alreadyThere) return viewOne(db, task, project.prefix);

    const position = keyBetween(lower, upper);
    db.update(tasks).set({ position, updatedAt: now }).where(eq(tasks.id, taskId)).run();

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(actor),
      // `task.updated` naming the field — D-060.4: a drag is not a §4.8 verb,
      // and a new verb is always three owners. The feed hides it; the audit
      // trail keeps it, and SSE needs the row to tell other viewers.
      type: 'task.updated',
      payload: { field: 'position', from: current, to: position },
      now,
    });

    return viewOne(db, db.select().from(tasks).where(eq(tasks.id, taskId)).get()!, project.prefix);
  });
}
