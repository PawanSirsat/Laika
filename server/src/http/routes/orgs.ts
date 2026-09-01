import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getOrg, updateOrg } from '../../services/orgs.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

const OrgPatchBody = strictObject({ presence_enabled: z.boolean().optional() });

/**
 * `GET /api/v1/org` (SPEC §6.4, LAI-222).
 *
 * Transport only — which fields are safe to return, and at what grade, is
 * decided in `services/orgs.ts` (CONVENTIONS §2).
 *
 * **Singular, not `/orgs`.** Laika is single-org (D-022), so there is no
 * collection to list and a plural path would promise one. §6.4 names it `/org`.
 */

export interface OrgRouteOptions {
  db: Db;
}

export function orgRoutes(options: OrgRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    return c.json(getOrg(db, actor));
  });

  /**
   * `PATCH /api/v1/org` (§6.4, §3.1, LAI-207).
   *
   * Strict body, so a key this does not yet handle is a `422` rather than a
   * silently discarded setting — the failure LAI-106 removed the first-boot
   * toggle to avoid.
   */
  app.patch('/', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    const body = parseBody(OrgPatchBody, await c.req.json().catch(() => null));
    if (body.presence_enabled === undefined) {
      throw ApiError.badRequest('Give at least one setting to change', {});
    }

    return c.json(updateOrg(db, actor, body));
  });

  return app;
}
