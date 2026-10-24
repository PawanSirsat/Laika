import type { EntryKind, MyDay, TimeDraft, TimeEntry } from '../../../api/time.ts';
import { KINDS } from './entry-kinds.ts';

/** A slice of the day: a kind, or the two a block has without one. */
export type SplitKey = EntryKind | 'building' | 'general';

export interface SplitSegment {
  readonly key: SplitKey;
  readonly label: string;
  readonly minutes: number;
  /** Of the day's total, 0–100, rounded. */
  readonly pct: number;
}

const SPLIT_LABELS: Readonly<Record<'building' | 'general', string>> = {
  building: 'Building',
  general: 'General',
};

/** What a block is for the split: its kind; else Building on a card, General on none. */
export function splitKeyOf(block: {
  readonly kind?: EntryKind | null | undefined;
  readonly task: { readonly key: string } | null;
  readonly project?: { readonly slug: string } | null | undefined;
}): SplitKey {
  if (block.kind !== undefined && block.kind !== null) return block.kind;
  return block.task !== null || (block.project !== undefined && block.project !== null)
    ? 'building'
    : 'general';
}

export function splitLabel(key: SplitKey): string {
  if (key === 'building' || key === 'general') return SPLIT_LABELS[key];
  return KINDS.find((k) => k.kind === key)?.label ?? key;
}

/**
 * Where the day went (D-110 item 2, LAI-503): the confirmed entries and the
 * drafts about to be, by kind, largest first — the bars of the summary. A
 * day with nothing yields no segment, never a 100% of nothing.
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
  return [...minutes.entries()]
    .sort((a, b) => b[1] - a[1] || splitLabel(a[0]).localeCompare(splitLabel(b[0])))
    .map(([key, m]) => ({
      key,
      label: splitLabel(key),
      minutes: m,
      pct: Math.round((m / total) * 100),
    }));
}

/** The entries Laika could not see — typed, or run on a timer — in the order they happened. */
export function offScreen(entries: readonly TimeEntry[]): readonly TimeEntry[] {
  return entries.filter((e) => e.source === 'manual');
}

/** The day's note, if any, as the summary's field starts. */
export function noteOf(view: Pick<MyDay, 'day_note'>): string {
  return view.day_note?.note ?? '';
}
