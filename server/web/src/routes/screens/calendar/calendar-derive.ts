/**
 * The calendar's month grid (LAI-271).
 *
 * Pure, so the arithmetic that decides which day a task lands on can be tested
 * without a renderer (CONVENTIONS §4) — and because off-by-one errors in date
 * maths are invisible until somebody's task is on the wrong day.
 */

const DAY = 86_400_000;

export interface CalendarDay {
  /** Midnight, local, for the day this cell is. */
  readonly at: number;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
  readonly isToday: boolean;
  readonly isWeekend: boolean;
}

/** Midnight local, so two timestamps on the same day compare equal. */
export function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Six weeks from the Monday on or before the first of the month.
 *
 * **Six, always** — a month spans five or six depending on where it starts,
 * and a grid that changes height as you page moves everything under it.
 */
export function monthGrid(now: number, weeks = 6): readonly CalendarDay[] {
  const today = startOfDay(now);
  const first = new Date(today);
  first.setDate(1);

  // `getDay()` is 0 for Sunday; the week starts Monday, as the design draws it.
  const weekday = (first.getDay() + 6) % 7;
  const start = startOfDay(first.getTime() - weekday * DAY);
  const month = first.getMonth();

  return Array.from({ length: weeks * 7 }, (_, i) => {
    const at = startOfDay(start + i * DAY);
    const d = new Date(at);
    const dow = d.getDay();
    return {
      at,
      dayOfMonth: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: at === today,
      isWeekend: dow === 0 || dow === 6,
    };
  });
}

/** Tasks per day, keyed by the day's midnight. */
export function byDay<T>(
  items: readonly T[],
  dueAt: (item: T) => number | undefined,
): ReadonlyMap<number, readonly T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const due = dueAt(item);
    if (due === undefined) continue;
    const key = startOfDay(due);
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [item]);
    else bucket.push(item);
  }
  return map;
}
