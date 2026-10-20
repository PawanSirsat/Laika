import { and, eq, lt } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { type timeDrafts, timeUndo } from '../db/schema.ts';

/**
 * What a change to a person's own time replaced (LAI-831, CHIEF's addition B),
 * written in the change's own transaction so *Undo* can put it back exactly:
 * a held block's collector, a split block whole under its own id, a confirmed
 * draft pending. `time-undo.ts` reads it; this file only writes, so the
 * services that record a change import nothing that imports them back.
 *
 * **Kept minutes, not days.** My day offers Undo for ten seconds; the rest of
 * `UNDO_WINDOW_MS` is a slow network's. Each new record sweeps the person's
 * older ones, `pruneTime` sweeps everyone's, and turning *Draft my time* off
 * deletes them with the drafts — a before-image holds a block's counts.
 */

/** How long a change can be taken back. */
export const UNDO_WINDOW_MS = 2 * 60_000;

/**
 * The response header every recorded change answers with (review round 1):
 * the id **of that change**, which is what `POST /me/time/undo` takes — so an
 * Undo offered for one change can never take back a later one.
 */
export const UNDO_HEADER = 'X-Undo-Id';

/** Told the id of the change a write recorded, once its transaction has it. */
export type OnUndo = (id: string) => void;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A draft row as it stood, column for column. */
export type DraftImage = typeof timeDrafts.$inferSelect;

export interface UndoChange {
  /** Drafts as they stood before the change — put back as they were. */
  readonly drafts: readonly DraftImage[];
  /** Drafts that exist only because of the change, a split's two halves — removed. */
  readonly made?: readonly string[];
  /** Entries the change made live, by a confirm or an add — taken back. */
  readonly entriesMade?: readonly string[];
  /** Entries the change took back, by a delete — made live again. */
  readonly entriesRetired?: readonly string[];
}

/** The subject of a *Confirm day*: the day, not any one block. */
export const daySubject = (day: string): string => `day:${day}`;

/**
 * Record `change`, made at `now` to `subject` — a draft's id, an entry's id,
 * or {@link daySubject} — inside the change's own transaction. Returns the
 * change's id, which the route answers with ({@link UNDO_HEADER}).
 */
export function recordUndo(
  tx: Tx,
  userId: string,
  subject: string,
  change: UndoChange,
  now: number,
): string {
  tx.delete(timeUndo)
    .where(and(eq(timeUndo.userId, userId), lt(timeUndo.createdAt, now - UNDO_WINDOW_MS)))
    .run();
  const id = newId();
  tx.insert(timeUndo)
    .values({ id, userId, subject, change: JSON.stringify(change), createdAt: now })
    .run();
  return id;
}

/** Every draft and entry a change wrote or put back — what "the same block" means. */
export function touchedBy(change: UndoChange): ReadonlySet<string> {
  return new Set([
    ...change.drafts.map((d) => d.id),
    ...(change.made ?? []),
    ...(change.entriesMade ?? []),
    ...(change.entriesRetired ?? []),
  ]);
}
