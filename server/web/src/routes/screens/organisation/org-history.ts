import type { HistoryQuery } from '../../../api/activity.ts';

/**
 * Organisation → Activity's filters (LAI-951), kept in the address beside
 * `?tab=activity` so a filtered history is a link someone can paste.
 *
 * `from` and `to` are `YYYY-MM-DD`, what `<input type="date">` speaks, and are
 * **whole days in the reader's own time**: someone asking for *1 October* means
 * their 1 October, and the rows beside the filter print local times too.
 */

export const HISTORY_FILTERS = ['actor', 'project', 'type', 'from', 'to'] as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export type HistoryFilters = Partial<Record<HistoryFilter, string>>;

/** Midnight at the start of `value`'s day, local, or `undefined` for no such day. */
export function localDayStart(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  // `new Date(2026, 1, 30)` is 2 March: a day that does not exist rolls over.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return undefined;
  }
  return date.getTime();
}

/** The last millisecond of `value`'s day, local — `until` is inclusive. */
export function localDayEnd(value: string): number | undefined {
  const start = localDayStart(value);
  if (start === undefined) return undefined;
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return next.getTime() - 1;
}

/**
 * The filters an address names. Empty is none, and a date that is not a day is
 * none too — the server would answer it `400`, and a mistyped link should open
 * the history rather than an error.
 */
export function filtersFrom(params: URLSearchParams): HistoryFilters {
  const filters: HistoryFilters = {};
  for (const name of HISTORY_FILTERS) {
    const value = params.get(name);
    if (value === null || value === '') continue;
    if ((name === 'from' || name === 'to') && localDayStart(value) === undefined) continue;
    filters[name] = value;
  }
  return filters;
}

/** The address with one filter set, or removed when `value` is empty. */
export function withFilter(
  params: URLSearchParams,
  name: HistoryFilter,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === '') next.delete(name);
  else next.set(name, value);
  return next;
}

/** What `GET /activity/history` is asked for these filters. */
export function historyQuery(filters: HistoryFilters): HistoryQuery {
  const since = filters.from === undefined ? undefined : localDayStart(filters.from);
  const until = filters.to === undefined ? undefined : localDayEnd(filters.to);
  return {
    ...(filters.actor === undefined ? {} : { actor: filters.actor }),
    ...(filters.project === undefined ? {} : { project: filters.project }),
    ...(filters.type === undefined ? {} : { type: filters.type }),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
  };
}

/** The address with every history filter removed; other params are kept. */
export function withoutFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of HISTORY_FILTERS) next.delete(name);
  return next;
}

export interface DayGroup<T> {
  /** `2026-11-12`, the reader's own calendar day. */
  readonly key: string;
  /** `Today`, `Yesterday`, `Mon 10 Nov`, or `Mon 10 Nov 2025` in another year. */
  readonly label: string;
  readonly rows: readonly T[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const dayKey = (d: Date): string =>
  `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Rows grouped under the day they happened on (LAI-1210), in the order given —
 * the history is newest first, so the groups are too. A day appears once even
 * if a later page adds more of its rows, because grouping runs over every row
 * loaded so far.
 */
export function dayGroups<T extends { readonly created_at: number }>(
  rows: readonly T[],
  now: number,
): readonly DayGroup<T>[] {
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const groups: { key: string; label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const when = new Date(row.created_at);
    const key = dayKey(when);
    let group = groups.find((g) => g.key === key);
    if (group === undefined) {
      const label =
        key === dayKey(today)
          ? 'Today'
          : key === dayKey(yesterday)
            ? 'Yesterday'
            : `${WEEKDAYS[when.getDay()] ?? ''} ${String(when.getDate())} ${MONTH_NAMES[when.getMonth()] ?? ''}${
                when.getFullYear() === today.getFullYear() ? '' : ` ${String(when.getFullYear())}`
              }`;
      group = { key, label, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}
