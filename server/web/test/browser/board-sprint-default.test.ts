/**
 * The board opens on the active sprint (LAI-713).
 *
 * The owner, with OnRoute's board on *All sprints*: a project's board should
 * show *"by default the current active sprint, not all selected — but the user
 * can change that."*
 *
 * The stub scopes tasks by `?sprint=` as the server does, so "the board shows
 * the active sprint" is read from the cards drawn, not from a URL alone. A
 * MutationObserver watches every card that is ever drawn, which is what proves
 * the board never shows every sprint first and then narrows.
 *
 * **The strip's `All sprints` button is gone (LAI-727).** Which scope is shown
 * is read from the toolbar's stat group, which names it, and *All sprints* is
 * chosen through the Filter's Sprint field — the only control left for it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';

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
const DAY = 86_400_000;

const sprint = (id: string, n: number, status: string) => ({
  id,
  project_id: 'laika-core',
  name: `Sprint ${String(n)}`,
  goal: null,
  status,
  starts_on: NOW + (n - 2) * 14 * DAY,
  ends_on: NOW + (n - 1) * 14 * DAY,
  created_at: n,
  updated_at: n,
});

const task = (n: number, status: string, sprintId: string | null) => ({
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
});

const TASKS = [
  task(1, 'done', 's1'),
  task(2, 'done', 's1'),
  task(3, 'todo', 's2'),
  task(4, 'in_progress', 's2'),
  task(5, 'backlog', 's3'),
  task(6, 'backlog', null),
];
const IN_S2 = ['t3', 't4'];
const EVERY = TASKS.map((t) => t.id);

function stub(sprints: readonly ReturnType<typeof sprint>[]): ApiStub {
  const page = (rows: typeof TASKS) => ({ data: rows, next_cursor: null });
  const scoped: Record<string, unknown> = {};
  for (const id of ['s1', 's2', 's3']) {
    scoped[`/api/v1/projects/laika-core/tasks?limit=200&sprint=${id}`] = page(
      TASKS.filter((t) => t.sprint_id === id),
    );
  }
  return {
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
          task_counts: { backlog: 2, todo: 1, in_progress: 1, review: 0, done: 2, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': page(TASKS),
    ...scoped,
    '/api/v1/projects/laika-core/sprints': { data: sprints, next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
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

const WITH_ACTIVE = [
  sprint('s1', 1, 'completed'),
  sprint('s2', 2, 'active'),
  sprint('s3', 3, 'planned'),
];
const NONE_ACTIVE = [sprint('s1', 1, 'completed'), sprint('s3', 3, 'planned')];

type Watch = Window & { __seen?: Set<string> };

/** Record every card id the page ever draws, from before the first render. */
async function watchCards(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      window.__seen = new Set();
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('article.card[data-task-id]')) {
          window.__seen.add(el.getAttribute('data-task-id'));
        }
      }).observe(document, { subtree: true, childList: true });
    `,
  });
}

const seen = async (h: Harness): Promise<string[]> =>
  [...(await h.page.evaluate(() => [...((window as Watch).__seen ?? [])]))].sort();

async function settle(h: Harness, expected: readonly string[]): Promise<void> {
  const want = [...expected].sort().join(',');
  await h.page.waitForFunction(
    (ids) =>
      [...document.querySelectorAll('article.card[data-task-id]')]
        .map((el) => el.getAttribute('data-task-id'))
        .sort()
        .join(',') === ids,
    want,
    { timeout: 15_000 },
  );
  await h.page.waitForTimeout(250);
}

const sprintInUrl = (h: Harness): string | null => new URL(h.page.url()).searchParams.get('sprint');

/** The scope the toolbar's figures are of, once the sprint list has named it. */
async function scopeShown(h: Harness, expected: string): Promise<string> {
  await h.page
    .waitForFunction(
      (want) => document.querySelector('.bstats-scope')?.textContent === want,
      expected,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  return (await h.page.locator('.bstats-scope').textContent()) ?? '';
}

/** Every sprint, through the Filter popover's Sprint field. */
async function chooseAllSprints(h: Harness): Promise<void> {
  await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
  await h.page
    .locator('.bt-field')
    .filter({ has: h.page.locator('.bt-label', { hasText: /^Sprint$/ }) })
    .locator('select')
    .selectOption({ label: 'Any' });
  await h.page.keyboard.press('Escape');
  await h.page.locator('.bt-catcher').waitFor({ state: 'detached', timeout: 5000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('the board opens on the active sprint (LAI-713)', () => {
  void test('with no sprint in the URL it opens on the active one, and never shows the rest first', async () => {
    const h = await open('/board?project=laika-core', stub(WITH_ACTIVE), { before: watchCards });
    try {
      await settle(h, IN_S2);
      assert.equal(sprintInUrl(h), 's2', 'the choice is not in the URL');
      assert.deepEqual(
        await seen(h),
        [...IN_S2].sort(),
        'cards from other sprints were drawn first',
      );
      assert.equal(await scopeShown(h, 'S2'), 'S2', 'the figures are not of the active sprint');
    } finally {
      await h.close();
    }
  });

  void test('with no active sprint it opens on every sprint, as before', async () => {
    const h = await open('/board?project=laika-core', stub(NONE_ACTIVE));
    try {
      await settle(h, EVERY);
      assert.equal(sprintInUrl(h), null);
      assert.equal(await scopeShown(h, 'All sprints'), 'All sprints');
    } finally {
      await h.close();
    }
  });

  void test('All sprints, once chosen, sticks — through a reload too', async () => {
    const h = await open('/board?project=laika-core', stub(WITH_ACTIVE));
    try {
      await settle(h, IN_S2);
      await chooseAllSprints(h);
      await settle(h, EVERY);
      assert.equal(sprintInUrl(h), 'all');
      await h.page.reload();
      await settle(h, EVERY);
      assert.equal(sprintInUrl(h), 'all', 'the default overrode the choice on reload');
      assert.equal(await scopeShown(h, 'All sprints'), 'All sprints');
    } finally {
      await h.close();
    }
  });

  void test('a link naming a sprint opens on that sprint, not the active one', async () => {
    const h = await open('/board?project=laika-core&sprint=s1', stub(WITH_ACTIVE));
    try {
      await settle(h, ['t1', 't2']);
      assert.equal(sprintInUrl(h), 's1');
    } finally {
      await h.close();
    }
  });

  void test('Clear all leaves every sprint; coming back to the board opens on the active one again', async () => {
    const h = await open('/board?project=laika-core', stub(WITH_ACTIVE));
    try {
      await settle(h, IN_S2);
      await h.page
        .locator('button', { hasText: /^Filter/ })
        .first()
        .click();
      await h.page.locator('button', { hasText: 'Clear all' }).first().click();
      await settle(h, EVERY);
      assert.equal(sprintInUrl(h), null);
      // The filter popover is still open over the tabs.
      await h.page.keyboard.press('Escape');
      await h.page.locator('.bt-catcher').waitFor({ state: 'detached', timeout: 5000 });

      await h.page.locator('a.view-tab[href^="/list"]').click();
      await h.page.waitForURL(/\/list\?/, { timeout: 5000 });
      await h.page.locator('a.view-tab[href^="/board"]').click();
      await settle(h, IN_S2);
      assert.equal(sprintInUrl(h), 's2');
    } finally {
      await h.close();
    }
  });

  void test('the List opened directly is not scoped to a sprint', async () => {
    const h = await open('/list?project=laika-core', stub(WITH_ACTIVE));
    try {
      await h.page.locator('tr.list-row').first().waitFor({ timeout: 15_000 });
      await h.page.waitForTimeout(400);
      assert.equal(await h.page.locator('tr.list-row').count(), EVERY.length);
      assert.equal(sprintInUrl(h), null);
    } finally {
      await h.close();
    }
  });
});
