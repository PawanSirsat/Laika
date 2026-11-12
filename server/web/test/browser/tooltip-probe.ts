/**
 * Reading the shared Tooltip from a browser test (LAI-1213).
 *
 * The bare `title=` this area used to carry could be read with
 * `getAttribute('title')`; the Tooltip that replaced it is an element of its
 * own, linked by `aria-describedby`, and — for the many small markers on a
 * card or a row — rendered only once the control is first reached (`lazy`).
 * These helpers reach it the way a pointer does, then read the words.
 */

import type { Locator, Page } from 'playwright';

/**
 * The tooltip that describes `control`: the one id in its `aria-describedby`
 * whose element is `role="tooltip"`. A `pointerenter` is sent first, so a
 * lazy tooltip has been rendered; it does not wait for the show delay.
 */
export async function tooltipOf(control: Locator): Promise<Locator> {
  await control.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  const page = control.page();
  for (let tries = 0; tries < 20; tries++) {
    const ids = ((await control.getAttribute('aria-describedby')) ?? '')
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) {
      const el = page.locator(`[id="${id}"]`);
      if ((await el.count()) === 1 && (await el.getAttribute('role')) === 'tooltip') return el;
    }
    await page.waitForTimeout(25);
  }
  throw new Error(`no tooltip describes ${await control.evaluate((el) => el.outerHTML)}`);
}

/** The words of the tooltip describing `control` — what `title` used to hold. */
export async function tipText(control: Locator): Promise<string> {
  const tip = await tooltipOf(control);
  const words = (await tip.textContent()) ?? '';
  await control.dispatchEvent('pointerleave', { pointerType: 'mouse' });
  return words;
}

/**
 * {@link tipText} for every element a locator matches, in order, read from
 * the DOM (LAI-1214) — a list's worth of rules in one pass. For tooltips that
 * are not `lazy`: an unreached lazy one has no description yet and reads `''`,
 * as does an element with none, so a missing one shows in the list.
 */
export async function tipTexts(controls: Locator): Promise<string[]> {
  return controls.evaluateAll((els) =>
    els.map((el) => {
      for (const id of (el.getAttribute('aria-describedby') ?? '').split(/\s+/)) {
        const tip = id === '' ? null : document.getElementById(id);
        if (tip?.getAttribute('role') !== 'tooltip') continue;
        return (tip.querySelector('.tip-words') ?? tip).textContent ?? '';
      }
      return '';
    }),
  );
}

/** The server's policy with `style-src-attr` tightened to `'none'` (as dialog-tooltips.test.ts). */
export const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/** Serve every document under {@link STRICT_CSP} and record each violation on `window`. */
export async function strictCsp(p: Page): Promise<void> {
  await p.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(
        `${event.violatedDirective} ${event.sourceFile}:${String(event.lineNumber)} ${event.sample}`,
      );
    });
  });
  await p.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': STRICT_CSP },
    });
  });
}

/** The violations recorded since the page loaded. */
export function cspViolations(p: Page): Promise<string[]> {
  return p.evaluate(() => window.__cspViolations ?? []);
}
