import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { listUsers, type UserView } from '../../services/users.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince } from '../updated-since.ts';

/**
 * `GET /api/v1/users` (SPEC §6.4). Transport only — §3.1's cell and §4.1's
 * fields are decided in `services/users.ts`.
 *
 * §6.4 also lists `PATCH /api/v1/users/:id` for role changes and deactivation.
 * That is **not** built here: LAI-060 is about finding people who already exist,
 * and a write path nobody asked for is a permission surface with no product
 * behind it.
 *
 * The two unbuilt shapes answer differently, and both are correct:
 *
 *  - `POST`/`PATCH`/`DELETE` on **`/users`** → `405` with `Allow: GET`, because
 *    the path exists and only one method is allowed on it (D-021);
 *  - anything on **`/users/:id`** → `404`, because no route is registered there
 *    at all. "No such endpoint" is the honest answer for a path §6.4 specifies
 *    and no task has built.
 */

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** `?include_inactive=true|false`, absent meaning active people only. */
function parseIncludeInactive(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  throw ApiError.badRequest('include_inactive must be true or false', { include_inactive: raw });
}

export function userRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());

    const rows = listUsers(db, actor, {
      limit,
      cursor,
      updatedSince: parseUpdatedSince(c.req.query('updated_since')),
      includeInactive: parseIncludeInactive(c.req.query('include_inactive')),
    });

    // The cursor is `(name, id)`, matching the service's ORDER BY: a directory is
    // read alphabetically, not by when a row last changed.
    const page: Page<UserView> = buildPage(rows, limit, (row) => ({
      sortKey: row.name,
      id: row.id,
    }));

    return c.json(page);
  });

  return app;
}
