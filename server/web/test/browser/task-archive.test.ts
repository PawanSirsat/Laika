/**
 * Archiving a task, in a real browser (LAI-1353): the drawer's ⋯ menu with
 * its Undo toast, the read-only drawer of an archived task, the board's
 * Archived panel with Restore, and the List's bulk Archive.
 *
 * The stub keeps one set of tasks and which are archived, so the board's
 * live read and the Archived panel's `?archived=only` read answer from the
 * same state the `PATCH { archived }` changes — as the server does.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { asServed, closeBrowser, open, setTheme, type ApiStub, type StubCall } from './harness.ts';

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

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

const ARCHIVED_AT = Date.UTC(2026, 10, 3, 12);

function task(n: number) {
  return asServed({
    id: `t${String(n)}`,
    key: `LC-${String(n)}`,
    number: n,
    project_id: 'laika-core',
    title: `Task number ${String(n)}`,
    description_md: '',
    acceptance_md: '',
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    created_by: 'u1',
    created_via: 'web',
    sprint_id: null,
    tags: [],
    ready: true,
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
    archived_at: null,
    archived_by: null,
    created_at: 1,
    updated_at: 1_000 + n,
    started_at: null,
    completed_at: null,
  });
}

/** A space of three tasks; `archived` names the ones put away when it opens. */
function space(archived: readonly string[] = []): ApiStub {
  const tasks = new Map<string, ReturnType<typeof task>>(
    [1, 2, 3].map((n) => [`t${String(n)}`, task(n)]),
  );
  const put = new Map<string, number>(archived.map((id) => [id, ARCHIVED_AT]));
  const view = (id: string) => {
    const at = put.get(id);
    return {
      ...tasks.get(id),
      archived_at: at ?? null,
      archived_by: at === undefined ? null : 'u1',
      ready: at === undefined,
    };
  };
  const one = (id: string) => (call: StubCall) => {
    if (call.method === 'PATCH') {
      const to = (call.body as { archived?: boolean }).archived;
      if (to === true) put.set(id, Date.now());
      if (to === false) put.delete(id);
    }
    return view(id);
  };
  const list = (archivedOnly: boolean) => () => ({
    data: [...tasks.keys()].filter((id) => put.has(id) === archivedOnly).map(view),
    next_cursor: null,
  });
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 3, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    // The board's walk and the Archived panel's read, from one state.
    '/api/v1/projects/laika-core/tasks?fields=slim': list(false),
    '/api/v1/projects/laika-core/tasks?fields=slim&archived=only': list(true),
    '/api/v1/tasks/t1': one('t1'),
    '/api/v1/tasks/t2': one('t2'),
    '/api/v1/tasks/t3': one('t3'),
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/tasks/t1/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t2/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t1/watchers': { watchers: [] },
    '/api/v1/tasks/t2/watchers': { watchers: [] },
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

const patches = (calls: readonly StubCall[]) =>
  calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body]);

void after(async () => {
  await closeBrowser();
});

void describe('archiving from the drawer (LAI-1353)', () => {
  void test('⋯ → Archive sends archived alone, says so with Undo, and leaves the task read-only', async () => {
    const h = await open('/board?project=laika-core&task=t1', space());
    try {
      const panel = h.page.locator('.panel-title');
      await panel.waitFor({ timeout: 20_000 });
      // The card is on the board first, so its leaving below means something.
      const card = h.page.locator('[data-task-id="t1"]');
      await card.first().waitFor({ timeout: 10_000 });

      await h.page.getByRole('button', { name: 'More actions' }).click();
      await h.page.locator('[data-archive-action="archive"]').click();

      const toast = h.page.locator('[data-toast]', { hasText: 'LC-1 archived' });
      await toast.waitFor({ timeout: 10_000 });
      assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 1);
      assert.deepEqual(patches(h.calls), [['/api/v1/tasks/t1', { archived: true }]]);

      // The drawer stays on it, read by id now, with its banner and no composer.
      const banner = h.page.locator('[data-archived-banner]');
      await banner.waitFor({ timeout: 10_000 });
      assert.match(await banner.innerText(), /Archived by Ada Lovelace on .+ read-only/);
      await h.page.locator('[data-archived-composer]').waitFor({ timeout: 10_000 });
      // And its card left the board.
      await card.first().waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await card.count(), 0);

      // The banner's Restore puts it back.
      await banner.getByRole('button', { name: 'Restore' }).click();
      await banner.waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(patches(h.calls).at(-1), ['/api/v1/tasks/t1', { archived: false }]);
    } finally {
      await h.close();
    }
  });

  void test('Undo on the toast takes the archive back on the server', async () => {
    const h = await open('/board?project=laika-core&task=t2', space());
    try {
      await h.page.locator('.panel-title').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'More actions' }).click();
      await h.page.locator('[data-archive-action="archive"]').click();

      const toast = h.page.locator('[data-toast]', { hasText: 'LC-2 archived' });
      await toast.waitFor({ timeout: 10_000 });
      await toast.getByRole('button', { name: 'Undo' }).click();
      await h.page
        .locator('[data-toast]', { hasText: 'LC-2 is back on the board' })
        .waitFor({ timeout: 10_000 });
      assert.deepEqual(patches(h.calls), [
        ['/api/v1/tasks/t2', { archived: true }],
        ['/api/v1/tasks/t2', { archived: false }],
      ]);
    } finally {
      await h.close();
    }
  });
});

void describe('the Archived panel (LAI-1353)', () => {
  void test('lists what is put away, newest first, and Restore brings it back', async () => {
    const h = await open('/board?project=laika-core', space(['t2']));
    try {
      await h.page.locator('[data-board-action="archived"]').click({ timeout: 20_000 });
      const shelf = h.page.locator('[data-board-shelf="archived"]');
      await shelf.waitFor({ timeout: 10_000 });
      const row = shelf.locator('[data-shelf-row="LC-2"]');
      await row.waitFor({ timeout: 10_000 });
      assert.match(await row.innerText(), /Task number 2/);
      assert.match(await row.innerText(), /Ada Lovelace · 3 Nov/);
      assert.equal(await shelf.locator('[data-shelf-row]').count(), 1);

      await row.getByRole('button', { name: 'Restore LC-2' }).click();
      await row.waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(patches(h.calls), [['/api/v1/tasks/t2', { archived: false }]]);
      await h.page
        .locator('[data-toast]', { hasText: 'LC-2 is back on the board' })
        .waitFor({ timeout: 10_000 });
      await shelf.getByText('Nothing archived.').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('draws in both themes with the theme’s own colours', async () => {
    const h = await open('/board?project=laika-core&task=t3', space(['t3']));
    try {
      const banner = h.page.locator('[data-archived-banner]');
      await banner.waitFor({ timeout: 20_000 });
      const colours = async () =>
        banner.evaluate((el) => {
          const style = getComputedStyle(el);
          return `${style.backgroundColor} / ${style.color}`;
        });
      await setTheme(h.page, 'light');
      const light = await colours();
      await setTheme(h.page, 'dark');
      const dark = await colours();
      assert.notEqual(light, dark, 'the banner kept one theme’s colours');
      assert.ok(!light.startsWith('rgba(0, 0, 0, 0)'), `no background in light: ${light}`);
      assert.ok(!dark.startsWith('rgba(0, 0, 0, 0)'), `no background in dark: ${dark}`);
    } finally {
      await h.close();
    }
  });
});

void describe('bulk Archive in the List (LAI-1353)', () => {
  void test('archives each selected task, with archived alone', async () => {
    const h = await open('/list?project=laika-core', space());
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      await h.page.getByLabel('Select LC-1', { exact: true }).check();
      await h.page.getByLabel('Select LC-3', { exact: true }).check();
      await h.page.locator('[data-bulk-action="archive"]').click();

      // The rows leave the List, and the bar with them: the toast says it.
      const toast = h.page.locator('[data-toast]', { hasText: '2 tasks archived' });
      await toast.waitFor({ timeout: 10_000 });
      await h.page.locator('.list-row', { hasText: 'LC-1' }).waitFor({ state: 'detached' });
      assert.equal(await h.page.locator('.list-row').count(), 1);
      assert.deepEqual(patches(h.calls).sort(), [
        ['/api/v1/tasks/t1', { archived: true }],
        ['/api/v1/tasks/t3', { archived: true }],
      ]);

      // Undo restores each one.
      await toast.getByRole('button', { name: 'Undo' }).click();
      await h.page
        .locator('[data-toast]', { hasText: '2 tasks are back on the board' })
        .waitFor({ timeout: 10_000 });
      assert.deepEqual(patches(h.calls).slice(2).sort(), [
        ['/api/v1/tasks/t1', { archived: false }],
        ['/api/v1/tasks/t3', { archived: false }],
      ]);
    } finally {
      await h.close();
    }
  });
});
