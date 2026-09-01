import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getOrg } from '../../services/orgs.ts';
import { type AppEnv } from '../context.ts';

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

  return app;
}
