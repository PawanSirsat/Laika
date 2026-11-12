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
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, until } from './harness.ts';
import { PROJECT, SPACE_TABS, TASKS, spaceStub } from './space-header-fixture.ts';

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
      create: box('.space-create'),
      tabs: box('.view-tabs'),
      toolbar: box('.space-toolbar'),
      bar: box('.space-bar'),
      // Anything that filters, in the title row: there must be none.
      filtersInTitle: document.querySelectorAll(
        '.space-bar-top .space-search, .space-bar-top .space-select, .space-bar-top .space-members, .space-bar-top .bt',
      ).length,
      createInToolbar: document.querySelectorAll('.space-toolbar > .space-create').length,
    };
  });

void describe('one header on every tab', () => {
  void test('title, tabs, one toolbar — and Create in the same place on all eight', async () => {
    const seen: { tab: string; m: Awaited<ReturnType<typeof header>> }[] = [];
    for (const tab of SPACE_TABS) {
      const h = await open(`${tab}?${Q}`, spaceStub(), {
        before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
      });
      try {
        await until(async () => (await header(h.page)).name === PROJECT.name, 20_000);
        await h.page.locator('.space-create').waitFor({ timeout: 20_000 });
        // The view's own controls arrive through a portal a frame later.
        await h.page.waitForTimeout(400);
        seen.push({ tab, m: await header(h.page) });
      } finally {
        await h.close();
      }
    }

    assert.equal(seen.length, 8, 'not every tab was measured');
    const first = seen[0]?.m;
    assert.ok(first?.create && first.tabs && first.toolbar, 'the board has no header to compare');
    for (const { tab, m } of seen) {
      assert.deepEqual(
        m.rows,
        ['space-bar-top', 'space-toolbar'],
        `${tab}: the header is not title+tabs, then one toolbar`,
      );
      assert.equal(m.filtersInTitle, 0, `${tab}: a filter is in the title row`);
      assert.equal(m.createInToolbar, 1, `${tab}: Create is not in the toolbar row`);
      assert.deepEqual(
        m.create,
        first.create,
        `${tab}: Create moved (board: ${JSON.stringify(first.create)})`,
      );
      assert.deepEqual(m.tabs, first.tabs, `${tab}: the tab row moved`);
      assert.equal(m.toolbar?.y, first.toolbar.y, `${tab}: the toolbar row moved`);
      assert.equal(m.bar?.b, first.bar?.b, `${tab}: the header is a different height`);
    }
  });

  void test('Create is the toolbar’s last control and ends where the content ends', async () => {
    const h = await open(`/calendar?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
    });
    try {
      await h.page.locator('.space-create').waitFor({ timeout: 20_000 });
      const m = await h.page.evaluate(() => {
        const bar = document.querySelector('.space-toolbar');
        const kids = [...(bar?.children ?? [])].filter((c) => c.getClientRects().length > 0);
        return {
          last: kids.at(-1)?.className ?? '',
          createRight: Math.round(
            document.querySelector('.space-create')?.getBoundingClientRect().right ?? 0,
          ),
          toolbarRight: Math.round(bar?.getBoundingClientRect().right ?? -1),
        };
      });
      assert.equal(m.last, 'space-create', 'something sits after Create');
      assert.equal(m.createRight, m.toolbarRight, 'Create does not end the row');
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
      const nav = h.page.locator('.view-tabs');
      await nav.waitFor({ timeout: 20_000 });
      await until(async () => (await nav.getAttribute('data-more-after')) !== null);
      const strip = await h.page.evaluate(() => {
        const ul = document.querySelector('.view-tabs ul');
        return { sw: ul?.scrollWidth ?? 0, cw: ul?.clientWidth ?? 0 };
      });
      assert.ok(strip.sw > strip.cw, 'positive control: the tabs fit, so there is nothing to cue');
      assert.equal(
        await nav.getAttribute('data-more-before'),
        null,
        'a cue at the start, at the start',
      );
      const fade = () =>
        h.page.evaluate(
          () => getComputedStyle(document.querySelector('.view-tabs')!, '::after').opacity,
        );
      // A 120ms fade in; wait it out rather than read it mid-way.
      await until(async () => (await fade()) === '1').catch(() => undefined);
      assert.equal(await fade(), '1', 'the end cue is not drawn');

      await h.page.evaluate(() => {
        const ul = document.querySelector('.view-tabs ul')!;
        ul.scrollLeft = ul.scrollWidth;
      });
      await until(async () => (await nav.getAttribute('data-more-before')) !== null);
      assert.equal(await nav.getAttribute('data-more-after'), null, 'a cue at the end, at the end');
    } finally {
      await h.close();
    }
  });

  void test('the content starts within ~15% of the screen, and nothing scrolls sideways', async () => {
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
          // The title row is one line: the name and the space menu share a top.
          nameTop: document.querySelector('.space-name')?.getBoundingClientRect().top ?? -1,
          menuTop:
            document.querySelector('.space-menu-trigger')?.getBoundingClientRect().top ?? -99,
        }));
        assert.ok(
          m.bottom <= PHONE.height * 0.155,
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
  void test('every button in the toolbar has a name; the ⋯ menu is labelled and keyboard-driven', async () => {
    const h = await open(`/board?${Q}`, spaceStub(), {
      before: (page) => page.setViewportSize({ width: 1440, height: 900 }),
    });
    try {
      const more = h.page.locator('.board-bar [data-board-more]');
      await more.waitFor({ timeout: 20_000 });

      const unnamed = await h.page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.space-bar button')]
          .filter((b) => (b.getAttribute('aria-label') ?? b.innerText).trim() === '')
          .map((b) => b.outerHTML.slice(0, 80)),
      );
      assert.deepEqual(unnamed, [], 'a button in the header has no accessible name');

      // Four bare icons left the row for the menu.
      for (const gone of ['Insights', 'View settings', 'Refresh the board']) {
        assert.equal(
          await h.page.locator(`.board-bar button[title="${gone}"]`).count(),
          0,
          `${gone} is still an icon in the row`,
        );
      }

      await more.focus();
      await h.page.keyboard.press('Enter');
      const menu = h.page.getByRole('menu', { name: 'More board actions' });
      await menu.waitFor({ timeout: 5_000 });
      assert.equal(await more.getAttribute('aria-expanded'), 'true');
      const labels = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
      for (const label of ['View settings', 'Insights', 'Refresh']) {
        assert.ok(
          labels.includes(label),
          `"${label}" is not a labelled item: ${labels.join(', ')}`,
        );
      }

      const active = () =>
        h.page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '',
        );
      await until(async () => (await active()) === labels[0]);
      assert.equal(await active(), labels[0], 'focus did not land on the first item');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await active(), labels[1], 'ArrowDown did not move to the next item');
      await h.page.keyboard.press('End');
      assert.equal(await active(), labels.at(-1), 'End did not reach the last item');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await active(), labels[0], 'ArrowDown did not wrap to the first');
      await h.page.keyboard.press('ArrowUp');
      assert.equal(await active(), labels.at(-1), 'ArrowUp did not wrap to the last');
      await h.page.keyboard.press('Home');
      assert.equal(await active(), labels[0], 'Home did not reach the first item');

      await h.page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached', timeout: 5_000 });
      await until(() =>
        h.page.evaluate(() => document.activeElement?.hasAttribute('data-board-more') ?? false),
      );
      assert.equal(await more.getAttribute('aria-expanded'), 'false');

      // And an item does what it says: View settings opens its panel.
      await more.click();
      await menu.getByRole('menuitem', { name: 'View settings' }).click();
      await h.page.getByRole('dialog', { name: 'View settings' }).waitFor({ timeout: 5_000 });
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
          title: sprint.getAttribute('title') ?? '',
        };
      });
      assert.ok(m !== null, 'no card carries both a sprint and a size — this proves nothing');
      assert.ok(
        m.sprintRadius >= m.sprintHeight / 2 - 1,
        `the sprint badge is not a pill (radius ${String(m.sprintRadius)}, height ${String(m.sprintHeight)})`,
      );
      assert.ok(m.sizeRadius < m.sprintRadius, 'the size chip is as round as the sprint badge');
      assert.equal(m.mark, true, 'the sprint badge has no mark of its own');
      assert.match(m.title, /^Sprint S\d/, 'the badge does not say it is a sprint');
    } finally {
      await h.close();
    }
  });
});
