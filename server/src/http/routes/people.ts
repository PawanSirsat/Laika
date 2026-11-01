import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { listAnalyticsViews } from '../../services/analytics-views.ts';
import { ACTIVITY_RANGES, getPeopleActivity } from '../../services/people-activity.ts';
import {
  getPersonDay,
  getPersonLocalActivity,
  getPersonSummary,
} from '../../services/people-analytics.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery } from '../pagination.ts';
import { parseQuery, strictObject, z } from '../validation.ts';
import { PreviewQuery } from './local-activity.ts';
import { MyDayQuery, SummaryQuery } from './time.ts';

/**
 * `GET /api/v1/people/:id/activity?range=12w|52w` (SPEC §6.4, D-079, LAI-751):
 * the profile's heatmap, by day. `GET /api/v1/people/:id/time` and
 * `…/local-activity` (D-102, LAI-957): the person's own `/me/time` and
 * `/me/local-activity`, read for them, each read logged.
 *
 * Transport only. Who may ask — an owner, or a role granted *See everyone's
 * analytics*, on a web session (D-078, D-102) — is the services asking
 * `can()` before they look the person up. The query schemas are the `/me`
 * routes' own, so the two cannot accept different things.
 *
 * **Its own path, not a field of `/users/:id/profile`.** The profile counts
 * twelve weeks and is read whole on every visit; a year of days for three
 * sources is a different window and a different cost, asked for only when the
 * card is on the screen, once per range.
 */

const ActivityQuery = strictObject({
  range: z.enum(ACTIVITY_RANGES).default('12w'),
});

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function peopleRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/:id/activity', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(ActivityQuery, c.req.query());
    return c.json(getPeopleActivity(db, actor, c.req.param('id'), query.range));
  });

  app.get('/:id/time', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(MyDayQuery, c.req.query());
    return c.json(getPersonDay(db, actor, c.req.param('id'), query));
  });

  app.get('/:id/time/summary', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(SummaryQuery, c.req.query());
    return c.json(getPersonSummary(db, actor, c.req.param('id'), query));
  });

  app.get('/:id/local-activity', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(PreviewQuery, c.req.query());
    return c.json(getPersonLocalActivity(db, actor, c.req.param('id'), query.days));
  });

  return app;
}

/**
 * `GET /api/v1/me/analytics-views?limit=&cursor=` (D-102 rule 3, LAI-957): who
 * looked at the caller's analytics, newest first. Mounted at `/api/v1/me`.
 */
export function meAnalyticsViewRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/analytics-views', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());
    const rows = listAnalyticsViews(db, actor, { limit, cursor });
    return c.json(buildPage(rows, limit, (row) => ({ sortKey: row.viewed_at, id: row.id })));
  });

  return app;
}
