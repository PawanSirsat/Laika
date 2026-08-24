import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  listOrgActivity,
  listProjectActivity,
  type ListActivityOptions,
} from '../../services/activity.ts';
import { type EventView } from '../../services/events.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';

/**
 * Reading `activity` (SPEC §6.4). Transport only.
 *
 * **`GET` and nothing else.** §4.8 is append-only, so there is no `POST`, `PATCH`
 * or `DELETE` here — and because the app answers a method mismatch on a known
 * path with `405` and an `Allow` header (D-021), a client that tries one is told
 * so rather than getting a confusing `404`.
 */

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** `?since=` — unix-ms, inclusive, and a bad value is an error rather than ignored. */
function parseSince(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;

  if (!/^\d+$/.test(raw)) {
    throw ApiError.badRequest('since must be a unix-ms timestamp', { since: raw });
  }

  return Number(raw);
}

function optionsFrom(query: Record<string, string | undefined>): ListActivityOptions {
  const { limit, cursor } = parsePageQuery(query);

  return {
    limit,
    cursor,
    ...(parseSince(query.since) === undefined ? {} : { since: parseSince(query.since) }),
    ...(query.task_id === undefined || query.task_id === '' ? {} : { taskId: query.task_id }),
  };
}

/**
 * The cursor is `(created_at, seq)` and the order is **descending** — the newest
 * row is the first one returned, because a feed is scanned from the top. Comments
 * come back oldest-first (LAI-047); the difference is deliberate.
 *
 * `seq` and not the row id: several `activity` rows share a millisecond as a
 * matter of course, and a ULID is random within one, so the id is not a
 * tiebreaker at all here. The cursor is opaque, so this costs a client nothing.
 */
function pageOf(rows: EventView[], limit: number): Page<EventView> {
  return buildPage(rows, limit, (row) => ({ sortKey: row.created_at, id: String(row.seq) }));
}

export interface ActivityRouteOptions {
  db: Db;
}

/** Mounted at `/api/v1/projects` — one project's feed. */
export function projectActivityRoutes(options: ActivityRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:slug/activity', (c) => {
    const actor = requireActor(c);
    const listOptions = optionsFrom(c.req.query());

    return c.json(
      pageOf(listProjectActivity(db, actor, c.req.param('slug'), listOptions), listOptions.limit),
    );
  });

  return app;
}

/** Mounted at `/api/v1/activity` — the org-wide feed. */
export function activityRoutes(options: ActivityRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const listOptions = optionsFrom(c.req.query());

    return c.json(pageOf(listOrgActivity(db, actor, listOptions), listOptions.limit));
  });

  return app;
}
