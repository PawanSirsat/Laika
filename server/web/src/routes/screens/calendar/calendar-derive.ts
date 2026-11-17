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
export function monthGrid(month: number, weeks = 6, now = month): readonly CalendarDay[] {
  // The month shown and today are apart since the grid pages (LAI-1178).
  const today = startOfDay(now);
  const first = new Date(startOfDay(month));
  first.setDate(1);

  // `getDay()` is 0 for Sunday; the week starts Monday, as the design draws it.
  const weekday = (first.getDay() + 6) % 7;
  const start = startOfDay(first.getTime() - weekday * DAY);
  const shownMonth = first.getMonth();

  return Array.from({ length: weeks * 7 }, (_, i) => {
    const at = startOfDay(start + i * DAY);
    const d = new Date(at);
    const dow = d.getDay();
    return {
      at,
      dayOfMonth: d.getDate(),
      inMonth: d.getMonth() === shownMonth,
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
export function monthWeeks(month: number, weeks = 6, now = month): readonly CalendarWeek[] {
  const days = monthGrid(month, weeks, now);
  return Array.from({ length: weeks }, (_, w) => {
    const slice = days.slice(w * 7, w * 7 + 7);
    return {
      label: `W${String(isoWeek(slice[0]?.at ?? month))}`,
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

// ---------------------------------------------------------------- LAI-1178

/**
 * The month a `?month=YYYY-MM` names, as the local midnight of its first day;
 * anything else is the month holding `now`. The address carries the month so
 * a paged calendar is a link, and back and forward walk the months.
 */
export function monthOf(param: string | null | undefined, now: number): number {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(param ?? '');
  if (m === null) {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime();
}

/** The first of the month `by` months on or back. */
export function stepMonth(month: number, by: number): number {
  const d = new Date(month);
  return new Date(d.getFullYear(), d.getMonth() + by, 1).getTime();
}

/** `2026-11`, as the address writes a month. */
export function monthParam(month: number): string {
  const d = new Date(month);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Whether two instants fall in the same local month. */
export function sameMonth(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
}

/**
 * The local day a reader dropped on, as the date-only value `due_on` stores:
 * the UTC midnight of the same calendar date (D-066) — `localDay` read back.
 */
export function dateOnlyOf(localMidnight: number): number {
  const d = new Date(localMidnight);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Open tasks due **before today**, apart from the rest (LAI-1178): they are
 * late, not scheduled, and left on their old days they piled one cell into a
 * column of fifteen. Oldest first, then by priority.
 */
export function splitOverdue<
  T extends Pick<TaskSummary, 'due_on' | 'status' | 'priority' | 'number'>,
>(
  tasks: readonly T[],
  now: number,
): { readonly overdue: readonly T[]; readonly rest: readonly T[] } {
  const today = startOfDay(now);
  const overdue: T[] = [];
  const rest: T[] = [];
  for (const t of tasks) {
    const open = t.status !== 'done' && t.status !== 'cancelled';
    if (open && t.due_on !== null && localDay(t.due_on) < today) overdue.push(t);
    else rest.push(t);
  }
  overdue.sort(
    (a, b) =>
      (a.due_on ?? 0) - (b.due_on ?? 0) ||
      a.priority.localeCompare(b.priority) ||
      a.number - b.number,
  );
  return { overdue, rest };
}

/** The chips a day shows, most urgent first, and how many wait behind "+N more". */
export function dayOverflow<T extends Pick<TaskSummary, 'priority' | 'number'>>(
  list: readonly T[],
  max: number,
): { readonly all: readonly T[]; readonly shown: readonly T[]; readonly more: number } {
  const all = [...list].sort((a, b) => a.priority.localeCompare(b.priority) || a.number - b.number);
  // Never "+1 more": a last chip fits where its button would go.
  const cut = all.length > max ? max - 1 : all.length;
  return { all, shown: all.slice(0, cut), more: all.length - cut };
}

export interface SprintSegment {
  readonly id: string;
  readonly name: string;
  readonly running: boolean;
  /** Columns 0–6 of the week the band covers, both ends kept. */
  readonly from: number;
  readonly to: number;
  /** The band begins this week (its name is drawn) rather than carrying over. */
  readonly starts: boolean;
}

/**
 * One band per sprint per week row (LAI-1178), replacing an `S9` in every
 * cell: where it starts and ends in the week, by the sprint's own dates read
 * as the local days they name (LAI-819).
 */
export function sprintSegments(
  days: readonly Pick<CalendarDay, 'at'>[],
  sprints: readonly {
    id: string;
    name: string;
    status: string;
    starts_on: number;
    ends_on: number;
  }[],
): readonly SprintSegment[] {
  const out: SprintSegment[] = [];
  for (const s of sprints) {
    const start = localDay(s.starts_on);
    const end = localDay(s.ends_on);
    const cols = days.map((d, i) => (d.at >= start && d.at <= end ? i : -1)).filter((i) => i >= 0);
    const from = cols[0];
    const to = cols.at(-1);
    if (from === undefined || to === undefined) continue;
    out.push({
      id: s.id,
      name: s.name,
      running: s.status === 'active',
      from,
      to,
      starts: days[from]?.at === start,
    });
  }
  return out.sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------- LAI-1218

/*
 * The week view and the keyboard grid, from LAI-1200 (PR #324), on the
 * LAI-1178 calendar. Day arithmetic is by the calendar, never by `DAY`
 * milliseconds: across a daylight-saving change a day is 23 or 25 hours, and
 * adding 24 lands on 23:00 the day before.
 */

/** `at` moved by whole calendar days, as a local midnight. */
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
  const days = Array.from({ length: 7 }, (_, i): CalendarDay => {
    const at = addDays(start, i);
    const d = new Date(at);
    const dow = d.getDay();
    return {
      at,
      dayOfMonth: d.getDate(),
      // A week has no month of its own: every day of it is shown as in it.
      inMonth: true,
      isToday: at === today,
      isWeekend: dow === 0 || dow === 6,
    };
  });
  return { label: `W${String(isoWeek(start))}`, days };
}

/** Which period the calendar draws. */
export type CalendarView = 'month' | 'week';

/**
 * The week a `?week=YYYY-MM-DD` names, as its Monday's local midnight; anything
 * else is the week holding `now`. Any day of the week names it, so a link
 * written with a Wednesday still lands on that week.
 */
export function weekParamOf(param: string | null | undefined, now: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(param ?? '');
  if (m !== null) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // `new Date` rolls 2026-02-31 into March: only a real date is read.
    if (d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) {
      return weekStart(d.getTime());
    }
  }
  return weekStart(now);
}

/** `2026-11-09`, as the address writes a week: its Monday. */
export function weekParam(at: number): string {
  const d = new Date(weekStart(at));
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * The address for a period, with every default dropped: month view, this
 * month and this week are no parameter at all, so today's calendar stays a
 * plain link. `undefined` deletes the key.
 */
export function periodParams(
  view: CalendarView,
  at: number,
  now: number,
): {
  readonly view: string | undefined;
  readonly month: string | undefined;
  readonly week: string | undefined;
} {
  if (view === 'week') {
    return {
      view: 'week',
      month: undefined,
      week: weekStart(at) === weekStart(now) ? undefined : weekParam(at),
    };
  }
  return {
    view: undefined,
    month: sameMonth(at, now) ? undefined : monthParam(at),
    week: undefined,
  };
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
 * week's Monday or Sunday, or one period on — the same day a month away in
 * Month view, a week away in Week view (LAI-1218: PageUp and PageDown step
 * what is on screen).
 *
 * The view follows the focused day, so moving past the grid's edge pages it
 * rather than stopping.
 */
export function moveDay(at: number, key: GridKey, view: CalendarView = 'month'): number {
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
      return view === 'week' ? addDays(at, -7) : addMonths(at, -1);
    case 'PageDown':
      return view === 'week' ? addDays(at, 7) : addMonths(at, 1);
  }
}

/**
 * The name a screen reader reads for a day: *"Tuesday 10 November, today,
 * 3 tasks, S2 Receipts"*. The order is fixed, so the date always reads before
 * what is on it. **No overdue count** (LAI-1218): overdue work lives in the
 * Overdue lane only, so a day never holds any.
 */
export function dayLabel(
  at: number,
  facts: {
    readonly tasks: number;
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
  if (facts.sprint !== undefined) parts.push(facts.sprint);
  return parts.join(', ');
}

/**
 * The sprint covering a day, as the day names it: `S2 Receipts`, its place in
 * the space's list and its name, with `, running` for the active one.
 * Sprint dates are date-only UTC midnights (D-066), read as the local days
 * they name (LAI-819).
 */
export function sprintOnDay<
  S extends {
    readonly name: string;
    readonly starts_on: number;
    readonly ends_on: number;
    readonly status: string;
  },
>(
  at: number,
  sprints: readonly S[],
):
  | {
      readonly sprint: S;
      readonly tag: string;
      readonly running: boolean;
      /** Its first day, and its last. */
      readonly first: boolean;
      readonly last: boolean;
    }
  | undefined {
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
 * Where the nearest open, dated task outside the period is — an empty
 * period's way on. Later work first, because a reader looking at an empty
 * month is planning ahead; earlier only when nothing is ahead. Callers pass
 * the work that is **not** overdue: overdue work is in its lane already.
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
