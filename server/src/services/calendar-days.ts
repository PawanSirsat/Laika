/**
 * Calendar days as `YYYY-MM-DD` strings, for the activity heatmap (D-079,
 * LAI-751).
 *
 * A day is a date, not an instant: a developer's machine reports its own local
 * dates, and the board's are UTC (§4.22). So days are compared and stepped as
 * strings and as UTC midnights, never as the instants a clock reads — adding
 * 24 hours to a local midnight lands on the wrong date twice a year.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD`, and a date that exists: `2026-02-30` is not one. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value;
}

/** `day` moved by `n` days, either way. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * One formatter per zone, kept: building an `Intl.DateTimeFormat` is the slow
 * part, and the zones a deployment sees are a handful. Bounded by the zones
 * that exist, because an unknown one throws before it is stored.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    // `en-CA` writes `YYYY-MM-DD`, the one locale whose short date is ISO.
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** Whether the runtime knows this IANA zone. Never throws. */
export function isTimeZone(value: string): boolean {
  if (value === '' || value.length > 64) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/** The date it is at `now` in `timeZone`. The zone must be valid. */
export function dayIn(timeZone: string, now: number): string {
  return formatterFor(timeZone).format(new Date(now));
}
