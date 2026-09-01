import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getCurrentUser, type MeProfile } from '../../services/me.ts';
import { tasksWatchedBy } from '../../services/watchers.ts';
import { type AppEnv } from '../context.ts';

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
