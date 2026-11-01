import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { getOwnDevice, listOwnDevices, type DeviceView } from '../../services/devices.ts';
import { type AppEnv } from '../context.ts';

/**
 * `GET /api/v1/devices` and `GET /api/v1/devices/:id` (SPEC §4.78, §6.4,
 * LAI-1045). Transport only; `services/devices.ts` holds the rules.
 */

export interface DeviceRouteOptions {
  db: Db;
}

function requireActor(c: { get: (k: 'actor') => AppEnv['Variables']['actor'] }) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

export function deviceRoutes(options: DeviceRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) =>
    c.json<{ data: DeviceView[] }>({ data: listOwnDevices(options.db, requireActor(c)) }),
  );

  app.get('/:id', (c) =>
    c.json<DeviceView>(getOwnDevice(options.db, requireActor(c), c.req.param('id'))),
  );

  return app;
}
