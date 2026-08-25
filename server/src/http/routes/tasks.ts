import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addTaskDependency,
  changeStatus,
  claimTask,
  createTask,
  getTask,
  listTasks,
  removeTaskDependency,
  updateTask,
  type TaskView,
} from '../../services/tasks.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince } from '../updated-since.ts';
import { MAX_TAGS_PER_TASK } from '../../services/tags.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Tasks (SPEC §6.4). Transport only — §5's transition rules and §4.5's readiness
 * computation live in `services/`, so the M3 MCP tools get identical behaviour by
 * calling the same functions (CONVENTIONS §2).
 */

const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'] as const;
const PRIORITIES = ['p1', 'p2', 'p3'] as const;

/**
 * Acceptance is prose, and shorter than a description on purpose: it answers
 * "what does done mean here", not "what is this about". 10k is generous for
 * that and small enough that nobody pastes a spec into it (LAI-092).
 */
const ACCEPTANCE_MAX = 10_000;

const CreateBody = strictObject({
  title: z.string().trim().min(1).max(300),
  description_md: z.string().max(100_000).optional(),
  acceptance_md: z.string().max(ACCEPTANCE_MAX).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(MAX_TAGS_PER_TASK).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  assignee_id: z.string().min(1).optional(),
  discovered_from: z.string().min(1).optional(),
  created_via: z.enum(['web', 'mcp', 'api', 'webhook', 'meeting']).optional(),
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
  tags: z.array(z.string().trim().min(1).max(64)).max(MAX_TAGS_PER_TASK).optional(),
  priority: z.enum(PRIORITIES).optional(),
  // `null` unassigns; absent leaves it alone. They are different requests.
  assignee_id: z.string().min(1).nullable().optional(),
});

const StatusBody = strictObject({ status: z.enum(STATUSES) });
const DependencyBody = strictObject({ depends_on_task_id: z.string().min(1) });

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

    const rows = listTasks(db, actor, c.req.param('slug'), {
      limit,
      cursor,
      updatedSince: parseUpdatedSince(c.req.query('updated_since')),
      ...(c.req.query('tag') === undefined || c.req.query('tag') === ''
        ? {}
        : { tag: c.req.query('tag') }),
      status: parseEnum(c.req.query('status'), STATUSES, 'status'),
      priority: parseEnum(c.req.query('priority'), PRIORITIES, 'priority'),
      assignee: c.req.query('assignee'),
      sprint: c.req.query('sprint'),
      ready: parseReady(c.req.query('ready')),
    });

    const page: Page<TaskView> = buildPage(rows, limit, (row) => ({
      sortKey: row.updated_at,
      id: row.id,
    }));

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

  app.get('/:id', (c) => c.json(getTask(db, requireActor(c), c.req.param('id'))));

  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(UpdateBody, await c.req.json().catch(() => null));

    return c.json(updateTask(db, actor, c.req.param('id'), body));
  });

  app.post('/:id/claim', (c) => c.json(claimTask(sqlite, db, requireActor(c), c.req.param('id'))));

  app.post('/:id/status', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(StatusBody, await c.req.json().catch(() => null));

    return c.json(changeStatus(db, actor, c.req.param('id'), body.status));
  });

  app.post('/:id/dependencies', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(DependencyBody, await c.req.json().catch(() => null));

    return c.json(
      addTaskDependency(sqlite, db, actor, c.req.param('id'), body.depends_on_task_id),
      201,
    );
  });

  app.delete('/:id/dependencies/:depId', (c) =>
    c.json(removeTaskDependency(db, requireActor(c), c.req.param('id'), c.req.param('depId'))),
  );

  return app;
}
