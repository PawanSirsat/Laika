import type { MyDay, TimeDraft, TimeEntry, TimeSettings } from '../../../api/time.ts';
import { addDays, atClock } from './my-day-derive.ts';

/**
 * My day's lane timeline (LAI-831, the owner's "Laika App v2" design): the
 * day's blocks along the hours, the **gaps** between them, the breaks the
 * person waved away, the organisation's scheduled breaks (D-101), and the
 * arithmetic of moving an edge.
 *
 * **Minutes after the day's midnight**, in the day's own zone (`view.tz`), are
 * the unit throughout; the page turns them back into instants only to write.
 * **Only what has a time is placed**: a block added by its length alone has
 * no place on the day, so it is counted and listed rather than put somewhere
 * invented — and so it never closes a gap.
 *
 * Pure: the clock is passed in.
 */

/**
 * A gap shorter than this is a breath, not unaccounted time: the owner's My
 * Day design counts every gap of five minutes or more (`gaps()`, LAI-510).
 */
export const GAP_MIN = 5;
/** Edges move, and lengths change, in steps of this many minutes. */
export const STEP = 5;
/** The working day the axis shows when nothing falls outside it: 6 AM to 10 PM. */
export const AXIS_FROM = 6;
export const AXIS_TO = 22;

/**
 * The scale (D-113, LAI-300): `fit` — the whole day in the width there is,
 * idle hours folded — or a multiple of the design's 160px an hour, anywhere
 * from where the whole axis would fit to {@link ZOOM_MAX}. One number, so the
 * *Time zoom* slider, its keys, pinch and Ctrl/Cmd + wheel all move the same
 * state.
 */
export type Zoom = 'fit' | number;
/** The design's 1×: 160 px an hour (the owner's "Laika App v3" Timeline). */
export const BASE_PX_PER_HOUR = 160;
/** As far in as the scale goes: 5×, the last of LAI-890's steps. */
export const ZOOM_MAX = 5;
/** The levels the slider's keys walk, in order (LAI-890's stepper, D-113). */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 5] as const;

/** Pixels an hour at `zoom`; `undefined` at Fit, which the width decides. */
export const pxPerHour = (zoom: Zoom): number | undefined =>
  zoom === 'fit' ? undefined : BASE_PX_PER_HOUR * zoom;

/**
 * The least multiple worth zooming to: the one at which the whole axis, from
 * hour `from` to hour `to`, is exactly `width` px. Further out the track is
 * narrower than its box and shows nothing more. Unmeasured, half — the
 * smallest of LAI-890's steps.
 */
export function zoomFloor(from: number, to: number, width: number): number {
  if (!(width > 0) || to <= from) return ZOOM_STEPS[0];
  return Math.min(ZOOM_MAX, width / ((to - from) * BASE_PX_PER_HOUR));
}

/** The multiple `zoom` draws at, Fit counted as its floor. */
export const zoomFactor = (zoom: Zoom, floor: number): number => (zoom === 'fit' ? floor : zoom);

/**
 * A multiple held inside the scale's range: at or under the floor it is Fit
 * — the whole day — and past {@link ZOOM_MAX} it is that.
 */
export function clampZoom(factor: number, floor: number): Zoom {
  if (!Number.isFinite(factor) || factor <= floor) return 'fit';
  return Math.min(ZOOM_MAX, factor);
}

/**
 * The *Time zoom* slider's own units: a hundredth of a doubling, so a drag
 * across it is even however far in it goes, and 1× and 2× land on 0 and 100
 * exactly. Its least value is Fit.
 */
export const sliderMin = (floor: number): number => Math.floor(Math.log2(floor) * 100);
export const sliderMax = (): number => Math.round(Math.log2(ZOOM_MAX) * 100);
export const sliderValue = (zoom: Zoom, floor: number): number =>
  zoom === 'fit'
    ? sliderMin(floor)
    : Math.max(sliderMin(floor), Math.min(sliderMax(), Math.round(Math.log2(zoom) * 100)));
export const zoomOfSlider = (value: number, floor: number): Zoom =>
  value <= sliderMin(floor)
    ? 'fit'
    : value >= sliderMax()
      ? ZOOM_MAX
      : clampZoom(2 ** (value / 100), floor);

/**
 * The next of {@link ZOOM_STEPS} in or out of `zoom` (LAI-890), from wherever
 * a pinch left it: in from Fit is the first step past the floor, and out past
 * the floor is Fit. `undefined` past either end.
 */
export function zoomStep(zoom: Zoom, by: 1 | -1, floor: number): Zoom | undefined {
  const at = zoomFactor(zoom, floor);
  if (by > 0) {
    if (zoom !== 'fit' && at >= ZOOM_MAX) return undefined;
    const next = ZOOM_STEPS.find((s) => s > at + 1e-6 && s > floor);
    return next ?? ZOOM_MAX;
  }
  if (zoom === 'fit') return undefined;
  const next = [...ZOOM_STEPS].reverse().find((s) => s < at - 1e-6);
  return next === undefined || next <= floor ? 'fit' : next;
}

/** `1.5×`, `1×`, `0.75×` — or `Fit`. */
export const zoomLabel = (zoom: Zoom): string =>
  zoom === 'fit' ? 'Fit' : `${String(Number(zoom.toFixed(zoom < 1 ? 2 : 1)))}×`;
/** An idle stretch at either end of the day this long or longer folds at Fit (LAI-888). */
export const FOLD_MIN = 45;
/** How wide a folded stretch is drawn, in px. */
export const FOLD_PX = 92;

export interface LaneBlock {
  readonly kind: 'confirmed' | 'drafted';
  readonly id: string;
  /** Minutes after the day's midnight. */
  readonly start: number;
  readonly end: number;
  readonly minutes: number;
  /** A drafted block on no card, no space and not General. */
  readonly needsCard: boolean;
  /** Imported from Solidtime: changed there, never dragged here (LAI-788). */
  readonly locked: boolean;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface BreakSpan extends Span {
  readonly id: string;
}

/**
 * One window of the organisation's break schedule on the day (D-101): display
 * only — never time, never compared with what the person did in it.
 */
export interface ScheduledSpan extends Span {
  readonly label: string;
}

/** One run of a scheduled window: worked under a block, or not. */
export interface WorkedRun extends Span {
  readonly worked: boolean;
}

/** What the day did inside a scheduled window (LAI-894, D-105). */
export interface WorkedIn {
  /** Minutes of the window under a confirmed or drafted block, each minute once. */
  readonly worked: number;
  /** The rest of the window. */
  readonly rest: number;
  /** The window start to end, each stretch worked or not, adjacent alike merged. */
  readonly runs: readonly WorkedRun[];
}

/**
 * The organisation's window set against the blocks (LAI-894, D-105): how many
 * of its minutes any block covers — two blocks at once count once — and the
 * runs across it, for the pill's bar. A block partly outside is clipped to the
 * window; one that does not touch it is nothing.
 */
export function workedIn(blocks: readonly Span[], window: Span): WorkedIn {
  const length = Math.max(0, window.end - window.start);
  const cuts = new Set<number>([window.start, window.end]);
  for (const b of blocks) {
    if (b.end <= window.start || b.start >= window.end) continue;
    cuts.add(Math.max(window.start, b.start));
    cuts.add(Math.min(window.end, b.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const runs: WorkedRun[] = [];
  let worked = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const start = points[i] ?? window.start;
    const end = points[i + 1] ?? window.end;
    if (end <= start) continue;
    // Every cut is a block edge, so a stretch is under a block wholly or not at all.
    const under = blocks.some((b) => b.start < end && b.end > start);
    if (under) worked += end - start;
    const last = runs[runs.length - 1];
    if (last?.worked === under) {
      runs[runs.length - 1] = { start: last.start, end, worked: under };
    } else {
      runs.push({ start, end, worked: under });
    }
  }
  return { worked, rest: length - worked, runs };
}

/** A signal's time is known to this many minutes and no finer (D-096). */
export const SIGNAL_MINUTES = 5;

/** One mark on the SIGNALS lane: prompts or commits in one five minutes. */
export interface SignalMark {
  readonly kind: 'prompt' | 'commit';
  /** The five minutes' start, in minutes after midnight. */
  readonly start: number;
  readonly count: number;
}

/** The agent's work is known to this many minutes and no finer (LAI-833). */
export const AGENT_MINUTES = 5;

/** One bar on the AGENTS lane: buckets back to back, all on a card or all off one. */
export interface AgentRun {
  /** Minutes after midnight. */
  readonly start: number;
  readonly end: number;
  readonly seconds: number;
  /** Most of each bucket's time was on a card its session was split to. */
  readonly onCard: boolean;
}

export interface DayLine {
  /** The day's midnight, unix ms, or `undefined` for a day that is not one. */
  readonly midnight: number | undefined;
  /** How many minutes the day has — 1440, or one hour either side on a clock change. */
  readonly length: number;
  readonly blocks: readonly LaneBlock[];
  /** Blocks with no set time, which the lane cannot place. */
  readonly untimed: number;
  readonly gaps: readonly Span[];
  readonly breaks: readonly BreakSpan[];
  /** The organisation's breaks whose weekday is this day's, in order. */
  readonly scheduled: readonly ScheduledSpan[];
  /**
   * The SIGNALS lane (LAI-834): the day's prompts, then its commits, each in
   * the five minutes it fell in — only what the server sent (D-096).
   */
  readonly signals: readonly SignalMark[];
  /** The AGENTS lane (LAI-833): when the agent worked, on a card or grey. */
  readonly agents: readonly AgentRun[];
  /** Minutes after midnight, on today only. */
  readonly now: number | undefined;
  /** The first and last hour on the axis, counted from midnight. */
  readonly from: number;
  readonly to: number;
  /**
   * Each hour of the clock and the minute after midnight it really falls on
   * (review round 1): on a clock-change day 6 AM is seven hours, or five,
   * after midnight, so a label is placed by its instant, never at `h × 60`.
   */
  readonly hours: readonly HourMark[];
}

export interface HourMark {
  /** `0`–`24` on the wall clock. */
  readonly hour: number;
  /** Minutes after the day's midnight. */
  readonly minute: number;
}

type Timed = Pick<TimeDraft | TimeEntry, 'id' | 'started_at' | 'ended_at' | 'minutes'>;

const needsCard = (d: TimeDraft): boolean => d.task === null && d.project === null && !d.general;

/** `[start, end)` less every span in `cuts`, in order. */
export function clip(span: Span, cuts: readonly Span[]): Span[] {
  let pieces: Span[] = [span];
  for (const cut of cuts) {
    const next: Span[] = [];
    for (const piece of pieces) {
      if (cut.end <= piece.start || cut.start >= piece.end) {
        next.push(piece);
        continue;
      }
      if (cut.start > piece.start) next.push({ start: piece.start, end: cut.start });
      if (cut.end < piece.end) next.push({ start: cut.end, end: piece.end });
    }
    pieces = next;
  }
  return pieces;
}

/**
 * The gaps of a day: stretches of at least {@link GAP_MIN} minutes **between**
 * placed blocks, less every break — the person's own and the organisation's
 * scheduled ones alike (D-101). Nothing before the first block and nothing
 * after the last counts — the day starts when the person did and ends with its
 * last block; an evening is not hours unaccounted (review round 1).
 */
export function gapsOf(
  blocks: readonly Span[],
  breaks: readonly Span[],
  scheduled: readonly Span[] = [],
): Span[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const gaps: Span[] = [];
  let reach: number | undefined;
  for (const block of sorted) {
    if (reach !== undefined && block.start - reach >= GAP_MIN) {
      gaps.push({ start: reach, end: block.start });
    }
    reach = reach === undefined ? block.end : Math.max(reach, block.end);
  }
  const cuts = [...breaks, ...scheduled];
  return gaps
    .flatMap((gap) => clip(gap, cuts))
    .filter((piece) => piece.end - piece.start >= GAP_MIN);
}

/** `2026-10-20` → its ISO weekday, 1 (Monday) to 7 (Sunday). */
const isoDay = (day: string): number => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

export function dayLine(
  view: Pick<MyDay, 'day' | 'tz' | 'today' | 'drafts' | 'entries' | 'breaks' | 'signal_times'> & {
    readonly agent?: Pick<MyDay['agent'], 'lane'>;
    readonly settings?: Pick<TimeSettings, 'breaks'>;
  },
  nowMs: number,
): DayLine {
  const midnight = atClock(view.day, '00:00', view.tz);
  const next = atClock(addDays(view.day, 1), '00:00', view.tz);
  const length =
    midnight === undefined || next === undefined ? 1440 : Math.round((next - midnight) / 60_000);
  const minute = (ms: number): number =>
    midnight === undefined
      ? 0
      : Math.min(length, Math.max(0, Math.round((ms - midnight) / 60_000)));

  const blocks: LaneBlock[] = [];
  let untimed = 0;
  const place = (
    kind: LaneBlock['kind'],
    item: Timed,
    extra: Pick<LaneBlock, 'needsCard' | 'locked'>,
  ): void => {
    if (item.started_at === null || item.ended_at === null) {
      untimed += 1;
      return;
    }
    const start = minute(item.started_at);
    const end = minute(item.ended_at);
    if (end <= start) {
      untimed += 1;
      return;
    }
    blocks.push({ kind, id: item.id, start, end, minutes: item.minutes, ...extra });
  };
  for (const entry of view.entries) {
    place('confirmed', entry, { needsCard: false, locked: entry.source === 'import' });
  }
  for (const draft of view.drafts) {
    place('drafted', draft, { needsCard: needsCard(draft), locked: false });
  }
  blocks.sort((a, b) => a.start - b.start);

  const breaks: BreakSpan[] = view.breaks.map((b) => ({
    id: b.id,
    start: minute(b.started_at),
    end: minute(b.ended_at),
  }));
  // Each wall-clock window on this weekday, at the instant it names in the
  // day's own zone (D-101 item 2) — on a clock-change day, where it really falls.
  const weekday = isoDay(view.day);
  const scheduled: ScheduledSpan[] = [];
  if (midnight !== undefined) {
    for (const w of view.settings?.breaks ?? []) {
      if (!w.days.includes(weekday)) continue;
      const a = atClock(view.day, w.start, view.tz);
      const b = atClock(view.day, w.end, view.tz);
      if (a === undefined || b === undefined) continue;
      const start = minute(a);
      const end = minute(b);
      if (end > start) scheduled.push({ label: w.label, start, end });
    }
    scheduled.sort((x, y) => x.start - y.start);
  }
  const now = view.day === view.today ? minute(nowMs) : undefined;
  const gaps = gapsOf(blocks, breaks, scheduled);

  // Placed as sent, never clamped onto the day: one that is not on it is left out.
  const signals: SignalMark[] = [];
  const times = view.signal_times;
  if (midnight !== undefined && times !== undefined) {
    for (const [kind, list] of [
      ['prompt', times.prompts],
      ['commit', times.commits],
    ] as const) {
      for (const [ms, count] of list) {
        const start = Math.round((ms - midnight) / 60_000);
        if (start >= 0 && start < length) signals.push({ kind, start, count });
      }
    }
  }

  // The agent's buckets, as sent; back to back and alike, one bar.
  const agents: AgentRun[] = [];
  if (midnight !== undefined) {
    for (const [ms, seconds, onCardSeconds] of view.agent?.lane ?? []) {
      const start = Math.round((ms - midnight) / 60_000);
      if (start < 0 || start >= length || !(seconds > 0)) continue;
      const onCard = onCardSeconds * 2 >= seconds;
      const last = agents.at(-1);
      if (last?.end === start && last.onCard === onCard) {
        agents[agents.length - 1] = {
          ...last,
          end: start + AGENT_MINUTES,
          seconds: last.seconds + seconds,
        };
      } else {
        agents.push({ start, end: start + AGENT_MINUTES, seconds, onCard });
      }
    }
  }

  const starts = [...blocks, ...breaks, ...scheduled, ...signals, ...agents].map((s) => s.start);
  const ends = [
    ...[...blocks, ...breaks, ...scheduled, ...agents].map((s) => s.end),
    ...signals.map((s) => s.start + SIGNAL_MINUTES),
  ];
  if (now !== undefined) {
    starts.push(now);
    ends.push(now);
  }
  const last = Math.ceil(length / 60);
  const from = Math.max(0, Math.min(AXIS_FROM, ...starts.map((m) => Math.floor(m / 60))));
  const to = Math.min(last, Math.max(AXIS_TO, ...ends.map((m) => Math.ceil(m / 60))));
  const hours: HourMark[] = [];
  for (let hour = 0; hour <= 24; hour += 1) {
    const at =
      hour === 24 ? next : atClock(view.day, `${String(hour).padStart(2, '0')}:00`, view.tz);
    if (midnight === undefined || at === undefined) {
      hours.push({ hour, minute: hour * 60 });
      continue;
    }
    const m = Math.round((at - midnight) / 60_000);
    // A wall hour the clock skips names the same instant as the next one: once.
    if (hours.at(-1)?.minute !== m) hours.push({ hour, minute: m });
  }
  return {
    midnight,
    length,
    blocks,
    untimed,
    gaps,
    breaks,
    scheduled,
    signals,
    agents,
    now,
    from,
    to,
    hours,
  };
}

/** Where `minute` sits along an axis from hour `from` to hour `to`, as a percentage. */
export function along(minute: number, from: number, to: number): number {
  const span = (to - from) * 60;
  return span <= 0 ? 0 : ((minute - from * 60) / span) * 100;
}

/** The axis's labelled hours: every hour, or every other one when the whole day must fit. */
export function axisHours(from: number, to: number, zoom: Zoom): number[] {
  const hours: number[] = [];
  for (let hour = from; hour <= to; hour += 1) {
    if (zoom !== 'fit' || hour % 2 === 0) hours.push(hour);
  }
  return hours;
}

/** The labelled hours inside the axis: every hour, or every other one when the day must fit. */
export function axisMarks(line: Pick<DayLine, 'hours' | 'from' | 'to'>, zoom: Zoom): HourMark[] {
  return line.hours.filter(
    (h) =>
      h.minute >= line.from * 60 &&
      h.minute <= line.to * 60 &&
      (zoom !== 'fit' || h.hour % 2 === 0),
  );
}

/** Which row of the lane a block takes, out of how many its stretch needs. */
export interface Stack {
  readonly row: number;
  readonly rows: number;
}

/**
 * Blocks at the same time share the lane's height, a row each, rather than
 * being drawn over one another (LAI-860): two sessions on two cards make two
 * blocks over the same minutes. A stretch is blocks whose spans overlap; each
 * takes the first row free at its start, and every block in the stretch
 * learns how many rows it needed. A block nothing overlaps is one row of one.
 * Index for index with `blocks`.
 */
export function stackOf(blocks: readonly Span[]): Stack[] {
  const stacks: Stack[] = blocks.map(() => ({ row: 0, rows: 1 }));
  const order = blocks
    .map((_, i) => i)
    .sort((a, b) => (blocks[a]?.start ?? 0) - (blocks[b]?.start ?? 0));
  let stretch: number[] = [];
  let ends: number[] = [];
  let reach = -Infinity;
  const close = (): void => {
    for (const i of stretch) stacks[i] = { row: stacks[i]?.row ?? 0, rows: ends.length };
  };
  for (const i of order) {
    const block = blocks[i];
    if (block === undefined) continue;
    if (block.start >= reach) {
      close();
      stretch = [];
      ends = [];
    }
    const free = ends.findIndex((end) => end <= block.start);
    const row = free === -1 ? ends.length : free;
    ends[row] = block.end;
    stacks[i] = { row, rows: 1 };
    stretch.push(i);
    reach = Math.max(reach, block.end);
  }
  close();
  return stacks;
}

/* ---------------------------------------------- lanes and groups (LAI-300) */

/** The YOU row's blocks: the design's 80px. Automatic since D-113 — there is no grip. */
export const BLOCK_PX = 80;
/** Lanes sharing the row, and an open group's lanes, lie this far apart. */
export const LANE_GAP_PX = 2;
/**
 * The least a lane is drawn (D-113): one line of label, readable. Lanes that
 * would each be shorter than this in the row are a group instead.
 */
export const LANE_MIN_PX = 24;
/** Each lane of an open group: a line of label with room around it. */
export const OPEN_LANE_PX = 28;
/**
 * The most lanes the row holds before a stretch becomes a group: as many as
 * keep each at {@link LANE_MIN_PX} or more in {@link BLOCK_PX}.
 */
export const ROW_LANES = Math.floor((BLOCK_PX + LANE_GAP_PX) / (LANE_MIN_PX + LANE_GAP_PX));
/** A block drawn narrower than this takes the pointer this wide, centred on it (D-113 item 4). */
export const HIT_MIN_PX = 24;

/** Where a block is drawn in the row (LAI-300). */
export interface Placed {
  /** Its lane in its stretch, and how many lanes the stretch has. */
  readonly lane: number;
  readonly lanes: number;
  /** Px below the top of the blocks, and how tall. */
  readonly top: number;
  readonly height: number;
  /** The group it is in, open or closed. */
  readonly group: string | undefined;
  /** In a closed group: not drawn — the group stands for it. */
  readonly hidden: boolean;
  /**
   * Where it takes the pointer, px along the track, when that is wider than
   * it is drawn: a block narrower than {@link HIT_MIN_PX}, its target held
   * off every neighbour beside it.
   */
  readonly hit: { readonly l: number; readonly r: number } | undefined;
}

/** A crowded stretch drawn as one marker that opens into lanes (D-113 item 3). */
export interface Group extends Span {
  /** Stable: from its first block by start, then id — never its place in the day. */
  readonly id: string;
  /** Its blocks, by start. */
  readonly ids: readonly string[];
  readonly lanes: number;
  readonly open: boolean;
  /** Px tall: the row's blocks when closed, its lanes when open. */
  readonly height: number;
  /** Each block where it falls and its lane, for the closed marker's faint bars. */
  readonly preview: readonly (Span & { readonly id: string; readonly lane: number })[];
  /** As {@link Placed.hit}, for a closed group drawn narrower than {@link HIT_MIN_PX}. */
  readonly hit: { readonly l: number; readonly r: number } | undefined;
}

/** "3 at once" above a stretch the row holds in lanes. */
export interface Strip extends Span {
  readonly id: string;
  readonly n: number;
}

export interface RowLayout {
  /** Every block, by id. */
  readonly placed: ReadonlyMap<string, Placed>;
  readonly groups: readonly Group[];
  readonly strips: readonly Strip[];
  /** The blocks' height in px: {@link BLOCK_PX}, or an open group's lanes where taller. */
  readonly height: number;
}

/** A group's id, from the id of its first block. */
export const groupIdOf = (firstId: string): string => `g-${firstId}`;

/**
 * The YOU row laid out (D-113, LAI-300). Blocks that **clash** — overlap in
 * time, or both drawn narrower than {@link HIT_MIN_PX} with their targets
 * overlapping — are one stretch, and each takes the first lane where it
 * clashes with nothing. A stretch of up to {@link ROW_LANES} lanes shares
 * the row, as LAI-860 drew it; a deeper one is a **group**, closed unless
 * its id is in `open`, and open it takes {@link OPEN_LANE_PX} a lane and the
 * row grows to hold it. A narrow block's target reaches {@link HIT_MIN_PX}
 * but stops at whatever is drawn beside it: blocks, closed groups, and
 * `obstacles` (the gaps and breaks, full height).
 *
 * Pure, and from the blocks as they are, never as a drag has them, so a
 * drag in flight cannot reshuffle the row under the pointer.
 */
export function layoutRow(
  blocks: readonly (Span & { readonly id: string })[],
  pos: (minute: number) => number,
  open: ReadonlySet<string> = new Set(),
  obstacles: readonly Span[] = [],
): RowLayout {
  const items = blocks.map((b) => {
    const x0 = pos(b.start);
    const x1 = pos(b.end);
    const tiny = x1 - x0 < HIT_MIN_PX;
    const c = (x0 + x1) / 2;
    return {
      ...b,
      x0,
      x1,
      tiny,
      e0: tiny ? c - HIT_MIN_PX / 2 : x0,
      e1: tiny ? c + HIT_MIN_PX / 2 : x1,
    };
  });
  type Item = (typeof items)[number];
  const clash = (a: Item, b: Item): boolean =>
    (a.start < b.end && b.start < a.end) || (a.tiny && b.tiny && a.e0 < b.e1 && b.e0 < a.e1);
  const order = items
    .map((_, i) => i)
    .sort((a, b) => {
      const p = items[a];
      const q = items[b];
      if (p === undefined || q === undefined) return 0;
      return p.start - q.start || p.end - q.end || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
    });

  // One stretch per set of blocks joined by clashes, however the chain runs.
  const parent = items.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] ?? r;
    parent[i] = r;
    return r;
  };
  for (let a = 0; a < order.length; a += 1) {
    for (let b = a + 1; b < order.length; b += 1) {
      const i = order[a] ?? 0;
      const j = order[b] ?? 0;
      const p = items[i];
      const q = items[j];
      if (p === undefined || q === undefined || !clash(p, q)) continue;
      const ri = root(i);
      const rj = root(j);
      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
  }
  const stretches = new Map<number, Item[]>();
  for (const i of order) {
    const item = items[i];
    if (item === undefined) continue;
    const r = root(i);
    const list = stretches.get(r) ?? [];
    list.push(item);
    stretches.set(r, list);
  }

  const placed = new Map<string, Placed>();
  const groups: Group[] = [];
  const strips: Strip[] = [];
  let height = BLOCK_PX;
  for (const members of stretches.values()) {
    const lanes: Item[][] = [];
    const laneOf = new Map<Item, number>();
    for (const item of members) {
      let lane = lanes.findIndex((l) => l.every((o) => !clash(item, o)));
      if (lane === -1) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane]?.push(item);
      laneOf.set(item, lane);
    }
    const depth = lanes.length;
    const first = members[0];
    if (first === undefined) continue;
    const start = Math.min(...members.map((m) => m.start));
    const end = Math.max(...members.map((m) => m.end));
    if (depth <= ROW_LANES) {
      const h = (BLOCK_PX + LANE_GAP_PX) / depth - LANE_GAP_PX;
      for (const m of members) {
        const lane = laneOf.get(m) ?? 0;
        placed.set(m.id, {
          lane,
          lanes: depth,
          top: lane * (h + LANE_GAP_PX),
          height: h,
          group: undefined,
          hidden: false,
          hit: undefined,
        });
      }
      if (depth > 1) strips.push({ id: first.id, start, end, n: depth });
      continue;
    }
    const id = groupIdOf(first.id);
    const isOpen = open.has(id);
    const tall = depth * (OPEN_LANE_PX + LANE_GAP_PX) - LANE_GAP_PX;
    if (isOpen) height = Math.max(height, tall);
    for (const m of members) {
      const lane = laneOf.get(m) ?? 0;
      placed.set(m.id, {
        lane,
        lanes: depth,
        top: lane * (OPEN_LANE_PX + LANE_GAP_PX),
        height: OPEN_LANE_PX,
        group: id,
        hidden: !isOpen,
        hit: undefined,
      });
    }
    groups.push({
      id,
      start,
      end,
      ids: members.map((m) => m.id),
      lanes: depth,
      open: isOpen,
      height: isOpen ? tall : BLOCK_PX,
      preview: members.map((m) => ({
        id: m.id,
        start: m.start,
        end: m.end,
        lane: laneOf.get(m) ?? 0,
      })),
      hit: undefined,
    });
  }

  // What is drawn, as boxes: each block's target, each closed group, each obstacle.
  interface Box {
    readonly key: string;
    readonly l: number;
    readonly r: number;
    readonly t: number;
    readonly b: number;
  }
  const boxes: Box[] = [];
  for (const item of items) {
    const p = placed.get(item.id);
    if (p === undefined || p.hidden) continue;
    boxes.push({ key: item.id, l: item.e0, r: item.e1, t: p.top, b: p.top + p.height });
  }
  for (const g of groups) {
    if (!g.open) boxes.push({ key: g.id, l: pos(g.start), r: pos(g.end), t: 0, b: BLOCK_PX });
  }
  for (const [i, o] of obstacles.entries()) {
    boxes.push({ key: `obstacle-${String(i)}`, l: pos(o.start), r: pos(o.end), t: 0, b: BLOCK_PX });
  }
  /** `[x0, x1]` widened to HIT_MIN_PX about its middle, then held off every box beside it. */
  const target = (key: string, x0: number, x1: number, t: number, b: number) => {
    if (x1 - x0 >= HIT_MIN_PX) return undefined;
    const c = (x0 + x1) / 2;
    let l = c - HIT_MIN_PX / 2;
    let r = c + HIT_MIN_PX / 2;
    for (const o of boxes) {
      if (o.key === key || o.t >= b || o.b <= t) continue;
      if (o.r <= x0 + 1e-6) l = Math.max(l, o.r);
      else if (o.l >= x1 - 1e-6) r = Math.min(r, o.l);
    }
    return { l: Math.min(l, x0), r: Math.max(r, x1) };
  };
  for (const item of items) {
    const p = placed.get(item.id);
    if (p === undefined || p.hidden || !item.tiny) continue;
    placed.set(item.id, { ...p, hit: target(item.id, item.x0, item.x1, p.top, p.top + p.height) });
  }
  const sized = groups.map((g) =>
    g.open ? g : { ...g, hit: target(g.id, pos(g.start), pos(g.end), 0, BLOCK_PX) },
  );
  return { placed, groups: sized, strips, height };
}

/**
 * Where to scroll so `minute` stays `offset` px into a view `viewW` wide on
 * `scale` (LAI-890, D-113): the anchor of every zoom — the pointer's minute
 * for a pinch or Ctrl/Cmd + wheel, the selected block or the middle for the
 * slider — clamped to the track, so a zoom never jumps.
 */
export function keepAt(scale: Scale, minute: number, offset: number, viewW: number): number {
  return Math.max(0, Math.min(Math.max(0, scale.total - viewW), scale.pos(minute) - offset));
}

/** A wheel event, as much of it as decides what it does. */
export interface WheelLike {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly deltaX: number;
  readonly deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number;
}

/** What a wheel over the Timeline does (D-113 item 2). */
export type WheelAction =
  | { readonly kind: 'zoom'; readonly by: number }
  | { readonly kind: 'pan'; readonly dx: number }
  | { readonly kind: 'native' };

/**
 * A Ctrl + wheel counts this many px of its delta at most: a mouse's notch
 * (100px) zooms by about a fifth, and a pinch's small deltas count whole.
 */
const ZOOM_DELTA_CAP = 25;

/**
 * Pinch — which a browser sends as a wheel with Ctrl — or Ctrl/Cmd + wheel
 * zooms, `by` the factor to multiply the scale by, around the pointer.
 * Shift + wheel pans sideways, but only while the track has room that way
 * (`room`, px to either edge): at an edge it is the page's. Everything else
 * is the browser's own — the wheel scrolls down, a trackpad pans — so it
 * goes on to the page at the Timeline's edges.
 */
export function wheelAction(
  event: WheelLike,
  room: { readonly left: number; readonly right: number },
): WheelAction {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  if (event.ctrlKey || event.metaKey) {
    const dy = Math.max(-ZOOM_DELTA_CAP, Math.min(ZOOM_DELTA_CAP, event.deltaY * unit));
    return { kind: 'zoom', by: Math.exp(-dy / 100) };
  }
  if (event.shiftKey) {
    const dx = (event.deltaX !== 0 ? event.deltaX : event.deltaY) * unit;
    if ((dx < 0 && room.left > 0.5) || (dx > 0 && room.right > 0.5)) return { kind: 'pan', dx };
  }
  return { kind: 'native' };
}

/** The nearest step on the clock: 8:42 → 8:40, 8:43 → 8:45. */
export const snap = (minute: number): number => Math.round(minute / STEP) * STEP;

/** A block's place and length after an edit, in minutes after midnight. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly minutes: number;
}

type Shape = Pick<LaneBlock, 'start' | 'end' | 'minutes'>;

/** How far a block's edges may go: from `lo` to `hi`, minutes after midnight. */
export interface Limits {
  readonly lo: number;
  readonly hi: number;
}

/**
 * The room a block has (review round 1): back to the end of the confirmed
 * block before it, on to the start of the one after it, and never off the
 * day — so a drag or a + cannot lay it over confirmed time, which would count
 * that time twice. A confirmed block that already overlaps it bounds nothing:
 * moving an edge cannot fix that, and the server refuses its confirm.
 */
/**
 * The free stretch around minute `at` among the confirmed blocks (LAI-897):
 * from the end of the last confirmed block before it to the start of the
 * first after, within the day. `undefined` when `at` lies inside one — there
 * is no free stretch to make a range in.
 */
export function freeAround(
  at: number,
  confirmed: readonly Span[],
  from = 0,
  length = 1440,
): Limits | undefined {
  let lo = from;
  let hi = length;
  for (const b of confirmed) {
    if (b.start <= at && b.end > at) return undefined;
    if (b.end <= at) lo = Math.max(lo, b.end);
    if (b.start >= at) hi = Math.min(hi, b.start);
  }
  return { lo, hi };
}

/**
 * A drag from `anchor` to `to` on the empty track (LAI-897): both ends on the
 * five-minute step, in order, clipped to the free stretch the anchor sits in.
 * `undefined` for a drag that starts on a confirmed block or ends up shorter
 * than one step — nothing to add.
 */
export function rangeFromDrag(
  anchor: number,
  to: number,
  confirmed: readonly Span[],
  from = 0,
  length = 1440,
): Span | undefined {
  const free = freeAround(anchor, confirmed, from, length);
  if (free === undefined) return undefined;
  const grid = (m: number): number => Math.round(m / STEP) * STEP;
  const a = Math.max(free.lo, Math.min(free.hi, grid(Math.min(anchor, to))));
  const b = Math.max(free.lo, Math.min(free.hi, grid(Math.max(anchor, to))));
  return b - a < STEP ? undefined : { start: a, end: b };
}

export function limitsOf(block: Span, confirmed: readonly Span[], length = 1440): Limits {
  let lo = 0;
  let hi = length;
  for (const c of confirmed) {
    if (c.end <= block.start) lo = Math.max(lo, c.end);
    else if (c.start >= block.end) hi = Math.min(hi, c.start);
  }
  return { lo, hi };
}

/**
 * {@link limitsOf} a placed block, among the day's other confirmed blocks — a
 * confirmed block's edges stop at its neighbours; a draft's run the whole
 * day, as the design's do (LAI-510).
 */
export function limitsIn(line: Pick<DayLine, 'blocks' | 'length'>, block: LaneBlock): Limits {
  return limitsOf(
    block,
    block.kind === 'confirmed'
      ? line.blocks.filter((b) => b.kind === 'confirmed' && b.id !== block.id)
      : [],
    line.length,
  );
}

/**
 * Drag one edge to `to` (minutes after midnight): the edge lands on the
 * nearest {@link STEP} of the clock, never closer than one step to the other
 * edge nor past its {@link Limits}, and the block's minutes change by as much
 * as its span did — a block that held less than its span (two tasks at once)
 * keeps that difference. `undefined` when nothing would change.
 */
export function dragEdge(
  block: Shape,
  edge: 'start' | 'end',
  to: number,
  limits: Limits = { lo: 0, hi: 1440 },
): Edit | undefined {
  const at = Math.min(limits.hi, Math.max(limits.lo, snap(to)));
  const start = edge === 'start' ? Math.min(at, block.end - STEP) : block.start;
  const end = edge === 'end' ? Math.max(at, block.start + STEP) : block.end;
  const moved = edge === 'start' ? block.start - start : end - block.end;
  if (moved === 0) return undefined;
  const minutes = Math.min(end - start, Math.max(1, block.minutes + moved));
  return { start, end, minutes };
}

/**
 * −/+ on a placed block: its end moves to the next {@link STEP} of the clock
 * that way — 10:13 goes to 10:15 or 10:10, as a drag lands (review round 1) —
 * and its length by as much, so the lane and the figure agree. `undefined`
 * under a step of span, or past `hi`: the day's end, or confirmed time.
 */
export function stepEnd(block: Shape, by: number, hi = 1440): Edit | undefined {
  const end =
    by > 0 ? Math.floor(block.end / STEP) * STEP + STEP : Math.ceil(block.end / STEP) * STEP - STEP;
  const minutes = block.minutes + (end - block.end);
  if (end - block.start < STEP || minutes < 1 || end > hi) return undefined;
  return { start: block.start, end, minutes: Math.min(end - block.start, minutes) };
}

/**
 * A length typed for a placed block (review round 1, LAI-830's parser): its
 * end moves by as much as its length does, as −/+ would — exact, not on the
 * grid, because it was typed. `undefined` under a step of span or past `hi`.
 */
export function setLength(block: Shape, minutes: number, hi = 1440): Edit | undefined {
  const end = block.end + (minutes - block.minutes);
  if (minutes < 1 || end - block.start < STEP || end > hi) return undefined;
  return { start: block.start, end, minutes: Math.min(end - block.start, minutes) };
}

/** −/+ on a block with no set time: its minutes alone, a step at a time, within a day. */
export function stepMinutes(minutes: number, by: number): number | undefined {
  const next = minutes + by;
  return next < STEP || next > 1440 ? undefined : next;
}

/**
 * *Split in two*: the middle of the block's span, on the five-minute grid of
 * the clock (review round 1) — 9:03–10:01 is cut at 9:30, not 9:33.
 * `undefined` for a block too short to halve, or one with no span.
 */
export function splitPoint(block: Shape): number | undefined {
  const span = block.end - block.start;
  if (span < 2 * STEP || block.minutes < 2) return undefined;
  const middle = (block.start + block.end) / 2;
  const inside = (m: number): boolean => m > block.start && m < block.end;
  return [snap(middle), Math.floor(middle / STEP) * STEP, Math.ceil(middle / STEP) * STEP].find(
    inside,
  );
}

/** The instant minute `m` of the day names, for a write. */
export const instantOf = (midnight: number, m: number): number => midnight + m * 60_000;

/** One stretch of the axis as drawn: minutes `t0`–`t1` onto px `p0`–`p1`. */
export interface Segment {
  readonly t0: number;
  readonly t1: number;
  readonly p0: number;
  readonly p1: number;
  /** Idle hours folded to {@link FOLD_PX} (Fit only). */
  readonly folded: boolean;
}

/** Minutes after midnight to px along the track, and back (LAI-888). */
export interface Scale {
  readonly segments: readonly Segment[];
  /** The track's width in px. */
  readonly total: number;
  readonly pos: (minute: number) => number;
  readonly at: (px: number) => number;
  /** `minute` lies strictly inside a folded stretch. */
  readonly folded: (minute: number) => boolean;
}

/**
 * The idle stretches Fit folds (the owner's design, LAI-888): before the
 * first thing placed on the day and after the last — or after now, on today,
 * so the now line always stands on an open stretch — each only when it is
 * {@link FOLD_MIN} minutes or longer. A day with nothing placed folds
 * nothing: there is nothing to make room for. The organisation's scheduled
 * breaks (D-101) are never folded away, but alone they place nothing.
 */
export function idleEnds(
  line: Pick<
    DayLine,
    'blocks' | 'breaks' | 'scheduled' | 'signals' | 'agents' | 'now' | 'from' | 'to'
  >,
): Span[] {
  const placed = [...line.blocks, ...line.breaks, ...line.signals, ...line.agents];
  if (placed.length === 0) return [];
  const starts = [...placed, ...line.scheduled].map((s) => s.start);
  const ends = [
    ...[...line.blocks, ...line.breaks, ...line.scheduled, ...line.agents].map((s) => s.end),
    ...line.signals.map((s) => s.start + SIGNAL_MINUTES),
  ];
  const a = line.from * 60;
  const b = line.to * 60;
  const first = Math.max(a, Math.min(...starts));
  const last = Math.min(b, Math.max(...ends, line.now ?? -Infinity));
  const folds: Span[] = [];
  if (first - a >= FOLD_MIN) folds.push({ start: a, end: first });
  if (b - last >= FOLD_MIN && last > first) folds.push({ start: last, end: b });
  return folds;
}

/**
 * Where each minute of the axis is drawn (LAI-888). At any multiple the axis
 * is linear at {@link pxPerHour}. At Fit it is `width` px across, with every
 * stretch in `folds` drawn {@link FOLD_PX} wide and the rest sharing what is
 * left — however little that is: Fit fits. A stretch that would be narrower
 * than {@link FOLD_PX} drawn as it is stays as it is. `width` of 0 — not
 * measured yet — gives a linear Fit at a pixel a minute, which the next
 * measure replaces.
 */
export function buildScale(
  from: number,
  to: number,
  zoom: Zoom,
  width: number,
  folds: readonly Span[] = [],
): Scale {
  const a = from * 60;
  const b = to * 60;
  const pph = pxPerHour(zoom);
  const segments: Segment[] = [];
  if (pph !== undefined || folds.length === 0) {
    const k = pph === undefined ? (width > 0 ? width / Math.max(1, b - a) : 1) : pph / 60;
    segments.push({ t0: a, t1: b, p0: 0, p1: (b - a) * k, folded: false });
  } else {
    // A fold only where it makes room: on a phone a stretch may be narrower
    // than FOLD_PX drawn as it is, and folding it would take width from the day.
    const k0 = width / Math.max(1, b - a);
    const sorted = [...folds]
      .map((f) => ({ start: Math.max(a, f.start), end: Math.min(b, f.end) }))
      .filter((f) => f.end > f.start && (f.end - f.start) * k0 > FOLD_PX)
      .sort((x, y) => x.start - y.start);
    const stretches: { readonly t0: number; readonly t1: number; readonly folded: boolean }[] = [];
    let cursor = a;
    for (const f of sorted) {
      if (f.start > cursor) stretches.push({ t0: cursor, t1: f.start, folded: false });
      stretches.push({ t0: f.start, t1: f.end, folded: true });
      cursor = f.end;
    }
    if (cursor < b) stretches.push({ t0: cursor, t1: b, folded: false });
    const open = stretches.filter((s) => !s.folded).reduce((n, s) => n + s.t1 - s.t0, 0);
    const room = width > 0 ? Math.max(1, width - sorted.length * FOLD_PX) : open;
    const k = open === 0 ? 1 : room / open;
    let p = 0;
    for (const s of stretches) {
      const len = s.folded ? FOLD_PX : (s.t1 - s.t0) * k;
      segments.push({ t0: s.t0, t1: s.t1, p0: p, p1: p + len, folded: s.folded });
      p += len;
    }
  }
  const total = segments.at(-1)?.p1 ?? 0;
  const pos = (minute: number): number => {
    if (minute <= a) return 0;
    for (const s of segments) {
      if (minute <= s.t1) return s.p0 + ((minute - s.t0) / (s.t1 - s.t0)) * (s.p1 - s.p0);
    }
    return total;
  };
  const at = (px: number): number => {
    if (px <= 0) return a;
    for (const s of segments) {
      if (px <= s.p1) return s.t0 + ((px - s.p0) / Math.max(1e-6, s.p1 - s.p0)) * (s.t1 - s.t0);
    }
    return b;
  };
  const folded = (minute: number): boolean =>
    segments.some((s) => s.folded && minute > s.t0 && minute < s.t1);
  return { segments, total, pos, at, folded };
}

/** The agent's work inside a span: how long, how much of it on a card, and how many runs. */
export function agentsDuring(
  runs: readonly AgentRun[],
  span: Span,
): { readonly seconds: number; readonly onCardSeconds: number; readonly runs: number } {
  let seconds = 0;
  let onCardSeconds = 0;
  let count = 0;
  for (const run of runs) {
    const overlap = Math.min(span.end, run.end) - Math.max(span.start, run.start);
    if (overlap <= 0) continue;
    const share = (run.seconds * overlap) / (run.end - run.start);
    seconds += share;
    if (run.onCard) onCardSeconds += share;
    count += 1;
  }
  return { seconds: Math.round(seconds), onCardSeconds: Math.round(onCardSeconds), runs: count };
}

/** The signals that fell inside a span, by kind. */
export function signalsDuring(
  marks: readonly SignalMark[],
  span: Span,
): { readonly prompts: number; readonly commits: number } {
  let prompts = 0;
  let commits = 0;
  for (const m of marks) {
    const mid = m.start + SIGNAL_MINUTES / 2;
    if (mid < span.start || mid >= span.end) continue;
    if (m.kind === 'prompt') prompts += m.count;
    else commits += m.count;
  }
  return { prompts, commits };
}

/**
 * The day's minutes by kind, for the Timeline's header (the owner's design,
 * LAI-888): confirmed, drafted on a card or General, drafted on nothing, and
 * the gaps between. Every block counts, placed or not; gaps are the lane's.
 */
export function dayFigures(
  view: Pick<MyDay, 'drafts' | 'entries'>,
  gaps: readonly Span[],
): {
  readonly confirmed: number;
  readonly drafted: number;
  readonly needsCard: number;
  readonly gaps: number;
} {
  return {
    confirmed: view.entries.reduce((n, e) => n + e.minutes, 0),
    drafted: view.drafts.reduce((n, d) => n + (needsCard(d) ? 0 : d.minutes), 0),
    needsCard: view.drafts.reduce((n, d) => n + (needsCard(d) ? d.minutes : 0), 0),
    gaps: gaps.reduce((n, g) => n + g.end - g.start, 0),
  };
}

/* ------------------------------------------------------- drag (LAI-512) */

/**
 * A block moved whole (the owner's `TimelineV2.dc.html`, LAI-512): its start
 * lands on the nearest {@link STEP} of the clock and its span comes with it;
 * its minutes do not change — a block that held less than its span keeps
 * that. **Never pinned to the day:** a move past midnight goes there, so
 * {@link checkDrop} can refuse it and the block goes back, as the design's
 * `check` does. `undefined` when nothing would move.
 */
export function moveBlock(block: Shape, toStart: number): Edit | undefined {
  const span = block.end - block.start;
  const start = snap(toStart);
  if (start === block.start) return undefined;
  return { start, end: start + span, minutes: block.minutes };
}

/** Why a drop was refused, and the confirmed block it would have lain over. */
export type DropCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly why: 'midnight' }
  | { readonly ok: false; readonly why: 'overlap'; readonly over: LaneBlock };

/**
 * Whether `span` may land where it is (the design's `check`): on the day,
 * and — for a confirmed block, or a tray item (`selfId` undefined) — over no
 * other confirmed block, whose time would count twice (review round 1 of
 * LAI-831). **A draft may lie anywhere** (the design, LAI-510): confirming
 * it there is what the server refuses.
 */
export function checkDrop(
  span: Span,
  blocks: readonly LaneBlock[],
  selfId: string | undefined,
  length = 1440,
): DropCheck {
  if (span.start < 0 || span.end > length) return { ok: false, why: 'midnight' };
  const self = selfId === undefined ? undefined : blocks.find((b) => b.id === selfId);
  if (self !== undefined && self.kind !== 'confirmed') return { ok: true };
  const over = blocks.find(
    (b) => b.kind === 'confirmed' && b.id !== selfId && b.start < span.end && b.end > span.start,
  );
  return over === undefined ? { ok: true } : { ok: false, why: 'overlap', over };
}

/**
 * Where a tray item dropped at minute `at` lands: centred on the pointer, on
 * the five-minute grid, at least a step long. Like {@link moveBlock}, never
 * pinned to the day: one that would cross midnight is {@link checkDrop}'s to
 * refuse (the design's `onExtOver` and `check`).
 */
export function trayDropSpan(at: number, minutes: number): Span {
  const len = Math.max(STEP, minutes);
  const start = snap(at - len / 2);
  return { start, end: start + len };
}

/** The running timer as a block on the day (LAI-512): where it started and how far it has run. */
export interface TimerSpan extends Span {
  /** Minutes it has run, paused time left out. */
  readonly minutes: number;
  readonly paused: boolean;
}

/**
 * The timer drawn on the track (the design's `S.timer`): from the minute it
 * started to now — three minutes wide at least, so it can be seen and
 * clicked — only on the day it started. `undefined` on any other day, or
 * when there is none.
 */
export function timerSpan(
  timer: {
    readonly started_at: number;
    readonly resumed_at: number;
    readonly paused_at: number | null;
    readonly accumulated_ms: number;
  } | null,
  midnight: number | undefined,
  length: number,
  nowMs: number,
): TimerSpan | undefined {
  if (timer === null || midnight === undefined) return undefined;
  const start = Math.round((timer.started_at - midnight) / 60_000);
  if (start < 0 || start >= length) return undefined;
  const paused = timer.paused_at !== null;
  const ran = timer.accumulated_ms + (paused ? 0 : Math.max(0, nowMs - timer.resumed_at));
  const minutes = Math.floor(ran / 60_000);
  const end = Math.min(length, start + Math.max(minutes, 3));
  return { start, end, minutes, paused };
}
