/**
 * The slim task list in a real browser (LAI-795).
 *
 * `description_md` and `acceptance_md` were 83% of a gzip'd 200-task page on
 * production (LAI-786), and only the task panel draws them. So every list the
 * app reads asks for `?fields=slim`, and the panel reads the task in full when
 * it opens. These count requests and measure boxes; none of them times
 * anything (LAI-779).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, fakeStream, open, until, type ApiStub, type Harness } from './harness.ts';

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

const DESCRIPTION = 'The **whole** description, which the list never carries.';
const ACCEPTANCE = '- [ ] the panel reads it\n- [ ] the board does not';

const task = (id: string, n: number, status: string, over: Record<string, unknown> = {}) => ({
  id,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task ${String(n)}`,
  description_md: `${DESCRIPTION} (${id})`,
  acceptance_md: ACCEPTANCE,
  status,
  priority: 'p2',
  position: null,
  assignee_id: 'u1',
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  send_back: null,
  size: null,
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

interface Server {
  /** LC-3 as the server holds it; a test changes it to model a write elsewhere. */
  t3: ReturnType<typeof task>;
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
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 2, in_progress: 1, review: 0, done: 0, cancelled: 0 },
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
      data: [task('t1', 1, 'todo'), task('t2', 2, 'todo'), server.t3],
      next_cursor: null,
    }),
    '/api/v1/tasks/t3': () => server.t3,
    '/api/v1/tasks/t3/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t3/watchers': { watchers: [] },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: false, present: [] },
  };
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

const isList = (url: string): boolean =>
  new URL(url, 'http://x').pathname === '/api/v1/projects/laika-core/tasks';
const isOne = (url: string): boolean => new URL(url, 'http://x').pathname === '/api/v1/tasks/t3';

async function emit(page: Page, seq: number): Promise<void> {
  await page.evaluate((n) => {
    (
      window as unknown as {
        __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
      }
    ).__laikaStream.emit(
      'task.updated',
      {
        id: `e${String(n)}`,
        seq: n,
        type: 'task.updated',
        project_id: 'laika-core',
        task_id: 't3',
        actor_id: 'u2',
        actor_kind: 'agent',
        actor_token_id: null,
        payload: {},
        created_at: Date.now(),
      },
      String(n),
    );
  }, seq);
}

void after(async () => {
  await closeBrowser();
});

void describe('every list the Board reads is slim (LAI-795)', () => {
  void test('the first walk and a live refresh both ask for fields=slim, and the cards draw', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core', stub(server), { before: fakeStream });
    const seen = record(h);
    try {
      await h.page.locator('article.card[data-task-id="t3"]').waitFor({ timeout: 20_000 });
      // The recorder attaches after `goto` begins; the harness saw the first walk.
      const first = h.calls.filter((c) => c.path === '/api/v1/projects/laika-core/tasks');
      assert.equal(first.length, 1, 'the board did not walk its tasks once');

      server.t3 = { ...server.t3, title: 'Renamed elsewhere', updated_at: Date.now() };
      await emit(h.page, 10);
      await h.page
        .locator('article.card[data-task-id="t3"]', { hasText: 'Renamed elsewhere' })
        .waitFor({ timeout: 10_000 });

      const lists = seen.filter(isList);
      assert.ok(lists.length >= 1, `the live frame did not refresh the list: ${seen.join(', ')}`);
      for (const url of lists) {
        assert.equal(new URL(url, 'http://x').searchParams.get('fields'), 'slim', url);
      }
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('the URL the first walk sent, in full, carries the selector', async () => {
    // `calls` drops the query, so the first request is read from the page itself.
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const asked: string[] = [];
    const h = await open('/list?project=laika-core', stub(server), {
      before: async (page) => {
        page.on('request', (r) => {
          if (isList(r.url())) asked.push(r.url());
        });
        await Promise.resolve();
      },
    });
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.equal(asked.length, 1, asked.join(', '));
      const query = new URL(asked[0]!).searchParams;
      assert.equal(query.get('fields'), 'slim');
      assert.equal(query.get('limit'), '200');
    } finally {
      await h.close();
    }
  });
});

void describe('the panel reads the task in full when it opens (LAI-795)', () => {
  void test('one GET /tasks/:id, and the description and acceptance come from it', async () => {
    // The list and the full read carry **different** texts, so what the panel
    // draws says which one it came from.
    const server: Server = {
      t3: task('t3', 3, 'in_progress', {
        description_md: 'The copy in the **list**, which the panel must not draw.',
        acceptance_md: '- [ ] from the list',
      }),
    };
    const h = await open('/board?project=laika-core', {
      ...stub(server),
      '/api/v1/tasks/t3': () => ({
        ...server.t3,
        description_md: 'The **whole** description, from GET /tasks/:id.',
        acceptance_md: '- [ ] from the full read',
      }),
    });
    try {
      await h.page.locator('article.card[data-task-id="t3"]').click();
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 10_000 });
      const main = await h.page.locator('.panel-main').innerText();
      assert.match(main, /from GET \/tasks\/:id/);
      assert.match(main, /from the full read/);
      assert.doesNotMatch(main, /copy in the list|from the list/);

      const reads = h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/tasks/t3');
      assert.equal(reads.length, 1, 'the panel read the task more than once on open');
    } finally {
      await h.close();
    }
  });

  void test('while the read is slow the description holds its place, and nothing moves when it lands', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await open('/board?project=laika-core', stub(server));
    try {
      await h.page.route('**/api/v1/tasks/t3', async (route) => {
        if (route.request().method() === 'GET') await gate;
        await route.continue();
      });
      await h.page.locator('article.card[data-task-id="t3"]').click();
      const pending = h.page.locator('[data-loading="description"]');
      await pending.waitFor({ timeout: 10_000 });
      // Layout lands on fractions of a pixel; a move is anything past half of one.
      const same = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
      const box = async (selector: string) => {
        const b = await h.page.locator(selector).first().boundingBox();
        assert.ok(b !== null, `${selector} is not on screen`);
        return b;
      };
      // The place is held from the first frame; the pulse comes later
      // (`useDelayed`) and must not change it.
      const early = await box('[data-loading="description"]');
      await h.page.locator('.panel-text-skeleton').waitFor({ timeout: 5_000 });
      const pulsing = await box('[data-loading="description"]');
      assert.ok(
        same(pulsing.height, early.height),
        `the pulse changed the height of the place held: ${String(early.height)}px → ${String(pulsing.height)}px`,
      );
      assert.equal(
        await h.page.locator('[data-section="description"] .inline-edit').count(),
        0,
        'an editable, empty description was drawn before its text was read',
      );
      assert.equal(await h.page.locator('[data-section="acceptance"]').count(), 0);

      const before = {
        title: await box('.panel-title'),
        rail: await box('.panel-meta'),
        description: await box('[data-section="description"]'),
      };

      release();
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 10_000 });
      assert.equal(await pending.count(), 0);

      const afterLanding = {
        title: await box('.panel-title'),
        rail: await box('.panel-meta'),
        description: await box('[data-section="description"]'),
      };
      for (const part of ['title', 'rail'] as const) {
        for (const side of ['x', 'y', 'width', 'height'] as const) {
          assert.ok(
            same(afterLanding[part][side], before[part][side]),
            `the ${part} moved when the text landed: ${side} ${String(before[part][side])} → ${String(afterLanding[part][side])}`,
          );
        }
      }
      assert.ok(same(afterLanding.description.y, before.description.y), 'the description moved');
      // The text is one line here; the place held for it was not smaller.
      const text = await box('[data-section="description"] .inline-edit');
      assert.ok(
        early.height >= text.height,
        `the place held (${String(early.height)}px) was smaller than the text (${String(text.height)}px)`,
      );
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a live change to the open task re-reads its text behind the screen, never blanking it', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core&task=t3', stub(server), {
      before: fakeStream,
    });
    try {
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => {
        const flags = window as unknown as { __blanked: boolean };
        flags.__blanked = false;
        new MutationObserver(() => {
          if (document.querySelector('[data-loading="description"]') !== null) {
            flags.__blanked = true;
          }
        }).observe(document.body, { childList: true, subtree: true });
      });

      server.t3 = {
        ...server.t3,
        description_md: 'Rewritten by **someone else**.',
        updated_at: Date.now(),
      };
      await emit(h.page, 20);
      await h.page
        .locator('.panel-main strong', { hasText: 'someone else' })
        .waitFor({ timeout: 10_000 });

      const blanked = await h.page.evaluate(
        () => (window as unknown as { __blanked: boolean }).__blanked,
      );
      assert.equal(blanked, false, 'the description blanked to a placeholder while it re-read');
      const reads = h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/tasks/t3');
      assert.equal(reads.length, 2, 'one read on open, one for the newer version');
    } finally {
      await h.close();
    }
  });

  void test('a frame that does not move the task does not read its text again', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core&task=t3', stub(server), {
      before: fakeStream,
    });
    try {
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 20_000 });
      const walks = (): number =>
        h.calls.filter((c) => c.path === '/api/v1/projects/laika-core/tasks').length;
      const walked = walks();
      await emit(h.page, 30);
      await until(() => walks() > walked, 10_000);
      assert.ok(walks() > walked, 'the frame did not refresh the list');
      // A fixed window: what is asserted is that something does *not* happen.
      await h.page.waitForTimeout(500);
      const reads = h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/tasks/t3');
      assert.equal(reads.length, 1, 'the same version of the task was read twice');
    } finally {
      await h.close();
    }
  });
});

void describe('nothing reads a text off the list (LAI-795)', () => {
  void test('switching views and reloading reads no list in full, and no task by id without a panel', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core', stub(server));
    const seen = record(h);
    try {
      await h.page.locator('article.card').first().waitFor({ timeout: 20_000 });
      for (const label of ['List', 'Timeline', 'Board']) {
        await h.page
          .locator('.view-tabs a', { hasText: new RegExp(`^${label}`) })
          .first()
          .click();
        await h.page.waitForTimeout(300);
      }
      await h.page.reload();
      await h.page.locator('article.card').first().waitFor({ timeout: 20_000 });
      const lists = seen.filter(isList);
      assert.ok(lists.length >= 1, `no list was read after a reload: ${seen.join(', ')}`);
      const full = lists.filter(
        (url) => new URL(url, 'http://x').searchParams.get('fields') !== 'slim',
      );
      assert.deepEqual(full, [], 'a list was read in full');
      assert.equal(seen.filter(isOne).length, 0, 'a screen with no panel open read a task by id');
    } finally {
      await h.close();
    }
  });
});

/**
 * **A held text the panel knows is stale is never edited** (LAI-795 review,
 * B1). A re-read of the open task that failed — a 5xx during a deploy's
 * restart while an agent edits it over MCP — left the old text on screen,
 * editable, and never read again: the next save sent the stale text over the
 * other writer's. These are the reviewer's reproduction and its two smaller
 * forms.
 */
void describe('a stale description is never edited (LAI-795 review B1)', () => {
  const description = (h: Harness) => h.page.locator('[data-section="description"]');
  const editable = async (h: Harness): Promise<number> =>
    description(h).locator('.inline-edit-can').count();
  const reads = (h: Harness): number =>
    h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/tasks/t3').length;
  const patches = (h: Harness): number =>
    h.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3').length;
  const walks = (h: Harness): number =>
    h.calls.filter((c) => c.path === '/api/v1/projects/laika-core/tasks').length;

  /** Click the description and say whether an editor opened. */
  async function tryToEdit(h: Harness): Promise<boolean> {
    await description(h).locator('.inline-edit').first().click();
    // A fixed window: what is asserted may be that something does *not* happen.
    await h.page.waitForTimeout(300);
    return (await description(h).locator('textarea').count()) > 0;
  }

  void test('a failed re-read locks the old text, says so with Try again, and reads again on the next refresh', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core&task=t3', stub(server), {
      before: fakeStream,
    });
    let refused = 0;
    try {
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 20_000 });
      assert.ok((await editable(h)) > 0, 'positive control: the description is editable');

      await h.page.route('**/api/v1/tasks/t3', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        refused += 1;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'unavailable', message: 'Laika is restarting.' } }),
        });
      });
      server.t3 = {
        ...server.t3,
        description_md: 'Rewritten by **someone else**.',
        updated_at: Date.now(),
      };
      const walked = walks(h);
      await emit(h.page, 40);
      await until(() => walks(h) > walked && refused >= 1, 10_000);
      assert.ok(refused >= 1, 'the newer version was never asked for');

      const alert = description(h).locator('[role="alert"]');
      await until(async () => (await alert.count()) > 0, 5_000);
      assert.equal(await alert.count(), 1, 'a failed re-read of a stale text said nothing');
      assert.equal(await editable(h), 0, 'the stale text was still editable');
      assert.equal(await tryToEdit(h), false, 'an editor opened on the stale text');
      assert.equal(patches(h), 0);

      // The 5xx is over; the next refresh reads again, with no new version to prompt it.
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      const before = reads(h);
      await emit(h.page, 41);
      await h.page
        .locator('.panel-main strong', { hasText: 'someone else' })
        .waitFor({ timeout: 10_000 });
      assert.ok(reads(h) > before, 'the text changed without a read');
      assert.equal(await alert.count(), 0, 'the alert outlived the read that cleared it');
      assert.ok((await editable(h)) > 0, 'the fresh text is not editable');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('Try again reads it again, after a 503', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core&task=t3', stub(server), {
      before: fakeStream,
    });
    let refusing = true;
    try {
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 20_000 });
      await h.page.route('**/api/v1/tasks/t3', async (route) => {
        if (route.request().method() !== 'GET' || !refusing) return route.continue();
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'unavailable', message: 'Laika is restarting.' } }),
        });
      });
      server.t3 = {
        ...server.t3,
        description_md: 'Retried into **view**.',
        updated_at: Date.now(),
      };
      await emit(h.page, 50);
      const retry = description(h).locator('[role="alert"] button', { hasText: 'Try again' });
      await retry.waitFor({ timeout: 10_000 });

      refusing = false;
      await retry.click();
      await h.page.locator('.panel-main strong', { hasText: 'view' }).waitFor({ timeout: 10_000 });
      assert.ok((await editable(h)) > 0);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('while a newer version is being read, the old text does not open for editing', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core&task=t3', stub(server), {
      before: fakeStream,
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    try {
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 20_000 });
      await h.page.route('**/api/v1/tasks/t3', async (route) => {
        if (route.request().method() === 'GET') {
          held += 1;
          await gate;
        }
        await route.continue();
      });
      server.t3 = {
        ...server.t3,
        description_md: 'Rewritten by **someone else**.',
        updated_at: Date.now(),
      };
      await emit(h.page, 60);
      await until(() => held >= 1, 10_000);
      assert.ok(held >= 1, 'the newer version was never asked for');

      assert.equal(await editable(h), 0, 'the old text was editable while its successor loaded');
      assert.equal(await tryToEdit(h), false, 'an editor opened on the old text');

      release();
      await h.page
        .locator('.panel-main strong', { hasText: 'someone else' })
        .waitFor({ timeout: 10_000 });
      assert.ok((await editable(h)) > 0, 'the fresh text is not editable');
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('an edit begun on a version someone else has since replaced is not saved over it', async () => {
    const server: Server = { t3: task('t3', 3, 'in_progress') };
    const h = await open('/board?project=laika-core&task=t3', stub(server), {
      before: fakeStream,
    });
    try {
      await h.page.locator('.panel-main strong', { hasText: 'whole' }).waitFor({ timeout: 20_000 });
      assert.equal(await tryToEdit(h), true, 'positive control: the editor opens');
      const field = description(h).locator('textarea');
      await field.fill('My own rewrite, typed over the old version.');

      server.t3 = {
        ...server.t3,
        description_md: 'Rewritten by **someone else**.',
        updated_at: Date.now(),
      };
      const landed = h.page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/tasks/t3') && r.request().method() === 'GET',
      );
      await emit(h.page, 70);
      await landed;
      await h.page.waitForTimeout(300);

      await field.press('Control+Enter');
      const refusal = description(h).locator('.inline-edit-error');
      await until(async () => (await refusal.count()) > 0 || patches(h) > 0, 5_000);
      assert.equal(patches(h), 0, 'the edit was saved over the newer version');
      assert.match(await refusal.innerText(), /changed/i);
      assert.equal(
        await field.inputValue(),
        'My own rewrite, typed over the old version.',
        'the draft was thrown away',
      );
    } finally {
      await h.close();
    }
  });
});
