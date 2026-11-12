import type { Locator } from 'playwright';

/**
 * The words of the shared Tooltip a control is described by (LAI-1214) —
 * what a bare `title=` used to carry. Read from the DOM, so it does not need
 * the tooltip to be showing; the keycap is left out (`.tip-kbd`), the words
 * only. Throws when the control has no tooltip at all, so a test that reads
 * it cannot pass on a missing one.
 */
export async function tooltipText(control: Locator): Promise<string> {
  const ids = ((await control.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const el = control.page().locator(`[id="${id}"]`);
    if ((await el.getAttribute('role')) !== 'tooltip') continue;
    return el.evaluate((node) => {
      const words = node.querySelector('.tip-words');
      return (words ?? node).textContent ?? '';
    });
  }
  throw new Error(`no tooltip describes ${String(control)}`);
}
