/**
 * The Board's WORKING NOW strip and the agent-sessions rail (LAI-440).
 *
 * Both rendered a heading and **nothing** in the shipped build: their contents
 * came from `demo/presence.ts` and `demo/agent-sessions.ts`, which return
 * nothing unless demo mode is on (D-032). `GET /presence` exists now, the demo
 * modules are deleted, and what a reader sees under those headings has to be
 * one of three states rather than a silence.
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

void describe('the WORKING NOW strip', () => {
  void test('renders real people, and the withheld one is still a person', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.presence-chip').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.presence-chip').count(), 2);

      const withheld = h.page.locator('.presence-chip', { hasText: 'Tomas Nel' });
      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        const text = await withheld.innerText();
        assert.match(text, /Tomas Nel/, `${theme}: the person is missing`);
        assert.match(text, /working elsewhere/, `${theme}: no sentence in place of the location`);
        assert.doesNotMatch(text, /unknown|undefined|null/i, `${theme}: a placeholder leaked`);
        assert.equal(await withheld.locator('.pp-repo').count(), 0, `${theme}: leaked a repo`);

        const box = await withheld.boundingBox();
        assert.ok(box !== null && box.width > 0, `${theme}: the chip has no box`);
      }
    } finally {
      await h.close();
    }
  });

  void test('an agent chip is marked and a human chip is not', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const agent = h.page.locator('.presence-chip', { hasText: 'Ada Lovelace' });
      await agent.waitFor({ timeout: 20_000 });
      assert.equal(await agent.locator('.marker-agent').count(), 1);
      const human = h.page.locator('.presence-chip', { hasText: 'Tomas Nel' });
      assert.equal(await human.locator('.marker-agent').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('nobody working says so, rather than showing a bare heading', async () => {
    const quiet = { ...STUB, '/api/v1/presence': { enabled: true, present: [] } };
    const h = await open('/board?project=laika-core', quiet);
    try {
      await h.page.locator('.presence').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(500);
      assert.equal(await h.page.locator('.presence-chip').count(), 0);
      assert.match(
        await h.page.locator('.presence').innerText(),
        /nobody has a session/i,
        'an empty strip under a heading reads as broken',
      );
    } finally {
      await h.close();
    }
  });

  void test('presence off hides the strip entirely, and the rail card with it', async () => {
    // AC3: on the Board there is nothing to explain and no room to explain it.
    // A permanent empty band on the main screen is a standing reproach for a
    // setting somebody chose.
    const off = { ...STUB, '/api/v1/presence': { enabled: false, present: [] } };
    const h = await open('/board?project=laika-core', off);
    try {
      await h.page.locator('.board').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(700);
      assert.equal(await h.page.locator('.presence').count(), 0, 'the strip survived');
      assert.doesNotMatch(
        await h.page.locator('body').innerText(),
        /WORKING NOW/,
        'the heading is still on the page',
      );
      assert.doesNotMatch(
        await h.page.locator('body').innerText(),
        /Agent sessions/,
        'the rail card is still on the page',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the agent-sessions rail card', () => {
  void test('lists real agent sessions, and only agents', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.rail-sessions li').first().waitFor({ timeout: 20_000 });
      const rows = h.page.locator('.rail-sessions li');
      // Ada is the only `is_agent` entry in the fixture; Tomas must not appear.
      assert.equal(await rows.count(), 1);
      assert.match(await rows.first().innerText(), /Ada Lovelace/);
    } finally {
      await h.close();
    }
  });

  void test('a session stays inside its card', async () => {
    // The rail is about 250px. The chip put the repo and the branch side by side
    // and ran off the right edge — found by looking, and fixed with `min-width:
    // 0`, without which `overflow: hidden` never gets a chance to apply.
    const h = await open('/board?project=laika-core', STUB);
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
    const h = await open('/board?project=laika-core', quiet);
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
