import { RATING_NOTE_MAX } from '../../../api/profiles.ts';

/**
 * How the member profile's figures read (LAI-743).
 *
 * Every figure is the server's (`GET /users/:id/profile`); nothing here counts
 * or combines anything. These functions only decide how a number is said — and
 * the one rule that matters is that an absence is never said as a zero.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One decimal, and none when it is `.0` — `3 d`, `1.8 d`. */
function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A duration at the scale it is: minutes, hours, then days. `null` is a cycle
 * nobody measured and reads as a dash, never as `0`.
 */
export function durationLabel(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < HOUR) return `${String(Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${oneDecimal(ms / HOUR)} h`;
  return `${oneDecimal(ms / DAY)} d`;
}

/** The Monday a week starts on, in UTC — the server's week, not the reader's. */
export function weekLabel(weekStart: number): string {
  const day = new Date(weekStart);
  return `${String(day.getUTCDate())} ${MONTHS[day.getUTCMonth()] ?? ''}`;
}

/** `Aug 2026` — when somebody joined, in UTC. */
export function monthYear(at: number): string {
  const day = new Date(at);
  return `${MONTHS[day.getUTCMonth()] ?? ''} ${String(day.getUTCFullYear())}`;
}

/** Each week's bar as a share of the busiest; all zero when nothing was accepted. */
export function barHeights(counts: readonly number[]): number[] {
  const most = Math.max(0, ...counts);
  return counts.map((count) => (most === 0 ? 0 : count / most));
}

export function scoreLabel(score: number): string {
  return `${String(score)} / 5`;
}

/**
 * What stops the rating form, in the reader's words — or `undefined` when the
 * server would take it. The same rules the server applies (§4.21), so the
 * button is not enabled for a request that can only come back `422`.
 */
export function ratingProblem(score: number | undefined, note: string): string | undefined {
  if (score === undefined) return 'Choose a score from 1 to 5.';
  const trimmed = note.trim();
  if (trimmed === '') return 'Write a short note — what the rating is based on.';
  if (trimmed.length > RATING_NOTE_MAX) {
    return `Keep the note to ${String(RATING_NOTE_MAX)} characters.`;
  }
  return undefined;
}
