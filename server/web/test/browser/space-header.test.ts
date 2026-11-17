/**
 * One space header on every tab, a calmer board toolbar, and an honest board
 * scope (LAI-1198).
 *
 * The visual audit found the header changing shape from tab to tab — filters
 * in the title row on four of eight, Create jumping ~42px down there — the
 * header collapsing at 390 (title over the filters, 220px before content, a
 * clipped tab bar with no cue), a board toolbar of eleven controls with five
 * bare icons, and a board that opened on one sprint with only a chip to say
 * so. Each describe below is one of those, measured in a browser.
 *
 * Since LAI-1227 the space bar has no + Create — the app's one Create is the
 * top bar's — and a *Spaces /* breadcrumb sits above the space's name.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, until } from './harness.ts';
import { PROJECT, SPACE_TABS, TASKS, spaceStub } from './space-header-fixture.ts';
import { tipText } from './tooltip-probe.ts';

void after(async () => {
  await closeBrowser();
});

const Q = `project=${PROJECT.slug}`;

/** The header's shape and where its fixed controls sit, in whole pixels. */
const header = (page: Page) =>
  page.evaluate(() => {
    const box = (q: string) => {
      const b = document.querySelector(q)?.getBoundingClientRect();
      return b === undefined
        ? null
        : {
            x: Math.round(b.x),
            y: Math.round(b.y),
            r: Math.round(b.right),
            b: Math.round(b.bottom),
          };
    };
    const bar = document.querySelector('.space-bar');
    return {
      rows: [...(bar?.children ?? [])].map((c) => c.className),
      name: document.querySelector('.space-name')?.textContent ?? '',
      crumbs: box('[data-space-crumbs]'),
      title: box('.space-name'),
      tabs: box('.view-tabs'),
      toolbar: box('.space-toolbar'),
      bar: box('.space-bar'),
      // Anything that filters, in the title row: there must be none.
      filtersInTitle: document.querySelectorAll(
        '.space-bar-top .space-search, .space-bar-top .space-select, .space-bar-top .space-members, .space-bar-top .bt',
      ).length,
      // Any Create in the space bar, by class or by its words: there must be none.
      createInBar: [...(bar?.querySelectorAll('button, a') ?? [])].filter(
        (el) =>
          el.classList.contains('space-create') ||
          /^\+?\s*Create( task)?$/.test(el.textContent?.trim() ?? ''),
      ).length,
    };
  });

void describe('one header on every tab', () => {
  void test('breadcrumb, title, tabs, one toolbar — the same on all eight, and no Create in it', async () => {
    const seen: { tab: string; m: Awaited<ReturnType<typeof header>> }[] = [];
    for (const tab of SPACE_TABS) {
      const h = await open(`${tab}?${Q}`, spaceStub(), {
        before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
      });
      try {
        await until(async () => (await header(h.page)).name === PROJECT.name, 20_000);
        await h.page.locator('.space-toolbar').waitFor({ timeout: 20_000 });
        // The view's own controls arrive through a portal a frame later.
        await h.page.waitForTimeout(400);
        seen.push({ tab, m: await header(h.page) });
      } finally {
        await h.close();
      }
    }

    assert.equal(seen.length, 8, 'not every tab was measured');
    const first = seen[0]?.m;
    assert.ok(first?.crumbs && first.tabs && first.toolbar, 'the board has no header to compare');
    for (const { tab, m } of seen) {
      assert.deepEqual(
        m.rows,
        ['space-bar-top', 'space-toolbar'],
        `${tab}: the header is not title+tabs, then one toolbar`,
      );
      assert.equal(m.filtersInTitle, 0, `${tab}: a filter is in the title row`);
      assert.equal(m.createInBar, 0, `${tab}: a Create in the space bar (LAI-1227)`);
      assert.ok(
        m.crumbs !== null && m.title !== null && m.crumbs.b <= m.title.y,
        `${tab}: the Spaces / breadcrumb is not above the space's name`,
      );
      assert.deepEqual(m.crumbs, first.crumbs, `${tab}: the breadcrumb moved`);
      assert.deepEqual(m.tabs, first.tabs, `${tab}: the tab row moved`);
      assert.equal(m.toolbar?.y, first.toolbar.y, `${tab}: the toolbar row moved`);
      assert.equal(m.bar?.b, first.bar?.b, `${tab}: the header is a different height`);
    }
  });

  void test('the app has one Create, in the top bar, straight after the search', async () => {
    const h = await open(`/calendar?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
    });
    try {
      await h.page.locator('.space-toolbar').waitFor({ timeout: 20_000 });
      const create = h.page.getByRole('button', { name: /^Create\b/ });
      await until(async () => (await create.count()) === 1);
      assert.equal(await create.count(), 1, 'more than one Create on the page');
      assert.equal(
        await create.evaluate((el) => el.closest('[data-app-header]') !== null),
        true,
        'the one Create is not the top bar’s',
      );
      const next = await h.page
        .locator('[data-palette-trigger="header"]')
        .evaluate((el) => el.nextElementSibling?.hasAttribute('data-header-create') === true);
      assert.equal(next, true, 'Create is not straight after the search');
    } finally {
      await h.close();
    }
  });
});

void describe('the header at 390', () => {
  const PHONE = { width: 390, height: 844 };

  void test('filters fold into one button that opens a sheet, and focus comes back', async () => {
    const h = await open(`/calendar?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize(PHONE),
    });
    try {
      const button = h.page.getByRole('button', { name: /^Filters/ });
      await button.waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.space-toolbar .space-select').count(),
        0,
        'the filters are still inline at 390',
      );
      assert.equal(
        await h.page.locator('.space-toolbar .space-search').count(),
        1,
        'search went too',
      );

      await button.click();
      const sheet = h.page.getByRole('dialog', { name: 'Filters' });
      await sheet.waitFor({ timeout: 5_000 });
      assert.equal(await sheet.getAttribute('aria-modal'), 'true');
      assert.ok((await sheet.locator('.space-select').count()) >= 3, 'the sheet lacks the filters');
      assert.equal(await button.getAttribute('aria-expanded'), 'true');

      // The same controls write the same URL: Ready only, from the sheet.
      await sheet.getByRole('button', { name: 'Ready only' }).click();
      await h.page.waitForFunction(
        () => new URL(location.href).searchParams.get('ready') === 'true',
      );
      assert.match(await button.innerText(), /1/, 'the button does not count what is set');

      await h.page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached', timeout: 5_000 });
      await until(() =>
        h.page.evaluate(
          () => document.activeElement?.hasAttribute('data-space-filters-button') ?? false,
        ),
      );
    } finally {
      await h.close();
    }
  });

  void test('the tabs scroll with an edge cue on the side that has more', async () => {
    const h = await open(`/board?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize(PHONE),
    });
    try {
      // The cue is the shared TabStrip's mask (LAI-1193), on the strip itself.
      const ul = h.page.locator('.view-tabs ul');
      await ul.waitFor({ timeout: 20_000 });
      const has = async (c: string) =>
        ((await ul.getAttribute('class')) ?? '').split(' ').includes(c);
      await until(() => has('tab-strip-fade-end'));
      const strip = await ul.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      assert.ok(strip.sw > strip.cw, 'positive control: the tabs fit, so there is nothing to cue');
      assert.equal(await has('tab-strip-fade-start'), false, 'a cue at the start, at the start');
      assert.notEqual(
        await ul.evaluate((el) => getComputedStyle(el).maskImage),
        'none',
        'the end cue is not drawn',
      );

      await ul.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await until(() => has('tab-strip-fade-start'));
      assert.equal(await has('tab-strip-fade-end'), false, 'a cue at the end, at the end');
    } finally {
      await h.close();
    }
  });

  /*
   * **~20%, not ~15%** (LAI-1227): the space's title row — name, key, live,
   * ⋯ (Agents until LAI-1233) — was drawn in the 48px app header from LAI-1188 and is the
   * page's own row now, under Jira's top bar, which names no page. That row
   * is the whole of the difference (the *Spaces /* breadcrumb is not drawn on
   * a phone); the content still starts in the top fifth.
   */
  void test('the content starts within ~20% of the screen, and nothing scrolls sideways', async () => {
    for (const tab of ['/board', '/calendar', '/sprints', '/list'] as const) {
      const h = await open(`${tab}?${Q}`, spaceStub(), {
        before: (page) => page.setViewportSize(PHONE),
      });
      try {
        await until(async () => (await header(h.page)).name === PROJECT.name, 20_000);
        await h.page.waitForTimeout(400);
        const m = await h.page.evaluate(() => ({
          bottom: document.querySelector('.space-bar')?.getBoundingClientRect().bottom ?? 9999,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          // The title row is one line: the name and Space settings share a top.
          nameTop: document.querySelector('.space-name')?.getBoundingClientRect().top ?? -1,
          menuTop:
            document.querySelector('.space-settings-link')?.getBoundingClientRect().top ?? -99,
        }));
        assert.ok(
          m.bottom <= PHONE.height * 0.2,
          `${tab}: the header ends at ${String(Math.round(m.bottom))}px of ${String(PHONE.height)} (${String(Math.round((m.bottom / PHONE.height) * 100))}%)`,
        );
        assert.equal(m.overflow, 0, `${tab}: the page scrolls sideways`);
        assert.ok(Math.abs(m.nameTop - m.menuTop) < 20, `${tab}: the title row wrapped`);
      } finally {
        await h.close();
      }
    }
  });
});

void describe('the board toolbar', () => {
  void test('every button in the toolbar has a name; the board actions are separate named buttons, no ⋯', async () => {
    const h = await open(`/board?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
    });
    try {
      const actions = h.page.locator('.board-bar .bt-actions');
      await actions.waitFor({ timeout: 20_000 });

      const unnamed = await h.page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.space-bar button')]
          .filter((b) => (b.getAttribute('aria-label') ?? b.innerText).trim() === '')
          .map((b) => b.outerHTML.slice(0, 80)),
      );
      assert.deepEqual(unnamed, [], 'a button in the header has no accessible name');

      // LAI-1230: the ⋯ that LAI-1198 folded them into is gone, dot and all.
      assert.equal(await h.page.locator('[data-board-more]').count(), 0, 'the ⋯ is still drawn');
      assert.equal(await h.page.locator('.bt-more-dot').count(), 0, 'the ⋯ dot is still drawn');
      assert.equal(await h.page.getByRole('menu', { name: 'More board actions' }).count(), 0);

      // Each its own button, in the order they had before the fold, each with
      // the shared Tooltip rather than a native title.
      const names = await actions
        .locator('button')
        .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label') ?? ''));
      assert.deepEqual(
        names.filter((n) => !n.startsWith('Hidden columns')),
        ['Insights', 'View settings', 'Refresh'],
        `the actions are not the original set and order: ${names.join(', ')}`,
      );
      const untipped = await actions
        .locator('button')
        .evaluateAll((buttons) =>
          buttons
            .filter(
              (b) =>
                b.hasAttribute('title') ||
                document
                  .getElementById(b.getAttribute('aria-describedby') ?? '')
                  ?.getAttribute('role') !== 'tooltip',
            )
            .map((b) => b.getAttribute('aria-label')),
        );
      assert.deepEqual(untipped, [], 'an action has no shared Tooltip');

      // Reached by keyboard, and does what it says: View settings opens its panel.
      const settings = actions.getByRole('button', { name: 'View settings' });
      assert.equal(await settings.getAttribute('aria-expanded'), 'false');
      await settings.focus();
      await h.page.keyboard.press('Enter');
      const panel = h.page.getByRole('dialog', { name: 'View settings' });
      await panel.waitFor({ timeout: 5_000 });
      assert.equal(await settings.getAttribute('aria-expanded'), 'true');

      // **It floats** (LAI-1230): the panel's shadow is the popover elevation
      // token, resolved — not a card's hairline, not none.
      const shadow = await h.page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.boxShadow = 'var(--shadow-popover)';
        document.body.append(probe);
        const token = getComputedStyle(probe).boxShadow;
        probe.remove();
        const el = document.querySelector('.view-settings');
        return { token, panel: el === null ? '' : getComputedStyle(el).boxShadow };
      });
      assert.notEqual(shadow.token, 'none', 'the token resolved to nothing');
      assert.equal(shadow.panel, shadow.token, 'View settings does not use --shadow-popover');
    } finally {
      await h.close();
    }
  });
});

void describe('the board says which sprint it shows', () => {
  const inSprint = TASKS.filter((t) => t.sprint_id === 's2').length;

  void test('it opens on the active sprint, says "S2 · … · 5 of 12 tasks", and Show all sprints is one click', async () => {
    const h = await open(`/board?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
    });
    try {
      const scope = h.page.locator('[data-sprint-scope]');
      const words = `${String(inSprint)} of ${String(TASKS.length)} tasks`;
      await until(
        async () => (await scope.count()) === 1 && (await scope.innerText()).includes(words),
        20_000,
      );
      const text = (await scope.innerText()).replace(/\s+/g, ' ');
      assert.match(text, /S2/, 'the scope does not name the sprint’s key');
      assert.match(text, /Sprint 14 — Receipts/, 'the scope does not name the sprint');
      assert.ok(text.includes(words), `the scope does not count: ${text}`);
      assert.equal(new URL(h.page.url()).searchParams.get('sprint'), 's2', 'the default changed');

      await scope.getByRole('button', { name: 'Show all sprints' }).click();
      await h.page.waitForFunction(
        () => new URL(location.href).searchParams.get('sprint') === 'all',
      );
      await scope.waitFor({ state: 'detached', timeout: 5_000 });
      // Every task now, not the sprint's five.
      await until(async () => (await h.page.locator('article.card').count()) > inSprint, 10_000);
      assert.ok((await h.page.locator('article.card').count()) > inSprint, 'still only the sprint');
    } finally {
      await h.close();
    }
  });

  void test('the sprint badge is a different shape from the size chip beside it', async () => {
    const h = await open(`/board?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
    });
    try {
      await h.page.locator('.card-sprint').first().waitFor({ timeout: 20_000 });
      const m = await h.page.evaluate(() => {
        const card = [...document.querySelectorAll('article.card')].find(
          (c) => c.querySelector('.card-sprint') !== null && c.querySelector('.size-chip') !== null,
        );
        const sprint = card?.querySelector('.card-sprint');
        const size = card?.querySelector('.size-chip');
        if (sprint === undefined || sprint === null || size === undefined || size === null)
          return null;
        const r = (el: Element) => parseFloat(getComputedStyle(el).borderTopLeftRadius);
        return {
          sprintRadius: r(sprint),
          sizeRadius: r(size),
          sprintHeight: sprint.getBoundingClientRect().height,
          mark: sprint.querySelector('svg') !== null,
        };
      });
      assert.ok(m !== null, 'no card carries both a sprint and a size — this proves nothing');
      assert.ok(
        m.sprintRadius >= m.sprintHeight / 2 - 1,
        `the sprint badge is not a pill (radius ${String(m.sprintRadius)}, height ${String(m.sprintHeight)})`,
      );
      assert.ok(m.sizeRadius < m.sprintRadius, 'the size chip is as round as the sprint badge');
      assert.equal(m.mark, true, 'the sprint badge has no mark of its own');
      // Its words are the shared tooltip's now (LAI-1213), not a bare title.
      assert.match(
        await tipText(h.page.locator('article.card .card-sprint').first()),
        /^Sprint S\d/,
        'the badge does not say it is a sprint',
      );
    } finally {
      await h.close();
    }
  });
});
