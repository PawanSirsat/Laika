/**
 * Trash, in a real browser (LAI-1354): the drawer's Delete… with its confirm
 * and Undo, the read-only drawer of a task in Trash with the days left, the
 * board's Trash panel with Restore, the List's bulk Delete with its confirm,
 * and no Delete offered to a member on a task they did not create.
 *
 * The stub keeps one set of tasks and which are in Trash, so the board's live
 * read and the panel's `?trash=only` read answer from the state `DELETE` and
 * `POST …/restore` change — as the server does.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { answerConfirm, confirmSettled } from './confirm.ts';
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

const DAY = 86_400_000;

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

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

const MEMBER = {
  ...ME,
  id: 'u2',
  email: 'm@example.com',
  name: 'Mira Member',
  org_role: 'member',
  memberships: [{ project_id: 'laika-core', role: 'member' }],
};

/** A space of three tasks, created by Ada; `deleted` names the ones in Trash, with when. */
function space(deleted: Readonly<Record<string, number>> = {}, me: typeof ME = ME): ApiStub {
  const tasks = new Map<string, ReturnType<typeof task>>(
    [1, 2, 3].map((n) => [`t${String(n)}`, task(n)]),
  );
  const gone = new Map<string, number>(Object.entries(deleted));
  const view = (id: string) => {
    const at = gone.get(id);
    return {
      ...tasks.get(id),
      deleted_at: at ?? null,
      deleted_by: at === undefined ? null : 'u1',
      ready: at === undefined,
    };
  };
  const one = (id: string) => (call: StubCall) => {
    if (call.method === 'DELETE') gone.set(id, Date.now());
    return view(id);
  };
  const back = (id: string) => () => {
    gone.delete(id);
    return view(id);
  };
  const list = (trash: boolean) => () => ({
    data: [...tasks.keys()].filter((id) => gone.has(id) === trash).map(view),
    next_cursor: null,
  });
  return {
    '/api/v1/me': me,
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
    '/api/v1/projects/laika-core/tasks?fields=slim': list(false),
    '/api/v1/projects/laika-core/tasks?fields=slim&trash=only': list(true),
    ...Object.fromEntries<unknown>(
      [...tasks.keys()].flatMap((id): [string, unknown][] => [
        [`/api/v1/tasks/${id}`, one(id)],
        [`/api/v1/tasks/${id}/restore`, back(id)],
        [`/api/v1/tasks/${id}/comments`, { data: [], next_cursor: null }],
        [`/api/v1/tasks/${id}/watchers`, { watchers: [] }],
      ]),
    ),
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' },
        { user_id: 'u2', name: 'Mira Member', email: 'm@example.com', role: 'member' },
      ],
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
  };
}

/** The writes the page made to Trash, in order: `[method, path]`. */
const trashWrites = (calls: readonly StubCall[]) =>
  calls
    .filter((c) => c.method === 'DELETE' || (c.method === 'POST' && c.path.endsWith('/restore')))
    .map((c) => [c.method, c.path]);

void after(async () => {
  await closeBrowser();
});

void describe('Delete from the drawer (LAI-1354)', () => {
  void test('asks first, moves it to Trash with Undo, and leaves it read-only with the days left', async () => {
    const h = await open('/board?project=laika-core&task=t1', space());
    try {
      await h.page.locator('.panel-title').waitFor({ timeout: 20_000 });
      const card = h.page.locator('[data-task-id="t1"]');
      await card.first().waitFor({ timeout: 10_000 });

      await h.page.getByRole('button', { name: 'More actions' }).click();
      await h.page.locator('[data-trash-action="delete"]').click();
      // The confirm says what goes and that it can come back; nothing is sent yet.
      await confirmSettled(h.page);
      assert.deepEqual(trashWrites(h.calls), []);
      const said = await answerConfirm(h.page, true);
      assert.match(said, /Move LC-1 to Trash\?/);
      assert.match(said, /restore it from Trash for 30 days/);
      assert.match(said, /Move to Trash/);

      const toast = h.page.locator('[data-toast]', { hasText: 'LC-1 moved to Trash' });
      await toast.waitFor({ timeout: 10_000 });
      assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 1);
      assert.deepEqual(trashWrites(h.calls), [['DELETE', '/api/v1/tasks/t1']]);

      const banner = h.page.locator('[data-trash-banner]');
      await banner.waitFor({ timeout: 10_000 });
      assert.match(await banner.innerText(), /Moved to Trash by Ada Lovelace on .+ 30 days left/);
      await h.page.locator('[data-archived-composer]').waitFor({ timeout: 10_000 });
      await card.first().waitFor({ state: 'detached', timeout: 10_000 });

      await banner.getByRole('button', { name: 'Restore' }).click();
      await banner.waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(trashWrites(h.calls).at(-1), ['POST', '/api/v1/tasks/t1/restore']);
    } finally {
      await h.close();
    }
  });

  void test('Keep in the confirm sends nothing', async () => {
    const h = await open('/board?project=laika-core&task=t2', space());
    try {
      await h.page.locator('.panel-title').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'More actions' }).click();
      await h.page.locator('[data-trash-action="delete"]').click();
      await confirmSettled(h.page);
      assert.match(await answerConfirm(h.page, false), /Move LC-2 to Trash\?/);
      assert.deepEqual(trashWrites(h.calls), []);
    } finally {
      await h.close();
    }
  });

  void test('is not offered to a member on a task they did not create', async () => {
    const h = await open('/board?project=laika-core&task=t2', space({}, MEMBER));
    try {
      await h.page.locator('.panel-title').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'More actions' }).click();
      await h.page.locator('.panel-overflow').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-trash-action]').count(), 0);
      // Archive is theirs, as editing is.
      assert.equal(await h.page.locator('[data-archive-action="archive"]').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('the Trash panel (LAI-1354)', () => {
  void test('lists what is in Trash with the days left, and Restore brings it back', async () => {
    const h = await open('/board?project=laika-core', space({ t2: Date.now() - 3 * DAY }));
    try {
      await h.page.locator('[data-board-action="trash"]').click({ timeout: 20_000 });
      const shelf = h.page.locator('[data-board-shelf="trash"]');
      await shelf.waitFor({ timeout: 10_000 });
      const row = shelf.locator('[data-shelf-row="LC-2"]');
      await row.waitFor({ timeout: 10_000 });
      assert.match(await row.innerText(), /Ada Lovelace · .+ · 27 days left/);

      await row.getByRole('button', { name: 'Restore LC-2' }).click();
      await row.waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(trashWrites(h.calls), [['POST', '/api/v1/tasks/t2/restore']]);
      await h.page
        .locator('[data-toast]', { hasText: 'LC-2 is back on the board' })
        .waitFor({ timeout: 10_000 });
      await shelf.getByText('Trash is empty.').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('the banner draws in both themes with the theme’s own colours', async () => {
    const h = await open('/board?project=laika-core&task=t3', space({ t3: Date.now() }));
    try {
      const banner = h.page.locator('[data-trash-banner]');
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
    } finally {
      await h.close();
    }
  });
});

void describe('bulk Delete in the List (LAI-1354)', () => {
  void test('asks in place, deletes each selected task, and Undo restores each', async () => {
    const h = await open('/list?project=laika-core', space());
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      await h.page.getByLabel('Select LC-1', { exact: true }).check();
      await h.page.getByLabel('Select LC-3', { exact: true }).check();
      await h.page.locator('[data-bulk-action="delete"]').click();
      await h.page.getByText('Move 2 tasks to Trash?').waitFor({ timeout: 10_000 });
      assert.deepEqual(trashWrites(h.calls), []);
      await h.page.locator('[data-bulk-confirm="delete"]').click();

      const toast = h.page.locator('[data-toast]', { hasText: '2 tasks moved to Trash' });
      await toast.waitFor({ timeout: 10_000 });
      assert.deepEqual(trashWrites(h.calls).sort(), [
        ['DELETE', '/api/v1/tasks/t1'],
        ['DELETE', '/api/v1/tasks/t3'],
      ]);

      await toast.getByRole('button', { name: 'Undo' }).click();
      await h.page
        .locator('[data-toast]', { hasText: '2 tasks are back on the board' })
        .waitFor({ timeout: 10_000 });
      assert.deepEqual(trashWrites(h.calls).slice(2).sort(), [
        ['POST', '/api/v1/tasks/t1/restore'],
        ['POST', '/api/v1/tasks/t3/restore'],
      ]);
    } finally {
      await h.close();
    }
  });
});
