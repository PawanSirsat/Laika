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

/** How many zones' formatters are kept at once (LAI-751 review). */
export const FORMATTERS_MAX = 64;

/**
 * Formatters kept, **by the zone's canonical name**, at most `FORMATTERS_MAX`
 * of them, the least recently used dropped first. Building an
 * `Intl.DateTimeFormat` is the slow part, and a deployment's zones are few —
 * but `Intl` accepts any capitalisation of a name and offsets such as
 * `+01:00`, and a zone is the sender's text, so a cache keyed by what was
 * sent would grow with every spelling. Keyed by `resolvedOptions().timeZone`
 * and capped, it cannot. A spelling that is not canonical builds a formatter
 * to learn its name and keeps nothing extra; an unknown zone throws before
 * anything is kept.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const kept = formatters.get(timeZone);
  if (kept !== undefined) {
    // Most recently used last: the first key is the one to drop.
    formatters.delete(timeZone);
    formatters.set(timeZone, kept);
    return kept;
  }
  // `en-CA` writes `YYYY-MM-DD`, the one locale whose short date is ISO.
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const canonical = format.resolvedOptions().timeZone;
  const same = formatters.get(canonical);
  if (same !== undefined) return same;
  formatters.set(canonical, format);
  if (formatters.size > FORMATTERS_MAX) {
    const oldest = formatters.keys().next();
    if (oldest.done !== true) formatters.delete(oldest.value);
  }
  return format;
}

/** The zones a formatter is kept for, oldest first — for the bound's tests. */
export function keptZones(): string[] {
  return [...formatters.keys()];
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
