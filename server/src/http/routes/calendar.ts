import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  backfillCalendar,
  type CalendarBackfillView,
  type CalendarSourceView,
  disconnectCalendar,
  getCalendarSource,
  saveCalendarSource,
  syncCalendarNow,
  testCalendarSource,
} from '../../services/calendar-source.ts';
import { CALENDAR_RULE_KINDS, type CalendarSyncDeps } from '../../services/calendar-sync.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * The organisation's Outlook calendar connection (§6.4, D-157, LAI-1316),
 * mounted on `/api/v1/org`.
 *
 * Transport only (CONVENTIONS §2): who may, and every rule, is the services'.
 * Every route is `org.calendar.configure`, signed in. `/calendar/test`,
 * `/calendar/sync` and `/calendar/backfill` spend their own rate-limit bucket
 * (`calendar:<who>`, 6 a minute) — each calls Microsoft.
 *
 * **The client secret is in one request body and nowhere else**: validated,
 * handed to the service, and not logged — the request logger records the
 * path and the status only.
 */

const SaveBody = strictObject({
  tenant_id: z.string().trim().min(1).max(100),
  client_id: z.string().trim().min(1).max(100),
  client_secret: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean(),
  rules: z
    .array(
      strictObject({
        kind: z.enum(CALENDAR_RULE_KINDS),
        text: z.string().trim().min(1).max(120),
        project: z.string().min(1).max(100),
      }),
    )
    // A sanity bound, looser than the service's own `too_many_rules`, which
    // says the limit (LAI-159: never as tight as the service's).
    .max(500),
});

const BackfillBody = strictObject({
  // Any number: the service says the bounds, and a fraction, by name
  // (`days_out_of_range`, LAI-159).
  days: z.number(),
});

export interface CalendarRouteOptions {
  db: Db;
  /** `LAIKA_SECRET`, for §12's encryption of the client secret. */
  serverSecret: string;
  /** Microsoft's `fetch` and the clock — injected by the tests, so none calls Microsoft. */
  calendarSync?: CalendarSyncDeps | undefined;
}

export function calendarRoutes(options: CalendarRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;

  /** The deps for one request: the app's, with the request's logger for background runs. */
  function depsFor(log: CalendarSyncDeps['log']): CalendarSyncDeps {
    return { ...options.calendarSync, log: options.calendarSync?.log ?? log };
  }

  app.get('/calendar', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<CalendarSourceView>(getCalendarSource(db, actor));
  });

  app.put('/calendar', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(SaveBody, await c.req.json().catch(() => null));
    return c.json<CalendarSourceView>(
      saveCalendarSource(db, actor, serverSecret, body, depsFor(c.get('log'))),
    );
  });

  app.post('/calendar/test', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<CalendarSourceView>(
      await testCalendarSource(db, actor, serverSecret, depsFor(c.get('log'))),
    );
  });

  app.post('/calendar/sync', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<CalendarSourceView>(
      await syncCalendarNow(db, actor, serverSecret, depsFor(c.get('log'))),
    );
  });

  app.post('/calendar/backfill', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(BackfillBody, await c.req.json().catch(() => null));
    return c.json<CalendarBackfillView>(
      await backfillCalendar(db, actor, serverSecret, body, depsFor(c.get('log'))),
    );
  });

  app.delete('/calendar', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    disconnectCalendar(db, actor);
    return c.body(null, 204);
  });

  return app;
}
