import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgs } from '../../src/db/schema.ts';
import { encryptSecret, SecretAuthError } from '../../src/secrets.ts';
import {
  DELIVERY_TTL_MS,
  DeliveryLog,
  githubWebhookSecret,
  verifyGithubSignature,
} from '../../src/services/webhooks.ts';
import { freshDb, seed, type TestDb } from '../helpers/db.ts';

/**
 * §10.1's gate (LAI-446).
 *
 * `/webhooks/*` is mounted outside `/api/v1` with **no user session**, so the
 * signature is the only thing between an anonymous caller and the handlers.
 */

const SERVER_SECRET = 'a-laika-secret-that-is-at-least-32-characters-long';
const WEBHOOK_SECRET = 'the-shared-secret-github-was-given';
const BODY = '{"ref":"refs/heads/lai-42-do-the-thing"}';

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

describe('verifying a signature', () => {
  it('accepts a body signed with the shared secret', () => {
    expect(verifyGithubSignature(BODY, sign(BODY), WEBHOOK_SECRET)).toBe(true);
  });

  it('refuses a body that was changed after signing', () => {
    // The property, stated as tampering rather than as "a wrong string".
    expect(verifyGithubSignature(`${BODY} `, sign(BODY), WEBHOOK_SECRET)).toBe(false);
  });

  it('refuses a signature made with a different secret', () => {
    expect(verifyGithubSignature(BODY, sign(BODY, 'not-the-secret'), WEBHOOK_SECRET)).toBe(false);
  });

  it('refuses an absent, mis-schemed or malformed header', () => {
    for (const header of [
      null,
      undefined,
      '',
      // `sha1=` is GitHub's retired scheme; accepting it would silently downgrade.
      sign(BODY).replace('sha256=', 'sha1='),
      'sha256=',
      // Right shape, wrong length — must not reach `timingSafeEqual`, which
      // throws rather than returning false when the buffers differ.
      `sha256=${'a'.repeat(63)}`,
      `sha256=${'a'.repeat(65)}`,
      // Not hex. `Buffer.from(x, 'hex')` silently truncates at the first
      // non-hex character, so without the check this would compare a short
      // buffer and throw.
      `sha256=${'z'.repeat(64)}`,
    ]) {
      expect(verifyGithubSignature(BODY, header, WEBHOOK_SECRET), String(header)).toBe(false);
    }
  });

  it('accepts the digest in either case', () => {
    // GitHub sends lowercase; a proxy or a test fixture may not. This is not
    // laxity — hex is case-insensitive and the bytes are identical.
    // The *digest*, not the scheme: GitHub's `sha256=` prefix is lowercase and
    // accepting `SHA256=` would be laxity rather than correctness.
    const [scheme, digest] = sign(BODY).split('=') as [string, string];

    expect(verifyGithubSignature(BODY, `${scheme}=${digest.toUpperCase()}`, WEBHOOK_SECRET)).toBe(
      true,
    );
    expect(verifyGithubSignature(BODY, sign(BODY).toUpperCase(), WEBHOOK_SECRET)).toBe(false);
  });

  it('signs the exact bytes, so an equivalent JSON re-encoding fails', () => {
    // **Why the route must verify the raw body and never a re-serialised one.**
    // These two parse to the same object and have different signatures; a
    // handler that verified `JSON.stringify(await c.req.json())` would reject
    // every real delivery, and one that verified after parsing would have
    // parsed untrusted input first.
    const spaced = '{"ref": "refs/heads/lai-42-do-the-thing"}';

    expect(JSON.parse(spaced)).toEqual(JSON.parse(BODY));
    expect(verifyGithubSignature(spaced, sign(BODY), WEBHOOK_SECRET)).toBe(false);
  });
});

describe('the comparison is constant-time (§13.1)', () => {
  /**
   * **Asserted by reading the source, because the behaviour cannot show it.**
   *
   * `===` on two hex strings returns exactly the same answers as
   * `timingSafeEqual` for every input in this file — right for the right
   * signature, wrong for the wrong one. It differs only in *how long it takes*,
   * and timing an in-process function call in a test measures the scheduler.
   *
   * So the property is "the code uses the constant-time primitive", and the only
   * honest way to check that is to look. §13.1 requires it for a reason: a
   * byte-by-byte compare on an HMAC lets an attacker who can time responses
   * recover the expected digest one character at a time and then replay it —
   * the check keeps passing its tests the whole way.
   */
  const source = readFileSync(new URL('../../src/services/webhooks.ts', import.meta.url), 'utf8');

  it('imports timingSafeEqual and returns its result', () => {
    expect(source).toMatch(/import \{[^}]*timingSafeEqual[^}]*\} from 'node:crypto'/);
    expect(source).toMatch(/return timingSafeEqual\(/);
  });

  it('never compares the digests with an ordinary equality', () => {
    // The mutation this exists to catch, in the two spellings somebody reaches
    // for. Comment lines are stripped first: this file *discusses* `===` at
    // length, and a check that reads prose as code reports its own
    // documentation (LAI-159).
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    expect(code).not.toMatch(/offered\s*={2,3}\s*expected/);
    expect(code).not.toMatch(/expected\s*={2,3}\s*offered/);
  });
});

describe('reading the org secret', () => {
  let t: TestDb;

  beforeEach(() => {
    t = freshDb();
    seed(t.db);
  });
  afterEach(() => {
    t.close();
  });

  it('is null when the org has none, so every delivery is refused', () => {
    expect(githubWebhookSecret(t.db, SERVER_SECRET)).toBeNull();
  });

  it('round-trips the configured secret', () => {
    t.db
      .update(orgs)
      .set({
        githubWebhookSecretEnc: encryptSecret(
          WEBHOOK_SECRET,
          SERVER_SECRET,
          'github_webhook_secret',
        ),
      })
      .run();

    expect(githubWebhookSecret(t.db, SERVER_SECRET)).toBe(WEBHOOK_SECRET);
  });

  it('throws rather than reporting an unreadable secret as an absent one', () => {
    // **The distinction LAI-437 and LAI-161 both turn on.** After a
    // `LAIKA_SECRET` rotation the column is still set; answering `null` would
    // tell an operator the webhook is unconfigured, and configuring it is the
    // one action that cannot help.
    t.db
      .update(orgs)
      .set({
        githubWebhookSecretEnc: encryptSecret(
          WEBHOOK_SECRET,
          'a-different-secret-of-at-least-32-characters',
          'github_webhook_secret',
        ),
      })
      .run();

    expect(() => githubWebhookSecret(t.db, SERVER_SECRET)).toThrow(SecretAuthError);
  });

  it('uses the webhook purpose, so another column cannot open it', () => {
    // Ciphertext written for a different column must not decrypt here — the
    // per-purpose keys of LAI-161, asserted from the caller that relies on them.
    t.db
      .update(orgs)
      .set({ githubWebhookSecretEnc: encryptSecret(WEBHOOK_SECRET, SERVER_SECRET, 'ai_api_key') })
      .run();

    expect(() => githubWebhookSecret(t.db, SERVER_SECRET)).toThrow(SecretAuthError);
  });
});

describe('delivery deduplication', () => {
  it('accepts a delivery once', () => {
    const log = new DeliveryLog();

    expect(log.accept('d-1', 1_000)).toBe(true);
    expect(log.accept('d-1', 1_000)).toBe(false);
    expect(log.accept('d-2', 1_000)).toBe(true);
  });

  it('forgets a delivery after 24 hours, and not before', () => {
    const log = new DeliveryLog();
    log.accept('d-1', 1_000);

    // One millisecond short of the window: still remembered.
    expect(log.accept('d-1', 1_000 + DELIVERY_TTL_MS - 1)).toBe(false);
    expect(log.accept('d-1', 1_000 + DELIVERY_TTL_MS)).toBe(true);
  });

  it('does not grow without bound when ids are invented', () => {
    // An anonymous caller cannot make this a memory leak. The cap is well above
    // a real day, so reaching it means something is wrong and the oldest entry
    // is the cheapest thing to lose.
    const log = new DeliveryLog();
    for (let i = 0; i < 100_500; i++) log.accept(`d-${String(i)}`, 1_000);

    expect(log.size()).toBeLessThanOrEqual(100_000);
    // And it is still doing its job for recent deliveries.
    expect(log.accept('d-100499', 1_000)).toBe(false);
  });
});
