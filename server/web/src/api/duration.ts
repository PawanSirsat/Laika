/**
 * How long something took, in words (LAI-830) — **the one place a duration
 * becomes text** in the web app.
 *
 * ```
 * < 1 min        ← something that ran, for under a minute
 * 19 min         ← under an hour
 * 1 h 9 min      ← under a day, to the minute
 * 2 h            ← no `0 min` on the end
 * 3 d 4 h        ← a day or more, to the hour
 * ```
 *
 * My day printed `0:19` and `1:09`, and the owner asked *"is this minutes or
 * hours?"*. A duration therefore always says its units and never reads as a
 * clock. Elsewhere the same figure was `1.5 h`, `3d 4h`, `40m` or `1.8 d`,
 * depending on the screen; every one of those now comes from here.
 *
 * **Display only.** Minutes and milliseconds on the wire are unchanged, and
 * nothing an agent or the CLI reads is formatted here.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export interface DurationOptions {
  /**
   * Stay in minutes however long it is — `600 min`, never `10 h`. For an
   * agent's time, which D-088 item 8 says is shown as agent minutes, **never
   * as hours**, so it cannot be read as a person's hours beside them.
   */
  readonly minutesOnly?: boolean;
}

/**
 * `minutes` in words. Rounds to the whole minute under a day and to the whole
 * hour from a day on; anything that is not a positive number is `0 min`.
 */
export function formatDuration(minutes: number, options: DurationOptions = {}): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 1) return '< 1 min';

  const whole = Math.round(minutes);
  if (options.minutesOnly === true || whole < MINUTES_PER_HOUR) return `${String(whole)} min`;

  if (whole < MINUTES_PER_DAY) {
    const hours = Math.floor(whole / MINUTES_PER_HOUR);
    const rest = whole % MINUTES_PER_HOUR;
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
  }

  const hours = Math.round(whole / MINUTES_PER_HOUR);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${String(days)} d` : `${String(days)} d ${String(rest)} h`;
}

/** {@link formatDuration} for a figure in milliseconds, as most of the API sends them. */
export function formatDurationMs(ms: number, options: DurationOptions = {}): string {
  return formatDuration(ms / 60_000, options);
}
