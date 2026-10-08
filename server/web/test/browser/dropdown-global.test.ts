/**
 * The app's own dropdown everywhere a native `<select>` used to be (LAI-726).
 *
 * The Filter popover has its own file (`filter-dropdown.test.ts`). This one
 * drives the control in the other kinds of place it now lives, each of which
 * can break it differently:
 *
 * - **a modal dialog** that closes on Escape — Escape must close only the
 *   dropdown, and its portalled panel must draw above the dialog;
 * - **a composer inside a lane** that closes on Escape and posts what was
 *   chosen;
 * - **a board card**, whose keyboard-only move control is clipped until
 *   focused, and whose own click opens the task — an option's click must not;
 * - **a form field** (`Select`), named and opened by its `<label>`.
 *
 * Every test here fails on the code before LAI-726: there is no
 * `role="listbox"` panel to open, which the first step of each asserts.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator } from 'playwright';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';
import { pick, valueOf } from './dropdown.ts';

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
  title: 'Something already on the board',
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
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: true,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
};

const column = (id: string, name: string, position: number, statuses: string[]) => ({
  id,
  project_id: 'p1',
  name,
  position,
  hidden: false,
  statuses,
  primary_status: statuses[0] ?? null,
});

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
  '/api/v1/projects/laika-core/board-columns': {
    columns: [
      column('c1', 'To do', 0, ['todo', 'backlog']),
      column('c2', 'In progress', 1, ['in_progress']),
      column('c3', 'Done', 2, ['done']),
    ],
  },
  '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
  '/api/v1/tasks/t1/status': { ...TASK, status: 'done' },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/presence': { data: [], next_cursor: null },
};

void after(async () => {
  await closeBrowser();
});

const panel = (h: Harness) => h.page.locator('[data-dropdown-panel]');

const isFocused = (l: Locator): Promise<boolean> =>
  l.evaluate((el) => el === document.activeElement);

/** The panel is a listbox and is the thing actually drawn at its own centre. */
async function assertOnTop(h: Harness, what: string): Promise<void> {
  assert.equal(await panel(h).getByRole('listbox').count(), 1, `${what}: no listbox panel`);
  const onTop = await panel(h).evaluate((p) => {
    const r = p.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && p.contains(hit);
  });
  assert.equal(onTop, true, `${what}: the panel is drawn under something`);
}

void describe('the dropdown in a modal dialog (LAI-726)', () => {
  void test('Escape closes only the dropdown, and choosing keeps the dialog open', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.lane-title').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.lane-new').click();
      const dialog = h.page.getByRole('dialog', { name: 'Create status' });
      await dialog.waitFor({ timeout: 5_000 });

      // Named by its <label>, hint and all — as the <select> was.
      const category = dialog.getByRole('combobox', { name: /^Status category/ });
      await category.click();
      await assertOnTop(h, 'over the dialog');

      await h.page.keyboard.press('Escape');
      assert.equal(await panel(h).count(), 0, 'Escape left the dropdown open');
      assert.equal(await dialog.count(), 1, 'Escape closed the dialog with the dropdown');
      assert.equal(await isFocused(category), true, 'focus did not return to the trigger');

      await pick(category, '');
      assert.equal(await valueOf(category), '');
      assert.equal((await category.innerText()).trim(), 'Nothing yet');
      assert.equal(await dialog.count(), 1, 'choosing an option closed the dialog');

      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown in a lane’s composer (LAI-726)', () => {
  void test('Escape keeps the composer, and the chosen priority is the one posted', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.lane-title').first().waitFor({ timeout: 20_000 });
      await h.page
        .locator('.lane', { has: h.page.locator('.lane-title', { hasText: 'Done' }) })
        .locator('.lane-add')
        .click();
      await h.page.locator('.composer-title').fill('A finished thing');

      const priority = h.page.locator('.composer-prio').getByRole('combobox');
      await priority.click();
      await assertOnTop(h, 'over the board');
      await h.page.keyboard.press('Escape');
      assert.equal(await panel(h).count(), 0, 'Escape left the dropdown open');
      assert.equal(
        await h.page.locator('.composer-title').count(),
        1,
        'Escape closed the composer',
      );

      await pick(priority, 'p1');
      await h.page.locator('.composer-submit').click();
      await h.page
        .waitForFunction(() => document.querySelector('.composer-title') === null, undefined, {
          timeout: 5_000,
        })
        .catch(() => undefined);
      const sent = h.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tasks'));
      assert.equal(sent.length, 1, 'no create was sent');
      assert.equal((sent[0]?.body as { priority?: string }).priority, 'p1');
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown on a board card (LAI-726)', () => {
  void test('the keyboard move control moves the task and does not open it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      const move = h.page.getByRole('combobox', { name: 'Move LAI-1 to', exact: true });

      // From the keyboard, the only way it is reached.
      await move.focus();
      await h.page.keyboard.press('ArrowDown');
      await assertOnTop(h, 'over the lanes');
      assert.equal(await isFocused(move), true, 'opening moved focus off the card control');

      // An option's click: the card's own click must not take it.
      await panel(h).locator('[role="option"][data-value="done"]').click();
      await h.page.waitForFunction(
        () => document.querySelector('[data-dropdown-panel]') === null,
        undefined,
        { timeout: 5_000 },
      );
      const moves = h.calls.filter(
        (c) => c.method === 'POST' && c.path === '/api/v1/tasks/t1/status',
      );
      assert.equal(moves.length, 1, 'no move was sent');
      assert.equal((moves[0]?.body as { status?: string }).status, 'done');
      assert.equal(
        new URL(h.page.url()).searchParams.get('task'),
        null,
        'choosing an option opened the task',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown as a form field (LAI-726)', () => {
  void test('its label names and opens it, and the choice is what the form sends', async () => {
    const h = await open('/projects', STUB);
    try {
      await h.page.getByRole('button', { name: 'New space' }).click();
      const visibility = h.page.getByRole('combobox', { name: 'Visibility', exact: true });
      await visibility.waitFor({ timeout: 10_000 });

      // A click on the words opens it, as it focused the <select>.
      await h.page.locator('label', { hasText: 'Visibility' }).click();
      await assertOnTop(h, 'in the form');
      await panel(h).locator('[role="option"][data-value="public"]').click();
      assert.equal(await valueOf(visibility), 'public');
      assert.match(await visibility.innerText(), /Public/);

      await h.page.getByRole('textbox', { name: 'Name', exact: true }).fill('Routing');
      await h.page.getByRole('button', { name: 'Create project' }).click();
      await h.page
        .waitForFunction(() => document.querySelector('[aria-busy="true"]') === null)
        .catch(() => undefined);
      const posted = h.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/projects');
      assert.equal(posted.length, 1, 'no project was posted');
      assert.equal((posted[0]?.body as { visibility?: string }).visibility, 'public');
    } finally {
      await h.close();
    }
  });
});
