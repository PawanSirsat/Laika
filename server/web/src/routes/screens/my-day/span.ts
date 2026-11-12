import { addDays } from './my-day-derive.ts';

/**
 * My day's **View** (LAI-1174, the owner's *My Day Calendar Zoom* design):
 * Day, Week, Month or Year around the day in `?day=`. Called `span` in code
 * and in the address because *zoom* is already the Timeline's hour scale.
 *
 * Every day here is a `YYYY-MM-DD` string, as the rest of My day's — no
 * `Date` in the reader's zone, so a period never shifts by a day at a clock
 * change.
 */

export const SPANS = ['day', 'week', 'month', 'year'] as const;
export type Span = (typeof SPANS)[number];

export const SPAN_LABELS: Readonly<Record<Span, string>> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};

/** `?span=` as written; anything else is Day, the page as it always was. */
export function parseSpan(value: string | null | undefined): Span {
  return (SPANS as readonly string[]).includes(value ?? '') ? (value as Span) : 'day';
}

/** One step finer (towards Day) or coarser (towards Year); undefined past the end. */
export function zoomSpan(span: Span, by: 'in' | 'out'): Span | undefined {
  const i = SPANS.indexOf(span) + (by === 'in' ? -1 : 1);
  return SPANS[i];
}

const utc = (day: string): Date => new Date(`${day}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** The Monday on or before a day — the server's `mondayOf`. */
export function mondayOf(day: string): string {
  return addDays(day, -((utc(day).getUTCDay() + 6) % 7));
}

/** The ISO week number of a day: the week holding its Thursday. */
export function isoWeek(day: string): number {
  const thursday = utc(addDays(mondayOf(day), 3));
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
}

export const monthKey = (day: string): string => day.slice(0, 7);
export const yearOf = (day: string): number => Number(day.slice(0, 4));

/** The first and last day of the month holding a day. */
export function monthBounds(day: string): { first: string; last: string } {
  const d = utc(day);
  const first = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const last = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  return { first, last };
}

/** Monday-first weeks covering a month, spill-over days included: 4 to 6 rows of 7. */
export function monthWeeks(day: string): string[][] {
  const { first, last } = monthBounds(day);
  const weeks: string[][] = [];
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
  }
  return weeks;
}

/** The days a span shows, first and last — what it has to read. */
export function periodOf(span: Span, day: string): { from: string; to: string } {
  if (span === 'day') return { from: day, to: day };
  if (span === 'week') {
    const monday = mondayOf(day);
    return { from: monday, to: addDays(monday, 6) };
  }
  if (span === 'month') {
    const weeks = monthWeeks(day);
    return { from: weeks[0]?.[0] ?? day, to: weeks.at(-1)?.[6] ?? day };
  }
  const year = yearOf(day);
  return { from: `${String(year)}-01-01`, to: `${String(year)}-12-31` };
}

/**
 * The same day one period on or back. A month keeps the day of the month
 * where it can (31 Jan → 28 Feb), a year keeps the date (29 Feb → 28 Feb).
 */
export function stepPeriod(span: Span, day: string, by: 1 | -1): string {
  if (span === 'day') return addDays(day, by);
  if (span === 'week') return addDays(day, 7 * by);
  const d = utc(day);
  const months = span === 'month' ? by : 12 * by;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastOfTarget));
  return iso(target);
}

/** Whether a period's first day is after today — the Next button's limit. */
export function startsAfter(span: Span, day: string, today: string): boolean {
  // A month starts on its 1st, not on the Monday its grid begins with.
  const from = span === 'month' ? monthBounds(day).first : periodOf(span, day).from;
  return from > today;
}

/**
 * Where a coarser period lands when the reader opens one of its parts: the
 * day they were on if it is inside, else today if it is, else the part's
 * first day (the design's `anchorIn` and `inWeek`).
 */
export function anchorIn(from: string, to: string, current: string, today: string): string {
  if (current >= from && current <= to) return current;
  if (today >= from && today <= to) return today;
  return from;
}

/**
 * Year in reads the server takes: at most 92 days each (the summary's
 * `stretch()`, LAI-1173), so a year is four.
 */
export function chunks(from: string, to: string, max = 92): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let start = from; start <= to;) {
    let end = addDays(start, max - 1);
    if (end > to) end = to;
    out.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return out;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const monthName = (day: string): string => MONTHS[utc(day).getUTCMonth()] ?? '';

/** What a span is called above it: `Week 46 · 9 – 15 November`, `November 2026`, `2026`. */
export function periodLabel(span: Span, day: string): string {
  if (span === 'year') return String(yearOf(day));
  if (span === 'month') return `${monthName(day)} ${String(yearOf(day))}`;
  if (span === 'week') {
    const monday = mondayOf(day);
    const sunday = addDays(monday, 6);
    const a = utc(monday);
    const b = utc(sunday);
    const range =
      a.getUTCMonth() === b.getUTCMonth()
        ? `${String(a.getUTCDate())} – ${String(b.getUTCDate())} ${monthName(sunday)}`
        : `${String(a.getUTCDate())} ${monthName(monday).slice(0, 3)} – ${String(b.getUTCDate())} ${monthName(sunday).slice(0, 3)}`;
    return `Week ${String(isoWeek(day))} · ${range}`;
  }
  return day;
}
