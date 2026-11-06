import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { countAnalyticsViews, listAnalyticsViews } from '../../services/analytics-views.ts';
import {
  type DeveloperSetupView,
  getDeveloperSetup,
  getOwnSetupActivity,
  type OwnSetupActivityView,
  revokeMemberAgent,
  revokeMemberDevice,
  type SetupToolView,
  type UnpairedDeviceView,
} from '../../services/developer-setup.ts';
import { ACTIVITY_RANGES, getPeopleActivity } from '../../services/people-activity.ts';
import {
  type AvailabilityListView,
  getPersonLoad,
  listPeopleAvailability,
  type PersonLoadView,
} from '../../services/people-load.ts';
import {
  getPersonDay,
  getPersonLocalActivity,
  getPersonSummary,
} from '../../services/people-analytics.ts';
import {
  createMemberEntry,
  deleteMemberEntry,
  listMemberRevisions,
  updateMemberEntry,
} from '../../services/time-member-entries.ts';
import { type AppEnv } from '../context.ts';
import { buildPage, parsePageQuery } from '../pagination.ts';
import { parseBody, parseParams, parseQuery, strictObject, z } from '../validation.ts';
import { PreviewQuery } from './local-activity.ts';
import { EntryBody, EntryPatchBody, MyDayQuery, SummaryQuery } from './time.ts';

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

export const ActivityQuery = strictObject({
  range: z.enum(ACTIVITY_RANGES).default('12w'),
});

/**
 * `GET /people/availability` (D-131, LAI-1130). **Strict, and no sort**: the
 * list is A–Z by name and nothing else (D-088 item 1), so `?sort=load` is a
 * `422` naming the key rather than an order quietly ignored.
 */
const AvailabilityQuery = strictObject({
  space: z.string().min(1).max(64).optional(),
  tag: z.string().min(1).max(64).optional(),
  open_only: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const PersonParams = z.object({ id: z.string().min(1).max(64) });
const EntryParams = z.object({
  id: z.string().min(1).max(64),
  entryId: z.string().min(1).max(64),
});

const json = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> =>
  c.req.json().catch(() => null);

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function peopleRoutes(options: { db: Db; sqlite: Database.Database }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, sqlite } = options;

  app.get('/availability', (c) => {
    const actor = requireActor(c);
    const query = parseQuery(AvailabilityQuery, c.req.query());
    return c.json<AvailabilityListView>(listPeopleAvailability(db, actor, query));
  });

  app.get('/:id/load', (c) => {
    const actor = requireActor(c);
    return c.json<PersonLoadView>(getPersonLoad(db, actor, c.req.param('id')));
  });

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

  // D-132, D-133 (LAI-1137): a member's whole developer setup, read by an
  // owner or admin and logged; and their revoke of one tool or one device.
  // No body: the confirm is the screen's, and what is revoked is the path.
  app.get('/:id/developer-setup', (c) => {
    const actor = requireActor(c);
    return c.json<DeveloperSetupView>(getDeveloperSetup(db, actor, c.req.param('id')));
  });

  app.post('/:id/agents/:agentId/revoke', (c) => {
    const actor = requireActor(c);
    return c.json<SetupToolView>(
      revokeMemberAgent(sqlite, db, actor, c.req.param('id'), c.req.param('agentId')),
    );
  });

  app.post('/:id/devices/:deviceId/revoke', (c) => {
    const actor = requireActor(c);
    return c.json<UnpairedDeviceView>(
      revokeMemberDevice(sqlite, db, actor, c.req.param('id'), c.req.param('deviceId')),
    );
  });

  // D-143 (LAI-1165): an owner or admin changes a member's confirmed time.
  // The bodies are `/me/time-entries`' own, so the two cannot accept
  // different things; who may is the service asking `can()`.
  app.post('/:id/time-entries', async (c) => {
    const actor = requireActor(c);
    const { id } = parseParams(PersonParams, c.req.param());
    const entry = parseBody(EntryBody, await json(c));
    return c.json(createMemberEntry(db, actor, id, entry), 201);
  });

  app.patch('/:id/time-entries/:entryId', async (c) => {
    const actor = requireActor(c);
    const { id, entryId } = parseParams(EntryParams, c.req.param());
    return c.json(
      updateMemberEntry(db, actor, id, entryId, parseBody(EntryPatchBody, await json(c))),
    );
  });

  app.delete('/:id/time-entries/:entryId', (c) => {
    const actor = requireActor(c);
    const { id, entryId } = parseParams(EntryParams, c.req.param());
    deleteMemberEntry(db, actor, id, entryId);
    return c.body(null, 204);
  });

  app.get('/:id/time-entries/:entryId/revisions', (c) => {
    const actor = requireActor(c);
    const { id, entryId } = parseParams(EntryParams, c.req.param());
    return c.json({ revisions: listMemberRevisions(db, actor, id, entryId) });
  });

  return app;
}

/**
 * `?since=` on *Who looked* (LAI-1150): unix ms, or an ISO 8601 date-time.
 * Absent means every look kept; anything else is `400`, as `updated_since`.
 */
function parseSince(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)
    ? Date.parse(raw)
    : NaN;
  if (Number.isNaN(at)) {
    throw ApiError.badRequest('since is a unix-millisecond timestamp or an ISO 8601 date-time', {
      since: raw,
    });
  }
  return at;
}

/**
 * `GET /api/v1/me/analytics-views?limit=&cursor=&since=` (D-102 rule 3,
 * LAI-957): who looked at the caller's analytics, newest first, each viewer
 * with their org role, and `total` — how many looks since `since` (LAI-1150).
 * Mounted at `/api/v1/me`.
 */
export function meAnalyticsViewRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/analytics-views', (c) => {
    const actor = requireActor(c);
    const { limit, cursor } = parsePageQuery(c.req.query());
    const since = parseSince(c.req.query('since'));
    const rows = listAnalyticsViews(db, actor, { limit, cursor, since });
    return c.json({
      ...buildPage(rows, limit, (row) => ({ sortKey: row.viewed_at, id: row.id })),
      total: countAnalyticsViews(db, actor, since),
    });
  });

  return app;
}

/**
 * `GET /api/v1/me/developer-setup/activity` (D-139, LAI-1151): the caller's
 * own last 30 days of setup activity, the items the admin read lists in
 * `activity[]`. Session only; no look. Mounted at `/api/v1/me`.
 */
export function meDeveloperSetupRoutes(options: { db: Db }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;

  app.get('/developer-setup/activity', (c) =>
    c.json<OwnSetupActivityView>(getOwnSetupActivity(db, requireActor(c))),
  );

  return app;
}
