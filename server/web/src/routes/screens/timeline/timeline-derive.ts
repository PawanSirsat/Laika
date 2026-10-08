import type { Sprint } from '../../../api/sprints.ts';
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
 * The days the chart draws: **whole calendar months** around every sprint and
 * today, with at least a week of air on each side.
 *
 * Today is inside it on purpose. The squeezed axis kept today out so empty
 * months would not shrink the bars; a scrolling axis has no such cost, and a
 * Today button that cannot reach today is no button at all.
 */
export function chartWindow(sprints: readonly Sprint[], now: number): TimelineRange | null {
  if (sprints.length === 0) return null;

  let from = startOfDay(now);
  let to = startOfDay(now);
  for (const sprint of sprints) {
    from = Math.min(from, startOfDay(sprint.starts_on));
    to = Math.max(to, startOfDay(sprint.ends_on));
  }

  const first = new Date(from - 7 * DAY);
  const last = new Date(to + 7 * DAY);
  const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
  // Day 0 of the next month is the last day of this one.
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0);

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
  return bands(range, (date) => ({
    key: `${String(date.getUTCFullYear())}-${String(date.getUTCMonth())}`,
    label: date.toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      month: 'short',
      ...(short ? {} : { year: 'numeric' }),
    }),
  }));
}

/** One band per calendar quarter in the window: `Q4 2026`. */
export function quarterBands(range: TimelineRange): Band[] {
  return bands(range, (date) => {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    const year = String(date.getUTCFullYear());
    return { key: `${year}-Q${String(quarter)}`, label: `Q${String(quarter)} ${year}` };
  });
}

function bands(
  range: TimelineRange,
  name: (date: Date) => { readonly key: string; readonly label: string },
): Band[] {
  const out: Band[] = [];
  for (let i = 0; i < range.days; i += 1) {
    const { key, label } = name(new Date(range.from + i * DAY));
    const last = out[out.length - 1];
    if (last?.key === key) {
      out[out.length - 1] = { ...last, days: last.days + 1 };
    } else {
      out.push({ key, label, start: i, days: 1 });
    }
  }
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

export interface SprintSummary {
  readonly done: number;
  readonly total: number;
  readonly blocked: number;
  readonly wip: number;
  /**
   * The fourth stat, labelled by its own kind.
   *
   * There is deliberately **no `daysLeft` alongside this**. Keeping both would
   * leave the old field as the easy one to reach for, and it is the one that
   * cannot tell a finished sprint from one ending tonight.
   */
  readonly countdown: SprintCountdown;
}

/**
 * A sprint's strip: DONE · BLOCKED · WIP · and the countdown.
 *
 * All four are derived. `blocked` is passed in rather than recomputed —
 * `board-derive.ts` already owns that rule and a second one would drift from it
 * (the LAI-215 `initials()` problem).
 *
 * **Any sprint, not only the active one** (LAI-436). The screen can select a
 * finished or a future sprint, which is what forced `daysLeft` to become
 * `countdown`: the three cases are genuinely different sentences, and a single
 * clamped number said the wrong one for two of them.
 */
export function sprintSummary(
  tasks: readonly { readonly status: string }[],
  blockedCount: number,
  sprint: Sprint,
  now: number,
): SprintSummary {
  let done = 0;
  let wip = 0;
  for (const task of tasks) {
    if (task.status === 'done') done += 1;
    if (task.status === 'in_progress') wip += 1;
  }

  return {
    done,
    total: tasks.length,
    blocked: blockedCount,
    wip,
    countdown: countdownFor(sprint, now),
  };
}

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
