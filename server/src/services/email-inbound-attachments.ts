import { and, asc, eq, sql } from 'drizzle-orm';
import { loadActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type EmailInboundAttachmentReason } from '../db/enums.ts';
import { emailInbound, emailInboundAttachments, orgEmailInbound } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, systemPrincipal } from '../policy/can.ts';
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
 * **A file never blocks its task.** The task or comment was written when the
 * mail arrived; a file that cannot be fetched or stored is a reason on its row
 * (§4.104), and the task stands without it. A fetch or a store that fails is
 * tried at most three times, a tick apart; anything that cannot work — no
 * store, no key, over the limit, a sender who may no longer attach — is
 * `skipped` at once.
 */

/** How many queued files one tick takes. */
export const INBOUND_ATTACHMENT_BATCH = 10;

/** A fetch or store that fails is tried this many times in all. */
export const INBOUND_ATTACHMENT_ATTEMPTS = 3;

export interface InboundAttachmentDeps extends BrevoFetchOptions {
  /** The store; absent, or `config: null`, every queued file is `store_off`. */
  attachments?: AttachmentsDeps | undefined;
}

/** What one tick did. */
export interface InboundAttachmentTick {
  stored: number;
  failed: number;
  skipped: number;
  retried: number;
}

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

  const config = deps.attachments?.config ?? null;
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
    if (attempts + 1 >= INBOUND_ATTACHMENT_ATTEMPTS) {
      db.update(emailInboundAttachments)
        .set({ attempts: attempts + 1 })
        .where(eq(emailInboundAttachments.id, id))
        .run();
      finish(id, 'failed', reason);
      return;
    }
    db.update(emailInboundAttachments)
      .set({ attempts: attempts + 1 })
      .where(eq(emailInboundAttachments.id, id))
      .run();
    result.retried += 1;
  };

  for (const { file, mail } of queued) {
    if (config === null) {
      finish(file.id, 'skipped', 'store_off');
      continue;
    }
    if (apiKey === null) {
      finish(file.id, 'skipped', 'no_api_key');
      continue;
    }
    if (file.sizeBytes > config.maxBytes) {
      finish(file.id, 'skipped', 'too_large');
      continue;
    }
    const actor = mail.userId === null ? null : loadActor(db, mail.userId);
    if (mail.taskId === null || mail.projectId === null || actor?.isActive !== true) {
      finish(file.id, 'skipped', 'not_needed');
      continue;
    }

    let bytes: Uint8Array;
    try {
      const fetched = await fetchInboundAttachment(
        apiKey,
        file.downloadToken ?? '',
        config.maxBytes,
        deps,
      );
      if (fetched.kind === 'too_large') {
        finish(file.id, 'skipped', 'too_large');
        continue;
      }
      bytes = fetched.bytes;
    } catch (err) {
      if (!(err instanceof BrevoFetchError)) throw err;
      fault(file.id, file.attempts, 'fetch_failed');
      continue;
    }
    if (bytes.length === 0) {
      finish(file.id, 'skipped', 'not_needed');
      continue;
    }

    try {
      const stored = await storeServerAttachment(db, actor, deps.attachments, {
        projectId: mail.projectId,
        taskId: mail.taskId,
        commentId: mail.commentId,
        filename: file.filename,
        contentType: file.contentType,
        bytes,
      });
      finish(file.id, 'stored', null, stored.id);
    } catch (err) {
      if (err instanceof StoreUnavailableError) {
        fault(file.id, file.attempts, 'store_failed');
      } else if (err instanceof ApiError && err.code === 'payload_too_large') {
        finish(file.id, 'skipped', 'too_large');
      } else if (err instanceof ApiError) {
        // The sender may no longer attach in that space: nothing to store it as.
        finish(file.id, 'skipped', 'not_needed');
      } else {
        throw err;
      }
    }
  }
  return result;
}
