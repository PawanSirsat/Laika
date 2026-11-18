import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import {
  type EmailInboundSettingsView,
  type EmailInboundTokenView,
  getEmailInboundSettings,
  getProjectEmailAddress,
  type ProjectEmailAddressView,
  receiveInboundEmail,
  rotateEmailInboundToken,
  rotateProjectEmailAddress,
  setEmailInboundSettings,
  verifyInboundToken,
} from '../../services/email-inbound.ts';
import { type AppEnv } from '../context.ts';
import { parseBody, strictObject, z } from '../validation.ts';

/**
 * Email to tasks (§6.4, §10.3, D-155, LAI-1315).
 *
 * - `POST /webhooks/email` — Brevo's inbound parsing, proved by the bearer
 *   token alone; mounted on `/webhooks`, outside `/api/v1`, no session.
 * - `/org/email-inbound` — the *Email to tasks* card: `org.email.configure`,
 *   signed in only, as the outbound card is.
 * - `/projects/:slug/email-address` — a space's address: seen by whoever may
 *   create a task there, replaced by whoever may edit its settings.
 *
 * Transport only (CONVENTIONS §2): who may, and every rule, are the
 * service's. **No mail text is logged**: a delivery's log lines carry the
 * outcome and the reason, and the API key is in one request body and nowhere
 * else.
 */

const SettingsBody = strictObject({
  enabled: z.boolean().optional(),
  domain: z.string().trim().min(1).max(253).nullable().optional(),
  require_authenticated: z.boolean().optional(),
  authserv_id: z.string().trim().max(253).nullable().optional(),
  // Write-only: there is no way to read it back.
  api_key: z.string().trim().min(1).max(512).nullable().optional(),
});

export interface EmailInboundRouteOptions {
  db: Db;
  /** For the webhook's transaction; the db's own handle by default. */
  sqlite?: Database.Database | undefined;
  /** `LAIKA_SECRET`, for §12's encryption of the API key. */
  serverSecret: string;
  /** `LAIKA_PUBLIC_URL`, which the webhook URL on the card is built from. */
  publicUrl?: string | undefined;
  /** Injectable so a test can stamp a delivery. */
  now?: () => number;
}

/** `POST /webhooks/email`, mounted on `/webhooks`. */
export function inboundEmailWebhookRoutes(options: EmailInboundRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  const sqlite = options.sqlite ?? db.$client;
  const clock = options.now ?? Date.now;

  app.post('/email', async (c) => {
    // Read as text, and nothing parses it until the token holds — the §10.1
    // ordering: an unauthenticated caller cannot make this server parse JSON,
    // and a malformed body answers exactly as a bad token does.
    const raw = await c.req.text();
    if (!verifyInboundToken(db, c.req.header('authorization'))) {
      c.get('log').warn('webhook.received', { source: 'email', verified: false });
      throw new ApiError('unauthorized', 'That delivery could not be verified');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ApiError('unprocessable', 'A delivery is JSON: { "items": [ … ] }');
    }
    const results = receiveInboundEmail(sqlite, db, payload, clock());
    for (const result of results) {
      c.get('log').info('email.inbound', { outcome: result.outcome, reason: result.reason });
    }
    // `200` for every mail, dropped or not: Brevo retries what is not, and a
    // mail Laika chose to drop must not come back.
    return c.json({ ok: true, results });
  });

  return app;
}

/** `/email-inbound`, mounted on `/api/v1/org`. */
export function orgEmailInboundRoutes(options: EmailInboundRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;
  const publicUrl = options.publicUrl ?? '';
  const clock = options.now ?? Date.now;

  app.get('/email-inbound', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<EmailInboundSettingsView>(
      getEmailInboundSettings(db, actor, publicUrl, serverSecret),
    );
  });

  app.put('/email-inbound', async (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    const body = parseBody(SettingsBody, await c.req.json().catch(() => null));
    return c.json<EmailInboundSettingsView>(
      setEmailInboundSettings(db, actor, body, serverSecret, publicUrl, clock()),
    );
  });

  /** `201`: a new token, shown in this answer and never again. */
  app.post('/email-inbound/token', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<EmailInboundTokenView>(
      rotateEmailInboundToken(db, actor, publicUrl, clock(), serverSecret),
      201,
    );
  });

  return app;
}

/** `/:slug/email-address`, mounted on `/api/v1/projects`. */
export function projectEmailAddressRoutes(options: EmailInboundRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  const clock = options.now ?? Date.now;

  app.get('/:slug/email-address', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<ProjectEmailAddressView>(
      getProjectEmailAddress(db, actor, c.req.param('slug'), clock()),
    );
  });

  app.post('/:slug/email-address/rotate', (c) => {
    const actor = c.get('actor');
    if (actor === null) throw new ApiError('unauthorized', 'Not signed in');
    return c.json<ProjectEmailAddressView>(
      rotateProjectEmailAddress(db, actor, c.req.param('slug'), clock()),
    );
  });

  return app;
}
