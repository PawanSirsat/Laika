import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
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
import { classify } from '../middleware/rate-limit.ts';
import { LIMITS, type RateLimiter } from '../rate-limit.ts';
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

/** The first frame of a fault's stack — where, never what: no mail text reaches a log. */
function whereOf(cause: unknown): string {
  const frame = cause instanceof Error ? (cause.stack ?? '').split('\n')[1] : undefined;
  return (frame ?? '').trim().slice(0, 200);
}

/**
 * Inbound email's gate, mounted on `POST /webhooks/email` **before the body
 * limit** (LAI-1315 review round 2, F2). The bearer token is a header, so it
 * is checked first, and the request is counted in one of two buckets chosen
 * by the answer: a verified delivery spends `inbound-email`, a refused token
 * `inbound-email:refused`, so junk is bounded and never spends Brevo's. A
 * refused request costs one hash and one indexed read: the body limit — which
 * reads a body sent without a length — is never reached, and not a byte of
 * the body is read.
 */
export function inboundEmailGate(options: { db: Db; rateLimiter: RateLimiter }) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // **Every other method is refused here, before the body limit** (round 3):
    // counted as any anonymous request is, and answered `405`, so a PUT or a
    // DELETE can neither be buffered nor go uncounted.
    if (c.req.method !== 'POST') {
      const anonymous = classify(c.req.path, null, c.req.method);
      const counted = options.rateLimiter.take(anonymous.key, anonymous.policy);
      c.header('X-RateLimit-Limit', String(anonymous.policy.burst ?? anonymous.policy.perMinute));
      c.header('X-RateLimit-Remaining', String(counted.remaining));
      if (!counted.allowed) {
        c.header('Retry-After', String(counted.retryAfterSeconds));
        throw new ApiError('rate_limited', 'Too many requests', {
          retry_after_seconds: counted.retryAfterSeconds,
        });
      }
      c.header('Allow', 'POST');
      throw new ApiError('method_not_allowed', 'Brevo posts here; nothing else is accepted');
    }
    const verified = verifyInboundToken(options.db, c.req.header('authorization'));
    const policy = verified ? LIMITS.inboundEmail : LIMITS.inboundEmailRefused;
    const decision = options.rateLimiter.take(
      verified ? 'inbound-email' : 'inbound-email:refused',
      policy,
    );
    c.header('X-RateLimit-Limit', String(policy.burst));
    c.header('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiError('rate_limited', 'Too many requests', {
        retry_after_seconds: decision.retryAfterSeconds,
      });
    }
    if (!verified) {
      c.get('log').warn('webhook.received', { source: 'email', verified: false });
      throw new ApiError('unauthorized', 'That delivery could not be verified');
    }
    await next();
  });
}

/** `POST /webhooks/email`, mounted on `/webhooks`. */
export function inboundEmailWebhookRoutes(options: EmailInboundRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db } = options;
  const sqlite = options.sqlite ?? db.$client;
  const clock = options.now ?? Date.now;

  app.post('/email', async (c) => {
    // The gate (`inboundEmailGate`) checked the token and spent its bucket
    // before the body limit read anything. Asked again here, cheaply, so the
    // route never trusts a mount order it cannot see.
    if (!verifyInboundToken(db, c.req.header('authorization'))) {
      throw new ApiError('unauthorized', 'That delivery could not be verified');
    }

    const raw = await c.req.text();

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ApiError('unprocessable', 'A delivery is JSON: { "items": [ … ] }');
    }
    const log = c.get('log');
    const results = receiveInboundEmail(sqlite, db, payload, clock(), (cause) => {
      log.error('email.inbound_failed', {
        error: cause instanceof Error ? cause.name : 'unknown',
        at: whereOf(cause),
      });
    });
    for (const result of results) {
      if (result.outcome === 'failed') continue;
      // A write refused for a reason no check named, or a mail given up on
      // after three faults: each worth a look (F3).
      const line = { outcome: result.outcome, reason: result.reason };
      if (result.reason === 'refused' || result.reason === 'failed_repeatedly') {
        log.warn('email.inbound', line);
      } else {
        log.info('email.inbound', line);
      }
    }
    // `200` for every mail Laika decided about, dropped or not: Brevo retries
    // what is not, and a mail Laika chose to drop must not come back. **`503`
    // when one failed** (F3): Brevo delivers again, every mail that landed is
    // a `duplicate`, and the failed one is tried again — until its third
    // fault, which is `failed_repeatedly` and no longer asks for a retry.
    const failed = results.some((r) => r.outcome === 'failed');
    return c.json({ ok: !failed, results }, failed ? 503 : 200);
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
