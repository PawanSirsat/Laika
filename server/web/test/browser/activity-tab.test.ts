/**
 * The Activity tab (LAI-281).
 *
 * The owner's updated design promotes the board's right rail to a tab of its
 * own — the live stream, the agent sessions and what has stopped moving, three
 * panels across — and leaves the board plain.
 *
 * The agent-session assertions below **moved here from `board-presence`**
 * rather than being rewritten: they were always about this panel, and the panel
 * only changed address.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const now = 1788272050095;
const P = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LAI',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 2, review: 1, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 3,
  members: [],
  last_activity_at: 2,
};

const task = (id: string, key: string, title: string, status: string) => ({
  id,
  key,
  project_id: 'p1',
  number: Number(key.split('-')[1]),
  title,
  description_md: null,
  acceptance_md: null,
  status,
  priority: 'p2',
  assignee_id: 'u1',
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: now - 5 * 3600000,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
});

const PRESENCE_STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [P], next_cursor: null },
  '/api/v1/projects/laika-core': P,
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        repo: 'git@github.com:PawanSirsat/Laika.git',
        branch: 'lai-9-parity',
        matched_task_id: 't1',
        project_ids: ['p1'],
        is_agent: true,
        last_seen: now,
      },
      // LAI-438: present, location withheld. repo/branch absent; the other two null/[].
      {
        user_id: 'u2',
        name: 'Tomas Nel',
        matched_task_id: null,
        project_ids: [],
        is_agent: false,
        last_seen: now - 60000,
      },
    ],
  },
  '/api/v1/capacity': {
    enabled: true,
    people: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        active_sessions: 2,
        in_progress_tasks: ['t1', 't2'],
        oldest_in_progress_ms: 5 * 3600000,
        tasks_in_review: ['t3'],
        last_seen: now,
        unlisted: ['n1'],
      },
      {
        user_id: 'u2',
        name: 'Tomas Nel',
        active_sessions: 1,
        in_progress_tasks: [],
        oldest_in_progress_ms: null,
        tasks_in_review: [],
        last_seen: now - 60000,
        unlisted: [],
      },
      {
        user_id: 'u3',
        name: 'Priya Raman',
        active_sessions: 0,
        in_progress_tasks: ['t2'],
        oldest_in_progress_ms: 40 * 60000,
        tasks_in_review: [],
        last_seen: null,
        unlisted: [],
      },
    ],
  },
  '/api/v1/tasks/t1': task('t1', 'LAI-9', 'Parity tests for the MCP tools', 'in_progress'),
  '/api/v1/tasks/t2': task('t2', 'LAI-12', 'Heartbeat retention job', 'in_progress'),
  '/api/v1/tasks/t3': task('t3', 'LAI-15', 'Rate limit headers', 'review'),
  '/api/v1/unlisted': {
    data: [
      {
        id: 'n1',
        user_id: 'u1',
        token_id: 'tok1',
        repo: 'PawanSirsat/Laika',
        note: 'The migration runner logs a warning nobody reads on every boot.',
        promoted_task_id: null,
        dismissed_at: null,
        created_at: now - 3600000,
      },
    ],
    next_cursor: null,
  },
};

const T = (id: string, key: string, title: string, status: string, assignee: string | null) => ({
  id,
  key,
  project_id: 'p1',
  number: Number(key.split('-')[1]),
  title,
  description_md: null,
  acceptance_md: null,
  status,
  priority: 'p2',
  assignee_id: assignee,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
});

const STUB: ApiStub = {
  ...PRESENCE_STUB,
  '/api/v1/projects/laika-core/tasks': {
    data: [
      T('t1', 'LAI-9', 'Parity tests', 'in_progress', 'u1'),
      T('t9', 'LAI-20', 'Something to do', 'todo', null),
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead', created_at: 1 },
      { user_id: 'u2', name: 'Tomas Nel', email: 't@example.com', role: 'member', created_at: 1 },
    ],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

void after(async () => {
  await closeBrowser();
});

void describe('the agent-sessions panel', () => {
  void test('lists real agent sessions, and only agents', async () => {
    const h = await open('/activity?project=laika-core', STUB);
    try {
      await h.page.locator('.rail-sessions li').first().waitFor({ timeout: 20_000 });
      const rows = h.page.locator('.rail-sessions li');
      // Ada is the only `is_agent` entry in the fixture; Tomas must not appear.
      assert.equal(await rows.count(), 1);
      // `Ada L.` — the panel draws the chip form (LAI-271); it did so in a
      // 252px rail and still does in a third of the Activity tab.
      assert.match(await rows.first().innerText(), /Ada L\./);
    } finally {
      await h.close();
    }
  });

  void test('a session stays inside its card', async () => {
    // The panel is a third of the row. The chip put the repo and the branch
    // side by side and ran off the right edge — found by looking, and fixed with
    // `min-width: 0`, without which `overflow: hidden` never gets a chance to
    // apply. The column is wider now and the property is the same one.
    const h = await open('/activity?project=laika-core', STUB);
    try {
      const row = h.page.locator('.rail-sessions li').first();
      await row.waitFor({ timeout: 20_000 });
      const card = h.page.locator('.rail-card', { hasText: 'Agent sessions' }).first();

      // **Measure the thing that overflows, not the thing that contains it.**
      // The first version of this assertion took the `li`'s box — and a
      // block-level `li` is exactly the card's width whether or not its contents
      // run past the edge, so removing the fix left it green. A mutation is what
      // said so. The chip inside is what grows.
      const chip = row.locator('.pp').first();
      const chipBox = await chip.boundingBox();
      const cardBox = await card.boundingBox();
      assert.ok(chipBox !== null && cardBox !== null, 'nothing to measure');
      assert.ok(
        chipBox.x + chipBox.width <= cardBox.x + cardBox.width + 0.5,
        `the chip runs to ${String(chipBox.x + chipBox.width)}, the card ends at ${String(cardBox.x + cardBox.width)}`,
      );

      // And nothing inside it is scrolled out of sight either.
      const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, `the session row hides ${String(overflow)}px of content`);
    } finally {
      await h.close();
    }
  });

  void test('no agent working says so', async () => {
    const quiet = { ...STUB, '/api/v1/presence': { enabled: true, present: [] } };
    const h = await open('/activity?project=laika-core', quiet);
    try {
      await h.page.locator('.rail-card').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(600);
      assert.equal(await h.page.locator('.rail-sessions li').count(), 0);
      assert.match(
        await h.page.locator('body').innerText(),
        /no agent has a session/i,
        'the card is a bare heading again',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the Activity tab', () => {
  void test('is a tab that keeps the space, and the board has no rail', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });

      /*
       * **Positive control first.** Both assertions below are absences, and a
       * board that failed to render would satisfy them — the blank-login defect
       * of LAI-251 passed for exactly that reason.
       */
      assert.ok((await h.page.locator('.lane').count()) >= 4, 'the board did not render');
      assert.equal(await h.page.locator('.rail').count(), 0, 'the board still has a rail');

      const tab = h.page.locator('.view-tab', { hasText: 'Activity' });
      await tab.waitFor({ timeout: 10_000 });
      assert.equal(await tab.getAttribute('href'), '/activity?project=laika-core');

      await tab.click();
      await h.page.waitForURL(/activity\?project=laika-core/, { timeout: 10_000 });
      await h.page.locator('.act-panels').waitFor({ timeout: 20_000 });
    } finally {
      await h.close();
    }
  });

  void test('draws the design’s three panels, level and equal', async () => {
    const h = await open('/activity?project=laika-core', STUB);
    try {
      await h.page.locator('.act-panels .rail-card').first().waitFor({ timeout: 20_000 });

      const heights = await h.page
        .locator('.act-panels .rail-card')
        .evaluateAll((els: Element[]) =>
          els.map((e) => Math.round(e.getBoundingClientRect().height)),
        );
      assert.equal(heights.length, 3, 'the design has three panels');
      // Three cards of different lengths side by side read as three unrelated
      // things rather than one screen.
      assert.equal(new Set(heights).size, 1, `the panels are ragged: ${heights.join(', ')}`);
    } finally {
      await h.close();
    }
  });

  void test('states its scope in the bar, and names the transport', async () => {
    const h = await open('/activity?project=laika-core', STUB);
    try {
      await h.page.locator('.act-panels').waitFor({ timeout: 20_000 });

      const pill = h.page.locator('.act-pill');
      assert.equal(await pill.count(), 1);
      assert.match(await pill.innerText(), /SSE/, 'the pill must name what "live" means here');

      // The header line is counted from what is on screen; a summary that
      // disagreed with the panels under it would be worse than none.
      const context = await h.page.locator('.space-context').innerText();
      assert.match(context, /agent session/);
      assert.match(context, /stale task/);
    } finally {
      await h.close();
    }
  });

  void test('never pushes the page sideways, at any width', async () => {
    const h = await open('/activity?project=laika-core', STUB);
    try {
      await h.page.locator('.act-panels').waitFor({ timeout: 20_000 });
      for (const width of [1600, 1440, 1280, 900, 420]) {
        await h.page.setViewportSize({ width, height: 900 });
        await h.page.waitForTimeout(150);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.equal(overflow, 0, `the page scrolls sideways at ${String(width)}px`);
      }
    } finally {
      await h.close();
    }
  });
});
