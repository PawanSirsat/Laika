import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { systemPrincipal } from '../../policy/can.ts';
import {
  DeliveryLog,
  githubWebhookSecret,
  handlePullRequest,
  handlePush,
  SIGNATURE_HEADER,
  verifyGithubSignature,
} from '../../services/webhooks.ts';
import { type AppEnv } from '../context.ts';

/**
 * `POST /webhooks/github` (SPEC §10.1, LAI-446).
 *
 * Mounted outside `/api/v1` with **no user session** (§10). The signature is the
 * whole of the authentication, and D-050's principal is the whole of the
 * authority: `can()` is asked on the project the branch resolved to, and a
 * delivery that resolves to nothing performs no write.
 */

export interface WebhookRouteOptions {
  db: Db;
  serverSecret: string;
  /** Injectable so a test can drive the 24h window without waiting a day. */
  deliveries?: DeliveryLog;
  now?: () => number;
}

export function githubWebhookRoutes(options: WebhookRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;
  const deliveries = options.deliveries ?? new DeliveryLog();
  const clock = options.now ?? Date.now;

  app.post('/github', async (c) => {
    // ## The body is read as text, and nothing parses it until the signature holds
    //
    // §10.1: *"constant-time compared, **before the body is parsed**"*. Both
    // halves of that sentence are load-bearing and this is the first one:
    // `c.req.text()` is the raw bytes GitHub signed, and `JSON.parse` does not
    // run until the HMAC has. An unauthenticated caller cannot make this server
    // parse arbitrary JSON, and a malformed body cannot answer differently from
    // a badly signed one — both are `401`, because the signature is checked
    // first and fails first.
    //
    // It is also the only correct thing: the signature covers the exact bytes,
    // so re-serialising a parsed object would reject every real delivery
    // (`{"a": 1}` and `{"a":1}` sign differently).
    const raw = await c.req.text();

    const secret = githubWebhookSecret(db, serverSecret);
    if (secret === null) {
      // §4.2's column is unset. **Absent means refuse**, not accept: an org that
      // has not configured a webhook has not agreed to be told anything, and an
      // endpoint that trusted unsigned deliveries until somebody set a secret
      // would be open by default.
      throw refuse(c, 'no webhook secret is configured');
    }

    if (!verifyGithubSignature(raw, c.req.header(SIGNATURE_HEADER), secret)) {
      throw refuse(c, 'signature did not verify');
    }

    // Everything below here is a delivery that proved it holds the org's secret.
    const delivery = c.req.header('x-github-delivery') ?? '';
    const now = clock();

    if (delivery !== '' && !deliveries.accept(delivery, now)) {
      // §10.1's 24h window. GitHub retries within minutes of a non-2xx, so this
      // is mostly about not doing the same thing twice after a slow response.
      return c.json({ ok: true, deduplicated: true });
    }

    const event = c.req.header('x-github-event') ?? '';
    const payload: unknown = JSON.parse(raw || 'null');

    const outcome =
      event === 'push'
        ? handlePush(db, asRecord(payload), now)
        : event === 'pull_request'
          ? handlePullRequest(db, asRecord(payload), (projectId) => systemPrincipal(projectId), now)
          : { handled: false, reason: 'event not handled' };

    // **Acknowledged and ignored** (§10.1) — a `200` for an event Laika does not
    // handle, so GitHub stops retrying something that will never be handled.
    return c.json({ ok: true, ...outcome });
  });

  return app;
}

/**
 * The §6.3 refusal, and the `webhook.received` log line §10.1 asks for.
 *
 * **A log line and not an `activity` row.** §10.1 says *"logged as
 * `webhook.received` with `verified: false`"*, and this endpoint answers before
 * anything is authenticated — an `activity` row here is a permanent, append-only
 * record an anonymous caller can create at will, and §4.8 has no retention.
 *
 * `/webhooks/` is a reserved path (`http/static.ts`), so §6.3's limiter already
 * bounds how fast this can be reached; the log is structured (§13.2) and rotates
 * with everything else. A verified delivery still writes `webhook.commit` to
 * `activity`, which is the row that records something that actually happened.
 */
function refuse(c: { get: (k: 'log') => { warn: (e: string, f?: object) => void } }, why: string) {
  c.get('log').warn('webhook.received', { verified: false, reason: why });
  return new ApiError('unauthorized', 'That delivery could not be verified');
}

/** A parsed body is `unknown`; the handlers read named fields defensively. */
function asRecord(value: unknown): Record<string, never> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, never>;
}
