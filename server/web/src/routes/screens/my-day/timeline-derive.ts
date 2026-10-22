import type { MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { addDays, atClock } from './my-day-derive.ts';

/**
 * My day's lane timeline (LAI-831, the owner's "Laika App v2" design): the
 * day's blocks along the hours, the **gaps** between them, the breaks the
 * person waved away, and the arithmetic of moving an edge.
 *
 * **Minutes after the day's midnight**, in the day's own zone (`view.tz`), are
 * the unit throughout; the page turns them back into instants only to write.
 * **Only what has a time is placed**: a block added by its length alone has
 * no place on the day, so it is counted and listed rather than put somewhere
 * invented — and so it never closes a gap.
 *
 * Pure: the clock is passed in.
 */

/** A gap shorter than this is a breath, not unaccounted time (the owner's design). */
export const GAP_MIN = 20;
/** Edges move, and lengths change, in steps of this many minutes. */
export const STEP = 5;
/** The working day the axis shows when nothing falls outside it: 6 AM to 10 PM. */
export const AXIS_FROM = 6;
export const AXIS_TO = 22;

export type Zoom = 'fit' | '1' | '2';
/**
 * Pixels an hour at 1× and 2× (the owner's "Laika App v3" Timeline: 160 and
 * 320); `fit` is the whole axis in the width there is, idle hours folded.
 */
export const PX_PER_HOUR: Readonly<Record<Zoom, number | undefined>> = {
  fit: undefined,
  '1': 160,
  '2': 320,
};
/** An idle stretch at either end of the day this long or longer folds at Fit (LAI-883). */
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
 * placed blocks, less every break. Nothing before the first block and nothing
 * after the last counts — the day starts when the person did and ends with its
 * last block; an evening is not hours unaccounted (review round 1).
 */
export function gapsOf(blocks: readonly Span[], breaks: readonly Span[]): Span[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const gaps: Span[] = [];
  let reach: number | undefined;
  for (const block of sorted) {
    if (reach !== undefined && block.start - reach >= GAP_MIN) {
      gaps.push({ start: reach, end: block.start });
    }
    reach = reach === undefined ? block.end : Math.max(reach, block.end);
  }
  return gaps
    .flatMap((gap) => clip(gap, breaks))
    .filter((piece) => piece.end - piece.start >= GAP_MIN);
}

export function dayLine(
  view: Pick<MyDay, 'day' | 'tz' | 'today' | 'drafts' | 'entries' | 'breaks' | 'signal_times'> & {
    readonly agent?: Pick<MyDay['agent'], 'lane'>;
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
  const now = view.day === view.today ? minute(nowMs) : undefined;
  const gaps = gapsOf(blocks, breaks);

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

  const starts = [...blocks, ...breaks, ...signals, ...agents].map((s) => s.start);
  const ends = [
    ...[...blocks, ...breaks, ...agents].map((s) => s.end),
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
  return { midnight, length, blocks, untimed, gaps, breaks, signals, agents, now, from, to, hours };
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

/** A box on the screen, in px. */
export interface Box {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

/** A count badge inside its block's end, or centred over a block too narrow for it. */
export type ChipPlace = 'end' | 'centre';

/** A badge as drawn: the key of its block, its width, and its top and bottom. */
export interface ChipSize {
  readonly id: string;
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
}

/** Two boxes share more than half a pixel each way: one would be drawn over the other. */
const crosses = (a: Box, b: Box): boolean =>
  Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;

/**
 * Where each block's count badge goes, from the boxes as drawn (LAI-860):
 * inside the block's end, `inset` from it, where it fits; centred over the
 * block where it does not. A badge is drawn only when that box clears every
 * other block, every badge already placed and both ends of the track, so a
 * short block with room around it keeps its badge and one among neighbours
 * goes without. Longer blocks are placed first. `blocks` is keyed as the
 * badges are; a badge whose block is not there is left out.
 */
export function placeChips(
  chips: readonly ChipSize[],
  blocks: ReadonlyMap<string, Box>,
  track: Pick<Box, 'l' | 'r'>,
  inset: number,
): Map<string, ChipPlace> {
  const across = (id: string): number => {
    const b = blocks.get(id);
    return b === undefined ? 0 : b.r - b.l;
  };
  const order = [...chips].sort(
    (a, b) =>
      across(b.id) - across(a.id) || (blocks.get(a.id)?.l ?? 0) - (blocks.get(b.id)?.l ?? 0),
  );
  const places = new Map<string, ChipPlace>();
  const drawn: Box[] = [];
  for (const chip of order) {
    const own = blocks.get(chip.id);
    if (own === undefined) continue;
    const place: ChipPlace = chip.width <= own.r - own.l - 2 * inset ? 'end' : 'centre';
    const l = place === 'end' ? own.r - inset - chip.width : (own.l + own.r - chip.width) / 2;
    const box = { l, r: l + chip.width, t: chip.top, b: chip.bottom };
    if (box.l < track.l - 0.5 || box.r > track.r + 0.5) continue;
    if ([...blocks].some(([id, b]) => id !== chip.id && crosses(box, b))) continue;
    if (drawn.some((d) => crosses(box, d))) continue;
    places.set(chip.id, place);
    drawn.push(box);
  }
  return places;
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
export function limitsOf(block: Span, confirmed: readonly Span[], length = 1440): Limits {
  let lo = 0;
  let hi = length;
  for (const c of confirmed) {
    if (c.end <= block.start) lo = Math.max(lo, c.end);
    else if (c.start >= block.end) hi = Math.min(hi, c.start);
  }
  return { lo, hi };
}

/** {@link limitsOf} a placed block, among the day's other confirmed blocks. */
export function limitsIn(line: Pick<DayLine, 'blocks' | 'length'>, block: LaneBlock): Limits {
  return limitsOf(
    block,
    line.blocks.filter((b) => b.kind === 'confirmed' && b.id !== block.id),
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

/** Minutes after midnight to px along the track, and back (LAI-883). */
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
 * The idle stretches Fit folds (the owner's design, LAI-883): before the
 * first thing placed on the day and after the last — or after now, on today,
 * so the now line always stands on an open stretch — each only when it is
 * {@link FOLD_MIN} minutes or longer. A day with nothing placed folds
 * nothing: there is nothing to make room for.
 */
export function idleEnds(
  line: Pick<DayLine, 'blocks' | 'breaks' | 'signals' | 'agents' | 'now' | 'from' | 'to'>,
): Span[] {
  const starts = [...line.blocks, ...line.breaks, ...line.signals, ...line.agents].map(
    (s) => s.start,
  );
  const ends = [
    ...[...line.blocks, ...line.breaks, ...line.agents].map((s) => s.end),
    ...line.signals.map((s) => s.start + SIGNAL_MINUTES),
  ];
  if (starts.length === 0) return [];
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
 * Where each minute of the axis is drawn (LAI-883). At 1× and 2× the axis is
 * linear at {@link PX_PER_HOUR}. At Fit it is `width` px across, with every
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
  const pph = PX_PER_HOUR[zoom];
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
 * LAI-883): confirmed, drafted on a card or General, drafted on nothing, and
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
