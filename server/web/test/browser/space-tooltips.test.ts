/**
 * Names, tooltips and reasons across the space views and the task (LAI-1213),
 * in a real browser under a strict CSP (`style-src-attr 'none'`):
 *
 * - on every screen of a space — Board, List, Timeline, Calendar, Sprints,
 *   Dashboard, Activity, Meeting review — and in the task drawer and the
 *   Workroom, every visible control whose words are not its name (an icon, a
 *   glyph, a `+3`) has a name **and** the shared tooltip;
 * - the tooltip shows on hover after the delay, and on keyboard focus;
 * - Escape closes a tooltip first and the drawer only on the next press;
 * - a held-back control says why, and stays reachable by Tab;
 * - nothing violates the CSP, and no bare `title` is left on those screens.
 *
 * With `LAIKA_SHOTS` set to a directory, the board, the drawer and the
 * Workroom land there, light and dark, at 1440 and 390, a tooltip open on
 * each.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  asServed,
  closeBrowser,
  open,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';
import { PROJECT, SPACE_TABS, TASKS, spaceStub } from './space-header-fixture.ts';
import { cspViolations, strictCsp, tooltipOf } from './tooltip-probe.ts';
import { STUB as WORKROOM } from './workroom-fixtures.ts';

const SHOTS = process.env.LAIKA_SHOTS;
const Q = `project=${PROJECT.slug}`;

/** The space, with each task in its status by id and name, as the server sends it. */
const space = (): ApiStub =>
  spaceStub({
    [`/api/v1/projects/${PROJECT.slug}/tasks`]: { data: TASKS.map(asServed), next_cursor: null },
  });

void after(async () => {
  await closeBrowser();
});

async function at(path: string, stub: ApiStub, width = 1440, height = 900): Promise<Harness> {
  return open(path, stub, {
    before: async (p) => {
      await p.setViewportSize({ width, height });
      await strictCsp(p);
    },
  });
}

/**
 * Every visible button or link in `scope` whose words are not its name — an
 * icon, a glyph, a count, or a name that says more than the face — described
 * as `outerHTML` when it has no name or no tooltip with words. Each is first
 * sent a `pointerenter`, so a lazy tooltip has been rendered.
 */
async function unnamedOrUntipped(page: Page, scope: string): Promise<string[]> {
  const candidates = (): Promise<number> =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (root === null) return -1;
      const all = [...root.querySelectorAll<HTMLElement>('button, a[href]')].filter(
        (el) => el.getClientRects().length > 0 && el.getAttribute('role') !== 'combobox',
      );
      const iconish = all.filter((el) => {
        const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const name = el.getAttribute('aria-label') ?? '';
        return !/[\p{L}]{2,}/u.test(words) || (name !== '' && !name.startsWith(words));
      });
      iconish.forEach((el, i) => {
        el.setAttribute('data-probe', String(i));
        el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
      });
      return iconish.length;
    }, scope);
  const count = await candidates();
  assert.ok(count >= 0, `${scope} is not on the page`);
  // Let the lazy tooltips commit, then read them.
  await page.waitForTimeout(50);
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-probe]')]
      .filter((el) => {
        const name = (el.getAttribute('aria-label') ?? '').trim();
        const tip = (el.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .find((t) => t?.getAttribute('role') === 'tooltip');
        // The phone sheet's handle and the click-away layer are exempt in
        // space-icon-names.test.ts, for the reasons written there. The
        // profile's InfoTip is a disclosure that opens a definition list —
        // not a tooltip, and not this task's (it is the census's follow-up).
        if (el.matches('.drawer-handle, .bt-catcher, .prof-info-button')) return name === '';
        return name === '' || (tip?.textContent ?? '').trim() === '';
      })
      .map((el) => el.outerHTML.slice(0, 160)),
  );
}

/** Elements under `scope` that still carry a bare `title` attribute. */
function bareTitles(page: Page, scope: string): Promise<string[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll<HTMLElement>(`${sel} [title]`)]
        // An SVG's own <title> child is not an attribute; Dropdown's trigger
        // is the shared primitive's, outside this task (see the census).
        .filter((el) => !el.matches('.dd-trigger'))
        .map((el) => el.outerHTML.slice(0, 120)),
    scope,
  );
}

const shown = async (tip: Locator): Promise<boolean> => (await tip.getAttribute('hidden')) === null;

/**
 * Hover shows the tooltip only after the delay; focus shows it too — unless
 * `focusable` is false: a card's marker is no tab stop, by design, and the
 * card it sits on is what the keyboard reaches.
 */
async function showsOnHoverAndFocus(
  page: Page,
  control: Locator,
  words: RegExp,
  focusable = true,
): Promise<void> {
  await page.mouse.move(1, 1);
  await control.hover();
  const tip = await tooltipOf(control);
  assert.equal(await shown(tip), false, 'the tooltip showed before the hover delay');
  await until(() => shown(tip), 2_000);
  assert.equal(await shown(tip), true, 'resting the pointer did not show the tooltip');
  assert.match((await tip.textContent()) ?? '', words);
  await page.mouse.move(1, 1);
  await until(async () => !(await shown(tip)), 2_000);
  assert.equal(await shown(tip), false, 'the tooltip outlived the pointer');
  if (!focusable) return;

  await control.focus();
  await until(() => shown(tip), 2_000);
  assert.equal(await shown(tip), true, 'keyboard focus did not show the tooltip');
  await control.blur();
}

void describe('every screen of a space names its icon-only controls and tooltips them', () => {
  for (const path of SPACE_TABS) {
    void test(`${path}: names, tooltips, no bare title, CSP clean`, async () => {
      const h = await at(`${path}?${Q}`, space());
      try {
        await h.page.locator('.space-bar').waitFor({ timeout: 20_000 });
        await h.page.waitForLoadState('networkidle');
        assert.deepEqual(
          await unnamedOrUntipped(h.page, 'main'),
          [],
          `${path}: unnamed or untipped`,
        );
        assert.deepEqual(await bareTitles(h.page, 'main'), [], `${path}: a bare title=`);
        assert.deepEqual(await cspViolations(h.page), [], `${path}: CSP violations`);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the board and the space header (LAI-1213)', () => {
  void test('the space ⋯ shows its name on hover after the delay, and on focus', async () => {
    const h = await at(`/board?${Q}`, space());
    try {
      const menu = h.page.getByRole('button', { name: 'Space menu' });
      await menu.waitFor({ timeout: 20_000 });
      assert.equal(await menu.locator('svg[data-icon="more"]').count(), 1, 'the ⋯ is typed');
      await showsOnHoverAndFocus(h.page, menu, /^Space menu$/);
    } finally {
      await h.close();
    }
  });

  void test('a card’s markers render their tooltip only when reached, then show it', async () => {
    const h = await at(`/board?${Q}`, space());
    try {
      const sprint = h.page.locator('article.card .card-sprint').first();
      await sprint.waitFor({ timeout: 20_000 });
      // Lazy: a board of cards carries no hidden tooltips until one is reached.
      const badges = h.page.locator('article.card .card-sprint');
      assert.ok((await badges.count()) > 1, 'fewer than two sprint badges — this proves nothing');
      const linked = await badges.evaluateAll(
        (els) => els.filter((el) => el.hasAttribute('aria-describedby')).length,
      );
      assert.equal(linked, 0, 'a badge carries its tooltip before anyone reached it');
      await showsOnHoverAndFocus(h.page, sprint, /^Sprint S\d/, false);
    } finally {
      await h.close();
    }
  });

  void test('Insights keeps its footnotes behind info hints: focus shows, a click pins', async () => {
    const h = await at(
      `/board?${Q}`,
      spaceStub({
        [`/api/v1/projects/${PROJECT.slug}/metrics`]: {
          since: 1,
          throughput: [
            { day: '2026-11-10', completed: 2 },
            { day: '2026-11-11', completed: 0 },
            { day: '2026-11-12', completed: 1 },
          ],
          cycle_time: {
            measured: 3,
            unmeasured: 0,
            p50_ms: 3_600_000,
            p75_ms: 7_200_000,
            p90_ms: 9_000_000,
          },
        },
      }),
    );
    try {
      const more = h.page.locator('[data-board-more]');
      await more.waitFor({ timeout: 20_000 });
      await more.click();
      await h.page.getByRole('menuitem', { name: 'Insights' }).click();
      const hint = h.page.getByRole('button', { name: 'About throughput' });
      await hint.waitFor({ timeout: 10_000 });
      // The essential figure stays on screen; the why moved behind the (i).
      assert.match(await h.page.locator('.bi').innerText(), /3 days\./);
      await hint.focus();
      const tip = await tooltipOf(hint);
      await until(() => shown(tip), 2_000);
      assert.equal(await shown(tip), true, 'focus did not show the hint');
      assert.match((await tip.textContent()) ?? '', /nothing\s+finished as zero/);
      // A click pins it: it stays after the pointer leaves.
      await hint.click();
      await h.page.mouse.move(1, 1);
      await h.page.waitForTimeout(400);
      assert.equal(await shown(tip), true, 'a click did not keep the hint open');
      assert.deepEqual(await cspViolations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('a locked field in View settings says why, and Tab reaches it', async () => {
    const h = await at(`/board?${Q}`, space());
    try {
      const more = h.page.locator('[data-board-more]');
      await more.waitFor({ timeout: 20_000 });
      await more.click();
      await h.page.getByRole('menuitem', { name: 'View settings' }).click();
      const locked = h.page.locator('.vs-remove[data-field="title"]');
      await locked.waitFor({ timeout: 5_000 });
      assert.equal(await locked.getAttribute('aria-disabled'), 'true');
      assert.equal(await locked.getAttribute('disabled'), null, 'natively disabled: no focus');
      await locked.focus();
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-field')),
        'title',
        'the locked control took no focus',
      );
      const tip = await tooltipOf(locked);
      await until(() => shown(tip), 2_000);
      assert.equal(await shown(tip), true, 'the tooltip did not show');
      assert.match((await tip.textContent()) ?? '', /title is not a card/i);
      // And it still does nothing.
      await locked.click({ force: true });
      assert.equal(await h.page.locator('.vs-remove[data-field="title"]').count(), 1);
    } finally {
      await h.close();
    }
  });
});

/** The board with the drawer open on LC-1 (the Workroom's fixture task), by its link. */
async function drawer(width = 1440, height = 900): Promise<Harness> {
  const h = await at('/board?project=laika-core&task=t1', WORKROOM, width, height);
  try {
    await h.page.locator('.drawer .panel-head').waitFor({ timeout: 20_000 });
    await h.page.waitForLoadState('networkidle');
  } catch (cause) {
    await h.close();
    throw cause;
  }
  return h;
}

void describe('the task drawer (LAI-1213)', () => {
  void test('every icon-only control is named and tooltipped; no bare title; CSP clean', async () => {
    const h = await drawer();
    try {
      assert.deepEqual(await unnamedOrUntipped(h.page, '.drawer'), []);
      assert.deepEqual(await bareTitles(h.page, '.drawer'), []);
      // The section headings carry a decorative mark, never a second name.
      const marks = h.page.locator('.drawer .panel-fold .section-mark');
      assert.ok((await marks.count()) >= 1, 'no section mark on the drawer’s headings');
      assert.equal(await marks.first().getAttribute('aria-hidden'), 'true');
      assert.deepEqual(await cspViolations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('Close shows “Close · Esc”; Escape closes the tooltip first, then the drawer', async () => {
    const h = await drawer();
    try {
      const close = h.page.locator('.drawer .panel-close');
      assert.equal(await close.getAttribute('aria-label'), 'Close');
      await close.focus();
      const tip = await tooltipOf(close);
      await until(() => shown(tip), 2_000);
      assert.equal(await shown(tip), true, 'the tooltip did not show');
      assert.match((await tip.textContent()) ?? '', /^Close/);
      assert.equal(await tip.locator('kbd').innerText(), 'Esc');
      assert.equal(await close.getAttribute('aria-keyshortcuts'), 'Escape');

      await h.page.keyboard.press('Escape');
      await until(async () => !(await shown(tip)), 2_000);
      assert.equal(
        await h.page.locator('.drawer').count(),
        1,
        'the first Escape closed the drawer',
      );
      await h.page.keyboard.press('Escape');
      await h.page.locator('.drawer').waitFor({ state: 'detached', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('Link with no task chosen says why, stays focusable, and sends nothing', async () => {
    const h = await drawer();
    try {
      await h.page.locator('.drawer .dep-link', { hasText: 'Link task' }).first().click();
      const link = h.page.locator('.drawer .dep-confirm', { hasText: 'Link' });
      await link.waitFor({ timeout: 5_000 });
      assert.equal(await link.getAttribute('aria-disabled'), 'true');
      assert.equal(await link.getAttribute('disabled'), null);
      await link.focus();
      const tip = await tooltipOf(link);
      await until(() => shown(tip), 2_000);
      assert.equal(await shown(tip), true, 'the tooltip did not show');
      assert.equal((await tip.textContent())?.trim(), 'Choose a task first');
      const posts = () => h.calls.filter((c) => c.method === 'POST').length;
      const before = posts();
      // `click()` would wait for it to be enabled; a person's click does not.
      await link.dispatchEvent('click');
      await h.page.waitForTimeout(200);
      assert.equal(posts(), before, 'a held-back Link still sent a request');
    } finally {
      await h.close();
    }
  });
});

void describe('the Workroom (LAI-1213)', () => {
  void test('named and tooltipped; Focus shows its “.” shortcut; section marks', async () => {
    const h = await at('/task/LC-1', WORKROOM);
    try {
      await h.page.locator('.wr-title').waitFor({ timeout: 20_000 });
      await h.page.waitForLoadState('networkidle');
      assert.deepEqual(await unnamedOrUntipped(h.page, '.wr'), []);
      assert.deepEqual(await bareTitles(h.page, '.wr'), []);

      const focus = h.page.locator('.wr-tool[aria-pressed]');
      assert.equal(await focus.getAttribute('aria-keyshortcuts'), '.');
      await focus.focus();
      const tip = await tooltipOf(focus);
      await until(() => shown(tip), 2_000);
      assert.equal(await shown(tip), true, 'the tooltip did not show');
      assert.equal(await tip.locator('kbd').innerText(), '.');

      const separator = h.page.getByRole('separator').first();
      assert.match((await (await tooltipOf(separator)).textContent()) ?? '', /drag, or ← and →/);
      assert.ok((await h.page.locator('.wr-section-title .section-mark').count()) >= 3);
      assert.deepEqual(await cspViolations(h.page), []);
    } finally {
      await h.close();
    }
  });
});

void describe('screenshots, light and dark, 1440 and 390 (LAI-1213)', () => {
  void test(
    'board, drawer and Workroom with a tooltip open',
    { skip: SHOTS === undefined },
    async () => {
      const dir = SHOTS ?? '';
      mkdirSync(dir, { recursive: true });
      for (const width of [1440, 390]) {
        for (const theme of ['light', 'dark']) {
          const name = (what: string) => join(dir, `${what}-${theme}-${String(width)}.png`);

          const b = await at(`/board?${Q}`, space(), width, 900);
          try {
            await b.page.locator('.space-bar').waitFor({ timeout: 20_000 });
            await setTheme(b.page, theme);
            const menu = b.page.getByRole('button', { name: 'Space menu' });
            await menu.focus();
            await until(async () => shown(await tooltipOf(menu)), 2_000);
            await b.page.screenshot({ path: name('board') });
          } finally {
            await b.close();
          }

          const d = await drawer(width, 900);
          try {
            await setTheme(d.page, theme);
            await d.page.goto(`${d.origin}/board?project=laika-core&task=t1`);
            await d.page.locator('.drawer .panel-head').waitFor({ timeout: 20_000 });
            const close = d.page.locator('.drawer .panel-close');
            await close.focus();
            await until(async () => shown(await tooltipOf(close)), 2_000);
            await d.page.screenshot({ path: name('drawer') });
          } finally {
            await d.close();
          }

          const w = await at('/task/LC-1', WORKROOM, width, 900);
          try {
            await w.page.locator('.wr-title').waitFor({ timeout: 20_000 });
            await setTheme(w.page, theme);
            const focus = w.page.locator('.wr-tool[aria-pressed]');
            await focus.focus();
            await until(async () => shown(await tooltipOf(focus)), 2_000);
            await w.page.screenshot({ path: name('workroom') });
          } finally {
            await w.close();
          }
        }
      }
    },
  );
});
