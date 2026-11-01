/**
 * The Calendar places open tasks by their real `due_on` (LAI-819).
 *
 * It placed them on dates from `demo/calendar.ts`, which a production build —
 * the one this harness serves, and the one production runs — switches off. So
 * production read "0 tasks placed" under a SAMPLE notice saying Laika stored
 * no due date, while 48 of Laika's open tasks had one.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const today = new Date();
/** A date-only value (D-066): the UTC midnight of the local date `days` from today. */
const dueIn = (days: number): number =>
  Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + days);
const SOON = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);

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

const task = (n: number, status: string, dueOn: number | null) => ({
  id: `t${String(n)}`,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task ${String(n)}`,
  description_md: '',
  acceptance_md: '',
  status,
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
  due_on: dueOn,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
});

const stub = (tasks: readonly ReturnType<typeof task>[]): ApiStub => ({
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
        task_counts: { backlog: 0, todo: 2, in_progress: 1, review: 0, done: 1, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: tasks, next_cursor: null },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
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
});

const DATED = [
  task(1, 'todo', dueIn(2)),
  // Finished: it has no date to keep, as a card's due date has none (D-069).
  task(2, 'done', dueIn(2)),
  // Open, but due long after the six weeks on screen.
  task(3, 'in_progress', dueIn(200)),
  task(4, 'todo', null),
];

void after(async () => {
  await closeBrowser();
});

void describe('the Calendar reads due_on (LAI-819)', () => {
  void test('an open task sits on the day it is due, and the counts say what they count', async () => {
    const h = await open('/calendar?project=laika-core', stub(DATED));
    try {
      const chip = h.page.locator('.cal-task', { hasText: 'LC-1' });
      await chip.waitFor({ timeout: 20_000 });

      // On its own day: the cell's date is the 2nd day from today.
      const date = await chip.evaluate(
        (el) => el.closest('.cal-day')?.querySelector('.cal-date')?.textContent ?? '',
      );
      assert.equal(date, String(SOON.getDate()));

      // Placed: LC-1 only. LC-2 is done, LC-3 is beyond the grid, LC-4 has no date.
      assert.equal(await h.page.locator('.cal-task').count(), 1);
      assert.match(
        (await h.page.locator('.space-context').textContent()) ?? '',
        /^1 open task placed · /,
      );
      assert.equal(
        await h.page.locator('.cal-note').textContent(),
        '1 more open task is due outside these six weeks.',
      );
      // Nothing on this screen is a sample any more.
      assert.equal(await h.page.locator('.demo-notice').count(), 0, 'the SAMPLE notice is back');
    } finally {
      await h.close();
    }
  });

  void test('a space with no dated open work says exactly that', async () => {
    const h = await open(
      '/calendar?project=laika-core',
      stub([task(1, 'todo', null), task(2, 'done', dueIn(1))]),
    );
    try {
      const note = h.page.locator('.cal-note');
      await note.waitFor({ timeout: 20_000 });
      assert.equal(
        await note.textContent(),
        'No open task in this space has a due date. Set one in a task’s details and it appears on its day.',
      );
      assert.equal(await h.page.locator('.cal-task').count(), 0);
      assert.match(
        (await h.page.locator('.space-context').textContent()) ?? '',
        /^0 open tasks placed · /,
      );
    } finally {
      await h.close();
    }
  });
});
