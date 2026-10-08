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
  if ((await combobox.getAttribute('aria-expanded')) !== 'true') {
    // Focused first: some controls are clipped until focused (the card's
    // keyboard-only move, a column's position) and a click needs them drawn.
    await combobox.focus();
    await combobox.click();
  }
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

/**
 * What a `Dropdown` offers, read from its open panel and closed again: the
 * labels in order, and how many are greyed (`aria-disabled`) — the custom
 * control's `option` and `option[disabled]`.
 */
export async function optionsOf(
  combobox: Locator,
): Promise<{ readonly labels: string[]; readonly disabled: number }> {
  const page = combobox.page();
  await combobox.focus();
  await combobox.click();
  const listId = await combobox.getAttribute('aria-controls');
  if (listId === null) throw new Error('the dropdown did not open');
  const options = page.locator(`[id="${listId}"] [role="option"]`);
  const labels = (await options.locator('.dd-label').allInnerTexts()).map((l) => l.trim());
  const disabled = await page
    .locator(`[id="${listId}"] [role="option"][aria-disabled="true"]`)
    .count();
  await page.keyboard.press('Escape');
  return { labels, disabled };
}

/** The labels a `Dropdown` offers, in order, opening and closing it. */
export async function offered(combobox: Locator): Promise<string[]> {
  return (await optionsOf(combobox)).labels;
}
