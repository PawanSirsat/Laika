import type { Page } from 'playwright';

/**
 * The app's confirmation (LAI-522), answered as a person does: wait for it,
 * read what it says, and press Cancel or the action. It is a page element,
 * never the browser's `window.confirm` — so a test that still waits for a
 * native `dialog` event waits for nothing.
 */
export async function answerConfirm(page: Page, yes: boolean): Promise<string> {
  const dialog = page.locator('[data-confirm-dialog]');
  await dialog.waitFor({ timeout: 10_000 });
  const said = (await dialog.innerText()).replace(/\s+/g, ' ').trim();
  await dialog.locator(yes ? '[data-confirm-ok] button' : '[data-confirm-cancel] button').click();
  await dialog.waitFor({ state: 'detached', timeout: 5_000 });
  return said;
}
