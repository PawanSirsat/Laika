import { Hono } from 'hono';
import {
  compatibility,
  type CompatibilityBody,
  type CompatibilityInput,
} from '../../services/developer-compat.ts';
import { type AppEnv } from '../context.ts';

export { type CompatibilityBody };

/**
 * `GET /api/v1/developer/compatibility` (SPEC §6.4, LAI-1043).
 *
 * **Unauthenticated, like `/health`, and for the same reason.** `laika doctor`
 * and a fresh install ask it before they hold any credential, to learn which
 * commit to clone and whether this board supports what they are about to do.
 * It reads no data and no actor: the body is built from deployment settings
 * alone, so there is no resource for a `can()` call to name, and an anonymous
 * caller sees exactly what a signed-in one does. Rate limiting still applies —
 * an anonymous request spends the shared anonymous bucket (§6.3).
 */
export function developerRoutes(input: CompatibilityInput): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Built once: every input is fixed for the life of the process.
  const body = compatibility(input);

  app.get('/compatibility', (c) => c.json<CompatibilityBody>(body));

  return app;
}
