import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { AVAILABILITY_STATUSES } from '../../db/enums.ts';
import { ApiError } from '../../errors.ts';
import {
  addAwayPeriod,
  type AvailabilityView,
  deleteAwayPeriod,
  getMyAvailability,
  setMyAvailability,
} from '../../services/availability.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `GET`/`PUT /api/v1/me/availability`, `POST /me/availability/away` and
 * `DELETE /me/availability/away/:id` (SPEC §6.4, D-131, LAI-1130): a person's
 * own availability. Mounted at `/api/v1/me`.
 *
 * Transport only. The schemas check **types**; every limit — the hours, the
 * note's length, the tags, the working week, the away dates — is the
 * service's, which answers `422` with `details.field` and `details.reason`
 * naming what to fix. There is no path that names another person: whose
 * availability this is, is the session's.
 */

const WorkWeekBody = strictObject({
  days: z.array(z.number()).max(7),
  start: z.string().max(5).nullable(),
  end: z.string().max(5).nullable(),
});

const AvailabilityBody = strictObject({
  status: z.enum(AVAILABILITY_STATUSES).nullable().optional(),
  hours_per_week: z.number().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().max(200)).max(64).optional(),
  work_week: WorkWeekBody.nullable().optional(),
});

const AwayBody = strictObject({
  from: z.string().max(10),
  to: z.string().max(10),
});

const json = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> =>
  c.req.json().catch(() => null);

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function meAvailabilityRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/availability', (c) => {
    const actor = requireActor(c);
    return c.json<AvailabilityView>(getMyAvailability(db, actor));
  });

  app.put('/availability', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(AvailabilityBody, await json(c));
    return c.json<AvailabilityView>(setMyAvailability(db, actor, body));
  });

  app.post('/availability/away', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(AwayBody, await json(c));
    return c.json<AvailabilityView>(addAwayPeriod(db, actor, body), 201);
  });

  app.delete('/availability/away/:id', (c) => {
    const actor = requireActor(c);
    deleteAwayPeriod(db, actor, c.req.param('id'));
    return c.body(null, 204);
  });

  return app;
}
