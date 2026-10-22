/**
 * A sprint card's numbers say what they count (LAI-819).
 *
 * - **The lock** counts open work held by an unfinished blocker *anywhere in
 *   the project*. It looked for blockers among the sprint's own tasks only, so
 *   a task waiting on the next sprint's work was never counted.
 * - **Progress** counts subtasks, as the board's DONE and the server's
 *   `task_counts` do, so the card says "incl. N subtasks".
 * - **A completed sprint** counts its tasks as they stand now, so it says
 *   "done now" rather than reading as what the sprint delivered.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const DAY = 86_400_000;
const today = new Date();
const MIDNIGHT = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

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

const sprint = (id: string, name: string, status: string, from: number, to: number) => ({
  id,
  project_id: 'laika-core',
  name,
  goal: null,
  status,
  starts_on: MIDNIGHT + from * DAY,
  ends_on: MIDNIGHT + to * DAY,
  created_at: 1,
  updated_at: 1,
});

const task = (
  n: number,
  status: string,
  sprintId: string | null,
  over: { readonly blockedBy?: readonly string[]; readonly parent?: string } = {},
) => ({
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
  sprint_id: sprintId,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: over.blockedBy ?? [],
  blocks: [],
  discovered_from: null,
  parent_task_id: over.parent ?? null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
});

const SPRINTS = [
  sprint('s1', 'Baseline build', 'completed', -28, -15),
  sprint('s2', 'Finish what’s open', 'active', -14, 9),
  sprint('s3', 'Reliability', 'planned', 10, 23),
];

const TASKS = [
  task(1, 'done', 's1'),
  task(2, 'todo', 's1'),
  // Waiting on LC-6, open in s3: the lock counts it though LC-6 is not in s2.
  task(3, 'todo', 's2', { blockedBy: ['t6'] }),
  // Its blocker, LC-1, is done: not held.
  task(4, 'in_progress', 's2', { blockedBy: ['t1'] }),
  task(5, 'done', 's2', { parent: 't3' }),
  task(6, 'todo', 's3'),
];

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
        task_counts: { backlog: 0, todo: 3, in_progress: 1, review: 0, done: 2, cancelled: 0 },
        blocked_count: 1,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: TASKS, next_cursor: null },
  '/api/v1/projects/laika-core/sprints': { data: SPRINTS, next_cursor: null },
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
};

void after(async () => {
  await closeBrowser();
});

void describe('a sprint card’s numbers (LAI-819)', () => {
  void test('the lock counts a blocker in another sprint; progress says it has subtasks', async () => {
    const h = await open('/sprints?project=laika-core', STUB);
    try {
      const active = h.page.locator('.sprint-card-active');
      await active.locator('.sprint-frac').waitFor({ timeout: 20_000 });
      // Positive control: the tasks have landed — LC-5 done, of LC-3, 4, 5.
      await h.page.waitForFunction(
        () => document.querySelector('.sprint-card-active .sprint-frac')?.textContent === '1/3',
        undefined,
        { timeout: 10_000 },
      );

      assert.equal(
        await active.locator('.sprint-blocked').count(),
        1,
        'no lock: a blocker in another sprint was not counted',
      );
      assert.equal(
        ((await active.locator('.sprint-blocked').textContent()) ?? '').trim(),
        '1',
        'LC-3, held by LC-6 in s3',
      );
      assert.equal(
        await active.locator('.sprint-blocked').getAttribute('title'),
        '1 blocked by unfinished work',
      );
      assert.equal(await active.locator('.sprint-subtasks').textContent(), 'incl. 1 subtask');
      // Running, so it is not "done now"; that is for a finished sprint.
      assert.equal(await active.locator('.sprint-pct').textContent(), '33%');
    } finally {
      await h.close();
    }
  });

  void test('a completed sprint says its figure is done now', async () => {
    const h = await open('/sprints?project=laika-core', STUB);
    try {
      const completed = h.page.locator('.sprint-card-completed');
      await h.page.waitForFunction(
        () => document.querySelector('.sprint-card-completed .sprint-frac')?.textContent === '1/2',
        undefined,
        { timeout: 20_000 },
      );
      assert.equal(await completed.locator('.sprint-pct').textContent(), '50% done now');
      // No subtasks in it, so nothing to say about them.
      assert.equal(await completed.locator('.sprint-subtasks').count(), 0);
    } finally {
      await h.close();
    }
  });
});
