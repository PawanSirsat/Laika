/**
 * The task drawer on every view of a space, as a modal dialog (LAI-1190).
 *
 * B1: `SpaceLayout` mounted the drawer's frame on any `?task=`, but only the
 * board filled it — the Calendar and the Timeline opened an empty box. B3/B22:
 * the drawer said it was modal and held nothing, and Escape in its ⋯ menu
 * closed the whole drawer. B2/B18: a task link with no space. B4: Detach
 * fired at once and failed in silence. (B19, Create leaving the view, is the
 * Create task dialog's since LAI-1167: create-task-dialog.test.ts.)
 *
 * Every property here is about focus, layering or history — none of it is
 * visible to a source scan, which is why it is a browser test.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, until, type ApiStub, type Harness } from './harness.ts';

const DAY = 86_400_000;
const today = new Date();
/** A date-only value (D-066): the UTC midnight of the local date `days` from today. */
const dueIn = (days: number): number =>
  Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + days);

const PROJECT = {
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

const LISTED = {
  ...PROJECT,
  task_counts: { backlog: 0, todo: 3, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-0',
  number: 0,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'todo',
  priority: 'p2',
  position: null,
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
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
  updated_at: 1,
  started_at: null,
  completed_at: null,
  ...over,
});

const T1 = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Due on the calendar',
  due_on: dueIn(2),
});
const T2 = task({
  id: 't2',
  key: 'LC-2',
  number: 2,
  title: 'A subtask to detach',
  due_on: dueIn(3),
  parent_task_id: 't1',
});
const T3 = task({
  id: 't3',
  key: 'LC-3',
  number: 3,
  title: 'Planned in a sprint',
  sprint_id: 's1',
});

const SPRINT = {
  id: 's1',
  project_id: 'laika-core',
  name: 'Reliability',
  goal: 'Reliability goal',
  starts_on: Math.floor(Date.now() / DAY) * DAY + 15 * DAY,
  ends_on: Math.floor(Date.now() / DAY) * DAY + 28 * DAY,
  status: 'planned',
  created_at: 1,
  updated_at: 1,
  task_counts: {
    total: 1,
    by_status: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  },
};

/** What every task's panel reads, for each task the fixture holds. */
const perTask = (ids: readonly string[]): ApiStub =>
  Object.fromEntries(
    ids.flatMap((id): [string, unknown][] => [
      [`/api/v1/tasks/${id}/comments`, { data: [], next_cursor: null }],
      [`/api/v1/tasks/${id}/watchers`, { watchers: [] }],
      [`/api/v1/tasks/${id}/checkpoints`, { data: [], next_cursor: null }],
    ]),
  );

const BASE: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [LISTED], next_cursor: null },
  '/api/v1/projects/laika-core': PROJECT,
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/projects/laika-core/mentionable': { users: [] },
  '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
  ...perTask(['t1', 't2', 't3']),
};

/** The space's whole set: what Calendar and Meeting review hold. */
const SPACE: ApiStub = {
  ...BASE,
  '/api/v1/projects/laika-core/tasks': { data: [T1, T2, T3], next_cursor: null },
  '/api/v1/projects/laika-core/sprints': { data: [SPRINT], next_cursor: null },
};

const TASKS = '/api/v1/projects/laika-core/tasks';

/**
 * A cold Timeline reads only the sprints it opens (D-074) — **so this stub
 * refuses a walk of the whole space**: every task request must name a sprint.
 * Opening a task must cost one `GET /tasks/:id`, not the set.
 */
const TIMELINE: ApiStub = {
  ...BASE,
  '/api/v1/projects/laika-core/sprints': { data: [SPRINT], next_cursor: null },
  [`${TASKS}?sprint=s1`]: { data: [T3], next_cursor: null },
  [`${TASKS}?sprint=none`]: { data: [], next_cursor: null },
  // The panel's own subtask read — one task's children, not the space.
  [`${TASKS}?parent=t3`]: { data: [], next_cursor: null },
  '/api/v1/tasks/t3': T3,
};

const drawer = (h: Harness) => h.page.locator('.drawer');

/** The dialog by its accessible name: the task key and title. */
const dialogNamed = (h: Harness, name: RegExp) => h.page.getByRole('dialog', { name });

/** What holds focus, as something a failure can be read from. */
const focused = (h: Harness) =>
  h.page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'body';
    return `${el.tagName.toLowerCase()}.${el.className}`;
  });

async function openCalendarChip(h: Harness, key: string): Promise<void> {
  const chip = h.page.locator('.cal-task', { hasText: key });
  await chip.waitFor({ timeout: 20_000 });
  await chip.focus();
  await h.page.keyboard.press('Enter');
  await h.page.locator('.drawer .panel-title').waitFor({ timeout: 10_000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('the drawer has its content on every view (B1)', () => {
  void test('from the Calendar: the full panel, named by key and title', async () => {
    const h = await open('/calendar?project=laika-core', SPACE);
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await openCalendarChip(h, 'LC-1');
      assert.match(h.page.url(), /\/calendar\?.*task=t1/);
      assert.equal(
        (await h.page.locator('.drawer .panel-title').textContent())?.trim(),
        'Due on the calendar',
      );
      await dialogNamed(h, /LC-1.*Due on the calendar/).waitFor({ timeout: 5_000 });
      assert.equal(await drawer(h).getAttribute('aria-modal'), 'true');
      // One dialog, not a dialog inside a dialog.
      assert.equal(await h.page.locator('.drawer [role="dialog"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('from the Timeline: the panel, with one read and no walk of the space', async () => {
    const h = await open('/timeline?project=laika-core', TIMELINE);
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      const group = h.page.locator('.tlx-group[data-sprint-id="s1"]');
      await group.locator('.tlx-chevron').waitFor({ timeout: 20_000 });
      if ((await group.locator('.tlx-chevron').getAttribute('aria-expanded')) !== 'true') {
        await group.locator('.tlx-chevron').click();
      }
      await group.locator('.tlx-task-open').first().click();
      await h.page.waitForURL(/task=t3/, { timeout: 5_000 });
      const title = h.page.locator('.drawer .panel-title');
      await title.waitFor({ timeout: 10_000 });
      assert.equal((await title.textContent())?.trim(), 'Planned in a sprint');
      assert.deepEqual(h.unmatched, [], 'the drawer walked the whole space');
      assert.ok(
        h.calls.some((c) => c.method === 'GET' && c.path === '/api/v1/tasks/t3'),
        'the drawer did not read the task',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the drawer is a modal dialog (B3, B22)', () => {
  void test('Tab stays inside it, both ways', async () => {
    const h = await open('/calendar?project=laika-core', SPACE);
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await openCalendarChip(h, 'LC-1');
      const inside = () =>
        h.page.evaluate(() => document.activeElement?.closest('.drawer') != null);
      // Far more presses than the drawer has controls, so it must wrap.
      for (let i = 0; i < 60; i += 1) {
        await h.page.keyboard.press('Tab');
        assert.ok(await inside(), `Tab ${String(i + 1)} left the drawer for ${await focused(h)}`);
      }
      for (let i = 0; i < 10; i += 1) {
        await h.page.keyboard.press('Shift+Tab');
        assert.ok(await inside(), `Shift+Tab ${String(i + 1)} left the drawer`);
      }
    } finally {
      await h.close();
    }
  });

  void test('Escape in the ⋯ menu closes the menu only; the next closes the drawer and focus returns to the chip', async () => {
    const h = await open('/calendar?project=laika-core', SPACE);
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await openCalendarChip(h, 'LC-1');
      const more = h.page.locator('.drawer').getByRole('button', { name: 'More actions' });
      const menu = h.page.locator('.panel-overflow');

      await more.click();
      await menu.waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await drawer(h).count(), 1, 'Escape in the menu closed the drawer');
      assert.equal(await more.evaluate((el) => el === document.activeElement), true);

      // A press elsewhere in the drawer closes the menu, and not the drawer.
      await more.click();
      await menu.waitFor({ timeout: 5_000 });
      await h.page.locator('.drawer .panel-key').click();
      await menu.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await drawer(h).count(), 1, 'an outside click closed the drawer');

      await h.page.keyboard.press('Escape');
      await drawer(h).waitFor({ state: 'detached', timeout: 5_000 });
      await until(async () => (await focused(h)) !== 'body', 2_000);
      assert.match(await focused(h), /^button\.cal-task\b/, 'focus did not return to the chip');
    } finally {
      await h.close();
    }
  });

  void test('Back closes it and leaves the reader on the Calendar', async () => {
    const h = await open('/calendar?project=laika-core', SPACE);
    try {
      await openCalendarChip(h, 'LC-1');
      await h.page.goBack();
      await drawer(h).waitFor({ state: 'detached', timeout: 5_000 });
      const url = new URL(h.page.url());
      assert.equal(url.pathname, '/calendar');
      assert.equal(url.searchParams.get('task'), null);
    } finally {
      await h.close();
    }
  });
});

void describe('task links open the task in its own space (B2)', () => {
  void test('Meeting review opens the drawer over the review, by key, in this space', async () => {
    const review = {
      id: 'r1',
      project_id: 'laika-core',
      source: 'standup.txt',
      status: 'pending',
      proposal_count: 1,
      reviewed_by: null,
      reviewed_at: null,
      expires_at: 9_999_999_999_999,
      created_at: 1,
    };
    const h = await open('/meeting-review?project=laika-core', {
      ...SPACE,
      '/api/v1/projects/laika-core/meeting-reviews': { data: [review], next_cursor: null },
      '/api/v1/meeting-reviews/r1': {
        ...review,
        proposals: [
          {
            id: 'p1',
            kind: 'change',
            task: 'LC-1',
            title: null,
            description: null,
            changes: { priority: 'p1' },
            reason: null,
            quote: 'LC-1 matters more',
            applied_at: null,
          },
        ],
      },
    });
    try {
      const link = h.page.locator('.mr-task', { hasText: 'LC-1' });
      await link.waitFor({ timeout: 20_000 });
      await link.click();
      const title = h.page.locator('.drawer .panel-title');
      await title.waitFor({ timeout: 10_000 });
      assert.equal((await title.textContent())?.trim(), 'Due on the calendar');
      // The key was resolved and written back as the id, in this space, here.
      await until(() => new URL(h.page.url()).searchParams.get('task') === 't1');
      const url = new URL(h.page.url());
      assert.equal(url.pathname, '/meeting-review');
      assert.equal(url.searchParams.get('project'), 'laika-core');
      assert.equal(url.searchParams.get('task'), 't1');
      assert.equal(url.searchParams.get('q'), null);
    } finally {
      await h.close();
    }
  });
});

void describe('Detach from parent asks first, and says when it fails (B4)', () => {
  void test('Cancel changes nothing; a refused detach is in the panel’s alert', async () => {
    const h = await open('/calendar?project=laika-core&task=t2', {
      ...SPACE,
      '/api/v1/tasks/t2': (call: { method: string }) =>
        call.method === 'PATCH' ? refuse(403, 'forbidden', 'Only a lead may move this task.') : T2,
    });
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await h.page.locator('.drawer .panel-title').waitFor({ timeout: 20_000 });
      const more = h.page.locator('.drawer').getByRole('button', { name: 'More actions' });
      const ask = h.page.getByRole('alertdialog', { name: 'Detach from parent?' });
      const patches = () =>
        h.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t2').length;

      await more.click();
      await h.page
        .locator('.panel-overflow')
        .getByRole('button', { name: 'Detach from parent' })
        .click();
      await ask.waitFor({ timeout: 5_000 });
      // Escape answers the question, and only the question.
      await h.page.keyboard.press('Escape');
      await ask.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await drawer(h).count(), 1, 'Escape in the confirmation closed the drawer');
      assert.equal(patches(), 0, 'the detach was sent without a yes');

      await more.click();
      await h.page
        .locator('.panel-overflow')
        .getByRole('button', { name: 'Detach from parent' })
        .click();
      await ask.getByRole('button', { name: 'Detach' }).click();
      const alert = h.page.locator('.drawer .panel-alert', {
        hasText: 'Only a lead may move this task.',
      });
      await alert.waitFor({ timeout: 5_000 });
      assert.equal(patches(), 1);
    } finally {
      await h.close();
    }
  });
});
