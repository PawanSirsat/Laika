/**
 * `Idempotency-Key` on POST (SPEC §6.3).
 *
 * The problem it solves: an agent POSTs `create_task`, the connection drops
 * before the response arrives, the agent retries. Without this the board gets two
 * tasks and nobody can tell which one is real. With it the retry returns the
 * original response and the second task never exists.
 *
 * Three rules from §6.3, all of them load-bearing:
 *
 *  - the same key **and the same body** replays the stored response;
 *  - the same key with a **different** body is `conflict` — that is a bug in the
 *    caller, and silently treating it as a replay would lose a real write;
 *  - keys are scoped **per actor**, so one caller's key cannot collide with or
 *    replay another's.
 *
 * Stored in SQLite rather than memory (D-002, no Redis): a replay that arrives
 * after a restart is exactly the case this exists for.
 */

import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { idempotencyKeys } from '../db/schema.ts';
import { ApiError } from '../errors.ts';

/** §6.3: "replays within 24h return the original response". */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredResponse {
  status: number;
  body: string;
}

export function hashRequest(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${body}`).digest('hex');
}

export interface LookupResult {
  kind: 'replay' | 'conflict' | 'fresh';
  response?: StoredResponse;
}

/**
 * Decide what to do with an incoming keyed request.
 *
 * Returns `fresh` when the key is unseen (or has aged out), `replay` with the
 * stored response when the same actor sent the same request, and `conflict` when
 * the key is being reused for something else.
 */
export function lookup(
  db: Db,
  actorId: string,
  key: string,
  fingerprint: string,
  now: number,
): LookupResult {
  const row = db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.actorId, actorId), eq(idempotencyKeys.key, key)))
    .get();

  if (row === undefined) return { kind: 'fresh' };

  // Expired entries are treated as unseen rather than deleted here — the cron
  // sweep owns deletion, and a read path that writes is a read path that can
  // fail under a concurrent writer.
  if (row.expiresAt <= now) return { kind: 'fresh' };

  if (row.requestHash !== fingerprint) return { kind: 'conflict' };

  return {
    kind: 'replay',
    response: { status: row.responseStatus, body: row.responseBody },
  };
}

export function remember(
  db: Db,
  actorId: string,
  key: string,
  fingerprint: string,
  response: StoredResponse,
  now: number,
): void {
  db.insert(idempotencyKeys)
    .values({
      actorId,
      key,
      requestHash: fingerprint,
      responseStatus: response.status,
      responseBody: response.body,
      createdAt: now,
      expiresAt: now + IDEMPOTENCY_TTL_MS,
    })
    .onConflictDoNothing()
    .run();
}

export function conflictError(key: string): ApiError {
  return new ApiError(
    'conflict',
    'This Idempotency-Key was already used with a different request body',
    { idempotency_key: key },
  );
}

/** For the cron sweep of §11.6. */
export function pruneExpired(db: Db, now: number): void {
  db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now)).run();
}
