import { createMiddleware } from 'hono/factory';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { setupRequired } from '../../services/setup.ts';
import { type AppEnv } from '../context.ts';

/** Where an un-set-up instance sends a browser. */
export const SETUP_PATH = '/setup';

/**
 * Paths that must keep working before an org exists.
 *
 * `/health` because the container's `HEALTHCHECK` calls it every 30s and would
 * otherwise restart a server that is merely waiting to be configured — the same
 * trap as LAI-030's rate limiter. `/setup` because it is the way out.
 */
export function isAllowedBeforeSetup(path: string): boolean {
  return path === '/api/v1/health' || path === '/api/v1/setup' || path.startsWith('/api/v1/setup/');
}

/**
 * Before an org exists, the API answers `conflict` for everything except setup
 * and health (SPEC §6.4, LAI-009 AC1).
 *
 * `conflict` rather than `not_found`: the endpoint exists and the request is
 * well-formed — it is the instance's state that makes it impossible, and that is
 * a state the caller can fix. A 404 would send them looking for a typo.
 *
 * Only API paths are gated here. The SPA document is served normally and
 * redirected by the static handler, because assets must keep loading for the
 * setup screen itself to render.
 */
export function setupGate(db: Db) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const path = c.req.path;
    const isApi = path === '/api' || path.startsWith('/api/');

    if (isApi && !isAllowedBeforeSetup(path) && setupRequired(db)) {
      throw new ApiError('conflict', 'This Laika has not been set up yet', {
        setup_required: true,
        setup_path: SETUP_PATH,
      });
    }

    await next();
  });
}
