/**
 * The board's toolbar actions. LAI-1198 folded View settings, Insights,
 * Refresh and Hidden columns into a `⋯` menu; LAI-1230 put them back as
 * buttons of their own, so a test reaches each by its accessible name, the
 * way a person (or a screen reader) does.
 */

import type { Page } from 'playwright';

/** Press the board toolbar's action button with this accessible name. */
export async function boardAction(page: Page, label: string | RegExp): Promise<void> {
  const button = page.locator('.board-bar .bt-actions').getByRole('button', { name: label });
  await button.waitFor({ timeout: 10_000 });
  await button.click();
}
