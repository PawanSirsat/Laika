import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Db } from '../db/client.ts';
import { orgs } from '../db/schema.ts';
import { decryptSecret } from '../secrets.ts';

/**
 * `POST /webhooks/github` — the parts that decide whether to listen (§10.1).
 *
 * Mounted outside `/api/v1` with no user session (§10, line 1195), so the
 * signature is the only thing standing between an anonymous caller and the
 * handlers. Everything here is about that.
 */

/** GitHub's header, and the only scheme it has ever sent for this. */
export const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';
/** SHA-256 as lowercase hex. Fixed, so a wrong length is not a timing signal. */
const DIGEST_HEX_LENGTH = 64;

/**
 * The org's webhook secret, or `null` when none is configured.
 *
 * **Decrypted per request** rather than cached: §12 keeps it as ciphertext, the
 * plaintext has no business outliving the request that needs it, and an org that
 * rotates its secret should not have to restart the process.
 *
 * A **failed** decrypt is not `null`. `decryptSecret` throws
 * `SecretAuthError` when `LAIKA_SECRET` has changed or the row was altered, and
 * that must not arrive here as "no webhook configured" — an operator told the
 * webhook is unconfigured will go and configure it, which is the one action that
 * cannot help (LAI-437, LAI-161).
 */
export function githubWebhookSecret(db: Db, serverSecret: string): string | null {
  const row = db.select({ enc: orgs.githubWebhookSecretEnc }).from(orgs).limit(1).get();
  const enc = row?.enc ?? null;
  if (enc === null || enc === '') return null;

  return decryptSecret(enc, serverSecret, 'github_webhook_secret');
}

/**
 * Does this body carry a signature made with this secret?
 *
 * ## Constant-time, and why the early returns are not a leak
 *
 * §13.1 requires constant-time comparison for HMACs. A byte-by-byte compare
 * returns sooner the earlier it finds a difference, so an attacker who can time
 * responses recovers the expected digest one character at a time and then replays
 * it — the signature check becomes a formality without ever failing a test.
 *
 * The three rejections above the comparison are all decided by **the shape of
 * the caller's own input** — absent header, wrong scheme, not 64 hex characters —
 * and none of them touches the secret or the expected digest. Timing them tells
 * an attacker only what they already typed. `timingSafeEqual` also *throws* on a
 * length mismatch rather than returning false, so the length check has to happen
 * first regardless.
 */
export function verifyGithubSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (header === null || header === undefined) return false;
  if (!header.startsWith(SIGNATURE_PREFIX)) return false;

  const offered = header.slice(SIGNATURE_PREFIX.length).toLowerCase();
  if (offered.length !== DIGEST_HEX_LENGTH || !/^[0-9a-f]+$/.test(offered)) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  return timingSafeEqual(Buffer.from(offered, 'hex'), Buffer.from(expected, 'hex'));
}

/** 24 hours, per §10.1. */
export const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A cap, so an attacker cannot grow this by inventing delivery ids.
 *
 * Sized well above a real day: GitHub retries a delivery a handful of times, and
 * a busy org sees thousands of events a day, not a hundred thousand. Reaching it
 * means something is wrong, and dropping the oldest is the failure that costs
 * least — a redelivery of a very old event is processed twice, which is the same
 * thing a restart already does.
 */
const MAX_TRACKED = 100_000;

/**
 * Delivery ids seen in the last 24 hours (§10.1).
 *
 * ## In memory, and it does not survive a restart
 *
 * **Stated because the alternative is discovering it.** Laika is one process
 * with one SQLite file (D-002), so a `Map` is enough to make GitHub's retries
 * idempotent within a run — which is what the deduplication is *for*, since
 * GitHub retries within minutes of a non-2xx, not across days.
 *
 * What it costs: a redelivery **after a restart** is processed a second time.
 * For `push` that means a second `webhook.commit` row in an append-only log; for
 * `pull_request` and `issue_comment` the handlers are already idempotent in
 * effect — a task moved to `review` twice is in `review`. So the residue is a
 * duplicated audit row after a restart, which is visible, harmless and honest.
 *
 * A table would fix that and costs a migration, a write on the hot path, and a
 * cleanup job for rows nobody reads. **If a duplicated `webhook.commit` ever
 * matters, that is the trade to revisit** — it is not free either way, and this
 * is the cheaper wrong answer.
 */
export class DeliveryLog {
  private readonly seenAt = new Map<string, number>();

  /**
   * Record this delivery and say whether it is new.
   *
   * `true` means "not seen": the caller should process it. Named for what the
   * caller does rather than for what the map holds, because `seen()` returning
   * `true` for an unseen delivery is exactly the inversion somebody writes at
   * two in the morning.
   */
  accept(deliveryId: string, now: number): boolean {
    this.evict(now);

    if (this.seenAt.has(deliveryId)) return false;

    this.seenAt.set(deliveryId, now);
    return true;
  }

  /** For the tests, and for a health endpoint later. */
  size(): number {
    return this.seenAt.size;
  }

  /**
   * **Stops at the first live entry rather than scanning.**
   *
   * A `Map` iterates in insertion order and `now` is `Date.now()`, so entries
   * are in time order and everything after the first unexpired one is unexpired.
   * Sweeping the whole map on every delivery made this quadratic — 100k
   * deliveries took thirteen seconds in a test, which is the shape of a real
   * problem on a busy org rather than a slow test.
   *
   * The monotonic-clock assumption is worth naming because it is the thing that
   * makes the `break` correct: a caller passing times out of order would leave
   * expired entries behind. Nothing does, and the cost of being wrong is a
   * delivery remembered slightly too long.
   */
  private evict(now: number): void {
    for (const [id, at] of this.seenAt) {
      if (now - at < DELIVERY_TTL_MS) break;
      this.seenAt.delete(id);
    }

    // Insertion order is arrival order, so the first entry is the oldest.
    while (this.seenAt.size >= MAX_TRACKED) {
      const oldest = this.seenAt.keys().next();
      if (oldest.done === true) break;
      this.seenAt.delete(oldest.value);
    }
  }
}
