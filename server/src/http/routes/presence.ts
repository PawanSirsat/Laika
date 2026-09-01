import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { capacityNow, presenceNow } from '../../services/presence.ts';
import { type AppEnv } from '../context.ts';

/**
 * `GET /api/v1/presence` and `GET /api/v1/capacity` (SPEC §9.3, LAI-432).
 *
 * Transport only. Both are computed at request time and store nothing, and both
 * carry `enabled` so a client can render §11.4.2's **disabled** state rather
 * than inferring it from an empty list — see `services/presence.ts`.
 */

export interface PresenceRouteOptions {
  db: Db;
}

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function presenceRoutes(options: PresenceRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json(presenceNow(options.db, requireActor(c))));

  return app;
}

export function capacityRoutes(options: PresenceRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json(capacityNow(options.db, requireActor(c))));

  return app;
}
