/**
 * The spaces sidebar and the view tabs (LAI-248).
 *
 * The live design replaces WORK/REVIEW with **SPACES** — your three most-recent
 * projects, then *More spaces* — and ties every view to the space you are in.
 * The views became a tab bar.
 *
 * What only a browser can show:
 *
 * - **the spaces are real projects**, with the project's own `prefix` as the key
 *   and counts from `task_counts` / `member_count` — not a fixture;
 * - **the fetch is gated on the session**, so `/login` does not 401 on every
 *   page load;
 * - **the tab bar carries `?project=`**, which is what makes it honest.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, until, type ApiStub, type StubCall } from './harness.ts';

/**
 * `id` is a **ULID** in the real server — monotonic, so sorting by it is
 * creation order, which is how the rail orders spaces (LAI-271). The fixture
 * used to set `id: slug`, which sorts alphabetically and quietly made the two
 * orders look the same.
 */
const project = (
  id: string,
  slug: string,
  name: string,
  prefix: string,
  tasks: number,
  members: number,
) => ({
  id,
  slug,
  prefix,
  name,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: tasks, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: members,
  members: [],
  last_activity_at: 2,
});

// Created in this order, so the rail draws them in it.
const CORE = project('01AAA', 'laika-core', 'Laika Core', 'LC', 5, 5);
const WEB = project('01BBB', 'laika-web', 'Laika Web', 'LW', 3, 1);
const INFRA = project('01CCC', 'laika-infra', 'Laika Infra', 'LI', 14, 2);
const DOCS = project('01DDD', 'laika-docs', 'Laika Docs', 'LD', 9, 2);

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [CORE, WEB, INFRA, DOCS], next_cursor: null },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  // A name the design does not use, so "came from the API" is provable.
  '/api/v1/org': {
    id: 'org1',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the SPACES section', () => {
  void test('lists real projects, keyed by their own prefix', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      // Wait for the rows it asserts, not the first one (LAI-715).
      await until(
        async () =>
          (await h.page.locator('.space-row .sidebar-label').allInnerTexts()).join('|') ===
          ['Laika Core', 'Laika Web', 'Laika Infra'].join('|'),
      );
      await until(() =>
        h.page.locator('.sidebar-link-button', { hasText: 'More spaces' }).isVisible(),
      );

      const names = await h.page.locator('.space-row .sidebar-label').allInnerTexts();
      // Three spaces plus the More spaces row — the design's number. **Drawn
      // by name since LAI-260**, so the list never moves under the pointer.
      // Display names, not slugs, since the owner's 2026-09-21 call.
      // `.space-row` is a *space*; the More-spaces row opens a popover and is
      // deliberately not one.
      assert.deepEqual(
        names,
        ['Laika Core', 'Laika Web', 'Laika Infra'],
        `saw ${names.join(', ')}`,
      );
      assert.ok(
        await h.page.locator('.sidebar-link-button', { hasText: 'More spaces' }).isVisible(),
        'the More spaces row is missing',
      );

      // **A row is a coloured letter and a name** (LAI-796; a dot from
      // LAI-262): no counts, no member figure, no two-letter key.
      const first = h.page.locator('.space-row').first();
      const row = (await first.innerText()).replace(/\s+/g, ' ').trim();
      assert.equal(row, 'L Laika Core', `the row carries more than its letter and name: ${row}`);
      const badge = first.locator('.space-badge');
      assert.equal(await badge.innerText(), 'L');
      assert.equal(await badge.getAttribute('aria-hidden'), 'true', 'the letter is read aloud');
      // A colour of its own, from the palette — not the card's ground.
      const [ground, card] = await Promise.all([
        badge.evaluate((el: Element) => getComputedStyle(el).backgroundColor),
        first.evaluate((el: Element) => getComputedStyle(el.closest('#sidebar')!).backgroundColor),
      ]);
      assert.notEqual(ground, card, 'the letter has no colour of its own');

      const sidebar = await h.page.locator('#sidebar').innerText();
      // The section head, uppercase as the owner's reference draws it.
      assert.match(sidebar, /spaces/i);
      // **Real counts, not a fixture**: `34 tasks · 4 members` is the design's
      // sample, and ours must come from the project payload.
      // The counts belong to the More-spaces popover, which is where the
      // design puts them — asserted there, and asserted absent here.
      assert.doesNotMatch(sidebar, /tasks · /, 'the rail is carrying the popover’s meta');
      assert.doesNotMatch(sidebar, /34 tasks/, "the design's fixture leaked into the app");
    } finally {
      await h.close();
    }
  });

  void test('the current space is the active row, and only it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      const active = h.page.locator('.sidebar-link-active');
      await until(async () => (await active.count()) === 1);
      assert.equal(await active.count(), 1, 'more than one row is marked current');
      assert.match(await active.innerText(), /Laika Core/);
    } finally {
      await h.close();
    }
  });

  /**
   * The old sidebar listed the views. If any of them is still there, the
   * restructure did not happen — it just gained a section.
   */
  void test('the sidebar no longer lists the views', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      const sidebar = await h.page.locator('#sidebar').innerText();
      for (const group of ['WORK', 'REVIEW']) {
        assert.doesNotMatch(sidebar, new RegExp(group), `${group} is still a sidebar group`);
      }
      // Positive control: the sidebar rendered its other sections, so the
      // absences above cannot be a blank rail.
      assert.match(sidebar, /organisation/i, 'the sidebar did not render at all');
      /*
       * **Since LAI-796** the reader's own places lead the rail and the
       * organisation's pages follow the spaces — the owner's reference.
       */
      const home = h.page.locator('.sidebar-group-home');
      const org = h.page.locator('.sidebar-group', { has: h.page.locator('#nav-ORG') });
      const trimmed = async (group: typeof home) =>
        (await group.locator('.sidebar-link-label').allInnerTexts()).map((t) => t.trim());
      await until(async () => (await trimmed(home)).join('|') === 'My day|Inbox');
      await until(
        async () => (await trimmed(org)).join('|') === 'Insights|Organisation|Developer access',
      );
      assert.deepEqual(
        (await home.locator('.sidebar-link-label').allInnerTexts()).map((t) => t.trim()),
        ['My day', 'Inbox'],
      );
      assert.deepEqual(
        (await org.locator('.sidebar-link-label').allInnerTexts()).map((t) => t.trim()),
        ['Insights', 'Organisation', 'Developer access'],
      );
      const homeBottom = await home.evaluate((el: Element) => el.getBoundingClientRect().bottom);
      const rows = h.page.locator('.space-row');
      const spacesTop = (await rows.first().boundingBox())?.y ?? -Infinity;
      const spacesBottom = await rows
        .last()
        .evaluate((el: Element) => el.getBoundingClientRect().bottom);
      const orgTop = (await org.boundingBox())?.y ?? -Infinity;
      assert.ok(homeBottom <= spacesTop, 'My day and Inbox are not above the spaces');
      assert.ok(orgTop >= spacesBottom, 'Organisation is not below the spaces');
      // Nothing else is a top-level entry: the six pages LAI-796 folded away.
      for (const gone of ['Capacity', 'Review', 'Usage', 'Unlisted work', 'Connect', 'Tokens']) {
        assert.equal(
          await h.page
            .locator('#sidebar .sidebar-link-label', { hasText: new RegExp(`^${gone}$`) })
            .count(),
          0,
          `${gone} is still a sidebar entry`,
        );
      }
      // …and the theme is the user menu's, not a row of its own.
      assert.equal(await h.page.locator('#sidebar .theme-switch').count(), 0);
      // Once — the tab strip no longer offers it as well.
      assert.equal(
        await h.page.locator('.view-tab', { hasText: 'Capacity' }).count(),
        0,
        'Capacity is offered twice',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the rail ends in the person (LAI-796)', () => {
  void test('the user block sits at the foot, below every entry', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      await h.page.setViewportSize({ width: 1280, height: 900 });
      const m = await h.page.evaluate(() => {
        const rail = document.querySelector('#sidebar');
        const footer = document.querySelector('.sidebar-footer');
        const links = [...document.querySelectorAll('#sidebar .sidebar-nav .sidebar-link')];
        if (rail === null || footer === null || links.length === 0) return null;
        return {
          railBottom: rail.getBoundingClientRect().bottom,
          footerBottom: footer.getBoundingClientRect().bottom,
          footerTop: footer.getBoundingClientRect().top,
          lastLink: Math.max(...links.map((l) => l.getBoundingClientRect().bottom)),
        };
      });
      assert.ok(m !== null, 'no footer to measure');
      assert.ok(Math.abs(m.railBottom - m.footerBottom) <= 1, 'the person is not at the foot');
      assert.ok(m.footerTop >= m.lastLink, 'the person overlaps the entries');
    } finally {
      await h.close();
    }
  });
});

void describe('the view tabs', () => {
  void test('are the project-scoped views, and every one carries the project', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.view-tab').first().waitFor({ timeout: 20_000 });
      const tabNames = async () =>
        (await h.page.locator('.view-tab').allInnerTexts()).map((s) => s.split('\n')[0]);
      await until(
        async () =>
          (await tabNames()).join('|') ===
          'Board|List|Timeline|Calendar|Sprints|Dashboard|Activity|Meeting review',
      );

      const labels = (await h.page.locator('.view-tab').allInnerTexts()).map(
        (s) => s.split('\n')[0],
      );
      assert.deepEqual(labels, [
        'Board',
        'List',
        'Timeline',
        'Calendar',
        'Sprints',
        'Dashboard',
        'Activity',
        'Meeting review',
      ]);

      /*
       * **The project travels with every tab** (LAI-279). A bare path drops
       * `?project=` and the destination falls back to a different project
       * (LAI-423). Capacity is not a tab since LAI-754.
       */
      const hrefs = await h.page
        .locator('.view-tab')
        .evaluateAll((els: Element[]) => els.map((e) => e.getAttribute('href') ?? ''));
      for (const href of hrefs) {
        assert.match(href, /project=laika-core/, `a tab drops the project: ${href}`);
      }
      // Or the filter above could hide every tab and the loop prove nothing.
      assert.ok(hrefs.length >= 5, `only ${String(hrefs.length)} tabs rendered`);
    } finally {
      await h.close();
    }
  });

  /**
   * **Insights is a sidebar entry, not a tab** (owner, 2026-10-15, LAI-754 for
   * Capacity; LAI-796 for the page that holds it).
   *
   * From a space, its link is bare `/insights` — one page for every space —
   * and the page it opens has no space bar and no space tabs.
   */
  void test('Insights opens from the sidebar as one page, without the space frame', async () => {
    const h = await open('/board?project=laika-core', {
      ...STUB,
      '/api/v1/capacity': { enabled: true, people: [] },
      '/api/v1/presence': { enabled: true, present: [] },
    });
    try {
      const link = h.page.locator('#sidebar .sidebar-link', { hasText: 'Insights' });
      await link.waitFor({ timeout: 20_000 });
      assert.equal(await link.getAttribute('href'), '/insights');

      await link.click();
      await h.page.waitForURL((url) => url.pathname === '/insights' && url.search === '', {
        timeout: 10_000,
      });
      await h.page.locator('.screen-page-title', { hasText: 'Insights' }).waitFor({
        timeout: 10_000,
      });
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Capacity/);
      assert.equal(await h.page.locator('.view-tab').count(), 0, 'the space tabs are still drawn');
      assert.equal(await h.page.locator('.space-name').count(), 0, 'the space bar is still drawn');
      assert.equal(
        (await h.page.locator('#sidebar .sidebar-link-active').innerText()).trim(),
        'Insights',
        'the rail does not mark Insights as the current page',
      );
    } finally {
      await h.close();
    }
  });

  void test('the tabs come in two groups, a hairline between (LAI-796)', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.view-tab').first().waitFor({ timeout: 20_000 });
      const tabOrder = () =>
        h.page
          .locator('.view-tabs li')
          .evaluateAll((items: Element[]) =>
            items.map((li) =>
              li.classList.contains('view-tab-rule') ? '|' : (li.textContent ?? '').trim(),
            ),
          );
      await until(
        async () =>
          (await tabOrder()).join(',') ===
          'Board,List,Timeline,Calendar,|,Sprints,Dashboard,Activity,Meeting review',
      );
      const order = await tabOrder();
      assert.deepEqual(order, [
        'Board',
        'List',
        'Timeline',
        'Calendar',
        '|',
        'Sprints',
        'Dashboard',
        'Activity',
        'Meeting review',
      ]);
      // A hairline, not a tab: a screen reader counts eight.
      assert.equal(await h.page.locator('.view-tab-rule').getAttribute('role'), 'presentation');
    } finally {
      await h.close();
    }
  });
});

/**
 * The same instance with laika-web's screens answerable, for tests that go
 * there — and with an **adversarial server order**: `INFRA` before `WEB`, so
 * the fill order and the remembered order disagree. That disagreement is the
 * only thing that can tell "read back from storage" apart from "current
 * project first, then whatever the server sent" — with the server's own order
 * the two answers coincide.
 */
const WEB_STUB: ApiStub = {
  ...STUB,
  '/api/v1/projects': { data: [CORE, INFRA, WEB, DOCS], next_cursor: null },
  '/api/v1/projects/laika-web': WEB,
  '/api/v1/projects/laika-web/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-web/members': { members: [] },
  '/api/v1/projects/laika-web/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-web/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-web/tags': { tags: [] },
};

void describe('a space row is active for any view of it', () => {
  /**
   * The design's `projectScreens` test lights the space row for the board,
   * timeline, sprints, dashboard and meeting review alike. Asserted on a
   * non-board view, because the board is the one place a slug-equality bug
   * could not show.
   */
  void test('the row is current on /sprints, not only on the board', async () => {
    const h = await open('/sprints?project=laika-core', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      const active = h.page.locator('.sidebar-link-active');
      await until(async () => (await active.count()) === 1);
      assert.equal(await active.count(), 1, 'exactly one row must be current');
      assert.match(await active.innerText(), /Laika Core/);
    } finally {
      await h.close();
    }
  });
});

void describe('the list does not move under the pointer (LAI-260)', () => {
  /**
   * The owner's report, with screenshots: clicking a space sent it to the top
   * and every other row shifted. **The row you want is then never where you
   * last saw it**, and the next click lands on whatever slid into its place.
   */
  void test('clicking a space leaves every row exactly where it was', async () => {
    const h = await open('/board?project=laika-core', WEB_STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      // The baseline is all three rows, not however many are drawn yet (LAI-715).
      await until(async () => (await h.page.locator('.space-row .sidebar-label').count()) === 3);
      const before = await h.page.locator('.space-row .sidebar-label').allInnerTexts();

      // Click a space that is *not* the current one — the case that reordered.
      await h.page.locator('.sidebar-link', { hasText: 'Laika Web' }).click();
      await h.page.waitForURL(/project=laika-web/, { timeout: 10_000 });
      await h.page.waitForTimeout(400);

      const after = await h.page.locator('.space-row .sidebar-label').allInnerTexts();
      assert.deepEqual(after, before, `the rows moved: ${before.join(',')} -> ${after.join(',')}`);

      // And again, to a third space.
      await h.page.locator('.sidebar-link', { hasText: 'Laika Infra' }).click();
      await h.page.waitForURL(/project=laika-infra/, { timeout: 10_000 });
      await h.page.waitForTimeout(400);
      assert.deepEqual(await h.page.locator('.space-row .sidebar-label').allInnerTexts(), before);
    } finally {
      await h.close();
    }
  });
});

void describe('what was opened survives a reload', () => {
  /**
   * Opening spaces writes what is remembered; a fresh load must read it back.
   *
   * **Membership is the observable, not sequence** (LAI-260). The rows are
   * drawn by name now, so an order assertion could no longer tell storage from
   * the fill-up loop. With **four** projects and three slots it still can:
   * opening Web and Infra must leave `laika-docs` off the list after a reload,
   * and losing storage would fill from the server's own order and put it back.
   */
  void test('what was opened is remembered across a reload', async () => {
    const h = await open('/board?project=laika-core', WEB_STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });

      for (const [name, slug] of [
        ['Laika Web', 'laika-web'],
        ['Laika Infra', 'laika-infra'],
      ] as const) {
        await h.page.locator('.sidebar-link', { hasText: name }).click();
        await h.page.waitForURL(new RegExp(`project=${slug}`), { timeout: 10_000 });
      }

      await h.page.reload();
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      await until(
        async () =>
          (await h.page.locator('.space-row .sidebar-label').allInnerTexts()).join('|') ===
          ['Laika Core', 'Laika Web', 'Laika Infra'].join('|'),
      );

      const keys = await h.page.locator('.space-row .sidebar-label').allInnerTexts();
      assert.deepEqual(
        keys,
        ['Laika Core', 'Laika Web', 'Laika Infra'],
        `storage lost what was opened: ${keys.join(', ')}`,
      );
      assert.ok(!keys.includes('Laika Docs'), 'a space nobody opened is on the list');
    } finally {
      await h.close();
    }
  });
});

void describe('the new chrome fits', () => {
  /**
   * Both themes at 1440 / 1280 / 420, page overflow 0 at each — the LAI-244
   * lesson is that one width proves nothing and a floor alone is half an
   * assertion. The theme is set through the app's own storage key so the dark
   * half exercises `initTheme`, and two checks prove the setup ran — a setup
   * step with no assertion cannot fail at all. Light asserts the `data-theme`
   * attribute (dark is the bare `:root` since LAI-606, so its absence alone
   * proves nothing), and the canvas paint must differ between the two loops,
   * which no broken init can satisfy.
   */
  void test('no page overflow with the spaces sidebar and the tab bar', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.view-tab').first().waitFor({ timeout: 20_000 });
      const canvases: Partial<Record<'light' | 'dark', string>> = {};
      for (const theme of ['light', 'dark'] as const) {
        await h.page.evaluate((t: string) => {
          localStorage.setItem('laika.theme', t);
        }, theme);
        await h.page.reload();
        await h.page.locator('.view-tab').first().waitFor({ timeout: 20_000 });
        const state = await h.page.evaluate(() => ({
          attr: document.documentElement.getAttribute('data-theme'),
          canvas: getComputedStyle(document.body).backgroundColor,
        }));
        assert.equal(
          state.attr,
          theme === 'light' ? 'light' : null,
          `the ${theme} theme did not apply`,
        );
        canvases[theme] = state.canvas;

        for (const width of [1440, 1280, 420]) {
          await h.page.setViewportSize({ width, height: 1000 });
          await h.page.waitForFunction(
            (w: number) => document.documentElement.clientWidth === w,
            width,
            { timeout: 5000 },
          );
          const spill = () =>
            h.page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
          // The width lands before the reflow does (LAI-715).
          await until(async () => (await spill()) === 0);
          const overflow = await spill();
          assert.equal(
            overflow,
            0,
            `${theme} at ${String(width)}px overflows the page by ${String(overflow)}px`,
          );
        }
      }
      assert.notEqual(
        canvases.light,
        canvases.dark,
        'the two themes painted the same canvas — initTheme never ran',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the prototype geometry (LAI-249)', () => {
  void test('the toggle collapses the sidebar to a 60px icon rail and back, remembered', async () => {
    const h = await open('/board?project=laika-core', {
      ...STUB,
      // Two waiting for review: the Inbox count the rail must keep.
      '/api/v1/review': { tasks: [{}, {}], truncated: false },
    });
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      const width = async () =>
        h.page.evaluate(() => {
          const el = document.querySelector('#sidebar');
          return el === null ? 0 : Math.round(el.getBoundingClientRect().width);
        });
      const settle = (px: number) =>
        h.page.waitForFunction(
          (want: number) => {
            const el = document.querySelector('#sidebar');
            return el !== null && Math.round(el.getBoundingClientRect().width) === want;
          },
          px,
          { timeout: 5000 },
        );

      await until(async () => (await width()) === 212);
      assert.equal(await width(), 212, 'the open sidebar is 212px');
      const toggle = h.page.locator('.sidebar-toggle');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await toggle.click();
      await settle(60);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');

      // Icons stay, names give way to tooltips, counts stay on the icon.
      const inbox = h.page.locator('#sidebar .sidebar-link', { hasText: 'Inbox' });
      assert.ok(await inbox.locator('.nav-icon').isVisible(), 'the icon went with the label');
      const opacity = (el: Element) => getComputedStyle(el).opacity;
      assert.equal(await inbox.locator('.sidebar-tip').evaluate(opacity), '0');
      assert.match(await inbox.locator('.sidebar-count').innerText(), /^2/);
      assert.equal(await h.page.locator('.space-row .space-badge').first().innerText(), 'L');
      // The name is still the link's — what a screen reader reads.
      assert.match(await inbox.innerText(), /Inbox/);

      // A tooltip on hover…
      await inbox.hover();
      await h.page.waitForFunction(
        () =>
          getComputedStyle(
            [...document.querySelectorAll('#sidebar .sidebar-link')]
              .find((a) => a.textContent?.includes('Inbox'))
              ?.querySelector('.sidebar-tip') ?? document.body,
          ).opacity === '1',
        undefined,
        { timeout: 5000 },
      );
      // …and on keyboard focus: the toggle, then Tab, is My day.
      await h.page.mouse.move(900, 500);
      await toggle.focus();
      await h.page.keyboard.press('Tab');
      const focused = await h.page.evaluate(() => document.activeElement?.textContent ?? '');
      assert.match(focused, /My day/, 'Tab from the toggle does not reach the first entry');
      await h.page.waitForFunction(
        () => {
          const tip = document.activeElement?.querySelector('.sidebar-tip');
          return tip !== null && tip !== undefined && getComputedStyle(tip).opacity === '1';
        },
        undefined,
        { timeout: 5000 },
      );

      // Remembered per browser: a reload keeps the rail.
      assert.equal(await h.page.evaluate(() => localStorage.getItem('laika.sidebar')), 'collapsed');
      await h.page.reload();
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      await settle(60);

      await h.page.locator('.sidebar-toggle').click();
      await settle(212);
      assert.equal(await h.page.evaluate(() => localStorage.getItem('laika.sidebar')), 'expanded');
    } finally {
      await h.close();
    }
  });

  void test('a narrow window collapses it by itself; the toggle opens it for now only', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      const settle = (px: number) =>
        h.page.waitForFunction(
          (want: number) => {
            const el = document.querySelector('#sidebar');
            return el !== null && Math.round(el.getBoundingClientRect().width) === want;
          },
          px,
          { timeout: 5000 },
        );
      await h.page.setViewportSize({ width: 1100, height: 800 });
      await settle(60);
      await h.page.locator('.sidebar-toggle').click();
      await settle(212);
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.sidebar')),
        null,
        'peeking on a narrow window changed what a wide one remembers',
      );
      await h.page.setViewportSize({ width: 1300, height: 800 });
      await settle(212);
    } finally {
      await h.close();
    }
  });

  void test('on a phone the sidebar is the whole menu, off-canvas, with no rail toggle', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.locator('.shell-navtoggle').click();
      await h.page.locator('.sidebar-open').waitFor({ timeout: 5000 });
      assert.equal(await h.page.locator('.sidebar-toggle').isVisible(), false);
      const label = h.page.locator('#sidebar .sidebar-link-label', { hasText: 'Inbox' });
      const opacityOf = () => label.evaluate((el: Element) => getComputedStyle(el).opacity);
      await until(async () => (await label.isVisible()) && (await opacityOf()) === '1');
      assert.ok(await label.isVisible());
      assert.equal(await label.evaluate((el: Element) => getComputedStyle(el).opacity), '1');
    } finally {
      await h.close();
    }
  });

  void test('the Spaces section head collapses its rows and says so', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const head = h.page.locator('.spaces-head-toggle');
      await head.waitFor({ timeout: 20_000 });
      assert.equal(await head.getAttribute('aria-expanded'), 'true');
      await until(async () => (await h.page.locator('.space-row').count()) >= 3);
      assert.ok((await h.page.locator('.space-row').count()) >= 3);

      await head.click();
      assert.equal(await head.getAttribute('aria-expanded'), 'false');
      assert.equal(
        await h.page.locator('.space-row').count(),
        0,
        'collapsing the section must take its rows with it',
      );

      await head.click();
      assert.equal(await head.getAttribute('aria-expanded'), 'true');
      assert.ok((await h.page.locator('.space-row').count()) >= 3, 'and bring them back');
    } finally {
      await h.close();
    }
  });

  void test('the org line is the API’s name, not the design’s fixture', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.sidebar-orgline').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.sidebar-orgline').innerText(), 'Borealis Labs');
      const sidebar = await h.page.locator('#sidebar').innerText();
      assert.doesNotMatch(sidebar, /Kvelld Dynamics/, 'the prototype’s org fixture leaked');
    } finally {
      await h.close();
    }
  });

  void test('More spaces opens the popover: unpinned rows, filter, escape, view-all', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const more = h.page.locator('.sidebar-link-button', { hasText: 'More spaces' });
      await more.waitFor({ timeout: 20_000 });
      await more.click();

      const pop = h.page.locator('.spaces-pop');
      await pop.waitFor({ timeout: 5000 });

      // Only the space NOT pinned above — the prototype's `popSpaces`.
      await until(
        async () =>
          (await pop.locator('.spaces-pop-name').allInnerTexts()).join('|') === 'Laika Docs',
      );
      const names = await pop.locator('.spaces-pop-name').allInnerTexts();
      // The **popover** still shows display names and meta: it is the one
      // place a reader compares spaces, and the design puts both there.
      assert.deepEqual(names, ['Laika Docs'], `saw ${names.join(', ')}`);
      assert.match(await pop.innerText(), /9 tasks · 2 members/, 'popover rows carry real meta');

      // The search box is a real filter, not the prototype's drawing.
      await pop.locator('input').fill('zzz');
      assert.match(await pop.innerText(), /No space matches/);
      await pop.locator('input').fill('docs');
      assert.equal(await pop.locator('.spaces-pop-name').count(), 1);

      // Escape closes it.
      await h.page.keyboard.press('Escape');
      assert.equal(await pop.count(), 0, 'Escape must close the popover');

      // And View all spaces goes to the directory.
      await more.click();
      await pop.waitFor({ timeout: 5000 });
      await pop.locator('.spaces-pop-all').click();
      await h.page.waitForURL(/\/projects/, { timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('a click outside the popover closes it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const more = h.page.locator('.sidebar-link-button', { hasText: 'More spaces' });
      await more.waitFor({ timeout: 20_000 });
      await more.click();
      await h.page.locator('.spaces-pop').waitFor({ timeout: 5000 });

      await h.page.mouse.click(1200, 600);
      assert.equal(await h.page.locator('.spaces-pop').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the user menu: profile, theme, Developer access, sign out — and its keys', async () => {
    const h = await open('/board?project=laika-core', {
      ...STUB,
      '/api/v1/auth/sign-out': {},
      '/api/v1/tokens': { data: [], next_cursor: null },
    });
    try {
      const trigger = h.page.locator('.user-menu-trigger');
      await trigger.waitFor({ timeout: 20_000 });
      assert.match(await trigger.innerText(), /Ada Lovelace/);
      assert.match(await trigger.innerText(), /owner/i, 'the role renders under the name');
      assert.equal(await trigger.getAttribute('aria-haspopup'), 'menu');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

      await trigger.click();
      const menu = h.page.locator('[role="menu"]');
      await menu.waitFor({ timeout: 5000 });
      const items = menu.locator('[role="menuitem"]');
      const firstLines = async () =>
        (await items.allInnerTexts()).map((t) => t.split('\n')[0]?.trim()).join('|');
      await until(
        async () => (await firstLines()) === 'My profile|Switch to dark|Developer access|Sign out',
      );
      assert.deepEqual(
        (await items.allInnerTexts()).map((t) => t.split('\n')[0]?.trim()),
        ['My profile', 'Switch to dark', 'Developer access', 'Sign out'],
      );
      assert.equal(
        await menu.locator('a', { hasText: 'My profile' }).getAttribute('href'),
        '/people?user=u1',
      );
      // The first item takes the focus; the arrows move it; Escape closes and
      // hands the focus back.
      await until(
        async () =>
          (await h.page.evaluate(() => document.activeElement?.textContent)) === 'My profile',
      );
      assert.equal(await h.page.evaluate(() => document.activeElement?.textContent), 'My profile');
      await h.page.keyboard.press('ArrowDown');
      assert.match(
        (await h.page.evaluate(() => document.activeElement?.textContent)) ?? '',
        /Switch to dark/,
      );
      await h.page.keyboard.press('ArrowUp');
      await h.page.keyboard.press('ArrowUp');
      assert.equal(await h.page.evaluate(() => document.activeElement?.textContent), 'Sign out');
      await h.page.keyboard.press('Escape');
      assert.equal(await menu.count(), 0, 'Escape must close the menu');
      assert.equal(
        await h.page.evaluate(() =>
          document.activeElement?.classList.contains('user-menu-trigger'),
        ),
        true,
        'the focus did not return to the person',
      );

      // The theme, through the app's own storage key, pinning an explicit value.
      await trigger.click();
      await menu.locator('.user-menu-theme').click();
      await h.page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') !== 'light',
        undefined,
        { timeout: 5000 },
      );
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.theme')),
        'dark',
        'the first click pins an explicit choice (D-058 contract)',
      );
      await trigger.click();
      assert.match(await menu.locator('.user-menu-theme').innerText(), /Switch to light/);

      // A press outside closes it.
      await h.page.mouse.click(900, 400);
      assert.equal(await menu.count(), 0, 'a click outside must close the menu');

      // Developer access.
      await trigger.click();
      await menu.locator('a', { hasText: 'Developer access' }).click();
      await h.page.waitForURL((url) => url.pathname === '/developer', { timeout: 10_000 });
      assert.equal(await menu.count(), 0);

      // Sign out, and the browser goes to sign-in.
      await trigger.click();
      await menu.locator('.user-menu-signout').click();
      await h.page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });
      assert.ok(
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/auth/sign-out'),
        'signing out never asked the server',
      );
    } finally {
      await h.close();
    }
  });

  void test('a member’s menu has no My profile — absent, not disabled', async () => {
    const h = await open('/board?project=laika-core', {
      ...STUB,
      '/api/v1/me': { ...(STUB['/api/v1/me'] as object), org_role: 'member' },
    });
    try {
      const trigger = h.page.locator('.user-menu-trigger');
      await trigger.waitFor({ timeout: 20_000 });
      await trigger.click();
      const items = h.page.locator('[role="menu"] [role="menuitem"]');
      await items.first().waitFor({ timeout: 5000 });
      await until(
        async () =>
          (await items.allInnerTexts()).map((t) => t.split('\n')[0]?.trim()).join('|') ===
          'Switch to dark|Developer access|Sign out',
      );
      assert.deepEqual(
        (await items.allInnerTexts()).map((t) => t.split('\n')[0]?.trim()),
        ['Switch to dark', 'Developer access', 'Sign out'],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the fetch is gated on the session', () => {
  /**
   * `listProjects` needs a session. The shell renders on `/login` too, and an
   * ungated fetch there is a `401` on every sign-in page load — the trap
   * `useShellContext` already documents for the sprint count.
   */
  void test('signed out, the project list is never requested', async () => {
    /*
     * **`refuse`, not a bare error body.** This stub used to hand back the
     * envelope with a `200`, so `getMe` parsed `{error: …}` as the *user* and
     * the app went `authenticated` with no `user.id` — `avatarColor` threw and
     * the page rendered **nothing at all**. Both assertions below passed on
     * that blank page, which is CLAUDE.md §5's "an assertion a broken setup
     * satisfies" exactly: *no projects were fetched* because nothing rendered.
     *
     * Found while capturing a screenshot for LAI-250 and tracked to source
     * through the build's own sourcemap. The positive assertion is the fix:
     * the sign-in form must actually be on the page.
     */
    const h = await open('/login', {
      '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
    });
    try {
      await h.page.locator('.auth').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(1500);
      const asked = h.calls.filter((c: StubCall) => c.path === '/api/v1/projects');
      assert.deepEqual(
        asked,
        [],
        `the sign-in page fetched projects ${String(asked.length)} time(s)`,
      );
      assert.equal(await h.page.locator('.space-row').count(), 0, 'spaces rendered signed out');
    } finally {
      await h.close();
    }
  });
});
