import { request } from './client.ts';
import type { OrgRole } from './invites.ts';

/**
 * The Time logging grid (SPEC §6.4, D-148; LAI-1175): everyone's days beside
 * my days — people by calendar day over a stretch, each cell the minutes
 * they logged, for the client to set against the served threshold.
 *
 * Mirrors `services/time-logging.ts`.
 *
 * **The server sends facts, the client the verdict.** `threshold_minutes` is
 * served and never assumed; each person carries their zone, the day they
 * joined and today in that zone, and their working days, so the client does
 * no zone arithmetic to say which days were due.
 */

/** One day with time on it; a day with none has no row. Mirrors `TimeLoggingDayView`. */
export interface TimeLoggingDay {
  readonly day: string;
  readonly confirmed_minutes: number;
  readonly drafted_minutes: number;
}

/**
 * The person on a grid row. Mirrors `services/time-logging.ts`' `TimeLoggingUser`,
 * which the drift check reaches through {@link TimeLoggingPerson}'s field names
 * only — so it is spelled out here, as `TimeReportPerson` is.
 */
export interface TimeLoggingUser {
  readonly id: string;
  readonly name: string;
  readonly org_role: OrgRole;
  readonly deactivated: boolean;
}

/** One row of the grid. Mirrors `TimeLoggingPersonView`. */
export interface TimeLoggingPerson {
  readonly user: TimeLoggingUser;
  /** The person's place's IANA zone; `UTC` when they set none. */
  readonly zone: string;
  /** The day they joined, in their zone: nothing is due before it. */
  readonly joined_day: string;
  /** Today in their zone: nothing is due on or after it. */
  readonly today_day: string;
  /** ISO weekdays, 1 Monday to 7 Sunday — their own, or Monday to Friday. */
  readonly work_days: readonly number[];
  /** Ascending. */
  readonly days: readonly TimeLoggingDay[];
}

/** `GET /time/days`. Mirrors `TimeLoggingView`. */
export interface TimeLogging {
  readonly from: string;
  readonly to: string;
  /** Everyone, or the people of the spaces the reader leads. */
  readonly scope: 'people' | 'lead';
  readonly threshold_minutes: number;
  /** A–Z by name, then id. */
  readonly people: readonly TimeLoggingPerson[];
  /** More people had a row than the server lists; the list was cut A–Z. */
  readonly truncated: boolean;
}

const opts = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });

/** The query string for a stretch, in a fixed order so one month is one address. */
export function timeLoggingParams(from: string, to: string): URLSearchParams {
  return new URLSearchParams({ from, to });
}

/** `GET /time/days` (D-148): the grid, every person shown logged as a look. */
export function getTimeLogging(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<TimeLogging> {
  return request<TimeLogging>(`/time/days?${timeLoggingParams(from, to).toString()}`, opts(signal));
}
