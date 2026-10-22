import { Hono } from 'hono';
import { type Auth } from '../../auth/auth.ts';
import { type SignInThrottle } from '../../auth/sign-in-throttle.ts';
import { type Db } from '../../db/client.ts';
import { consumeResetLink, type PasswordResetView } from '../../services/password-resets.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `POST /api/v1/password-resets/consume` (§6.1, §6.4, D-104 item 4, LAI-983):
 * the public half of an admin-issued reset link. Transport only — the rules
 * are in `services/password-resets.ts`.
 *
 * **The token travels in the body, never the path**, so no access log line
 * holds a working link (the reason `logger.ts` redacts `/invites/:token`).
 * The page that posts here is the web app's (`/reset-password?token=…`,
 * LAI-988); this answers it.
 */

const ConsumeBody = strictObject({
  token: z.string().min(1).max(200),
  // Setup's rule, and the invite's (§6.4).
  new_password: z.string().min(12).max(512),
});

export interface PasswordResetRouteOptions {
  db: Db;
  auth: Auth;
  throttle: SignInThrottle;
}

export function passwordResetRoutes(options: PasswordResetRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, auth, throttle } = options;

  app.post('/consume', async (c) => {
    const body = parseBody(ConsumeBody, await c.req.json().catch(() => null));
    const context = await auth.$context;

    return c.json<PasswordResetView>(
      await consumeResetLink(
        db,
        { token: body.token, newPassword: body.new_password },
        { hashPassword: (password) => context.password.hash(password), throttle },
      ),
    );
  });

  return app;
}
