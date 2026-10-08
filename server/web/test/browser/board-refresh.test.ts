/**
 * The board refreshes in place (LAI-707).
 *
 * Every live change — an agent moving a task through MCP, a teammate in another
 * tab, the echo of your own move — reloaded the board, and a reload set
 * `status: 'loading'`, which swapped the whole board for nothing or a skeleton
 * and rebuilt it: the flash the owner reported. These tests change the server's
 * answer between reads (`version`) and assert the board stays on screen and
 * only what changed changes.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, fakeStream, open, refuse, type ApiStub } from './harness.ts';

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
  assignee_id: null,
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
  created_at: 1,
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

/** Version 1, then version 2: LC-2 renamed, LC-3 finished. */
function tasksAt(version: number, extra = 0) {
  const base = [
    task('t1', 1, 'backlog'),
    task('t2', 2, 'todo', version >= 2 ? { title: 'Task 2, renamed' } : {}),
    task('t3', 3, version >= 2 ? 'done' : 'in_progress'),
    task('t4', 4, 'done'),
  ];
  const more = Array.from({ length: extra }, (_, i) => task(`m${String(i)}`, 100 + i, 'todo'));
  return [...base, ...more];
}

interface Server {
  version: number;
  extra: number;
  fail: 'none' | '500' | '403';
  /** LC-1's status, once a move has changed it on the server. */
  t1?: string;
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
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 1, todo: 1, in_progress: 1, review: 0, done: 1, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks': () =>
      server.fail === '500'
        ? refuse(500, 'internal', 'The server had a problem.')
        : server.fail === '403'
          ? refuse(403, 'forbidden', 'You can no longer read this project.')
          : {
              data: tasksAt(server.version, server.extra).map((t) =>
                t.id === 't1' && server.t1 !== undefined ? { ...t, status: server.t1 } : t,
              ),
              next_cursor: null,
            },
    '/api/v1/tasks/t1/status': () => {
      server.t1 = 'todo';
      return task('t1', 1, 'todo', { updated_at: Date.now() });
    },
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

type Probe = Window & {
  __k?: Element | null;
  __skeleton?: boolean;
  __nodes?: Map<string, Element>;
};

async function ready(page: Page): Promise<void> {
  await page.locator('.card').first().waitFor({ timeout: 20_000 });
}

/** Marks the `.kanban` node and starts noting whether a skeleton ever appears. */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Probe;
    w.__k = document.querySelector('.kanban');
    w.__skeleton = false;
    new MutationObserver(() => {
      if (document.querySelector('.skeleton-board, .skeleton-table')) w.__skeleton = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
}

async function laneOf(page: Page, key: string): Promise<string> {
  return page.evaluate((k) => {
    const card = [...document.querySelectorAll('.card')].find(
      (c) => c.querySelector('.card-key')?.textContent?.trim().startsWith(k) === true,
    );
    return card?.closest('.lane')?.querySelector('.lane-title')?.textContent?.trim() ?? '';
  }, key);
}

/** A live frame, as the server's stream sends one. */
async function frame(page: Page, taskId: string, seq: number): Promise<void> {
  await page.evaluate(
    ([id, n]) => {
      (
        window as unknown as {
          __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
        }
      ).__laikaStream.emit(
        'task.status_changed',
        {
          id: `e${String(n)}`,
          seq: n,
          type: 'task.status_changed',
          project_id: 'laika-core',
          task_id: id,
          actor_id: 'u2',
          actor_kind: 'agent',
          actor_token_id: null,
          payload: { from: 'in_progress', to: 'done' },
          created_at: Date.now(),
        },
        String(n),
      );
    },
    [taskId, seq] as const,
  );
}

void after(async () => {
  await closeBrowser();
});

void describe('a refresh leaves the board on screen (LAI-707)', () => {
  void test('Refresh with a slow answer keeps the same board and never shows a skeleton', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server));
    try {
      await ready(h.page);
      await watch(h.page);
      await h.page.route('**/api/v1/projects/laika-core/tasks**', async (route) => {
        await new Promise((done) => setTimeout(done, 800));
        await route.continue();
      });
      await h.page.locator('button[title="Refresh the board"]').click();
      await h.page.waitForTimeout(400);

      const mid = await h.page.evaluate(() => {
        const w = window as Probe;
        return {
          connected: w.__k?.isConnected === true,
          skeleton: w.__skeleton === true,
          cards: document.querySelectorAll('.card').length,
        };
      });
      assert.equal(mid.connected, true, 'the board was torn down while it refreshed');
      assert.equal(mid.skeleton, false, 'a skeleton replaced the board');
      assert.equal(mid.cards, 4, 'the cards left the screen while it refreshed');
      await h.page.waitForTimeout(700);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('unchanged cards keep their nodes; a changed one updates and a moved one lands', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server));
    try {
      await ready(h.page);
      await h.page.evaluate(() => {
        const w = window as Probe;
        w.__nodes = new Map(
          [...document.querySelectorAll('.card')].map((c) => [
            c.querySelector('.card-key')?.textContent?.trim().split(/\s/)[0] ?? '',
            c,
          ]),
        );
      });
      server.version = 2;
      await h.page.locator('button[title="Refresh the board"]').click();
      await h.page.getByText('Task 2, renamed').waitFor({ timeout: 10_000 });

      const same = await h.page.evaluate(() => {
        const w = window as Probe;
        const now = new Map(
          [...document.querySelectorAll('.card')].map((c) => [
            c.querySelector('.card-key')?.textContent?.trim().split(/\s/)[0] ?? '',
            c,
          ]),
        );
        return {
          lc1: now.get('LC-1') === w.__nodes?.get('LC-1'),
          lc4: now.get('LC-4') === w.__nodes?.get('LC-4'),
        };
      });
      assert.equal(same.lc1, true, 'LC-1 did not change and was rebuilt anyway');
      assert.equal(same.lc4, true, 'LC-4 did not change and was rebuilt anyway');
      assert.match(await laneOf(h.page, 'LC-3'), /done/i, 'LC-3 should have moved to Done');
    } finally {
      await h.close();
    }
  });

  void test('a lane’s scroll and an unsent draft survive a refresh', async () => {
    const server: Server = { version: 1, extra: 30, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server));
    try {
      await ready(h.page);
      const todo = h.page.locator('.lane', {
        has: h.page.locator('.lane-title', { hasText: /to do/i }),
      });
      await todo.locator('.lane-body').evaluate((el) => {
        el.scrollTop = 200;
      });
      const before = await todo.locator('.lane-body').evaluate((el) => el.scrollTop);
      assert.ok(before > 0, 'the lane did not scroll — the fixture is too short');

      await h.page
        .locator('.lane', { has: h.page.locator('.lane-title', { hasText: /backlog/i }) })
        .getByRole('button', { name: /add task/i })
        .click();
      const draft = h.page.getByPlaceholder('What needs to be done?');
      await draft.fill('Half a thought');

      await h.page.locator('button[title="Refresh the board"]').click();
      await h.page.waitForTimeout(800);

      assert.equal(await todo.locator('.lane-body').evaluate((el) => el.scrollTop), before);
      assert.equal(
        await h.page.getByPlaceholder('What needs to be done?').inputValue(),
        'Half a thought',
      );
    } finally {
      await h.close();
    }
  });

  void test('a failed refresh keeps the board and says so; Retry clears it', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server));
    try {
      await ready(h.page);
      server.fail = '500';
      await h.page.locator('button[title="Refresh the board"]').click();
      const notice = h.page.getByRole('status').filter({ hasText: /could not refresh/i });
      await notice.waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.card').count(), 4, 'a failed refresh wiped the board');

      server.fail = 'none';
      server.version = 2;
      await notice.getByRole('button', { name: /retry/i }).click();
      await h.page.getByText('Task 2, renamed').waitFor({ timeout: 10_000 });
      assert.equal(await notice.count(), 0, 'the notice stayed after a good refresh');
    } finally {
      await h.close();
    }
  });

  void test('a refresh refused 403 replaces the board — access is not something to keep showing', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server));
    try {
      await ready(h.page);
      server.fail = '403';
      await h.page.locator('button[title="Refresh the board"]').click();
      await h.page.locator('.kanban').waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await h.page.locator('.card').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the skeleton is for a new question only (LAI-707)', () => {
  void test('once shown, the first-load skeleton stays for its hold', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server), {
      before: async (page) => {
        await page.route('**/api/v1/projects/laika-core/tasks**', async (route) => {
          await new Promise((done) => setTimeout(done, 250));
          await route.continue();
        });
        await page.addInitScript(() => {
          const w = window as Window & { __shown?: number; __gone?: number };
          const look = (): void => {
            const there = document.querySelector('.skeleton-board') !== null;
            if (there && w.__shown === undefined) w.__shown = performance.now();
            if (!there && w.__shown !== undefined && w.__gone === undefined)
              w.__gone = performance.now();
          };
          new MutationObserver(look).observe(document, { subtree: true, childList: true });
        });
      },
    });
    try {
      await ready(h.page);
      const held = await h.page.evaluate(() => {
        const w = window as Window & { __shown?: number; __gone?: number };
        return w.__shown === undefined || w.__gone === undefined ? -1 : w.__gone - w.__shown;
      });
      assert.ok(held >= 290, `the skeleton was up ${String(Math.round(held))}ms — it flashed`);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  /*
   * **A filter change is answered from the held set** (LAI-724). It used to be
   * a new question for the server, so it walked the project again and showed
   * the skeleton meanwhile. The set is now held once per project and filtered
   * in memory, so the new answer is on screen at once: the risk this guarded —
   * the old answer shown as if it were the new one — cannot arise, because
   * there is no old answer in between. Asserted as such: no request, no
   * skeleton, and the cards are already the filtered ones.
   */
  void test('a filter change is answered at once from the held set, asking nothing', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server));
    try {
      await ready(h.page);
      await watch(h.page);
      const asked: string[] = [];
      h.page.on('request', (r) => {
        if (r.url().includes('/tasks')) asked.push(r.url());
      });
      await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
      // Every fixture task is p2, so p1 is the empty answer — not the old one.
      await h.page.locator('.bt-pop').getByLabel('Priority').selectOption('p1');
      await h.page.waitForFunction(
        () => document.querySelectorAll('.card').length === 0,
        undefined,
        {
          timeout: 2_000,
        },
      );
      await h.page.waitForTimeout(300);
      assert.deepEqual(asked, [], 'a filter change asked the server again');
      assert.equal(
        await h.page.evaluate(() => (window as Probe).__skeleton === true),
        false,
        'a filter answered from memory still showed a skeleton',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a live change redraws in place (LAI-707)', () => {
  void test('a stream frame moves the card without rebuilding the board', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server), { before: fakeStream });
    try {
      await ready(h.page);
      await watch(h.page);
      server.version = 2;
      await frame(h.page, 't3', 9);
      await h.page.waitForFunction(
        () =>
          [...document.querySelectorAll('.card')]
            .find((c) => c.querySelector('.card-key')?.textContent?.includes('LC-3'))
            ?.closest('.lane')
            ?.querySelector('.lane-title')
            ?.textContent?.toLowerCase()
            .includes('done') === true,
        undefined,
        { timeout: 10_000 },
      );
      const after = await h.page.evaluate(() => {
        const w = window as Probe;
        return { connected: w.__k?.isConnected === true, skeleton: w.__skeleton === true };
      });
      assert.equal(after.connected, true, 'the live change rebuilt the board');
      assert.equal(after.skeleton, false, 'the live change showed a skeleton');
    } finally {
      await h.close();
    }
  });

  void test('the sprint strip follows a live change', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server), { before: fakeStream });
    try {
      await ready(h.page);
      const frac = h.page.locator('.strip-chip-frac').first();
      await h.page.waitForFunction(
        () => /1\s*\/\s*4/.test(document.querySelector('.strip-chip-frac')?.textContent ?? ''),
        undefined,
        { timeout: 10_000 },
      );
      server.version = 2;
      await frame(h.page, 't3', 10);
      await h.page.waitForFunction(
        () => /2\s*\/\s*4/.test(document.querySelector('.strip-chip-frac')?.textContent ?? ''),
        undefined,
        { timeout: 10_000 },
      );
      assert.match(await frac.innerText(), /2\s*\/\s*4/);
    } finally {
      await h.close();
    }
  });

  void test('a change that arrives during a drag waits for the drop', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server), { before: fakeStream });
    try {
      await ready(h.page);
      // A drag in progress, by synthetic events — no pointer movement, which
      // would end the hold by design.
      await h.page.evaluate(() => {
        const card = document.querySelector('.card');
        const dt = new DataTransfer();
        (window as Window & { __dt?: DataTransfer }).__dt = dt;
        card?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      });
      server.version = 2;
      await frame(h.page, 't3', 11);
      await h.page.waitForTimeout(1200);
      assert.match(
        await laneOf(h.page, 'LC-3'),
        /in progress/i,
        'the board changed under the drag',
      );

      await h.page.evaluate(() => {
        const card = document.querySelector('.card');
        const dt = (window as Window & { __dt?: DataTransfer }).__dt;
        card?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt ?? null }));
      });
      await h.page.waitForFunction(
        () =>
          [...document.querySelectorAll('.card')]
            .find((c) => c.querySelector('.card-key')?.textContent?.includes('LC-3'))
            ?.closest('.lane')
            ?.querySelector('.lane-title')
            ?.textContent?.toLowerCase()
            .includes('done') === true,
        undefined,
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a refresh never undoes your own move (LAI-707)', () => {
  void test('an answer read before the move, arriving after it, does not snap the card back', async () => {
    const server: Server = { version: 1, extra: 0, fail: 'none' };
    const h = await open('/board?project=laika-core', stub(server), { before: fakeStream });
    try {
      await ready(h.page);
      // The next read is taken now and delivered late: an answer about the
      // board as it was before the move.
      await h.page.route('**/api/v1/projects/laika-core/tasks**', async (route) => {
        const response = await route.fetch();
        await new Promise((done) => setTimeout(done, 1500));
        await route.fulfill({ response });
      });
      await frame(h.page, 't3', 12);
      await h.page.waitForTimeout(500);

      // Now the person moves LC-1 to To do; the server agrees at once.
      const lc1 = h.page.locator('.lane-item', {
        has: h.page.locator('.card-key', { hasText: /^LC-1\b/ }),
      });
      await lc1.locator('.lane-move-select').selectOption('todo');
      await h.page.waitForFunction(
        () =>
          [...document.querySelectorAll('.card')]
            .find((c) => /^LC-1\b/.test(c.querySelector('.card-key')?.textContent?.trim() ?? ''))
            ?.closest('.lane')
            ?.querySelector('.lane-title')
            ?.textContent?.toLowerCase()
            .includes('to do') === true,
        undefined,
        { timeout: 10_000 },
      );

      // The stale answer lands well after the move.
      await h.page.waitForTimeout(2000);
      assert.match(
        await laneOf(h.page, 'LC-1'),
        /to do/i,
        'an answer older than the move put the card back where it was',
      );
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});
