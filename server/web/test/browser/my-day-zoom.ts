/**
 * The Timeline's scale, set the way a reader sets it (D-113, LAI-300): Fit by
 * the *Fit day* button, a multiple by the *Time zoom* slider. The slider's
 * units are a hundredth of a doubling, so 1× is 0 and 2× is 100 exactly.
 *
 * Replaces the *Fit · 1× · 2×* presets the browser tests clicked before
 * D-113 took them away.
 */

import type { Page } from 'playwright';
import { until } from './harness.ts';

/** The level the slider reports: `fit`, or the multiple as a number's string. */
export const zoomLevel = (page: Page): Promise<string | null> =>
  page.locator('[data-zoom-slider]').getAttribute('data-zoom-level');

export async function zoomTo(page: Page, zoom: 'fit' | number): Promise<void> {
  if (zoom === 'fit') {
    await page.locator('[data-fit-day]').click();
  } else {
    await page.locator('[data-zoom-slider]').fill(String(Math.round(Math.log2(zoom) * 100)));
  }
  const want = zoom === 'fit' ? 'fit' : String(zoom);
  await until(async () => (await zoomLevel(page)) === want);
  // The scroll that keeps the view's minute lands with the frame that draws the scale.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
