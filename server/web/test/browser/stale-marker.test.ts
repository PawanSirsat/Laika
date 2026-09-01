/**
 * The third §11.4.1 marker, rendered (LAI-157, harness by LAI-227).
 *
 * `blocked` and `ready` shipped with LAI-049; `stale` could not, because
 * `stale_flagged_at` was not on `TaskView` until LAI-208. This is the half that
 * draws it.
 *
 * **Why a browser rather than a source assertion.** The claim is *"the card
 * shows a stale marker in both themes"*, and reading `TaskCard.tsx` cannot
 * support it: a marker can be present in the source and invisible on the page —
 * clipped, zero-width, or painted in a colour one theme does not define. That
 * last one is the specific risk here, because the marker is the first card
 * element to use the amber family and a token missing from one theme resolves
 * to nothing rather than to an error.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const DAY = 86_400_000;
const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const TASK = {
  id: 't1',
  key: 'LAI-1',
  project_id: 'p1',
  number: 1,
  title: 'Nobody has touched this in a while',
  description_md: null,
  acceptance_md: null,
  status: 'in_progress',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
};

/** Flagged nine days ago. The marker must say *nine days*, not merely "stale". */
const STALE = { ...TASK, stale_flagged_at: Date.now() - 9 * DAY };
/** Never flagged. Present so "the marker is drawn" cannot pass by drawing always. */
const FRESH = {
  ...TASK,
  id: 't2',
  key: 'LAI-2',
  number: 2,
  title: 'Someone is on this',
  status: 'todo',
  ready: true,
};

function stub(tasks: readonly unknown[]): ApiStub {
  const project = {
    ...PROJECT,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
    task_counts: {
      backlog: 0,
      todo: 0,
      in_progress: tasks.length,
      review: 0,
      done: 0,
      cancelled: 0,
    },
    blocked_count: 0,
    member_count: 1,
    members: [{ user_id: 'u1', name: 'Ada' }],
    last_activity_at: 2,
  };
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    '/api/v1/projects': { data: [project], next_cursor: null },
    '/api/v1/projects/laika-core': project,
    '/api/v1/projects/laika-core/tasks': { data: tasks, next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
  };
}

void after(async () => {
  await closeBrowser();
});

void describe('the stale marker (§11.4.1)', () => {
  void test('it is drawn, it is visible, and it says how long', async () => {
    const h = await open('/board?project=laika-core', stub([STALE, FRESH]));
    try {
      // Prove the probe can see the board before asserting about a marker on it:
      // "no marker" and "no cards" would otherwise be the same green.
      const cards = h.page.locator('article.card');
      await cards.first().waitFor({ timeout: 15_000 });
      assert.equal(await cards.count(), 2, 'both cards must render or this proves nothing');

      const marker = h.page.locator('.marker-stale');
      assert.equal(await marker.count(), 1, 'exactly the flagged task carries the marker');

      const text = await marker.innerText();
      assert.match(
        text,
        /\b9d\b/,
        `the marker must say how long, not merely that it is stale — got "${text}"`,
      );

      // Present in the DOM is not the same as on the page.
      const box = await marker.boundingBox();
      assert.ok(box !== null && box.width > 0 && box.height > 0, 'the marker has no box');

      // **It fits on one line.** `stale 9d` is the first marker label with a
      // space in it, and in a narrow column it wrapped — turning the pill into
      // a two-line oval and pushing it past the card's edge. Every assertion
      // above passed while it did. Measured against `ready` rather than a pixel
      // constant, because the property is "same pill, one line", not a number:
      // a wrapped pill is about twice the height of an unwrapped one.
      // **And it stays inside the card.** This is the defect the screenshot
      // actually showed: with a third marker the footer row had no room and
      // nowhere to wrap, so the pill hung past the right edge into the lane
      // gutter. Containment is the property; the row's `flex-wrap` is the fix.
      const card = h.page.locator('article.card').filter({ hasText: 'LAI-1' }).first();
      const cardBox = await card.boundingBox();
      assert.ok(cardBox !== null, 'no card box to compare against');
      assert.ok(
        box.x >= cardBox.x && box.x + box.width <= cardBox.x + cardBox.width + 0.5,
        `the marker escapes the card: marker ends at ${String(box.x + box.width)}, card at ${String(cardBox.x + cardBox.width)}`,
      );

      const ready = h.page.locator('.marker-ready').first();
      await ready.waitFor({ timeout: 10_000 });
      const readyBox = await ready.boundingBox();
      assert.ok(readyBox !== null, 'no ready marker to measure against');
      assert.ok(
        box.height <= readyBox.height * 1.4,
        `the stale pill is ${String(box.height)}px against ready's ${String(readyBox.height)}px — it wrapped`,
      );
    } finally {
      await h.close();
    }
  });

  void test('a task that was never flagged carries no marker', async () => {
    const h = await open('/board?project=laika-core', stub([FRESH]));
    try {
      await h.page.locator('article.card').first().waitFor({ timeout: 15_000 });
      assert.equal(await h.page.locator('.marker-stale').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('it survives both themes, and is painted in each', async () => {
    const h = await open('/board?project=laika-core', stub([STALE]));
    try {
      const marker = h.page.locator('.marker-stale');
      await marker.waitFor({ timeout: 15_000 });

      const painted: Record<string, string> = {};
      for (const theme of ['Dark', 'Light']) {
        // The real control, never a class toggle: a JS-computed colour bug hides
        // from the shortcut, and the theme is what this test is about.
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        assert.equal(await marker.count(), 1, `the marker vanished in ${theme}`);
        const seen = await marker.evaluate((el) => {
          const s = getComputedStyle(el);
          return { color: s.color, background: s.backgroundColor };
        });

        // A token missing from one theme resolves to nothing, which paints as
        // transparent or inherits — both of which are "invisible", not "an error".
        assert.notEqual(seen.color, 'rgba(0, 0, 0, 0)', `${theme}: the text has no colour`);
        assert.notEqual(
          seen.background,
          'rgba(0, 0, 0, 0)',
          `${theme}: the pill has no background`,
        );
        painted[theme] = `${seen.color} on ${seen.background}`;
      }

      // Amber is defined twice in tokens.css — #b6740b light, #f0ac47 dark. If
      // the two themes paint identically, the marker is not reading the token.
      assert.notEqual(
        painted.Dark,
        painted.Light,
        `the marker paints the same in both themes (${String(painted.Light)}), so it is not token-driven`,
      );
    } finally {
      await h.close();
    }
  });
});
