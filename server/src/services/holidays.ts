import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type HolidaySource } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { orgHolidays } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { daysBetween, isCalendarDay } from './calendar-days.ts';

/**
 * The organisation's holidays (D-149 items 5 and 8, LAI-1181): read by every
 * member, and typed or removed by an owner or admin under the Time setting's
 * row (`org.time.set`). Clan's arrive by the sync (`hr-sync.ts`) and are not
 * removed here — Clan is their record.
 *
 * **A removed holiday is stamped, never deleted**, whichever way it came: the
 * rows say what the calendar was, and a holiday typed again is a new row.
 *
 * Which of two on one day wins — a manual one over Clan's (D-149 item 8) — is
 * the reads' that mark days (LAI-1183); this list serves both.
 */

/** The widest stretch one read covers: two years and a day. */
export const HOLIDAYS_MAX_DAYS = 731;

export interface HolidayView {
  id: string;
  /** `YYYY-MM-DD`. */
  day: string;
  label: string;
  source: HolidaySource;
  /** No department or designation scope: the holiday is everybody's. */
  everyone: boolean;
}

/** `GET /api/v1/org/holidays`. */
export interface HolidayListView {
  holidays: HolidayView[];
}

function viewOf(row: typeof orgHolidays.$inferSelect): HolidayView {
  return {
    id: row.id,
    day: row.day,
    label: row.label,
    source: row.source,
    everyone: row.scopeJson === null,
  };
}

function assertDay(day: string, field: string): void {
  if (!isCalendarDay(day)) {
    throw new ApiError('unprocessable', `${field} must be a date, YYYY-MM-DD`, { field });
  }
}

/**
 * `GET /api/v1/org/holidays?from=&to=`: the live holidays in `from`–`to`,
 * inclusive, by day — at most {@link HOLIDAYS_MAX_DAYS} days of them.
 */
export function listHolidays(
  db: Db,
  actor: ResolvedActor,
  range: { from: string; to: string },
): HolidayListView {
  assertCan(actor, 'org.read');
  assertDay(range.from, 'from');
  assertDay(range.to, 'to');
  const span = daysBetween(range.from, range.to) + 1;
  if (span < 1 || span > HOLIDAYS_MAX_DAYS) {
    throw new ApiError(
      'unprocessable',
      `from must not be after to, and the range at most ${String(HOLIDAYS_MAX_DAYS)} days`,
      { field: 'to', max_days: HOLIDAYS_MAX_DAYS },
    );
  }
  return {
    holidays: db
      .select()
      .from(orgHolidays)
      .where(
        and(
          isNull(orgHolidays.removedAt),
          gte(orgHolidays.day, range.from),
          lte(orgHolidays.day, range.to),
        ),
      )
      // A manual holiday first on its day: it is the one that wins (item 8).
      .orderBy(asc(orgHolidays.day), desc(orgHolidays.source), asc(orgHolidays.label))
      .all()
      .map(viewOf),
  };
}

/**
 * `POST /api/v1/org/holidays`: an owner or admin types a holiday. One live
 * manual holiday a day — a second is `409 holiday_exists`; a Clan holiday on
 * the same day does not stop it.
 */
export function addHoliday(
  db: Db,
  actor: ResolvedActor,
  input: { day: string; label: string },
  now: number = Date.now(),
): HolidayView {
  assertCan(actor, 'org.time.set');
  assertDay(input.day, 'day');
  return db.transaction(
    (tx) => {
      const live = tx
        .select({ id: orgHolidays.id })
        .from(orgHolidays)
        .where(
          and(
            eq(orgHolidays.source, 'manual'),
            eq(orgHolidays.day, input.day),
            isNull(orgHolidays.removedAt),
          ),
        )
        .get();
      if (live !== undefined) {
        throw new ApiError('conflict', 'That day already has a holiday', {
          reason: 'holiday_exists',
          id: live.id,
        });
      }
      const row = {
        id: newId(),
        day: input.day,
        label: input.label,
        source: 'manual' as const,
        sourceRef: null,
        scopeJson: null,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
        removedAt: null,
      };
      tx.insert(orgHolidays).values(row).run();
      return viewOf(row);
    },
    { behavior: 'immediate' },
  );
}

/**
 * `DELETE /api/v1/org/holidays/:id`: remove a manual holiday. Clan's are
 * `409 holiday_from_clan` — remove it in Clan, and the next sync follows.
 */
export function removeHoliday(
  db: Db,
  actor: ResolvedActor,
  id: string,
  now: number = Date.now(),
): void {
  assertCan(actor, 'org.time.set');
  const row = db
    .select()
    .from(orgHolidays)
    .where(and(eq(orgHolidays.id, id), isNull(orgHolidays.removedAt)))
    .get();
  if (row === undefined) throw ApiError.notFound('No such holiday');
  if (row.source === 'clan') {
    throw new ApiError('conflict', 'This holiday comes from Clan; remove it there', {
      reason: 'holiday_from_clan',
    });
  }
  db.update(orgHolidays)
    .set({ removedAt: now, updatedAt: now })
    .where(eq(orgHolidays.id, id))
    .run();
}
