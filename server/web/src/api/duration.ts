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
   * The largest unit to say; days when absent.
   *
   * - `'min'` — minutes however long: `600 min`, never `10 h`. An agent's
   *   time, which D-088 item 8 shows as agent minutes, **never as hours**, so
   *   it cannot be read as a person's hours beside them.
   * - `'h'` — hours past a day: `30 h`, not `1 d 6 h`. Effort's estimates say
   *   hours under two days and whole days beyond (LAI-785).
   */
  readonly largest?: 'min' | 'h';
}

/**
 * The minutes {@link formatDuration} says, after its rounding: to the whole
 * minute under a day, to the whole hour from a day on, and `0` for anything
 * that is not a positive number. Effort judges a finish on the figures it
 * prints (LAI-785), so it needs the number behind the words.
 */
export function shownMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const whole = Math.round(minutes);
  return whole < MINUTES_PER_DAY ? whole : Math.round(whole / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
}

/**
 * `minutes` in words, rounded as {@link shownMinutes} says; anything that is
 * not a positive number is `0 min`, and a positive one under a minute `< 1 min`.
 */
export function formatDuration(minutes: number, options: DurationOptions = {}): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 1) return '< 1 min';
  if (options.largest === 'min') return `${String(Math.round(minutes))} min`;

  const shown = shownMinutes(minutes);
  if (shown < MINUTES_PER_HOUR) return `${String(shown)} min`;

  if (shown < MINUTES_PER_DAY || options.largest === 'h') {
    const hours = Math.floor(shown / MINUTES_PER_HOUR);
    const rest = shown % MINUTES_PER_HOUR;
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
  }

  const hours = shown / MINUTES_PER_HOUR;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${String(days)} d` : `${String(days)} d ${String(rest)} h`;
}

/** {@link formatDuration} for a figure in milliseconds, as most of the API sends them. */
export function formatDurationMs(ms: number, options: DurationOptions = {}): string {
  return formatDuration(ms / 60_000, options);
}
