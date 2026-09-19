/**
 * The task drawer (LAI-252).
 *
 * The design's shape is a drawer **over** the board, and every property worth
 * having is geometric or historical: how wide it is, what the scrim covers,
 * whether the board underneath survives, and whether Back closes it. None of
 * that is visible to a source scan.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const CORE = {
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
  task_counts: { backlog: 30, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

/** Enough backlog to make the lane scroll, so "the board survives" is testable. */
const TASKS = Array.from({ length: 30 }, (_, i) => ({
  id: `t${String(i)}`,
  key: `LAI-${String(100 + i)}`,
  number: 100 + i,
  project_id: 'laika-core',
  title: `Task number ${String(i)} with a title long enough to take two lines`,
  description_md: 'Some description.',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
}));

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
  '/api/v1/projects/laika-core/tasks': { data: TASKS, next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
  '/api/v1/tasks/t3/comments': { data: [], next_cursor: null },
  /*
   * The panel calls these since LAI-284/285 — watchers for the rail and the
   * header's Watch button, mentionable for the composer's `@`. A fixture that
   * does not answer them leaves requests in flight while the panel renders.
   */
  '/api/v1/tasks/t3/watchers': { watchers: [] },
  '/api/v1/projects/laika-core/mentionable': { users: [] },
};

async function openDrawer(h: Awaited<ReturnType<typeof open>>) {
  await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
  await h.page.locator('.card').nth(3).click();
  await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('the task drawer', () => {
  void test('is the design’s 1120px, centred, with the scrim over everything', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await openDrawer(h);

      const drawer = await h.page.locator('.drawer').boundingBox();
      assert.ok(drawer);
      /*
        **1120, not 840** (LAI-285). The drawer became two columns — the task as
        a document beside a 288px rail of fields — and at 840 the two together
        left the description narrower than the board card the reader came from.
      */
      assert.equal(Math.round(drawer.width), 1120, 'the drawer is the design’s 1120px');

      /*
       * **The scrim covers everything, the rail included** (LAI-604).
       *
       * It used to stop at the rail so a space could be switched with a task
       * open. The owner asked for the reference's *modal*, and a modal dims
       * what is behind it — including the rail. That capability is genuinely
       * gone, which is why this comment says so rather than the assertion
       * quietly changing number.
       */
      const scrim = await h.page.locator('.drawer-scrim').boundingBox();
      const rail = await h.page.locator('#sidebar').boundingBox();
      assert.ok(scrim && rail);
      assert.equal(Math.round(scrim.x), 0, 'the scrim leaves the rail uncovered');

      // Centred: the same gap either side, which is what "floating" means.
      const left = Math.round(drawer.x);
      const right = Math.round(1600 - (drawer.x + drawer.width));
      assert.ok(
        Math.abs(left - right) <= 1,
        `the dialog is not centred (${String(left)} vs ${String(right)})`,
      );

      // **And it reaches the bottom of the window.** This assertion is here
      // because its absence hid a real defect: the scrim was still anchored to
      // the space pane, so it stopped where the board's content stopped and
      // left a bright band under a dimmed board. Checking only where it starts
      // could not see that.
      assert.equal(Math.round(scrim.y), 0, 'the scrim does not start at the top of the window');
      assert.equal(
        Math.round(scrim.height),
        1000,
        'the scrim does not reach the bottom of the window',
      );
      assert.equal(
        Math.round(scrim.x + scrim.width),
        1600,
        'the scrim does not reach the right edge',
      );

      // A modal closes rather than letting the rail through: clicking the
      // scrim is the way out, and it must work.
      await h.page.mouse.click(20, 500);
      await h.page.locator('.drawer').waitFor({ state: 'detached', timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('shrinks to the window when there is not 1120px to give', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 700, height: 900 });
      await openDrawer(h);

      const drawer = await h.page.locator('.drawer').boundingBox();
      assert.ok(drawer);
      /*
       * `92vw` since LAI-604 — a modal keeps a margin rather than filling the
       * window edge to edge, which is what stops it reading as a page. What
       * still matters, and is asserted below, is that it never overflows.
       */
      assert.equal(Math.round(drawer.width), 644, 'the dialog is not 92vw of a 700px window');
      assert.ok(drawer.x > 0 && drawer.x + drawer.width < 700, 'the dialog touches an edge');
      const overflow = await h.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.equal(overflow, 0, 'the drawer widened the page');
    } finally {
      await h.close();
    }
  });

  void test('the board underneath keeps its scroll position', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 700 });
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });

      /*
       * **The lane is the scroller since LAI-270**, not the page: columns are
       * one height and scroll their own cards, which is what the reference
       * does. This test used to scroll the window; with the board no longer
       * growing the document there is nothing there to move.
       */
      const lane = h.page.locator('.lane-body').first();
      await lane.evaluate((el) => {
        el.scrollTop = 200;
      });
      const before = await lane.evaluate((el) => el.scrollTop);
      /*
       * **The positive control that caught LAI-283.** When the lane's height
       * was a hardcoded `calc()` that stopped resolving, the lane grew to its
       * cards instead — 3457px of it — and nothing scrolled. This said so
       * rather than passing vacuously, which is the only reason the layout bug
       * was visible from the suite at all.
       */
      assert.ok(before > 0, 'the lane did not scroll — this proves nothing');

      await h.page.locator('.card').nth(3).click();
      await h.page.locator('.drawer').waitFor({ timeout: 10_000 });

      // **The drawer's header is on screen even though the board is not at the
      // top.** This is the defect that made it `fixed`: absolutely positioned
      // in the pane, its top sat at -400 and the task's key and close button
      // were above the fold.
      const box = await h.page.locator('.drawer').boundingBox();
      assert.ok(box);
      /*
       * **Fully on screen, not pinned to the top** (LAI-604). This asserted
       * `y === 0`, which was right for a full-height docked drawer. Centred,
       * the property it was protecting is the real one and is stated directly:
       * the dialog is entirely within the window even though the board behind
       * it is scrolled.
       */
      const view = h.page.viewportSize();
      assert.ok(view);
      assert.ok(box.y >= 0, `the dialog opened above the fold (y=${String(Math.round(box.y))})`);
      assert.ok(
        box.y + box.height <= view.height + 1,
        'the dialog runs off the bottom of the window',
      );
      /*
       * **Wait for the panel, not for a duration.** The drawer's shell is
       * rendered by `SpaceLayout` the moment `?task=` is set, while its
       * contents are portalled in by `BoardScreen` once the task resolves — so
       * `.drawer` can exist with nothing in it for a frame. Asserting after a
       * fixed sleep made this flaky: it failed once with `{close: 0, head: 0}`
       * and passed on the next run unchanged.
       */
      await h.page.locator('.panel-head').waitFor({ timeout: 10_000 });
      assert.ok(await h.page.locator('.panel-close').isVisible(), 'no way to close it is visible');

      await h.page.keyboard.press('Escape');
      await h.page.locator('.drawer').waitFor({ state: 'detached', timeout: 10_000 });

      const after = await lane.evaluate((el) => el.scrollTop);
      assert.equal(after, before, 'the board was rebuilt underneath the drawer');
    } finally {
      await h.close();
    }
  });

  void test('Escape, the scrim and Back all close it; Forward re-opens', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });

      // Escape.
      await openDrawer(h);
      await h.page.keyboard.press('Escape');
      await h.page.locator('.drawer').waitFor({ state: 'detached', timeout: 10_000 });

      // The scrim. Clicked at its far edge, away from the panel.
      await openDrawer(h);
      await h.page.locator('.drawer-scrim').click({ position: { x: 20, y: 400 } });
      await h.page.locator('.drawer').waitFor({ state: 'detached', timeout: 10_000 });

      // Back — the reason opening pushes a history entry at all.
      await openDrawer(h);
      assert.match(h.page.url(), /task=/);
      await h.page.goBack();
      await h.page.locator('.drawer').waitFor({ state: 'detached', timeout: 10_000 });
      assert.doesNotMatch(h.page.url(), /task=/);

      // And Forward brings it back, which is what makes Back a navigation
      // rather than a destructive dismiss.
      await h.page.goForward();
      await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('the task renders inside the drawer, not beside it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await openDrawer(h);

      // The content is portalled in, so it mounts a tick after the chrome —
      // counting straight after `.drawer` appears is a race, and it read 0
      // once before this wait was added.
      await h.page.locator('.drawer .panel').waitFor({ timeout: 10_000 });

      // One panel, and it is the drawer's child — two overlays for one drawer
      // is how the geometry drifts apart.
      assert.equal(await h.page.locator('.panel').count(), 1);
      assert.equal(await h.page.locator('.drawer .panel').count(), 1);
      assert.match(await h.page.locator('.drawer').innerText(), /LAI-103/);

      // The old full-viewport backdrop is gone with the old shell.
      assert.equal(await h.page.locator('.panel-backdrop').count(), 0);
    } finally {
      await h.close();
    }
  });
});
