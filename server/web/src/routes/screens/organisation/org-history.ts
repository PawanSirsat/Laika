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
