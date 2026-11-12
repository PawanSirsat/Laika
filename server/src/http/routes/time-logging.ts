import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getTimeLogging, type TimeLoggingView } from '../../services/time-logging.ts';
import { type AppEnv } from '../context.ts';
import { parseQuery, strictObject, z } from '../validation.ts';

/**
 * `GET /api/v1/time/days` (D-148, LAI-1175): the Time logging grid — people
 * by day over a stretch, for owners, analytics readers and space admins.
 *
 * Transport only. The scope, every refusal — `403` by the action,
 * `session_required`, `range_too_long`, `range_backwards` — and the looks it
 * logs are the service's, asked of `can()`.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day is YYYY-MM-DD');

export const TimeLoggingQuery = strictObject({ from: day, to: day });

export function timeLoggingRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/days', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const query = parseQuery(TimeLoggingQuery, c.req.query());
    return c.json<TimeLoggingView>(getTimeLogging(db, actor, query));
  });

  return app;
}
