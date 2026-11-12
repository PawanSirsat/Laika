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
 *
 * `now` picks the month; `todayAt` is the real today, which differs once the
 * reader pages to another month (LAI-1200).
 */
export function monthGrid(now: number, weeks = 6, todayAt = now): readonly CalendarDay[] {
  const today = startOfDay(todayAt);
  const first = new Date(startOfDay(now));
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
export function monthWeeks(now: number, weeks = 6, todayAt = now): readonly CalendarWeek[] {
  const days = monthGrid(now, weeks, todayAt);
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

/* ------------------------------------------------- navigation (LAI-1200) */

/**
 * `at` moved by whole calendar days, as a local midnight.
 *
 * By the calendar, not by `DAY` milliseconds: across a daylight-saving change
 * a day is 23 or 25 hours long, and adding 24 lands on 23:00 the day before.
 */
export function addDays(at: number, days: number): number {
  const d = new Date(startOfDay(at));
  d.setDate(d.getDate() + days);
  return startOfDay(d.getTime());
}

/**
 * `at` moved by whole months, keeping the day of the month where the target
 * month has it and clamping where it does not — 31 January forward is 28 or
 * 29 February, never 3 March.
 */
export function addMonths(at: number, months: number): number {
  const d = new Date(startOfDay(at));
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return startOfDay(d.getTime());
}

/** The Monday on or before `at` — the week starts Monday, as the grid does. */
export function weekStart(at: number): number {
  const d = new Date(startOfDay(at));
  return addDays(d.getTime(), -((d.getDay() + 6) % 7));
}

/** The one week containing `anchor`, as a row the grid can draw. */
export function weekOf(anchor: number, todayAt: number): CalendarWeek {
  const start = weekStart(anchor);
  const today = startOfDay(todayAt);
  const month = new Date(startOfDay(anchor)).getMonth();
  const days = Array.from({ length: 7 }, (_, i): CalendarDay => {
    const at = addDays(start, i);
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
  return { label: `W${String(isoWeek(start))}`, days };
}

/** The keys that move day focus on the grid (WAI-ARIA grid pattern). */
export type GridKey =
  'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

const GRID_KEYS: ReadonlySet<string> = new Set<GridKey>([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function isGridKey(key: string): key is GridKey {
  return GRID_KEYS.has(key);
}

/**
 * Where day focus goes for a key: a day either way, a week up or down, the
 * week's Monday or Sunday, or the same day a month away.
 *
 * The view follows the focused day, so moving past the grid's edge pages it
 * rather than stopping — the reader never has to leave the keyboard to see
 * next month.
 */
export function moveDay(at: number, key: GridKey): number {
  switch (key) {
    case 'ArrowLeft':
      return addDays(at, -1);
    case 'ArrowRight':
      return addDays(at, 1);
    case 'ArrowUp':
      return addDays(at, -7);
    case 'ArrowDown':
      return addDays(at, 7);
    case 'Home':
      return weekStart(at);
    case 'End':
      return addDays(weekStart(at), 6);
    case 'PageUp':
      return addMonths(at, -1);
    case 'PageDown':
      return addMonths(at, 1);
  }
}

/** True when `a` and `b` fall in the same calendar month. */
export function sameMonth(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
}

/* ------------------------------------------------- what a day says */

/**
 * The name a screen reader reads for a day: *"Tuesday 12 November, today,
 * 3 tasks, 1 overdue"*. Weekday and month come from the reader's locale; the
 * order is fixed, so the date always reads before what is on it.
 */
export function dayLabel(
  at: number,
  facts: {
    readonly tasks: number;
    readonly overdue: number;
    readonly today: boolean;
    /** The sprint the day is in, read last: the band itself is not read. */
    readonly sprint?: string | undefined;
  },
  locale?: string,
): string {
  const d = new Date(at);
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' });
  const month = d.toLocaleDateString(locale, { month: 'long' });
  const parts = [`${weekday} ${String(d.getDate())} ${month}`];
  if (facts.today) parts.push('today');
  parts.push(
    facts.tasks === 0
      ? 'no tasks'
      : `${String(facts.tasks)} ${facts.tasks === 1 ? 'task' : 'tasks'}`,
  );
  if (facts.overdue > 0) parts.push(`${String(facts.overdue)} overdue`);
  if (facts.sprint !== undefined) parts.push(facts.sprint);
  return parts.join(', ');
}

/** The sprint covering a day, and where the day sits in it. */
export interface SprintOnDay<S> {
  readonly sprint: S;
  /** `S2`: its place in the space's list, as the board's chips number them. */
  readonly tag: string;
  readonly running: boolean;
  /** Its first day, where the band carries its name. */
  readonly first: boolean;
  /** Its last day, where the band's end is rounded. */
  readonly last: boolean;
}

/**
 * Which sprint a day is in, if any. Sprint dates are date-only UTC midnights
 * (D-066), read as the local day they name — the same reading a due date
 * gets, so a task due on a sprint's first day sits inside its band (LAI-819).
 */
export function sprintOnDay<
  S extends { readonly starts_on: number; readonly ends_on: number; readonly status: string },
>(at: number, sprints: readonly S[]): SprintOnDay<S> | undefined {
  const index = sprints.findIndex((s) => at >= localDay(s.starts_on) && at <= localDay(s.ends_on));
  const sprint = sprints[index];
  if (sprint === undefined) return undefined;
  return {
    sprint,
    tag: `S${String(index + 1)}`,
    running: sprint.status === 'active',
    first: at === localDay(sprint.starts_on),
    last: at === localDay(sprint.ends_on),
  };
}

/**
 * Where the nearest open, dated task outside the period is — the empty
 * month's next action. Later work first, because a reader looking at an empty
 * month is planning ahead; earlier only when nothing is ahead.
 */
export function nearestDueOutside<T extends Pick<TaskSummary, 'due_on' | 'status'>>(
  tasks: readonly T[],
  from: number,
  to: number,
): number | undefined {
  let ahead: number | undefined;
  let behind: number | undefined;
  for (const t of tasks) {
    if (t.due_on === null || t.status === 'done' || t.status === 'cancelled') continue;
    const at = localDay(t.due_on);
    if (at > to && (ahead === undefined || at < ahead)) ahead = at;
    if (at < from && (behind === undefined || at > behind)) behind = at;
  }
  return ahead ?? behind;
}
