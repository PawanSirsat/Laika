import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getPersonUsage, getUsage, USAGE_RANGE_DAYS_MAX } from '../../services/token-usage.ts';
import { type AppEnv } from '../context.ts';
import { parseQuery, strictObject, z } from '../validation.ts';

/**
 * Token usage, read back (SPEC §6.4, D-084, LAI-769): `GET /usage` for the
 * Usage page and `GET /users/:id/usage` for the profile card.
 *
 * Transport only. Who sees what — owners and admins everyone, a developer
 * their own, a member a project's totals, a token nothing per person — is
 * `services/token-usage.ts` asking `can()`. The report that fills them is the
 * collector's, on `PUT /me/local-activity` (`routes/local-activity.ts`).
 */

const UsageQuery = strictObject({
  days: z.coerce.number().int().min(1).max(USAGE_RANGE_DAYS_MAX).optional(),
  project: z.string().min(1).max(64).optional(),
  tz: z.string().min(1).max(64).optional(),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** `GET /usage?days=&project=&tz=` — mounted at `/api/v1/usage`. */
export function usageRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(UsageQuery, c.req.query());
    return c.json(getUsage(db, actor, query));
  });

  return app;
}

/** `GET /users/:id/usage` — mounted at `/api/v1/users`, beside the profile. */
export function userUsageRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:id/usage', (c) => {
    const actor = requireActor(c);
    return c.json(getPersonUsage(db, actor, c.req.param('id')));
  });

  return app;
}
