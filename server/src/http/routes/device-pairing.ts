import { Hono, type Context } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  PAIRING_KINDS,
  cancelPairingRequest,
  claimPairingRequest,
  completePairingRequest,
  createPairingRequest,
  decidePairingRequest,
  getPairingRequest,
  type CreatedPairingView,
  type DevicePairingView,
  type PairingClaimView,
  type PairingCompleteView,
} from '../../services/device-pairing.ts';
import { type AppEnv } from '../context.ts';
import { markOneTimeSecret } from '../idempotency.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Device pairing (SPEC §4.79, §6.4, LAI-1050; plan LAI-1042 §E.1). Transport
 * only; `services/device-pairing.ts` holds the rules.
 *
 * Two routers, because the two sides authenticate differently:
 *
 * - **The owner's**, at `/devices/pairing-requests`: a signed-in web session,
 *   `agent.manage_own` (session only) to act and `agent.read_own` to read.
 * - **The device's**, at `/device-pairing`: no actor at all. A claim presents
 *   the code; completing presents a signature. Neither is a credential and
 *   neither yields one, so there is no third way to be an actor (§6.1).
 */

export interface DevicePairingRouteOptions {
  db: Db;
  sqlite: Database.Database;
  /** `LAIKA_PUBLIC_URL` (§11.7): the origin a completing device signs. */
  publicUrl?: string | undefined;
}

const CreateBody = strictObject({
  kind: z.enum(PAIRING_KINDS),
  display_name: z.string().max(200),
  device_id: z.string().min(1).max(64).optional(),
});

const DecideBody = strictObject({
  key_fingerprint: z.string().min(1).max(64),
});

const ClaimBody = strictObject({
  code: z.string().min(1).max(64),
  public_key: z.string().min(1).max(512),
  os: z.string().trim().min(1).max(64).optional(),
  cli_version: z.string().trim().min(1).max(64).optional(),
});

const CompleteBody = strictObject({
  signature: z.string().min(1).max(200),
});

function requireActor(c: Context<AppEnv>) {
  const actor = c.get('actor');
  if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
  return actor;
}

/**
 * The board's origin, which a device signs, from `LAIKA_PUBLIC_URL` only
 * (LAI-1050 review, N2). A request's own `Host` is what a proxy happened to
 * forward, so signing it would bind a device to an internal address; with no
 * public URL, pairing is refused rather than guessed.
 */
export function boardOrigin(publicUrl: string | undefined): string {
  if (publicUrl === undefined || publicUrl === '') {
    throw new ApiError('conflict', 'Set LAIKA_PUBLIC_URL to pair devices with this board', {
      reason: 'public_url_unset',
    });
  }
  return new URL(publicUrl).origin;
}

export function devicePairingRequestRoutes(options: DevicePairingRouteOptions): Hono<AppEnv> {
  const { db, sqlite } = options;
  const app = new Hono<AppEnv>();

  app.post('/', async (c) => {
    const actor = requireActor(c);
    const body = parseBody(CreateBody, await c.req.json().catch(() => null));
    const created = createPairingRequest(sqlite, db, actor, {
      kind: body.kind,
      displayName: body.display_name,
      deviceId: body.device_id,
      boardOrigin: boardOrigin(options.publicUrl),
    });
    // The code is shown once; the idempotency store keeps no copy of it.
    markOneTimeSecret(c);
    return c.json<CreatedPairingView>(created, 201);
  });

  app.get('/:id', (c) =>
    c.json<DevicePairingView>(getPairingRequest(db, requireActor(c), c.req.param('id'))),
  );

  async function decide(c: Context<AppEnv>, approve: boolean) {
    const actor = requireActor(c);
    const body = parseBody(DecideBody, await c.req.json().catch(() => null));
    return c.json<DevicePairingView>(
      decidePairingRequest(sqlite, db, actor, c.req.param('id') ?? '', {
        approve,
        keyFingerprint: body.key_fingerprint,
      }),
    );
  }

  app.post('/:id/approve', (c) => decide(c, true));
  app.post('/:id/deny', (c) => decide(c, false));

  app.delete('/:id', (c) => {
    cancelPairingRequest(sqlite, db, requireActor(c), c.req.param('id'));
    return c.body(null, 204);
  });

  return app;
}

export function devicePairingRoutes(options: DevicePairingRouteOptions): Hono<AppEnv> {
  const { db, sqlite } = options;
  const app = new Hono<AppEnv>();

  // No backoff on failures (CHIEF, PR #205 round 2): an 80-bit code needs
  // none, and any shared key an anonymous caller can spend is one they can
  // hold empty. Every claim, well-formed or not, spends `LIMITS.pairing` in
  // the middleware before it gets here.
  app.post('/claim', async (c) => {
    const body = parseBody(ClaimBody, await c.req.json().catch(() => null));
    return c.json<PairingClaimView>(
      claimPairingRequest(sqlite, db, {
        code: body.code,
        publicKey: body.public_key,
        os: body.os,
        cliVersion: body.cli_version,
      }),
    );
  });

  // Completing is limited per request id (the middleware). An id is a ULID
  // nobody guesses, a signature needs the device's private key, and each
  // request caps its own bad signatures, so nothing here is shared.
  app.post('/:id/complete', async (c) => {
    const body = parseBody(CompleteBody, await c.req.json().catch(() => null));
    const outcome = completePairingRequest(sqlite, db, {
      id: c.req.param('id'),
      signature: body.signature,
      boardOrigin: boardOrigin(options.publicUrl),
    });
    if (outcome.kind === 'bad_signature') {
      throw new ApiError('unauthorized', 'The signature does not match the device key', {
        reason: 'device_signature_invalid',
      });
    }
    if (outcome.kind === 'pending') {
      return c.json<{ state: 'claimed' }>({ state: outcome.state }, 202);
    }
    return c.json<PairingCompleteView>(outcome.body);
  });

  return app;
}
