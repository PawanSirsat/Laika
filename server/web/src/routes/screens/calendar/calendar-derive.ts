/**
 * The calendar's month grid (LAI-271).
 *
 * Pure, so the arithmetic that decides which day a task lands on can be tested
 * without a renderer (CONVENTIONS §4) — and because off-by-one errors in date
 * maths are invisible until somebody's task is on the wrong day.
 */

import type { TaskSummary } from '../../../api/tasks.ts';

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

/**
 * The ISO-8601 week number for a day.
 *
 * The design labels each row of the grid with one (prototype line 591), in the
 * 46px gutter. ISO rather than "the nth Monday": week 1 is the week containing
 * the first Thursday, which is the rule every calendar a reader has used
 * follows, and getting it wrong is invisible for eleven months of the year.
 */
export function isoWeek(at: number): number {
  const d = new Date(startOfDay(at));
  // Shift to the Thursday of this week, then count weeks from that year's 1 Jan.
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY));
}

export interface CalendarWeek {
  /** `W38`, as the design writes it. */
  readonly label: string;
  readonly days: readonly CalendarDay[];
}

/**
 * The grid as rows, which is how the design draws it — each row carries the
 * week label in its own gutter cell, so the rows cannot drift out of step with
 * their labels the way two parallel lists would.
 */
export function monthWeeks(now: number, weeks = 6): readonly CalendarWeek[] {
  const days = monthGrid(now, weeks);
  return Array.from({ length: weeks }, (_, w) => {
    const slice = days.slice(w * 7, w * 7 + 7);
    return {
      label: `W${String(isoWeek(slice[0]?.at ?? now))}`,
      days: slice,
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

/**
 * A date-only value — unix-ms at a **UTC** midnight (D-066), as `due_on` and
 * a sprint's dates are — as the local midnight of the same calendar date
 * (LAI-819).
 *
 * The grid's days are local midnights. `startOfDay` on a UTC midnight files a
 * task due on the 22nd under the 21st anywhere west of Greenwich, because that
 * instant is the evening before there.
 */
export function localDay(dateOnly: number): number {
  const d = new Date(dateOnly);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

export interface DuePlacement<T> {
  /** Open tasks by the local midnight of their due day — only days the grid shows. */
  readonly byDay: ReadonlyMap<number, readonly T[]>;
  /** How many of them the grid shows. */
  readonly placed: number;
  /** Open tasks due on a day outside the grid. */
  readonly outside: number;
  /** Open tasks with a due date at all. */
  readonly dated: number;
}

/**
 * Open tasks on the day they are due, by their real `due_on` (LAI-819).
 *
 * The Calendar took its dates from a demo module that a production build
 * switches off, so production said "0 tasks placed" under a banner claiming
 * there was no due date to read — while `due_on` had existed since D-066.
 *
 * **Open only**: `done` and `cancelled` have no date to keep, the rule a card's
 * due date follows (`dueState`). The counts say what they are of — `placed` is
 * what the grid draws, and a date outside the six weeks is counted apart
 * rather than claimed as placed.
 */
export function placeByDue<T extends Pick<TaskSummary, 'due_on' | 'status'>>(
  tasks: readonly T[],
  days: readonly Pick<CalendarDay, 'at'>[],
): DuePlacement<T> {
  const shown = new Set(days.map((d) => d.at));
  const open = tasks.filter(
    (t) => t.due_on !== null && t.status !== 'done' && t.status !== 'cancelled',
  );
  const due = byDay(open, (t) => (t.due_on === null ? undefined : localDay(t.due_on)));
  const visible = new Map([...due].filter(([at]) => shown.has(at)));
  const placed = [...visible.values()].reduce((n, list) => n + list.length, 0);
  return { byDay: visible, placed, outside: open.length - placed, dated: open.length };
}
