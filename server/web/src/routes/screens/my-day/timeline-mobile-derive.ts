import type { DayLine, Span } from './timeline-derive.ts';

/**
 * The phone Timeline's zooms (the owner's `TimelineMobileV2.dc.html`,
 * LAI-518): Fit is 1.7px a minute with every idle stretch folded to
 * {@link MOBILE_FOLD_PX}; 1× is 2.4 and 2× 4.8, linear.
 */
export type MobileZoom = 'fit' | '1' | '2';

export const MOBILE_PX_PER_MINUTE: Readonly<Record<MobileZoom, number>> = {
  fit: 1.7,
  '1': 2.4,
  '2': 4.8,
};

/** An idle stretch folded at Fit is this tall, whatever its length. */
export const MOBILE_FOLD_PX = 60;

/** A fold only where it saves room: a stretch shorter than this drawn as it is stays. */
const WORTH_FOLDING_PX = MOBILE_FOLD_PX + 20;

export interface MobileSegment {
  readonly t0: number;
  readonly t1: number;
  readonly p0: number;
  readonly p1: number;
  readonly folded: boolean;
}

/** Minutes after midnight to px down the track, and back. */
export interface MobileScale {
  readonly segments: readonly MobileSegment[];
  readonly total: number;
  readonly pos: (minute: number) => number;
  readonly folded: (minute: number) => boolean;
}

/**
 * Where each minute of the axis is drawn down the phone's track: `k` px a
 * minute, with every stretch in `folds` drawn {@link MOBILE_FOLD_PX} tall
 * when folding it saves room. The same shape as the desktop's `buildScale`,
 * which fits a width; this one has a pace, as the design's does.
 */
export function mobileScale(
  from: number,
  to: number,
  k: number,
  folds: readonly Span[] = [],
): MobileScale {
  const a = from * 60;
  const b = to * 60;
  const sorted = [...folds]
    .map((f) => ({ start: Math.max(a, f.start), end: Math.min(b, f.end) }))
    .filter((f) => f.end > f.start && (f.end - f.start) * k > WORTH_FOLDING_PX)
    .sort((x, y) => x.start - y.start);
  const segments: MobileSegment[] = [];
  let cursor = a;
  let p = 0;
  const push = (t0: number, t1: number, folded: boolean): void => {
    const len = folded ? MOBILE_FOLD_PX : (t1 - t0) * k;
    segments.push({ t0, t1, p0: p, p1: p + len, folded });
    p += len;
  };
  for (const f of sorted) {
    if (f.start > cursor) push(cursor, f.start, false);
    push(f.start, f.end, true);
    cursor = f.end;
  }
  if (cursor < b) push(cursor, b, false);
  const total = p;
  const pos = (minute: number): number => {
    if (minute <= a) return 0;
    for (const s of segments) {
      if (minute <= s.t1) return s.p0 + ((minute - s.t0) / (s.t1 - s.t0)) * (s.p1 - s.p0);
    }
    return total;
  };
  const folded = (minute: number): boolean =>
    segments.some((s) => s.folded && minute > s.t0 && minute < s.t1);
  return { segments, total, pos, folded };
}

/**
 * The lines a block has room for, by its height as drawn (the design's
 * `mk`): the first line always; the range from 44px; the title from 64px.
 */
export function mobileBlockLines(height: number): { range: boolean; title: boolean } {
  return { range: height >= 44, title: height >= 64 };
}

/** The idle stretches the phone's Fit folds, and what each is called. */
export interface MobileFold extends Span {
  readonly label: 'No activity' | 'Later today';
}

/**
 * The folds the design draws words on: before the first thing placed
 * (*No activity*) and, on today, after now (*Later today*). The desktop's
 * `idleEnds` finds the stretches; this names them.
 */
export function mobileFolds(line: Pick<DayLine, 'now'>, idle: readonly Span[]): MobileFold[] {
  return idle.map((span) => ({
    ...span,
    label: line.now !== undefined && span.start >= line.now - 1 ? 'Later today' : 'No activity',
  }));
}

/** An hour's label stands this far below the last one shown, or is left out. */
const LABEL_ROOM_PX = 20;
/** No hour label within this of the now pill, which sits in the same column. */
const NOW_ROOM_PX = 16;

/**
 * Which hour labels are drawn (the design's `ticks`): each one at least
 * {@link LABEL_ROOM_PX} below the last one drawn, and none beside the now
 * pill. `ys` are the hours' tops down the track, in order.
 */
export function hourLabelsShown(ys: readonly number[], nowY: number | undefined): boolean[] {
  let last = -Infinity;
  return ys.map((y) => {
    const show =
      y - last >= LABEL_ROOM_PX && (nowY === undefined || Math.abs(y - nowY) > NOW_ROOM_PX);
    if (show) last = y;
    return show;
  });
}

/** One signal as drawn in its five minutes of the SIG column, px from the slot's top. */
export interface SignalBox {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A signal's mark in the SIG column (the design's `sig`): prompts a bar at
 * the column's left, longer the more there were, up to 10px; commits a dot
 * beside it. Both as tall as the five minutes allow, centred in them.
 */
export function signalMark(kind: 'prompt' | 'commit', count: number, slot: number): SignalBox {
  if (kind === 'prompt') {
    const height = Math.max(2, Math.min(5, slot - 2));
    return { top: (slot - height) / 2, left: 1, width: Math.min(10, 2 + count * 2), height };
  }
  const size = Math.max(3, Math.min(7, slot - 2));
  return { top: (slot - size) / 2, left: 12 + (12 - size) / 2, width: size, height: size };
}

/** The lines an agent's bar has room for (the design's `ag`): who from 18px, how long from 32, the card from 46. */
export function agentLines(height: number): {
  readonly name: boolean;
  readonly time: boolean;
  readonly card: boolean;
} {
  return { name: height >= 18, time: height >= 32, card: height >= 46 };
}
