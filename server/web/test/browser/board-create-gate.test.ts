/**
 * Creating a task follows `task.create`, not `task.write` (LAI-992).
 *
 * D-103 item 6 lets a space say *Space admins only* for who may create
 * tasks (LAI-976 serves it as its own action). The board asked `task.write`
 * for every write, so a member there was offered *Add task*, the List's
 * *Create task*, the space bar's *Create* and *Add subtask* — each answering
 * `403`. Every one of them is watched from before the app boots
 * (`watchFor`), so a control drawn for one frame fails too.
 *
 * And the other half: the member still edits — cards stay draggable and the
 * drawer still offers its edits — because `task.write` is unchanged.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  defaultPermissions,
  everSeen,
  open,
  until,
  watchFor,
  type ApiStub,
} from './harness.ts';

const PROJECT = {
  id: 'p1',
  slug: 'laika',
  name: 'Laika',
  prefix: 'LAIKA',
  description: null,
  repo: null,
  visibility: 'private',
  color: 'violet',
  task_create_min_role: 'lead',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [
    { user_id: 'u1', name: 'Ada Admin' },
    { user_id: 'u2', name: 'Tomas Member' },
  ],
  last_activity_at: 2,
};

const TASK = {
  id: 't1',
  key: 'LAIKA-1',
  project_id: 'p1',
  number: 1,
  title: 'A task already here',
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
  blocked: false,
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

const me = (id: string, name: string, role: string) => ({
  id,
  email: `${id}@example.com`,
  name,
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role }],
});

/**
 * `/permissions` as the server answers it in a *Space admins only* space:
 * the default grants, with `task.create` held by the space admin alone —
 * `can()`'s `taskCreateMinRole === 'lead' ? isLead : isMemberUp`.
 */
function adminsOnly(person: ReturnType<typeof me>): unknown {
  const base = defaultPermissions(person) as {
    me: { projects: { project_id: string; role: string; actions: string[] }[] };
  };
  return {
    ...base,
    me: {
      ...base.me,
      projects: base.me.projects.map((grant) => ({
        ...grant,
        actions:
          grant.role === 'lead' ? grant.actions : grant.actions.filter((a) => a !== 'task.create'),
      })),
    },
  };
}

function stub(person: ReturnType<typeof me>): ApiStub {
  return {
    '/api/v1/me': person,
    '/api/v1/permissions': adminsOnly(person),
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/projects/laika': PROJECT,
    '/api/v1/projects/laika/tasks': { data: [TASK], next_cursor: null },
    '/api/v1/projects/laika/members': {
      members: [
        { user_id: 'u1', name: 'Ada Admin', email: 'u1@example.com', role: 'lead', created_at: 1 },
        {
          user_id: 'u2',
          name: 'Tomas Member',
          email: 'u2@example.com',
          role: 'member',
          created_at: 1,
        },
      ],
    },
    '/api/v1/projects/laika/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika/tags': { tags: [] },
    '/api/v1/tasks/t1/dependencies': { blocked_by: [], blocks: [] },
    '/api/v1/tasks/t1/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t1/activity': { data: [], next_cursor: null },
    '/api/v1/tasks/t1/watchers': { watchers: [] },
    '/api/v1/presence': { data: [], next_cursor: null },
  };
}

/** Every way to create a task the board and the space bar offer. */
const CREATE = ['.lane-add', '.list-create', '.space-create', '.sub-link'];

const MEMBER = me('u2', 'Tomas Member', 'member');
const SPACE_ADMIN = me('u1', 'Ada Admin', 'lead');

after(async () => {
  await closeBrowser();
});

void describe('a member in a Space admins only space', () => {
  void test('is never shown a create control — Board, List, the space bar, Add subtask', async () => {
    const h = await open('/board?project=laika', stub(MEMBER), {
      before: (page) => watchFor(page, CREATE),
    });
    try {
      await h.page.locator('.card-title').first().waitFor({ timeout: 20_000 });
      await until(() => h.calls.some((c) => c.path === '/api/v1/permissions'));
      // The List, and the task drawer where Add subtask lives.
      await h.page.goto(`${h.origin}/list?project=laika`);
      await h.page.locator('.list-row, [data-task-id]').first().waitFor({ timeout: 20_000 });
      await h.page.goto(`${h.origin}/board?project=laika&task=t1`);
      await h.page.locator('.sub-section').waitFor({ timeout: 20_000 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      for (const selector of CREATE) {
        assert.equal(await everSeen(h.page, selector), false, `the member was shown ${selector}`);
      }
    } finally {
      await h.close();
    }
  });

  void test('still edits: cards drag, because task.write is theirs', async () => {
    const h = await open('/board?project=laika', stub(MEMBER));
    try {
      await h.page.locator('.card-title').first().waitFor({ timeout: 20_000 });
      await until(
        async () => (await h.page.locator('article.card[draggable="true"]').count()) === 1,
      );
      assert.equal(await h.page.locator('article.card[draggable="true"]').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('the space admin of the same space', () => {
  void test('is offered Add task, Create and Add subtask', async () => {
    const h = await open('/board?project=laika', stub(SPACE_ADMIN));
    try {
      await h.page.locator('.lane-add').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.space-create').waitFor({ timeout: 5_000 });
      await h.page.goto(`${h.origin}/list?project=laika`);
      await h.page.locator('.list-create').waitFor({ timeout: 20_000 });
      await h.page.goto(`${h.origin}/board?project=laika&task=t1`);
      await h.page.locator('.sub-link', { hasText: 'Add subtask' }).waitFor({ timeout: 20_000 });
    } finally {
      await h.close();
    }
  });
});
