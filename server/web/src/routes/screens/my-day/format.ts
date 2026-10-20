import { agentMinutes, clockIn, hm } from './my-day-derive.ts';

/**
 * **Every time and duration My day prints goes through here** (LAI-831,
 * CHIEF's addition A): one seam, so the page follows LAI-830's shared helpers
 * — durations as `19 min` and `1 h 35 min`, never `h:mm`, and the 12-hour
 * clock — without a formatter of its own. Nothing else in `my-day/` formats a
 * time for display.
 */

/** The person's own time: `19 min`, `1 h 35 min`. */
export function duration(minutes: number): string {
  return hm(minutes);
}

/** An agent's time, minutes however long (D-088 item 8): `142 min`. */
export function agentDuration(minutes: number): string {
  return agentMinutes(minutes);
}

/** A time of day in `tz`: `2:29 PM`. */
export function clock(at: number, tz: string): string {
  return clockIn(tz, at);
}

/** From and to in `tz`, one AM/PM when they share it: `2:29–2:48 PM`. */
export function span(from: number, to: number, tz: string): string {
  return `${clockIn(tz, from)}–${clockIn(tz, to)}`;
}

/** An hour on the timeline's axis, `0`–`24`: `6 AM`, `12 PM`. */
export function hourName(hour: number): string {
  return String(hour).padStart(2, '0');
}
