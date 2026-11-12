import type { Locator } from 'playwright';

/**
 * People's row actions sit in one ⋯ menu per row (LAI-1210). A gate is
 * readable without opening it — `data-row-actions` names what the menu holds —
 * and an action is chosen the way a person chooses it: open the menu, pick the
 * item by its name.
 */

/** A row whose menu offers Deactivate. */
export const DEACTIVATES = '[data-row-actions~="deactivate"]';
/** A row whose menu offers Tokens. */
export const OPENS_TOKENS = '[data-row-actions~="tokens"]';

/** Open `row`'s ⋯ menu and choose the item called `name`. */
export async function rowAction(row: Locator, name: string): Promise<void> {
  await row.locator('.overflow-menu-button').click();
  await row.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
}
