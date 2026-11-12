/**
 * The board's `⋯` menu (LAI-1198). View settings, Insights, Refresh and
 * Hidden columns were icons in the toolbar row; they are labelled items in
 * this menu now, so a test reaches them the way a person does.
 */

import type { Page } from 'playwright';

/** Open the board's `⋯` and choose the item with this label. */
export async function boardAction(page: Page, label: string | RegExp): Promise<void> {
  await page.locator('.board-bar [data-board-more]').click();
  await page.locator('.bt-menu').waitFor({ timeout: 5_000 });
  await page.getByRole('menuitem', { name: label }).click();
}
