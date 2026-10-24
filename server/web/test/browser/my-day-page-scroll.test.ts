/**
 * My day scrolls as a page wherever the pointer is (LAI-311).
 *
 * The owner, on production: with the pointer over *To settle*, *Confirmed* or
 * the column beside the day, the wheel scrolled that box and the page never
 * moved; and the first row under a list's header was cut off.
 *
 * The page's scroller is `.shell-main` (LAI-601) — `window` never scrolls in
 * this shell — so that is what the wheel must move. Each box is wheeled from
 * where it stands, in whichever direction the page still has room to go, far
 * enough to run any scroll of its own to its end: a box that hands the wheel
 * back moves the page; one that keeps it does not.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type Harness } from './harness.ts';
import { open } from './my-day-clock.ts';
import { busyStub } from './my-day-busy.ts';

void after(async () => {
  await closeBrowser();
});

const BOXES = [
  { name: 'To review', css: '.myday-drafts .myday-scroll', tab: 'review' },
  { name: 'Confirmed', css: '.myday-entries .myday-scroll', tab: 'confirmed' },
  {
    name: 'the drawer beside the day',
    css: '[data-myday-drawer] .myday-drawer-body',
    tab: undefined,
  },
] as const;

/** The lists live on tabs (LAI-505): a box is reached on its own tab. */
async function showTab(h: Harness, tab: string | undefined): Promise<void> {
  if (tab === undefined) {
    // The drawer (LAI-511): opened from the header's button when it is not.
    if ((await h.page.locator('[data-myday-drawer]').count()) === 0) {
      await h.page.locator('[data-beside-button]').click();
      await h.page.locator('[data-myday-drawer]').waitFor({ timeout: 5_000 });
    }
    return;
  }
  const button = h.page.locator(`[data-day-tab="${tab}"]`);
  if ((await button.getAttribute('aria-current')) !== 'page') await button.click();
}

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

const pageTop = (h: Harness) =>
  h.page.evaluate(() => (document.querySelector('.shell-main')?.scrollTop ?? 0) + window.scrollY);

/**
 * Put the box's top 120px below the top of the viewport (or as near as the
 * page allows), every scroll at its start, and say which way the page can
 * still move and where the pointer goes.
 */
async function aim(h: Harness, css: string) {
  return h.page.evaluate((sel) => {
    const main = document.querySelector<HTMLElement>('.shell-main');
    const box = document.querySelector<HTMLElement>(sel);
    if (main === null || box === null) return null;
    for (const el of document.querySelectorAll<HTMLElement>('.myday-scroll, .myday-drawer-body')) {
      el.scrollTop = 0;
    }
    main.scrollTop += box.getBoundingClientRect().top - 120;
    const r = box.getBoundingClientRect();
    const view = main.getBoundingClientRect();
    const top = Math.max(r.top, view.top);
    const bottom = Math.min(r.bottom, view.bottom);
    const room = main.scrollHeight - main.clientHeight - main.scrollTop;
    return {
      x: r.left + r.width / 2,
      y: top + Math.min(60, (bottom - top) / 2),
      down: room > 40,
      visible: bottom - top,
    };
  }, css);
}

void describe('My day: the wheel scrolls the page wherever the pointer is', () => {
  void test('over To settle, Confirmed and the column, at 1440, 1024 and 390, light and dark', async () => {
    const h = await open('/my-day', busyStub());
    const stuck: string[] = [];
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await h.page.locator('.myday-drafts [data-settle-row]').first().waitFor({ timeout: 30_000 });
      for (const size of WIDTHS) {
        await h.page.setViewportSize(size);
        await h.page.waitForFunction((w) => document.documentElement.clientWidth === w, size.width);
        // Whatever the last width opened in the drawer is let go of (LAI-511).
        if ((await h.page.locator('[data-myday-drawer]').count()) > 0) {
          await h.page.keyboard.press('Escape');
          await until(async () => (await h.page.locator('[data-myday-drawer]').count()) === 0);
        }
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          for (const box of BOXES) {
            // On a phone the drawer is a modal sheet (LAI-511): the wheel is its, never the page's.
            if (box.tab === undefined && size.width <= 900) continue;
            const where = `${box.name} at ${String(size.width)}, ${theme}`;
            await showTab(h, box.tab);
            const at = await aim(h, box.css);
            assert.ok(at !== null, `${where}: not on the page`);
            assert.ok(at.visible > 20, `${where}: not in view to wheel over`);
            const before = await pageTop(h);
            await h.page.mouse.move(at.x, at.y);
            const step = at.down ? 240 : -240;
            for (let i = 0; i < 14; i += 1) await h.page.mouse.wheel(0, step);
            await until(async () => Math.abs((await pageTop(h)) - before) > 40, 2_000);
            const moved = (await pageTop(h)) - before;
            if (!(at.down ? moved > 40 : moved < -40)) {
              stuck.push(
                `${where}: the wheel ${at.down ? 'down' : 'up'} moved the page ${String(moved)}px`,
              );
            }
          }
        }
      }
      assert.deepEqual(stuck, []);
    } finally {
      await h.close();
    }
  });

  void test('the first row of each list sits whole under its header', async () => {
    const h = await open('/my-day', busyStub());
    const stuck: string[] = [];
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await h.page.locator('.myday-drafts [data-settle-row]').first().waitFor({ timeout: 30_000 });
      for (const size of WIDTHS) {
        await h.page.setViewportSize(size);
        await h.page.waitForFunction((w) => document.documentElement.clientWidth === w, size.width);
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          for (const card of ['.myday-drafts', '.myday-entries']) {
            const where = `${card} at ${String(size.width)}, ${theme}`;
            await showTab(h, card === '.myday-drafts' ? 'review' : 'confirmed');
            // Wheel the list first, as the owner did: the row must not be left under the head.
            const at = await aim(h, `${card} .myday-scroll`);
            assert.ok(at !== null, `${where}: no list`);
            await h.page.mouse.move(at.x, at.y);
            for (let i = 0; i < 3; i += 1) await h.page.mouse.wheel(0, 120);
            const m = await h.page.evaluate((sel) => {
              const head = document.querySelector(`${sel} .myday-card-head`);
              const list = document.querySelector(`${sel} .myday-scroll`);
              const first = document.querySelector(`${sel} .myday-blocks > li`);
              if (head === null || list === null || first === null) return null;
              const row = first.getBoundingClientRect();
              const clip = list.getBoundingClientRect();
              return {
                rowTop: row.top,
                rowBottom: row.bottom,
                headBottom: head.getBoundingClientRect().bottom,
                clipTop: clip.top,
                clipBottom: clip.bottom,
              };
            }, card);
            assert.ok(m !== null, `${where}: no first row`);
            if (!(m.rowTop >= m.headBottom - 0.5 && m.rowTop >= m.clipTop - 0.5)) {
              stuck.push(`${where}: the first row is cut off at the top ${JSON.stringify(m)}`);
            }
            if (!(m.rowBottom <= m.clipBottom + 0.5)) {
              stuck.push(`${where}: the first row is cut off at the bottom ${JSON.stringify(m)}`);
            }
          }
        }
      }
      assert.deepEqual(stuck, []);
    } finally {
      await h.close();
    }
  });
});
