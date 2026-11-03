import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  getOwnDevice,
  listOwnDevices,
  renameOwnDevice,
  type DeviceView,
} from '../../services/devices.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `GET /api/v1/devices`, `GET /api/v1/devices/:id` (SPEC §4.78, §6.4,
 * LAI-1045) and `PATCH /api/v1/devices/:id` (LAI-1095). Transport only;
 * `services/devices.ts` holds the rules.
 */

export interface DeviceRouteOptions {
  db: Db;
  sqlite: Database.Database;
}

// Long enough to reach the service's own 1-to-80 rule, which says why.
const RenameBody = strictObject({ display_name: z.string().max(200) });

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

  app.patch('/:id', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(RenameBody, await c.req.json().catch(() => null));
    return c.json<DeviceView>(
      renameOwnDevice(options.sqlite, options.db, actor, c.req.param('id'), body.display_name),
    );
  });

  return app;
}
