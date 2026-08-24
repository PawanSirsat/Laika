import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addTasksToSprint,
  createSprint,
  deleteSprint,
  getSprint,
  listSprints,
  removeTaskFromSprint,
  updateSprint,
  type SprintView,
} from '../../services/sprints.ts';
import { type TaskView } from '../../services/tasks.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince } from '../updated-since.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Sprints (SPEC §6.4). Transport only — §4.15's rules live in
 * `services/sprints.ts`, so the M3 MCP tools get them by calling the same
 * functions (CONVENTIONS §2).
 */

const STATUSES = ['planned', 'active', 'completed'] as const;

/**
 * Unix-ms, and required to be an integer.
 *
 * `starts_on`/`ends_on` carry date-only semantics (§4.15), so a fractional
 * millisecond is always a client bug — usually a `Date` that was divided or
 * multiplied one time too many. Rejecting it is cheaper than storing it.
 */
const Timestamp = z.number().int().finite();

const Name = z.string().trim().min(1).max(120);
const Goal = z.string().trim().max(500);

const CreateBody = strictObject({
  name: Name,
  goal: Goal.nullable().optional(),
  starts_on: Timestamp,
  ends_on: Timestamp,
  status: z.enum(STATUSES).optional(),
});

const UpdateBody = strictObject({
  name: Name.optional(),
  // `null` clears the goal; absent leaves it alone. Different requests.
  goal: Goal.nullable().optional(),
  starts_on: Timestamp.optional(),
  ends_on: Timestamp.optional(),
  status: z.enum(STATUSES).optional(),
});

const AssignBody = strictObject({
  task_ids: z.array(z.string().min(1)).min(1).max(500),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export interface SprintRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

/** Mounted at `/api/v1/projects` — sprints belong to a project (§6.4). */
export function projectSprintRoutes(options: SprintRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:slug/sprints', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());
    const status = c.req.query('status');

    if (
      status !== undefined &&
      status !== '' &&
      !(STATUSES as readonly string[]).includes(status)
    ) {
      throw ApiError.badRequest(`status must be one of ${STATUSES.join(', ')}`, { status });
    }

    const rows = listSprints(db, actor, c.req.param('slug'), {
      limit,
      cursor,
      updatedSince: parseUpdatedSince(c.req.query('updated_since')),
      status: status === undefined || status === '' ? undefined : (status as SprintView['status']),
    });

    // The cursor is `(starts_on, id)`, matching the service's ORDER BY — a sprint
    // list is a calendar, so it is ordered by date rather than by `updated_at`.
    const page: Page<SprintView> = buildPage(rows, limit, (row) => ({
      sortKey: row.starts_on,
      id: row.id,
    }));

    return c.json(page);
  });

  app.post('/:slug/sprints', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateBody, await c.req.json().catch(() => null));

    return c.json(createSprint(sqlite, db, actor, c.req.param('slug'), body), 201);
  });

  return app;
}

/** Mounted at `/api/v1/sprints` — sprints are addressed by ULID (§6.4). */
export function sprintRoutes(options: SprintRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/:id', (c) => c.json(getSprint(db, requireActor(c), c.req.param('id'))));

  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(UpdateBody, await c.req.json().catch(() => null));

    return c.json(updateSprint(sqlite, db, actor, c.req.param('id'), body));
  });

  app.delete('/:id', (c) => {
    deleteSprint(sqlite, db, requireActor(c), c.req.param('id'));
    // 204: the sprint is gone and its tasks are unchanged apart from the field
    // that pointed at it. There is no representation worth returning.
    return c.body(null, 204);
  });

  app.post('/:id/tasks', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(AssignBody, await c.req.json().catch(() => null));

    const tasks = addTasksToSprint(sqlite, db, actor, c.req.param('id'), body.task_ids);

    // `{ tasks }`, not the §6.3 page envelope: this is an action's result, not a
    // list endpoint, and a `data` key with no `next_cursor` beside it invites a
    // client to page through something that does not paginate.
    return c.json({ tasks } satisfies { tasks: TaskView[] });
  });

  app.delete('/:id/tasks/:taskId', (c) =>
    c.json(
      removeTaskFromSprint(sqlite, db, requireActor(c), c.req.param('id'), c.req.param('taskId')),
    ),
  );

  return app;
}
