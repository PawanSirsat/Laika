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
 * immediately: it asserted four faces on the board and saw none, because the
 * row that should receive them did not exist yet.
 *
 * **That row exists now** (LAI-293), so the ordering guard has done its job and
 * becomes an end-state guard: search and the faces are in the board's own row,
 * and still in the bar everywhere else. Kept rather than deleted — what it was
 * really protecting is *no build has neither*, and that is still the property
 * worth failing on.
 */
void describe('search and the faces are in exactly one place per view', () => {
  void test('the board has them in its own row, not in the bar', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await h.page.locator('.space-bar-row').waitFor({ timeout: 20_000 });
      await h.page.locator('.board-bar').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(500);

      assert.equal(
        await h.page.locator('.board-bar .bt-search').count(),
        1,
        'the row has no search',
      );
      assert.ok(
        (await h.page.locator('.board-bar .bt-member').count()) > 0,
        'the row has no assignee faces',
      );

      const g = await geometry(h.page);
      assert.equal(g.search, 0, 'the bar still draws search on the board');
      assert.equal(g.members, 0, 'the bar still draws the faces on the board');
    } finally {
      await h.close();
    }
  });

  void test('the timeline keeps them in the bar — it has no row', async () => {
    // The half that stops the move becoming a deletion: a view with no toolbar
    // has nowhere else to put them.
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await h.page.locator('.space-bar-row').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(500);

      assert.equal(await h.page.locator('.board-bar').count(), 0, 'the timeline grew a board row');

      const g = await geometry(h.page);
      assert.equal(g.search, 1, 'the timeline lost its search');
      assert.equal(g.members, 1, 'the timeline lost its assignee filter');
    } finally {
      await h.close();
    }
  });
});

/**
 * Agents and Create sit at the bar's right edge (LAI-293).
 *
 * They were between the project name and the view tabs, which reads as crammed
 * rather than as a pair of actions. **Asserted against the bar's own right
 * edge**, not against a pixel: a number would pass on any width that happened
 * to match and would have to be rewritten every time the tabs change.
 */
void describe('the space bar’s actions are on the right', () => {
  void test('Create ends where the bar ends, and both sit after the tabs', async () => {
    const h = await open('/board?project=laika-core', STUB);

    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await h.page.locator('.space-create').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(400);

      const m = await h.page.evaluate(() => {
        const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
        const create = box('.space-create');
        const top = box('.space-bar-top');
        const tabs = box('.view-tabs');
        const group = box('.space-bar-right');
        return create === null || top === null || tabs === null || group === null
          ? null
          : {
              createRight: Math.round(create.right),
              topRight: Math.round(top.right),
              tabsRight: Math.round(tabs.right),
              groupLeft: Math.round(group.left),
            };
      });

      assert.ok(m !== null, 'the bar, the tabs or the actions are missing');
      assert.equal(m.createRight, m.topRight, 'Create is not flush with the bar’s right edge');
      assert.ok(
        m.groupLeft >= m.tabsRight,
        `the actions are still left of the tabs (${String(m.groupLeft)} < ${String(m.tabsRight)})`,
      );
    } finally {
      await h.close();
    }
  });
});
