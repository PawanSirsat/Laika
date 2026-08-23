import { Hono } from 'hono';
import { type AppEnv } from '../context.ts';

export interface HealthBody {
  status: 'ok';
  version: string;
  uptime_ms: number;
}

/**
 * `GET /api/v1/health` — the endpoint Docker's HEALTHCHECK hits (LAI-008).
 *
 * Unauthenticated by design: a health probe that needs a credential is a health
 * probe that reports "unhealthy" whenever auth breaks, which is precisely when
 * you need the rest of the signal. It exposes no data beyond a version string.
 */
export function healthRoutes(version: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) =>
    c.json<HealthBody>({
      status: 'ok',
      version,
      uptime_ms: Math.round(process.uptime() * 1000),
    }),
  );

  return app;
}
