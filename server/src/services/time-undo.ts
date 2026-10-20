import { and, eq, gte, inArray } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { timeDrafts, timeEntries, timeUndo } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { retireEntry, reviveEntry, type Tx } from './time-entries.ts';
import { assertTimeOn } from './time-settings.ts';
import { touchedBy, UNDO_WINDOW_MS, type UndoChange } from './time-undo-log.ts';

/**
 * Undo (LAI-831, CHIEF's addition B): `POST /me/time/undo` takes back **the
 * one change it names** — by the id that change answered with
 * (`X-Undo-Id`, review round 1) — exactly, from what the change recorded it
 * replaced (`time-undo-log.ts`), never from what the page says it saw.
 *
 * - A confirm or a *Confirm day*: the entries it made are taken back, and
 *   every block is pending again as it stood, its collector's or held.
 * - *General*, a card, minutes, an edge: the block as it stood.
 * - *Not work*: pending again.
 * - A split: the two halves go, and the block is back under its own id.
 * - A delete: the entry is live again; an add: the entry is taken back.
 *
 * **History stays append-only.** An entry cannot be deleted while it is
 * kept (§4.48's trigger), so taking one back is a `deleted` revision and
 * bringing one back an `edited` one — Undo restores what counts, and the
 * record says it happened.
 *
 * **Only what nothing has changed since.** Every row the change wrote carries
 * its `updated_at`; one that moved on since — edited, confirmed, taken back —
 * is `409 changed_since`, and nothing is undone. A change older than
 * `UNDO_WINDOW_MS`, or anybody else's, is `404`: there is nothing of theirs to
 * take back.
 *
 * **Never a later change.** A change recorded after this one, to any draft
 * or entry this one wrote, is `409 newer_change`: Undo of *General* after a
 * *+* would otherwise take back the *+* — the bug review round 1 found when
 * Undo named a block rather than a change. Undo the later one first, by its
 * own id; restoring a row exactly, its `updated_at` included, makes the one
 * before it undoable again, so changes come off newest first, as a stack.
 */

function changedSince(): never {
  throw new ApiError(
    'conflict',
    'That has changed since — it can be edited, but no longer undone',
    { reason: 'changed_since' },
  );
}

function draftOf(tx: Tx, userId: string, id: string) {
  return tx
    .select({ updatedAt: timeDrafts.updatedAt })
    .from(timeDrafts)
    .where(and(eq(timeDrafts.id, id), eq(timeDrafts.userId, userId)))
    .get();
}

function entryOf(tx: Tx, userId: string, id: string) {
  return tx
    .select({ updatedAt: timeEntries.updatedAt, deletedAt: timeEntries.deletedAt })
    .from(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, userId)))
    .get();
}

/** `POST /me/time/undo`: the caller's change `id`, taken back. */
export function undoChange(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
): void {
  assertCan(actor, 'time_drafts.manage_own');
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  const userId = actor.userId;

  db.transaction((tx) => {
    const kept = tx
      .select()
      .from(timeUndo)
      .where(and(eq(timeUndo.userId, userId), gte(timeUndo.createdAt, now - UNDO_WINDOW_MS)))
      .all();
    const row = kept.find((r) => r.id === id);
    if (row === undefined) throw ApiError.notFound('Nothing to undo there');
    const change = JSON.parse(row.change) as UndoChange;
    const when = row.createdAt;

    // A later change to anything this one wrote: undoing this would take that back too.
    const mine = touchedBy(change);
    const later = kept.some(
      (r) =>
        (r.createdAt > when || (r.createdAt === when && r.id > row.id)) &&
        [...touchedBy(JSON.parse(r.change) as UndoChange)].some((x) => mine.has(x)),
    );
    if (later) {
      throw new ApiError(
        'conflict',
        'A later change to this block came after it, so this one can no longer be undone',
        { reason: 'newer_change' },
      );
    }
    const made = change.made ?? [];
    const entriesMade = change.entriesMade ?? [];
    const entriesRetired = change.entriesRetired ?? [];

    // Everything the change wrote is still as it left it — or nothing is undone.
    for (const id of made) {
      if (draftOf(tx, userId, id)?.updatedAt !== when) changedSince();
    }
    for (const before of change.drafts) {
      const current = draftOf(tx, userId, before.id);
      // A split removed its block; every other change left it in place.
      if (made.length > 0 ? current !== undefined : current?.updatedAt !== when) changedSince();
    }
    for (const id of entriesMade) {
      const entry = entryOf(tx, userId, id);
      if (entry?.deletedAt !== null || entry.updatedAt !== when) {
        changedSince();
      }
    }
    for (const id of entriesRetired) {
      if (entryOf(tx, userId, id)?.deletedAt !== when) changedSince();
    }

    for (const id of entriesMade) retireEntry(tx, id, userId, now);
    for (const id of entriesRetired) reviveEntry(tx, id, userId, now);
    if (made.length > 0) {
      tx.delete(timeDrafts)
        .where(and(eq(timeDrafts.userId, userId), inArray(timeDrafts.id, [...made])))
        .run();
    }
    for (const before of change.drafts) {
      if (made.length > 0) tx.insert(timeDrafts).values(before).run();
      else tx.update(timeDrafts).set(before).where(eq(timeDrafts.id, before.id)).run();
    }
    tx.delete(timeUndo).where(eq(timeUndo.id, row.id)).run();
  });
}
