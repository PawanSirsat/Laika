/**
 * My day while the day is read (LAI-524), in a real browser: the skeleton is
 * the page it becomes — the header's buttons beside Viewing, the week's seven
 * tiles, the Timeline card with its lanes, signal bars and a day's blocks,
 * the tray, the tabs and the rows — in the page's column under the header,
 * never beside it; one shimmer, standing still for reduced motion; and on a
 * phone the lane column folds with nothing sideways. The error state sits in
 * the column too.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, refuse, setTheme, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { weekStub } from './my-day-week.ts';

/** My day with the day's read held open: it stays loading. */
async function loading(width: number, height: number): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, weekStub(), {
    before: async (page: Page) => {
      await page.setViewportSize({ width, height });
      await page.route(/\/api\/v1\/me\/time\?/, () => undefined);
    },
  });
  await h.page.locator('[data-day-loading]').waitFor({ timeout: 20_000 });
  return h;
}

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  assert.ok(b !== null, `${selector} is not drawn`);
  return b;
};

after(async () => {
  await closeBrowser();
});

void describe('My day loading (LAI-524)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}, 1440: the page in skeleton, under the header, in the column`, async () => {
      const h = await loading(1440, 1000);
      try {
        await setTheme(h.page, theme);
        const page = h.page;
        // In the column, header over body — never side by side.
        assert.equal(await page.locator('.myday-column [data-day-loading]').count(), 1);
        const header = await box(page, '.myday-column .screen-page');
        const body = await box(page, '[data-day-loading]');
        const column = await box(page, '.myday-column');
        assert.ok(body.y >= header.y + header.height - 1, 'the skeleton is not under the header');
        assert.ok(body.width > column.width * 0.9, 'the skeleton does not span the column');
        // The page's shape.
        assert.equal(await page.locator('[data-day-loading-actions] .dsk-bone').count(), 7);
        assert.equal(await page.locator('.dsk-tile').count(), 7);
        assert.equal(await page.locator('.dsk-block').count(), 7);
        assert.equal(await page.locator('.dsk-lanes .dsk-lane-label').count(), 3);
        assert.ok((await page.locator('.dsk-signal .dsk-bone').count()) > 20);
        assert.equal(await page.locator('.dsk-row').count(), 5);
        assert.equal(await page.locator('.dsk-tab').count(), 4);
        // Said once, where a reader looks: the Timeline's head.
        assert.equal(
          (await page.locator('[data-day-loading] [role="status"]').allInnerTexts()).join('|'),
          'Loading your day…',
        );
        assert.equal(await page.locator('[data-day-loading]').getAttribute('aria-busy'), 'true');
        // The lane labels sit on their lanes: SIGNALS beside the signals.
        const label = await box(page, '.dsk-lane-signals');
        const lane = await box(page, '.dsk-signals');
        assert.ok(Math.abs(label.y - lane.y) <= 1, 'the SIGNALS label is not on its lane');
        // One sheen, moving.
        assert.equal(
          await page
            .locator('.dsk-bone')
            .first()
            .evaluate((el) => getComputedStyle(el).animationName),
          'dsk-sheen',
        );
        // Nothing sideways.
        assert.equal(
          await page.evaluate(() => {
            const main = document.querySelector('.shell-main') ?? document.scrollingElement;
            return main === null ? 0 : main.scrollWidth - main.clientWidth;
          }),
          0,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('reduced motion: the bones stand still', async () => {
    const h = await open(`/my-day?day=${TODAY}`, weekStub(), {
      before: async (page: Page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.route(/\/api\/v1\/me\/time\?/, () => undefined);
      },
    });
    try {
      await h.page.locator('[data-day-loading]').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page
          .locator('.dsk-bone')
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
        'none',
      );
    } finally {
      await h.close();
    }
  });

  void test('390: under the header, the lane column folded, nothing sideways', async () => {
    const h = await loading(390, 844);
    try {
      const page = h.page;
      const header = await box(page, '.myday-column .screen-page');
      const body = await box(page, '[data-day-loading]');
      assert.ok(body.y >= header.y + header.height - 1, 'the skeleton is not under the header');
      assert.ok(body.x >= 0 && body.x + body.width <= 390, 'the skeleton leaves the screen');
      assert.equal(await page.locator('.dsk-lanes').isVisible(), false);
      assert.equal(
        await page.evaluate(() => {
          const main = document.querySelector('.shell-main') ?? document.scrollingElement;
          return main === null ? 0 : main.scrollWidth - main.clientWidth;
        }),
        0,
      );
    } finally {
      await h.close();
    }
  });

  void test('the error state sits under the header in the column too', async () => {
    const stub = {
      ...weekStub(),
      [`/api/v1/me/time?day=${TODAY}`]: refuse(500, 'internal', 'boom'),
    };
    const h = await open(`/my-day?day=${TODAY}`, stub);
    try {
      await h.page.locator('[data-day-error]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.myday-column [data-day-error]').count(), 1);
      const header = await box(h.page, '.myday-column .screen-page');
      const card = await box(h.page, '[data-day-error]');
      assert.ok(card.y >= header.y + header.height - 1, 'the error card is not under the header');
    } finally {
      await h.close();
    }
  });
});
