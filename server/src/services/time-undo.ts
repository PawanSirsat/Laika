import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { timeDrafts, timeEntries, timeUndo } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { retireEntry, reviveEntry, type Tx } from './time-entries.ts';
import { daySubject, UNDO_WINDOW_MS, type UndoChange } from './time-undo-log.ts';

/**
 * Undo (LAI-831, CHIEF's addition B): `POST /me/time/undo` takes back the
 * person's newest change to one draft, one entry or one day, **exactly** —
 * from what the change recorded it replaced (`time-undo-log.ts`), never from
 * what the page says it saw.
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
 * **Newest first, as a stack.** Undo restores a row exactly, its `updated_at`
 * included, so once the newest change to a block is undone the one before it
 * matches again and can be undone in turn — within the window, and never out
 * of order.
 */

export interface UndoSubject {
  readonly draft?: string | undefined;
  readonly entry?: string | undefined;
  readonly day?: string | undefined;
}

function subjectOf(input: UndoSubject): string {
  const named = [input.draft, input.entry, input.day].filter((x) => x !== undefined);
  if (named.length !== 1) {
    throw new ApiError('unprocessable', 'Name one draft, one entry or one day to undo', {
      reason: 'one_subject',
    });
  }
  return input.draft ?? input.entry ?? daySubject(input.day ?? '');
}

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

/** `POST /me/time/undo`: the caller's newest change to `input`'s subject, taken back. */
export function undoChange(
  db: Db,
  actor: ResolvedActor,
  input: UndoSubject,
  now: number = Date.now(),
): void {
  assertCan(actor, 'time_drafts.manage_own');
  assertCan(actor, 'time_entries.write_own');
  const subject = subjectOf(input);
  const userId = actor.userId;

  db.transaction((tx) => {
    const row = tx
      .select()
      .from(timeUndo)
      .where(
        and(
          eq(timeUndo.userId, userId),
          eq(timeUndo.subject, subject),
          gte(timeUndo.createdAt, now - UNDO_WINDOW_MS),
        ),
      )
      .orderBy(desc(timeUndo.createdAt), desc(timeUndo.id))
      .limit(1)
      .get();
    if (row === undefined) throw ApiError.notFound('Nothing to undo there');
    const change = JSON.parse(row.change) as UndoChange;
    const when = row.createdAt;
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
