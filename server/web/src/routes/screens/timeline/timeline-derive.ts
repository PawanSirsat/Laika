import type { Sprint, SprintTaskCounts } from '../../../api/sprints.ts';
import type { Task } from '../../../api/tasks.ts';
import { blockedState, byIdIndex } from '../../../api/board-derive.ts';
import { daysLeft } from '../sprints/sprint-derive.ts';

/**
 * The timeline's layout arithmetic (SPEC §11.4.3, LAI-721).
 *
 * ## One row per sprint, Jira's way
 *
 * The owner, 2026-10-08: *"by the sprints, like Jira … I don't want the tasks
 * in time."* So the chart is §11.4.3 as written — **each sprint is one bar**,
 * and a sprint opens to list its tasks, which have no bars of their own. D-074
 * withdraws D-049's row per task.
 *
 * ## A pixel scale, because the axis scrolls
 *
 * The old axis squeezed every day into the card's width with flex weights, so
 * eight months of sprints came out a few pixels a day. Jira's timeline does the
 * opposite: a **zoom** fixes how wide a day is, and the axis scrolls sideways.
 * So positions here are day indexes, and the screen multiplies by
 * {@link DAY_WIDTH}. Sprints of a project cannot overlap (§4.15), so every bar
 * is a plain span on its own row — no packing, no solver.
 */

const DAY = 24 * 60 * 60 * 1000;

/** UTC midnight of the day `ms` falls in — the axis is day-granular. */
export function startOfDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

/** Inclusive day count between two day-starts. */
function days(from: number, to: number): number {
  return Math.round((to - from) / DAY) + 1;
}

export interface TimelineRange {
  readonly from: number;
  readonly to: number;
  /** Inclusive day count, so `to` is the last day drawn, not the day after. */
  readonly days: number;
}

/* ------------------------------------------------------------------- zoom */

export const ZOOMS = ['weeks', 'months', 'quarters'] as const;
export type Zoom = (typeof ZOOMS)[number];

export const ZOOM_LABELS: Readonly<Record<Zoom, string>> = {
  weeks: 'Weeks',
  months: 'Months',
  quarters: 'Quarters',
};

/**
 * Pixels per day at each zoom. Weeks gives a day room for its own column;
 * Months fits a two-week sprint in about 140px, a sprint name and a count;
 * Quarters fits half a year on a laptop screen.
 */
export const DAY_WIDTH: Readonly<Record<Zoom, number>> = {
  weeks: 36,
  months: 10,
  quarters: 3.5,
};

/** `?zoom=` — anything unknown is the default. */
export function readZoom(raw: string | null): Zoom {
  return (ZOOMS as readonly string[]).includes(raw ?? '') ? (raw as Zoom) : 'months';
}

/* ------------------------------------------------------------------ window */

/**
 * How far from today a sprint's dates may be and still be drawn.
 *
 * **A guard, not a policy.** A sprint saved with `ends_on` in 2062 made every
 * chevron click take a second; 9999 made one render take a minute and draw
 * 416,000 week ticks; `1e17` is not a date at all and blanked the header with
 * "Invalid Date" (LAI-721 review). Five years either side covers any real
 * plan; anything beyond it is listed beside the chart, not drawn on it.
 */
export const AXIS_YEARS = 5;

/** True when both of a sprint's dates are real days within reach of the axis. */
export function onAxis(sprint: Sprint, now: number): boolean {
  const { starts_on: from, ends_on: to } = sprint;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return false;
  const reach = AXIS_YEARS * 366 * DAY;
  const today = startOfDay(now);
  return from >= today - reach && to <= today + reach;
}

/**
 * The days the chart draws: **whole calendar months** — or quarters, at the
 * Quarters zoom — around every sprint and today, with at least a week of air on
 * each side.
 *
 * Today is inside it on purpose. The squeezed axis kept today out so empty
 * months would not shrink the bars; a scrolling axis has no such cost, and a
 * Today button that cannot reach today is no button at all.
 *
 * The caller passes only sprints that are {@link onAxis}, so the window is at
 * most about ten years: a few hundred week ticks at worst, never hundreds of
 * thousands.
 */
export function chartWindow(
  sprints: readonly Sprint[],
  now: number,
  zoom: Zoom = 'months',
): TimelineRange | null {
  if (sprints.length === 0) return null;

  let from = startOfDay(now);
  let to = startOfDay(now);
  for (const sprint of sprints) {
    from = Math.min(from, startOfDay(sprint.starts_on));
    to = Math.max(to, startOfDay(sprint.ends_on));
  }

  const first = new Date(from - 7 * DAY);
  const last = new Date(to + 7 * DAY);
  // A quarter's axis starts and ends with its quarters, not mid-Q4.
  const span = zoom === 'quarters' ? 3 : 1;
  const startMonth = first.getUTCMonth() - (first.getUTCMonth() % span);
  const endMonth = last.getUTCMonth() - (last.getUTCMonth() % span) + span;
  const start = Date.UTC(first.getUTCFullYear(), startMonth, 1);
  // Day 0 of the month after the last is the last day of the last.
  const end = Date.UTC(last.getUTCFullYear(), endMonth, 0);

  return { from: start, to: end, days: days(start, end) };
}

/** Which day of the window `ms` falls on, counting from 0. */
export function dayIndex(range: TimelineRange, ms: number): number {
  return Math.round((startOfDay(ms) - range.from) / DAY);
}

/** A sprint's bar: the day it starts on and how many days it covers, inclusive. */
export function sprintSpan(
  range: TimelineRange,
  sprint: Sprint,
): { readonly start: number; readonly days: number } {
  return {
    start: dayIndex(range, sprint.starts_on),
    days: days(startOfDay(sprint.starts_on), startOfDay(sprint.ends_on)),
  };
}

/* ----------------------------------------------------------------- header */

export interface Band {
  /** Stable key — months repeat across years. */
  readonly key: string;
  readonly label: string;
  /** The first day of the band, as an index into the window. */
  readonly start: number;
  readonly days: number;
}

/**
 * One band per calendar month in the window. `short` is `Oct`, for the lower
 * header row at Quarters; otherwise `Oct 2026`.
 */
export function monthBands(range: TimelineRange, short = false): Band[] {
  return bands(
    range,
    (date) => `${String(date.getUTCFullYear())}-${String(date.getUTCMonth())}`,
    (date) =>
      date.toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        month: 'short',
        ...(short ? {} : { year: 'numeric' }),
      }),
  );
}

/** One band per calendar quarter in the window: `Q4 2026`. */
export function quarterBands(range: TimelineRange): Band[] {
  const quarterOf = (date: Date): string =>
    `Q${String(Math.floor(date.getUTCMonth() / 3) + 1)} ${String(date.getUTCFullYear())}`;
  return bands(range, quarterOf, quarterOf);
}

/**
 * Runs of days that share a key. **The label is formatted once per band**, at
 * its first day: `toLocaleDateString` for every day of a ten-year window was a
 * measurable share of a render (LAI-721 review).
 */
function bands(
  range: TimelineRange,
  keyOf: (date: Date) => string,
  labelOf: (date: Date) => string,
): Band[] {
  const out: Band[] = [];
  let current: { key: string; label: string; start: number; days: number } | undefined;
  for (let i = 0; i < range.days; i += 1) {
    const date = new Date(range.from + i * DAY);
    const key = keyOf(date);
    if (current?.key === key) {
      current.days += 1;
      continue;
    }
    if (current !== undefined) out.push(current);
    current = { key, label: labelOf(date), start: i, days: 1 };
  }
  if (current !== undefined) out.push(current);
  return out;
}

export interface Tick {
  readonly index: number;
  /** `5` — the day of the month of a Monday. */
  readonly label: string;
}

/** Every Monday in the window: the week lines, and the lower header row. */
export function weekTicks(range: TimelineRange): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i < range.days; i += 1) {
    const date = new Date(range.from + i * DAY);
    if (date.getUTCDay() === 1) out.push({ index: i, label: String(date.getUTCDate()) });
  }
  return out;
}

/**
 * `THU 8 OCT` — the today pill's words, **for the UTC day the line is drawn
 * on**. The line is placed by `startOfDay(now)` in UTC, as every date on this
 * axis is; a pill read from the local clock said tomorrow's date beside
 * today's line for anyone east of Greenwich after their midnight (LAI-721
 * review).
 */
export function todayLabel(now: number): string {
  return new Date(startOfDay(now))
    .toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    .toUpperCase()
    .replace(/,/g, '');
}

/* ---------------------------------------------------------------- counts */

/**
 * Done over total from the sprint list's `task_counts` (LAI-721) — the
 * Sprints screen's rule (`progressFor`): `cancelled` is in neither, because
 * work that will not happen must not hold a finished sprint short of done.
 */
export function countsProgress(counts: SprintTaskCounts): {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
} {
  const done = counts.by_status.done;
  const total = counts.total - counts.by_status.cancelled;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * Blocked, and **cannot tell** — by `board-derive`'s rule (`blockedState`),
 * against the tasks loaded for one sprint. A blocker in another sprint or in
 * the tray is not loaded, so its task is `unknown`, not unblocked: guessing
 * "not blocked" is the more damaging error (LAI-721 review).
 */
export function blockedTally(tasks: readonly Task[]): {
  readonly blocked: number;
  readonly unknown: number;
} {
  const byId = byIdIndex(tasks);
  let blocked = 0;
  let unknown = 0;
  for (const task of tasks) {
    const state = blockedState(task, byId);
    if (state === true) blocked += 1;
    else if (state === undefined) unknown += 1;
  }
  return { blocked, unknown };
}

/* ------------------------------------------------------------ sprint state */

/** §11.4.3: "Sprints entirely in the past are dimmed, not hidden." */
export function isPast(sprint: Sprint, now: number): boolean {
  return startOfDay(sprint.ends_on) < startOfDay(now);
}

/** True while today falls inside the sprint, whatever its stored status. */
export function isCurrent(sprint: Sprint, now: number): boolean {
  const today = startOfDay(now);
  return today >= startOfDay(sprint.starts_on) && today <= startOfDay(sprint.ends_on);
}

/**
 * Where a sprint stands, **by its dates**. The stored status is a label people
 * forget to move; a sprint left `active` after its end is ordinary, and the
 * chart is about time.
 */
export function sprintPhase(sprint: Sprint, now: number): 'past' | 'current' | 'future' {
  if (isCurrent(sprint, now)) return 'current';
  return isPast(sprint, now) ? 'past' : 'future';
}

/**
 * What a sprint row's countdown says, and it is not always "days left".
 *
 * LAI-434 clamped `daysLeft` at zero so a finished sprint could not show minus
 * seven. That was right and it is not enough once a sprint can be *selected*
 * (LAI-436): a completed sprint reading `DAYS LEFT 0` is indistinguishable from
 * one ending tonight, and a sprint that has not started yet has no days left at
 * all — it has days until it begins. **A clamp turns a wrong number into a
 * misleading one; the label has to change with it.**
 */
export type SprintCountdown =
  /** Today is inside the sprint. `DAYS LEFT`. */
  | { readonly kind: 'left'; readonly days: number }
  /** It has not begun. `STARTS IN`. */
  | { readonly kind: 'starts_in'; readonly days: number }
  /** It is over. `ENDED`, and how long ago. */
  | { readonly kind: 'ended'; readonly days: number };

/**
 * Which of the three sentences this sprint gets.
 *
 * `isCurrent` is the discriminator rather than `sprint.status`, and the two do
 * disagree: §11.4.3 already treats the stored status as a label rather than the
 * truth, because a sprint left `active` after its end date is ordinary and the
 * dates are what a reader is looking at.
 */
export function countdownFor(sprint: Sprint, now: number): SprintCountdown {
  const today = startOfDay(now);

  if (isCurrent(sprint, now)) {
    // **`daysLeft` from `sprint-derive`, not a second count.** It already owns
    // "whole days remaining, counting the last day, never negative" and the
    // board's strip reads it — LAI-215's `initials()` and LAI-434's blocked rule
    // are the two precedents for what a second copy costs. This function
    // classifies; it does not re-count.
    return { kind: 'left', days: daysLeft(sprint.ends_on, now) };
  }

  if (today < startOfDay(sprint.starts_on)) {
    return { kind: 'starts_in', days: days(today, startOfDay(sprint.starts_on)) - 1 };
  }

  return { kind: 'ended', days: days(startOfDay(sprint.ends_on), today) - 1 };
}
