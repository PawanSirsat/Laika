import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getCurrentUser, type MeProfile } from '../../services/me.ts';
import {
  listNotices,
  markAllNoticesRead,
  markNoticeRead,
  unreadNoticeCount,
} from '../../services/notices.ts';
import { tasksWatchedBy } from '../../services/watchers.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery } from '../pagination.ts';
import { parseQuery, strictObject, z } from '../validation.ts';

export { type MeProfile };

/**
 * `GET /api/v1/me` (SPEC §6.4).
 *
 * Transport only: pull the actor off the context, hand it to the service, return
 * JSON. Every decision — including "not signed in" — lives in
 * `services/me.ts`, so the M3 MCP tool gets identical behaviour by calling the
 * same function rather than by reimplementing it (CONVENTIONS §2).
 *
 * Unauthenticated by nature: the service answers `unauthorized` rather than the
 * route guarding first, so there is exactly one place that decides.
 */
export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json<MeProfile>(getCurrentUser(c.get('actor'))));

  return app;
}

export interface MeWatchRouteOptions {
  db: Db;
}

/**
 * `GET /api/v1/me/watching` (§6.4, LAI-143).
 *
 * **A second router on the same prefix, rather than a `db` on `meRoutes`.**
 * `GET /me` is mounted before the database is known to exist — it answers "who
 * am I", which is meaningful on an instance with no database at all — and giving
 * it a required `db` would move it behind that guard and change what a
 * half-configured instance can answer. `/users` already carries two routers for
 * the same reason.
 *
 * **Under `/me`, not `/users/:id/watching`, and that is the permission.** What
 * somebody else is paying attention to is not something §3 grants anybody the
 * right to read, so there is no path that could express the request. The service
 * refuses a foreign id as well — this route simply has no way to ask.
 *
 * **This one guards, where `GET /me` deliberately does not.** `getCurrentUser`
 * is null-tolerant because "who am I" has an answer when nobody is signed in;
 * "what do I watch" does not.
 */
export function meWatchRoutes(options: MeWatchRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/watching', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    return c.json({ task_ids: tasksWatchedBy(options.db, actor) });
  });

  return app;
}

const NoticesQuery = strictObject({
  unread: z.enum(['true', 'false']).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

/**
 * `GET /api/v1/me/notices?unread=&limit=&cursor=`, `POST /me/notices/:id/read`
 * and `POST /me/notices/read-all` (§6.4, D-134, LAI-1136): the caller's own
 * notices, newest first, with how many are unread in all.
 *
 * Transport only. Every one is `notices.own`, session only, asked by
 * `services/notices.ts`; no path here names anybody else's.
 */
export function meNoticeRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/notices', (c) => {
    const actor = requireActor(c.get('actor'));
    const query = parseQuery(NoticesQuery, c.req.query());
    const { limit, cursor } = parsePageQuery(query);
    const rows = listNotices(db, actor, { limit, cursor, unread: query.unread === 'true' });
    return c.json({
      ...buildPage(rows, limit, (row) => ({ sortKey: row.created_at, id: row.id })),
      unread_count: unreadNoticeCount(db, actor),
    });
  });

  // Registered before `/:id/read` so `read-all` is never taken for an id.
  app.post('/notices/read-all', (c) => {
    markAllNoticesRead(db, requireActor(c.get('actor')));
    return c.body(null, 204);
  });

  app.post('/notices/:id/read', (c) => {
    markNoticeRead(db, requireActor(c.get('actor')), c.req.param('id'));
    return c.body(null, 204);
  });

  return app;
}

function requireActor(
  actor: AppEnv['Variables']['actor'],
): NonNullable<AppEnv['Variables']['actor']> {
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}
