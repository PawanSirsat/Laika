import type { Sprint } from '../../../api/sprints.ts';

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
 * ## Tasks have no bars, and that is the whole point
 *
 * The prototype's timeline gives every task its own start and length
 * (`tlSpans`), which is fiction: `tasks` has no planned-start and no due-date
 * column, and D-014 keeps it that way deliberately — *"draw it from sprint
 * boundaries and it costs a view; draw it from task dates and it costs a
 * scheduling engine."* Reproducing those rows would mean inventing dates, which
 * is the artifact class `docs/design/README.md` says not to copy.
 *
 * So a task appears **inside** its sprint's bar or in the unscheduled tray, and
 * nothing in this file positions a task on the axis. There is a test that keeps
 * it that way.
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
export function timelineRange(sprints: readonly Sprint[]): TimelineRange | null {
  if (sprints.length === 0) return null;

  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  for (const sprint of sprints) {
    from = Math.min(from, startOfDay(sprint.starts_on));
    to = Math.max(to, startOfDay(sprint.ends_on));
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

/** One drawn row: a task, and the sprint whose range its bar spans. */
export interface TimelineTaskRow<T> {
  readonly sprint: Sprint;
  readonly task: T;
}

/**
 * One row per scheduled task, in sprint order and then the board's own order
 * (LAI-426).
 *
 * ## The bar spans the *sprint*, not the task
 *
 * The design draws `LAI-131 DONE 27 Jul – 5 Aug` — a per-task range. **D-014
 * refuses that**: "the timeline is sprint-based; tasks never get dates", because
 * drawing it from sprint boundaries costs a view and drawing it from task dates
 * costs a scheduling engine. There is no `starts_on` on a task and there must
 * not be one.
 *
 * So every task in a sprint gets that sprint's extent. They differ by row and by
 * status colour, not by where the bar begins. That is the honest reading: what
 * the data knows is *which sprint holds this task*, and that is what is drawn.
 *
 * Order within a sprint is the order the board returned, deliberately — the
 * screen should not invent a second ranking of tasks that disagrees with the one
 * the reader just saw on the board.
 */
export function taskRows<T>(
  rows: readonly { readonly sprint: Sprint; readonly tasks: readonly T[] }[],
): TimelineTaskRow<T>[] {
  // `rows` arrives in calendar order from `useSprints`; flattening preserves it,
  // and preserves the board's order inside each sprint.
  return rows.flatMap((row) => row.tasks.map((task) => ({ sprint: row.sprint, task })));
}
