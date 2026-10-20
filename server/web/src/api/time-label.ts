/**
 * How a moment reads on screen (LAI-486, D-065).
 *
 * **Relative for a day, then a date and time**, the form the owner chose from
 * a preview:
 *
 * ```
 * just now             ← under a minute
 * 4 min ago            ← under an hour  (fresh: drawn in the accent)
 * 3 h ago              ← under a day
 * 27 Sep, 2:05 PM      ← a day or more, this year
 * 14 Mar 2025, 9:12 AM ← another year
 * hover → Sat 27 Sep 2026, 2:05:31 PM
 * ```
 *
 * `updatedAge` said `8d` for a week-old task and `365d` for a year-old one.
 * Neither could be read as *when*, and the List's CREATED and UPDATED were
 * the columns where "when" is the whole point.
 *
 * **Built from fixed names, not `Intl`.** Day-month order is the approved
 * form, and `en-GB` in current ICU abbreviates September as `Sept`. A table of
 * names gives exactly `27 Sep` in every browser and cannot be changed by a
 * developer's locale. **The viewer's own timezone** is kept: the local getters
 * are used, so `2:05 PM` is the reader's 2:05 PM.
 *
 * **The clock is 12-hour with AM/PM, whatever the locale** (LAI-830): the
 * owner asked for it everywhere in the web app. {@link clockTime},
 * {@link clockRange} and {@link dateTime} are the one place a time of day
 * becomes text, and every screen that prints one calls them.
 *
 * **Deliberately not used everywhere.** The board card keeps `updatedAge`'s
 * compact `2h`, because a card footer has no room for `27 Sep, 14:05`, and the
 * Dashboard keeps its own `relativeTime`. Both were left on purpose, not
 * missed.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface TimeLabel {
  /** What the cell says: `just now`, `4 min ago`, `3 h ago`, `27 Sep, 2:05 PM`. */
  readonly text: string;
  /** The full moment, for a tooltip: `Sat 27 Sep 2026, 2:05:31 PM`. */
  readonly full: string;
  /** For `<time dateTime>`. */
  readonly iso: string;
  /** Under an hour old — the rows the owner asked to stand out. */
  readonly fresh: boolean;
}

export interface ClockOptions {
  /** An IANA zone, such as a time entry's own; the reader's zone when absent. */
  readonly timeZone?: string;
  /** `2:05:31 PM` rather than `2:05 PM`. */
  readonly seconds?: boolean;
}

interface ClockParts {
  /** `2:05`, or `2:05:31` with seconds. */
  readonly time: string;
  readonly period: 'AM' | 'PM';
}

const FORMATS = new Map<string, Intl.DateTimeFormat>();

/**
 * **Explicit options, never the locale's default** (LAI-830): `en-US` with
 * `hour12: true` gives the numbers and the day period in every browser, and
 * the parts are joined here with an ordinary space — ICU's own output puts a
 * narrow no-break space before `PM` in some versions and not in others.
 */
function clockParts(at: number, options: ClockOptions): ClockParts {
  const key = `${options.timeZone ?? ''}|${options.seconds === true ? 's' : ''}`;
  let format = FORMATS.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      ...(options.seconds === true ? { second: '2-digit' } : {}),
      hour12: true,
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    });
    FORMATS.set(key, format);
  }
  const parts = format.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const time = [part('hour'), part('minute'), ...(options.seconds === true ? [part('second')] : [])]
    .filter((p) => p !== '')
    .join(':');
  return { time, period: part('dayPeriod').toUpperCase() === 'AM' ? 'AM' : 'PM' };
}

/** `2:29 PM`, `12:05 AM` — a time of day on the 12-hour clock. */
export function clockTime(at: number, options: ClockOptions = {}): string {
  const { time, period } = clockParts(at, options);
  return `${time} ${period}`;
}

/**
 * `2:29–2:48 PM` — **one AM/PM when both ends share it** — or
 * `11:40 AM–12:10 PM` when they do not.
 */
export function clockRange(
  from: number,
  to: number,
  options: Pick<ClockOptions, 'timeZone'> = {},
): string {
  const a = clockParts(from, options);
  const b = clockParts(to, options);
  return a.period === b.period
    ? `${a.time}–${b.time} ${b.period}`
    : `${a.time} ${a.period}–${b.time} ${b.period}`;
}

/** `20 Oct, 2:29 PM`, or `20 Oct 2025, 2:29 PM` in another year — in the reader's zone. */
export function dateTime(at: number, now: number): string {
  const when = new Date(at);
  const day = `${String(when.getDate())} ${MONTHS[when.getMonth()] ?? ''}`;
  const sameYear = when.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? day : `${day} ${String(when.getFullYear())}`}, ${clockTime(at)}`;
}

/** An hour of the day, 0–23 or 24, on the 12-hour clock. */
function twelve(hour: number): { readonly hour: string; readonly period: 'AM' | 'PM' } {
  const h = ((hour % 24) + 24) % 24;
  return { hour: String(h % 12 === 0 ? 12 : h % 12), period: h < 12 ? 'AM' : 'PM' };
}

/** `8 AM`, `12 PM`, `6 PM` — an hour of the day on an axis; 24 is midnight again. */
export function hourLabel(hour: number): string {
  const { hour: h, period } = twelve(hour);
  return `${h} ${period}`;
}

/**
 * `9:00 AM` — a minute after midnight, as a setting stores it rather than an
 * instant: no zone, no date. It reads back through {@link parseClock}.
 */
export function minuteClock(minute: number): string {
  const { hour, period } = twelve(Math.floor(minute / 60));
  return `${hour}:${String(minute % 60).padStart(2, '0')} ${period}`;
}

/** A time of day as typed: the minute after midnight it names. */
export interface ParsedClock {
  /** 0–1439, read on the 24-hour clock when no AM/PM was typed. */
  readonly minute: number;
  /**
   * No AM/PM, and an hour from 1 to 12 — `2:35` could be either. The reader
   * of the answer decides which: My day's *Split…* takes the one inside the
   * block. `minute + 720` (mod a day) is the other reading.
   */
  readonly ambiguous: boolean;
}

/**
 * `2:35 PM`, `2:35pm`, `2:35 p.m.`, `2pm`, `14:35`, `2:35` — a time of day
 * the way a person types it, now that the screen shows a 12-hour clock
 * (LAI-830). The 24-hour form is still read. Anything else is `undefined`.
 */
export function parseClock(text: string): ParsedClock | undefined {
  const t = text.trim().toLowerCase().replace(/[\s.]/g, '');
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (match === null) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const period = match[3];
  if (minute > 59) return undefined;
  if (period !== undefined) {
    if (hour < 1 || hour > 12) return undefined;
    const h = (hour % 12) + (period.startsWith('p') ? 12 : 0);
    return { minute: h * 60 + minute, ambiguous: false };
  }
  // Without AM/PM a bare hour is not a time: `14` could be a duration.
  if (match[2] === undefined || hour > 23) return undefined;
  return { minute: hour * 60 + minute, ambiguous: hour >= 1 && hour <= 12 };
}

/**
 * Read `at` as of `now`. **`now` is passed in, never read here**, which is what
 * keeps this testable at every edge. It is the same rule `staleFor` follows.
 */
export function timeLabel(at: number, now: number): TimeLabel {
  /*
   * **Clamped, and the clamp is belt-and-braces.** A clock-skewed stamp from
   * the future has a negative age, and today **the branch order alone** sends
   * it to `just now`: a negative is below a minute. The clamp is for the day
   * that order changes — guard the first branch as `elapsed >= 0 && …` and an
   * unclamped negative would fall through to the date branch. Measured
   * (LAI-486): removing the clamp leaves every test green, which is the
   * `staleFor` pair exactly — keep both, and do not read a green as proof the
   * clamp is dead.
   */
  const elapsed = Math.max(0, now - at);
  const when = new Date(at);

  const full = `${DAYS[when.getDay()] ?? ''} ${String(when.getDate())} ${MONTHS[when.getMonth()] ?? ''} ${String(when.getFullYear())}, ${clockTime(at, { seconds: true })}`;
  const iso = when.toISOString();
  const fresh = elapsed < HOUR;

  let text: string;
  if (elapsed < MINUTE) {
    text = 'just now';
  } else if (elapsed < HOUR) {
    text = `${String(Math.floor(elapsed / MINUTE))} min ago`;
  } else if (elapsed < DAY) {
    text = `${String(Math.floor(elapsed / HOUR))} h ago`;
  } else {
    text = dateTime(at, now);
  }

  return { text, full, iso, fresh };
}

/** The timer functions, injectable so a test can prove the stop is real. */
export interface Timers {
  readonly setInterval: (run: () => void, ms: number) => unknown;
  readonly clearInterval: (id: unknown) => void;
}

const REAL: Timers = {
  setInterval: (run, ms) => globalThis.setInterval(run, ms),
  clearInterval: (id) => {
    globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>);
  },
};

/**
 * Call `onTick` every `everyMs`, and return the function that stops it
 * (LAI-486).
 *
 * A table left open must not say `just now` for ever, so it re-renders on a
 * tick. The stop is returned **as the value**, so a `useEffect` that returns it
 * cannot forget to clear. A test injects fake timers and checks that the stop
 * clears the very interval that was started.
 */
export function startTicker(
  onTick: () => void,
  everyMs: number,
  timers: Timers = REAL,
): () => void {
  const id = timers.setInterval(onTick, everyMs);
  return () => {
    timers.clearInterval(id);
  };
}
