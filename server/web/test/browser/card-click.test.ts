/**
 * Clicking a task card opens it (LAI-424, harness by LAI-227).
 *
 * The owner's words were *"im not able to click on the task"*. The only
 * interactive element in a card was a ~50px key covering **3.6%** of it; the
 * title and the whitespace did nothing.
 *
 * **This is the test AC7 asked for and could not have.** It clicks the card
 * *body* — not the key — in a real browser, so it exercises the geometry the
 * fix actually lives in. Shown red against the pre-fix commit before being kept.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const TASK = {
  id: 't1',
  key: 'LAI-1',
  project_id: 'p1',
  number: 1,
  title: 'The card body must open this task',
  description_md: null,
  acceptance_md: null,
  status: 'todo',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: true,
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

/** The blocker: not done, so it genuinely holds the other task up. */
const BLOCKER = {
  ...TASK,
  id: 't2',
  key: 'LAI-2',
  number: 2,
  title: 'The blocker',
  blocked_by: [],
};
const BLOCKED = { ...TASK, id: 't1', blocked_by: ['t2'], ready: false };

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': {
    data: [
      {
        ...PROJECT,
        description: null,
        repo: null,
        visibility: 'private',
        context_md: '',
        archived_at: null,
        created_at: 1,
        updated_at: 1,
        task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [{ user_id: 'u1', name: 'Ada' }],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': {
    ...PROJECT,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
    task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
    blocked_count: 0,
    member_count: 1,
    members: [{ user_id: 'u1', name: 'Ada' }],
    last_activity_at: 2,
  },
  '/api/v1/projects/laika-core/tasks': { data: [BLOCKED, BLOCKER], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

void after(async () => {
  await closeBrowser();
});

void describe('the whole card opens the task', () => {
  void test('clicking the card body — not the key — opens the panel', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const card = h.page.locator('article.card').first();
      await card.waitFor({ timeout: 15_000 });

      // Prove the probe can see the thing before asserting about it: the title
      // must exist, or "the click did nothing" would be indistinguishable from
      // "there was nothing to click".
      const title = card.locator('.card-title');
      assert.equal(await title.count(), 1, 'no card title — this test would prove nothing');

      // The geometry that matters: the pixels over the title must belong to the
      // open control. This is what `elementFromPoint` can answer and jsdom
      // cannot — it has no layout.
      const box = await title.boundingBox();
      assert.ok(box !== null && box.width > 0, 'the title has no layout box');
      const point: readonly [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
      const opensCard = await h.page.evaluate(
        ([x, y]: readonly [number, number]) =>
          document.elementFromPoint(x, y)?.closest('.card-open') != null,
        point,
      );
      assert.ok(opensCard, 'the pixels over the card title do not belong to the open control');

      // And the click itself.
      await card.click();
      await h.page.waitForURL(/task=/, { timeout: 10_000 });
      assert.match(h.page.url(), /task=t1/, 'clicking the card did not open the task');
    } finally {
      await h.close();
    }
  });
});

void describe('a blocked task still shows as blocked after the rename', () => {
  void test('the card names what is holding it up, in both themes', async () => {
    // LAI-429 AC4. **A rename that compiles is not a rename that works**: the
    // field feeds `blockedState` and `blockers`, and a card that silently
    // stopped showing "blocked by" would typecheck perfectly.
    const h = await open('/board?project=laika-core', STUB);
    try {
      const blocked = h.page.locator('.card-blocked').first();
      await blocked.waitFor({ timeout: 15_000 });

      const text = await blocked.innerText();
      assert.match(text, /LAI-2|blocker/i, `the card does not name its blocker: ${text}`);

      // Both themes, driven through the real control rather than a class
      // toggle — a JS-computed colour bug hides from the shortcut.
      for (const theme of ['Dark', 'Light']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);
        assert.equal(
          await h.page.locator('.card-blocked').count(),
          1,
          `the blocked marker vanished in ${theme}`,
        );
      }
    } finally {
      await h.close();
    }
  });
});
