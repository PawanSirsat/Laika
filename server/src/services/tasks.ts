import { createHash } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type Database from 'better-sqlite3';
import {
  activityActor,
  isAgentPrincipal,
  isSystemPrincipal,
  type ResolvedActor,
  type ServiceCaller,
  withProject,
} from '../auth/resolve-actor.ts';
import {
  apiFieldNames,
  appendActivity,
  boardDayOf,
  type CreatingClient,
  creatingClientNames,
} from '../db/activity.ts';
import { type Db } from '../db/client.ts';
import {
  addDependency,
  dependencyEdges,
  DependencyError,
  type DependencyEdges,
} from '../db/dependencies.ts';
import { TASK_STATUSES, type TaskPriority, type TaskStatus } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { immediateTransaction, nextTaskNumber } from '../db/numbering.ts';
import { backfillTaskPositions, lastPosition } from '../db/backfill.ts';
import { keyAfter, keyBetween } from '../db/order-key.ts';
import { CATEGORY_LABELS, statusForCategory, type StatusRef } from '../db/project-statuses.ts';
import { projects, projectStatuses, taskDependencies, tasks, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, effectiveProjectRole } from '../policy/can.ts';
import {
  assertClaimFence,
  claimFenceRefusal,
  claimView,
  holdsLiveClaim,
  hasOpenWorkRequest,
  assertSelectedAgentMayClaim,
  liveClaim,
  liveClaimViews,
  registeredAgent,
  releaseLiveClaim,
  requireVisibleTaskToClaim,
  takeClaim,
  type TaskClaimView,
  type TaskLiveClaimView,
} from './claims.ts';
import { handoffViews, NO_HANDOFF, type TaskHandoffView } from './task-handoff.ts';
import { addComment, commentCounts } from './comments.ts';
import {
  freezeEstimateAtStart,
  recordClaimEstimate,
  refreshEstimate,
  setSizeOverride,
  sizeViews,
  type ClaimEstimateInput,
  type SizeLevel,
  type SizeView,
} from './estimates.ts';
import { canBeMentioned } from './mentions.ts';
import { normaliseTagNames, setTaskTags, tagsForTasks, taskIdsWithTag } from './tags.ts';
import {
  ambiguousOutsideId,
  assertOutsideIdFree,
  normaliseOutsideId,
  readableByOutsideId,
} from './outside-ids.ts';
import { canSeeProject, projectIdByKeyPrefix, requireProjectBySlug } from './projects.ts';
import {
  activeSendBacks,
  evidenceItems,
  recordRound,
  roundReader as readerOf,
  type EvidenceInput,
  type SendBackView,
} from './rounds.ts';
import {
  assertAgentSelectable,
  assertSelectionChangeAllowed,
  moveSelection,
  namedFor,
  selectedAgentViews,
  type SelectedAgentView,
} from './work-requests.ts';
import {
  assertTransition,
  isReady,
  READY_STATUSES,
  type TransitionRule,
} from './task-lifecycle.ts';

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
export {
  CLAIM_CONFIDENCES,
  CREATED_VIA,
  SIZE_LEVELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../db/enums.ts';

/**
 * A task as a slim list carries it — `?fields=slim` (§6.4, LAI-795): every field
 * of {@link TaskView} but its two texts. The texts were 83% of a gzip'd
 * 200-task page (LAI-786), and nothing that draws a list renders them; the task
 * panel reads them from `GET /tasks/:id`.
 */
export interface TaskSummaryView {
  id: string;
  key: string;
  project_id: string;
  number: number;
  title: string;
  /**
   * The **category** of the task's status (LAI-738, D-077) — one of the six
   * §5 values, what the lifecycle, readiness and every filter reason about.
   */
  status: TaskStatus;
  /** The project status the task is in: the column it draws in (§4.20). */
  status_id: string;
  /** That status's name, as the project calls it — `QA`, not `review`. */
  status_name: string;
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
  /**
   * The send-back this task carries, or null (§4.27, D-082): a person sent it
   * back from review with this reason, and nobody has finished it since. Drawn
   * on the card and the panel; `get_task_context` reads it to the agent first.
   * Null once the task is done or cancelled.
   */
  send_back: Pick<SendBackView, 'reason_md' | 'decided_by' | 'created_at'> | null;
  /**
   * Its size and build-time forecast (§4.32, D-085): the level shown — a
   * person's when one is set — the computed one beside it, and the p50–p80
   * range once the project has history. Null only before Laika has computed
   * one. The *why* is `GET /tasks/:id/estimate`'s, not every list's.
   */
  size: SizeView | null;
  /**
   * The agent meant to do the work, or null (§4.5, D-114 item 7, LAI-535) —
   * **not** the assignee, and not a claim: selecting one opens a work request
   * and changes nothing else. Its owner rides with it, so "whose agent" never
   * needs a second read.
   */
  selected_agent: SelectedAgentView | null;
  /**
   * The session holding the task now, or null (§4.5, §4.66, LAI-568): its
   * live claim — `active` or `paused` — with the holder's last heartbeat and
   * whether it is still checking in. An expired, released or transferred
   * claim is never this; the task's activity is where those are told.
   */
  claim: TaskLiveClaimView | null;
  /**
   * The task's newest save and live hand-off in brief, with the two states a
   * card draws from them — *Recovery available* and *Save needs attention* —
   * derived here once (§6.4, LAI-1005). Never null: a task with neither reads
   * {@link NO_HANDOFF}.
   */
  handoff: TaskHandoffView;
  created_at: number;
  updated_at: number;
}

/** A task in full: every read and write answers this, and a list without `fields`. */
export interface TaskView extends TaskSummaryView {
  description_md: string | null;
  /** What "done" means here — prose, nullable (§4.5, LAI-092). */
  acceptance_md: string | null;
}

/** The values `?fields=` takes on a task list (§6.4, LAI-795). */
export const TASK_LIST_FIELDS = ['slim'] as const;
export type TaskListFields = (typeof TASK_LIST_FIELDS)[number];

/**
 * A view without its two texts, the other fields in the same order — so a slim
 * page is the full page with exactly those removed (LAI-795).
 */
export function summaryOf(view: TaskView): TaskSummaryView {
  const { description_md: _description, acceptance_md: _acceptance, ...summary } = view;
  return summary;
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
  readonly clients: ReadonlyMap<string, CreatingClient>;
  /**
   * Who is reading: their user id, or null for a principal with no user. It
   * decides one thing — whether a creating agent's name is theirs to see.
   */
  readonly reader: string | null;
  /** Status name per status id, for every status on the page (LAI-738). */
  readonly statusNames: ReadonlyMap<string, string>;
  /** The send-back each task carries, if any (D-082). */
  readonly sendBacks: ReadonlyMap<string, SendBackView>;
  /** The size in force per task (D-085) — one query whatever the page. */
  readonly sizes: ReadonlyMap<string, SizeView>;
  /** The selected agent per agent id (LAI-535) — one query whatever the page. */
  readonly selectedAgents: ReadonlyMap<string, SelectedAgentView>;
  /** The live claim per task (LAI-568) — one query whatever the page. */
  readonly claims: ReadonlyMap<string, TaskLiveClaimView>;
  /** Saves and hand-off in brief per task (LAI-1005) — three queries whatever the page. */
  readonly handoffs: ReadonlyMap<string, TaskHandoffView>;
}

/**
 * `now` is the read's clock: a claim's `connection` and whether its lease has
 * lapsed are answers about a moment (LAI-568), so a test can ask about one.
 */
function loadViewContext(
  db: Db,
  rows: readonly TaskRow[],
  now: number,
  reader: string | null,
): ViewContext {
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
  const statusIds = [...new Set(rows.map((row) => row.statusId))];

  return {
    edges,
    statuses,
    comments: commentCounts(db, ids),
    tags: tagsForTasks(db, ids),
    clients: creatingClientNames(db, ids),
    // One query whatever the page size, as LAI-091 keeps everything else.
    statusNames: new Map(
      statusIds.length === 0
        ? []
        : db
            .select({ id: projectStatuses.id, name: projectStatuses.name })
            .from(projectStatuses)
            .where(inArray(projectStatuses.id, statusIds))
            .all()
            .map((r) => [r.id, r.name] as const),
    ),
    sendBacks: activeSendBacks(db, rows),
    sizes: sizeViews(db, rows),
    selectedAgents: selectedAgentViews(db, rows),
    claims: liveClaimViews(db, ids, now),
    handoffs: handoffViews(db, rows, now),
    reader,
  };
}

/** The selected agent as this reader may see it: its registered name is its owner's (D-120). */
function selectedFor(
  view: SelectedAgentView | undefined,
  reader: string | null,
): SelectedAgentView | null {
  return view === undefined ? null : namedFor(view, reader);
}

/**
 * The creating client's name as this reader may see it (LAI-1001). A legacy
 * token's name is shown as before. A registered agent's token is named after
 * the agent, and that registered name is **its owner's alone** (D-120,
 * Belka): null for everyone else, even on a task that shows the agent —
 * which names it by harness and device instead. `created_via` still says it
 * came through an agent's channel.
 */
function creatingClientFor(row: TaskRow, context: ViewContext): string | null {
  const client = context.clients.get(row.id);
  if (client === undefined) return null;
  if (client.agentId === null) return client.name;
  return context.reader !== null && client.ownerUserId === context.reader ? client.name : null;
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
    status_id: row.statusId,
    // `tasks_status_fk` guarantees the row exists, so the fallback is not
    // reached; it is there only so the type is a string and never undefined.
    status_name: context.statusNames.get(row.statusId) ?? CATEGORY_LABELS[row.status],
    priority: row.priority,
    assignee_id: row.assigneeId,
    sprint_id: row.sprintId,
    created_by: row.createdBy,
    created_via: row.createdVia,
    created_by_client: creatingClientFor(row, context),
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
    send_back: sendBackOf(context.sendBacks.get(row.id)),
    size: context.sizes.get(row.id) ?? null,
    selected_agent:
      row.selectedAgentId === null
        ? null
        : selectedFor(context.selectedAgents.get(row.selectedAgentId), context.reader),
    claim: context.claims.get(row.id) ?? null,
    handoff: context.handoffs.get(row.id) ?? NO_HANDOFF,
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

function sendBackOf(found: SendBackView | undefined): TaskView['send_back'] {
  if (found === undefined) return null;
  return {
    reason_md: found.reason_md,
    decided_by: found.decided_by,
    created_at: found.created_at,
  };
}

/**
 * Views for rows from several projects at once, in the same fixed number of
 * queries as one project's page — the review queue's read (§6.4, D-082).
 */
export function viewTasks(
  db: Db,
  rows: readonly TaskRow[],
  prefixes: ReadonlyMap<string, string>,
  reader: string | null,
  now: number = Date.now(),
): TaskView[] {
  const context = loadViewContext(db, rows, now, reader);
  return rows.map((row) => toView(row, prefixes.get(row.projectId) ?? '', context));
}

/**
 * **An agent never moves a task into done** (§5, D-082, LAIKA-455).
 *
 * By **category**, so a project that calls its done column `Shipped`, or has
 * three of them, gives an agent no way round it (D-077). Asked before anything
 * else about the move, including a move between two done statuses, so every
 * door — a category, a status id, a status name, a create, a status delete
 * that would carry work into one — gets this answer and not a different one.
 *
 * `isAgentPrincipal` rather than a token check: it is the question "is a
 * program asking", and §3.4's principal is a program too. It never moves
 * anything into done (§10.1 stops a merged pull request at review), so the
 * wider question costs nothing and leaves no program with the power.
 *
 * `forbidden` with `details.reason` rather than a new code: §6.3's vocabulary
 * is closed (D-021), and D-079 set the shape for a reason under a code.
 */
export const AGENT_CANNOT_MARK_DONE = 'agent_cannot_mark_done';

function assertNotAgentIntoDone(actor: ServiceCaller, dest: StatusRef): void {
  if (dest.category !== 'done' || !isAgentPrincipal(actor)) return;
  throw new ApiError(
    'forbidden',
    `An agent cannot move a task into ${dest.name}. Call finish_task to hand it back for review with your proof; a person accepts it in the web app.`,
    { reason: AGENT_CANNOT_MARK_DONE, status: 'done', status_id: dest.id },
  );
}

/**
 * Who may send a task to review, **and who may move it into done** (§5, M7):
 * the assignee, a project lead, or an org admin or owner. The review queue's
 * accept and send-back ask the same question (D-082).
 *
 * The system principal is not held to it (D-051): see `changeStatus`.
 */
export function assertMayCloseReview(
  actor: ServiceCaller,
  task: { assigneeId: string | null; projectId: string },
  to: 'review' | 'done',
  /**
   * The caller's agent holds the task's live claim (LAI-541). A claim does not
   * assign (D-114 item 7), so on a task **nobody is assigned to** the agent
   * working it answers this rule as an assignee would; the fence has already
   * checked its generation. On a task another person is assigned to it does
   * not: the rule is asked of the agent's owner (`actor.userId`), and an agent
   * is never more than its owner (D-114).
   */
  holdsClaim = false,
): void {
  if (isSystemPrincipal(actor)) return;
  const scoped = withProject(actor, task.projectId);
  const isAssignee = task.assigneeId === actor.userId || (holdsClaim && task.assigneeId === null);
  // The effective role: a lead by membership, or by *Open every project*
  // (§3, LAI-958) — which is what an owner and, by default, an admin hold.
  const isLeadOrAbove = effectiveProjectRole(scoped) === 'lead';

  if (!isAssignee && !isLeadOrAbove) {
    throw new ApiError(
      'forbidden',
      to === 'review'
        ? 'Only the assignee, a project lead or an admin may send a task to review'
        : 'Only the assignee, a project lead or an admin may move a task to done',
    );
  }
}

/** One task's view, loading only what that task needs. */
function viewOne(
  db: Db,
  row: TaskRow,
  prefix: string,
  now: number,
  reader: string | null,
): TaskView {
  return toView(row, prefix, loadViewContext(db, [row], now, reader));
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
 * Only somebody who can read the project may hold one of its tasks (LAI-962).
 *
 * **Their authority, not the caller's** — `task.assign_other` already asked
 * whether the caller may hand work out; this asks whether the person receiving
 * it could even see it. `canBeMentioned` is that predicate, `project.read` on
 * their own memberships, so org Owners and Admins with no membership row count
 * (D-006) and a deactivated user or an id naming nobody does not. Reused rather
 * than restated: a second copy is how the picker and the write would drift.
 */
function assertMayHold(db: Db, assigneeId: string, projectId: string): void {
  if (canBeMentioned(db, assigneeId, projectId)) return;

  throw new ApiError('unprocessable', 'The assignee cannot read this project', {
    field: 'assignee_id',
    reason: 'not_on_project',
    assignee_id: assigneeId,
  });
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
 * A task named the way a person names one — `LAI-42` — or by its id, or, with
 * the caller, by its **outside id** (LAI-780).
 *
 * §7 asks MCP responses to use **display keys, not raw ULIDs**, wherever a human
 * will read them. That has to run both ways: a tool that prints `LAI-42` and
 * then refuses to accept `LAI-42` back has taught the agent a name it cannot
 * use. Ids stay valid because that is what the REST API hands out.
 *
 * An outside id — the `LAI-780` of a repo's task file, a Jira key — is tried
 * only when the ref names no task by its key, so **a board key always wins**,
 * and only among the projects `actor` may read: an id on a card they cannot
 * see comes back as given, like a key that names nothing. One the caller can
 * read on two tasks is refused `422 ambiguous`, never guessed. Without a
 * caller nothing is looked up by outside id.
 *
 * Lives here rather than in `mcp/` because the write tools take the same
 * reference (LAI-408: `start_working({ task })`), and a second parser is a
 * second set of rules about what `LAI-42` means.
 */
const TASK_KEY = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

export function resolveTaskRef(db: Db, ref: string, actor?: ResolvedActor): string {
  const byKey = taskIdByKey(db, ref);
  if (byKey !== undefined || actor === undefined) return byKey ?? ref;

  const matches = readableByOutsideId(db, actor, ref);
  if (matches.length > 1) throw ambiguousOutsideId(ref, matches);

  // Falls through to the original string when nothing matches, so the caller
  // raises its own "no such task" rather than this inventing one.
  return matches[0]?.taskId ?? ref;
}

/**
 * A `404` for a task id that names no task — what `addTaskDependency` asks of
 * a blocker, asked by `create_task` **before** it creates anything, so a
 * blocker that names nothing refuses the call whole (LAI-780 review).
 */
export function assertTaskExists(db: Db, taskId: string): void {
  requireTask(db, taskId);
}

/** The task a board key names, whoever may read it — or `undefined`. */
function taskIdByKey(db: Db, ref: string): string | undefined {
  const match = TASK_KEY.exec(ref.trim());
  if (match === null) return undefined;

  const [, prefix, number] = match;
  if (prefix === undefined || number === undefined) return undefined;

  // Case-insensitive — a person typing `lai-42` means `LAI-42` — and a prefix
  // the project carried before its current one still names it (D-103).
  const projectId = projectIdByKeyPrefix(db, prefix);
  if (projectId === undefined) return undefined;

  return db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.number, Number(number))))
    .get()?.id;
}

/**
 * Where a status write wants the task to go (LAI-738, D-077).
 *
 * - a **category** (`'review'`) — what every caller spoke before statuses were
 *   the project's own: MCP, the webhook, meeting reviews, `finish_task`. It
 *   means the project's first visible status of that category;
 * - `{ status_id }` — one exact status, which is what a board drag sends;
 * - `{ status_name }` — a status by its name, case-insensitively, which is
 *   what an agent types when the project calls its column `QA`.
 */
export type StatusTarget = TaskStatus | { status_id: string } | { status_name: string };

function statusRow(db: Db, projectId: string, id: string): StatusRef | undefined {
  const row = db
    .select({
      id: projectStatuses.id,
      name: projectStatuses.name,
      category: projectStatuses.category,
      hidden: projectStatuses.hidden,
    })
    .from(projectStatuses)
    .where(and(eq(projectStatuses.id, id), eq(projectStatuses.projectId, projectId)))
    .get();
  return row === undefined ? undefined : { ...row, hidden: row.hidden === 1 };
}

/**
 * The status a target names in this project, or a `422` that says what the
 * project does have. Missing and another project's are one answer, as
 * `reorderTask`'s neighbours are, so the error does not confirm that a status
 * the caller cannot see exists.
 */
function resolveStatus(db: Db, projectId: string, target: StatusTarget): StatusRef {
  if (typeof target === 'string') return statusForCategory(db, projectId, target);

  if ('status_id' in target) {
    const row = statusRow(db, projectId, target.status_id);
    if (row === undefined) {
      throw new ApiError('unprocessable', 'That status is not one of this project’s', {
        field: 'status_id',
        status_id: target.status_id,
      });
    }
    return row;
  }

  // In board order, so every answer below — including the list of candidates
  // in an error — is the same on every call.
  const wanted = target.status_name.trim();
  const rows = db
    .select({
      id: projectStatuses.id,
      name: projectStatuses.name,
      category: projectStatuses.category,
      hidden: projectStatuses.hidden,
    })
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId))
    .orderBy(asc(projectStatuses.position))
    .all();

  // Exact first. SQLite's `lower()` folds ASCII only, so the unique index
  // admits `État` beside `état`; whoever types one of them exactly means it.
  const folded = rows.filter((r) => r.name.toLowerCase() === wanted.toLowerCase());
  const match =
    rows.find((r) => r.name === wanted) ?? (folded.length === 1 ? folded[0] : undefined);

  if (match === undefined && folded.length > 1) {
    const candidates = folded.map((r) => r.name);
    throw new ApiError(
      'unprocessable',
      `More than one status is called "${wanted}" in this project: ${candidates.join(', ')}. Use the exact name`,
      { field: 'status', status: target.status_name, candidates },
    );
  }
  if (match === undefined) {
    const names = rows.map((r) => r.name);
    throw new ApiError(
      'unprocessable',
      `This project has no status called "${wanted}". It has: ${names.join(', ')}`,
      { field: 'status', status: target.status_name, statuses: names },
    );
  }
  return { ...match, hidden: match.hidden === 1 };
}

export function getTask(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
): TaskView {
  const { task, project } = requireTask(db, taskId);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  return viewOne(db, task, project.prefix, now, readerOf(actor));
}

export interface CreateTaskInput {
  title: string;
  description_md?: string | undefined;
  acceptance_md?: string | undefined;
  tags?: readonly string[] | undefined;
  priority?: TaskPriority | undefined;
  /** A category: the project's first visible status of it (LAI-738). */
  status?: TaskStatus | undefined;
  /** One exact status of this project. Wins over `status`, which must agree. */
  status_id?: string | undefined;
  assignee_id?: string | undefined;
  discovered_from?: string | undefined;
  /** Makes this a subtask of that task — one level, same project (D-066). */
  parent_task_id?: string | undefined;
  /** Unix-ms at a UTC midnight (§4.5). */
  due_on?: number | undefined;
  planned_start?: number | undefined;
  /** A person's size from the start (D-085); the computed one stays beside it. */
  size?: SizeLevel | undefined;
  /**
   * The id this card has somewhere else — `LAI-123`, a Jira key (LAI-780).
   * Shaped by `normaliseOutsideId`, stored upper-case.
   */
  external_ref?: string | undefined;
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
  // `task.create`, not `task.write` (D-103 item 6): the space may keep creating
  // to its leads. Every path that makes a task — REST, MCP, a meeting review,
  // a promoted unlisted note — arrives here, so this one check is all of them.
  assertCan(withProject(actor, project.id), 'task.create', { projectId: project.id });
  if (input.assignee_id !== undefined) assertMayHold(db, input.assignee_id, project.id);

  const now = input.now ?? Date.now();
  const externalRef =
    input.external_ref === undefined ? null : normaliseOutsideId(input.external_ref);

  return immediateTransaction(sqlite, () => {
    // Inside the write lock, as the number is: two creates must not both find
    // the id free (LAI-780 review).
    if (externalRef !== null) assertOutsideIdFree(db, project.id, externalRef, null);

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
    const initial = resolveStatus(
      db,
      project.id,
      input.status_id === undefined ? (input.status ?? 'backlog') : { status_id: input.status_id },
    );
    // Before the category check, so a token sending `status: done` hears why
    // it cannot, not that two fields disagree (D-082).
    assertNotAgentIntoDone(actor, initial);
    if (input.status !== undefined && input.status !== initial.category) {
      throw new ApiError(
        'unprocessable',
        `${initial.name} is a ${CATEGORY_LABELS[initial.category]} status, not ${CATEGORY_LABELS[input.status]} — send one of status or status_id`,
        { field: 'status', status: input.status, status_id: initial.id },
      );
    }

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
        status: initial.category,
        statusId: initial.id,
        priority: input.priority ?? 'p2',
        assigneeId: input.assignee_id ?? null,
        createdBy: actor.userId,
        createdVia: input.created_via ?? 'api',
        // Provenance, not a dependency (§4.6) — see `discovered_from` below.
        discoveredFrom: input.discovered_from ?? null,
        parentTaskId: parentId,
        dueOn: input.due_on ?? null,
        plannedStart: input.planned_start ?? null,
        externalRef,
        // Creation is an arrival at Done too (SPEC §4.5, D-093).
        completedAt: initial.category === 'done' ? now : null,
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

    // Its size, in the same write (D-085): the board learns of the task from
    // this create's activity row, and must not draw it without one. Its
    // parent's figures follow, since they come from its children.
    refreshEstimate(db, id, now);
    if (input.size !== undefined) setSizeOverride(db, actor.userId, id, input.size, now);

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId: id,
      ...activityActor(actor),
      type: 'task.created',
      // The parent and a size are named only when there is one, so a plain
      // task's row is the row it always was (§4.8, D-066, D-085).
      payload: {
        key: `${project.prefix}-${String(number)}`,
        title: input.title,
        ...(parentId === null ? {} : { parent_task_id: parentId }),
        ...(input.size === undefined ? {} : { size: input.size }),
      },
      now,
    });

    return viewOne(
      db,
      db.select().from(tasks).where(eq(tasks.id, id)).get()!,
      project.prefix,
      now,
      readerOf(actor),
    );
  });
}

export interface ListTasksFilter {
  /** A category — every status of it (LAI-738). */
  status?: TaskStatus | undefined;
  /** One project status. */
  status_id?: string | undefined;
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
  /** The read's clock, for each task's `claim` (LAI-568). Defaults to now. */
  now?: number | undefined;
}

export function listTasks(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  filter: ListTasksFilter,
): TaskView[] {
  const project = requireProjectBySlug(db, slug);
  assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });

  const conditions = [eq(tasks.projectId, project.id), ...sharedConditions(filter)];

  if (filter.status_id !== undefined) conditions.push(eq(tasks.statusId, filter.status_id));
  if (filter.priority !== undefined) conditions.push(eq(tasks.priority, filter.priority));
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

  return readTaskPage(db, conditions, () => project.prefix, filter, readerOf(actor));
}

/**
 * The filters both task lists take: `status`, `assignee`, `sprint` and
 * `updated_since`, each the same predicate whichever list asks.
 */
function sharedConditions(
  filter: Pick<ListAllTasksFilter, 'status' | 'assignee' | 'sprint' | 'updatedSince'>,
): SQL[] {
  const conditions: SQL[] = [];

  if (filter.status !== undefined) conditions.push(eq(tasks.status, filter.status));
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
  if (filter.updatedSince !== null && filter.updatedSince !== undefined) {
    conditions.push(gte(tasks.updatedAt, filter.updatedSince));
  }

  return conditions;
}

/**
 * One page of tasks matching `conditions`, ordered by `(updated_at, id)` and
 * one row over the limit so the route can tell whether another page exists.
 * Shared by the per-project list and the cross-project one (LAI-887), so the
 * two page, batch and filter `ready` identically.
 */
function readTaskPage(
  db: Db,
  conditions: readonly SQL[],
  prefixOf: (projectId: string) => string,
  filter: Pick<ListTasksFilter, 'ready' | 'limit' | 'cursor' | 'now'>,
  reader: string | null,
): TaskView[] {
  const now = filter.now ?? Date.now();
  // One over the limit, so the route can tell whether another page exists.
  const wanted = filter.limit + 1;

  /**
   * The next `size` rows after `cursor`, in page order, as views.
   *
   * **The page is cut in SQL** (LAI-722). This used to read every row after the
   * cursor, build the view context for all of them and slice one page off the
   * front, so walking a project to the end was quadratic in its size. One
   * context per read is still LAI-091's batching; it is just no longer the
   * whole remainder of the project.
   */
  const read = (cursor: ListTasksFilter['cursor'], size: number): TaskView[] => {
    const where =
      cursor === null
        ? conditions
        : [
            ...conditions,
            or(
              gt(tasks.updatedAt, Number(cursor.sortKey)),
              and(eq(tasks.updatedAt, Number(cursor.sortKey)), gt(tasks.id, cursor.id)),
            )!,
          ];
    const rows = db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(asc(tasks.updatedAt), asc(tasks.id))
      .limit(size)
      .all();

    const context = loadViewContext(db, rows, now, reader);
    return rows.map((row) => toView(row, prefixOf(row.projectId), context));
  };

  if (filter.ready === undefined) return read(filter.cursor, wanted);

  // `ready` is derived, so it cannot be a SQL predicate without duplicating the
  // rule (§4.5). Filtering after the query keeps one definition of readiness —
  // so this reads **in batches** until it has `limit + 1` matches or runs out.
  // Same rows in the same order as filtering the whole remainder at once, so
  // the same answer; it only stops reading once it has enough.
  const size = Math.max(wanted, READY_BATCH);
  const matched: TaskView[] = [];
  let cursor = filter.cursor;

  for (;;) {
    const views = read(cursor, size);
    matched.push(...views.filter((v) => v.ready === filter.ready));

    const last = views[views.length - 1];
    if (matched.length >= wanted || views.length < size || last === undefined) break;
    cursor = { sortKey: last.updated_at, id: last.id };
  }

  return matched.slice(0, wanted);
}

export interface ListAllTasksFilter {
  /** A project slug: only that project's tasks. */
  project?: string | undefined;
  /** A category — every status of it (LAI-738). */
  status?: TaskStatus | undefined;
  /** A user id, or `none` for unassigned work. */
  assignee?: string | undefined;
  /** A sprint id, or `none` for tasks in no sprint. */
  sprint?: string | undefined;
  updatedSince?: number | null;
  limit: number;
  cursor: { sortKey: string | number; id: string } | null;
  /** The read's clock, for each task's `claim` (LAI-568). Defaults to now. */
  now?: number | undefined;
}

/**
 * Everyone's work: tasks from **every project this actor may read**, in the
 * per-project list's shape and order (`GET /api/v1/tasks`, LAI-887).
 *
 * Readable projects are chosen by asking `can()` once per project
 * (`canSeeProject`, as `listProjects` does) — rather than by a membership join,
 * because `can()` is the only authority (§3.3): org owners and admins read
 * every project without a membership row, and a token's project scope narrows
 * it. `?project=` names one project and is answered exactly as
 * `GET /projects/:slug/tasks` would be: `404` for no such slug, `403` for one
 * the caller cannot read.
 */
export function listAllTasks(db: Db, actor: ResolvedActor, filter: ListAllTasksFilter): TaskView[] {
  const scope = allTasksScope(db, actor, filter);
  if (scope === null) return [];

  return readTaskPage(
    db,
    scope.conditions,
    (id) => scope.prefixes.get(id) ?? '',
    {
      limit: filter.limit,
      cursor: filter.cursor,
      now: filter.now,
    },
    readerOf(actor),
  );
}

/**
 * The set `GET /api/v1/tasks` pages through, as SQL conditions — the readable
 * projects and the shared filters — or `null` when the caller can read no
 * project at all. One function so the list and its summary (LAI-974) cannot
 * count a different set from the one they page.
 */
function allTasksScope(
  db: Db,
  actor: ResolvedActor,
  filter: Omit<ListAllTasksFilter, 'limit' | 'cursor'>,
): { conditions: SQL[]; prefixes: Map<string, string> } | null {
  let readable: { id: string; prefix: string }[];

  if (filter.project !== undefined) {
    const project = requireProjectBySlug(db, filter.project);
    assertCan(withProject(actor, project.id), 'project.read', { projectId: project.id });
    readable = [project];
  } else {
    readable = db
      .select({ id: projects.id, prefix: projects.prefix })
      .from(projects)
      .all()
      .filter((p) => canSeeProject(actor, p.id));
  }
  if (readable.length === 0) return null;

  return {
    conditions: [
      inArray(
        tasks.projectId,
        readable.map((p) => p.id),
      ),
      ...sharedConditions(filter),
    ],
    prefixes: new Map(readable.map((p) => [p.id, p.prefix])),
  };
}

/** How many named people `by_assignee` lists before folding the rest into `others`. */
export const SUMMARY_ASSIGNEES = 10;

/** The categories a task is still open in — not `done`, not `cancelled`. */
export const OPEN_STATUSES: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review'];

export interface TaskCountsView {
  total: number;
  by_status: Record<TaskStatus, number>;
  /**
   * The top {@link SUMMARY_ASSIGNEES} by count — `user_id: null` is unassigned
   * work — then, only when there are more, one `{ user_id: 'others' }` entry
   * holding the rest. The counts always sum to `total`.
   */
  by_assignee: { user_id: string | null; name: string; count: number }[];
  /** Open and due before today (UTC) — `countTask`'s rule in presence.ts. */
  overdue: number;
  /** Open with a dependency that is not `done` — `projectSummaries`' rule. */
  blocked: number;
  unassigned: number;
}

/**
 * The figures for exactly the set {@link listAllTasks} pages through
 * (`GET /api/v1/tasks/summary`, LAI-974): same readable projects through
 * `can()`, same token scope, same filters, because the conditions come from
 * the same {@link allTasksScope}. Four queries, whatever the size of the set.
 *
 * - **overdue** is presence.ts's `countTask`: an open task whose `due_on` is
 *   before today's UTC midnight (the board's day, `boardDayOf`).
 * - **blocked** is projects.ts's `projectSummaries`: an open task with at
 *   least one dependency that is not `done` — so a **cancelled** blocker still
 *   blocks, as `isReady` requires `done` and nothing else.
 */
export function summariseAllTasks(
  db: Db,
  actor: ResolvedActor,
  filter: Omit<ListAllTasksFilter, 'limit' | 'cursor'>,
  now: number = Date.now(),
): TaskCountsView {
  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >;
  const counts: TaskCountsView = {
    total: 0,
    by_status: byStatus,
    by_assignee: [],
    overdue: 0,
    blocked: 0,
    unassigned: 0,
  };

  const scope = allTasksScope(db, actor, filter);
  if (scope === null) return counts;
  const where = scope.conditions;
  const open = inArray(tasks.status, [...OPEN_STATUSES]);

  // 1. Total and by status.
  for (const row of db
    .select({ status: tasks.status, total: count() })
    .from(tasks)
    .where(and(...where))
    .groupBy(tasks.status)
    .all()) {
    byStatus[row.status] = row.total;
    counts.total += row.total;
  }

  // 2. By assignee — every group, ranked here: there is one per person, not
  //    one per task.
  const groups = db
    .select({ userId: tasks.assigneeId, name: users.name, total: count() })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(...where))
    .groupBy(tasks.assigneeId)
    .all()
    .map((g) => ({
      user_id: g.userId,
      name: g.userId === null ? 'Unassigned' : (g.name ?? ''),
      count: g.total,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name) ||
        (a.user_id ?? '').localeCompare(b.user_id ?? ''),
    );
  counts.unassigned = groups.find((g) => g.user_id === null)?.count ?? 0;
  counts.by_assignee = groups.slice(0, SUMMARY_ASSIGNEES);
  const rest = groups.slice(SUMMARY_ASSIGNEES);
  if (rest.length > 0) {
    counts.by_assignee.push({
      user_id: 'others',
      name: 'Others',
      count: rest.reduce((sum, g) => sum + g.count, 0),
    });
  }

  // 3. Overdue.
  const today = Date.parse(`${boardDayOf(now)}T00:00:00Z`);
  counts.overdue =
    db
      .select({ total: count() })
      .from(tasks)
      .where(and(...where, open, lt(tasks.dueOn, today)))
      .get()?.total ?? 0;

  // 4. Blocked — `EXISTS`, so a task blocked three times over is one task.
  const blocker = alias(tasks, 'blocker');
  counts.blocked =
    db
      .select({ total: count() })
      .from(tasks)
      .where(
        and(
          ...where,
          open,
          exists(
            db
              .select({ one: sql`1` })
              .from(taskDependencies)
              .innerJoin(blocker, eq(blocker.id, taskDependencies.dependsOnTaskId))
              .where(and(eq(taskDependencies.taskId, tasks.id), ne(blocker.status, 'done'))),
          ),
        ),
      )
      .get()?.total ?? 0;

  return counts;
}

/**
 * The smallest batch read while looking for `ready` matches — see `listTasks`.
 * A page of 200 reads 201 at a time; a page of 10 reads 50, so a sparse match
 * does not cost a query per handful of rows.
 */
const READY_BATCH = 50;

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
  /**
   * A person's size (D-085): a level sets it, `null` goes back to the
   * computed one. Anyone who may edit the task may size it.
   */
  size?: SizeLevel | null | undefined;
  /** An outside id (LAI-780), upper-cased; `null` clears it. */
  external_ref?: string | null | undefined;
  /**
   * The agent meant to do it (D-114 item 7, LAI-535): an id selects and opens
   * a work request, `null` withdraws it. Never moves the assignee.
   */
  selected_agent_id?: string | null | undefined;
  /**
   * The ETag named by PATCH's `If-Match` header ({@link taskVersion}). Absent
   * keeps the unconditional update every existing caller uses (LAI-571).
   */
  expected_version?: string | undefined;
  now?: number;
}

/**
 * **A task's version is a digest of the task as a read returns it** (LAI-571),
 * and `GET /tasks/:id` and `PATCH` send it as `ETag`.
 *
 * Derived from what is shown, not stamped by the writers, so no writer can be
 * forgotten. Two reviews found writers that left a stamped version alone: tags
 * kept in their own table, a tag renamed or merged, a sprint deleted out from
 * under its tasks, a blocker whose status moved a dependent's `ready`, a
 * comment, a recomputed size. Each one changes the view, so each one changes
 * this. `updated_at` stays what it was, the time of the task's last edit.
 *
 * Deterministic because `toView` is. Its keys are in a fixed order, its lists
 * are sorted, and it reads nothing about the caller. 128 bits of SHA-256, so two
 * different views share a version with negligible odds.
 *
 * **Except the live claim's pulse** (LAI-568): {@link CLAIM_PULSE} moves on
 * every heartbeat and with the clock, and no write to the task moves it. Left
 * in, it would make every token stale while an agent works, and that is exactly
 * when a selection needs one. Who holds the claim, by generation, state,
 * session, agent and device, stays in, so a claim taken, paused, released or
 * transferred is a new version. The holder's own writes are the claim fence's
 * to order (LAI-541), not this.
 */
export function taskVersion(view: TaskView): string {
  const claim = view.claim === null ? null : withoutPulse(view.claim);
  return createHash('sha256')
    .update(JSON.stringify({ ...view, claim }))
    .digest('hex')
    .slice(0, 32);
}

/** The version as a strong ETag: what a read sends and `If-Match` takes back. */
export function taskEtag(view: TaskView): string {
  return `"${taskVersion(view)}"`;
}

/**
 * A row of a task list, carrying the ETag a read of that one task would send
 * (LAI-571 review, round 3), so a client can make a guarded `PATCH` from a
 * list without reading each task first. Computed from the full view, so a
 * slim row's ETag is the full task's, even though the slim row cannot be
 * hashed back to it.
 */
export interface ListedTaskView extends TaskView {
  etag: string;
}

/** {@link ListedTaskView}'s slim form (`?fields=slim`, LAI-795). */
export interface ListedTaskSummaryView extends TaskSummaryView {
  etag: string;
}

export function listedTask(view: TaskView): ListedTaskView {
  return { ...view, etag: taskEtag(view) };
}

export function listedTaskSummary(view: TaskView): ListedTaskSummaryView {
  return { ...summaryOf(view), etag: taskEtag(view) };
}

/**
 * The live claim's fields that move without a write (LAI-568): the heartbeat,
 * the lease, the clock — the heartbeat's age, which moves on every read
 * (LAI-597 review) — and what the session says ran, which any heartbeat may
 * change (D-118, LAI-593).
 */
export const CLAIM_PULSE = [
  'last_heartbeat_at',
  'heartbeat_age_ms',
  'lease_expires_at',
  'connection',
  'harness',
  'harness_version',
  'model',
] as const;

function withoutPulse(claim: TaskLiveClaimView): Partial<TaskLiveClaimView> {
  const kept: Partial<TaskLiveClaimView> = { ...claim };
  for (const field of CLAIM_PULSE) delete kept[field];
  return kept;
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
  if (input.external_ref !== undefined) {
    const ref = input.external_ref === null ? null : normaliseOutsideId(input.external_ref);
    if (ref !== task.externalRef) changes.externalRef = ref;
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
    if (typeof input.assignee_id === 'string') assertMayHold(db, input.assignee_id, project.id);
    changes.assigneeId = input.assignee_id;
  }

  // The selection is not in `changes`: it writes its own verb, and a reader
  // asking "when was this asked of that agent" should not open a payload.
  const selecting =
    input.selected_agent_id !== undefined && input.selected_agent_id !== task.selectedAgentId;
  if (selecting) {
    if (input.selected_agent_id !== null && input.selected_agent_id !== undefined) {
      assertAgentSelectable(db, actor, project, input.selected_agent_id);
    }
  }

  // **One write, whole or not at all** (LAI-771 review, B1). The tags, the
  // fields and a person's size are each the caller's request, so a size that
  // cannot be stored must not leave the rest saved behind an error. The
  // estimator inside is best effort and is never the reason this rolls back.
  // `immediate` for the reason `bestEffort` gives: the write lock before the
  // first read.
  return db.transaction(
    () => {
      // The claim fence (LAI-541), under the write lock and before anything
      // is written, so a stale holder changes nothing at all.
      assertClaimFence(db, actor, taskId, now);
      if (selecting) assertSelectionChangeAllowed(db, task);

      // **Every input of the view is read again here**, under the lock, and not
      // taken from `requireTask` above, which ran before it. The project's
      // prefix makes the key, and a rename that commits between the two reads
      // would otherwise let a token for `LAI-1` pass on a task now `NEW-1`
      // (LAI-571 review, round 3). The row is read here for the same reason.
      const prefix = db
        .select({ prefix: projects.prefix })
        .from(projects)
        .where(eq(projects.id, project.id))
        .get()!.prefix;

      // The precondition, under the write lock and before anything moves: the
      // task as a read would show it now must be the task the caller read.
      // `immediate` holds every other writer off until this commits, so the
      // check and the write are one step.
      if (input.expected_version !== undefined) {
        const current = viewOne(
          db,
          db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
          prefix,
          now,
          readerOf(actor),
        );
        const version = taskVersion(current);
        if (version !== input.expected_version) {
          throw new ApiError('conflict', 'The task changed after you read it', {
            current,
            etag: taskEtag(current),
          });
        }
      }

      // Under the write lock, so two writes cannot both find it free.
      if (typeof changes.externalRef === 'string') {
        assertOutsideIdFree(db, project.id, changes.externalRef, taskId);
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

      if (Object.keys(changes).length > 0) {
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
      }

      if (selecting) {
        const to = input.selected_agent_id ?? null;
        db.update(tasks)
          .set({ selectedAgentId: to, updatedAt: now })
          .where(eq(tasks.id, taskId))
          .run();
        moveSelection(db, actor, taskId, to, now);
        appendActivity(db, {
          orgId: project.orgId,
          projectId: project.id,
          taskId,
          ...activityActor(actor),
          type: 'task.agent_selected',
          payload: { from: task.selectedAgentId, to },
          now,
        });
      }

      // **The size follows what the model reads, and nothing else** (D-085): the
      // text, the tags and the parent. A priority, an assignee or a date never
      // reaches the estimate at all; an edit that leaves the inputs as they were
      // is a hash comparison inside it.
      const parentMoved = 'parentTaskId' in changes;
      if (
        tagChange !== null ||
        parentMoved ||
        'title' in changes ||
        'descriptionMd' in changes ||
        'acceptanceMd' in changes
      ) {
        refreshEstimate(db, taskId, now);
      }
      // A subtask moved: both parents' figures came from their children.
      if (parentMoved) {
        if (task.parentTaskId !== null) refreshEstimate(db, task.parentTaskId, now);
        if (input.parent_task_id) refreshEstimate(db, input.parent_task_id, now);
      }

      const sizeChange =
        input.size === undefined
          ? null
          : setSizeOverride(db, actor.userId, taskId, input.size, now);
      if (sizeChange !== null) {
        appendActivity(db, {
          orgId: project.orgId,
          projectId: project.id,
          taskId,
          ...activityActor(actor),
          // The field named, as tags and the sprint are — not a new verb (D-027).
          type: 'task.updated',
          payload: { field: 'size', from: sizeChange.from, to: sizeChange.to },
          now,
        });
      }

      return viewOne(
        db,
        db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
        prefix,
        now,
        readerOf(actor),
      );
    },
    { behavior: 'immediate' },
  );
}

/** Where a claim may take a task from (§5, M7, D-082). */
const CLAIMABLE: readonly TaskStatus[] = [...READY_STATUSES, 'in_progress'];

/** What `start_working` and `POST /tasks/:id/claim` answer (§5, LAI-541). */
export interface StartedWork {
  task: TaskView;
  /**
   * The exclusive claim a registered agent's session now holds (§4.66), whose
   * `generation` it sends with every change. Null for a person or a legacy
   * token: they claim by assignee alone, as before.
   */
  claim: TaskClaimView | null;
}

export interface StartWorkingOptions {
  now?: number;
  /**
   * The branch the work is on, when the agent says (`start_working`'s
   * `branch`, LAI-770): kept on the task, so the board shows where the work
   * is and a branch named for the key ties the session's tokens to it.
   */
  branch?: string | undefined;
  /**
   * The claimant's own size and confidence (`start_working`'s `estimate`,
   * D-085 item 4, LAI-772): kept best effort after the claim's activity row,
   * scored against what happens, and blended into the forecast only once the
   * claimants' sizes here have beaten the project median. A resume — the
   * holder's own call on a task already under way — is not a claim and keeps
   * none.
   */
  estimate?: ClaimEstimateInput | undefined;
  /** A registered agent's session to claim under (§4.65); absent opens one. */
  sessionId?: string | undefined;
}

/**
 * Claim: compare-and-swap (SPEC §5, AC3) — and, for a registered agent, the
 * exclusive claim (§4.66, LAI-541).
 *
 * The API twin of the file-move lock the build sessions use by hand — getting it
 * wrong puts two agents on one task. The swap runs inside `BEGIN IMMEDIATE` and
 * the `UPDATE` itself carries `assignee_id IS NULL`, so the check and the write
 * cannot be separated by another writer. A loser is told **who** holds it, since
 * "conflict" alone does not tell an agent what to do next.
 *
 * ## A registered agent's claim (LAI-541)
 *
 * Takes a different path, {@link agentStartWorking}: its session takes the
 * task's one live claim, and **`assignee_id` is never written** (D-114 item 7).
 * A person and a legacy token claim by assignee, as above — and a legacy token
 * cannot claim a task an agent's session holds, or whose claim lapsed (D-114
 * item 6).
 */
export function startWorking(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  options: StartWorkingOptions = {},
): StartedWork {
  const now = options.now ?? Date.now();
  const { estimate } = options;
  // A task the caller cannot read is answered as one that does not exist
  // (LAI-586 review) — before `task.claim`, which would say it does.
  const { project } = requireVisibleTaskToClaim(db, actor, taskId);
  assertCan(withProject(actor, project.id), 'task.claim', { projectId: project.id });
  const onBranch = options.branch?.trim() === '' ? undefined : options.branch?.trim();
  const agent = registeredAgent(actor);

  return immediateTransaction(sqlite, () => {
    const before = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
    const from = statusRow(db, project.id, before.statusId)!;

    if (agent !== null) return agentStartWorking(db, actor, project, before, from, options, now);

    // D-114 item 6: a token with no agent cannot take what a session holds,
    // or a claim that lapsed and waits for recovery.
    const refusal = claimFenceRefusal(db, actor, taskId, now);
    if (refusal !== null) throw refusal;

    // The holder's own claim of a task already under way is a **mark, not a
    // move** (LAI-770 review, B2, the owner's decision): a session resuming the
    // task says so with `start_working` again, and a refusal there would leave
    // its tokens tied to nothing. It keeps the branch it is given and changes
    // nothing else — no status, no activity row, `started_at` and the frozen
    // estimate untouched. Anyone else, and a holder whose task is not in
    // progress, still hear who has it below.
    if (before.assigneeId === actor.userId && before.status === 'in_progress') {
      if (onBranch !== undefined && onBranch !== before.branch) {
        db.update(tasks)
          .set({ branch: onBranch, updatedAt: now })
          .where(eq(tasks.id, taskId))
          .run();
      }
      return {
        task: viewOne(
          db,
          db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
          project.prefix,
          now,
          readerOf(actor),
        ),
        claim: null,
      };
    }
    // Held first, so a second claimant still hears **who** has it (AC3).
    if (before.assigneeId !== null) {
      throw new ApiError('conflict', 'That task is already claimed', {
        assignee_id: before.assigneeId,
        status: before.status,
      });
    }
    // **A claim starts work, so it takes a task from where work starts** (§5,
    // M7): a `backlog` or `todo` status — or an unassigned `in_progress` one,
    // which is work somebody released, and taking it over moves no category
    // (D-078 item 8 measures its cycle from the first claim). Before LAI-758 it
    // took anything unassigned: a cancelled task came back to life, a done one
    // reopened, and one in review skipped the person's decision — none of
    // which `changeStatus` would have let the same caller do.
    assertClaimable(before, from);
    // A released task stays in the in-progress status it was in; anything else
    // lands in the project's first visible one (LAI-738).
    const to =
      before.status === 'in_progress' ? from : statusForCategory(db, project.id, 'in_progress');

    const changed = db
      .update(tasks)
      .set({
        assigneeId: actor.userId,
        status: 'in_progress',
        statusId: to.id,
        // The **first** entry to `in_progress` (§4.5), as `changeStatus`
        // keeps it. A task released and claimed again did not start twice,
        // and stamping every claim shortened its cycle time (LAI-743).
        // `before` is read inside this transaction, so nothing moved it since.
        startedAt: before.startedAt ?? now,
        ...(onBranch === undefined ? {} : { branch: onBranch }),
        updatedAt: now,
      })
      .where(and(eq(tasks.id, taskId), isNull(tasks.assigneeId)))
      .run();

    if (changed.changes === 0) {
      const current = db.select().from(tasks).where(eq(tasks.id, taskId)).get();

      throw new ApiError('conflict', 'That task is already claimed', {
        assignee_id: current?.assigneeId ?? null,
        status: current?.status ?? null,
      });
    }

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(actor),
      type: 'task.status_changed',
      // `from` was the literal `'todo'` until LAI-738, whatever the task was
      // in; with the status names beside it, a wrong category would contradict
      // the row it sits in.
      payload: {
        from: before.status,
        to: 'in_progress',
        ...statusPayload(from, to),
        assignee_id: actor.userId,
        via: 'claim',
      },
      now,
    });

    afterStart(db, actor, taskId, before.startedAt, estimate, now);

    return {
      task: viewOne(
        db,
        db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
        project.prefix,
        now,
        readerOf(actor),
      ),
      claim: null,
    };
  });
}

/** Where a claim may start from (§5, M7), or `422` naming the status. */
function assertClaimable(before: TaskRow, from: StatusRef): void {
  if (CLAIMABLE.includes(before.status)) return;
  throw new ApiError(
    'unprocessable',
    `Only a task in a backlog, to-do or released in-progress status can be claimed; this one is in ${from.name}`,
    { from: before.status, to: 'in_progress', allowed_from: CLAIMABLE },
  );
}

/**
 * What the claimant said, then the forecast work starts under (D-085 items
 * 4–5) — the freeze at the first start only, as `started_at` is. After the
 * activity row and best effort, so neither can cost the claim its record
 * (LAI-771 review, B1).
 */
function afterStart(
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  startedAt: number | null,
  estimate: ClaimEstimateInput | undefined,
  now: number,
): void {
  if (estimate !== undefined) recordClaimEstimate(db, actor, taskId, estimate, now);
  if (startedAt === null) freezeEstimateAtStart(db, taskId, now);
  else if (estimate !== undefined) refreshEstimate(db, taskId, now);
}

/**
 * A registered agent's `start_working` (§5, §4.66, LAI-541): its session takes
 * — or resumes — the task's one live claim, and **`assignee_id` is never
 * written** (D-114 item 7: the assignee, the selected agent and the claim are
 * three facts, and changing the assignee is always its own explicit act). An
 * unassigned task stays unassigned; the claim is the lock.
 *
 * Whose task it may take: an unassigned one, its owner's, or — only when an
 * open work request asks this agent for it — somebody else's. From where: §5's
 * claimable statuses. A task not yet in progress moves there, as any claim
 * moves it; one already in progress is a claim on work under way, recorded as
 * `task.updated` with `field: "claim"` (a resume records nothing).
 */
function agentStartWorking(
  db: Db,
  actor: ResolvedActor,
  project: typeof projects.$inferSelect,
  before: TaskRow,
  from: StatusRef,
  options: StartWorkingOptions,
  now: number,
): StartedWork {
  const taskId = before.id;
  const onBranch = options.branch?.trim() === '' ? undefined : options.branch?.trim();
  const agent = registeredAgent(actor)!;

  // D-119 first (LAI-586 review round 2): an agent that is not the selected
  // one hears that reason whatever else is true of the task — the assignee
  // rule below would otherwise answer it with a bare "already claimed".
  // Visibility and `task.claim` were asked before this function was reached,
  // so a hidden task still answers as a missing one.
  assertSelectedAgentMayClaim(db, actor, taskId, agent.id);

  const requested = hasOpenWorkRequest(db, taskId, agent.id);
  // **The holder's own renewal is not a second claim** (LAI-546 review): a
  // receiver that accepted a hand-off holds the live claim on a task whose
  // human assignee is somebody else's, with no work request left — the claim
  // is the lock, and `takeClaim` asks that it is this session's.
  const holds = liveClaim(db, taskId)?.agentId === agent.id;
  if (before.assigneeId !== null && before.assigneeId !== actor.userId && !requested && !holds) {
    throw new ApiError('conflict', 'That task is already claimed', {
      assignee_id: before.assigneeId,
      status: before.status,
    });
  }
  assertClaimable(before, from);

  // The claim before the task moves, so a refusal leaves the task exactly as it was.
  const taken = takeClaim(db, actor, before, { sessionId: options.sessionId, now });

  if (before.status === 'in_progress') {
    // A paused claim's renewal writes nothing, its branch included: every
    // change is refused while the offer is live (§4.73).
    if (onBranch !== undefined && onBranch !== before.branch && taken.claim.state !== 'paused') {
      db.update(tasks).set({ branch: onBranch, updatedAt: now }).where(eq(tasks.id, taskId)).run();
    }
    if (!taken.resumed) {
      appendActivity(db, {
        orgId: project.orgId,
        projectId: project.id,
        taskId,
        ...activityActor(actor),
        type: 'task.updated',
        payload: {
          field: 'claim',
          from: null,
          to: { generation: taken.claim.generation, session_id: taken.claim.sessionId },
        },
        now,
      });
    }
  } else {
    const to = statusForCategory(db, project.id, 'in_progress');
    db.update(tasks)
      .set({
        status: 'in_progress',
        statusId: to.id,
        startedAt: before.startedAt ?? now,
        ...(onBranch === undefined ? {} : { branch: onBranch }),
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();
    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(actor),
      type: 'task.status_changed',
      // No `assignee_id`: a claim does not assign (D-114 item 7).
      payload: {
        from: before.status,
        to: 'in_progress',
        ...statusPayload(from, to),
        via: 'claim',
        claim_generation: taken.claim.generation,
      },
      now,
    });
    afterStart(db, actor, taskId, before.startedAt, options.estimate, now);
  }

  return {
    task: viewOne(
      db,
      db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
      project.prefix,
      now,
      readerOf(actor),
    ),
    claim: claimView(taken.claim),
  };
}

/**
 * {@link startWorking}, answering the task alone — the shape every caller had
 * before LAI-541, kept so none of them changes.
 */
export function claimTask(
  sqlite: Database.Database,
  db: Db,
  actor: ResolvedActor,
  taskId: string,
  now: number = Date.now(),
  branch?: string,
  estimate?: ClaimEstimateInput,
): TaskView {
  return startWorking(sqlite, db, actor, taskId, { now, branch, estimate }).task;
}

export function changeStatus(
  db: Db,
  actor: ServiceCaller,
  taskId: string,
  target: StatusTarget,
  now: number = Date.now(),
  /**
   * Which §5 table applies. Defaults to asking the principal, which is what
   * every caller wants except `finishTask` — see its docblock.
   */
  rule: TransitionRule = isAgentPrincipal(actor) ? 'agent' : 'human',
  /**
   * Which review decision this move is, written into the activity row as
   * `via` the way a claim writes `via: 'claim'` (D-082). Absent for every
   * other move.
   */
  via?: 'accept' | 'send_back',
): TaskView {
  const { task, project } = requireTask(db, taskId);
  const scoped = withProject(actor, project.id);
  assertCan(scoped, 'task.write', { projectId: project.id });
  // Every move — the holder's finish, a person's accept or send-back — passes
  // the claim fence first (LAI-541).
  assertClaimFence(db, actor, taskId, now);

  const from = statusRow(db, project.id, task.statusId)!;
  // A bare `done` from an agent is the D-082 refusal even when the task is
  // already done: the no-op answer below would tell it the move was merely
  // redundant, and a replayed session request would look like it had worked.
  if (target === 'done') assertNotAgentIntoDone(actor, statusForCategory(db, project.id, 'done'));
  // A bare category the task is already in is a no-op, as it always was — not
  // a hop to that category's first status. An agent saying `review` about a
  // task in `QA` means "it is in review", and moving it would undo a person's
  // choice of column (LAI-738).
  if (typeof target === 'string' && target === task.status) {
    throw new ApiError('conflict', `That task is already in ${from.name}`, {
      from: task.status,
      to: target,
    });
  }
  const dest = resolveStatus(db, project.id, target);
  const to = dest.category;

  // Before the no-op and same-category answers, so an agent asking for done is
  // told the rule rather than a coincidence about where the task already is.
  assertNotAgentIntoDone(actor, dest);

  if (dest.id === from.id) {
    throw new ApiError('conflict', `That task is already in ${from.name}`, {
      from: task.status,
      to,
    });
  }

  // ## A move inside one category is not a §5 transition (LAI-738, D-077)
  //
  // `In progress` → `Code review` when both are `in_progress` changes the
  // column and nothing §5 reasons about: not readiness, not the dates, not who
  // may send work to review. So it needs `task.write` and nothing more, and it
  // is written as the same verb with the same `from`/`to` — equal, which is
  // what tells a reader the category did not move.
  if (to === task.status) {
    db.update(tasks).set({ statusId: dest.id, updatedAt: now }).where(eq(tasks.id, taskId)).run();

    appendActivity(db, {
      orgId: project.orgId,
      projectId: project.id,
      taskId,
      ...activityActor(actor),
      type: 'task.status_changed',
      payload: { from: task.status, to, ...statusPayload(from, dest), ...(via ? { via } : {}) },
      now,
    });

    return viewOne(
      db,
      db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
      project.prefix,
      now,
      readerOf(actor),
    );
  }

  // §5's table, widened for a person and unchanged for a program (LAI-266).
  // `isAgentPrincipal` reads `actor.token`, **not** `isSystemPrincipal` — a
  // token-bearing agent is an ordinary actor, so the obvious predicate would
  // have handed MCP the human rule. The branch below is a different question
  // and keeps its own test.
  assertTransition(task.status, to, rule, { from: from.name, to: dest.name });

  // §5: moving to `review` requires the assignee, a project lead, or org
  // Admin/Owner. The task text said "assignee, Admin or Owner" and omitted lead;
  // the spec wins (D-011). **Moving to `done` asks the same question** (M7,
  // D-082): before LAI-758 any `task.write` holder could close somebody else's
  // work without the review gate's rule ever being asked.
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
  // somebody reads. `assertMayCloseReview` returns for it.
  if (to === 'review' || to === 'done') {
    assertMayCloseReview(actor, task, to, holdsLiveClaim(db, actor, taskId));
  }

  db.update(tasks)
    .set({
      status: to,
      statusId: dest.id,
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

  // The session the holder finishes under, read before its claim is released
  // so the row still says what ran (D-118, LAI-586); `appendActivity` keeps it
  // only if it is the writing agent's own.
  const underSession =
    task.status === 'in_progress' ? (liveClaim(db, taskId)?.sessionId ?? null) : null;
  // Out of `in_progress`, nobody works it under the claim it had (§5,
  // LAI-541): released, and its generation refused from here on.
  if (task.status === 'in_progress') releaseLiveClaim(db, taskId, now);

  appendActivity(db, {
    orgId: project.orgId,
    projectId: project.id,
    taskId,
    ...activityActor(actor),
    agentSessionId: underSession,
    type: 'task.status_changed',
    payload: { from: task.status, to, ...statusPayload(from, dest), ...(via ? { via } : {}) },
    now,
  });

  // After the activity row, and best effort (LAI-771 review, B1): this
  // function has no transaction, and a failure here once fell between the
  // status write and its row. A first start by any route freezes the
  // forecast, as a claim does (D-085); a cancelled subtask leaves its
  // parent's sum, and an uncancelled one rejoins.
  if (to === 'in_progress' && task.startedAt === null) freezeEstimateAtStart(db, taskId, now);
  if (task.parentTaskId !== null && (to === 'cancelled' || task.status === 'cancelled')) {
    refreshEstimate(db, task.parentTaskId, now);
  }

  return viewOne(
    db,
    db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
    project.prefix,
    now,
    readerOf(actor),
  );
}

/**
 * The two statuses a `task.status_changed` row names besides the categories
 * (LAI-738). `from`/`to` stay the categories — append-only history has always
 * had them, and every reader keys on them — and these say which columns.
 */
function statusPayload(from: StatusRef, to: StatusRef) {
  return {
    from_status_id: from.id,
    from_status_name: from.name,
    to_status_id: to.id,
    to_status_name: to.name,
  };
}

export interface FinishTaskInput extends EvidenceInput {
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
  // Checked before anything moves, so a bad item refuses the whole finish
  // rather than leaving a task in review without the proof it was sent with.
  const items = evidenceItems(input);

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

    const summary = finishSummary(input);
    addComment(db, actor, task.id, summary, now);

    // The round, with its proof (§4.25, D-082). After the move, inside the same
    // transaction: a round exists exactly when a finish happened.
    recordRound(db, actor, task.id, summary, items, now);

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
  assertClaimFence(db, actor, taskId, now);

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
  // What a task is blocked by is one of the model's inputs (D-085).
  refreshEstimate(db, taskId, now);

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
  assertClaimFence(db, actor, taskId, now);

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
  refreshEstimate(db, taskId, now);

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
    assertClaimFence(db, actor, taskId, now);
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
      if (row?.projectId !== project.id) {
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
    if (alreadyThere) return viewOne(db, task, project.prefix, now, readerOf(actor));

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

    return viewOne(
      db,
      db.select().from(tasks).where(eq(tasks.id, taskId)).get()!,
      project.prefix,
      now,
      readerOf(actor),
    );
  });
}
