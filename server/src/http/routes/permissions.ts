import { Hono } from 'hono';
import { permissionsCatalogue, type PermissionsView } from '../../services/permissions.ts';
import { type AppEnv } from '../context.ts';

/**
 * `GET /api/v1/permissions` (SPEC §6.4, LAI-885).
 *
 * Transport only: who may do what, computed by `can()` in
 * `services/permissions.ts`, which also decides who may ask (`org.read`).
 * Queries nothing itself: every cell is a question to `can()` about a
 * synthetic actor, and the caller's grants come from the actor — memberships
 * included — that auth already loaded.
 */
export function permissionsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => c.json<PermissionsView>(permissionsCatalogue(c.get('actor'))));

  return app;
}
