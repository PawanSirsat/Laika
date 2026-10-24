/**
 * Every old address still works (LAI-796), in a real browser.
 *
 * `redirects.test.ts` holds the table; this holds what a person sees: a
 * bookmark to `/review` opens Inbox on its Review tab, the address bar says
 * where they are, the query they arrived with is kept, Back does not bounce
 * them through the old address, and a link inside the app to an old address
 * lands on the new one too.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, until, type ApiStub } from './harness.ts';

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [],
  },
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/unlisted': { data: [], next_cursor: null },
  '/api/v1/tokens': { data: [], next_cursor: null },
  '/api/v1/capacity': { enabled: true, people: [] },
  '/api/v1/presence': { enabled: true, present: [] },
};

void after(async () => {
  await closeBrowser();
});

/** [old address, new path, new search, the page's title, its open tab]. */
const MOVES: readonly (readonly [string, string, string, string, string | null])[] = [
  ['/review', '/inbox', '?tab=review', 'Inbox', 'Review'],
  ['/unlisted', '/inbox', '?tab=unlisted', 'Inbox', 'Unlisted work'],
  ['/capacity', '/insights', '?tab=capacity', 'Insights', 'Capacity'],
  ['/usage', '/insights', '?tab=usage', 'Insights', 'Usage & cost'],
  ['/tokens', '/developer', '', 'Developer access', null],
];

void describe('a bookmark to an old page opens its new home', () => {
  for (const [from, path, search, title, tab] of MOVES) {
    void test(`${from} → ${path}${search}`, async () => {
      const h = await open(from, STUB);
      try {
        await h.page.waitForURL((url) => url.pathname === path && url.search === search, {
          timeout: 10_000,
        });
        const heading = h.page.locator('.screen-page-title');
        await heading.waitFor({ timeout: 20_000 });
        assert.equal(await heading.innerText(), title);
        if (tab !== null) {
          assert.match(await h.page.locator('.page-tab-active').innerText(), new RegExp(tab));
        }
        // A replace, not a push: Back leaves for the page before — the
        // harness's blank one — rather than landing on the old address,
        // which would only bounce forward again.
        await h.page.goBack();
        await until(() => h.page.url() === 'about:blank');
        assert.equal(h.page.url(), 'about:blank', `Back went to ${h.page.url()}`);
      } finally {
        await h.close();
      }
    });
  }

  void test('Connect keeps ?agent=, and opens the wizard set to it', async () => {
    const h = await open('/connect?agent=codex', STUB);
    try {
      // The wizard is Developer access's first tab since LAI-997.
      await h.page.waitForURL(
        (url) => url.pathname === '/developer' && url.search === '?tab=connect&agent=codex',
        { timeout: 10_000 },
      );
      await h.page.locator('.screen-page-title').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.screen-page-title').innerText(), /Developer access/);
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Connect/);
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.conn-rail-sub').first().innerText(), /Codex/);
      // The page Connect is reached from is the one the rail lights.
      assert.equal(
        (await h.page.locator('#sidebar .sidebar-link-active').innerText()).trim(),
        'Developer access',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('inside the app', () => {
  void test('Back to an old address in the history lands on the new one', async () => {
    const h = await open('/insights', STUB);
    try {
      await h.page.locator('.screen-page-title').waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => {
        history.pushState({}, '', '/review');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await h.page.waitForURL((url) => url.pathname === '/inbox' && url.search === '?tab=review', {
        timeout: 10_000,
      });
      await h.page.locator('.screen-page-title', { hasText: 'Inbox' }).waitFor({
        timeout: 10_000,
      });
    } finally {
      await h.close();
    }
  });

  void test('a tab is an address: switching does not reload, and Back returns', async () => {
    const h = await open('/insights?tab=capacity', STUB);
    try {
      await h.page.locator('.screen-page-title').waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => {
        (window as unknown as { marker: number }).marker = 1;
      });
      await h.page.locator('.page-tab', { hasText: 'Usage & cost' }).click();
      await h.page.waitForURL((url) => url.search === '?tab=usage', { timeout: 10_000 });
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Usage & cost/);
      assert.equal(
        await h.page.evaluate(() => (window as unknown as { marker?: number }).marker),
        1,
        'the tab reloaded the page',
      );
      await h.page.goBack();
      await h.page.waitForURL((url) => url.search === '?tab=capacity', { timeout: 10_000 });
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Capacity/);
    } finally {
      await h.close();
    }
  });
});
