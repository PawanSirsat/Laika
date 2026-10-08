/**
 * What the shared client store saves, measured as requests (LAI-724, D-075).
 *
 * Before it, on `master` 5adbfae: every project tab walked the whole task list
 * itself, the List walked it twice, a cold load asked for the project, its
 * members, its sprints, the projects list, presence and meeting reviews twice,
 * a live frame re-walked the board's lists, the Dashboard re-walked its whole
 * activity range on every frame (LAI-723), and Capacity made one
 * `GET /tasks/:id` per task it named. These count the requests a real browser
 * makes against the built app, by full URL — path **and** query — because the
 * harness's own `calls` drops the query, and the query is the difference
 * between one walk and two.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, fakeStream, open, type ApiStub, type Harness } from './harness.ts';

const NOW = Date.now();
const HOUR = 3_600_000;

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

const task = (id: string, n: number, status: string, over: Record<string, unknown> = {}) => ({
  id,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task ${String(n)}`,
  description_md: '',
  acceptance_md: '',
  status,
  priority: 'p2',
  position: null,
  assignee_id: 'u1',
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: 's1',
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
  created_at: NOW - 48 * HOUR,
  updated_at: NOW - HOUR,
  started_at: null,
  completed_at: null,
  ...over,
});

const event = (seq: number, at: number, actor: 'user' | 'agent' = 'agent') => ({
  id: `e${String(seq)}`,
  seq,
  type: 'task.status_changed',
  project_id: 'laika-core',
  task_id: 't3',
  actor_id: actor === 'agent' ? 'u2' : 'u1',
  actor_kind: actor,
  actor_token_id: null,
  payload: { from: 'todo', to: 'in_progress' },
  created_at: at,
});

interface Server {
  /** LC-3's status on the server. */
  t3: string;
  /** The project's activity, newest first. */
  events: ReturnType<typeof event>[];
}

function stub(server: Server): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/health': { status: 'ok', version: '0.1.0', uptime_ms: 1 },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
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
    '/api/v1/projects/laika-core/tasks': () => ({
      data: [
        task('t1', 1, 'todo'),
        task('t2', 2, 'todo'),
        task('t3', 3, server.t3),
        task('t4', 4, 'done'),
      ],
      next_cursor: null,
    }),
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
    '/api/v1/projects/laika-core/sprints': {
      data: [
        {
          id: 's1',
          project_id: 'laika-core',
          name: 'Sprint one',
          goal: 'Ship it.',
          status: 'active',
          starts_on: NOW - 86_400_000,
          ends_on: NOW + 13 * 86_400_000,
          created_at: 1,
          updated_at: 1,
        },
      ],
      next_cursor: null,
    },
    // Answered by `routeActivity` where a test needs the query; empty otherwise.
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
  };
}

/** The activity route needs the query, which `StubCall` does not carry: routed in the page. */
async function routeActivity(page: Page, server: Server): Promise<void> {
  await page.route('**/api/v1/projects/laika-core/activity?**', async (route) => {
    const url = new URL(route.request().url());
    const since = url.searchParams.get('since');
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const rows = server.events.filter((e) => since === null || e.created_at >= Number(since));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: rows.slice(0, limit), next_cursor: null }),
    });
  });
}

/** Every `/api/` request the page makes, as path + query, from the moment it is called. */
function record(h: Harness): string[] {
  const seen: string[] = [];
  h.page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/')) seen.push(`${url.pathname}${url.search}`);
  });
  return seen;
}

/** Wait until no `/api/` request has started for `quiet` ms. */
async function settle(seen: string[], page: Page, quiet = 800): Promise<void> {
  let last = seen.length;
  let still = 0;
  while (still < quiet) {
    await page.waitForTimeout(100);
    if (seen.length === last) still += 100;
    else {
      last = seen.length;
      still = 0;
    }
  }
}

function duplicates(urls: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const url of urls) counts.set(url, (counts.get(url) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([url, n]) => `${String(n)}× ${url}`);
}

const isTasks = (url: string): boolean => url.startsWith('/api/v1/projects/laika-core/tasks');

async function tab(h: Harness, label: string): Promise<void> {
  await h.page
    .locator('.view-tabs a', { hasText: new RegExp(`^${label}`) })
    .first()
    .click();
}

async function emit(page: Page, data: unknown, seq: number): Promise<void> {
  await page.evaluate(
    ([body, n]) => {
      (
        window as unknown as {
          __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
        }
      ).__laikaStream.emit('task.status_changed', body, String(n));
    },
    [data, seq] as const,
  );
}

void after(async () => {
  await closeBrowser();
});

void describe('a cold load and a tab sequence (LAI-724)', () => {
  void test('List → Timeline → List → Board → Dashboard → List walks the tasks once and asks nothing twice', async () => {
    const server: Server = { t3: 'todo', events: [event(1, NOW - HOUR)] };
    const h = await open('/list?project=laika-core', stub(server), {
      before: async (page) => {
        await fakeStream(page);
        await routeActivity(page, server);
      },
    });
    const seen = record(h);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      await settle(seen, h.page);
      // The recorder attaches after `goto` begins; the first reads may be
      // missed. The harness's own `calls` sees every one, by path.
      const cold = h.calls.map((c) => c.path);
      const coldTasks = cold.filter((p) => p === '/api/v1/projects/laika-core/tasks').length;
      assert.equal(
        coldTasks,
        1,
        `the List walked the project ${String(coldTasks)} times, not once`,
      );
      const twice = duplicates(cold.filter((p) => p !== '/api/v1/projects/laika-core/activity'));
      assert.deepEqual(twice, [], 'an endpoint was requested twice on the List’s cold load');

      for (const [label, ready] of [
        ['Timeline', '.timeline, .tl, [class*="timeline"]'],
        ['List', '.list tbody tr'],
        ['Board', '.card'],
        ['Dashboard', '.dash'],
        ['List', '.list tbody tr'],
      ] as const) {
        const from = seen.length;
        await tab(h, label);
        await h.page.locator(ready).first().waitFor({ timeout: 20_000 });
        await settle(seen, h.page);
        const step = seen.slice(from);
        assert.deepEqual(
          step.filter(isTasks),
          [],
          `${label} walked the tasks again inside 30 seconds: ${step.join(', ')}`,
        );
        assert.deepEqual(duplicates(step), [], `${label} asked for something twice`);
        for (const small of ['/members', '/sprints', '/mentionable', '/tags', '?limit=200']) {
          const again = step.filter(
            (url) => url.endsWith(small) && !url.includes('/activity') && !isTasks(url),
          );
          if (label === 'Dashboard' && small === '/mentionable') continue; // its first read
          assert.deepEqual(again, [], `${label} re-read a fresh ${small}`);
        }
      }
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

void describe('a live change (LAI-724, keeping LAI-707 and LAI-708)', () => {
  void test('with the Board open: one walk for a burst, and the changed card glows', async () => {
    const server: Server = { t3: 'todo', events: [] };
    const h = await open('/board?project=laika-core', stub(server), { before: fakeStream });
    const seen = record(h);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await settle(seen, h.page);
      const from = seen.length;

      server.t3 = 'in_progress';
      for (let i = 0; i < 4; i += 1) {
        await emit(h.page, { ...event(10 + i, Date.now()), task_id: 't3' }, 10 + i);
      }
      await h.page
        .locator('article.card[data-task-id="t3"][data-flash]')
        .waitFor({ timeout: 10_000 });
      await settle(seen, h.page, 2_000);

      const step = seen.slice(from);
      assert.equal(
        step.filter(isTasks).length,
        1,
        `a burst of four frames cost ${String(step.filter(isTasks).length)} task walks: ${step.join(', ')}`,
      );
      assert.ok(
        step.filter((u) => u === '/api/v1/presence').length <= 1,
        `presence was re-read per frame: ${step.join(', ')}`,
      );
      assert.equal(
        await h.page.locator('article.card[data-flash]').count(),
        1,
        'the wrong card glowed',
      );
    } finally {
      await h.close();
    }
  });

  void test('with the Dashboard open: one small activity read since the newest held, and the count follows', async () => {
    const server: Server = {
      t3: 'todo',
      events: [event(2, NOW - HOUR), event(1, NOW - 2 * HOUR, 'user')],
    };
    const h = await open('/dashboard?project=laika-core', stub(server), {
      before: async (page) => {
        await fakeStream(page);
        await routeActivity(page, server);
      },
    });
    const seen = record(h);
    try {
      const all = h.page.locator('.dash-filter', { hasText: 'All' }).locator('.dash-filter-count');
      await all.waitFor({ timeout: 20_000 });
      await settle(seen, h.page);
      assert.equal((await all.innerText()).trim(), '2', 'positive control: both events');
      const from = seen.length;

      const fresh = event(3, Date.now());
      server.events = [fresh, ...server.events];
      server.t3 = 'in_progress';
      await emit(h.page, fresh, 3);
      await h.page.waitForFunction(
        () =>
          document.querySelector('.dash-filter .dash-filter-count')?.textContent?.trim() === '3',
        undefined,
        { timeout: 10_000 },
      );
      await settle(seen, h.page, 1_500);

      const step = seen.slice(from);
      const activity = step.filter((u) => u.includes('/activity'));
      assert.equal(
        activity.length,
        1,
        `a frame cost ${String(activity.length)} activity reads: ${step.join(', ')}`,
      );
      assert.equal(
        new URLSearchParams(activity[0]?.split('?')[1]).get('since'),
        String(NOW - HOUR),
        'the catch-up did not start at the newest event held',
      );
      assert.equal(step.filter(isTasks).length, 1, 'the frame did not cost exactly one task walk');
      for (const small of ['/members', '/mentionable']) {
        assert.equal(step.filter((u) => u.endsWith(small)).length, 0, `${small} re-read per frame`);
      }
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

void describe('Capacity resolves tasks from the store (LAI-724)', () => {
  void test('no GET /tasks/:id for the open project’s tasks, one for a task elsewhere, and 16 requests or fewer', async () => {
    const server: Server = { t3: 'in_progress', events: [] };
    const elsewhere = task('x9', 9, 'review', { key: 'OT-9', project_id: 'other' });
    const h = await open('/capacity?project=laika-core', {
      ...stub(server),
      '/api/v1/capacity': {
        enabled: true,
        people: [
          {
            user_id: 'u1',
            name: 'Ada Lovelace',
            active_sessions: 0,
            in_progress_tasks: ['t3', 't1'],
            oldest_in_progress_ms: HOUR,
            tasks_in_review: ['x9'],
            last_seen: NOW,
            unlisted: [],
          },
        ],
      },
      '/api/v1/unlisted': { data: [], next_cursor: null },
      '/api/v1/tasks/x9': elsewhere,
      // Served if asked, so a client that resolves every id by GET fails on
      // the count below rather than on a missing stub.
      '/api/v1/tasks/t1': task('t1', 1, 'todo'),
      '/api/v1/tasks/t3': task('t3', 3, 'in_progress'),
    });
    try {
      await h.page.locator('.cap-chip-key', { hasText: 'LC-3' }).waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(1_500);

      const paths = h.calls.map((c) => c.path);
      const perTask = paths.filter((p) => p.startsWith('/api/v1/tasks/'));
      assert.deepEqual(perTask, ['/api/v1/tasks/x9'], `per-task reads: ${perTask.join(', ')}`);
      assert.ok(
        (await h.page.locator('.cap-chip-key', { hasText: 'LC-1' }).count()) === 1,
        'a task in the open project did not resolve',
      );
      assert.ok(
        paths.length <= 16,
        `Capacity's cold load was ${String(paths.length)} requests: ${paths.join(', ')}`,
      );
      assert.deepEqual(duplicates(paths), [], 'Capacity asked for something twice');
    } finally {
      await h.close();
    }
  });
});
