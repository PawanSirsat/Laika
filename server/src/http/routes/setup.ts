import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Auth } from '../../auth/auth.ts';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { createFirstOrg, removeOrphanedOwner, setupRequired } from '../../services/setup.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * `GET /api/v1/setup/status` and `POST /api/v1/setup` (SPEC §6.4).
 *
 * Transport only: validate, call the service, shape the response.
 */

const SetupBody = strictObject({
  org_name: z.string().trim().min(1).max(120),
  owner_name: z.string().trim().min(1).max(120),
  owner_email: z.string().trim().email().max(320),
  owner_password: z.string().min(12).max(512),
  project_name: z.string().trim().min(1).max(120).optional(),
  project_prefix: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z][A-Za-z0-9]{1,7}$/,
      'A prefix is 2-8 letters and digits, starting with a letter',
    )
    .optional(),
  /** §4.2's org-wide presence switch. Absent means on. */
  presence_enabled: z.boolean().optional(),
});

export interface SetupStatusBody {
  setup_required: boolean;
}

export interface SetupResultBody {
  org_id: string;
  owner_id: string;
  project_id: string | null;
}

export interface SetupRouteOptions {
  db: Db;
  sqlite: Database.Database;
  auth: Auth;
}

export function setupRoutes(options: SetupRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Public and always available — the SPA reads it to decide which screen to
  // show, so it must answer both before and after setup.
  app.get('/status', (c) => c.json<SetupStatusBody>({ setup_required: setupRequired(options.db) }));

  app.post('/', async (c) => {
    const body = parseBody(SetupBody, await c.req.json().catch(() => null));

    // Cheap early rejection. The authoritative check is inside the service's
    // transaction, under the write lock.
    if (!setupRequired(options.db)) {
      throw new ApiError('conflict', 'This Laika has already been set up');
    }

    // better-auth creates the account so the password is hashed its way (§13.1)
    // and the response carries a session cookie — AC6 wants the Owner signed in
    // when setup returns. Signup is not invite-gated here because that gate reads
    // the org row, and there is no org yet.
    const signUp = await options.auth.api.signUpEmail({
      body: {
        email: body.owner_email.toLowerCase(),
        password: body.owner_password,
        name: body.owner_name,
      },
      returnHeaders: true,
    });

    const ownerId = signUp.response.user.id;

    let result;
    try {
      result = createFirstOrg(options.sqlite, options.db, {
        orgName: body.org_name,
        ownerId,
        projectName: body.project_name,
        projectPrefix: body.project_prefix,
        presenceEnabled: body.presence_enabled,
      });
    } catch (err) {
      // The loser of a setup race leaves an account holding an email address.
      // Removing it is the service's job — routes reach data through services
      // (CONVENTIONS §2).
      removeOrphanedOwner(options.db, ownerId);
      throw err;
    }

    // Hand back better-auth's Set-Cookie so the Owner is signed in.
    for (const [name, value] of signUp.headers.entries()) {
      if (name.toLowerCase() === 'set-cookie') c.header('Set-Cookie', value, { append: true });
    }

    return c.json<SetupResultBody>(
      { org_id: result.orgId, owner_id: result.ownerId, project_id: result.projectId },
      201,
    );
  });

  return app;
}
