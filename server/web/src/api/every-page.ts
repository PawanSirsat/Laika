import type { Page } from './tasks.ts';

/**
 * Read a paged list to the end (LAI-702, LAI-703).
 *
 * Every list endpoint pages — 50 by default, 200 at most (§6.3) — and a screen
 * that keeps `page.data` and ignores `next_cursor` shows **part of a list as if
 * it were the whole of it**, with nothing on screen to say so. That is how the
 * sprint strip read Onroute's S3 as 7/42 while it held 157. This follows the
 * cursor until the server says there is no more.
 *
 * **A cap, reported, never a silent stop.** `cap` pages is a runaway guard, not
 * a size anyone expects to reach (25 × 200 = 5,000 tasks). Hitting it sets
 * `truncated`, so the caller can say its numbers are a floor — the rule
 * `use-board` already keeps (LAI-621): a truncated list must never look like
 * a whole one.
 */
export const EVERY_PAGE_CAP = 25;

export interface EveryPage<T> {
  readonly items: readonly T[];
  /** True when `cap` pages were read and the server still had more. */
  readonly truncated: boolean;
}

export async function everyPage<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  cap: number = EVERY_PAGE_CAP,
): Promise<EveryPage<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < cap; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.data);
    if (result.next_cursor === null) return { items, truncated: false };
    cursor = result.next_cursor;
  }
  return { items, truncated: true };
}
