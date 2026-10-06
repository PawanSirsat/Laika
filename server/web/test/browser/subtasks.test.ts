/**
 * Subtasks on the board, the list and in the drawer (D-066, LAI-495).
 *
 * Mostly about **which request goes out** and **what is absent**: the section
 * asks the server for the children rather than trusting the page, a detach is
 * a PATCH with `null`, an add is a POST with the parent's id, and the two
 * filters hide the right rows while the parent's `n/m` keeps counting.
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

const NOW = Date.now();
const JUL_12 = Date.UTC(2026, 6, 12);

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
  created_via: 'api',
  created_by_client: null,
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
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

/** Past due and still open: the red chip on the card and the List. */
const PARENT = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Review legal pages',
  due_on: JUL_12,
});
const DONE = task({
  id: 't2',
  key: 'LC-2',
  number: 2,
  title: 'Privacy policy',
  parent_task_id: 't1',
  status: 'done',
});
const OPEN = task({
  id: 't3',
  key: 'LC-3',
  number: 3,
  title: 'Terms and conditions',
  parent_task_id: 't1',
  status: 'in_progress',
  assignee_id: 'u1',
});
/** Due next year: a date on the card, not red. */
const OTHER = task({
  id: 't4',
  key: 'LC-4',
  number: 4,
  title: 'Unrelated',
  due_on: JUL_12 + 365 * 86_400_000,
});
/** Not on the board's page — only the server knows it is LC-1's. */
const HIDDEN = task({
  id: 't5',
  key: 'LC-5',
  number: 5,
  title: 'Cookie policy, filtered off the board',
  parent_task_id: 't1',
});

const empty = { data: [], next_cursor: null };

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
        task_counts: { backlog: 2, todo: 0, in_progress: 1, review: 0, done: 1, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  // The board's own page, and the section's question — told apart by query.
  '/api/v1/projects/laika-core/tasks?limit=200': {
    data: [PARENT, DONE, OPEN, OTHER],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/tasks?parent=t1&limit=200': {
    data: [DONE, OPEN, HIDDEN],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
  '/api/v1/projects/laika-core/sprints': empty,
  '/api/v1/projects/laika-core/activity': empty,
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/tasks/t1': PARENT,
  '/api/v1/tasks/t1/comments': empty,
  '/api/v1/tasks/t1/watchers': { watchers: [] },
  '/api/v1/tasks/t3': OPEN,
  '/api/v1/tasks/t3/comments': empty,
  '/api/v1/tasks/t3/watchers': { watchers: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

async function drawer(h: Awaited<ReturnType<typeof open>>): Promise<void> {
  await h.page.locator('.drawer').waitFor({ timeout: 20_000 });
  await h.page.locator('.panel-meta').waitFor({ timeout: 10_000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('the Subtasks section', () => {
  void test('shows the parent’s progress, and asks the server for the children', async () => {
    const h = await open('/board?project=laika-core&task=t1', STUB);
    try {
      await drawer(h);
      const section = h.page.locator('.sub-section');
      // The server's answer, not the page's: LC-5 is on no card and still listed.
      await section.locator('.sub-row', { hasText: 'LC-5' }).waitFor({ timeout: 10_000 });
      assert.equal(await section.locator('.sub-row').count(), 3);
      assert.match(await section.locator('.sub-count').innerText(), /1\/3 done/);
      const bar = section.locator('.sub-progress');
      assert.equal(await bar.getAttribute('aria-valuenow'), '1');
      assert.equal(await bar.getAttribute('aria-valuemax'), '3');
      assert.equal(h.unmatched.length, 0, h.unmatched.join(', '));
    } finally {
      await h.close();
    }
  });

  void test('a row opens the child, which has the breadcrumb and no section of its own', async () => {
    const h = await open('/board?project=laika-core&task=t1', STUB);
    try {
      await drawer(h);
      await h.page.locator('.sub-row', { hasText: 'LC-3' }).locator('.sub-open').click();
      await h.page.waitForTimeout(300);
      assert.match(h.page.url(), /task=t3/);
      await h.page.locator('.panel-crumb-parent').waitFor({ timeout: 10_000 });
      assert.match(await h.page.locator('.panel-crumbs').innerText(), /LC-1\s*\/\s*LC-3/);
      // One level: a subtask offers no subtasks.
      assert.equal(await h.page.locator('.sub-section').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Add subtask POSTs the title with the parent’s id, and × PATCHes null', async () => {
    const h = await open('/board?project=laika-core&task=t1', STUB);
    try {
      await drawer(h);
      await h.page.locator('.sub-link').click();
      await h.page.locator('#sub-title').fill('Refund policy');
      await h.page.locator('#sub-title').press('Enter');
      await h.page.waitForTimeout(400);

      const post = h.calls.find(
        (c) => c.method === 'POST' && c.path === '/api/v1/projects/laika-core/tasks',
      );
      assert.ok(post !== undefined, 'no POST went out');
      assert.deepEqual(post.body, {
        title: 'Refund policy',
        created_via: 'web',
        parent_task_id: 't1',
      });

      await h.page.locator('.sub-row', { hasText: 'LC-3' }).locator('.dep-remove').click();
      await h.page.waitForTimeout(400);
      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3');
      assert.ok(patch !== undefined, 'no PATCH went out');
      assert.deepEqual(patch.body, { parent_task_id: null });
    } finally {
      await h.close();
    }
  });
});

void describe('subtasks and due dates on the cards', () => {
  const byKey = (h: Awaited<ReturnType<typeof open>>, key: string) =>
    h.page
      .locator('.card')
      .filter({ has: h.page.locator('.card-key', { hasText: new RegExp(`^${key}\\b`) }) });
  /** A marker is a flex row, and `innerText` breaks its items onto lines. */
  const text = async (locator: ReturnType<typeof byKey>) =>
    (await locator.innerText()).replace(/\s+/g, ' ').trim();

  void test('a parent counts, a child names its parent, a past date is red and a future one is not', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      // Off the page, counted off the page: the board sees two children, one done.
      assert.equal(await text(byKey(h, 'LC-1').locator('.card-subtasks')), '↳ 1/2');
      assert.equal(await text(byKey(h, 'LC-3').locator('.card-parent')), '↳ LC-1');
      assert.equal(await byKey(h, 'LC-4').locator('.card-parent').count(), 0);

      const due = byKey(h, 'LC-1').locator('.card-due');
      assert.match(await due.innerText(), /12 Jul 2026/);
      assert.ok(await due.evaluate((el) => el.classList.contains('card-due-overdue')));
      const later = byKey(h, 'LC-4').locator('.card-due');
      assert.equal(await later.count(), 1);
      assert.ok(!(await later.evaluate((el) => el.classList.contains('card-due-overdue'))));
    } finally {
      await h.close();
    }
  });

  void test('Top-level only hides the children and keeps the parent’s count', async () => {
    const h = await open('/board?project=laika-core&top=true', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(await byKey(h, 'LC-2').count(), 0);
      assert.equal(await byKey(h, 'LC-3').count(), 0);
      assert.equal(await byKey(h, 'LC-1').count(), 1);
      assert.equal(await text(byKey(h, 'LC-1').locator('.card-subtasks')), '↳ 1/2');
    } finally {
      await h.close();
    }
  });

  void test('both markers are card fields: off in View settings, they leave the DOM', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.card-subtasks').count(), 1, 'nothing to hide');
      assert.equal(await h.page.locator('.card-due').count(), 2, 'nothing to hide');

      await h.page.locator('.bt-icon[title="View settings"]').click();
      await h.page.locator('.vs-remove[data-field="subtasks"]').click();
      await h.page.locator('.vs-remove[data-field="due"]').click();
      await h.page.waitForTimeout(200);

      assert.equal(await h.page.locator('.card-subtasks').count(), 0);
      assert.equal(await h.page.locator('.card-parent').count(), 0);
      assert.equal(await h.page.locator('.card-due').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Overdue keeps only open work past its date', async () => {
    const h = await open('/board?project=laika-core&overdue=true', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(await byKey(h, 'LC-1').count(), 1);
      assert.equal(await byKey(h, 'LC-2').count(), 0, 'a done task is never overdue');
      assert.equal(await byKey(h, 'LC-3').count(), 0, 'no date, not overdue');
      assert.equal(await byKey(h, 'LC-4').count(), 0, 'not yet due');
    } finally {
      await h.close();
    }
  });
});

void describe('subtasks and due dates on the List', () => {
  void test('the sub-line names the parent, the Due column shows and sorts the date', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      const child = h.page.locator('.list-row', { hasText: 'LC-3' });
      assert.equal((await child.locator('.list-parent').innerText()).trim(), '↳ LC-1');

      const parent = h.page.locator('.list-row', { hasText: 'Review legal pages' });
      const due = parent.locator('.list-due');
      assert.match(await due.innerText(), /12 Jul 2026/);
      assert.ok(await due.evaluate((el) => el.classList.contains('list-tone-bad')));

      await h.page.locator('th', { hasText: 'Due' }).locator('button').click();
      await h.page.waitForTimeout(300);
      const first = await h.page.locator('.list-row').first().locator('.list-key').innerText();
      assert.match(first, /LC-1/, 'soonest due first');
      assert.match(h.page.url(), /sort=due/);
    } finally {
      await h.close();
    }
  });
});
