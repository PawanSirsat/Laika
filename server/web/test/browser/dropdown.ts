import type { Locator } from 'playwright';

/**
 * Drive a `Dropdown` the way a person does (LAI-726): open it, click the
 * option. The replacement for Playwright's `selectOption`, which only drives
 * a native `<select>` and fails on the custom control.
 *
 * By **value** — the thing the URL or the request carries — so a test reads
 * the same as it did against the `<select>`.
 */
export async function pick(combobox: Locator, value: string): Promise<void> {
  const page = combobox.page();
  if ((await combobox.getAttribute('aria-expanded')) !== 'true') await combobox.click();
  const listId = await combobox.getAttribute('aria-controls');
  if (listId === null)
    throw new Error('the dropdown did not open: its trigger has no aria-controls');
  const option = page
    .locator(`[id="${listId}"]`)
    .locator(`[role="option"][data-value="${value.replace(/"/g, '\\"')}"]`);
  if ((await option.count()) !== 1) {
    const offered = await page
      .locator(`[id="${listId}"] [role="option"]`)
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-value')));
    throw new Error(`no option "${value}" in the dropdown; it offers ${JSON.stringify(offered)}`);
  }
  await option.click();
  await page.waitForFunction((id: string) => document.getElementById(id) === null, listId, {
    timeout: 5_000,
  });
}

/** The value a `Dropdown` holds — the custom control's `inputValue()`. */
export async function valueOf(combobox: Locator): Promise<string | null> {
  return combobox.getAttribute('data-value');
}

/** The labels a `Dropdown` offers, in order, opening and closing it. */
export async function offered(combobox: Locator): Promise<string[]> {
  const page = combobox.page();
  await combobox.click();
  const listId = await combobox.getAttribute('aria-controls');
  if (listId === null) throw new Error('the dropdown did not open');
  const labels = await page.locator(`[id="${listId}"] [role="option"] .dd-label`).allInnerTexts();
  await page.keyboard.press('Escape');
  return labels.map((l) => l.trim());
}
