/**
 * The board's View settings panel (LAI-266).
 *
 * The assertion that carries this file is `count() === 0`, and the choice is
 * deliberate: **`count()` is a DOM query, so a `display: none` node still counts
 * one.** A visibility check would pass for a card that still rendered every
 * field and merely hid them, which is the implementation this rules out —
 * hidden-but-present costs render work on every card and leaves a
 * `:nth-child` trap in `.card-foot`'s wrapping row.
 *
 * `.card-title` is counted alongside, in both states, so the test cannot be
 * satisfied by CSS that hides everything.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';

const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const FULL_PROJECT = {
  ...PROJECT,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada' }],
  last_activity_at: 2,
};

const TASK = {
  id: 't1',
  key: 'LAI-1',
  project_id: 'p1',
  number: 1,
  title: 'A task with every field populated',
  description_md: null,
  acceptance_md: null,
  status: 'todo',
  priority: 'p1',
  assignee_id: 'u1',
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: false,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: ['agent'],
  comment_count: 3,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
};

const COLUMNS = [
  {
    id: 'c1',
    project_id: 'p1',
    name: 'To do',
    position: 0,
    hidden: false,
    statuses: ['todo', 'backlog'],
    primary_status: 'todo',
  },
  {
    id: 'c2',
    project_id: 'p1',
    name: 'Done',
    position: 1,
    hidden: false,
    statuses: ['done'],
    primary_status: 'done',
  },
];

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [FULL_PROJECT], next_cursor: null },
  '/api/v1/projects/laika-core': FULL_PROJECT,
  '/api/v1/projects/laika-core/board-columns': { columns: COLUMNS },
  '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/presence': { data: [], next_cursor: null },
};

async function openPanel(h: Harness): Promise<void> {
  await h.page.waitForSelector('.card-title');
  // The trigger moved into the board toolbar's icon cluster (LAI-290), where
  // Jira puts it — it used to be a text button in the slot below the bar.
  await h.page.locator('.bt-icon[title="View settings"]').click();
  await h.page.waitForSelector('.view-settings');
}

after(async () => {
  await closeBrowser();
});

void describe('toggling a card field', () => {
  void test('removes it from the DOM rather than hiding it', async () => {
    const h = await open('/board?project=laika-core', STUB);

    try {
      await openPanel(h);

      assert.equal(await h.page.locator('.card-age').count(), 1, 'the field was not there to hide');
      const titlesBefore = await h.page.locator('.card-title').count();

      await h.page.locator('.vs-remove[data-field="age"]').click();
      await h.page.waitForTimeout(120);

      assert.equal(
        await h.page.locator('.card-age').count(),
        0,
        'the field is hidden, not removed — a display:none node still counts 1',
      );
      assert.equal(
        await h.page.locator('.card-title').count(),
        titlesBefore,
        'the card itself went with it, so this proves nothing',
      );

      // And back, so the test covers both values rather than one direction.
      // Back on through the search, which is how the reference adds a field.
      await h.page.locator('.vs-search').fill('Last updated');
      await h.page.locator('.vs-add').first().click();
      await h.page.waitForTimeout(120);
      assert.equal(await h.page.locator('.card-age').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('survives a reload, and does not travel in the URL', async () => {
    const h = await open('/board?project=laika-core', STUB);

    try {
      await openPanel(h);
      await h.page.locator('.vs-remove[data-field="tags"]').click();
      await h.page.waitForTimeout(120);

      const url = h.page.url();
      assert.ok(!url.includes('tags'), 'a display preference must not be in a link you send');

      await h.page.reload();
      await h.page.waitForSelector('.card-title');

      assert.equal(
        await h.page.locator('.card-tag').count(),
        0,
        'the preference did not survive a reload',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the fields that are not optional', () => {
  void test('have no checkbox at all, and the panel says why', async () => {
    // Absent rather than greyed: a disabled control invites a hunt for the
    // reason. See `card-fields.ts` for the argument on each one.
    const h = await open('/board?project=laika-core', STUB);

    try {
      await openPanel(h);

      /*
       * **Listed with a disabled `×`, not absent** — the reference greys
       * `Summary` the same way, and a field that is simply missing from the
       * list reads as an oversight rather than a decision.
       */
      for (const field of ['title', 'key', 'blocked', 'deps-unknown']) {
        const row = h.page.locator(`.vs-remove[data-field="${field}"]`);
        assert.equal(await row.count(), 1, `${field} should be listed`);
        assert.equal(await row.isDisabled(), true, `${field} must not be removable`);

        // And it says why, rather than leaving a dead control to puzzle over.
        const why = await row.getAttribute('title');
        assert.ok((why ?? '').length > 10, `${field} gives no reason`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('grouping', () => {
  void test('goes in the URL, because a grouped board is a link', async () => {
    const h = await open('/board?project=laika-core', STUB);

    try {
      await openPanel(h);
      await h.page.locator('input[name="vs-group"]').nth(1).check();
      await h.page.waitForTimeout(150);

      assert.match(h.page.url(), /group=assignee/);
    } finally {
      await h.close();
    }
  });

  void test('keeps the columns, and keeps drag working inside them', async () => {
    /*
     * **The correction LAI-290 exists for.** LAI-266's grouping replaced the
     * columns and therefore had to switch drag off. A swimlane keeps them, so
     * a drop still means status and still works.
     */
    const h = await open('/board?project=laika-core&group=assignee', STUB);

    try {
      await h.page.waitForSelector('.card-title');

      assert.ok((await h.page.locator('.swim').count()) >= 1, 'no swimlane rendered');
      assert.equal(
        await h.page.locator('.swim').first().locator('.lane').count(),
        COLUMNS.length,
        'a swimlane lost the columns',
      );

      assert.equal(
        await h.page.locator('.card').first().getAttribute('draggable'),
        'true',
        'cards must still move between columns while grouped',
      );

      // Drawn once, not once per row — columns are project-level. The grip
      // icon is gone (LAI-605); the draggable header is the control now, and
      // only the first row's headers may carry it.
      assert.equal(
        await h.page.locator('.lane-head-drag').count(),
        COLUMNS.length,
        'column controls should be on the first row only',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('column width', () => {
  void test('narrows the lanes through one custom property', async () => {
    const h = await open('/board?project=laika-core', STUB);

    try {
      await openPanel(h);
      const before = await h.page
        .locator('.lane')
        .first()
        .evaluate((el) => el.clientWidth);

      await h.page.locator('input[name="vs-width"]').first().check();
      await h.page.waitForTimeout(150);

      const after = await h.page
        .locator('.lane')
        .first()
        .evaluate((el) => el.clientWidth);
      assert.ok(
        after <= before,
        `narrow should not widen the lanes: ${String(before)} → ${String(after)}`,
      );
    } finally {
      await h.close();
    }
  });
});
