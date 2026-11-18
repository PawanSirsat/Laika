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
 * fetch or a store that fails — or throws anything nobody expected — is tried
 * at most three times, a tick apart; anything that cannot work — the switch
 * off, no store, no key, over the limit, nowhere left to put it, a sender who
 * may no longer attach there — is `skipped` at once, **before Brevo is
 * asked**.
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

  for (const { file, mail } of queued) {
    // What a throw counts as: Brevo's fault until the bytes are in hand.
    let stage: 'fetch_failed' | 'store_failed' = 'fetch_failed';
    try {
      if (!on) {
        finish(file.id, 'skipped', 'switch_off');
        continue;
      }
      if (config === null) {
        finish(file.id, 'skipped', 'store_off');
        continue;
      }
      if (apiKey === null) {
        finish(file.id, 'skipped', 'no_api_key');
        continue;
      }
      if (file.sizeBytes > limit) {
        finish(file.id, 'skipped', 'too_large');
        continue;
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
        continue;
      }

      const fetched = await fetchInboundAttachment(apiKey, file.downloadToken ?? '', limit, deps);
      if (fetched.kind === 'too_large') {
        finish(file.id, 'skipped', 'too_large');
        continue;
      }
      if (fetched.bytes.length === 0) {
        finish(file.id, 'skipped', 'not_needed');
        continue;
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
    } catch (err) {
      // `StoreUnavailableError` is an `ApiError` too: it is asked first.
      if (err instanceof BrevoFetchError || err instanceof StoreUnavailableError) {
        fault(file.id, file.attempts, stage);
      } else if (err instanceof ApiError && err.code === 'payload_too_large') {
        finish(file.id, 'skipped', 'too_large');
      } else if (err instanceof ApiError) {
        // The sender may no longer attach in that space: nothing to store it as.
        finish(file.id, 'skipped', 'not_needed');
      } else {
        // Anything nobody expected is tried again like a refusal, and counted
        // the same way (M1): one file can neither stop the files behind it nor
        // be fetched for ever.
        deps.onFault?.(err);
        fault(file.id, file.attempts, stage);
      }
    }
  }
  return result;
}
