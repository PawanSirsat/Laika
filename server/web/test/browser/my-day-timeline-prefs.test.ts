/**
 * The Timeline opens at 3× and its rows at 3× (the owner, 2026-10-26;
 * `timeline-prefs.ts`), and keeps a person's change across a reload. Opened
 * without `my-day-clock`'s 1× pin, so the defaults are what is seen.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, until } from './harness.ts';
import { pinToday, TODAY } from './my-day-clock.ts';
import { weekStub } from './my-day-week.ts';

after(async () => {
  await closeBrowser();
});

void describe('the Timeline’s defaults (3× both)', () => {
  void test('with nothing kept: 3× zoom, rows at 240px; a change survives a reload', async () => {
    const h = await open(`/my-day?day=${TODAY}`, weekStub(), { before: pinToday });
    try {
      const page = h.page;
      await page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      const level = page.locator('[data-zoom-level]');
      await level.waitFor({ timeout: 10_000 });
      assert.equal(await level.getAttribute('data-zoom-level'), '3');
      assert.equal((await level.innerText()).trim(), '3×');
      const blockH = () =>
        page
          .locator('[data-dayline-row], .dayline')
          .first()
          .evaluate((el) => {
            let at: Element | null = el;
            while (at !== null) {
              const v = getComputedStyle(at).getPropertyValue('--block-h').trim();
              if (v !== '') return v;
              at = at.parentElement;
            }
            return '';
          });
      assert.equal(await blockH(), '240px');

      // Zoom out once, and the rows down to 160px on the Row height slider: both kept.
      await page.locator('[data-zoom-step="out"]').click();
      await until(async () => (await level.getAttribute('data-zoom-level')) === '2');
      assert.equal(await level.getAttribute('data-zoom-level'), '2');
      await page.locator('[data-row-slider]').fill('160');
      await until(async () => (await blockH()) === '160px');
      assert.equal(await blockH(), '160px');
      await page.reload();
      await page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      await until(async () => (await level.getAttribute('data-zoom-level')) === '2');
      assert.equal(await level.getAttribute('data-zoom-level'), '2');
      assert.equal(await blockH(), '160px');
    } finally {
      await h.close();
    }
  });
});
