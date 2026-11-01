import {
  ENTRY_KINDS,
  type EntryKind,
  type MyDay,
  type TimeDraft,
  type TimeEntry,
} from '../../../api/time.ts';
import { kindChartLabel } from './entry-kinds.ts';

/**
 * A slice of the day: its kind. A block with none is *Building*, as the
 * owner's My Day design counts it (`kindColors`, LAI-510): the design has no
 * General slice — what no task holds shows under By task as *No task yet*.
 */
export type SplitKey = EntryKind;

export interface SplitSegment {
  readonly key: SplitKey;
  readonly label: string;
  readonly minutes: number;
  /** Of the day's total, 0–100, rounded. */
  readonly pct: number;
}

/** What a block is for the split: its kind, else Building's — a draft has none yet. */
export function splitKeyOf(block: TimeEntry | TimeDraft): SplitKey {
  return ('kind' in block ? block.kind : null) ?? 'work';
}

/** The slice's word, the design's: *Building*, *Meetings*, then each kind's own. */
export function splitLabel(key: SplitKey): string {
  return kindChartLabel(key);
}

/**
 * Where the day went (D-110 item 2, LAI-503): the confirmed entries and the
 * drafts about to be, by kind, in the design's order of kinds (LAI-510) —
 * the bars of the summary and of Overview. A day with nothing yields no
 * segment, never a 100% of nothing.
 */
export function daySplit(
  entries: readonly TimeEntry[],
  drafts: readonly TimeDraft[],
): readonly SplitSegment[] {
  const minutes = new Map<SplitKey, number>();
  for (const block of [...entries, ...drafts]) {
    const key = splitKeyOf(block);
    minutes.set(key, (minutes.get(key) ?? 0) + block.minutes);
  }
  const total = [...minutes.values()].reduce((n, m) => n + m, 0);
  if (total === 0) return [];
  return ENTRY_KINDS.filter((key) => (minutes.get(key) ?? 0) > 0).map((key) => {
    const m = minutes.get(key) ?? 0;
    return { key, label: splitLabel(key), minutes: m, pct: Math.round((m / total) * 100) };
  });
}

/** The entries Laika could not see — typed, or run on a timer — in the order they happened. */
export function offScreen(entries: readonly TimeEntry[]): readonly TimeEntry[] {
  return entries.filter((e) => e.source === 'manual');
}

/** The day's note, if any, as the summary's field starts. */
export function noteOf(view: Pick<MyDay, 'day_note'>): string {
  return view.day_note?.note ?? '';
}

/** The day's weekday, as the summary's title says it: *Confirm Thursday* (LAI-517). */
export function weekdayOf(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
  });
}
