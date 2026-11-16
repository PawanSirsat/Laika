import {
  offDescription,
  offKind,
  offOwes,
  type OffDayEntry,
  type OffKind,
} from '../../../api/off-days.ts';
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
 *
 * **Holidays and leave are facts too** (D-149 item 6, LAI-1185): a holiday
 * covering the person, or approved whole-day leave, owes nothing; approved
 * half-day leave owes half the threshold; pending leave changes nothing. What
 * a day owes is decided once, in {@link owedOn}, for the cell and the row's
 * due days alike — `offOwes` in `api/off-days.ts` says it for My day too.
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
 * What a cell is. `future`, `before`, `holiday`, `leave`, `off` and `left`
 * are no verdict — nothing was due, though time on the day is still shown;
 * `today` is hours so far; `full`, `under` and `none` are the day against
 * what it owed.
 */
export type CellState =
  'full' | 'under' | 'none' | 'today' | 'holiday' | 'leave' | 'off' | 'before' | 'future' | 'left';

/** The words a cell's state is said in, for the legend, hover and a screen reader. */
export const CELL_WORDS: Readonly<Record<CellState, string>> = {
  full: 'full day',
  under: 'under the day',
  none: 'nothing logged',
  today: 'so far today',
  holiday: 'a holiday — not due',
  leave: 'on leave — not due',
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
  holiday: '✱',
  leave: '◐',
  off: '—',
  before: '—',
  future: '—',
  left: '—',
};

/** The person's holiday or leave on `day`, as the server sent it, or null. */
export function offOn(person: TimeLoggingPerson, day: string): OffDayEntry | null {
  return person.off_days.find((d) => d.day === day) ?? null;
}

/** A day that owes nothing, and why; or the share of the threshold it owes. */
export type Owed =
  | { readonly due: false; readonly state: Exclude<CellState, 'full' | 'under' | 'none'> }
  | { readonly due: true; readonly share: 1 | 0.5 };

/**
 * What `day` owed the person, by precedence: a day not yet come, a day
 * before they joined, today, a person who has left, a holiday or approved
 * whole-day leave, a day off — then the day is due, the whole threshold, or
 * half of it under approved half-day leave. Pending leave owes as if it were
 * not there (D-149 item 6). A deactivated person owes no day (D-148 item 5).
 */
export function owedOn(person: TimeLoggingPerson, day: string): Owed {
  if (day > person.today_day) return { due: false, state: 'future' };
  if (day < person.joined_day) return { due: false, state: 'before' };
  if (day === person.today_day) return { due: false, state: 'today' };
  if (person.user.deactivated) return { due: false, state: 'left' };
  const off = offOn(person, day);
  const owes = offOwes(off);
  if (owes === 'nothing') {
    return { due: false, state: off !== null && off.holiday !== null ? 'holiday' : 'leave' };
  }
  if (!isWorkingDay(person.work_days, day)) return { due: false, state: 'off' };
  return { due: true, share: owes === 'half' ? 0.5 : 1 };
}

export interface Cell {
  readonly state: CellState;
  readonly minutes: number;
  readonly confirmed: number;
  readonly drafted: number;
  /** The minutes the day owed — the threshold, or half of it — or null when nothing was due. */
  readonly owed: number | null;
  /** A holiday, leave or leave requested on the day, whatever its state; null on an ordinary day. */
  readonly off: OffKind | null;
  readonly glyph: string;
  /** `9h`, `1h 30m`; empty when there is nothing to say. */
  readonly figure: string;
  /** For `aria-label` and `title`: the person, the day, the hours, the words. */
  readonly aria: string;
}

/**
 * One cell: {@link owedOn}'s state, or the verdict against what the day
 * owed. The threshold is the server's, halved for half-day leave. A holiday
 * or leave on any day is said in the words — *Heritage Day — not due*, or
 * after the verdict, *under 4h, On leave · morning* — so a mark is never
 * colour alone.
 */
export function cellState(person: TimeLoggingPerson, day: string, threshold: number): Cell {
  const { confirmed, drafted } = minutesOn(person, day);
  const minutes = confirmed + drafted;
  const owed = owedOn(person, day);
  const due = owed.due ? threshold * owed.share : null;
  let state: CellState;
  if (!owed.due) state = owed.state;
  else if (minutes >= (due ?? threshold)) state = 'full';
  else if (minutes === 0) state = 'none';
  else state = 'under';
  const off = offOn(person, day);
  const about = offDescription(off);
  const figure = minutes > 0 ? hoursCompact(minutes) : '';
  const hours = minutes > 0 ? `${hoursCompact(minutes)}, ` : '';
  const verdict =
    state === 'under'
      ? `under ${hoursCompact(due ?? threshold)}`
      : state === 'full'
        ? `${hoursCompact(due ?? threshold)} or more, full day`
        : CELL_WORDS[state];
  const words =
    (state === 'holiday' || state === 'leave') && about !== null
      ? `${about} — not due`
      : about === null
        ? verdict
        : `${verdict}, ${about}`;
  return {
    state,
    minutes,
    confirmed,
    drafted,
    owed: due,
    off: offKind(off),
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
 * they joined up to yesterday in their zone, less the holidays that cover
 * them and their approved whole-day leave — {@link owedOn}'s due days. A
 * half day is a due day. None for a deactivated person — nothing says when
 * they left, so nothing is owed.
 */
export function dueDays(person: TimeLoggingPerson, days: readonly MonthDay[]): number {
  return days.filter((d) => owedOn(person, d.day).due).length;
}

/**
 * The holiday every person shown has on `day`, under the same name — a
 * column's head says it then, and only then. Null when anyone is without it,
 * or the names differ, or nobody is shown.
 */
export function sharedHoliday(people: readonly TimeLoggingPerson[], day: string): string | null {
  let label: string | null = null;
  for (const p of people) {
    const h = offOn(p, day)?.holiday ?? null;
    if (h === null || (label !== null && h.label !== label)) return null;
    label = h.label;
  }
  return label;
}

/**
 * Which day-off marks the grid draws, so the legend explains what is drawn
 * and only that. Read from the cells as {@link cellState} makes them, never
 * from `off_days`: precedence hides some, and a holiday on a day not yet come
 * is a corner mark on a dash, not the holiday's fill.
 */
export interface OffMarks {
  /** A cell drawn as a holiday, not due. */
  readonly holiday: boolean;
  /** A cell drawn as approved whole-day leave, not due. */
  readonly leave: boolean;
  /** A due day under approved half-day leave — the solid corner mark. */
  readonly half: boolean;
  /** A due day with leave requested — the dashed corner mark. */
  readonly requested: boolean;
  /**
   * The kinds marked in the corner of a cell with no verdict — not yet,
   * before joining, today, someone gone, a day off — holiday, leave,
   * requested in that order; empty when there are none.
   */
  readonly quiet: readonly OffKind[];
}

const QUIET_ORDER: readonly OffKind[] = ['holiday', 'leave', 'requested'];

export function offMarks(
  people: readonly TimeLoggingPerson[],
  days: readonly MonthDay[],
  threshold: number,
): OffMarks {
  let holiday = false;
  let leave = false;
  let half = false;
  let requested = false;
  const quiet = new Set<OffKind>();
  for (const p of people) {
    for (const d of days) {
      const cell = cellState(p, d.day, threshold);
      if (cell.off === null) continue;
      if (cell.state === 'holiday') holiday = true;
      else if (cell.state === 'leave') leave = true;
      // A due day can only carry half-day leave or a request: a holiday or
      // whole-day leave would have made it not due.
      else if (cell.owed !== null) {
        if (cell.off === 'requested') requested = true;
        else half = true;
      } else quiet.add(cell.off);
    }
  }
  return { holiday, leave, half, requested, quiet: QUIET_ORDER.filter((k) => quiet.has(k)) };
}

export interface RowTotals {
  /** Every minute in the month: confirmed and drafted, days off, holidays, leave and today included. */
  readonly minutes: number;
  /** Due days that reached what they owed — a holiday or a day on leave never does. */
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
