import { Hono } from 'hono';
import { getCurrentUser, type MeProfile } from '../../services/me.ts';
import { type AppEnv } from '../context.ts';

export { type MeProfile };

/**
 * `GET /api/v1/me` (SPEC §6.4).
 *
 * Transport only: pull the actor off the context, hand it to the service, return
 * JSON. Every decision — including "not signed in" — lives in
 * `services/me.ts`, so the M3 MCP tool gets identical behaviour by calling the
 * same function rather than by reimplementing it (CONVENTIONS §2).
 *
 * Unauthenticated by nature: the service answers `unauthorized` rather than the
 * route guarding first, so there is exactly one place that decides.
 */
export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json<MeProfile>(getCurrentUser(c.get('actor'))));

  return app;
}
