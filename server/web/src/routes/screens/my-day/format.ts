import { formatDuration } from '../../../api/duration.ts';
import { clockRange, clockTime, hourLabel } from '../../../api/time-label.ts';

/**
 * **Every time and duration My day prints goes through here** (LAI-831,
 * CHIEF's addition A): one seam, so the page follows LAI-830's shared helpers
 * — durations as `19 min` and `1 h 35 min`, never `h:mm`, and the 12-hour
 * clock — without a formatter of its own. Nothing else in `my-day/` formats a
 * time for display.
 */

/** The person's own time: `19 min`, `1 h 35 min`. */
export function duration(minutes: number): string {
  return formatDuration(minutes);
}

/** An agent's time, minutes however long (D-088 item 8): `142 min`. */
export function agentDuration(minutes: number): string {
  return formatDuration(minutes, { largest: 'min' });
}

/** A time of day in `tz`: `2:29 PM`. */
export function clock(at: number, tz: string): string {
  return clockTime(at, { timeZone: tz });
}

/** From and to in `tz`, one AM/PM when they share it: `2:29–2:48 PM`. */
export function span(from: number, to: number, tz: string): string {
  return clockRange(from, to, { timeZone: tz });
}

/** An hour on the timeline's axis, `0`–`24`: `6 AM`, `12 PM`. */
export function hourName(hour: number): string {
  return hourLabel(hour);
}
