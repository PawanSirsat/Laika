import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addHoliday,
  type HolidayListView,
  type HolidayView,
  listHolidays,
  removeHoliday,
} from '../../services/holidays.ts';
import {
  connectHr,
  disconnectHr,
  getHrSource,
  type HrSourceView,
  setHrPeople,
  syncHrNow,
} from '../../services/hr-source.ts';
import { type HrSyncDeps } from '../../services/hr-sync.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, parseQuery, strictObject, z } from '../validation.ts';

/**
 * The organisation's HR connection and holidays (§6.4, D-149, LAI-1181),
 * mounted on `/api/v1/org`.
 *
 * Transport only (CONVENTIONS §2): who may, and every rule, is the services'.
 * `/hr*` is `org.hr.configure`, signed in; reading holidays is any member's
 * (`org.read`), typing or removing one is `org.time.set`. `/hr/connect` and
 * `/hr/sync` spend their own rate-limit bucket (`hr:<who>`, 6 a minute) —
 * each calls Clan, and a loop must not have Laika hammer it.
 *
 * **The token is in one request body and nowhere else**: validated, handed
 * to the service, and not logged — the request logger records the path and
 * the status only. Laika never takes a password (D-149 item 1).
 */

const ConnectBody = strictObject({
  base_url: z.string().trim().min(1).max(500),
  token: z.string().trim().min(8).max(2000),
  expires_on: z.string().min(1).max(10).optional(),
});

const PeopleBody = strictObject({
  people: z
    .array(
      strictObject({
        external_id: z.string().min(1).max(100),
        user_id: z.string().min(1).max(100).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

const HolidaysQuery = strictObject({
  from: z.string().min(1).max(10),
  to: z.string().min(1).max(10),
});

const HolidayBody = strictObject({
  day: z.string().min(1).max(10),
  label: z.string().trim().min(1).max(120),
});

export interface HrRouteOptions {
  db: Db;
  /** `LAIKA_SECRET`, for §12's encryption of the token. */
  serverSecret: string;
  /** Clan's `fetch` and the clock — injected by the tests, so none calls Clan. */
  hrSync?: HrSyncDeps | undefined;
}

export function hrRoutes(options: HrRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;

  /** The deps for one request: the app's, with the request's logger for background runs. */
  function depsFor(log: HrSyncDeps['log']): HrSyncDeps {
    return { ...options.hrSync, log: options.hrSync?.log ?? log };
  }
  /** The tests' clock when they hold one. */
  const clock = (): number => options.hrSync?.now?.() ?? Date.now();

  app.get('/hr', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<HrSourceView>(getHrSource(db, actor, clock()));
  });

  app.post('/hr/connect', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(ConnectBody, await c.req.json().catch(() => null));
    return c.json<HrSourceView>(
      await connectHr(db, actor, serverSecret, body, depsFor(c.get('log'))),
    );
  });

  app.delete('/hr', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    disconnectHr(db, actor);
    return c.body(null, 204);
  });

  app.post('/hr/sync', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<HrSourceView>(await syncHrNow(db, actor, serverSecret, depsFor(c.get('log'))));
  });

  app.put('/hr/people', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(PeopleBody, await c.req.json().catch(() => null));
    return c.json<HrSourceView>(setHrPeople(db, actor, body, clock()));
  });

  app.get('/holidays', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const query = parseQuery(HolidaysQuery, c.req.query());
    return c.json<HolidayListView>(listHolidays(db, actor, query));
  });

  app.post('/holidays', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(HolidayBody, await c.req.json().catch(() => null));
    return c.json<HolidayView>(addHoliday(db, actor, body, clock()), 201);
  });

  app.delete('/holidays/:id', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    removeHoliday(db, actor, c.req.param('id'), clock());
    return c.body(null, 204);
  });

  return app;
}
