/**
 * Organisation → Overview's pulse (LAI-989), over `GET /org/overview`.
 *
 * What only a browser shows: the tiles are drawn from the response — numbers
 * no fixture in the design uses, so a hardcoded figure cannot pass — in the
 * Overview's own tile style, and a failed read leaves the rest of the tab
 * standing. Both themes, wide and narrow, with no sideways scroll.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, setTheme, until, type ApiStub } from './harness.ts';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const permissions = (org_role: string) => ({
  org_roles: [],
  project_roles: [],
  permissions: [],
  me: {
    org_role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions: ['org.read'],
    projects: [],
  },
});

// Odd, distinct figures, so one tile showing another's number is caught.
const OVERVIEW = {
  people: { active: 17, seen_this_week: 11, since: 1 },
  tasks: { open: 43, in_review: 5, blocked: 3, overdue: 7 },
};

const stub = (org_role: string, overview: unknown = OVERVIEW): ApiStub => ({
  '/api/v1/me': { ...user('u1', 'Ada Lovelace', org_role), memberships: [] },
  '/api/v1/permissions': permissions(org_role),
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: [user('u1', 'Ada Lovelace', org_role)], next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': { id: 'o1', name: 'Acme', presence_enabled: true, created_at: 1, updated_at: 2 },
  '/api/v1/org/overview': overview,
});

void after(async () => {
  await closeBrowser();
});

void describe('the pulse', () => {
  for (const role of ['owner', 'member']) {
    void test(`${role}: one tile per figure, each the server’s number`, async () => {
      const h = await open('/organisation', stub(role));
      try {
        const tiles = h.page.locator('.org-pulse .org-stat');
        await until(async () => (await tiles.count()) === 5);
        const read = await tiles.evaluateAll((els) =>
          els.map((el) => [
            el.getAttribute('data-pulse'),
            el.querySelector('dt')?.textContent,
            el.querySelector('.org-stat-value')?.textContent,
          ]),
        );
        assert.deepEqual(read, [
          ['people', 'Active people', '17'],
          ['open', 'Open tasks', '43'],
          ['review', 'In review', '5'],
          ['blocked', 'Blocked', '3'],
          ['overdue', 'Overdue', '7'],
        ]);
        assert.equal(
          await h.page.locator('.org-pulse [data-pulse="people"] .org-stat-sub').textContent(),
          '11 seen this week',
        );
        assert.ok(
          h.calls.some((c) => c.path === '/api/v1/org/overview'),
          'the tiles did not ask the server',
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('a failed read is a line with a retry, and the rest of Overview still reads', async () => {
    const h = await open('/organisation', {
      ...stub('owner'),
      '/api/v1/org/overview': refuse(500, 'internal', 'boom'),
    });
    try {
      const error = h.page.locator('.org-pulse-error');
      await error.waitFor({ timeout: 20_000 });
      assert.match((await error.textContent()) ?? '', /could not be read/);
      assert.equal(await h.page.locator('.org-pulse').count(), 0);
      // The directory's figures are another request and still stand.
      await h.page.locator('.org-stat', { hasText: 'Members' }).waitFor({ timeout: 20_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('fits', () => {
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      void test(`${String(width)}px, ${theme}: the tiles sit in the page`, async () => {
        const h = await open('/organisation', stub('owner'));
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await setTheme(h.page, theme);
          const tiles = h.page.locator('.org-pulse .org-stat');
          await until(async () => (await tiles.count()) === 5);
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 1, `the page scrolls sideways by ${String(overflow)}px`);
          // The tile style: a card of its own on the page's ground.
          const [card, page] = await Promise.all([
            tiles.first().evaluate((el) => getComputedStyle(el).backgroundColor),
            h.page.evaluate(() => getComputedStyle(document.body).backgroundColor),
          ]);
          assert.notEqual(card, 'rgba(0, 0, 0, 0)', 'a tile has no ground of its own');
          assert.ok(card !== '' && page !== '', 'nothing to compare');
        } finally {
          await h.close();
        }
      });
    }
  }
});
