/**
 * Selecting rows and acting on them in the List (LAI-496).
 *
 * The owner's two Jira screenshots: a checkbox per row and in the header, a
 * status pill that is a menu, and a bar once anything is selected. Every
 * assertion here is on a request the page made or a word on the screen —
 * what a bulk action *sent*, and what it *said* about the one that was
 * refused.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  applyStatusWrite,
  asServed,
  closeBrowser,
  open,
  refuse,
  type ApiStub,
  type StubCall,
  until,
} from './harness.ts';

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

const STATUSES = ['backlog', 'done', 'in_progress', 'todo', 'review'] as const;

/** Sixty tasks: one page of fifty and ten more, so *Select all* has work to do. */
const TASKS = Array.from({ length: 60 }, (_, i) => {
  const n = i + 1;
  return asServed({
    id: `t${String(n)}`,
    key: `LC-${String(n)}`,
    number: n,
    project_id: 'laika-core',
    title: `Task number ${String(n)}`,
    description_md: '',
    acceptance_md: '',
    // LC-1 backlog, LC-2 done, LC-3 in_progress — the three the bulk test picks.
    status: STATUSES[i % STATUSES.length],
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
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    created_at: 1,
    // Newest first is the default order; LC-1 is the newest, so it is row one.
    updated_at: Date.now() - n * 60_000,
    started_at: null,
    completed_at: null,
  });
});

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

/** `POST /tasks/:id/status` for every task: LC-2 refuses, the rest answer the moved task. */
const STATUS_ROUTES: Record<string, unknown> = Object.fromEntries(
  TASKS.map((task) => [
    `/api/v1/tasks/${task.id}/status`,
    (call: StubCall) =>
      task.key === 'LC-2'
        ? refuse(422, 'unprocessable', 'Cannot move a task from done to in_progress')
        : (() => {
            const moved = { ...task };
            applyStatusWrite(moved, call.body);
            return moved;
          })(),
  ]),
);

const stub = (me: typeof ME): ApiStub => ({
  '/api/v1/me': me,
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: 12, todo: 12, in_progress: 12, review: 12, done: 12, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: TASKS, next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
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
  ...STATUS_ROUTES,
});

const STUB = stub(ME);

/** `innerText` breaks a flex row's children onto lines; one space is what a reader sees. */
const text = async (locator: { innerText: () => Promise<string> }) =>
  (await locator.innerText()).replace(/\s+/g, ' ').trim();

void after(async () => {
  await closeBrowser();
});

void describe('selecting rows in the List', () => {
  void test('a row checkbox selects the row and does not open it', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      await h.page.getByLabel('Select LC-1', { exact: true }).check();

      assert.equal(await text(h.page.locator('.list-bulk-count')), '1 selected');
      const row = h.page.locator('.list-row', {
        has: h.page.getByLabel('Select LC-1', { exact: true }),
      });
      assert.ok(
        (await row.getAttribute('class'))?.includes('list-row-selected'),
        'the selected row is not tinted',
      );
      assert.ok(!h.page.url().includes('task='), 'the checkbox opened the drawer');

      // And off again, which takes the bar with it.
      await h.page.getByLabel('Select LC-1', { exact: true }).uncheck();
      assert.equal(await h.page.locator('.list-bulk').count(), 0, 'the bar outlived the selection');
    } finally {
      await h.close();
    }
  });

  void test('the header checkbox takes the page, and Select all takes every filtered row', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      await h.page.getByLabel('Select every task on this page', { exact: true }).check();
      assert.equal(await text(h.page.locator('.list-bulk-count')), '50 selected');

      const all = h.page.locator('.list-bulk-all');
      assert.equal(await text(all), 'Select all 60');
      await all.click();

      assert.equal(await text(h.page.locator('.list-bulk-count')), '60 selected');
      assert.equal(await all.count(), 0, 'Select all is still offered with everything selected');

      // Page two's rows are selected too, which is what "all" was for.
      await h.page.locator('.list-page-button', { hasText: 'Next' }).click();
      assert.ok(
        await h.page.getByLabel('Select LC-60', { exact: true }).isChecked(),
        'LC-60 on page two is not selected',
      );

      // The header clears a fully selected page and leaves the other page alone.
      await h.page.getByLabel('Select every task on this page', { exact: true }).uncheck();
      assert.equal(await text(h.page.locator('.list-bulk-count')), '50 selected');
    } finally {
      await h.close();
    }
  });

  void test('a bulk status change posts once per task that needs it, and names the refusal', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      // LC-1 is backlog, LC-2 is done (the stub refuses it), LC-3 is already in progress.
      await h.page.getByLabel('Select LC-1', { exact: true }).check();
      await h.page.getByLabel('Select LC-2', { exact: true }).check();
      await h.page.getByLabel('Select LC-3', { exact: true }).check();
      assert.equal(await text(h.page.locator('.list-bulk-count')), '3 selected');

      const before = h.calls.length;
      await h.page.locator('.list-bulk-action', { hasText: 'Status' }).click();
      await h.page.locator('.list-menu-item', { hasText: 'In progress' }).click();

      const summary = h.page.locator('.list-bulk-summary');
      await summary.waitFor({ timeout: 10_000 });
      assert.equal(
        (await text(summary)).replace(' Dismiss', ''),
        '1 updated, 1 refused, 1 already there',
      );
      const refusals = h.page.locator('.list-bulk-refusal');
      await until(
        async () =>
          (await refusals.allInnerTexts()).join('|') ===
          'LC-2 — Cannot move a task from done to in_progress',
      );
      assert.deepEqual(await refusals.allInnerTexts(), [
        'LC-2 — Cannot move a task from done to in_progress',
      ]);

      // One toast for the run (LAI-1310): an error, because one was refused,
      // naming it by key in the server's words. The report above stays — its
      // list is what the reader goes and fixes.
      const toast = h.page.locator('[data-toast][data-tone="error"]');
      await toast.waitFor({ timeout: 5_000 });
      assert.equal(
        (await toast.locator('[role="alert"]').innerText()).replace(/\s+/g, ' ').trim(),
        '1 of 2 moved — 1 refused ' +
          'LC-2: Cannot move a task from done to in_progress · 1 already there.',
      );

      const posts = h.calls
        .slice(before)
        .filter((c) => c.method === 'POST')
        .map((c) => [c.path, c.body]);
      assert.deepEqual(posts, [
        ['/api/v1/tasks/t1/status', { status_id: 'st-in_progress' }],
        ['/api/v1/tasks/t2/status', { status_id: 'st-in_progress' }],
      ]);

      // The board refetched afterwards, so every row is the server's again.
      const refetches = h.calls
        .slice(before)
        .filter((c) => c.method === 'GET' && c.path === '/api/v1/projects/laika-core/tasks');
      assert.ok(refetches.length >= 1, 'no refetch after the bulk action');

      // The selection and the report both survived that reload.
      assert.equal(await text(h.page.locator('.list-bulk-count')), '3 selected');
    } finally {
      await h.close();
    }
  });

  void test('a bulk change that all lands is one success toast, and no report to dismiss', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      // LC-1 is backlog and LC-6 is backlog: both may go to To do.
      await h.page.getByLabel('Select LC-1', { exact: true }).check();
      await h.page.getByLabel('Select LC-6', { exact: true }).check();
      await h.page.locator('.list-bulk-action', { hasText: 'Status' }).click();
      await h.page.locator('.list-menu-item', { hasText: 'To do' }).click();

      const toast = h.page.locator('[data-toast][data-tone="success"]');
      await toast.waitFor({ timeout: 10_000 });
      assert.equal(
        (await toast.locator('.toast-text').innerText()).trim(),
        'Moved 2 tasks to To do',
      );
      // The toast says all the report would have, so the report is not drawn.
      await until(async () => (await h.page.locator('.list-bulk-report').count()) === 0);
      assert.equal(await h.page.locator('.list-bulk-report').count(), 0);
      assert.equal(await text(h.page.locator('.list-bulk-count')), '2 selected');
    } finally {
      await h.close();
    }
  });

  void test('the status pill moves one task where it stands', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      const row = h.page.locator('.list-row', {
        has: h.page.getByLabel('Select LC-1', { exact: true }),
      });
      await row.locator('.list-status-button').click();

      const menu = h.page.locator('.list-menu');
      await menu.waitFor();
      // The task's own status is offered first, ticked, and never sent.
      const current = menu.locator('.list-menu-current');
      assert.equal(await text(current), 'Backlog');
      assert.equal(await current.locator('.list-menu-tick svg').getAttribute('data-icon'), 'check');
      assert.ok(!h.page.url().includes('task='), 'opening the menu opened the drawer');

      await menu.locator('.list-menu-item', { hasText: 'To do' }).click();

      await row.locator('.list-status', { hasText: 'To do' }).waitFor({ timeout: 10_000 });
      const posts = h.calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]);
      assert.deepEqual(posts, [['/api/v1/tasks/t1/status', { status_id: 'st-todo' }]]);
      // The board's toast, the same as a drag's (LAI-1310).
      const toast = h.page.locator('[data-toast][data-board-move][data-tone="success"]');
      await toast.waitFor({ timeout: 5_000 });
      assert.equal((await toast.locator('.toast-text').innerText()).trim(), 'LC-1 moved to To do');
      assert.equal(
        await h.page.locator('.list-bulk').count(),
        0,
        'a single move is not a selection',
      );
    } finally {
      await h.close();
    }
  });

  void test('a viewer gets no checkboxes and a plain pill', async () => {
    const h = await open(
      '/list?project=laika-core',
      stub({ ...ME, org_role: 'viewer', memberships: [] }),
    );
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      // Positive control: the rows are really here before the absences count.
      // Wait for the count it asserts, not the first row (LAI-715).
      await until(async () => (await h.page.locator('.list-row').count()) === 50);
      assert.equal(await h.page.locator('.list-row').count(), 50);
      await until(async () => (await h.page.locator('.list-status').count()) >= 50);
      assert.ok((await h.page.locator('.list-status').count()) >= 50, 'no status pills');

      assert.equal(
        await h.page.locator('.list-check').count(),
        0,
        'a viewer was offered checkboxes',
      );
      assert.equal(
        await h.page.locator('.list-status-button').count(),
        0,
        'a viewer was offered a status menu',
      );
      assert.equal(await h.page.locator('.list-bulk').count(), 0);
    } finally {
      await h.close();
    }
  });
});
