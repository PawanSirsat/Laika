import { and, asc, eq, inArray, lt, lte, notInArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '../db/client.ts';
import { type EmailKind, type EmailSuppressedReason } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { emailOutbox } from '../db/schema.ts';
import { type Logger } from '../log.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
import { decryptSecret, encryptSecret } from '../secrets.ts';
import { emailBrand, emailSwitch, readSmtpConfig } from './email-settings.ts';
import { inviteEmail, type RenderedEmail, resetEmail } from './email-templates.ts';
import { errorLine, type MailTransport, type SendOutcome } from './email-transport.ts';

/**
 * The outbox (§4.93, D-153, LAI-1312): every email Laika sends goes through
 * here, and so does every one it decided not to send.
 *
 * KSage's delivery design, ported rather than its code (LAI-1310):
 *
 * - **Nothing is sent inside the request that caused it.** A request writes a
 *   row and returns; `email.send` (§11.6) sends. A board that waited on a mail
 *   host would stop working for a reason nobody looking at the board could guess.
 * - **Enqueue is idempotent.** One key per thing a message is about
 *   (`invite:<id>`), unique in the table, so a retried request cannot mail twice.
 * - **Silence is a row.** A message not sent is written `suppressed` with its
 *   reason, at enqueue and again at send time — the switch or the settings may
 *   have changed in between, and a message queued while email was on must not go
 *   out after an admin turned it off.
 * - **A timeout is never retried** once the session was underway: see
 *   `email-transport.ts`. A worker that dies mid-send leaves `sending`, and after
 *   ten minutes that is `unconfirmed` — given up on, not handed to somebody else.
 * - **A horizon.** Nothing is sent after `send_before`: seven days, or the
 *   link's own expiry if sooner. A message that waited longer is `too_old`.
 *
 * **The body is ciphertext and short-lived** (§13.1): an invite or a reset
 * carries a working link, so `body_enc` is §12's `email_body` and is cleared
 * the moment a row is final. A suppressed row is written without one.
 */

const SYSTEM = systemPrincipal();

/** KSage's horizon: older than this is never sent. */
export const EMAIL_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** A `sending` row older than this is `unconfirmed`, never retried. */
export const EMAIL_STALE_SENDING_MS = 10 * 60 * 1000;
/** Tries before a transient failure becomes `failed`. */
export const EMAIL_MAX_ATTEMPTS = 5;
/** The wait before the next try, by how many have been made. */
export const EMAIL_RETRY_AFTER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
/** At most this many messages a run, so a run is bounded by the transport's timeouts. */
export const EMAIL_BATCH = 50;
/** Outbox rows are deleted this long after they were written. */
export const EMAIL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** What a caller learns from queueing: whether a mail is coming, and if not, why. */
export interface EmailDispatchView {
  /** True when a message is queued, being sent or sent. */
  queued: boolean;
  /** Why not, when `queued` is false. */
  reason: EmailSuppressedReason | null;
}

export interface QueueEmailInput {
  kind: EmailKind;
  idempotencyKey: string;
  /** Null when there is nobody to send to: written `no_address`. */
  to: string | null;
  recipientUserId: string | null;
  createdBy: string | null;
  rendered: RenderedEmail;
  /**
   * False when the message carries a link and the server has no public URL to
   * build it from: written `no_public_url`, because a relative link in an
   * email goes nowhere.
   */
  linkable?: boolean;
  /** A link's own expiry; the horizon is the earlier of this and seven days. */
  expiresAt?: number | undefined;
}

/** What `body_enc` decrypts to. */
const StoredBody = z.object({ text: z.string(), html: z.string() });

/**
 * Write one message to the outbox: queued, or suppressed with its reason.
 *
 * No `can()`: this is a step inside an operation that already asked — creating
 * an invite asked `user.invite`, issuing a reset asked `user.reset_password` —
 * as `appendActivity` is. It changes nothing a person can see but the outbox.
 */
export function queueEmail(
  db: Db,
  input: QueueEmailInput,
  serverSecret: string,
  now: number = Date.now(),
): EmailDispatchView {
  const reason = suppressionAt(db, input, serverSecret);
  const sendBefore = Math.min(now + EMAIL_HORIZON_MS, input.expiresAt ?? Infinity);

  db.insert(emailOutbox)
    .values({
      id: newId(),
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      recipientUserId: input.recipientUserId,
      toAddress: input.to,
      subject: input.rendered.subject,
      bodyEnc:
        reason === null
          ? encryptSecret(
              JSON.stringify({ text: input.rendered.text, html: input.rendered.html }),
              serverSecret,
              'email_body',
            )
          : null,
      state: reason === null ? 'queued' : 'suppressed',
      suppressedReason: reason,
      nextAttemptAt: reason === null ? now : null,
      sendBefore,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
    .run();

  // Whatever the row says now — this call's, or an earlier one with the key.
  const row = db
    .select({ state: emailOutbox.state, reason: emailOutbox.suppressedReason })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, input.idempotencyKey))
    .get();
  return {
    queued: row !== undefined && row.state !== 'suppressed',
    reason: row?.reason ?? reason,
  };
}

/** Why a message cannot go now, or null. The switch first: off means off. */
function suppressionAt(
  db: Db,
  input: QueueEmailInput,
  serverSecret: string,
): EmailSuppressedReason | null {
  const { enabled, configured } = emailSwitch(db);
  if (!enabled) return 'email_off';
  if (!configured || serverSecret === '') return 'email_not_configured';
  if (input.to === null || input.to === '') return 'no_address';
  if (input.linkable === false) return 'no_public_url';
  return null;
}

/** An invite's mail (§4.11): to its address, with its accept link. */
export interface QueueInviteEmailInput {
  inviteId: string;
  /** Null for a link invite: there is nobody to mail (`no_address`). */
  email: string | null;
  expiresAt: number;
  /** The absolute accept link, or null when the server has no public URL. */
  acceptUrl: string | null;
  inviter: { userId: string; name: string };
}

export function queueInviteEmail(
  db: Db,
  input: QueueInviteEmailInput,
  serverSecret: string,
  now: number = Date.now(),
): EmailDispatchView {
  const rendered = inviteEmail({
    brand: emailBrand(db),
    inviterName: input.inviter.name,
    acceptUrl: input.acceptUrl ?? '',
    expiresAt: input.expiresAt,
    now,
  });
  return queueEmail(
    db,
    {
      kind: 'invite',
      idempotencyKey: inviteEmailKey(input.inviteId),
      to: input.email,
      recipientUserId: null,
      createdBy: input.inviter.userId,
      rendered,
      linkable: input.acceptUrl !== null,
      expiresAt: input.expiresAt,
    },
    serverSecret,
    now,
  );
}

/** An admin-issued reset link's mail (§4.60): to the person it is for. */
export interface QueueResetEmailInput {
  resetId: string;
  user: { id: string; name: string; email: string };
  expiresAt: number;
  /** The absolute reset link, or null when the server has no public URL. */
  resetUrl: string | null;
  issuer: { userId: string; name: string };
}

export function queueResetEmail(
  db: Db,
  input: QueueResetEmailInput,
  serverSecret: string,
  now: number = Date.now(),
): EmailDispatchView {
  const rendered = resetEmail({
    brand: emailBrand(db),
    userName: input.user.name,
    issuerName: input.issuer.name,
    resetUrl: input.resetUrl ?? '',
    expiresAt: input.expiresAt,
    now,
  });
  return queueEmail(
    db,
    {
      kind: 'password_reset',
      idempotencyKey: resetEmailKey(input.resetId),
      to: input.user.email,
      recipientUserId: input.user.id,
      createdBy: input.issuer.userId,
      rendered,
      linkable: input.resetUrl !== null,
      expiresAt: input.expiresAt,
    },
    serverSecret,
    now,
  );
}

/**
 * The links these messages carry stopped working before they went — an invite
 * revoked, re-issued or accepted, a reset link replaced by a newer one or used
 * (CHIEF's LAI-1312 review). A message still `queued` is `suppressed` /
 * `superseded`, so nobody is mailed a dead link, or two. One already being
 * sent is left to finish: it cannot be recalled, and the next run would not
 * see it as queued anyway.
 */
export function supersedeEmail(db: Db, idempotencyKeys: readonly string[], now: number): number {
  if (idempotencyKeys.length === 0) return 0;
  return db
    .update(emailOutbox)
    .set({
      state: 'suppressed',
      suppressedReason: 'superseded',
      bodyEnc: null,
      nextAttemptAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailOutbox.state, 'queued'),
        inArray(emailOutbox.idempotencyKey, [...idempotencyKeys]),
      ),
    )
    .run().changes;
}

/** The outbox key an invite's mail is queued under. */
export function inviteEmailKey(inviteId: string): string {
  return `invite:${inviteId}`;
}

/** The outbox key a reset link's mail is queued under. */
export function resetEmailKey(resetId: string): string {
  return `password_reset:${resetId}`;
}

/** Which of these invites' mails have actually been sent (`InviteView.email_sent`). */
export function invitesEmailed(db: Db, inviteIds: readonly string[]): Set<string> {
  if (inviteIds.length === 0) return new Set();
  const rows = db
    .select({ key: emailOutbox.idempotencyKey })
    .from(emailOutbox)
    .where(
      and(
        inArray(
          emailOutbox.idempotencyKey,
          inviteIds.map((id) => `invite:${id}`),
        ),
        eq(emailOutbox.state, 'sent'),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.key.slice('invite:'.length)));
}

export interface EmailOutboxDeps {
  /** The transport; the tests' recorder, or `smtpTransport()` in the app. */
  transport: MailTransport;
  now?: (() => number) | undefined;
  log?: Logger | undefined;
}

/** What one run did, by what became of each row it touched. */
export interface EmailRunResult {
  sent: number;
  failed: number;
  retried: number;
  unconfirmed: number;
  suppressed: number;
}

/** Every row this run touched — what the scheduler logs as `changed`. */
export function changedBy(result: EmailRunResult): number {
  return result.sent + result.failed + result.retried + result.unconfirmed + result.suppressed;
}

const inFlight = new WeakMap<Db, Promise<EmailRunResult>>();

/**
 * Send what is due, or join the run already going against this database — a
 * tick that comes round while a slow server is still answering must not send
 * the same row twice. The `runHrSync` shape.
 */
export function runEmailOutbox(
  db: Db,
  serverSecret: string,
  deps: EmailOutboxDeps,
): Promise<EmailRunResult> {
  const running = inFlight.get(db);
  if (running !== undefined) return running;
  const run = sendDueEmail(db, serverSecret, deps).finally(() => {
    inFlight.delete(db);
  });
  inFlight.set(db, run);
  return run;
}

/** One run. Use {@link runEmailOutbox}; exported for its own tests. */
export async function sendDueEmail(
  db: Db,
  serverSecret: string,
  deps: EmailOutboxDeps,
): Promise<EmailRunResult> {
  assertCan(SYSTEM, 'system.email.send');
  const clock = deps.now ?? Date.now;
  const result: EmailRunResult = { sent: 0, failed: 0, retried: 0, unconfirmed: 0, suppressed: 0 };
  const start = clock();

  // A worker that took a row and never said what happened may have delivered
  // it: given up on, never handed to another (KSage's stale-sending rule).
  result.unconfirmed += db
    .update(emailOutbox)
    .set({
      state: 'unconfirmed',
      bodyEnc: null,
      lastError: 'ESTALE: no outcome was recorded; it may have been delivered',
      updatedAt: start,
    })
    .where(
      and(
        eq(emailOutbox.state, 'sending'),
        lte(emailOutbox.claimedAt, start - EMAIL_STALE_SENDING_MS),
      ),
    )
    .run().changes;

  result.suppressed += suppressQueued(db, 'too_old', start, lte(emailOutbox.sendBefore, start));

  // Asked again now: what was true when a row was queued may not be.
  const { enabled, configured } = emailSwitch(db);
  if (!enabled) return addSuppressed(result, suppressQueued(db, 'email_off', start));
  if (!configured) {
    return addSuppressed(result, suppressQueued(db, 'email_not_configured', start));
  }

  // A key that will not decrypt is an infrastructure fault, not an absence:
  // thrown, so the scheduler logs it, and the rows wait — the horizon ends them
  // if nobody re-enters the key (secrets.ts on LAI-437).
  const config = readSmtpConfig(db, serverSecret);
  if (config === null) return result;

  const due = db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.state, 'queued'), lte(emailOutbox.nextAttemptAt, start)))
    .orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.id))
    .limit(EMAIL_BATCH)
    .all();

  for (const row of due) {
    // Asked again before every row (CHIEF's LAI-1312 review): an admin who
    // turns email off while a slow run is half-way through stops it at the
    // next message, not at the next tick.
    const now = emailSwitch(db);
    if (!now.enabled || !now.configured) {
      result.suppressed += suppressQueued(
        db,
        now.enabled ? 'email_not_configured' : 'email_off',
        clock(),
      );
      break;
    }

    const claimedAt = clock();
    const claimed = db
      .update(emailOutbox)
      .set({ state: 'sending', claimedAt, attempts: row.attempts + 1, updatedAt: claimedAt })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.state, 'queued')))
      .run().changes;
    if (claimed === 0) continue;

    const body = readBody(row.bodyEnc, serverSecret);
    if (body === null || row.toAddress === null) {
      finish(db, row.id, 'failed', clock(), 'EBODY: the message could not be read');
      result.failed += 1;
      continue;
    }

    const outcome = await deps.transport.send(config, {
      to: row.toAddress,
      subject: row.subject,
      text: body.text,
      html: body.html,
      idempotencyKey: row.idempotencyKey,
    });
    const done = clock();
    applyOutcome(db, row, outcome, done, result);
    if (outcome.kind !== 'sent') {
      deps.log?.warn('email.not_sent', { id: row.id, kind: row.kind, outcome: outcome.kind });
    }
  }

  return result;
}

function addSuppressed(result: EmailRunResult, n: number): EmailRunResult {
  result.suppressed += n;
  return result;
}

/** Every queued row (or those matching `extra`) → suppressed with `reason`, body gone. */
function suppressQueued(db: Db, reason: EmailSuppressedReason, now: number, extra?: SQL): number {
  return db
    .update(emailOutbox)
    .set({
      state: 'suppressed',
      suppressedReason: reason,
      bodyEnc: null,
      nextAttemptAt: null,
      updatedAt: now,
    })
    .where(
      extra === undefined
        ? eq(emailOutbox.state, 'queued')
        : and(eq(emailOutbox.state, 'queued'), extra),
    )
    .run().changes;
}

function readBody(enc: string | null, serverSecret: string): { text: string; html: string } | null {
  if (enc === null) return null;
  try {
    const parsed = StoredBody.safeParse(JSON.parse(decryptSecret(enc, serverSecret, 'email_body')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A final state: the body goes, and `sent_at` when it was sent. */
function finish(
  db: Db,
  id: string,
  state: 'sent' | 'failed' | 'unconfirmed',
  now: number,
  lastError: string | null = null,
): void {
  db.update(emailOutbox)
    .set({
      state,
      bodyEnc: null,
      nextAttemptAt: null,
      sentAt: state === 'sent' ? now : null,
      lastError,
      updatedAt: now,
    })
    .where(eq(emailOutbox.id, id))
    .run();
}

function applyOutcome(
  db: Db,
  row: { id: string; attempts: number; sendBefore: number },
  outcome: SendOutcome,
  now: number,
  result: EmailRunResult,
): void {
  if (outcome.kind === 'sent') {
    finish(db, row.id, 'sent', now);
    result.sent += 1;
    return;
  }

  const line = errorLine(outcome.code, outcome.detail);
  if (outcome.kind === 'indeterminate') {
    finish(db, row.id, 'unconfirmed', now, line);
    result.unconfirmed += 1;
    return;
  }

  const attempts = row.attempts + 1;
  const permanent = outcome.kind === 'refused' && outcome.permanent;
  const wait = EMAIL_RETRY_AFTER_MS[Math.min(attempts, EMAIL_RETRY_AFTER_MS.length) - 1] ?? 0;
  if (permanent || attempts >= EMAIL_MAX_ATTEMPTS || now + wait >= row.sendBefore) {
    finish(db, row.id, 'failed', now, line);
    result.failed += 1;
    return;
  }

  // Nothing was delivered, so trying again cannot duplicate anything.
  db.update(emailOutbox)
    .set({
      state: 'queued',
      claimedAt: null,
      nextAttemptAt: now + wait,
      lastError: line,
      updatedAt: now,
    })
    .where(eq(emailOutbox.id, row.id))
    .run();
  result.retried += 1;
}

/**
 * Outbox retention (§11.6): final rows older than 90 days. A row still
 * `queued` or `sending` is never deleted here — the horizon ends it first.
 */
export function pruneEmailOutbox(db: Db, now: number): number {
  assertCan(SYSTEM, 'system.email.prune');
  return db
    .delete(emailOutbox)
    .where(
      and(
        lt(emailOutbox.createdAt, now - EMAIL_RETENTION_MS),
        notInArray(emailOutbox.state, ['queued', 'sending']),
      ),
    )
    .run().changes;
}
