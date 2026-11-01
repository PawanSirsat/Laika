/**
 * The lists' groups (the owner's design, D-110 item 6, LAI-505): a block by
 * the part of the day it started in — morning before noon, afternoon before
 * five, evening after — and the blocks with no set time last, under their
 * own name. Each group says how many and how long.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'untimed';

export interface DayGroup<T> {
  readonly key: DayPart;
  readonly name: string;
  readonly items: readonly T[];
  readonly minutes: number;
}

const NAMES: Readonly<Record<DayPart, string>> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  untimed: 'No set time',
};

const ORDER: readonly DayPart[] = ['morning', 'afternoon', 'evening', 'untimed'];

/** The hour of `ms` on the wall clock of `tz`, 0–23. */
function hourIn(tz: string, ms: number): number {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date(ms));
  const hour = Number.parseInt(text, 10);
  return Number.isNaN(hour) ? 0 : hour;
}

/** Which part of the day a block started in; none for a block with no span. */
export function partOf(block: {
  readonly started_at: number | null;
  readonly tz: string;
}): DayPart {
  if (block.started_at === null) return 'untimed';
  const hour = hourIn(block.tz, block.started_at);
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

/** The blocks in their groups, in the day's order, empty groups left out. */
export function groupByPart<
  T extends { readonly started_at: number | null; readonly tz: string; readonly minutes: number },
>(items: readonly T[]): readonly DayGroup<T>[] {
  const buckets = new Map<DayPart, T[]>();
  for (const item of items) {
    const key = partOf(item);
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [item]);
    else list.push(item);
  }
  return ORDER.flatMap((key) => {
    const list = buckets.get(key);
    if (list === undefined || list.length === 0) return [];
    return [
      {
        key,
        name: NAMES[key],
        items: list,
        minutes: list.reduce((n, item) => n + item.minutes, 0),
      },
    ];
  });
}
