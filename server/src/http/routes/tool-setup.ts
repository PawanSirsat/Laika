import { Hono, type Context } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  addToolToDevice,
  cancelToolSetup,
  getToolSetup,
  redeemToolSetup,
  type CreatedToolSetupView,
  type ToolRedeemView,
  type ToolSetupView,
} from '../../services/tool-setup.ts';
import { type AppEnv } from '../context.ts';
import { markOneTimeSecret } from '../idempotency.ts';
import { parseBody, strictObject, z } from '../validation.ts';
import { boardOrigin } from './device-pairing.ts';

/**
 * Tool setup on a paired device (SPEC §4.80, §6.4, LAI-1056; plan LAI-1042
 * §E.2). Transport only; `services/tool-setup.ts` holds the rules.
 *
 * - **The owner's**: `POST /devices/:id/tools`, `GET` and `DELETE
 *   /tool-setup/:id`, a signed-in web session — `agent.manage_own` to act,
 *   `agent.read_own` to read. No answer carries a secret.
 * - **The device's**: `POST /tool-setup/:id/redeem`, with no actor of its
 *   own. It signs with the key it paired, and the service asks `can()` of
 *   the owner who made the exchange before it mints anything. The one
 *   answer with the secret is its `201`, kept out of the idempotency store.
 */

export interface ToolSetupRouteOptions {
  db: Db;
  sqlite: Database.Database;
  /** `LAIKA_PUBLIC_URL` (§11.7): the origin a redeeming device signs. */
  publicUrl?: string | undefined;
}

const AddToolBody = strictObject({
  harness: z.string().min(1).max(64),
});

const RedeemBody = strictObject({
  device_id: z.string().min(1).max(64),
  signature: z.string().min(1).max(200).optional(),
});

function requireActor(c: Context<AppEnv>) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/** Mounted at `/api/v1/devices`, beside `deviceRoutes`: only `/:id/tools`. */
export function deviceToolRoutes(options: ToolSetupRouteOptions): Hono<AppEnv> {
  const { db, sqlite } = options;
  const app = new Hono<AppEnv>();

  app.post('/:id/tools', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(AddToolBody, await c.req.json().catch(() => null));
    return c.json<CreatedToolSetupView>(
      addToolToDevice(sqlite, db, actor, c.req.param('id'), { harness: body.harness }),
      201,
    );
  });

  return app;
}

/** Mounted at `/api/v1/tool-setup`. */
export function toolSetupRoutes(options: ToolSetupRouteOptions): Hono<AppEnv> {
  const { db, sqlite } = options;
  const app = new Hono<AppEnv>();

  app.get('/:id', (c) =>
    c.json<ToolSetupView>(getToolSetup(db, requireActor(c), c.req.param('id'))),
  );

  app.delete('/:id', (c) => {
    cancelToolSetup(sqlite, db, requireActor(c), c.req.param('id'));
    return c.body(null, 204);
  });

  app.post('/:id/redeem', async (c) => {
    const body = parseBody(RedeemBody, await c.req.json().catch(() => null));
    const outcome = redeemToolSetup(sqlite, db, {
      id: c.req.param('id'),
      deviceId: body.device_id,
      signature: body.signature,
      boardOrigin: boardOrigin(options.publicUrl),
    });
    if (outcome.kind === 'challenge') {
      return c.json<{ challenge: string; expires_at: number }>({
        challenge: outcome.challenge,
        expires_at: outcome.expires_at,
      });
    }
    if (outcome.kind === 'bad_signature') {
      throw new ApiError('unauthorized', 'The signature does not match the device key', {
        reason: 'device_signature_invalid',
      });
    }
    // The secret is shown once; the idempotency store keeps no copy of it.
    markOneTimeSecret(c);
    return c.json<ToolRedeemView>(outcome.body, 201);
  });

  return app;
}
