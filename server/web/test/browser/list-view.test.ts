/**
 * The List view's geometry (LAI-256).
 *
 * The design's widths are exact numbers (prototype lines 166–203) and the
 * screen's frame is a *negative* fact: List has no right rail, no WORKING NOW
 * and no sprint chips, because the design wraps all three in `boardLive`
 * (line 2273). Ours had every one of them, which is what made List read as the
 * board with its middle swapped out.
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
};

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-9',
  number: 9,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: Date.now() - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

const BLOCKER = task({ id: 't1', key: 'LC-1', number: 1, title: 'The blocker' });
const BLOCKED = task({
  id: 't6',
  key: 'LC-6',
  number: 6,
  title: 'Org settings and org-role management',
  status: 'in_progress',
  priority: 'p1',
  assignee_id: 'u1',
  tags: ['auth', 'core'],
  blocked_by: ['t1'],
});

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: 1, todo: 0, in_progress: 1, review: 0, done: 0, cancelled: 0 },
        blocked_count: 1,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [BLOCKER, BLOCKED], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        is_agent: true,
        matched_task_id: null,
        project_ids: ['laika-core'],
        last_seen: Date.now(),
        repo: 'kvelld/laika',
        branch: 'lc-1',
      },
    ],
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the List view', () => {
  void test('uses the design’s column widths', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      const width = async (selector: string) =>
        Math.round((await h.page.locator(selector).first().boundingBox())?.width ?? -1);

      // The design's own figures: KEY 74 · STATUS 104 · PRI 42 · ASSIGNEE 150 ·
      // SPR 46 · UPDATED 84, with SUMMARY taking what is left.
      assert.equal(await width('.list-key'), 74, 'KEY');
      assert.equal(await width('.list-spr'), 46, 'SPR');
      assert.equal(await width('.list-updated'), 84, 'UPDATED');

      const summary = await width('.list-summary');
      assert.ok(summary > 200, `SUMMARY collapsed to ${String(summary)}px`);
    } finally {
      await h.close();
    }
  });

  void test('carries none of the board’s chrome', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      /*
       * **Positive control first.** Every assertion below is an absence, and a
       * page that failed to render would satisfy all three — the blank-login
       * defect of LAI-251, which passed for exactly that reason. So: prove the
       * screen is really here before proving what is not.
       */
      assert.equal(await h.page.locator('.list-row').count(), 2, 'the rows must be present');

      /*
        The rail is nobody's now: LAI-281 moved those panels to the Activity
        tab and left the board plain, so this asserts the *space* chrome — the
        presence strip and the sprint chips — which is still the board's alone.
      */
      assert.equal(await h.page.locator('.presence').count(), 0, 'WORKING NOW is the board’s');
      assert.equal(await h.page.locator('.strip').count(), 0, 'the sprint chips are the board’s');

      // And the board still has all three, or the fix went too far.
      await h.page.goto(`${h.origin}/board?project=laika-core`);
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.presence').count(), 1, 'the board lost WORKING NOW');
      // Not the sprint chips: this stub has no sprints, so their absence is the
      // fixture rather than the board. The lanes are the board's own chrome.
      assert.ok((await h.page.locator('.lane').count()) >= 4, 'the board lost its lanes');
    } finally {
      await h.close();
    }
  });

  void test('renders the blocker’s key and the design’s status pill', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      const blocked = h.page
        .locator('.list-row')
        .filter({ has: h.page.locator('.list-key', { hasText: 'LC-6' }) });

      assert.equal(await blocked.locator('.list-blocked').innerText(), 'blocked by LC-1');
      assert.equal(await blocked.locator('.list-labels').innerText(), 'auth, core');
      assert.equal(await blocked.locator('.list-pri').innerText(), 'P1');
      assert.equal(await blocked.locator('.list-status').innerText(), 'In progress');

      // The pill is a bordered box, not bare text — the design's treatment.
      const pill = await blocked.locator('.list-status').evaluate((el) => {
        const s = getComputedStyle(el);
        return { radius: s.borderTopLeftRadius, border: s.borderTopWidth };
      });
      assert.equal(pill.radius, '5px');
      assert.equal(pill.border, '1px');
    } finally {
      await h.close();
    }
  });

  void test('a row opens the task drawer', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.list-row').first().click();
      await h.page.waitForURL(/task=/, { timeout: 10_000 });
      await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('never pushes the page sideways, at any width', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      for (const width of [1440, 1280, 900, 420]) {
        await h.page.setViewportSize({ width, height: 900 });
        await h.page.waitForTimeout(150);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.equal(overflow, 0, `the page scrolls sideways at ${String(width)}px`);
      }
    } finally {
      await h.close();
    }
  });
});
