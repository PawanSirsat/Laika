import { offKind, offOwes, type OffKind } from '../../../api/off-days.ts';
import type { DaysDay } from '../../../api/time.ts';
import { stackOf, type LaneBlock } from './timeline-derive.ts';

/**
 * What Week, Month and Year draw (LAI-1174), kept out of the components so
 * it is tested without a browser.
 *
 * ## No target, no score
 *
 * The design measured every bar against 8 hours and coloured the year by it.
 * My day does not (week-derive's rule, CHIEF's addition E): a bar is a share
 * of the **busiest day in the period**, the year's heat is the day's place
 * among the period's own working days, and a day nothing reached is *no
 * signal* — `—`, never an empty bar that reads as zero hours.
 *
 * ## A day off is not no signal (D-149, LAI-1184)
 *
 * A day a holiday covers, or approved whole-day leave, owes nothing: with no
 * time on it, it is *off* — drawn in its own tone, never `—`. A day off with
 * time keeps its figure and carries a mark. Pending leave changes nothing it
 * owes, so it is only ever an outline.
 */

/** A share as a CSS percentage, held to 0–100 %. */
export const pct = (share: number): string => `${String(Math.max(0, Math.min(1, share)) * 100)}%`;

/** A day's total: confirmed and drafted, as the day view's figure. */
export const totalOf = (d: Pick<DaysDay, 'confirmed_minutes' | 'drafted_minutes'>): number =>
  d.confirmed_minutes + d.drafted_minutes;

/** The busiest day's total in a set, at least one minute so a share never divides by 0. */
export function busiest(
  days: readonly Pick<DaysDay, 'confirmed_minutes' | 'drafted_minutes'>[],
): number {
  return Math.max(1, ...days.map(totalOf));
}

/** A day's bar: its confirmed and drafted parts, each a share of the busiest day. */
export function barOf(
  d: Pick<DaysDay, 'confirmed_minutes' | 'drafted_minutes'>,
  top: number,
): { confirmed: number; drafted: number } {
  return { confirmed: d.confirmed_minutes / top, drafted: d.drafted_minutes / top };
}

/** 0 is a day with nothing; 1–4 its quartile among the period's days that hold time. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Heat by quartile of the period's own non-zero days: the busiest quarter is
 * 4 whatever the hours, so a part-time year is as readable as a full one.
 */
export function heatScale(totals: readonly number[]): (minutes: number) => HeatLevel {
  const sorted = totals.filter((m) => m > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0;
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const q1 = at(0.25);
  const q2 = at(0.5);
  const q3 = at(0.75);
  return (minutes) => {
    if (minutes <= 0) return 0;
    if (minutes < q1) return 1;
    if (minutes < q2) return 2;
    if (minutes < q3) return 3;
    return 4;
  };
}

/** What a day cell says about its time: a figure, a day off, *no signal* or nothing yet. */
export type CellKind = 'time' | 'off' | 'no_signal' | 'future';

/** A day's state and, when served, its day off — a row from a fixture may lack it. */
type Cell = Pick<DaysDay, 'state'> & Partial<Pick<DaysDay, 'off'>>;

/**
 * Time wins: a day with any is `time`. Without, a day that owes nothing — a
 * holiday, approved whole-day leave — is `off`, past or to come; otherwise
 * *no signal* or *future*, as the server said.
 */
export function cellKind(d: Cell): CellKind {
  if (d.state === 'confirmed' || d.state === 'drafted') return 'time';
  if (d.off !== undefined && d.off !== null && offOwes(d.off) === 'nothing') return 'off';
  if (d.state === 'future') return 'future';
  return 'no_signal';
}

/**
 * How a day's tile carries its day off, when it has one:
 *
 *  - `tint` — an `off` day: filled in the tone, edged in its border;
 *  - `dot` — a day with time: its heat, and a corner dot in the tone;
 *  - `half` — approved half-day leave with no time: half filled;
 *  - `dash` — pending leave: a dashed outline only, never the fill.
 */
export type OffMark = 'tint' | 'dot' | 'half' | 'dash';

export function offMark(d: Cell): OffMark | null {
  const tone: OffKind | null = offKind(d.off);
  if (tone === null) return null;
  if (tone === 'requested') return 'dash';
  const kind = cellKind(d);
  if (kind === 'time') return 'dot';
  if (kind === 'off') return 'tint';
  return 'half';
}

/** The tones a set of days holds, in the legend's order: what its key names. */
export function offTones(days: readonly Partial<Pick<DaysDay, 'off'>>[]): OffKind[] {
  const held = new Set(days.map((d) => offKind(d.off)));
  return (['holiday', 'leave', 'requested'] as const).filter((t) => held.has(t));
}

/** A period's figure: total and what is still to review, or *no signal* / *not started*. */
export function periodFigure(
  days: readonly Pick<DaysDay, 'state' | 'confirmed_minutes' | 'drafted_minutes'>[],
): {
  total: number;
  drafted: number;
  confirmed: number;
  kind: 'time' | 'no_signal' | 'future';
} {
  const total = days.reduce((n, d) => n + totalOf(d), 0);
  const drafted = days.reduce((n, d) => n + d.drafted_minutes, 0);
  const confirmed = days.reduce((n, d) => n + d.confirmed_minutes, 0);
  if (total > 0) return { total, drafted, confirmed, kind: 'time' };
  return {
    total,
    drafted,
    confirmed,
    kind: days.every((d) => d.state === 'future') ? 'future' : 'no_signal',
  };
}

// ------------------------------------------------------------------ the week

/** The hours a week's grid shows: fitted to its blocks, never clamped below them. */
export function weekHours(
  blocks: readonly Pick<LaneBlock, 'start' | 'end'>[],
  fallback: { from: number; to: number } = { from: 8, to: 18 },
): { from: number; to: number } {
  if (blocks.length === 0) return fallback;
  const first = Math.min(...blocks.map((b) => b.start));
  const last = Math.max(...blocks.map((b) => b.end));
  const from = Math.max(0, Math.floor(first / 60));
  const to = Math.min(24, Math.max(from + 1, Math.ceil(last / 60)));
  return { from, to };
}

/** A block in a week column: top and height as shares of the grid, and its lane. */
export interface WeekBox {
  readonly id: string;
  readonly top: number;
  readonly height: number;
  /** Side by side when two happen at once (LAI-528): lane `row` of `rows`. */
  readonly row: number;
  readonly rows: number;
}

export function weekBoxes(
  blocks: readonly Pick<LaneBlock, 'id' | 'start' | 'end'>[],
  hours: { from: number; to: number },
): WeekBox[] {
  const from = hours.from * 60;
  const span = Math.max(60, hours.to * 60 - from);
  const stacks = stackOf(blocks);
  return blocks.map((b, i) => ({
    id: b.id,
    top: (b.start - from) / span,
    height: Math.max(0, b.end - b.start) / span,
    row: stacks[i]?.row ?? 0,
    rows: stacks[i]?.rows ?? 1,
  }));
}

/** How much a box has room to say, by its length: the design's 25 / 55 / 85-minute steps. */
export function boxDetail(minutes: number): 'none' | 'key' | 'length' | 'title' {
  if (minutes >= 85) return 'title';
  if (minutes >= 55) return 'length';
  if (minutes >= 25) return 'key';
  return 'none';
}
