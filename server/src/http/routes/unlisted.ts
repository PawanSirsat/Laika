import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  dismissUnlisted,
  listUnlisted,
  promoteUnlisted,
  TASK_PRIORITIES,
  type UnlistedView,
} from '../../services/unlisted.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `/api/v1/unlisted` (SPEC §6.4, §4.14, D-024).
 *
 * Transport only. Who may read the pile, what promoting does to the row, and
 * whether a second dismiss is an error all live in `services/unlisted.ts` —
 * which is also what LAI-408's `log_unlisted_work` tool will reach, so the two
 * sides of §4.14 cannot disagree.
 */

const PromoteBody = strictObject({
  project_slug: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  priority: z.enum(TASK_PRIORITIES).optional(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** `?include_dismissed=true|false`, absent meaning the untriaged pile only. */
function parseIncludeDismissed(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  throw ApiError.badRequest('include_dismissed must be true or false', {
    include_dismissed: raw,
  });
}

/** `?since=` — unix-ms, the same shape §6.3's `updated_since` uses. */
function parseSince(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw ApiError.badRequest('since must be a unix-ms timestamp', { since: raw });
  }
  return value;
}

export interface UnlistedRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

export function unlistedRoutes(options: UnlistedRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());

    const rows = listUnlisted(db, actor, {
      limit,
      cursor,
      userId: c.req.query('user'),
      since: parseSince(c.req.query('since')),
      includeDismissed: parseIncludeDismissed(c.req.query('include_dismissed')),
    });

    // Newest first, so the cursor is `(created_at, id)` — the order the service
    // sorts in, not the `(updated_at, id)` most other lists use.
    const page: Page<UnlistedView> = buildPage(rows, limit, (row) => ({
      sortKey: row.created_at,
      id: row.id,
    }));

    return c.json(page);
  });

  app.post('/:id/promote', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(PromoteBody, await c.req.json().catch(() => null));

    const result = promoteUnlisted(sqlite, db, actor, c.req.param('id'), {
      projectSlug: body.project_slug,
      title: body.title,
      ...(body.priority === undefined ? {} : { priority: body.priority }),
    });

    // 201: this created a task. The note is returned beside it so a client does
    // not have to re-read the pile to see that the row is now spoken for.
    return c.json(result, 201);
  });

  app.delete('/:id', (c) => {
    const actor = requireActor(c);
    dismissUnlisted(db, actor, c.req.param('id'));

    return c.body(null, 204);
  });

  return app;
}
