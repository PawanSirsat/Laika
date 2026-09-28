/**
 * Every URL key that narrows which tasks the board and the List show.
 *
 * **One list, read wherever "the filters" are meant** (LAI-485, LAI-487). The
 * List's page resets when any of these change, because a page number from a
 * different set of rows points at arbitrary work. Two hand-written lists of
 * "the filter keys" is how *Clear all* came to miss `sprint`.
 *
 * Not here on purpose: `project`, `task`, `group`, `view`, and the List's own
 * `sort`, `dir` and `page` — none of them changes *which* tasks match.
 */
export const FILTER_KEYS = [
  'q',
  'priority',
  'assignee',
  'tag',
  'ready',
  'agent',
  'sprint',
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/** The filters in a URL as one comparable string, in a fixed order. */
export function filterSignature(params: URLSearchParams): string {
  return FILTER_KEYS.map((key) => `${key}=${params.get(key) ?? ''}`).join('&');
}
