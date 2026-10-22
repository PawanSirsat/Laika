/**
 * The clock every My day browser test runs on (LAI-954).
 *
 * My day draws *today* around the browser's own `Date.now()`: the now line,
 * the axis hours it hides beside its pill, how far the Timeline scrolls to
 * bring now into view, and which gaps have happened yet. On the real clock
 * those tests passed or failed by the hour they ran — the `1 PM` tick was
 * missing at 18:21 IST, *now* landed at the right edge late in the day — so
 * every page here is pinned to {@link NOW}, in UTC, the zone the fixtures
 * are written in.
 *
 * The **day** is still today, computed at run time (CONVENTIONS: a fixture may
 * not be pinned to the calendar); only the hour within it is fixed. Timers
 * still run; `Date.now()` stands still.
 */

import type { Page } from 'playwright';
import { open as openPage } from './harness.ts';

/** Today in UTC, as the fixtures and the page both count it. */
export const TODAY = new Date().toISOString().slice(0, 10);

/**
 * 15:00 UTC today: clear of every hour a test names by label (8 AM, 9 AM,
 * 12 PM, 1 PM), which the now pill would hide, and early enough that the
 * Timeline has room to scroll now three fifths of the way across. Chosen by
 * running every My day test against it, not derived.
 */
export const NOW = Date.parse(`${TODAY}T15:00:00Z`);

/** Pin `page` to {@link NOW} in UTC, before it boots. */
export async function pinToday(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
}

/** {@link openPage}, with the page pinned to {@link NOW} before its own `before`. */
export const open: typeof openPage = (path, stub, options = {}) =>
  openPage(path, stub, {
    ...options,
    before: async (page) => {
      await pinToday(page);
      await options.before?.(page);
    },
  });
