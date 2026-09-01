import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  listUsers,
  ORG_ROLES,
  setOrgRole,
  setUserActive,
  type UserView,
} from '../../services/users.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery, type Page } from '../pagination.ts';
import { parseUpdatedSince } from '../updated-since.ts';
import { parseBody, strictObject, z } from '../validation.ts';

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

const UserPatchBody = strictObject({
  org_role: z.enum(ORG_ROLES).optional(),
  is_active: z.boolean().optional(),
});

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

  /**
   * `PATCH /api/v1/users/:id` — org role and active state (§6.4, §3.1, LAI-222).
   *
   * §3.1 has granted *"Invite users / change org roles"* and *"Deactivate user"*
   * since the matrix was written, and `users` has carried `org_role` and
   * `is_active` since LAI-003 — but no route wrote either, so both permissions
   * were real and unreachable.
   *
   * **Two fields, two `can()` calls, applied per field.** They are different
   * §3.1 rows: `user.set_role` carries the *"(not to Owner)"* caveat for an
   * Admin, `user.deactivate` does not. One combined check would grade the weaker
   * request by the stronger rule or the reverse, and both are wrong.
   *
   * At least one field is required: `PATCH {}` is a request that asks for
   * nothing, and answering `200` to it would report a change that did not
   * happen.
   */
  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(UserPatchBody, await c.req.json().catch(() => null));
    const id = c.req.param('id');

    if (body.org_role === undefined && body.is_active === undefined) {
      throw ApiError.badRequest('Give at least one of org_role or is_active', {});
    }

    let view = body.org_role === undefined ? undefined : setOrgRole(db, actor, id, body.org_role);
    if (body.is_active !== undefined) view = setUserActive(db, actor, id, body.is_active);

    return c.json(view!);
  });

  return app;
}
