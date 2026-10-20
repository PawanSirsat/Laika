import type { MyDay } from '../../../api/time.ts';
import { atClock, draftTarget, entryTarget, hm } from './my-day-derive.ts';

/**
 * My day's timeline bar (LAI-796, the owner's reference): the day's
 * confirmed and drafted blocks laid along the hours, with a line at now.
 *
 * **Only what has a time is drawn.** A block added by its length alone — a
 * meeting typed as `0:30` — has no place on the bar, so it is counted and
 * said beneath it instead of being put somewhere invented. Every clock is the
 * reader's own zone, as the rest of the page is (`view.tz`).
 */

export interface TimelineBlock {
  readonly kind: 'confirmed' | 'drafted';
  readonly id: string;
  /** Minutes after the day's midnight. */
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

export interface DayTimeline {
  /** The first and last hour on the bar. */
  readonly from: number;
  readonly to: number;
  readonly blocks: readonly TimelineBlock[];
  /** Minutes after midnight, on today only. */
  readonly now: number | undefined;
  /** Blocks with no set time, which the bar cannot place. */
  readonly untimed: number;
}

/** The working day the bar shows when nothing falls outside it. */
const FROM = 8;
const TO = 18;
const DAY_MINUTES = 24 * 60;

const clamp = (n: number): number => Math.min(DAY_MINUTES, Math.max(0, n));

export function dayTimeline(
  view: Pick<MyDay, 'day' | 'tz' | 'today' | 'drafts' | 'entries'>,
  nowMs: number,
): DayTimeline {
  const midnight = atClock(view.day, '00:00', view.tz);
  const minutes = (ms: number): number =>
    midnight === undefined ? 0 : clamp(Math.round((ms - midnight) / 60_000));

  const blocks: TimelineBlock[] = [];
  let untimed = 0;
  const place = (
    kind: TimelineBlock['kind'],
    item: { id: string; started_at: number | null; ended_at: number | null; minutes: number },
    target: string,
  ): void => {
    if (item.started_at === null || item.ended_at === null) {
      untimed += 1;
      return;
    }
    const start = minutes(item.started_at);
    const end = minutes(item.ended_at);
    if (end <= start) {
      untimed += 1;
      return;
    }
    blocks.push({ kind, id: item.id, start, end, label: `${target} · ${hm(item.minutes)}` });
  };

  for (const entry of view.entries) place('confirmed', entry, entryTarget(entry));
  for (const draft of view.drafts) place('drafted', draft, draftTarget(draft).label);
  blocks.sort((a, b) => a.start - b.start);

  const now = view.day === view.today ? minutes(nowMs) : undefined;
  const starts = blocks.map((b) => b.start);
  const ends = blocks.map((b) => b.end);
  if (now !== undefined) {
    starts.push(now);
    ends.push(now);
  }
  const from = Math.min(FROM, ...starts.map((m) => Math.floor(m / 60)));
  const to = Math.max(TO, ...ends.map((m) => Math.ceil(m / 60)));

  return { from, to: Math.min(24, Math.max(to, from + 1)), blocks, now, untimed };
}

/** The hour labels under the bar: every other hour, on the even ones. */
export function hourTicks(from: number, to: number): readonly number[] {
  const ticks: number[] = [];
  for (let hour = from % 2 === 0 ? from : from + 1; hour <= to; hour += 2) ticks.push(hour);
  return ticks;
}
