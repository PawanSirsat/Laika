import { and, eq } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { timeDayNotes } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { isCalendarDay } from './calendar-days.ts';
import { type Tx } from './time-entries.ts';
import { assertTimeOn } from './time-settings.ts';

/**
 * A person's note on one of their days (§4.62, D-110 item 2, LAI-501): the
 * design's *Note for your manager*, written with *Confirm day* or on its own,
 * one per person per day, 500 characters. **Prose, not time**: no total reads
 * it, and Undo of a confirm leaves it where it is.
 *
 * Read by the person with their day (`GET /me/time`), and by owners and admins
 * — whoever holds `people.analytics.read` — with `GET /people/:id/time`, which
 * already answers them the person's own view (D-102). Never a plain member's.
 * Written behind `time_entries.write_own`, session only: the note is the
 * person's own account of their own time.
 */

export const DAY_NOTE_MAX = 500;

export interface DayNoteView {
  day: string;
  note: string;
  updated_at: number;
}

/** The person's note on `day`, or null — one primary-key read. A helper of My day. */
export function dayNoteOn(db: Db | Tx, userId: string, day: string): DayNoteView | null {
  const row = db
    .select({ day: timeDayNotes.day, note: timeDayNotes.note, updatedAt: timeDayNotes.updatedAt })
    .from(timeDayNotes)
    .where(and(eq(timeDayNotes.userId, userId), eq(timeDayNotes.day, day)))
    .get();
  return row === undefined ? null : { day: row.day, note: row.note, updated_at: row.updatedAt };
}

/**
 * Write the note inside the caller's transaction: trimmed; nothing — empty,
 * blank or null — removes the row; anything else replaces it in place.
 */
export function writeDayNote(
  tx: Tx | Db,
  userId: string,
  day: string,
  note: string | null,
  now: number,
): DayNoteView | null {
  const trimmed = note?.trim() ?? '';
  if (trimmed === '') {
    tx.delete(timeDayNotes)
      .where(and(eq(timeDayNotes.userId, userId), eq(timeDayNotes.day, day)))
      .run();
    return null;
  }
  tx.insert(timeDayNotes)
    .values({ userId, day, note: trimmed, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [timeDayNotes.userId, timeDayNotes.day],
      set: { note: trimmed, updatedAt: now },
    })
    .run();
  return { day, note: trimmed, updated_at: now };
}

/** `PUT /me/time/days/:day/note`: set the note, or `null` to remove it. */
export function setDayNote(
  db: Db,
  actor: ResolvedActor,
  day: string,
  note: string | null,
  now: number = Date.now(),
): DayNoteView | null {
  assertCan(actor, 'time_entries.write_own');
  assertTimeOn(db);
  if (!isCalendarDay(day)) {
    throw new ApiError('unprocessable', 'day is a calendar date, YYYY-MM-DD', { field: 'day' });
  }
  return writeDayNote(db, actor.userId, day, note, now);
}
