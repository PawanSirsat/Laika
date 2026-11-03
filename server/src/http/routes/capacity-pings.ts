import { Hono, type Context } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError, isApiError } from '../../errors.ts';
import { getPing, type CapacityPingView } from '../../services/agent-capacity.ts';
import { type AppEnv } from '../context.ts';

/**
 * `GET /api/v1/capacity-pings/:id` (SPEC §6.4, §4.84, D-126, LAI-1038): one
 * capacity ping, to whoever pinged and to the pinged agent's owner — anyone
 * else, and an id that names nothing, the same `404`. Making a ping is
 * `POST /agents/:id/capacity-pings` and answering one is
 * `POST /agents/me/capacity-pings/:id/reply`; both live with the agents.
 * Transport only: `services/agent-capacity.ts` asks `can()`.
 */

export interface CapacityPingRouteOptions {
  db: Db;
}

/**
 * Run `fn`; a service's `429` leaves with `Retry-After` (§6.3), as the
 * general budget's does — the service knows how long, only the route can set
 * a header.
 */
export async function withRetryAfter<T>(c: Context<AppEnv>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isApiError(error) && error.code === 'rate_limited') {
      const seconds = (error.details as { retry_after_seconds?: unknown } | null)
        ?.retry_after_seconds;
      if (typeof seconds === 'number') c.header('Retry-After', String(seconds));
    }
    throw error;
  }
}

/** Mounted at `/api/v1/capacity-pings`. */
export function capacityPingRoutes(options: CapacityPingRouteOptions): Hono<AppEnv> {
  const { db } = options;
  const app = new Hono<AppEnv>();

  app.get('/:id', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<{ ping: CapacityPingView }>({ ping: getPing(db, actor, c.req.param('id')) });
  });

  return app;
}
