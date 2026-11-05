import type { AvailabilityRow, AvailabilitySeen, WorkWeek } from '../../api/availability.ts';

/**
 * What every availability screen derives from the server's answer (D-131,
 * D-137; LAI-1139): the pill, *updated N ago*, a working week in words, the
 * away dates. **Pure, and nothing computed past formatting**: no free hours,
 * no load ratio, no order but the server's A–Z (D-088 item 1).
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DAY_MS = 86_400_000;

function parts(day: string): { y: number; m: number; d: number; wd: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return undefined;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(at.getTime())) return undefined;
  return {
    y: at.getUTCFullYear(),
    m: at.getUTCMonth(),
    d: at.getUTCDate(),
    wd: (at.getUTCDay() + 6) % 7,
  };
}

/** `2026-11-16` → `Mon 16 Nov`. A date it cannot read is shown as sent. */
export function dayShort(day: string): string {
  const p = parts(day);
  if (p === undefined) return day;
  return `${WEEKDAYS[p.wd] ?? ''} ${String(p.d)} ${MONTHS[p.m] ?? ''}`;
}

/**
 * An away period: `Fri 20 – Mon 23 Nov` in one month, `Thu 24 Dec – Fri 1 Jan`
 * across two, `Mon 16 Nov` for a single day.
 */
export function rangeShort(from: string, to: string): string {
  if (from === to) return dayShort(from);
  const a = parts(from);
  const b = parts(to);
  if (a === undefined || b === undefined) return `${from} – ${to}`;
  if (a.y === b.y && a.m === b.m) return `${WEEKDAYS[a.wd] ?? ''} ${String(a.d)} – ${dayShort(to)}`;
  return `${dayShort(from)} – ${dayShort(to)}`;
}

export type PillTone = 'open' | 'capacity' | 'away';

export interface Pill {
  readonly tone: PillTone;
  /** A shape as well as a colour, so the pill never says it by colour alone. */
  readonly glyph: string;
  readonly label: string;
  /** `~6 h/wk` when they are open and said how much; empty otherwise. */
  readonly hours: string;
}

/**
 * The pill for what someone said, or `null` when they have said nothing — no
 * pill rather than a guess. A current away period wins over the status: a
 * person who is away is not taking work whatever they set before they left.
 */
export function pillOf(seen: AvailabilitySeen | null | undefined): Pill | null {
  if (seen === null || seen === undefined) return null;
  if (seen.away !== null) {
    return {
      tone: 'away',
      glyph: '◐',
      label: `Away until ${dayShort(seen.away.until)}`,
      hours: '',
    };
  }
  if (seen.status === 'open') {
    const h = seen.hours_per_week;
    return {
      tone: 'open',
      glyph: '●',
      label: 'Open to more work',
      hours: h === null || h === undefined ? '' : `~${String(h)} h/wk`,
    };
  }
  if (seen.status === 'capacity') {
    return { tone: 'capacity', glyph: '■', label: 'At capacity', hours: '' };
  }
  return null;
}

/** The pill in one sentence, for a screen reader. */
export function pillSentence(pill: Pill, hoursPerWeek?: number | null): string {
  return pill.hours === '' || hoursPerWeek === null || hoursPerWeek === undefined
    ? pill.label
    : `${pill.label}, can take about ${String(hoursPerWeek)} hours a week`;
}

/** *Can take* in a table: `~10 h/wk`, or a dash when they gave no number. */
export function canTake(seen: AvailabilitySeen | null | undefined): string {
  const h = seen?.hours_per_week;
  return h === null || h === undefined ? '—' : `~${String(h)} h/wk`;
}

/** Older than this, *updated* is muted and says it may be out of date. */
export const STALE_DAYS = 30;

export interface Updated {
  readonly text: string;
  readonly stale: boolean;
}

/**
 * `updated 3 days ago`. Always shown, never hidden and never reset: a
 * month-old declaration says so rather than passing for today's.
 */
export function updatedAgo(at: number | null | undefined, now: number): Updated | null {
  if (at === null || at === undefined) return null;
  const days = Math.max(0, Math.floor((now - at) / DAY_MS));
  const text =
    days === 0
      ? 'updated today'
      : days === 1
        ? 'updated yesterday'
        : days < 14
          ? `updated ${String(days)} days ago`
          : days < 60
            ? `updated ${String(Math.floor(days / 7))} weeks ago`
            : `updated ${String(Math.floor(days / 30))} months ago`;
  return { text, stale: days > STALE_DAYS };
}

/** ISO weekdays as runs: `[1,2,3,4,5]` → `Mon–Fri`, `[1,3,4]` → `Mon, Wed–Thu`. */
export function daysLine(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] ?? 0) + 1) j += 1;
    const a = WEEKDAYS[(sorted[i] ?? 1) - 1] ?? '';
    const b = WEEKDAYS[(sorted[j] ?? 1) - 1] ?? '';
    runs.push(i === j ? a : `${a}–${b}`);
    i = j + 1;
  }
  return runs.join(', ');
}

/** `Mon–Fri, 08:00–16:00`, or `null` when they set no working week. */
export function workWeekLine(week: WorkWeek | null | undefined): string | null {
  if (week === null || week === undefined || week.days.length === 0) return null;
  const days = daysLine(week.days);
  return week.start !== null && week.end !== null ? `${days}, ${week.start}–${week.end}` : days;
}

/** `21h 5m`, `40h`, `45m` — the short figure the Current load card prints. */
export function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)}m`;
  return m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
}

/** The first word of a name: the dialog's *Add <first name> to a project*. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Every tag on the list, A–Z and once each regardless of case, for the
 * *Skills / areas* filter. Read from the rows the server sent, so a filter
 * never offers a tag nobody carries.
 */
export function tagsOf(rows: readonly AvailabilityRow[]): readonly string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    for (const tag of row.availability?.tags ?? []) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** §4.85's limits, so the popover can say so before the server does. */
export const NOTE_MAX = 140;
export const TAGS_MAX = 8;
export const TAG_MAX = 32;
export const HOURS_MIN = 1;
export const HOURS_MAX = 80;

/**
 * A tag typed into the popover, added to `tags` — or the reason it is not.
 * The server checks the same rules and its `422` is still shown; this only
 * saves a round trip for the obvious ones.
 */
export function addTag(
  tags: readonly string[],
  typed: string,
): { readonly tags: readonly string[] } | { readonly problem: string } {
  const tag = typed.trim();
  if (tag === '') return { tags };
  if (tag.length > TAG_MAX) return { problem: `A tag is at most ${String(TAG_MAX)} characters.` };
  if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
    return { problem: `“${tag}” is already there.` };
  }
  if (tags.length >= TAGS_MAX) return { problem: `At most ${String(TAGS_MAX)} tags.` };
  return { tags: [...tags, tag] };
}

/**
 * A `422` from the availability endpoints, as the sentence to show beside the
 * field it names. The server's own message is the sentence; `field` says where.
 */
export function fieldOf(details: unknown): string | undefined {
  if (details === null || typeof details !== 'object') return undefined;
  const field = (details as { field?: unknown }).field;
  return typeof field === 'string' ? field : undefined;
}

/** `details.reason` of a refusal, when it carries one. */
export function reasonOf(details: unknown): string | undefined {
  if (details === null || typeof details !== 'object') return undefined;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}
