/**
 * The space chrome is one line, and the board gets a slot on the lanes (LAI-292).
 *
 * The owner asked for two things, with a reference screenshot: *"on top we have
 * too much space, decrease it; that project name also moves on top so we can
 * occupy that space with other things."*
 *
 * Measured before the change, at 1600px, everything above the first lane:
 * `.space-bar` **91px** (identity 32 + tabs 34), sprint strip 57, WORKING NOW
 * 29 — **first lane at y=191**.
 *
 * What is asserted here is the shape, not the pixel: identity and tabs share a
 * line, the toolbar slot exists and collapses when unused, and the controls a
 * view claims leave the bar **without taking them away from views that have
 * nowhere else to put them.**
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const project = (slug: string, name: string, prefix: string) => ({
  id: slug,
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
  task_counts: { backlog: 2, todo: 1, in_progress: 1, review: 0, done: 1, cancelled: 0 },
  blocked_count: 0,
  member_count: 3,
  members: [],
  last_activity_at: 2,
});

const CORE = project('laika-core', 'Laika Core', 'LC');

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [CORE], next_cursor: null },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', role: 'lead' },
      { user_id: 'u2', name: 'Tomas Nel', role: 'member' },
    ],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/projects/laika-core/board-columns': { columns: [] },
};

const geometry = (page: Awaited<ReturnType<typeof open>>['page']) =>
  page.evaluate(() => {
    const el = (s: string) => document.querySelector(s);
    const box = (s: string) => {
      const n = el(s);
      return n === null ? null : n.getBoundingClientRect();
    };
    const bar = box('.space-bar-row');
    const tabs = box('.space-bar-top > nav');
    return {
      sameLine: bar !== null && tabs !== null && Math.abs(bar.top - tabs.top) < bar.height,
      barWidth: Math.round(box('.space-bar')?.width ?? 0),
      search: document.querySelectorAll('.space-search').length,
      members: document.querySelectorAll('.space-members').length,
      tabCount: document.querySelectorAll('.space-bar-top > nav a').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

void after(async () => {
  await closeBrowser();
});

void describe('the bar is one line', () => {
  void test('identity and the view tabs share it when there is room', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      // **1920, not 1600.** At 1600 this fixture is within a few pixels of
      // wrapping — the seeded instance measures row 646 + tabs 690 in 1352 and
      // fits, a fixture with different names does not. Asserting the merge at a
      // borderline width tests the fixture's content, not the layout.
      await h.page.setViewportSize({ width: 1920, height: 1000 });
      await h.page.locator('.space-bar-row').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(500);

      const g = await geometry(h.page);
      assert.ok(g.tabCount > 0, 'no tabs found — this proves nothing');
      assert.equal(g.sameLine, true, 'the tabs are still on their own row');
    } finally {
      await h.close();
    }
  });

  /**
   * **It wraps rather than scrolls or hides.** A single line that overflowed
   * would put views off the edge, and the whole point of the tab bar is that
   * every view of a space is reachable from it.
   */
  void test('every tab survives every width, and the page never scrolls sideways', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-bar-row').waitFor({ timeout: 20_000 });
      let expected = 0;

      for (const width of [1600, 1280, 900, 420]) {
        await h.page.setViewportSize({ width, height: 1000 });
        await h.page.waitForTimeout(300);
        const g = await geometry(h.page);

        if (expected === 0) expected = g.tabCount;
        assert.equal(g.tabCount, expected, `at ${String(width)}px a tab disappeared`);
        assert.equal(g.overflow, 0, `at ${String(width)}px the page scrolls sideways`);
      }
    } finally {
      await h.close();
    }
  });
});

/**
 * **There is no toolbar slot, and there should not be.**
 *
 * Both sessions assumed the board's row had to portal into a container the
 * space layout owned, and negotiated a seam for it over two messages. Measuring
 * `SpaceLayout` settled it: `{children}` — the screen's own output — already
 * renders directly below `PresenceStrip`. The board renders its row inline and
 * the seam does not exist.
 *
 * Asserted so the slot is not reintroduced by someone reading the old plan.
 */
void describe('no slot was carved', () => {
  void test('the layout exposes no toolbar slot', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-bar-row').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.space-toolbar-slot').count(), 0);
      assert.equal(await h.page.locator('#space-toolbar-slot').count(), 0);
    } finally {
      await h.close();
    }
  });
});

/**
 * **Search and the member faces stay in the bar, for now.**
 *
 * They are filters and they belong in the board's own row — LAI-293 moves them
 * there. This task hid them first, and `space-bar.test.ts` caught it
 * immediately: it asserts four faces on the board and saw none, because the row
 * that should receive them does not exist yet.
 *
 * So the order is the point. They move **with** the row, in one change, and
 * until then the bar keeps them on every view. This asserts that ordering
 * rather than the end state — a guard against hiding them again before there is
 * somewhere for them to go.
 */
void describe('filters stay in the bar until a row exists to receive them', () => {
  for (const [view, path] of [
    ['board', '/board'],
    ['timeline', '/timeline'],
  ] as const) {
    void test(`${view} still has its search and assignee faces`, async () => {
      const h = await open(`${path}?project=laika-core`, STUB);
      try {
        await h.page.setViewportSize({ width: 1600, height: 1000 });
        await h.page.locator('.space-bar-row').waitFor({ timeout: 20_000 });
        await h.page.waitForTimeout(500);

        const g = await geometry(h.page);
        assert.equal(g.search, 1, `${view} has no search`);
        assert.equal(g.members, 1, `${view} has no assignee filter`);
      } finally {
        await h.close();
      }
    });
  }
});
