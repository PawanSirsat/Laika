/**
 * Icons, tooltips and reasons on the pages (LAI-1214), in a real browser and
 * under a strict CSP (`style-src-attr 'none'`):
 *
 * - My day: the header's icon-only controls have names and the shared
 *   tooltip, on hover after the delay and on keyboard focus, with My day's
 *   keys as keycaps (N, ?, ← →); Next day on today is off *with a reason* and
 *   still focusable; the Timeline's zoom limit says so; drawn icons, not
 *   typed ‹ › − + ×;
 * - the app shell: the rail toggle's tooltip on hover and focus, and at 390
 *   the phone bar's menu and ⌘K triggers, the palette's key in the words;
 * - Insights: Capacity's column rules are tooltips, shown on hover;
 * - no CSP violation anywhere.
 *
 * With `LAIKA_SHOTS` set, My day and the shell land there, light and dark, at
 * 1440 and 390, a tooltip showing.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { orgStub } from './capacity-org.ts';
import { closeBrowser, open as openPage, setTheme, until, type Harness } from './harness.ts';
import { open as openDay } from './my-day-clock.ts';
import { TODAY, weekData, weekStub } from './my-day-week.ts';
import { strictCsp, tipText } from './tooltip-probe.ts';

const SHOTS = process.env.LAIKA_SHOTS;

async function violations(p: Page): Promise<string[]> {
  return p.evaluate(() => window.__cspViolations ?? []);
}

void after(async () => {
  await closeBrowser();
});

async function myDay(width = 1440, height = 900): Promise<Harness> {
  const h = await openDay(`/my-day?day=${TODAY}`, weekStub(weekData()), {
    before: async (p) => {
      await p.setViewportSize({ width, height });
      await strictCsp(p);
    },
  });
  try {
    await h.page
      .locator(width > 900 ? '[data-dayline]' : '[data-phone-head]')
      .waitFor({ timeout: 20_000 });
    await settle(h.page);
  } catch (cause) {
    await h.close();
    throw cause;
  }
  return h;
}

/**
 * Past the Tooltip's arrival window: focus that lands as a control mounts is
 * a surface's first focus, not the reader's, and shows nothing (Tooltip's
 * `ARRIVAL_MS`, 300 — not imported: Tooltip.tsx imports its CSS).
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(400);
}

/** The tooltip element a control is described by. */
async function tipOf(control: Locator): Promise<Locator> {
  const ids = ((await control.getAttribute('aria-describedby')) ?? '').split(/\s+/);
  for (const id of ids.filter(Boolean)) {
    const el = control.page().locator(`[id="${id}"]`);
    if ((await el.getAttribute('role')) === 'tooltip') return el;
  }
  throw new Error(`no tooltip describes ${String(control)}`);
}

/** Hover shows it after the delay — not at once — and leaving hides it. */
async function showsOnHover(control: Locator, words: RegExp): Promise<void> {
  const tip = await tipOf(control);
  await control.hover();
  assert.equal(await tip.isVisible(), false, 'the tooltip showed with no delay');
  await tip.waitFor({ state: 'visible', timeout: 3_000 });
  assert.match((await tip.innerText()).replace(/\s+/g, ' '), words);
  await control.page().mouse.move(1, 1);
  await tip.waitFor({ state: 'hidden', timeout: 3_000 });
}

/** Keyboard focus shows it too — the thing a bare title= never did. */
async function showsOnFocus(control: Locator, words: RegExp): Promise<void> {
  const tip = await tipOf(control);
  // From somewhere else: focusing what already has focus fires no focusin.
  await control.page().evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await control.focus();
  await tip.waitFor({ state: 'visible', timeout: 3_000 });
  assert.match((await tip.innerText()).replace(/\s+/g, ' '), words);
  await control.evaluate((el) => {
    (el as HTMLElement).blur();
  });
  await tip.waitFor({ state: 'hidden', timeout: 3_000 });
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

void describe('My day: names, tooltips, keys and reasons (LAI-1214)', () => {
  void test('the header’s icon-only controls are named and show their tooltip, with the key, on hover and on focus', async () => {
    const h = await myDay();
    try {
      const add = h.page.locator('[data-add-time]').first();
      const help = h.page.locator('[data-shortcuts-button]');
      const beside = h.page.locator('[data-beside-button]').last();
      assert.equal(await add.getAttribute('aria-label'), 'Add time');
      assert.equal(await help.getAttribute('aria-label'), 'Keyboard shortcuts');
      assert.equal(await beside.getAttribute('aria-label'), 'Beside your day');
      // My day's keys, as keycaps and as aria-keyshortcuts.
      assert.equal(await add.getAttribute('aria-keyshortcuts'), 'N');
      assert.equal(await help.getAttribute('aria-keyshortcuts'), '?');
      await showsOnHover(add, /^Add time\s?N$/);
      await showsOnFocus(help, /^Keyboard shortcuts\s?\?$/);
      await showsOnHover(beside, /Agent time and On your plate/);
      // Drawn, not typed: the ? is the registry's question icon.
      assert.equal(await help.locator('[data-icon="question"]').count(), 1);
      assert.equal((await help.innerText()).trim(), '');
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('the Timeline steps with ← and →, says so, and draws its chevrons and zoom marks', async () => {
    const h = await myDay();
    try {
      const prev = h.page.locator('[data-block-step="previous"]');
      const next = h.page.locator('[data-block-step="next"]');
      assert.equal(await prev.getAttribute('aria-keyshortcuts'), 'ArrowLeft');
      assert.equal(await next.getAttribute('aria-keyshortcuts'), 'ArrowRight');
      await showsOnFocus(prev, /^Previous block\s?←$/);
      await showsOnHover(next, /^Next block\s?→$/);
      assert.equal(await prev.locator('[data-icon="chevron-left"]').count(), 1);
      assert.equal(await h.page.locator('[data-zoom-step="out"] [data-icon="minus"]').count(), 1);
      assert.equal(await h.page.locator('[data-zoom-step="in"] [data-icon="plus"]').count(), 1);
      // The bare title= is gone from every control on the card.
      assert.equal(
        await h.page.locator('[data-dayline] button[title], [data-dayline] input[title]').count(),
        0,
      );
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('at the zoom limit and in this week, a step is off with a reason — and still reachable by keyboard', async () => {
    const h = await myDay();
    try {
      // This week: there is no next one, and the button says so rather than greying out mutely.
      const nextDay = h.page.getByRole('button', { name: 'Next week' });
      assert.equal(await nextDay.getAttribute('aria-disabled'), 'true');
      assert.equal(await nextDay.isDisabled(), true);
      assert.equal(await tipText(nextDay), 'This is the latest week there is');
      await nextDay.focus();
      assert.equal(
        await nextDay.evaluate((el) => document.activeElement === el),
        true,
        'a step off with a reason took no focus',
      );
      await showsOnFocus(nextDay, /^This is the latest week there is$/);

      // Zoom in until it goes no further: the tooltip says that instead of a figure.
      const zoomIn = h.page.locator('[data-zoom-step="in"]');
      for (let i = 0; i < 10 && (await zoomIn.getAttribute('aria-disabled')) !== 'true'; i++) {
        await zoomIn.click();
      }
      await until(async () => (await zoomIn.getAttribute('aria-disabled')) === 'true');
      assert.equal(await tipText(zoomIn), 'As far in as it goes');
      await showsOnFocus(zoomIn, /^As far in as it goes$/);
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  for (const [theme, width, height] of [
    ['Light', 1440, 900],
    ['Dark', 1440, 900],
    ['Light', 390, 844],
    ['Dark', 390, 844],
  ] as const) {
    void test(`${theme} at ${String(width)}: a tooltip is drawn in the theme, inside the window`, async () => {
      const h = await myDay(width, height);
      try {
        await setTheme(h.page, theme);
        const control =
          width > 900
            ? h.page.locator('[data-shortcuts-button]')
            : h.page.locator('[data-phone-head]').getByRole('button', { name: 'Next day' });
        const tip = await tipOf(control);
        await control.focus();
        await tip.waitFor({ state: 'visible', timeout: 3_000 });
        const box = await tip.boundingBox();
        assert.ok(box !== null);
        assert.ok(box.x >= 0 && box.x + box.width <= width, 'the tooltip runs off the window');
        // Drawn in the theme's own ink and paper, not the browser's yellow.
        const [ink, paper] = await tip.evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.color, style.backgroundColor];
        });
        assert.notEqual(ink, paper);
        assert.notEqual(paper, 'rgba(0, 0, 0, 0)');
        await shoot(h.page, `my-day-${theme.toLowerCase()}-${String(width)}`);
        assert.deepEqual(await violations(h.page), []);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the app shell (LAI-1214)', () => {
  void test('the rail toggle is named and tooltipped, on hover and on focus, in both states', async () => {
    const h = await myDay();
    try {
      const toggle = h.page.locator('.sidebar-toggle');
      assert.equal(await toggle.getAttribute('aria-label'), 'Collapse sidebar');
      await showsOnHover(toggle, /^Collapse sidebar$/);
      await toggle.click();
      await until(async () => (await toggle.getAttribute('aria-expanded')) === 'false');
      assert.equal(await toggle.getAttribute('aria-label'), 'Expand sidebar');
      await showsOnFocus(toggle, /^Expand sidebar$/);
      // The rail's own name reveal no longer doubles it.
      assert.equal(await toggle.locator('.sidebar-tip').count(), 0);
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['Light', 'Dark']) {
    void test(`${theme} at 390: the phone bar's menu and search are named and tooltipped, the palette's key in the words`, async () => {
      const h = await myDay(390, 844);
      try {
        await setTheme(h.page, theme);
        const menu = h.page.locator('.shell-navtoggle');
        const search = h.page.locator('[data-palette-trigger="header"]');
        await showsOnFocus(menu, /^Open navigation$/);
        // The key is in the words (no aria-keyshortcuts on any page — LAI-473).
        assert.equal(await search.getAttribute('aria-keyshortcuts'), null);
        await showsOnFocus(search, /^Search and commands \((⌘K|Ctrl K)\)$/);
        await shoot(h.page, `shell-${theme.toLowerCase()}-390`);
        assert.deepEqual(await violations(h.page), []);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('Insights (LAI-1214)', () => {
  void test('Capacity’s column rules are tooltips, shown on hover', async () => {
    const h = await openPage('/insights?tab=capacity', orgStub('owner'), {
      before: async (p) => {
        await p.setViewportSize({ width: 1440, height: 900 });
        await strictCsp(p);
      },
    });
    try {
      await h.page.getByRole('button', { name: 'List', exact: true }).click();
      const head = h.page.locator('.cap-list thead th.cap-list-num').first();
      await head.waitFor({ timeout: 20_000 });
      assert.equal(await head.getAttribute('title'), null, 'a bare title= is back');
      assert.ok((await tipText(head)).length > 20, 'the column lost its rule');
      const tip = await tipOf(head);
      await head.hover();
      await tip.waitFor({ state: 'visible', timeout: 3_000 });
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });
});
