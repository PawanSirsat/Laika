/**
 * A card's outside id on screen (LAI-780): the id it has somewhere else — a
 * repo's `LAI-780`, a Jira or GitHub key — kept in `external_ref`, which every
 * tool that takes a task key takes too.
 *
 * The task panel shows it; anyone who may edit the task sets, changes or
 * clears it there, sending only `external_ref`; a Viewer reads it and edits
 * nothing. The board's search finds a card by it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  asServed,
  closeBrowser,
  open,
  refuse,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

const HOUR = 3_600_000;
const NOW = Date.now();

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
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
    send_back: null,
    started_at: null,
    completed_at: null,
    created_at: NOW - 5 * HOUR,
    updated_at: NOW - HOUR,
    size: null,
    ...over,
  });

/** The server's rule, so the stub answers a PATCH as `PATCH /tasks/:id` would. */
const OUTSIDE_ID = /^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$/;

function stub(role: 'lead' | 'viewer'): ApiStub {
  const carried = task({
    id: 't3',
    key: 'LC-3',
    number: 3,
    title: 'Tie agent tokens to tasks',
    external_ref: 'LAI-780',
  });
  const plain = task({ id: 't1', key: 'LC-1', number: 1, title: 'Rename the column' });
  const pulled = task({
    id: 't4',
    key: 'LC-4',
    number: 4,
    title: 'Merged by a pull request',
    external_ref: 'kvell/laika#221',
  });
  const all = [carried, plain, pulled];

  const editable = (current: Record<string, unknown>) => (call: StubCall) => {
    if (call.method !== 'PATCH') return current;
    const sent = (call.body as { external_ref?: string | null }).external_ref;
    if (typeof sent === 'string' && !OUTSIDE_ID.test(sent.trim())) {
      return refuse(422, 'unprocessable', 'Not an outside id');
    }
    Object.assign(current, {
      external_ref: typeof sent === 'string' ? sent.trim().toUpperCase() : null,
    });
    return current;
  };

  const perTask = (t: Record<string, unknown>) => {
    const id = String(t.id);
    return {
      [`/api/v1/tasks/${id}`]: editable(t),
      [`/api/v1/tasks/${id}/comments`]: { data: [], next_cursor: null },
      [`/api/v1/tasks/${id}/watchers`]: { watchers: [] },
      [`/api/v1/tasks/${id}/usage`]: {
        task_id: id,
        key: t.key,
        tz: 'UTC',
        first_day: null,
        last_day: null,
        totals: { tokens: 0, input: 0, output: 0, cache_write: 0, cache_read: 0 },
        people: 'everyone',
        by_person: [],
        by_round: [],
        attributed: null,
      },
      [`/api/v1/projects/laika-core/tasks?parent=${id}&limit=200`]: {
        data: [],
        next_cursor: null,
      },
    };
  };

  return {
    '/api/v1/me': {
      id: role === 'lead' ? 'u1' : 'u2',
      email: 'me@example.com',
      name: role === 'lead' ? 'Ada Lovelace' : 'Vic Viewer',
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 3, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: all, next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead' },
        { user_id: 'u2', name: 'Vic Viewer', email: 'u2@example.com', role: 'viewer' },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/estimates/accuracy': {
      project_id: 'laika-core',
      finished: 0,
      forecasts_after: 10,
      live: null,
      backtest: null,
      by_client: [],
      model_version: 'abc123',
    },
    ...perTask(carried),
    ...perTask(plain),
    ...perTask(pulled),
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
}

void after(async () => {
  await closeBrowser();
});

const ROW = '.meta-row-outside-id';

async function row(h: Awaited<ReturnType<typeof open>>) {
  const found = h.page.locator(ROW);
  await found.waitFor({ timeout: 20_000 });
  return found;
}

const patches = (h: Awaited<ReturnType<typeof open>>, id: string) =>
  h.calls.filter((c) => c.method === 'PATCH' && c.path === `/api/v1/tasks/${id}`);

void describe('the task panel’s outside id', () => {
  void test('shows the id a card carries, and an editor changes it — sending only external_ref', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub('lead'));
    try {
      const outside = await row(h);
      assert.match(await outside.innerText(), /Outside id[\s\S]*LAI-780/i);

      await outside.getByRole('button', { name: 'Change outside id' }).click();
      const input = outside.getByLabel('Outside id');
      await input.fill('lai-781');
      await outside.getByRole('button', { name: 'Save' }).click();
      await until(() => patches(h, 't3').length > 0);
      assert.deepEqual(patches(h, 't3')[0]?.body, { external_ref: 'lai-781' });
      await until(async () => (await outside.innerText()).includes('LAI-781'));
      assert.match(await outside.innerText(), /LAI-781/);

      await outside.getByRole('button', { name: 'Clear outside id' }).click();
      await until(() => patches(h, 't3').length > 1);
      assert.deepEqual(patches(h, 't3')[1]?.body, { external_ref: null });
      await until(async () => (await outside.innerText()).includes('Add outside id'));
      assert.match(await outside.innerText(), /Add outside id/);
    } finally {
      await h.close();
    }
  });

  void test('an editor adds one to a card with none; the Save waits for a well-shaped id', async () => {
    const h = await open('/board?project=laika-core&task=t1', stub('lead'));
    try {
      const outside = await row(h);
      await outside.getByRole('button', { name: 'Add outside id' }).click();
      const input = outside.getByLabel('Outside id');
      const save = outside.getByRole('button', { name: 'Save' });
      await input.fill('LAI 780');
      assert.equal(await save.isDisabled(), true, 'a malformed id can be saved');
      await input.fill('JIRA-12');
      assert.equal(await save.isDisabled(), false);
      await save.click();
      await until(() => patches(h, 't1').length > 0);
      assert.deepEqual(patches(h, 't1')[0]?.body, { external_ref: 'JIRA-12' });
    } finally {
      await h.close();
    }
  });

  void test('a pull request’s ref stays under PR, and is not offered as the outside id', async () => {
    const h = await open('/board?project=laika-core&task=t4', stub('lead'));
    try {
      const outside = await row(h);
      assert.match(await outside.innerText(), /Add outside id/);
      assert.doesNotMatch(await outside.innerText(), /kvell\/laika#221/);
    } finally {
      await h.close();
    }
  });

  void test('a Viewer reads it and is offered no edit', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub('viewer'));
    try {
      const outside = await row(h);
      assert.match(await outside.innerText(), /LAI-780/);
      assert.equal(await outside.getByRole('button').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the board’s search', () => {
  const visible = async (h: Awaited<ReturnType<typeof open>>, id: string) =>
    h.page.locator(`article.card[data-task-id="${id}"]`).count();

  void test('finds a card by its outside id, in any case', async () => {
    const h = await open('/board?project=laika-core&q=lai-780', stub('lead'));
    try {
      await h.page.locator('article.card[data-task-id="t3"]').waitFor({ timeout: 20_000 });
      assert.equal(await visible(h, 't3'), 1);
      assert.equal(await visible(h, 't1'), 0);
    } finally {
      await h.close();
    }
  });
});
