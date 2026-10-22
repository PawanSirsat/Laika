import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addTaskDependency,
  changeStatus,
  CLAIM_CONFIDENCES,
  CREATED_VIA,
  claimTask,
  createTask,
  finishTask,
  getTask,
  listAllTasks,
  listTasks,
  removeTaskDependency,
  reorderTask,
  SIZE_LEVELS,
  summaryOf,
  TASK_LIST_FIELDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  updateTask,
  type TaskSummaryView,
  type TaskView,
} from '../../services/tasks.ts';
import { EVIDENCE_LIMITS, listTaskRounds } from '../../services/rounds.ts';
import { acceptTask, sendBackTask } from '../../services/review.ts';
import { getTaskEstimate, type TaskEstimateView } from '../../services/estimates.ts';
import { getTaskUsage, type TaskUsageView } from '../../services/token-usage.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince } from '../updated-since.ts';
import { unwatchTask, watchersOfTask, watchTask } from '../../services/watchers.ts';
import { parseBody, parseQuery, strictObject, z } from '../validation.ts';

/**
 * Tasks (SPEC §6.4). Transport only — §5's transition rules and §4.5's readiness
 * computation live in `services/`, so the M3 MCP tools get identical behaviour by
 * calling the same functions (CONVENTIONS §2).
 */

// The vocabularies come from `db/enums.ts` through `services/`, which this file
// may import — CONVENTIONS §2 forbids `http/routes/` reaching into `db/`, and
// these are values, so `allowTypeImports` does not help. Retyping them here made
// a fourth copy of a list `db/enums.ts` exists to declare once (LAI-119).

/**
 * Acceptance is prose, and shorter than a description on purpose: it answers
 * "what does done mean here", not "what is this about". 10k is generous for
 * that and small enough that nobody pastes a spec into it (LAI-092).
 */
const ACCEPTANCE_MAX = 10_000;

/** A date with date-only semantics: unix-ms at a UTC midnight, as §4.15 (D-066). */
const DateOnly = z.number().int().finite();

const CreateBody = strictObject({
  title: z.string().trim().min(1).max(300),
  description_md: z.string().max(100_000).optional(),
  acceptance_md: z.string().max(ACCEPTANCE_MAX).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  // A category, or one exact status of the project — or both, if they agree
  // (LAI-738). The service resolves and checks; this only shapes.
  status: z.enum(TASK_STATUSES).optional(),
  status_id: z.string().min(1).optional(),
  assignee_id: z.string().min(1).optional(),
  discovered_from: z.string().min(1).optional(),
  // A subtask of that task — one level, same project; the service refuses the
  // rest with `422` and `details.reason` (D-066).
  parent_task_id: z.string().min(1).optional(),
  due_on: DateOnly.optional(),
  planned_start: DateOnly.optional(),
  // A person's size from the start (D-085); the computed one stays beside it.
  size: z.enum(SIZE_LEVELS).optional(),
  // An outside id (LAI-780). A sanity bound only: the shape and its length are
  // the service's (`normaliseOutsideId`), so its message is the one read.
  external_ref: z.string().max(120).optional(),
  created_via: z.enum(CREATED_VIA).optional(),
});

const UpdateBody = strictObject({
  title: z.string().trim().min(1).max(300).optional(),
  description_md: z.string().max(100_000).optional(),
  // `null` clears it, absent leaves it alone — the same distinction the
  // assignee below draws, and the one a sprint's `goal` already draws.
  acceptance_md: z.string().max(ACCEPTANCE_MAX).nullable().optional(),
  // Replaces the whole set. Validation of each name is the service's — the
  // regex, the lowercasing and the duplicate rule live with the CHECK they
  // mirror, not in two places.
  tags: z.array(z.string().trim().min(1).max(64)).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  // `null` unassigns; absent leaves it alone. They are different requests.
  assignee_id: z.string().min(1).nullable().optional(),
  // `null` detaches from the parent; a string re-parents (D-066).
  parent_task_id: z.string().min(1).nullable().optional(),
  // `null` clears each date; absent leaves it alone.
  due_on: DateOnly.nullable().optional(),
  planned_start: DateOnly.nullable().optional(),
  // A person's size (D-085): a level sets it, `null` goes back to the computed one.
  size: z.enum(SIZE_LEVELS).nullable().optional(),
  // An outside id (LAI-780); `null` clears it. Shaped by the service, as above.
  external_ref: z.string().max(120).nullable().optional(),
});

// `status` is a category — the project's first visible status of it — and
// `status_id` one exact status, which is what a board drag sends (LAI-738).
// Exactly one: two answers to "where does it go" would need a third rule.
const StatusBody = strictObject({
  status: z.enum(TASK_STATUSES).optional(),
  status_id: z.string().min(1).optional(),
});
// `blocked_by_task_id`, matching `TaskView.blocked_by` (LAI-099). The **path**
// keeps `/dependencies`: a path segment names a collection, not a direction, and
// has no sibling to be confused with — `blocked_by` beside `blocks` was ambiguous,
// `/dependencies` beside nothing is not (D-044).
const DependencyBody = strictObject({ blocked_by_task_id: z.string().min(1) });
// LAI-472: neighbours, not an index. "At least one" is the service's rule, so
// the MCP path and this one refuse an empty move with the same words.
const ReorderBody = strictObject({
  after_task_id: z.string().min(1).optional(),
  before_task_id: z.string().min(1).optional(),
});

/**
 * `POST /tasks/:id/finish` — `finish_task`'s REST twin (§6.4, D-082): the move
 * to review, the summary comment and the round with its proof, in one write.
 * Every proof field is optional, as on the tool, and bounded by the same
 * `EVIDENCE_LIMITS`; the service holds the rules (a sha is hex, a pull request
 * is an http(s) URL) and this only shapes.
 */
/**
 * `POST /tasks/:id/claim`'s optional body: the branch the work is on, which
 * `start_working` takes too (§7.1) and the task keeps (LAI-770), and the
 * claimant's own `estimate` — a size, a confidence or both (D-085 item 4,
 * LAI-772). No body at all is a claim, as it always was.
 */
const ClaimBody = strictObject({
  branch: z.string().trim().min(1).max(EVIDENCE_LIMITS.branch).optional(),
  estimate: strictObject({
    size: z.enum(SIZE_LEVELS).optional(),
    confidence: z.enum(CLAIM_CONFIDENCES).optional(),
  }).optional(),
});

const UsageQuery = strictObject({ tz: z.string().min(1).max(64).optional() });

/**
 * `GET /tasks`'s query (LAI-887). Strict, so a filter this list does not take —
 * `priority`, `tag`, `ready` — is `422` rather than silently ignored: a list
 * that answers unfiltered to a filtered question looks right and is not. The
 * values are checked below with the per-project list's own parsers, so a bad
 * one gets the same `400` there and here.
 */
const AllTasksQuery = strictObject({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  updated_since: z.string().optional(),
  fields: z.string().optional(),
  project: z.string().optional(),
  status: z.string().optional(),
  assignee: z.string().optional(),
  sprint: z.string().optional(),
});

const FinishBody = strictObject({
  summary: z.string().trim().min(1).max(50_000),
  checklist: z.array(z.string().min(1).max(500)).max(50).optional(),
  commits: z
    .array(
      strictObject({
        sha: z.string().trim().min(EVIDENCE_LIMITS.shaMin).max(EVIDENCE_LIMITS.shaMax),
        message: z.string().max(10_000).optional(),
      }),
    )
    .max(EVIDENCE_LIMITS.commits)
    .optional(),
  branch: z.string().trim().min(1).max(EVIDENCE_LIMITS.branch).optional(),
  pull_request: z.string().trim().min(1).max(EVIDENCE_LIMITS.url).optional(),
  tests: z
    .array(
      strictObject({
        command: z.string().trim().min(1).max(EVIDENCE_LIMITS.command),
        exit_code: z.number().int(),
      }),
    )
    .max(EVIDENCE_LIMITS.tests)
    .optional(),
});

// The bounds are the service's (`SEND_BACK_REASON_MAX`): a reason is checked
// in one place, so its message is the one a person reads.
const SendBackBody = strictObject({ reason: z.string() });

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** `?ready=true|false`, absent meaning "either". */
function parseReady(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  throw ApiError.badRequest('ready must be true or false', { ready: raw });
}

function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (raw === undefined || raw === '') return undefined;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;

  throw ApiError.badRequest(`${name} must be one of ${allowed.join(', ')}`, { [name]: raw });
}

export interface TaskRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

/** Mounted at `/api/v1/projects` — the project-scoped half of §6.4. */
export function projectTaskRoutes(options: TaskRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:slug/tasks', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());
    // `slim` leaves out the two texts (LAI-795); absent, the answer is unchanged.
    const fields = parseEnum(c.req.query('fields'), TASK_LIST_FIELDS, 'fields');

    const rows = listTasks(db, actor, c.req.param('slug'), {
      limit,
      cursor,
      updatedSince: parseUpdatedSince(c.req.query('updated_since')),
      ...(c.req.query('tag') === undefined || c.req.query('tag') === ''
        ? {}
        : { tag: c.req.query('tag') }),
      // Only that task's subtasks (§6.4, D-066) — the `tag` idiom, because an
      // empty value over a query string means absent.
      ...(c.req.query('parent') === undefined || c.req.query('parent') === ''
        ? {}
        : { parent: c.req.query('parent') }),
      status: parseEnum(c.req.query('status'), TASK_STATUSES, 'status'),
      // One project status (LAI-738); `status` above is its category.
      ...(c.req.query('status_id') === undefined || c.req.query('status_id') === ''
        ? {}
        : { status_id: c.req.query('status_id') }),
      priority: parseEnum(c.req.query('priority'), TASK_PRIORITIES, 'priority'),
      assignee: c.req.query('assignee'),
      sprint: c.req.query('sprint'),
      ready: parseReady(c.req.query('ready')),
    });

    const page: Page<TaskView> = buildPage(rows, limit, (row) => ({
      sortKey: row.updated_at,
      id: row.id,
    }));

    if (fields === 'slim') {
      return c.json({ ...page, data: page.data.map(summaryOf) } satisfies Page<TaskSummaryView>);
    }
    return c.json(page);
  });

  app.post('/:slug/tasks', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateBody, await c.req.json().catch(() => null));

    return c.json(createTask(sqlite, db, actor, c.req.param('slug'), body), 201);
  });

  return app;
}

/** Mounted at `/api/v1/tasks` — tasks are addressed by ULID (§6.4). */
export function taskRoutes(options: TaskRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  // Everyone's work: every project the caller may read, in the per-project
  // list's shape and order (LAI-887). An empty filter value reads as absent,
  // as it does there.
  app.get('/', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(AllTasksQuery, c.req.query());
    const { limit, cursor } = parsePageQuery(query);
    const fields = parseEnum(query.fields, TASK_LIST_FIELDS, 'fields');
    const given = (raw: string | undefined) => (raw === '' ? undefined : raw);

    const rows = listAllTasks(db, actor, {
      limit,
      cursor,
      updatedSince: parseUpdatedSince(query.updated_since),
      project: given(query.project),
      status: parseEnum(query.status, TASK_STATUSES, 'status'),
      assignee: given(query.assignee),
      sprint: given(query.sprint),
    });

    const page: Page<TaskView> = buildPage(rows, limit, (row) => ({
      sortKey: row.updated_at,
      id: row.id,
    }));

    if (fields === 'slim') {
      return c.json({ ...page, data: page.data.map(summaryOf) } satisfies Page<TaskSummaryView>);
    }
    return c.json(page);
  });

  app.get('/:id', (c) => c.json(getTask(db, requireActor(c), c.req.param('id'))));

  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(UpdateBody, await c.req.json().catch(() => null));

    return c.json(updateTask(db, actor, c.req.param('id'), body));
  });

  app.post('/:id/claim', async (c) => {
    const actor = requireActor(c);
    const text = await c.req.text();
    let json: unknown = {};
    if (text.trim() !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        // Not JSON: refused below with the 422 every other body gets.
        json = null;
      }
    }
    const body = parseBody(ClaimBody, json);

    return c.json(
      claimTask(sqlite, db, actor, c.req.param('id'), Date.now(), body.branch, body.estimate),
    );
  });

  app.post('/:id/finish', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(FinishBody, await c.req.json().catch(() => null));

    return c.json(finishTask(sqlite, db, actor, c.req.param('id'), body));
  });

  /**
   * Its size, the *why*, the forecast frozen when work started, what actually
   * happened, and the estimate history (§6.4, D-085) — the task panel's
   * Forecast section. A read, under `project.read`.
   */
  app.get('/:id/estimate', (c) =>
    c.json<TaskEstimateView>(getTaskEstimate(db, requireActor(c), c.req.param('id'))),
  );

  /**
   * What every person's agents spent on it, per round and — for the readers
   * allowed it — per person and agent (§6.4, D-084, LAI-770): the task
   * panel's Tokens section.
   */
  app.get('/:id/usage', (c) =>
    c.json<TaskUsageView>(
      getTaskUsage(db, requireActor(c), c.req.param('id'), parseQuery(UsageQuery, c.req.query())),
    ),
  );

  /** Every round of a task, newest first, and its current send-back (§6.4). */
  app.get('/:id/rounds', (c) => c.json(listTaskRounds(db, requireActor(c), c.req.param('id'))));

  /** The review queue's two decisions (§6.4, D-082) — a web session's. */
  app.post('/:id/accept', (c) =>
    c.json(acceptTask(sqlite, db, requireActor(c), c.req.param('id'))),
  );

  app.post('/:id/send-back', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(SendBackBody, await c.req.json().catch(() => null));

    return c.json(sendBackTask(sqlite, db, actor, c.req.param('id'), body.reason));
  });

  app.post('/:id/status', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(StatusBody, await c.req.json().catch(() => null));

    if ((body.status === undefined) === (body.status_id === undefined)) {
      throw new ApiError('unprocessable', 'Send either status or status_id', {
        field: 'status',
      });
    }

    return c.json(
      changeStatus(
        db,
        actor,
        c.req.param('id'),
        body.status_id === undefined ? body.status! : { status_id: body.status_id },
      ),
    );
  });

  /**
   * Move one card in its project's manual order (§6.4, LAI-472, D-070).
   * `after_task_id` is the card it lands directly below, `before_task_id` the
   * one directly above. A `POST`, not a `PATCH` of `position`: the client
   * names neighbours and the server computes the key, so `position` is never
   * written directly — the way `status` moves only through `/status`.
   */
  app.post('/:id/reorder', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(ReorderBody, await c.req.json().catch(() => null));

    return c.json(reorderTask(sqlite, db, actor, c.req.param('id'), body));
  });

  app.post('/:id/dependencies', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(DependencyBody, await c.req.json().catch(() => null));

    return c.json(
      addTaskDependency(sqlite, db, actor, c.req.param('id'), body.blocked_by_task_id),
      201,
    );
  });

  /**
   * Watch and unwatch (§6.4, LAI-143).
   *
   * `PUT`/`DELETE` rather than `POST`/`POST` because watching is **idempotent
   * state, not an event**: pressing Watch twice leaves one row, and `PUT` says
   * so. It also makes the `read_only` refusal obvious from the method alone —
   * §6.2 permits "every GET the user's role allows and nothing else".
   *
   * `204`, not the task: nothing about the task changed, and returning it would
   * invite a client to diff a body that is identical either way.
   */
  app.put('/:id/watch', (c) => {
    watchTask(db, requireActor(c), c.req.param('id'));
    return c.body(null, 204);
  });

  app.delete('/:id/watch', (c) => {
    unwatchTask(db, requireActor(c), c.req.param('id'));
    return c.body(null, 204);
  });

  /** Who is watching — implicit and explicit, filtered to who can still read it. */
  app.get('/:id/watchers', (c) =>
    c.json({ watchers: watchersOfTask(db, requireActor(c), c.req.param('id')) }),
  );

  app.delete('/:id/dependencies/:depId', (c) =>
    c.json(removeTaskDependency(db, requireActor(c), c.req.param('id'), c.req.param('depId'))),
  );

  return app;
}
