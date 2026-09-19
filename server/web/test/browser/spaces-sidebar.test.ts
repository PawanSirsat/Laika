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
import { closeBrowser, open, refuse, type ApiStub, type StubCall } from './harness.ts';

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

      const names = await h.page.locator('.space-row .sidebar-label').allInnerTexts();
      // Three spaces plus the More spaces row — the design's number. **Drawn
      // by name since LAI-260**, so the list never moves under the pointer.
      // `.space-row` is a *space*; the More-spaces row opens a popover and is
      // deliberately not one.
      assert.deepEqual(
        names,
        ['laika-core', 'laika-web', 'laika-infra'],
        `saw ${names.join(', ')}`,
      );
      assert.ok(
        await h.page.locator('.sidebar-link-button', { hasText: 'More spaces' }).isVisible(),
        'the More spaces row is missing',
      );

      // **A row is a dot and a name** (LAI-262): no counts, no member figure,
      // no two-letter key while the rail is expanded.
      const row = await h.page.locator('.space-row').first().innerText();
      assert.equal(row.trim(), 'laika-core', `the row carries more than its name: ${row}`);

      const sidebar = await h.page.locator('#sidebar').innerText();
      // The design cases this one "Spaces", 11.5px/700 with a caret — not the
      // uppercase micro-label the route groups use (LAI-249).
      assert.match(sidebar, /Spaces/);
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
      assert.equal(await active.count(), 1, 'more than one row is marked current');
      assert.match(await active.innerText(), /laika-core/);
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
      // **Capacity left the sidebar in LAI-251** — the design's tab strip
      // carries it. `ORG` remains for Unlisted work, which has no tab in the
      // design to inherit; this reader is an owner, so the group renders.
      assert.doesNotMatch(sidebar, /Capacity/, 'Capacity is offered twice');
      assert.match(sidebar, /ORG/);
      assert.match(sidebar, /Unlisted work/);
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

      const labels = (await h.page.locator('.view-tab').allInnerTexts()).map(
        (s) => s.split('\n')[0],
      );
      assert.deepEqual(labels, [
        'Board',
        'List',
        'Timeline',
        'Calendar',
        'Sprints',
        'Capacity',
        'Dashboard',
        'Activity',
        'Meeting review',
      ]);

      /*
       * **The project travels with every tab, `/capacity` included** (LAI-279).
       * A bare path drops `?project=` and the destination falls back to a
       * different project (LAI-423) — or, for Capacity, to none at all, which
       * is what left the space bar reading "No space".
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
   * **Capacity is a tab, and it keeps the space** (LAI-279).
   *
   * LAI-251 had its link drop `?project=` so a tab under `laika-core` could not
   * claim to be about `laika-core`. The honesty was right; the mechanism left
   * the space bar reading **"No space"** over a screen still showing that
   * space's tabs, which the owner reported as the screen looking like a
   * different page.
   *
   * The design draws Capacity inside the space and puts the scope into a
   * sentence — *"across N spaces · live"* — which is where a reader can see it.
   * This asserts the link; `capacity.test.ts` asserts the sentence.
   */
  void test('the Capacity tab keeps the space, and the bar names it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const tab = h.page.locator('.view-tab', { hasText: 'Capacity' });
      await tab.waitFor({ timeout: 20_000 });
      assert.equal(await tab.getAttribute('href'), '/capacity?project=laika-core');

      await tab.click();
      await h.page.waitForURL(/capacity\?project=laika-core/, { timeout: 10_000 });

      /*
       * The whole of the owner's report: the space must be **named**, not
       * fall back to "No space".
       *
       * The name lives in the rail's wordmark since LAI-293. The regression
       * this guards is the same one and is if anything sharper here: the rail
       * falls back to the *product* name, so a failure now reads as a
       * plausible `Laika` rather than an obvious `No space`.
       */
      await h.page.waitForFunction(
        () => (document.querySelector('.sidebar-wordmark')?.textContent ?? '') !== '',
        undefined,
        { timeout: 10_000 },
      );
      const name = await h.page.locator('.sidebar-wordmark').innerText();
      assert.notEqual(name, 'No space', 'the rail lost the space');
      assert.notEqual(name, 'Laika', 'the rail fell back to the product name');
      assert.match(name, /Laika Core|laika-core/);
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
      assert.equal(await active.count(), 1, 'exactly one row must be current');
      assert.match(await active.innerText(), /laika-core/);
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
      const before = await h.page.locator('.space-row .sidebar-label').allInnerTexts();

      // Click a space that is *not* the current one — the case that reordered.
      await h.page.locator('.sidebar-link', { hasText: 'laika-web' }).click();
      await h.page.waitForURL(/project=laika-web/, { timeout: 10_000 });
      await h.page.waitForTimeout(400);

      const after = await h.page.locator('.space-row .sidebar-label').allInnerTexts();
      assert.deepEqual(after, before, `the rows moved: ${before.join(',')} -> ${after.join(',')}`);

      // And again, to a third space.
      await h.page.locator('.sidebar-link', { hasText: 'laika-infra' }).click();
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
        ['laika-web', 'laika-web'],
        ['laika-infra', 'laika-infra'],
      ] as const) {
        await h.page.locator('.sidebar-link', { hasText: name }).click();
        await h.page.waitForURL(new RegExp(`project=${slug}`), { timeout: 10_000 });
      }

      await h.page.reload();
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });

      const keys = await h.page.locator('.space-row .sidebar-label').allInnerTexts();
      assert.deepEqual(
        keys,
        ['laika-core', 'laika-web', 'laika-infra'],
        `storage lost what was opened: ${keys.join(', ')}`,
      );
      assert.ok(!keys.includes('laika-docs'), 'a space nobody opened is on the list');
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
   * half exercises `initTheme`, and the `dk` check proves the setup ran —
   * a setup step with no assertion cannot fail at all.
   */
  void test('no page overflow with the spaces sidebar and the tab bar', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.view-tab').first().waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark'] as const) {
        await h.page.evaluate((t: string) => {
          localStorage.setItem('laika.theme', t);
        }, theme);
        await h.page.reload();
        await h.page.locator('.view-tab').first().waitFor({ timeout: 20_000 });
        const dark = await h.page.evaluate(() => document.documentElement.classList.contains('dk'));
        assert.equal(dark, theme === 'dark', `the ${theme} theme did not apply`);

        for (const width of [1440, 1280, 420]) {
          await h.page.setViewportSize({ width, height: 1000 });
          await h.page.waitForFunction(
            (w: number) => document.documentElement.clientWidth === w,
            width,
            { timeout: 5000 },
          );
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.equal(
            overflow,
            0,
            `${theme} at ${String(width)}px overflows the page by ${String(overflow)}px`,
          );
        }
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the prototype geometry (LAI-249)', () => {
  void test('the logo collapses the rail to 56px and back, keys surviving', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });

      const width = async () =>
        h.page.evaluate(() => {
          const el = document.querySelector('#sidebar');
          return el === null ? 0 : Math.round(el.getBoundingClientRect().width);
        });

      assert.equal(await width(), 212, 'expanded width is the prototype’s 212px');

      await h.page.locator('.sidebar-logo').click();
      await h.page.waitForFunction(
        () => {
          const el = document.querySelector('#sidebar');
          return el !== null && Math.round(el.getBoundingClientRect().width) === 56;
        },
        undefined,
        { timeout: 5000 },
      );

      /*
       * **The collapsed rail is where the two-letter keys live** (LAI-262).
       * The design renders `abbr` under `sc-if navMini` and the name
       * otherwise, so this is the one width at which a space says `LC` — and
       * the name must be the thing that gave way to it.
       */
      const firstRow = h.page.locator('.space-row').first();
      assert.ok(await firstRow.locator('.sidebar-mini').isVisible(), 'the key did not appear');
      assert.equal(await firstRow.locator('.sidebar-mini').innerText(), 'LC');
      assert.ok(
        !(await firstRow.locator('.sidebar-label').isVisible()),
        'the name is still showing in a 56px rail',
      );
      // Route rows use the same mechanism.
      assert.ok(await h.page.locator('.sidebar-mini', { hasText: 'TK' }).isVisible());

      await h.page.locator('.sidebar-logo').click();
      await h.page.waitForFunction(
        () => {
          const el = document.querySelector('#sidebar');
          return el !== null && Math.round(el.getBoundingClientRect().width) === 212;
        },
        undefined,
        { timeout: 5000 },
      );
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

  void test('the footer: chip, role, sign-out, and the design’s theme row', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const footer = h.page.locator('.sidebar-footer');
      await footer.waitFor({ timeout: 20_000 });

      assert.match(await footer.innerText(), /Ada Lovelace/);
      assert.match(await footer.innerText(), /owner/i, 'the role renders under the name');
      assert.ok(await footer.locator('.sidebar-signout').isVisible(), 'sign out stays reachable');

      // The design's two-state row: `☾ Switch to dark` in light, then the
      // flip — through the app's own storage key, pinning an explicit value.
      const toggle = footer.locator('.theme-switch');
      assert.match(await toggle.innerText(), /Switch to dark/);
      await toggle.click();
      await h.page.waitForFunction(
        () => document.documentElement.classList.contains('dk'),
        undefined,
        { timeout: 5000 },
      );
      assert.match(await toggle.innerText(), /Switch to light/);
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.theme')),
        'dark',
        'the first click pins an explicit choice (D-058 contract)',
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
