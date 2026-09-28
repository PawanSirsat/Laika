/**
 * How a moment reads on screen (LAI-486, D-065).
 *
 * **Relative for a day, then a date and time**, the form the owner chose from
 * a preview:
 *
 * ```
 * just now          ← under a minute
 * 4 min ago         ← under an hour  (fresh: drawn in the accent)
 * 3 h ago           ← under a day
 * 27 Sep, 14:05     ← a day or more, this year
 * 14 Mar 2025, 09:12 ← another year
 * hover → Sat 27 Sep 2026, 14:05:31
 * ```
 *
 * `updatedAge` said `8d` for a week-old task and `365d` for a year-old one.
 * Neither could be read as *when*, and the List's CREATED and UPDATED were
 * the columns where "when" is the whole point.
 *
 * **Built from fixed names, not `Intl`.** Day-month order and a 24-hour clock
 * are the approved form, and `en-GB` in current ICU abbreviates September as
 * `Sept`. A table of names gives exactly `27 Sep` in every browser and cannot
 * be changed by a developer's locale. **The viewer's own timezone** is kept:
 * the local getters are used, so `14:05` is the reader's 14:05.
 *
 * **Deliberately not used everywhere.** The board card keeps `updatedAge`'s
 * compact `2h`, because a card footer has no room for `27 Sep, 14:05`, and the
 * Dashboard keeps its own `relativeTime`. Both were left on purpose, not
 * missed.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface TimeLabel {
  /** What the cell says: `just now`, `4 min ago`, `3 h ago`, `27 Sep, 14:05`. */
  readonly text: string;
  /** The full moment, for a tooltip: `Sat 27 Sep 2026, 14:05:31`. */
  readonly full: string;
  /** For `<time dateTime>`. */
  readonly iso: string;
  /** Under an hour old — the rows the owner asked to stand out. */
  readonly fresh: boolean;
}

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * Read `at` as of `now`. **`now` is passed in, never read here**, which is what
 * keeps this testable at every edge. It is the same rule `staleFor` follows.
 */
export function timeLabel(at: number, now: number): TimeLabel {
  /*
   * **Clamped, and the clamp is belt-and-braces.** A clock-skewed stamp from
   * the future has a negative age, and today **the branch order alone** sends
   * it to `just now`: a negative is below a minute. The clamp is for the day
   * that order changes — guard the first branch as `elapsed >= 0 && …` and an
   * unclamped negative would fall through to the date branch. Measured
   * (LAI-486): removing the clamp leaves every test green, which is the
   * `staleFor` pair exactly — keep both, and do not read a green as proof the
   * clamp is dead.
   */
  const elapsed = Math.max(0, now - at);
  const when = new Date(at);

  const full = `${DAYS[when.getDay()] ?? ''} ${String(when.getDate())} ${MONTHS[when.getMonth()] ?? ''} ${String(when.getFullYear())}, ${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}`;
  const iso = when.toISOString();
  const fresh = elapsed < HOUR;

  let text: string;
  if (elapsed < MINUTE) {
    text = 'just now';
  } else if (elapsed < HOUR) {
    text = `${String(Math.floor(elapsed / MINUTE))} min ago`;
  } else if (elapsed < DAY) {
    text = `${String(Math.floor(elapsed / HOUR))} h ago`;
  } else {
    const sameYear = when.getFullYear() === new Date(now).getFullYear();
    const day = `${String(when.getDate())} ${MONTHS[when.getMonth()] ?? ''}`;
    const clock = `${two(when.getHours())}:${two(when.getMinutes())}`;
    text = sameYear ? `${day}, ${clock}` : `${day} ${String(when.getFullYear())}, ${clock}`;
  }

  return { text, full, iso, fresh };
}

/** The timer functions, injectable so a test can prove the stop is real. */
export interface Timers {
  readonly setInterval: (run: () => void, ms: number) => unknown;
  readonly clearInterval: (id: unknown) => void;
}

const REAL: Timers = {
  setInterval: (run, ms) => globalThis.setInterval(run, ms),
  clearInterval: (id) => {
    globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>);
  },
};

/**
 * Call `onTick` every `everyMs`, and return the function that stops it
 * (LAI-486).
 *
 * A table left open must not say `just now` for ever, so it re-renders on a
 * tick. The stop is returned **as the value**, so a `useEffect` that returns it
 * cannot forget to clear. A test injects fake timers and checks that the stop
 * clears the very interval that was started.
 */
export function startTicker(
  onTick: () => void,
  everyMs: number,
  timers: Timers = REAL,
): () => void {
  const id = timers.setInterval(onTick, everyMs);
  return () => {
    timers.clearInterval(id);
  };
}
