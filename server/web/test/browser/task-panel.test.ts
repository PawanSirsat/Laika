/**
 * The richer task panel (LAI-284).
 *
 * The owner asked for the design's drawer and said the agentic parts could be
 * dummy. Most of what they listed turned out to be **real API** and is wired:
 * inline title and description, priority, dependencies with link and unlink,
 * watchers, the client's name in provenance, the `agent` badge on a comment,
 * fenced code, and `@`-mentions. Three things are not and are marked on screen.
 *
 * These tests are mostly about **which request goes out**, because that is what
 * separates a wired control from one that merely looks right — the field name
 * `blocked_by_task_id` in particular, which LAI-407 got wrong while nothing
 * looked.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

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

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-9',
  number: 9,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'api',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

const BLOCKER = task({ id: 't1', key: 'LC-1', number: 1, title: 'The blocker' });
const SOURCE = task({ id: 't2', key: 'LC-2', number: 2, title: 'Where it came from' });
const SUBJECT = task({
  id: 't3',
  key: 'LC-3',
  number: 3,
  title: 'Org settings and org-role management',
  status: 'in_progress',
  priority: 'p1',
  assignee_id: 'u1',
  created_via: 'mcp',
  created_by_client: 'mira-cli',
  discovered_from: 't2',
  blocked_by: ['t1'],
  blocks: [],
});

const COMMENTS = [
  {
    id: 'c1',
    task_id: 't3',
    author_id: 'u1',
    body_md: 'Plain enough.',
    created_via: 'web',
    edited_at: null,
    created_at: NOW - 7_200_000,
    updated_at: NOW - 7_200_000,
  },
  {
    id: 'c2',
    task_id: 't3',
    author_id: 'u1',
    body_md: 'Reproduced:\n```http\nPOST /api/v1/tasks/t3/status\n```\nCache, not the write.',
    created_via: 'mcp',
    edited_at: null,
    created_at: NOW - 120_000,
    updated_at: NOW - 120_000,
  },
];

const STUB: ApiStub = {
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
        task_counts: { backlog: 2, todo: 0, in_progress: 1, review: 0, done: 0, cancelled: 0 },
        blocked_count: 1,
        member_count: 2,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [BLOCKER, SOURCE, SUBJECT], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' },
      { user_id: 'u2', name: 'Grace Hopper', email: 'g@example.com', role: 'viewer' },
    ],
  },
  '/api/v1/projects/laika-core/mentionable': {
    users: [
      { id: 'u1', name: 'Ada Lovelace' },
      { id: 'u2', name: 'Grace Hopper' },
    ],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/tasks/t3/comments': { data: COMMENTS, next_cursor: null },
  '/api/v1/tasks/t3/watchers': { watchers: ['u1', 'u2'] },
  '/api/v1/tasks/t3/dependencies': SUBJECT,
  '/api/v1/tasks/t3': SUBJECT,
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

async function openSubject(h: Awaited<ReturnType<typeof open>>): Promise<void> {
  await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
  await h.page.locator('.card', { hasText: 'Org settings' }).first().click();
  await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
  await h.page.locator('.panel-tab').first().waitFor({ timeout: 10_000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('the task panel', () => {
  void test('renders every section the design asks for', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);

      assert.equal(await h.page.locator('.discovered').count(), 1, 'no discovered-from callout');
      assert.equal(await h.page.locator('.dep-chip').count(), 1, 'no dependency chip');
      assert.equal(await h.page.locator('.dep-link').count(), 1, 'no way to link a task');
      // Watchers are a field on the rail now, not a list in the column.
      assert.equal(
        await h.page.locator('.panel-meta .meta-row').count(),
        6,
        'the rail lost a field',
      );
      assert.match(await h.page.locator('.panel-meta').innerText(), /Watchers/i);
      assert.equal(await h.page.locator('.panel-permission').count(), 1, 'no permission note');

      // The design's three tabs, with counts.
      const tabs = await h.page.locator('.panel-tab').allInnerTexts();
      assert.equal(tabs.length, 3);
      assert.match(tabs.join(' '), /Comments/);
      assert.match(tabs.join(' '), /Activity/);
      assert.match(tabs.join(' '), /Changes/);
    } finally {
      await h.close();
    }
  });

  void test('a watcher’s role is named, and it comes from the members', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      /*
       * `GET /watchers` returns **ids**; names and roles can only come from
       * members, and a second source for "who is this" would disagree with the
       * first. The rail names the people and calls out the Viewers, which is
       * the distinction that matters — a Viewer is told and cannot act.
       */
      const rail = await h.page.locator('.panel-meta').innerText();
      assert.match(rail, /Ada Lovelace/);
      assert.match(rail, /Grace Hopper/);
      assert.match(rail, /2 people/);
      assert.match(rail, /Grace Hopper is a Viewer/);
    } finally {
      await h.close();
    }
  });

  void test('a comment’s fenced code is code, and an agent is badged', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);

      assert.equal(await h.page.locator('.comment-code').count(), 1, 'the fence did not render');
      assert.match(await h.page.locator('.comment-code').innerText(), /POST \/api\/v1/);
      // The tag is upper-cased in CSS, so compare case-insensitively rather
      // than pinning a presentational choice.
      assert.match(await h.page.locator('.comment-code-lang').innerText(), /^http$/i);

      // `created_via === 'mcp'` is the fact; exactly one of the two comments has it.
      assert.equal(await h.page.locator('.panel-comment .marker-agent').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('editing the title sends a PATCH with only the title', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);

      await h.page.locator('.panel-title .inline-edit').click();
      const field = h.page.locator('.panel-title .inline-edit-field');
      await field.waitFor({ timeout: 10_000 });
      await field.fill('A better title');
      await field.press('Enter');
      await h.page.waitForTimeout(400);

      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3');
      assert.ok(patch !== undefined, 'no PATCH went out');
      /*
       * **Only the field that changed.** `PATCH` answers `422` for an unknown
       * field, and sending a whole task object back would be a write of every
       * other value on somebody else's behalf.
       */
      assert.deepEqual(patch.body, { title: 'A better title' });
    } finally {
      await h.close();
    }
  });

  void test('linking a task sends `blocked_by_task_id`', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);

      await h.page.locator('.dep-link').click();
      await h.page.locator('#dep-pick').selectOption('t2');
      await h.page.locator('.dep-confirm').click();
      await h.page.waitForTimeout(400);

      const post = h.calls.find(
        (c) => c.method === 'POST' && c.path === '/api/v1/tasks/t3/dependencies',
      );
      assert.ok(post !== undefined, 'no dependency POST went out');
      /*
       * **The field name is the whole test.** LAI-407's fixture sent
       * `depends_on`, the route answered `422`, and nothing looked — two tests
       * then asserted against a dependency graph that had never been built.
       */
      assert.deepEqual(post.body, { blocked_by_task_id: 't2' });
    } finally {
      await h.close();
    }
  });

  void test('watching sends PUT, and unwatching DELETE', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);

      /*
        Watch is a **header action** now, beside Move — it is a thing you do to
        the task, not a field describing it. `u1` is in the stub's watcher list,
        so it offers to stop.
      */
      const toggle = h.page.locator('.panel-head-action', { hasText: /watch/i });
      assert.match(await toggle.innerText(), /Unwatch/);
      await toggle.click();
      await h.page.waitForTimeout(400);

      const call = h.calls.find((c) => c.path === '/api/v1/tasks/t3/watch');
      assert.ok(call !== undefined, 'no watch call went out');
      // `PUT`/`DELETE`, never `POST`: watching is idempotent state (§6.4).
      assert.equal(call.method, 'DELETE');
    } finally {
      await h.close();
    }
  });

  void test('the invented claim deadline cannot reach a production build', async () => {
    /*
     * **D-032, asserted from the outside.**
     *
     * A claim has no TTL: `POST /tasks/:id/claim` is a compare-and-swap and
     * nothing expires it. The design draws *"until 14:32"*, so the panel can
     * only show one from `demo/agent-runtime.ts` — and that file must be
     * incapable of reaching a normal build, because a self-hoster reading an
     * expiry would wait for a lock that never lapses.
     *
     * The harness builds without `VITE_LAIKA_DEMO=1`, so this is that build.
     * The first version of this test asserted the *opposite* — that the line is
     * on screen — and failed, which is the guarantee working rather than a bug.
     */
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);

      // Positive control: the task is assigned, so a demo build would draw it.
      assert.match(await h.page.locator('.drawer').innerText(), /Ada Lovelace/);

      assert.equal(
        await h.page.locator('.claim-lock').count(),
        0,
        'an invented claim deadline reached a production build',
      );
      assert.doesNotMatch(await h.page.locator('.drawer').innerText(), /has the claim until/i);
    } finally {
      await h.close();
    }
  });

  void test('a Viewer gets the panel read-only', async () => {
    const viewer: ApiStub = {
      ...STUB,
      '/api/v1/me': {
        id: 'u2',
        email: 'g@example.com',
        name: 'Grace Hopper',
        org_role: 'viewer',
        is_active: true,
        memberships: [{ project_id: 'laika-core', role: 'viewer' }],
      },
    };
    const h = await open('/board?project=laika-core', viewer);
    try {
      await openSubject(h);

      // Positive control: the panel is really here before absences prove anything.
      assert.equal(await h.page.locator('.dep-chip').count(), 1);

      /*
       * Controls are **absent**, not disabled — a greyed-out button tells
       * somebody they are failing at something. The permission note is what
       * explains the absence, which is why it is not decoration.
       */
      assert.equal(await h.page.locator('.dep-link').count(), 0, 'a Viewer is offered Link task');
      assert.equal(await h.page.locator('.dep-remove').count(), 0, 'a Viewer can unlink');
      assert.equal(await h.page.locator('.panel-title button.inline-edit').count(), 0);
      assert.equal(await h.page.locator('.panel-permission').count(), 1);
    } finally {
      await h.close();
    }
  });
});
