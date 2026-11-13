/**
 * Screens load on demand (LAI-1219), in a real browser.
 *
 * - A deep link straight to a lazily loaded screen renders it.
 * - Navigating to one fetches its chunk then, not with the first page; a
 *   hover fetches it before the click; the first page fetches nothing beyond
 *   its own screen and the default one.
 * - A slow chunk shows nothing at first, then the shared loading state; a
 *   preloaded one shows neither.
 * - A chunk that fails shows the shared error state, and Try again fetches it
 *   again and renders the screen.
 * - All of it under the production Content-Security-Policy with zero
 *   violations, and with no inline script on the page.
 *
 * File names are hashed, so chunks are matched by the module they are named
 * after: `InboxScreen-*.js`.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, describe, test } from 'node:test';
import type { Page, Route } from 'playwright';
import { orgStub } from './capacity-org.ts';
import { closeBrowser, open, setTheme, until, type Harness } from './harness.ts';

const SERVER_SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

/** Must match `SCREEN_LOADING_DELAY_MS` in `ScreenBoundary.tsx`. */
const DELAY_MS = 300;

void after(async () => {
  await closeBrowser();
});

/** Every JS file the page asked for, by its name without the hash. */
function watchScripts(page: Page): string[] {
  const names: string[] = [];
  page.on('request', (request) => {
    const match = /\/assets\/([A-Za-z0-9_-]+?)-[A-Za-z0-9_-]{8}\.js$/.exec(request.url());
    if (match?.[1] !== undefined) names.push(match[1]);
  });
  return names;
}

/**
 * The org fixture with an empty review queue. Its own queue carries only ids —
 * enough for the badge it was written for, not for the Review tab to draw.
 */
const stub = () => ({ ...orgStub('owner'), '/api/v1/review': { tasks: [], truncated: false } });

/** Inbox's own chunk, with or without the `?retry=N` a retry adds. */
const INBOX_CHUNK = /\/assets\/InboxScreen-[^/?]+\.js(\?.*)?$/;
const inboxLink = (page: Page) => page.locator('a.sidebar-link', { hasText: 'Inbox' });
const inboxShown = (page: Page) => page.locator('.page-tab[data-tab="review"]');

async function onInsights(): Promise<{ h: Harness; scripts: string[] }> {
  let scripts: string[] = [];
  const h = await open('/insights?tab=capacity', stub(), {
    before: async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      scripts = watchScripts(page);
    },
  });
  await h.page.locator('.cap-grid > .cap-card').first().waitFor({ timeout: 20_000 });
  return { h, scripts };
}

/** Navigate as Back and Forward do — no hover, no focus, so nothing is warmed first. */
async function goWithoutWarming(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** Notes, from now on, whether any screen-loading placeholder was ever drawn. */
async function watchLoading(
  page: Page,
): Promise<() => Promise<{ pending: boolean; shown: boolean }>> {
  await page.evaluate(() => {
    const w = window as unknown as { __loading: { pending: boolean; shown: boolean } };
    w.__loading = { pending: false, shown: false };
    new MutationObserver(() => {
      if (document.querySelector('[data-screen-loading="pending"]')) w.__loading.pending = true;
      if (document.querySelector('[data-screen-loading="shown"]')) w.__loading.shown = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __loading: { pending: boolean; shown: boolean } }).__loading,
    );
}

void describe('screens load on demand (LAI-1219)', () => {
  void test('a deep link straight to a lazy screen renders it', async () => {
    const h = await open('/inbox?tab=unlisted', stub());
    try {
      await h.page
        .getByText('The migration runner logs a warning nobody reads.')
        .waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-screen-failed]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a deep link to a space tab brings the frame and the tab together', async () => {
    let scripts: string[] = [];
    const h = await open('/board?project=laika', stub(), {
      before: (page) => {
        scripts = watchScripts(page);
        return Promise.resolve();
      },
    });
    try {
      await h.page.locator('.view-tabs, .space').first().waitFor({ timeout: 20_000 });
      await until(() => scripts.includes('BoardScreen') && scripts.includes('SpaceLayout'));
      assert.ok(scripts.includes('BoardScreen') && scripts.includes('SpaceLayout'), scripts.join());
    } finally {
      await h.close();
    }
  });

  void test('the first page fetches its own screen and the default; a hover fetches the next', async () => {
    const { h, scripts } = await onInsights();
    try {
      // The default screen is warmed after first paint: the board and its frame.
      await until(() => scripts.includes('BoardScreen') && scripts.includes('SpaceLayout'));
      assert.ok(scripts.includes('InsightsScreen'), 'the page’s own screen came from a chunk');
      // Nothing else that is a screen — other pages wait to be asked for.
      for (const other of ['InboxScreen', 'OrganisationScreen', 'DeveloperScreen', 'MyDayScreen']) {
        assert.ok(!scripts.includes(other), `${other} was fetched with the first page`);
      }

      await inboxLink(h.page).hover();
      await until(() => scripts.includes('InboxScreen'));
      assert.ok(scripts.includes('InboxScreen'), 'hovering Inbox did not warm its chunk');

      await inboxLink(h.page).click();
      await inboxShown(h.page).waitFor({ timeout: 10_000 });
      assert.match(h.page.url(), /\/inbox/);
    } finally {
      await h.close();
    }
  });

  void test('a slow chunk shows nothing at first, then the shared loading state', async () => {
    const { h } = await onInsights();
    try {
      await h.page.route(INBOX_CHUNK, async (route: Route) => {
        await new Promise((done) => setTimeout(done, 2_000));
        await route.continue();
      });
      const seen = await watchLoading(h.page);
      await goWithoutWarming(h.page, '/inbox');

      // Inside the delay: the placeholder is there, and empty.
      await h.page
        .locator('[data-screen-loading="pending"]')
        .waitFor({ state: 'attached', timeout: 2_000 });
      assert.equal(await h.page.locator('[data-screen-loading] .skeleton').count(), 0);

      // Past it: the shared loading state, announced by name.
      const shown = h.page.locator('[data-screen-loading="shown"]');
      await shown.waitFor({ timeout: DELAY_MS + 1_500 });
      assert.ok((await shown.locator('.skeleton').count()) > 0, 'no skeleton in the loading state');
      assert.match(await shown.locator('[role="status"]').first().innerText(), /Loading Inbox/);

      await inboxShown(h.page).waitFor({ timeout: 10_000 });
      assert.equal(await shown.count(), 0, 'the loading state outlived the screen');
      assert.equal((await seen()).shown, true);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a slow space tab waits on a neutral skeleton, never a second board skeleton', async () => {
    // The board draws its own first-load skeleton with its real columns and
    // holds it (LAI-707); a board-shaped fallback before it flashed up and was
    // swapped for that one — board-refresh.test.ts's hold test, under load.
    const h = await open('/board?project=laika', stub(), {
      before: async (page) => {
        await page.route(/\/assets\/BoardScreen-[^/?]+\.js/, async (route) => {
          await new Promise((done) => setTimeout(done, 1_200));
          await route.continue();
        });
      },
    });
    try {
      const shown = h.page.locator('[data-screen-loading="shown"]');
      await shown.waitFor({ timeout: 10_000 });
      assert.ok((await shown.locator('.skeleton').count()) > 0, 'no skeleton in the loading state');
      assert.equal(await shown.locator('.skeleton-board').count(), 0, 'a board skeleton');
      // The space bar is already there: the frame did not wait for the tab.
      assert.ok((await h.page.locator('.view-tabs').count()) > 0, 'the frame waited for the tab');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a chunk already warmed shows no loading state at all', async () => {
    const { h, scripts } = await onInsights();
    try {
      await inboxLink(h.page).hover();
      await until(() => scripts.includes('InboxScreen'));
      // Let it land before the click.
      await h.page.waitForTimeout(500);
      const seen = await watchLoading(h.page);
      await inboxLink(h.page).click();
      await inboxShown(h.page).waitFor({ timeout: 10_000 });
      assert.deepEqual(await seen(), { pending: false, shown: false });
    } finally {
      await h.close();
    }
  });

  void test('a chunk that fails once: the error state, then Try again renders the screen', async () => {
    const { h } = await onInsights();
    try {
      let asked = 0;
      const urls: string[] = [];
      await h.page.route(INBOX_CHUNK, async (route: Route) => {
        asked += 1;
        urls.push(route.request().url());
        if (asked === 1) await route.abort('failed');
        else await route.continue();
      });
      await goWithoutWarming(h.page, '/inbox');

      const failed = h.page.locator('[data-screen-failed="inbox"]');
      await failed.waitFor({ timeout: 10_000 });
      assert.equal(asked, 1);
      // The shared error state, never a blank page — and the shell is still here.
      assert.match(await failed.locator('.state-headline').innerText(), /didn.t load/);
      assert.equal(await inboxLink(h.page).count(), 1, 'the sidebar went with the screen');

      await failed.locator('.state-retry', { hasText: 'Try again' }).click();
      await inboxShown(h.page).waitFor({ timeout: 10_000 });
      assert.equal(asked, 2, 'Try again did not fetch the chunk again');
      // A fresh address: the browser remembers the failed one and would not ask.
      assert.match(urls[1] ?? '', /\?retry=1$/);
      assert.equal(await failed.count(), 0);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a chunk that keeps failing asks once per Try again, then reloads', async () => {
    const { h } = await onInsights();
    try {
      let asked = 0;
      await h.page.route(INBOX_CHUNK, async (route: Route) => {
        asked += 1;
        await route.abort('failed');
      });
      await goWithoutWarming(h.page, '/inbox');
      const failed = h.page.locator('[data-screen-failed="inbox"]');
      await failed.waitFor({ timeout: 10_000 });
      // No loop: a failed chunk is not fetched again until somebody asks.
      await h.page.waitForTimeout(1_000);
      assert.equal(asked, 1, 'the failed chunk was fetched again unasked');

      await failed.locator('.state-retry').click();
      await until(async () => (await failed.innerText()).includes('reloads Laika'));
      await h.page.waitForTimeout(1_000);
      assert.equal(asked, 2, 'Try again should ask exactly once more');

      // The second Try again reloads; the network is back by then.
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await Promise.all([h.page.waitForEvent('load'), failed.locator('.state-retry').click()]);
      await inboxShown(h.page).waitFor({ timeout: 20_000 });
      assert.match(h.page.url(), /\/inbox$/);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('the loading and error states in both themes', async () => {
    const { h } = await onInsights();
    try {
      await h.page.route(INBOX_CHUNK, (route: Route) => route.abort('failed'));
      await goWithoutWarming(h.page, '/inbox');
      const failed = h.page.locator('[data-screen-failed="inbox"]');
      await failed.waitFor({ timeout: 10_000 });
      const colours: string[] = [];
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        colours.push(
          await failed.locator('.state-headline').evaluate((el) => getComputedStyle(el).color),
        );
      }
      assert.notEqual(colours[0], colours[1], 'the error state does not follow the theme');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

// ------------------------------------------------------------------- CSP

interface CspModule {
  buildContentSecurityPolicy: (hashes: readonly string[]) => string;
  extractStyleHashes: (html: string) => string[];
}

/** The server's own CSP builder, by path: `server/src` is outside this package. */
async function cspModule(): Promise<CspModule> {
  const url = pathToFileURL(join(SERVER_SRC, 'http', 'security-headers.ts')).href;
  return (await import(url)) as CspModule;
}

void describe('lazy screens under the production CSP (LAI-1219)', () => {
  void test('deep link, navigation, preload, failure and retry: zero violations', async () => {
    const { buildContentSecurityPolicy, extractStyleHashes } = await cspModule();
    const consoleLines: string[] = [];
    let failInbox = true;
    const h = await open('/insights?tab=capacity', stub(), {
      before: async (page) => {
        page.on('console', (m) => {
          if (/Content Security Policy/i.test(m.text())) consoleLines.push(m.text());
        });
        await page.addInitScript(() => {
          const w = window as unknown as { __csp: string[] };
          w.__csp = [];
          document.addEventListener('securitypolicyviolation', (e) => {
            w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
          });
        });
        await page.route('**/*', async (route) => {
          if (failInbox && INBOX_CHUNK.test(route.request().url())) {
            failInbox = false;
            await route.abort('failed');
            return;
          }
          const response = await route.fetch();
          const headers = { ...response.headers() };
          if ((headers['content-type'] ?? '').startsWith('text/html')) {
            const html = await response.text();
            headers['content-security-policy'] = buildContentSecurityPolicy(
              extractStyleHashes(html),
            );
            await route.fulfill({ response, headers, body: html });
            return;
          }
          await route.fulfill({ response, headers });
        });
      },
    });
    try {
      const { page } = h;
      await page.locator('.cap-grid > .cap-card').first().waitFor({ timeout: 20_000 });

      // Positive control: the header really is on the document, and strict.
      const header = await page.evaluate(async () => {
        const r = await fetch(location.href);
        return r.headers.get('content-security-policy') ?? '';
      });
      assert.match(header, /script-src 'self'(;|$)/, `not the strict policy: ${header}`);

      // A failed chunk and its retry, then a preload and a navigation.
      await goWithoutWarming(page, '/inbox');
      await page.locator('[data-screen-failed="inbox"] .state-retry').click();
      await inboxShown(page).waitFor({ timeout: 10_000 });
      const orgLink = page.locator('a.sidebar-link', { hasText: 'Organisation' });
      await orgLink.hover();
      await orgLink.click();
      await page.waitForURL(/\/organisation/);
      await page.locator('.page-tab').first().waitFor({ timeout: 10_000 });
      // A space tab: the frame and the board, side by side.
      await goWithoutWarming(page, '/board?project=laika');
      await page.locator('.view-tabs').first().waitFor({ timeout: 10_000 });

      const violations = [
        ...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)),
        ...consoleLines,
      ];
      assert.deepEqual(violations, [], 'CSP violations');
      // No inline script anywhere — the module preloads are `<link>`s.
      assert.equal(await page.locator('script:not([src])').count(), 0, 'an inline script');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});
