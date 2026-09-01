import { Hono } from 'hono';
import { type Db } from '../../db/client.ts';
import { ApiError } from '../../errors.ts';
import { systemPrincipal } from '../../policy/can.ts';
import { parseBody, strictObject, z } from '../validation.ts';
import { storeTranscriptReview } from '../../services/meeting-reviews.ts';
import {
  DeliveryLog,
  githubWebhookSecret,
  MONTHLY_SUBMISSION_CAP,
  providerFor,
  SubmissionCounter,
  transcriptWebhookSecret,
  handlePullRequest,
  handleIssueComment,
  handlePush,
  SIGNATURE_HEADER,
  verifySignature,
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
  /** Injectable so a test can reach the cap without two hundred requests. */
  submissions?: SubmissionCounter;
  now?: () => number;
}

/**
 * §10.2's body. `source` is free text — a recorder name, not a vocabulary —
 * because §4.12 stores it as `text` and §10.2 lists no values.
 */
const TranscriptBody = strictObject({
  project_slug: z.string().trim().min(1).max(120),
  // Bounded because it is sent to a paid provider, and an unbounded body is an
  // unbounded bill. Generous enough for a long meeting.
  transcript: z.string().trim().min(1).max(200_000),
  source: z.string().trim().min(1).max(120),
});

export function githubWebhookRoutes(options: WebhookRouteOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, serverSecret } = options;
  const deliveries = options.deliveries ?? new DeliveryLog();
  const submissions = options.submissions ?? new SubmissionCounter();
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

    if (!verifySignature(raw, c.req.header(SIGNATURE_HEADER), secret)) {
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
          : event === 'issue_comment'
            ? handleIssueComment(
                db,
                asRecord(payload),
                (projectId) => systemPrincipal(projectId),
                now,
              )
            : { handled: false, reason: 'event not handled' };

    // **Acknowledged and ignored** (§10.1) — a `200` for an event Laika does not
    // handle, so GitHub stops retrying something that will never be handled.
    return c.json({ ok: true, ...outcome });
  });

  /**
   * `POST /webhooks/transcript` (§10.2, D-052, LAI-450).
   *
   * **Its own secret and its own HMAC**, not §10.1's. One secret for two
   * integrations means revoking either breaks both, and a leak of one hands over
   * the other — so the column, the `SecretPurpose` and therefore the derived key
   * all differ.
   *
   * §10.2 was specified with **no authentication at all** (LAI-164): as written,
   * anyone reachable could choose which project's open tasks and `context_md`
   * left the instance, on the org's bill. D-052 settled it as this.
   */
  app.post('/transcript', async (c) => {
    // Same ordering as §10.1 and for the same two reasons: no unauthenticated
    // parse, and a malformed body cannot answer differently from a bad signature.
    const raw = await c.req.text();

    const secret = transcriptWebhookSecret(db, serverSecret);
    if (secret === null) throw refuse(c, 'no transcript secret is configured');
    if (!verifySignature(raw, c.req.header(SIGNATURE_HEADER), secret)) {
      throw refuse(c, 'signature did not verify');
    }

    // **A cap, not only a rate** (D-052). An authenticated integration gone
    // wrong spends money at a perfectly legal rate, so the limiter cannot see
    // it — and reaching the cap answers *distinctly*, because "you have used
    // this month's budget" and "you are going too fast" want different actions
    // from whoever reads it.
    const spent = submissions.recordAndCount(clock());
    if (spent > MONTHLY_SUBMISSION_CAP) {
      throw new ApiError('rate_limited', 'This org has reached its monthly transcript cap', {
        cap: MONTHLY_SUBMISSION_CAP,
        reason: 'monthly_cap',
      });
    }

    const body = parseBody(TranscriptBody, JSON.parse(raw || 'null'));
    const stored = await storeTranscriptReview(
      db,
      providerFor(db, serverSecret),
      { projectSlug: body.project_slug, transcript: body.transcript, source: body.source },
      clock(),
    );

    // `202`, per §10.2: the proposals exist and a human has not seen them.
    return c.json({ id: stored.id, proposals: stored.proposals }, 202);
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
