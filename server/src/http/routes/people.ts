import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { ACTIVITY_RANGES, getPeopleActivity } from '../../services/people-activity.ts';
import { type AppEnv } from '../context.ts';
import { parseQuery, strictObject, z } from '../validation.ts';

/**
 * `GET /api/v1/people/:id/activity?range=12w|52w` (SPEC §6.4, D-079, LAI-751):
 * the profile's heatmap, by day.
 *
 * Transport only. Who may ask — an owner or admin on a web session, as for the
 * profile (D-078) — is `services/people-activity.ts` asking `can()` before it
 * looks the person up.
 *
 * **Its own path, not a field of `/users/:id/profile`.** The profile counts
 * twelve weeks and is read whole on every visit; a year of days for three
 * sources is a different window and a different cost, asked for only when the
 * card is on the screen, once per range.
 */

const ActivityQuery = strictObject({
  range: z.enum(ACTIVITY_RANGES).default('12w'),
});

export function peopleRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:id/activity', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');

    const query = parseQuery(ActivityQuery, c.req.query());
    return c.json(getPeopleActivity(db, actor, c.req.param('id'), query.range));
  });

  return app;
}
