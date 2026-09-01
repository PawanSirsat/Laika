import type { Sprint } from '../../../api/sprints.ts';
import { daysLeft } from '../sprints/sprint-derive.ts';

/**
 * The timeline's layout arithmetic (SPEC §11.4.3, D-014 — LAI-084).
 *
 * ## Why there is no layout solver here
 *
 * §4.15 forbids two sprints of a project from overlapping, and the server
 * enforces it under a write lock. That single rule is what makes this file
 * short: the bars go on **one track** in date order with gaps between them, and
 * there is no lane-packing, no collision resolution and no critical path. D-014
 * chose sprints as the unit precisely to buy that.
 *
 * ## Tasks get bars, and where each one comes from is the whole point
 *
 * **D-049 overturned D-040.** Until LAI-126 landed there were no per-task dates
 * to draw, so the only honest bar was a sprint's — that was D-040 and it was
 * right on the day. `TaskView` now carries `started_at` and `completed_at`,
 * stamped on the first entry into `in_progress` and never overwritten, so a
 * finished task's bar is a **measurement** rather than a plan.
 *
 * What survives of D-014 is one rule, and it is the only thing in this file
 * that is not arithmetic:
 *
 * > **Laika never asserts a date it was not told.**
 *
 * So a bar is `actual` only when both its ends were measured. Everything else
 * falls back to the sprint's range and is marked `planned`, which the screen
 * draws as an outline — *a solid bar is something that happened; an outline is
 * somewhere a task was put*. A task with neither goes to the unscheduled tray
 * and gets no bar at all.
 */

const DAY = 24 * 60 * 60 * 1000;

/** UTC midnight of the day `ms` falls in — the axis is day-granular. */
export function startOfDay(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

export interface TimelineRange {
  readonly from: number;
  readonly to: number;
  /** Inclusive day count, so `to` is the last day drawn, not the day after. */
  readonly days: number;
}

/**
 * The axis: first day of the earliest sprint to the last day of the latest.
 *
 * **Today does not stretch it.** A project whose next sprint starts in March
 * would otherwise get an axis mostly made of empty January, squashing every bar
 * to a sliver to accommodate a marker. Instead the axis stays the sprints, and
 * the screen says which side of it today falls on — see `todayPosition`. That is
 * a real trade and it is made here so it is visible.
 */
export function timelineRange(
  sprints: readonly Sprint[],
  /**
   * Extra days the axis must cover — task actuals, from {@link taskActuals}.
   *
   * **The axis widens rather than the bars being clamped** (LAI-434). A task
   * that started before the first sprint has to be drawn where it started;
   * clipping it to the axis edge would show a start date nobody gave us, which
   * is the one thing D-049 kept from D-014.
   */
  extra: readonly number[] = [],
): TimelineRange | null {
  if (sprints.length === 0 && extra.length === 0) return null;

  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  for (const sprint of sprints) {
    from = Math.min(from, startOfDay(sprint.starts_on));
    to = Math.max(to, startOfDay(sprint.ends_on));
  }

  for (const at of extra) {
    from = Math.min(from, startOfDay(at));
    to = Math.max(to, startOfDay(at));
  }

  // `ends_on` is inclusive (§4.15), so the last day counts.
  return { from, to, days: Math.round((to - from) / DAY) + 1 };
}

export type TimelineSegment =
  | { readonly kind: 'gap'; readonly days: number }
  | { readonly kind: 'sprint'; readonly days: number; readonly sprint: Sprint };

/**
 * The single track: sprints in date order, with the empty stretches between
 * them as explicit gap segments.
 *
 * Gaps are segments rather than margins so the whole track is one flex row whose
 * children's `flex-grow` are day counts. That makes the drawing proportional
 * with no absolute positioning and no width maths in the component — and it
 * stays correct at any container width, which absolute pixel offsets do not.
 *
 * Overlapping sprints cannot occur (§4.15). If two ever did, they would render
 * as adjacent rather than stacked — wrong, but visibly wrong, and the server
 * would have had to break first.
 */
export function toSegments(sprints: readonly Sprint[], range: TimelineRange): TimelineSegment[] {
  const ordered = [...sprints].sort(
    (a, b) => a.starts_on - b.starts_on || a.id.localeCompare(b.id),
  );

  const segments: TimelineSegment[] = [];
  let cursor = range.from;

  for (const sprint of ordered) {
    const starts = startOfDay(sprint.starts_on);
    const ends = startOfDay(sprint.ends_on);

    const gap = Math.round((starts - cursor) / DAY);
    if (gap > 0) segments.push({ kind: 'gap', days: gap });

    segments.push({
      kind: 'sprint',
      days: Math.round((ends - starts) / DAY) + 1,
      sprint,
    });

    cursor = ends + DAY;
  }

  // Unreachable for the range `timelineRange` produces — it ends at the last
  // sprint's last day, so `cursor` lands exactly on `range.to + 1`. Kept because
  // this function takes the range as an argument and should be total over any
  // of them; a caller passing a wider window (a fixed quarter, say) must not get
  // a track that stops short of its own axis. Exercised by its own test rather
  // than left as a branch nobody has run.
  const tail = Math.round((range.to + DAY - cursor) / DAY);
  if (tail > 0) segments.push({ kind: 'gap', days: tail });

  return segments;
}

export interface MonthBand {
  readonly label: string;
  readonly days: number;
  /** Stable key — months repeat across years. */
  readonly key: string;
}

/**
 * The header row: one band per calendar month the axis touches, weighted by how
 * many of its days are actually on the axis.
 *
 * A month clipped by the range gets its real share, not a whole month's width —
 * otherwise the header stops lining up with the track underneath it, which is
 * the one thing a date axis has to get right.
 */
export function monthBands(range: TimelineRange): MonthBand[] {
  const bands: MonthBand[] = [];

  for (let i = 0; i < range.days; i += 1) {
    const date = new Date(range.from + i * DAY);
    const key = `${String(date.getUTCFullYear())}-${String(date.getUTCMonth())}`;
    const last = bands[bands.length - 1];

    if (last?.key === key) {
      bands[bands.length - 1] = { ...last, days: last.days + 1 };
      continue;
    }

    bands.push({
      key,
      days: 1,
      label: date.toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        month: 'short',
        year: 'numeric',
      }),
    });
  }

  return bands;
}

export type TodayPosition =
  | { readonly on: 'axis'; readonly percent: number }
  | { readonly on: 'before' }
  | { readonly on: 'after' };

/**
 * Where to draw the today marker, or which side of the axis today falls on.
 *
 * Returning a discriminated union rather than `number | null` so the screen has
 * to say something in the outside case. "Today is not on this axis" and "today
 * is three months after the last sprint" are different messages, and a `null`
 * would have let both collapse into drawing nothing.
 */
export function todayPosition(range: TimelineRange, now: number): TodayPosition {
  const today = startOfDay(now);

  if (today < range.from) return { on: 'before' };
  if (today > range.to) return { on: 'after' };

  // Centre of the day's column: a marker on the boundary reads as belonging to
  // the day on either side of it.
  const index = Math.round((today - range.from) / DAY);
  return { on: 'axis', percent: ((index + 0.5) / range.days) * 100 };
}

/** §11.4.3: "Sprints entirely in the past are dimmed, not hidden." */
export function isPast(sprint: Sprint, now: number): boolean {
  return startOfDay(sprint.ends_on) < startOfDay(now);
}

/** True while today falls inside the sprint, whatever its stored status. */
export function isCurrent(sprint: Sprint, now: number): boolean {
  const today = startOfDay(now);
  return today >= startOfDay(sprint.starts_on) && today <= startOfDay(sprint.ends_on);
}

/** Where a bar's extent came from — and therefore how it must be drawn. */
export type BarKind =
  /** Both ends measured. Drawn solid. */
  | 'actual'
  /** Started for real, still running: measured up to now, then the sprint. */
  | 'partial'
  /** Nothing measured. The sprint someone put it in. Drawn as an outline. */
  | 'planned';

export interface TaskBar {
  readonly kind: BarKind;
  /** Day counts across the axis; they sum to `range.days`. */
  readonly leadDays: number;
  /** The measured part, or the whole outline when `kind` is `planned`. */
  readonly solidDays: number;
  /** `partial` only: now → the sprint's end. Zero otherwise. */
  readonly remainderDays: number;
  readonly trailDays: number;
  /** The extent the bar claims, for the row's label. */
  readonly from: number;
  readonly to: number;
  /**
   * True when `from`/`to` came from the sprint rather than the task.
   *
   * The row **must** say so. Presenting a sprint's range in the same voice as a
   * measured one is the misreading D-014 exists to prevent, and it is invisible
   * once the bar is drawn.
   */
  readonly fromSprint: boolean;
}

/** The dates a task can contribute to the axis — actuals only, never a plan. */
export function taskActuals(tasks: readonly TimelineTask[]): number[] {
  const out: number[] = [];
  for (const task of tasks) {
    if (task.started_at !== null) out.push(startOfDay(task.started_at));
    if (task.completed_at !== null) out.push(startOfDay(task.completed_at));
  }
  return out;
}

/** The fields of a task this module reads. Structural, so tests need no fixture. */
export interface TimelineTask {
  readonly status: string;
  readonly started_at: number | null;
  readonly completed_at: number | null;
}

/**
 * Where a task's bar sits, or `undefined` when it has earned no bar.
 *
 * The table is D-049's, and the fallback is the load-bearing part: **an
 * unmeasured end demotes the whole bar to `planned`.** A `done` task with a
 * `started_at` and no `completed_at` is legacy data, not a measurement of when
 * it finished, so it is drawn as a plan rather than as a bar ending today.
 */
export function taskBar(
  task: TimelineTask,
  sprint: Sprint | undefined,
  range: TimelineRange,
  now: number,
): TaskBar | undefined {
  const started = task.started_at === null ? undefined : startOfDay(task.started_at);
  const completed = task.completed_at === null ? undefined : startOfDay(task.completed_at);

  if (task.status === 'done' && started !== undefined && completed !== undefined) {
    return span(range, started, completed, 'actual', 0, false);
  }

  if (task.status === 'in_progress' && started !== undefined) {
    const today = startOfDay(now);
    const solidTo = today < started ? started : today;
    // The remainder is a plan, so it only exists where a plan does.
    const plannedEnd = sprint === undefined ? solidTo : startOfDay(sprint.ends_on);
    const remainder = Math.max(0, days(solidTo, plannedEnd) - 1);
    return span(range, started, solidTo, 'partial', remainder, false);
  }

  if (sprint !== undefined) {
    return span(
      range,
      startOfDay(sprint.starts_on),
      startOfDay(sprint.ends_on),
      'planned',
      0,
      true,
    );
  }

  // No measurement and nowhere it was put. The tray, and no bar.
  return undefined;
}

/** Inclusive day count between two day-starts. */
function days(from: number, to: number): number {
  return Math.round((to - from) / DAY) + 1;
}

function span(
  range: TimelineRange,
  from: number,
  to: number,
  kind: BarKind,
  remainderDays: number,
  fromSprint: boolean,
): TaskBar {
  // Clamping would move a bar's start to the axis edge, which asserts a date
  // nobody gave us. `timelineRange` is widened by `taskActuals` instead, so a
  // bar that falls outside the axis is a bug rather than something to hide.
  const leadDays = Math.max(0, days(range.from, from) - 1);
  const solidDays = Math.max(1, days(from, to));
  const trailDays = Math.max(0, range.days - leadDays - solidDays - remainderDays);

  return { kind, leadDays, solidDays, remainderDays, trailDays, from, to, fromSprint };
}

/**
 * What the strip's fourth stat says, and it is not always "days left".
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
