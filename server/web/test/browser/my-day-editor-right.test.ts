import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { weekStub } from './my-day-week.ts';

/**
 * The drawer beside the page (the owner's `MyDay.dc.html`, LAI-511, after
 * LAI-508's column): nothing is in hand on load and the page is alone;
 * tapping a block, a gap or a stretch opens the editor in a drawer beside the
 * whole page; the header's button opens Agent time and On your plate in the
 * same drawer; Esc and × close it. Under 1280px the sidebar folds to its rail
 * while the drawer is open; under 900px the drawer is a bottom sheet.
 */

async function myDay(width = 1440, height = 900): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, weekStub(), {
    before: async (page) => {
      await page.setViewportSize({ width, height });
    },
  });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  return h;
}

const drawerCount = (h: Harness): Promise<number> => h.page.locator('[data-myday-drawer]').count();

after(async () => {
  await closeBrowser();
});

void describe('the drawer beside the page (LAI-511)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: closed on load; the editor opens beside the page for a block, a gap and a range; Esc and × close it`, async () => {
      const h = await myDay();
      try {
        await setTheme(h.page, theme);
        // Nothing in hand: no drawer, no cards on the page, the column whole.
        assert.equal(await drawerCount(h), 0);
        assert.equal(await h.page.locator('.myday-agent, .myday-plate').count(), 0);
        assert.equal(await h.page.locator('[data-inspector]').count(), 0);
        assert.equal(
          await h.page.locator('[data-beside-button]').getAttribute('aria-expanded'),
          'false',
        );

        // A block: the editor, in a drawer to the right of the page's column.
        await h.page.locator('[data-block-select]').first().click();
        const drawer = h.page.locator('[data-myday-drawer]');
        await drawer.locator('[data-inspector="draft"]').waitFor({ timeout: 10_000 });
        assert.equal(await drawer.getAttribute('data-drawer'), 'editor');
        assert.equal(await drawer.getAttribute('role'), 'dialog');
        const column = await h.page.locator('.myday-column').boundingBox();
        const box = await drawer.boundingBox();
        assert.ok(column !== null && box !== null);
        assert.ok(box.x >= column.x + column.width - 1, 'the drawer is not beside the page');
        assert.ok(
          box.height >= 880,
          `the drawer is not the height of the window: ${String(box.height)}`,
        );
        assert.equal(await h.page.locator('.myday-main [data-inspector]').count(), 0);

        await h.page.keyboard.press('Escape');
        await until(async () => (await drawerCount(h)) === 0);

        // A confirmed block, from the list; × closes.
        await h.page.locator('[data-day-tab="confirmed"]').click();
        await h.page.locator('[data-select="e1"]').click();
        await drawer.locator('[data-inspector-for="e1"]').waitFor({ timeout: 5_000 });
        await drawer.locator('.inspector-close').first().click();
        await until(async () => (await drawerCount(h)) === 0);

        // A gap on the Timeline, then its Add time, then Cancel.
        // A gap on the Timeline: Add time, with the gap as its range (LAI-515).
        await h.page.locator('.dayline-gap').first().click();
        await drawer.locator('[data-inspector="gap"] [data-new-entry]').waitFor({ timeout: 5_000 });
        assert.equal(await drawer.getAttribute('aria-label'), 'Add time');
        await drawer.locator('.inspector-close').first().click();
        await until(async () => (await drawerCount(h)) === 0);
      } finally {
        await h.close();
      }
    });
  }

  void test('the header button opens Agent time and On your plate in the drawer; a pick replaces them with the editor', async () => {
    const h = await myDay();
    try {
      const button = h.page.locator('[data-beside-button]');
      await button.click();
      const drawer = h.page.locator('[data-myday-drawer]');
      await drawer.locator('.myday-agent').waitFor({ timeout: 5_000 });
      assert.equal(await drawer.getAttribute('data-drawer'), 'cards');
      assert.equal(await drawer.locator('.myday-plate').count(), 1);
      assert.equal(await button.getAttribute('aria-expanded'), 'true');
      assert.equal(await h.page.locator('.myday-column .myday-agent').count(), 0);

      await h.page.locator('[data-block-select]').first().click();
      await drawer.locator('[data-inspector="draft"]').waitFor({ timeout: 5_000 });
      assert.equal(await drawer.getAttribute('data-drawer'), 'editor');
      assert.equal(await drawer.locator('.myday-agent').count(), 0);

      // The button again: the cards, instead of the editor.
      await button.click();
      await drawer.locator('.myday-agent').waitFor({ timeout: 5_000 });
      assert.equal(await drawer.getAttribute('data-drawer'), 'cards');
      // And once more: closed.
      await button.click();
      await until(async () => (await drawerCount(h)) === 0);
      assert.equal(await button.getAttribute('aria-expanded'), 'false');

      await button.click();
      await drawer.waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Escape');
      await until(async () => (await drawerCount(h)) === 0);
    } finally {
      await h.close();
    }
  });

  void test('at 1260 the sidebar folds to its rail while the drawer is open; at 390 the drawer is a bottom sheet', async () => {
    // 1260: under the design's 1280, above the shell's own narrow band (1180).
    const h = await myDay(1260, 800);
    try {
      assert.equal(await h.page.locator('.sidebar-collapsed').count(), 0);
      await h.page.locator('[data-block-select]').first().click();
      const drawer = h.page.locator('[data-myday-drawer]');
      await drawer.locator('[data-inspector="draft"]').waitFor({ timeout: 10_000 });
      await until(async () => (await h.page.locator('.sidebar-collapsed').count()) === 1);
      // The rail's width animates; measure once it has settled.
      await until(
        async () => ((await h.page.locator('.myday-column').boundingBox())?.width ?? 0) >= 700,
      );
      const column = await h.page.locator('.myday-column').boundingBox();
      const box = await drawer.boundingBox();
      assert.ok(column !== null && box !== null);
      assert.ok(box.x >= column.x + column.width - 1, 'the drawer is not beside the page at 1260');
      assert.ok(column.width >= 700, `the page is squeezed at 1260: ${String(column.width)}`);
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.locator('.sidebar-collapsed').count()) === 0);

      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.waitForFunction(() => document.documentElement.clientWidth === 390);
      await h.page.locator('[data-block-select]').first().click();
      await drawer.locator('[data-inspector="draft"]').waitFor({ timeout: 10_000 });
      const sheet = await drawer.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { position: s.position, bottom: Math.round(r.bottom), height: r.height, top: r.top };
      });
      assert.equal(sheet.position, 'fixed');
      assert.equal(sheet.bottom, 844, 'the sheet does not sit on the bottom');
      assert.ok(
        sheet.height <= 844 * 0.86 + 1,
        `the sheet is taller than 86%: ${String(sheet.height)}`,
      );
      assert.ok(
        await h.page.locator('[data-myday-scrim]').isVisible(),
        'no scrim behind the sheet',
      );
      // Focus is inside the sheet.
      assert.ok(await drawer.evaluate((el) => el.contains(document.activeElement)));
      await h.page.locator('[data-myday-scrim]').click({ position: { x: 10, y: 10 } });
      await until(async () => (await drawerCount(h)) === 0);
    } finally {
      await h.close();
    }
  });
});
