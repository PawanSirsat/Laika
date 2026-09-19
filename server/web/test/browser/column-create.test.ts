/**
 * Creating a card in the column you clicked (LAI-290).
 *
 * **This file exists for one assertion.** `KanbanView`'s `onAdd` took no
 * arguments and opened a banner above the whole board that posted no `status`,
 * so `+` on *Done* created a task in `backlog`. The endpoint had accepted
 * `status` since LAI-011; nothing ever sent it.
 *
 * The test therefore asserts the **request body**, not the rendered card — a
 * board that optimistically drew the card in the right lane and posted the
 * wrong status would look correct until the next reload, which is exactly how
 * this survived.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, type ApiStub, type Harness } from './harness.ts';

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

function column(id: string, name: string, position: number, statuses: string[]) {
  return {
    id,
    project_id: 'p1',
    name,
    position,
    hidden: false,
    statuses,
    primary_status: statuses[0] ?? null,
  };
}

const COLUMNS = [
  column('c1', 'To do', 0, ['todo', 'backlog']),
  column('c2', 'In progress', 1, ['in_progress']),
  column('c3', 'Done', 2, ['done']),
];

function stub(over: Partial<ApiStub> = {}): ApiStub {
  return {
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
      members: [
        { user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 },
      ],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/presence': { data: [], next_cursor: null },
    ...over,
  };
}

/** The `+ Create` button inside the named lane. */
function addIn(h: Harness, name: string) {
  return h.page
    .locator('.lane', { has: h.page.locator('.lane-title', { hasText: name }) })
    .locator('.lane-add');
}

async function board(h: Harness): Promise<void> {
  await h.page.waitForSelector('.lane-title');
}

function creates(h: Harness) {
  return h.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tasks'));
}

after(async () => {
  await closeBrowser();
});

void describe('the column decides the status', () => {
  void test('creating from Done posts status done, not backlog', async () => {
    // The bug, stated as an assertion. Before LAI-290 this posted no status at
    // all and the server defaulted it to `backlog`.
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      await addIn(h, 'Done').click();
      await h.page.locator('.composer-title').fill('A finished thing');
      await h.page.locator('.composer-submit').click();
      await h.page.waitForTimeout(250);

      const sent = creates(h);
      assert.equal(sent.length, 1, 'no create was sent');
      assert.equal(
        (sent[0]?.body as { status?: string }).status,
        'done',
        'the card was created in the wrong column',
      );
    } finally {
      await h.close();
    }
  });

  void test('creating from To do posts its primary status, not the first listed', async () => {
    /*
     * "To do" holds `todo` **and** `backlog`, in that order, and the primary is
     * `todo`. A composer that reached for the column's first *enum* status, or
     * for `backlog` because it is the default, lands here.
     */
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      await addIn(h, 'To do').click();
      await h.page.locator('.composer-title').fill('Something to pick up');
      await h.page.locator('.composer-submit').click();
      await h.page.waitForTimeout(250);

      assert.equal((creates(h)[0]?.body as { status?: string }).status, 'todo');
    } finally {
      await h.close();
    }
  });

  void test('the composer says which column it will land in', async () => {
    // The defect was a card going somewhere unexpected, so the box states it.
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      await addIn(h, 'Done').click();

      assert.match((await h.page.locator('.composer-target').innerText()) ?? '', /done/i);
    } finally {
      await h.close();
    }
  });
});

void describe('the composer opens where it was clicked', () => {
  void test('only in that column, and not as a banner over the board', async () => {
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      await addIn(h, 'In progress').click();

      assert.equal(await h.page.locator('.composer').count(), 1, 'more than one composer opened');

      const inLane = await h.page
        .locator('.lane', { has: h.page.locator('.lane-title', { hasText: 'In progress' }) })
        .locator('.composer')
        .count();
      assert.equal(inLane, 1, 'the composer did not open inside the column that was clicked');

      // The old top banner is gone, not merely hidden.
      assert.equal(await h.page.locator('.new-task').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Escape closes it and the + comes back', async () => {
    const h = await open('/board?project=laika-core', stub());

    try {
      await board(h);
      await addIn(h, 'Done').click();
      await h.page.locator('.composer-title').press('Escape');
      await h.page.waitForTimeout(120);

      assert.equal(await h.page.locator('.composer').count(), 0);
      assert.equal(await addIn(h, 'Done').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('when the server refuses', () => {
  void test('the text stays, so nobody retypes it', async () => {
    // The one outcome a composer must never have.
    const h = await open(
      '/board?project=laika-core',
      stub({
        '/api/v1/projects/laika-core/tasks': (call: { method: string }) =>
          call.method === 'POST'
            ? refuse(403, 'forbidden', 'Viewers cannot create tasks')
            : { data: [TASK], next_cursor: null },
      }),
    );

    try {
      await board(h);
      await addIn(h, 'Done').click();
      await h.page.locator('.composer-title').fill('Do not lose me');
      await h.page.locator('.composer-submit').click();
      await h.page.waitForTimeout(250);

      assert.equal(await h.page.locator('.composer-title').inputValue(), 'Do not lose me');
      assert.match(
        await h.page.locator('.composer-error').innerText(),
        /Viewers cannot create tasks/,
      );
    } finally {
      await h.close();
    }
  });
});
