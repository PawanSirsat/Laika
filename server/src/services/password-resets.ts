import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type SignInThrottle } from '../auth/sign-in-throttle.ts';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { accounts, passwordResets, users } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { endEverySession } from './users.ts';

/**
 * Admin-issued one-time password-reset links (§4.60, §6.4, D-104 item 4,
 * LAI-983).
 *
 * Laika sends no email, so before this a person who forgot their password was
 * locked out for good. Now whoever holds *Deactivate people and reset access*
 * (LAI-985) issues a link — shown once, single use, at most 24 hours — and
 * hands it over themselves.
 *
 * ## What is reused, and what is not
 *
 * The password is hashed by **better-auth's own configured hasher** (the
 * caller passes `auth.$context`'s `password.hash`), so a reset password is
 * verified on sign-in exactly as one set at sign-up is. No new dependency.
 * better-auth's own reset flow is not used: it stores its token in plaintext
 * in `verifications`, wants an email sender, and would bypass the throttle
 * and the session bookkeeping below.
 *
 * ## The rows are the log
 *
 * Who issued a link for whom, when, and whether it was used: `password_resets`
 * keeps all of it, as `analytics_views` keeps reads (§4.59). §4.8 gains no
 * verb.
 */

/** 24 hours — the longest D-104 item 4 allows ("short-lived"). */
export const RESET_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** 256 bits, base64url — the invite token's size (§4.11). */
const RESET_TOKEN_BYTES = 32;

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedResetLink {
  /** The plaintext token. Returned once, here; only its hash is stored. */
  token: string;
  expiresAt: number;
}

/**
 * Issue a link for `userId` (`POST /users/:id/reset-link`).
 *
 * `user.reset_password` decides who may — never for the owner unless the
 * caller is the owner — and it is session only: an agent's token that could
 * mint one could sign in as anybody it named.
 *
 * An earlier link for the same person that was never used is revoked: the
 * newest one is the only one that works, so a link sent to the wrong place can
 * be undone by issuing another.
 */
export function issueResetLink(
  db: Db,
  actor: ResolvedActor,
  userId: string,
  now: number = Date.now(),
): IssuedResetLink {
  const target = db
    .select({ id: users.id, orgRole: users.orgRole, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (target === undefined) throw ApiError.notFound(`No user with id "${userId}"`);

  assertCan(actor, 'user.reset_password', { targetOrgRole: target.orgRole });

  if (target.isActive !== 1) {
    throw new ApiError('unprocessable', 'Reactivate them before issuing a reset link.', {
      reason: 'inactive',
      user_id: userId,
    });
  }

  const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
  const expiresAt = now + RESET_LINK_TTL_MS;

  db.transaction(() => {
    db.update(passwordResets)
      .set({ revokedAt: now })
      .where(
        and(
          eq(passwordResets.userId, userId),
          isNull(passwordResets.usedAt),
          isNull(passwordResets.revokedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .run();

    db.insert(passwordResets)
      .values({
        id: newId(),
        userId,
        tokenHash: hashResetToken(token),
        createdBy: actor.userId,
        expiresAt,
        createdAt: now,
      })
      .run();
  });

  return { token, expiresAt };
}

export interface ConsumeResetLinkInput {
  token: string;
  newPassword: string;
}

export interface ConsumeResetLinkDeps {
  /** better-auth's configured hasher (`(await auth.$context).password.hash`). */
  hashPassword: (password: string) => Promise<string>;
  /** Failures back off like sign-in's (§6.1); see `throttleKeyFor`. */
  throttle: SignInThrottle;
  now?: () => number;
}

/** What `POST /password-resets/consume` answers. */
export interface PasswordResetView {
  user_id: string;
  /** How many sessions of theirs were ended — every one, signed in anywhere. */
  sessions_ended: number;
}

/**
 * The throttle's key: the account a token belongs to, or one shared key for a
 * token that matches nothing.
 *
 * The sign-in throttle's shape (§6.1, LAI-219) — per account, capped delay, no
 * lockout — and its rule about oracles: an unknown token throttles like a real
 * one, under a key that names nobody. Tokens are 256 bits, so this is not what
 * stops guessing; it is what stops one leaked, used or expired link being
 * hammered.
 */
function throttleKeyFor(userId: string | null): string {
  return userId === null ? 'password-reset:unknown' : `password-reset:${userId}`;
}

/**
 * Set a new password from a link (`POST /password-resets/consume`, public).
 *
 * No `can()`: there is nobody to ask about. Holding the token is the whole
 * authority, as for an invite (`previewInvite`).
 *
 * Refusals, each with its own `reason`: `unknown` (`404`), `used`, `revoked`
 * and `expired` (`409` — the token was real), `inactive` (`403`). The
 * password itself is validated by the route, as setup's is.
 *
 * **Single use is a compare-and-swap**, not a read then a write: the row is
 * claimed by an update conditioned on it still being unused, unrevoked and
 * unexpired, in the same transaction as the password and the sessions. Two
 * requests racing with one token change the password once.
 */
export async function consumeResetLink(
  db: Db,
  input: ConsumeResetLinkInput,
  deps: ConsumeResetLinkDeps,
): Promise<PasswordResetView> {
  const clock = deps.now ?? Date.now;
  const tokenHash = hashResetToken(input.token);
  const row = db.select().from(passwordResets).where(eq(passwordResets.tokenHash, tokenHash)).get();

  const key = throttleKeyFor(row?.userId ?? null);
  const decision = deps.throttle.check(key);
  if (!decision.allowed) {
    throw new ApiError('rate_limited', 'Too many attempts with reset links', {
      retry_after_seconds: decision.retryAfterSeconds ?? 0,
    });
  }

  const refuse = (code: 'not_found' | 'conflict', reason: string, message: string): never => {
    deps.throttle.recordFailure(key);
    throw new ApiError(code, message, { reason });
  };

  if (row === undefined) refuse('not_found', 'unknown', 'That reset link is not valid.');
  const link = row!;
  if (link.usedAt !== null) {
    refuse('conflict', 'used', 'That reset link has already been used. Ask for a new one.');
  }
  if (link.revokedAt !== null) {
    refuse('conflict', 'revoked', 'A newer reset link replaced this one. Use the newest.');
  }
  if (link.expiresAt <= clock()) {
    refuse('conflict', 'expired', 'That reset link has expired. Ask for a new one.');
  }

  const person = db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, link.userId))
    .get();
  if (person?.isActive !== 1) {
    throw new ApiError('forbidden', 'This account has been deactivated', { reason: 'inactive' });
  }

  // Hashing is asynchronous and the transaction below is not, so it happens
  // first; the claim inside the transaction is what makes the link single-use.
  const hash = await deps.hashPassword(input.newPassword);
  const now = clock();

  const ended = db.transaction(() => {
    const claimed = db
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.id, link.id),
          isNull(passwordResets.usedAt),
          isNull(passwordResets.revokedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .run().changes;
    if (claimed === 0) return null;

    const updated = db
      .update(accounts)
      .set({ password: hash, updatedAt: new Date(now) })
      .where(and(eq(accounts.userId, link.userId), eq(accounts.providerId, 'credential')))
      .run().changes;
    if (updated === 0) {
      // Every account here signs in with a password (§4.1); one that does not
      // has nothing for this link to reset, and the claim rolls back with it.
      throw new ApiError('conflict', 'This account has no password to reset.', {
        reason: 'no_password',
      });
    }

    return endEverySession(db, link.userId);
  });

  // Lost the race between the checks above and the claim: another request
  // spent it first.
  if (ended === null) {
    refuse('conflict', 'used', 'That reset link has already been used. Ask for a new one.');
  }

  deps.throttle.recordSuccess(key);
  return { user_id: link.userId, sessions_ended: ended! };
}
