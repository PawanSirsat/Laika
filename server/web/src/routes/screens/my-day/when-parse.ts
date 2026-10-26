import { parseClock } from '../../../api/time-label.ts';
import { parseMinutes } from './my-day-derive.ts';

/**
 * The editor's WHEN fields (the owner's design, D-110 item 9, LAI-504): a
 * start, an end and a length, typed the way a person types them — `14:15`,
 * `2:15pm`, `2:15 PM`; `45`, `45m`, `1h 15`, `1:15`. Changing one updates
 * the others; the maths is here, the fields draw it.
 */

export const DAY_MINUTES = 1440;
export const SHORTEST = 5;

/** A time of day typed, as minutes after midnight; a bare `2:35` reads as the side of noon nearest `near`. */
export function clockMinute(text: string, near: number): number | undefined {
  const parsed = parseClock(text);
  if (parsed === undefined) return undefined;
  if (!parsed.ambiguous) return parsed.minute;
  const other = (parsed.minute + 720) % DAY_MINUTES;
  return Math.abs(parsed.minute - near) <= Math.abs(other - near) ? parsed.minute : other;
}

/** A length typed, in minutes. */
export function lengthMinutes(text: string): number | undefined {
  return parseMinutes(text);
}

export interface WhenSpan {
  readonly start: number;
  readonly end: number;
}

export type WhenRefusal = 'short' | 'midnight' | 'before' | 'after';

export const WHEN_WORDS: Readonly<Record<WhenRefusal, string>> = {
  short: `An entry needs at least ${String(SHORTEST)} min.`,
  midnight: 'An entry can’t cross midnight. Split it at 12:00 AM.',
  before: 'That starts before the Timeline does.',
  after: 'That ends after the Timeline does.',
};

/**
 * A new start keeps the end; a new end keeps the start; a new length keeps
 * the start. Refused when the span would be under five minutes, cross
 * midnight, or run past `lo` or `hi` — its day, or the Timeline's window for
 * a block with no set time. Confirmed time is no bound (LAI-528, D-113).
 */
export function whenFrom(
  current: WhenSpan,
  change: { readonly start?: number; readonly end?: number; readonly length?: number },
  limits: { readonly lo: number; readonly hi: number },
): { readonly span: WhenSpan } | { readonly refused: WhenRefusal } {
  let { start, end } = current;
  if (change.start !== undefined) start = change.start;
  if (change.end !== undefined) end = change.end;
  if (change.length !== undefined) end = start + change.length;
  if (end > DAY_MINUTES || start < 0) return { refused: 'midnight' };
  if (end - start < SHORTEST) return { refused: 'short' };
  if (start < limits.lo) return { refused: 'before' };
  if (end > limits.hi) return { refused: 'after' };
  return { span: { start, end } };
}
