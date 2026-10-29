/**
 * `setTheme` survives the session arriving mid-click (LAI-576).
 *
 * ## What went red
 *
 * CI / Deploy run 40702908482 failed *"fits > 390px, dark"* in
 * `organisation-pulse.test.ts`. Until `GET /me` answers, the page is the
 * pre-session shell, whose header carries `.theme-switch`; once it answers,
 * the signed-in shell replaces it and the theme is an item in the user menu.
 * `setTheme` chose `.theme-switch`, and the swap detached it before the click
 * landed. The click's locator then re-resolved to `.user-menu-trigger`, which
 * on a phone is in the off-canvas sidebar, so a pointed click waited thirty
 * seconds for a button that is outside the viewport by design.
 *
 * ## This file tests the harness, not a screen
 *
 * The first test pins down that the phone layout is right: the user menu is
 * off-canvas until the navigation opens, then reachable, in both themes. So
 * the failure was the helper, and the fix belongs to the helper.
 *
 * The second forces the swap into the window the CI run hit. `/me` is held
 * and the header's switch is kept moving, so a pointed click cannot land
 * until the session arrives and detaches it.
 *
 * The third is the other side of that (LAI-578): a click refused while the
 * switch stays mounted is a failure, and `setTheme` must not retry its way
 * past it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, THEME_CLICK_MS, type ApiStub } from './harness.ts';

const ADA = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'u1@example.com',
  org_role: 'owner',
  is_active: true,
  created_at: 1,
  updated_at: 1,
};

const STUB: ApiStub = {
  '/api/v1/me': { ...ADA, memberships: [] },
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: [ADA], next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': { id: 'o1', name: 'Acme', presence_enabled: true, created_at: 1, updated_at: 2 },
  '/api/v1/org/overview': {
    people: { active: 17, seen_this_week: 11, since: 1 },
    tasks: { open: 43, in_review: 5, blocked: 3, overdue: 7 },
  },
};

const dark = () => document.documentElement.getAttribute('data-theme') !== 'light';

void after(async () => {
  await closeBrowser();
});

void describe('a phone', () => {
  for (const theme of ['light', 'dark']) {
    void test(`390px, ${theme}: the user menu is off-canvas until the navigation opens`, async () => {
      const h = await open('/organisation', STUB);
      try {
        await h.page.setViewportSize({ width: 390, height: 900 });
        await setTheme(h.page, theme);
        const trigger = h.page.locator('.user-menu-trigger');
        const closed = await trigger.boundingBox();
        assert.ok(closed !== null, 'no user menu');
        assert.ok(closed.x + closed.width <= 0, `on screen while closed: x=${String(closed.x)}`);

        await h.page.locator('.shell-navtoggle').click();
        await h.page.locator('.sidebar-open').waitFor({ timeout: 5_000 });
        // A pointed click: it waits until the slide-in has finished and the
        // button is in the viewport, which is what a thumb needs.
        await trigger.click({ timeout: 5_000 });
        const box = await trigger.boundingBox();
        assert.ok(box !== null && box.x >= 0 && box.x + box.width <= 390, 'off screen when open');
        await h.page.locator('.user-menu-theme').waitFor({ state: 'visible', timeout: 5_000 });
      } finally {
        await h.close();
      }
    });
  }
});

void describe('setTheme', () => {
  for (const theme of ['dark', 'light']) {
    void test(`390px, to ${theme}: the session arriving mid-click does not strand it`, async () => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      const h = await open('/organisation', STUB, {
        before: async (page) => {
          await page.route('**/api/v1/me', async (route) => {
            await held;
            await route.continue();
          });
        },
      });
      try {
        await h.page.setViewportSize({ width: 390, height: 900 });
        await h.page.locator('.theme-switch').waitFor({ timeout: 10_000 });
        assert.equal(await h.page.locator('.user-menu-trigger').count(), 0, 'already signed in');
        // Start from the other theme, through the header's own switch.
        if ((await h.page.evaluate(dark)) === (theme === 'dark')) {
          await h.page.locator('.theme-switch').click();
        }
        // Never stable, so a pointed click waits — the window CI hit, held open.
        await h.page.addStyleTag({
          content:
            '@keyframes lai576-wobble { to { transform: translateX(4px); } }' +
            '.theme-switch { animation: lai576-wobble 80ms linear infinite alternate; }',
        });

        const switching = setTheme(h.page, theme);
        setTimeout(release, 300);
        await switching;

        assert.equal(await h.page.evaluate(dark), theme === 'dark');
        assert.equal(await h.page.locator('.theme-switch').count(), 0, 'the session never came');
      } finally {
        release();
        await h.close();
      }
    });
  }

  /*
   * **Only a replaced control is retried** (LAI-578). The review's
   * reproduction of #116: the switch stays mounted, its click is refused for a
   * reason that is not detachment, and a later click would succeed. A helper
   * that retries every failure turns the theme on that later click and passes,
   * hiding a control that refused a click. This one has to fail, with the
   * click's own message.
   */
  void test('a click refused while the switch stays mounted fails, with its own message', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const h = await open('/organisation', STUB, {
      before: async (page) => {
        await page.route('**/api/v1/me', async (route) => {
          await held;
          await route.continue();
        });
      },
    });
    let uncover: ReturnType<typeof setTimeout> | undefined;
    try {
      await h.page.locator('.theme-switch').waitFor({ timeout: 10_000 });
      const before = await h.page.evaluate(dark);
      // A sheet over the whole page: a pointed click on the switch is refused
      // with "intercepts pointer events", and the switch is never detached.
      await h.page.evaluate(() => {
        const sheet = document.createElement('div');
        sheet.id = 'lai578-sheet';
        sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent';
        document.body.append(sheet);
      });
      // Lifted after one attempt has been refused, so a retry would succeed.
      uncover = setTimeout(() => {
        void h.page.evaluate(() => document.getElementById('lai578-sheet')?.remove());
      }, THEME_CLICK_MS + 1_000);

      await assert.rejects(
        setTheme(h.page, before ? 'light' : 'dark'),
        /intercepts pointer events/,
      );

      assert.equal(await h.page.evaluate(dark), before, 'the theme turned on a retried click');
      assert.equal(await h.page.locator('.theme-switch').count(), 1, 'the switch was replaced');
      assert.equal(await h.page.locator('.user-menu-trigger').count(), 0, 'the session arrived');
    } finally {
      clearTimeout(uncover);
      release();
      await h.close();
    }
  });
});
