/**
 * The shared tab strip and tooltip (LAI-1193), in a real browser.
 *
 * - **Local tabs** (the hand-off views): one Tab stop, arrows/Home/End move
 *   and select, `aria-controls` names a panel that exists, focus is visible.
 * - **Route tabs** (`PageTabs` on Inbox): one Tab stop, Right goes to the next
 *   tab's address, focus stays on the strip.
 * - **Overflow at 390px** (`ViewTabs` on the board): the clipped edge fades,
 *   End reveals the last view, and the strip's current tab is never cut off.
 * - **Tooltip** on the board toolbar: hover and keyboard focus show it after
 *   the delay, Escape dismisses it, it is the control's description and not its
 *   name, it stays inside the window, and it renders **no style attribute** —
 *   checked under a CSP whose `style-src-attr` is `'none'`, with every
 *   `securitypolicyviolation` the page raises collected and asserted empty.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

const PROJECT = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const member = (id: string, name: string) => ({
  user_id: id,
  name,
  email: `${id}@example.com`,
  role: 'member',
  created_at: 1,
});

const MEMBERS = [member('u1', 'Ada Lovelace'), member('u2', 'Grace Hopper')];

const page = {
  data: [],
  next_cursor: null,
  counts: { received: 0, sent: 0, needs_approval: 0, recovery: 0 },
};

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'u1@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/projects': {
    data: [
      {
        ...PROJECT,
        task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 2,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': PROJECT,
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: MEMBERS },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/presence': { enabled: true, present: [] },
  '/api/v1/handoff-offers?view=received': page,
  '/api/v1/handoff-offers?view=sent': page,
  '/api/v1/handoff-offers?view=needs_approval': page,
  '/api/v1/handoff-offers?view=recovery': page,
  '/api/v1/review': { data: [], next_cursor: null },
};

/**
 * The server's policy (`server/src/http/security-headers.ts`) with
 * `style-src-attr` tightened from `'unsafe-inline'` to `'none'`: anything that
 * writes a `style` attribute raises a violation here. CSSOM writes do not.
 */
const STRICT_CSP = [
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

async function strictCsp(p: Page): Promise<void> {
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

const focusedAttr = (p: Page, name: string) =>
  p.evaluate((n) => document.activeElement?.getAttribute(n) ?? null, name);

after(async () => {
  await closeBrowser();
});

void describe('the shared tab strip (LAI-1193)', () => {
  void test('local tabs: one stop, arrows and Home/End select, aria-controls names a real panel, focus is visible', async () => {
    const h = await open('/inbox?tab=handoffs', STUB);
    try {
      const list = h.page.getByRole('tablist', { name: 'Show hand-offs' });
      await list.waitFor({ timeout: 20_000 });
      const tabs = list.getByRole('tab');
      assert.equal(await tabs.count(), 4);
      const stops = async () =>
        tabs.evaluateAll((els) => els.filter((el) => el.getAttribute('tabindex') === '0').length);
      assert.equal(await stops(), 1, 'a tablist has exactly one Tab stop');

      // aria-controls names a tabpanel that exists and is labelled by the tab.
      const panel = await tabs.first().evaluate((el) => {
        const target = document.getElementById(el.getAttribute('aria-controls') ?? '');
        return [target?.getAttribute('role'), target?.getAttribute('aria-labelledby') === el.id];
      });
      assert.deepEqual(panel, ['tabpanel', true]);

      await tabs.first().focus();
      await h.page.keyboard.press('ArrowRight');
      await until(async () => (await focusedAttr(h.page, 'data-filter')) === 'sent');
      assert.equal(await focusedAttr(h.page, 'aria-selected'), 'true');
      assert.equal(await stops(), 1);

      await h.page.keyboard.press('End');
      await until(async () => (await focusedAttr(h.page, 'data-filter')) === 'recovery');
      await h.page.keyboard.press('ArrowRight');
      await until(async () => (await focusedAttr(h.page, 'data-filter')) === 'received');
      await h.page.keyboard.press('ArrowLeft');
      await until(async () => (await focusedAttr(h.page, 'data-filter')) === 'recovery');
      await h.page.keyboard.press('Home');
      await until(async () => (await focusedAttr(h.page, 'data-filter')) === 'received');
      assert.equal(await focusedAttr(h.page, 'aria-selected'), 'true');

      // Keyboard focus draws an outline — in both themes.
      for (const theme of ['dark', 'light']) {
        await setTheme(h.page, theme);
        await tabs.first().focus();
        await h.page.keyboard.press('ArrowRight');
        await h.page.keyboard.press('ArrowLeft');
        const outline = await h.page.evaluate(() => {
          const el = document.activeElement;
          return el === null ? 'none' : getComputedStyle(el).outlineStyle;
        });
        assert.notEqual(outline, 'none', `${theme}: no visible focus on the tab`);
      }
    } finally {
      await h.close();
    }
  });

  void test('route tabs: one stop, Right goes to the next address and keeps focus on the strip', async () => {
    const h = await open('/inbox?tab=review', STUB);
    try {
      const nav = h.page.getByRole('navigation', { name: 'Inbox sections' });
      await nav.waitFor({ timeout: 20_000 });
      const links = nav.locator('[data-tab]');
      const stops = await links.evaluateAll((els) =>
        els
          .filter((el) => el.getAttribute('tabindex') === '0')
          .map((el) => el.getAttribute('data-tab')),
      );
      assert.deepEqual(stops, ['review']);

      await nav.locator('[data-tab="review"]').focus();
      await h.page.keyboard.press('ArrowRight');
      await until(() => h.page.url().includes('tab=handoffs'));
      assert.match(h.page.url(), /tab=handoffs/);
      await until(async () => (await focusedAttr(h.page, 'data-tab')) === 'handoffs');
      assert.equal(await focusedAttr(h.page, 'aria-current'), 'page');

      await h.page.keyboard.press('Home');
      await until(() => h.page.url().includes('tab=review'));
      assert.match(h.page.url(), /tab=review/);
    } finally {
      await h.close();
    }
  });

  void test('390px: the clipped edge fades, End reveals the last view, the current view is never cut off', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      const strip = h.page.locator('.view-tabs [data-tab-strip]');
      await strip.waitFor({ timeout: 20_000 });
      const state = () =>
        strip.evaluate((el) => {
          const frame = el.getBoundingClientRect();
          const active = el.querySelector('[data-tab-active]')?.getBoundingClientRect();
          return {
            scrolls: el.scrollWidth > el.clientWidth + 1,
            start: el.classList.contains('tab-strip-fade-start'),
            end: el.classList.contains('tab-strip-fade-end'),
            activeInside:
              active !== undefined &&
              active.left >= frame.left - 1 &&
              active.right <= frame.right + 1,
            label: document.activeElement?.textContent?.trim() ?? '',
          };
        });
      await until(async () => (await state()).end);
      const first = await state();
      assert.equal(
        first.scrolls,
        true,
        'the eight views do not fit 390px — the test needs overflow',
      );
      assert.deepEqual([first.start, first.end, first.activeInside], [false, true, true]);

      await strip.locator('[data-tab-active]').focus();
      await h.page.keyboard.press('End');
      await until(async () => (await state()).start && (await state()).activeInside);
      const last = await state();
      assert.equal(last.start, true, 'scrolled to the end, the start edge must fade');
      assert.equal(last.end, false, 'scrolled to the end, the end edge must not fade');
      assert.equal(last.activeInside, true, 'the current view is cut off');
      assert.match(h.page.url(), /\/meeting-review\?/);
    } finally {
      await h.close();
    }
  });
});

void describe('the shared tooltip (LAI-1193)', () => {
  void test('hover and keyboard focus show it after the delay; Escape dismisses; it describes, never names; no style attribute under a strict CSP', async () => {
    const h = await open('/board?project=laika-core', STUB, { before: strictCsp });
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      const refresh = h.page.getByRole('button', { name: 'Refresh the board' });
      await refresh.waitFor({ timeout: 20_000 });

      // The name is the control's own aria-label, not the tooltip.
      assert.equal(await refresh.getAttribute('aria-label'), 'Refresh the board');
      assert.equal(await refresh.getAttribute('title'), null);
      const tipId = (await refresh.getAttribute('aria-describedby')) ?? '';
      assert.notEqual(tipId, '');
      const tip = h.page.locator(`[id="${tipId}"]`);
      assert.equal(await tip.getAttribute('role'), 'tooltip');
      assert.equal(await tip.isVisible(), false, 'shown before anyone asked');
      // What React renders carries no style attribute at all.
      assert.equal(await tip.getAttribute('style'), null, 'rendered with a style attribute');

      // Hover: not at once, then after the delay.
      await refresh.hover();
      await h.page.waitForTimeout(150);
      assert.equal(await tip.isVisible(), false, 'shown before the delay');
      await tip.waitFor({ state: 'visible', timeout: 2_000 });
      assert.equal(await tip.innerText(), 'Refresh the board');
      const box = await tip.boundingBox();
      assert.ok(
        box !== null && box.x >= 0 && box.x + box.width <= 1440 && box.y >= 0,
        `outside the window: ${JSON.stringify(box)}`,
      );
      // Positioned through the CSSOM: only the two custom properties, which the
      // CSP permits — the violation list at the end is what proves it.
      assert.match(
        (await tip.getAttribute('style')) ?? '',
        /^--tip-x: \d+px; --tip-y: \d+px;$/,
        'the tooltip carries more than its two position properties',
      );

      // Escape dismisses while the pointer still rests on the control.
      await h.page.keyboard.press('Escape');
      await tip.waitFor({ state: 'hidden', timeout: 2_000 });
      await h.page.waitForTimeout(600);
      assert.equal(await tip.isVisible(), false, 'came back without leaving');

      // Keyboard focus shows it too, and moving focus away hides it.
      await h.page.mouse.move(700, 700);
      const insights = h.page.getByRole('button', { name: 'Insights' });
      await insights.focus();
      const insightsTip = h.page.locator(
        `[id="${(await insights.getAttribute('aria-describedby')) ?? ''}"]`,
      );
      await insightsTip.waitFor({ state: 'visible', timeout: 2_000 });
      assert.equal(await insightsTip.innerText(), 'Insights');
      await h.page.keyboard.press('Tab');
      await insightsTip.waitFor({ state: 'hidden', timeout: 2_000 });

      // Every icon-only control on the toolbar and the space bar has a name and a tooltip.
      const unlabelled = await h.page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.bt .bt-icon, .bt .bt-member, .space-menu-trigger, .space-member',
          ),
        ]
          .filter(
            (el) =>
              (el.getAttribute('aria-label') ?? '') === '' ||
              el.hasAttribute('title') ||
              document
                .getElementById(el.getAttribute('aria-describedby') ?? '')
                ?.getAttribute('role') !== 'tooltip',
          )
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      assert.deepEqual(unlabelled, []);

      const violations = await h.page.evaluate(() => window.__cspViolations ?? []);
      assert.deepEqual(violations, [], 'the page broke the strict CSP');
    } finally {
      await h.close();
    }
  });
});
