import { and, asc, eq, sql } from 'drizzle-orm';
import { loadActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type EmailInboundAttachmentReason } from '../db/enums.ts';
import { comments, emailInbound, emailInboundAttachments, orgEmailInbound } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, systemPrincipal } from '../policy/can.ts';
import { decryptSecret } from '../secrets.ts';
import { type AttachmentsDeps, storeServerAttachment } from './attachments.ts';
import {
  BrevoFetchError,
  type BrevoFetchOptions,
  fetchInboundAttachment,
} from './brevo-inbound.ts';
import { StoreUnavailableError } from './s3-client.ts';

/**
 * An inbound mail's attachments, from Brevo to the D-150 store (§11.6, D-155
 * item 6, LAI-1315): every 30 seconds, under §3.4's
 * `system.email.attachments`, the oldest queued files are fetched with the
 * organisation's Brevo API key and stored as the mail's sender uploaded them,
 * on the task or comment the mail made.
 *
 * **A file never blocks its task, nor the files behind it.** The task or
 * comment was written when the mail arrived; a file that cannot be fetched or
 * stored is a reason on its row (§4.104), and the task stands without it. A
 * fetch, or a store that refuses the file — or anything nobody expected — is
 * tried at most three times, a tick apart; anything that cannot work — the
 * switch off, no store, no key, over the limit, nowhere left to put it, a
 * sender who may no longer attach there — is `skipped` at once, **before
 * Brevo is asked**. A store that is down ends the tick and charges nobody.
 */

/** How many queued files one tick takes. */
export const INBOUND_ATTACHMENT_BATCH = 10;

/** A fetch or store that fails is tried this many times in all. */
export const INBOUND_ATTACHMENT_ATTEMPTS = 3;

/**
 * The most one inbound file may be, whatever the board's limit (F2). A
 * browser's upload goes straight to the store; this one is held in Laika's
 * memory between Brevo and the store, so it has a ceiling of its own.
 */
export const INBOUND_ATTACHMENT_MAX_BYTES = 40 * 1024 * 1024;

/** Unexpected faults one after another that end a tick. */
export const INBOUND_UNEXPECTED_IN_A_ROW = 2;

/**
 * The store itself is down — no answer, a 5xx, a timeout or a throttle —
 * rather than refusing this one file. A 4xx is the file's, and is charged
 * like any refusal: otherwise one file the store will never take (a proxy's
 * 413, say) would hold the queue for ever.
 */
function storeIsDown(err: StoreUnavailableError): boolean {
  const status = err.storeStatus;
  return status === null || status >= 500 || status === 408 || status === 429;
}

export interface InboundAttachmentDeps extends BrevoFetchOptions {
  /** The store; absent, or `config: null`, every queued file is `store_off`. */
  attachments?: AttachmentsDeps | undefined;
  /**
   * Told of anything a file threw that was not Brevo or the store refusing —
   * the file itself is retried as if they had (M1). The scheduler logs it.
   */
  onFault?: ((cause: unknown) => void) | undefined;
}

/** What one tick did. */
export interface InboundAttachmentTick {
  stored: number;
  failed: number;
  skipped: number;
  retried: number;
}

type InboundMailRow = typeof emailInbound.$inferSelect;

/** A tick already running, per database: the next one joins it, never doubles it. */
const running = new WeakMap<Db, Promise<InboundAttachmentTick>>();

/** The organisation's Brevo API key, or null when none is saved or it cannot be read. */
function apiKeyOf(db: Db, serverSecret: string): string | null {
  const stored = db.select({ enc: orgEmailInbound.apiKeyEnc }).from(orgEmailInbound).get()?.enc;
  if (stored == null || serverSecret === '') return null;
  try {
    return decryptSecret(stored, serverSecret, 'brevo_api_key');
  } catch {
    // `LAIKA_SECRET` was rotated: the card says to paste the key again.
    return null;
  }
}

/** Email to tasks is on now — not only when the mail came (F3). */
function switchOn(db: Db): boolean {
  return db.select({ on: orgEmailInbound.enabled }).from(orgEmailInbound).get()?.on === 1;
}

/**
 * A reply's file goes on its comment or nowhere: a comment deleted since is
 * not a reason to put the file on the task instead (F5).
 */
function commentStands(db: Db, mail: InboundMailRow): boolean {
  if (mail.commentId === null) return mail.outcome !== 'comment_added';
  const comment = db
    .select({ deletedAt: comments.deletedAt })
    .from(comments)
    .where(eq(comments.id, mail.commentId))
    .get();
  return comment?.deletedAt === null;
}

export function runInboundAttachments(
  db: Db,
  serverSecret: string,
  deps: InboundAttachmentDeps,
  now: number,
): Promise<InboundAttachmentTick> {
  const inFlight = running.get(db);
  if (inFlight !== undefined) return inFlight;
  const tick = drain(db, serverSecret, deps, now).finally(() => {
    running.delete(db);
  });
  running.set(db, tick);
  return tick;
}

async function drain(
  db: Db,
  serverSecret: string,
  deps: InboundAttachmentDeps,
  now: number,
): Promise<InboundAttachmentTick> {
  assertCan(systemPrincipal(), 'system.email.attachments');
  const result: InboundAttachmentTick = { stored: 0, failed: 0, skipped: 0, retried: 0 };
  const queued = db
    .select({ file: emailInboundAttachments, mail: emailInbound })
    .from(emailInboundAttachments)
    .innerJoin(emailInbound, eq(emailInbound.id, emailInboundAttachments.inboundId))
    .where(eq(emailInboundAttachments.state, 'pending'))
    // Arrival order: ids made in one millisecond do not sort by when.
    .orderBy(asc(emailInboundAttachments.createdAt), asc(sql`${emailInboundAttachments}.rowid`))
    .limit(INBOUND_ATTACHMENT_BATCH)
    .all();
  if (queued.length === 0) return result;

  const on = switchOn(db);
  const config = deps.attachments?.config ?? null;
  const limit = Math.min(config?.maxBytes ?? 0, INBOUND_ATTACHMENT_MAX_BYTES);
  const apiKey = apiKeyOf(db, serverSecret);

  const finish = (
    id: string,
    state: 'stored' | 'failed' | 'skipped',
    reason: EmailInboundAttachmentReason | null,
    attachmentId: string | null = null,
  ): void => {
    db.update(emailInboundAttachments)
      .set({ state, reason, attachmentId, downloadToken: null, finishedAt: now })
      .where(and(eq(emailInboundAttachments.id, id), eq(emailInboundAttachments.state, 'pending')))
      .run();
    result[state === 'stored' ? 'stored' : state === 'failed' ? 'failed' : 'skipped'] += 1;
  };
  /** Another try next tick, or `failed` once the tries are spent. */
  const fault = (id: string, attempts: number, reason: EmailInboundAttachmentReason): void => {
    db.update(emailInboundAttachments)
      .set({ attempts: attempts + 1 })
      .where(eq(emailInboundAttachments.id, id))
      .run();
    if (attempts + 1 >= INBOUND_ATTACHMENT_ATTEMPTS) {
      finish(id, 'failed', reason);
      return;
    }
    result.retried += 1;
  };

  type Queued = (typeof queued)[number];
  /** One queued file, start to finish, and what its end means for the tick. */
  const takeOne = async ({ file, mail }: Queued): Promise<'done' | 'store_down' | 'unexpected'> => {
    // What a throw counts as: Brevo's fault until the bytes are in hand.
    let stage: 'fetch_failed' | 'store_failed' = 'fetch_failed';
    try {
      if (!on) {
        finish(file.id, 'skipped', 'switch_off');
        return 'done';
      }
      if (config === null) {
        finish(file.id, 'skipped', 'store_off');
        return 'done';
      }
      if (apiKey === null) {
        finish(file.id, 'skipped', 'no_api_key');
        return 'done';
      }
      if (file.sizeBytes > limit) {
        finish(file.id, 'skipped', 'too_large');
        return 'done';
      }
      // Who to store it as, and where — asked before Brevo is, so a sender
      // who has since left the space has nothing fetched for them (F4).
      const actor = mail.userId === null ? null : loadActor(db, mail.userId);
      const { projectId, taskId } = mail;
      if (
        projectId === null ||
        taskId === null ||
        actor?.isActive !== true ||
        !commentStands(db, mail) ||
        !can(withProject(actor, projectId), 'attachment.create', { projectId })
      ) {
        finish(file.id, 'skipped', 'not_needed');
        return 'done';
      }

      const fetched = await fetchInboundAttachment(apiKey, file.downloadToken ?? '', limit, deps);
      if (fetched.kind === 'too_large') {
        finish(file.id, 'skipped', 'too_large');
        return 'done';
      }
      if (fetched.bytes.length === 0) {
        finish(file.id, 'skipped', 'not_needed');
        return 'done';
      }

      stage = 'store_failed';
      const stored = await storeServerAttachment(db, actor, deps.attachments, {
        projectId,
        taskId,
        commentId: mail.commentId,
        filename: file.filename,
        contentType: file.contentType,
        bytes: fetched.bytes,
      });
      finish(file.id, 'stored', null, stored.id);
      return 'done';
    } catch (err) {
      // `StoreUnavailableError` is an `ApiError` too: it is asked first.
      if (err instanceof StoreUnavailableError && storeIsDown(err)) {
        // The store is down, not this file: nothing is charged for it.
        return 'store_down';
      }
      if (err instanceof BrevoFetchError || err instanceof StoreUnavailableError) {
        fault(file.id, file.attempts, stage);
        return 'done';
      }
      if (err instanceof ApiError && err.code === 'payload_too_large') {
        finish(file.id, 'skipped', 'too_large');
        return 'done';
      }
      if (err instanceof ApiError) {
        // The sender may no longer attach in that space: nothing to store it as.
        finish(file.id, 'skipped', 'not_needed');
        return 'done';
      }
      // Anything nobody expected is tried again like a refusal, and counted
      // the same way (M1): one file can neither stop the files behind it nor
      // be fetched for ever.
      deps.onFault?.(err);
      fault(file.id, file.attempts, stage);
      return 'unexpected';
    }
  };

  let unexpectedInARow = 0;
  for (const one of queued) {
    const outcome = await takeOne(one);
    // A store that is down takes nothing this tick: the files behind are
    // neither fetched for it nor charged a try — `pruneAttachments`'
    // `storeDown`, so minutes of downtime fail no file.
    if (outcome === 'store_down') break;
    // The same fault file after file is the board's, not the files': each is
    // charged, and the tick stops before it charges the rest.
    unexpectedInARow = outcome === 'unexpected' ? unexpectedInARow + 1 : 0;
    if (unexpectedInARow >= INBOUND_UNEXPECTED_IN_A_ROW) break;
  }
  return result;
}
