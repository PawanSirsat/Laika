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

/**
 * Wait until the confirmation has finished rising in (LAI-531). The card
 * scales up from 98% over 160ms, so a box read during it is one frame of the
 * animation — and two boxes read one after the other can be two frames, a
 * button about 7px apart on a phone. CI's runner was slow enough to land
 * there; a test that measures the dialog measures it settled.
 */
export async function confirmSettled(page: Page): Promise<void> {
  await page.locator('[data-confirm-dialog]').waitFor({ timeout: 10_000 });
  await page.waitForFunction(() =>
    (document.querySelector('[data-confirm-layer]')?.getAnimations({ subtree: true }) ?? []).every(
      (a) => a.playState === 'finished',
    ),
  );
}
