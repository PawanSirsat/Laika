import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { weekStub } from './my-day-week.ts';

/**
 * The editor lives in the right column (the owner's design, LAI-508):
 * tapping a block, a gap or a stretch opens it there; Agent time and On your
 * plate stand there only while nothing is in hand; Esc hands the column back.
 */

async function myDay(): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, weekStub());
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.setViewportSize({ width: 1440, height: 900 });
  return h;
}

after(async () => {
  await closeBrowser();
});

void describe('the right column (LAI-508)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the editor opens beside the lists for a block, a gap and a range; Esc shows the cards`, async () => {
      const h = await myDay();
      try {
        await setTheme(h.page, theme);
        const side = h.page.locator('[data-myday-side]');
        // The day opens on its first draft: the editor is in the column.
        await h.page
          .locator('[data-myday-side] [data-inspector="draft"]')
          .waitFor({ timeout: 10_000 });
        assert.equal(await side.getAttribute('data-side'), 'editor');
        assert.equal(await h.page.locator('.myday-main [data-inspector]').count(), 0);
        assert.equal(await side.locator('.myday-agent, .myday-plate').count(), 0);
        const main = await h.page.locator('.myday-main').boundingBox();
        const box = await side.boundingBox();
        assert.ok(main !== null && box !== null);
        assert.ok(box.x > main.x + main.width - 1, 'the editor is not beside the lists');
        // Its parts stack in the column.
        const xs = await side
          .locator('[data-inspector="draft"] .inspector-part')
          .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)));
        assert.ok(xs.length >= 3 && new Set(xs).size === 1, 'the parts sit side by side');

        await h.page.keyboard.press('Escape');
        await until(async () => (await side.getAttribute('data-side')) === 'cards');
        assert.equal(await side.locator('.myday-agent').count(), 1);
        assert.equal(await side.locator('.myday-plate').count(), 1);
        assert.equal(await h.page.locator('[data-inspector]').count(), 0);

        // A confirmed block, from the list.
        await h.page.locator('[data-select="e1"]').click();
        await side.locator('[data-inspector-for="e1"]').waitFor({ timeout: 5_000 });
        assert.equal(await side.getAttribute('data-side'), 'editor');
        await h.page.keyboard.press('Escape');
        await until(async () => (await side.getAttribute('data-side')) === 'cards');

        // A gap on the Timeline, then its Add time here.
        await h.page.locator('.dayline-gap').first().click();
        await side.locator('[data-inspector="gap"]').waitFor({ timeout: 5_000 });
        await side.locator('[data-gap-add]').click();
        await side.locator('[data-inspector="range"]').waitFor({ timeout: 5_000 });
        await side
          .locator('[data-inspector="range"]')
          .getByRole('button', { name: 'Cancel' })
          .click();
        await until(async () => (await side.getAttribute('data-side')) === 'cards');
      } finally {
        await h.close();
      }
    });
  }

  void test('at 1366 the column stays beside; at 390 it drops below the lists', async () => {
    const h = await myDay();
    try {
      const side = h.page.locator('[data-myday-side]');
      await side.locator('[data-inspector="draft"]').waitFor({ timeout: 10_000 });
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await h.page.waitForFunction(() => document.documentElement.clientWidth === 1366);
      let main = await h.page.locator('.myday-main').boundingBox();
      let box = await side.boundingBox();
      assert.ok(main !== null && box !== null);
      assert.ok(box.x > main.x + 200, 'not two columns at 1366');
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.waitForFunction(() => document.documentElement.clientWidth === 390);
      main = await h.page.locator('.myday-main').boundingBox();
      box = await side.boundingBox();
      assert.ok(main !== null && box !== null);
      assert.ok(box.y >= main.y + main.height - 1, 'the editor is not below the lists at 390');
    } finally {
      await h.close();
    }
  });
});
