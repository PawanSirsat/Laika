import type { TimeLoggingPerson } from '../../../api/time-logging.ts';
import {
  hoursCompact,
  monthOf,
  shiftDay,
} from '../../../components/time-report/time-report-derive.ts';

/**
 * The Time logging grid's arithmetic (D-148, LAI-1175), pure: which month
 * `?month=` names, the calendar days in it, what one cell says, and a row's
 * hours and days.
 *
 * **The verdict is the client's, from the server's facts.** A cell is full,
 * under or nothing against `threshold_minutes` as served — never a number
 * typed here — on a working day the person was here for and that has passed
 * in their own zone (`joined_day`, `today_day`, `work_days`, all the server's).
 * Today is hours so far, with no verdict; a day off with time on it counts
 * toward hours and never toward days.
 */

const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;

/** The month `?month=` names, read leniently: anything else is the reader's current month. */
export function monthKey(value: string | null | undefined, today: string): string {
  return value !== null && value !== undefined && MONTH.test(value) ? value : today.slice(0, 7);
}

export interface MonthDay {
  readonly day: string;
  /** ISO weekday, 1 Monday to 7 Sunday. */
  readonly dow: number;
  /** The day of the month, 1 to 31. */
  readonly date: number;
  readonly weekend: boolean;
}

export interface MonthDays {
  readonly from: string;
  readonly to: string;
  readonly days: readonly MonthDay[];
}

/** ISO weekday of `day`: 1 Monday … 7 Sunday. */
export function isoWeekday(day: string): number {
  const sunday0 = new Date(`${day}T00:00:00Z`).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

/** Every calendar day of `month` (`YYYY-MM`), first to last. */
export function monthDays(month: string): MonthDays {
  const { from, to } = monthOf(`${month}-01`);
  const days: MonthDay[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) {
    const dow = isoWeekday(d);
    days.push({ day: d, dow, date: Number(d.slice(8, 10)), weekend: dow >= 6 });
  }
  return { from, to, days };
}

/** `November 2026`. */
export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `Mon 2 Nov` — a column's full name. */
export function dayWords(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** `Mon`, `Tue` … for a column's head. */
export function weekdayShort(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

/** The grid's own address: no `month=` for the current month, so the plain address is today's. */
export function monthHref(month: string, current: string): string {
  return month === current
    ? '/insights?tab=time&view=days'
    : `/insights?tab=time&view=days&month=${month}`;
}

/** `month` moved by `delta` months, across a year end. */
export function stepMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

/** The person's working days, Monday to Friday when they set none (the server's fallback, held again). */
export function isWorkingDay(workDays: readonly number[], day: string): boolean {
  const days = workDays.length === 0 ? [1, 2, 3, 4, 5] : workDays;
  return days.includes(isoWeekday(day));
}

/** Confirmed and drafted minutes the person has on `day`, or zeros. */
export function minutesOn(
  person: TimeLoggingPerson,
  day: string,
): { readonly confirmed: number; readonly drafted: number } {
  const row = person.days.find((d) => d.day === day);
  return row === undefined
    ? { confirmed: 0, drafted: 0 }
    : { confirmed: row.confirmed_minutes, drafted: row.drafted_minutes };
}

/**
 * What a cell is. `future`, `before`, `off` and `left` are no verdict —
 * nothing was due, though time on the day is still shown; `today` is hours
 * so far; `full`, `under` and `none` are the day against the threshold.
 */
export type CellState = 'full' | 'under' | 'none' | 'today' | 'off' | 'before' | 'future' | 'left';

/** The words a cell's state is said in, for the legend, hover and a screen reader. */
export const CELL_WORDS: Readonly<Record<CellState, string>> = {
  full: 'full day',
  under: 'under the day',
  none: 'nothing logged',
  today: 'so far today',
  off: 'not a working day',
  before: 'before they joined',
  future: 'not yet',
  left: 'no longer here',
};

/** A text glyph beside every figure, so no verdict is colour alone. */
export const CELL_GLYPHS: Readonly<Record<CellState, string>> = {
  full: '✓',
  under: '◷',
  none: '✕',
  today: '—',
  off: '—',
  before: '—',
  future: '—',
  left: '—',
};

export interface Cell {
  readonly state: CellState;
  readonly minutes: number;
  readonly confirmed: number;
  readonly drafted: number;
  readonly glyph: string;
  /** `9h`, `1h 30m`; empty when there is nothing to say. */
  readonly figure: string;
  /** For `aria-label` and `title`: the person, the day, the hours, the words. */
  readonly aria: string;
}

/**
 * One cell, by precedence: a day not yet come, a day before the person
 * joined, today, a person who has left, a day off, then the verdict. The
 * threshold is the server's. A deactivated person owes no day (D-148 item
 * 5), so none of theirs is a verdict — their time is still shown.
 */
export function cellState(person: TimeLoggingPerson, day: string, threshold: number): Cell {
  const { confirmed, drafted } = minutesOn(person, day);
  const minutes = confirmed + drafted;
  let state: CellState;
  if (day > person.today_day) state = 'future';
  else if (day < person.joined_day) state = 'before';
  else if (day === person.today_day) state = 'today';
  else if (person.user.deactivated) state = 'left';
  else if (!isWorkingDay(person.work_days, day)) state = 'off';
  else if (minutes >= threshold) state = 'full';
  else if (minutes === 0) state = 'none';
  else state = 'under';
  const figure = minutes > 0 ? hoursCompact(minutes) : '';
  const hours = minutes > 0 ? `${hoursCompact(minutes)}, ` : '';
  const words =
    state === 'under'
      ? `under ${hoursCompact(threshold)}`
      : state === 'full'
        ? `${hoursCompact(threshold)} or more, full day`
        : CELL_WORDS[state];
  return {
    state,
    minutes,
    confirmed,
    drafted,
    glyph: CELL_GLYPHS[state],
    figure,
    aria: `${person.user.name}, ${dayWords(day)}: ${hours}${words}`,
  };
}

/**
 * Whether a cell is a door to the person's Day: any day with time on it,
 * whatever its state, and a due day — today, or a working day with nothing
 * logged. A day that owed nothing and holds nothing is a dash and no more.
 */
export function isDoor(cell: Cell): boolean {
  return cell.minutes > 0 || cell.state === 'none' || cell.state === 'today';
}

/**
 * The days this person owed the month: their working days from the day
 * they joined up to yesterday in their zone. None for a deactivated person
 * — nothing says when they left, so nothing is owed.
 */
export function dueDays(person: TimeLoggingPerson, days: readonly MonthDay[]): number {
  if (person.user.deactivated) return 0;
  return days.filter(
    (d) =>
      d.day >= person.joined_day &&
      d.day < person.today_day &&
      isWorkingDay(person.work_days, d.day),
  ).length;
}

export interface RowTotals {
  /** Every minute in the month: confirmed and drafted, days off and today included. */
  readonly minutes: number;
  /** Due days that reached the threshold. */
  readonly full: number;
  readonly due: number;
}

export function rowTotals(
  person: TimeLoggingPerson,
  days: readonly MonthDay[],
  threshold: number,
): RowTotals {
  let minutes = 0;
  let full = 0;
  for (const d of days) {
    const cell = cellState(person, d.day, threshold);
    minutes += cell.minutes;
    if (cell.state === 'full' && !person.user.deactivated) full += 1;
  }
  return { minutes, full, due: dueDays(person, days) };
}

/** That person's Day on their profile (D-140): the cell is a door. */
export function dayHref(userId: string, day: string): string {
  return `/people?${new URLSearchParams({ user: userId, tab: 'day', day }).toString()}`;
}
