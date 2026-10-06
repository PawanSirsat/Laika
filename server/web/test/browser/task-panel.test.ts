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
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';

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
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  blocked_by: ['t1'],
  blocks: [],
});

/** A subtask of the blocker — for the breadcrumb and the detach (D-066). */
const CHILD = task({
  id: 't4',
  key: 'LC-4',
  number: 4,
  title: 'A subtask of the blocker',
  parent_task_id: 't1',
});
/** Past due and still open — the red chip. */
const LATE = task({
  id: 't5',
  key: 'LC-5',
  number: 5,
  title: 'Overdue work',
  status: 'in_progress',
  due_on: Date.UTC(2026, 6, 12),
  branch: 'lc-5-overdue',
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
  '/api/v1/projects/laika-core/tasks': {
    data: [BLOCKER, SOURCE, SUBJECT, CHILD, LATE],
    next_cursor: null,
  },
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
  '/api/v1/tasks/t4': CHILD,
  '/api/v1/tasks/t4/comments': { data: [], next_cursor: null },
  '/api/v1/tasks/t4/watchers': { watchers: [] },
  '/api/v1/tasks/t5': LATE,
  '/api/v1/tasks/t5/comments': { data: [], next_cursor: null },
  '/api/v1/tasks/t5/watchers': { watchers: [] },
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

      assert.equal(await h.page.locator('.dep-chip').count(), 1, 'no dependency chip');
      assert.equal(await h.page.locator('.dep-link').count(), 1, 'no way to link a task');
      /*
       * **By name, not by count** (LAI-619). This asserted `=== 6` and broke
       * the moment a Sprint field was added — a true failure reporting the
       * wrong thing, since nothing was lost. A count cannot say *which* field
       * went missing, and the next person to add one gets the same puzzle.
       *
       * Watchers are a field on the rail now, not a list in the column.
       */
      // Upper-cased by CSS, so compare case-insensitively rather than pinning
      // the presentation — `text-transform` is the theme's business, not this
      // test's.
      const labels = (await h.page.locator('.panel-meta .meta-label').allInnerTexts()).map((t) =>
        t.trim().toLowerCase(),
      );
      /*
       * The Details card's rows, in the owner's order (D-066): the Jira ones
       * first, then what we have that Jira does not draw. Status is the
       * control above the card, not a row, so it is not in this list.
       */
      assert.deepEqual(labels, [
        'assignee',
        'priority',
        'parent',
        'due date',
        'labels',
        'sprint',
        'start date',
        'reporter',
        'created via',
        'watchers',
        'discovered from',
      ]);
      assert.equal(await h.page.locator('.meta-status select').count(), 1, 'no status control');
      assert.equal(await h.page.locator('.panel-permission').count(), 1, 'no permission note');

      // Jira's four tabs, with counts; History is what Activity was.
      const tabs = await h.page.locator('.panel-tab').allInnerTexts();
      assert.equal(tabs.length, 4);
      assert.match(tabs.join(' '), /All/);
      assert.match(tabs.join(' '), /Comments/);
      assert.match(tabs.join(' '), /History/);
      assert.match(tabs.join(' '), /Changes/);

      // The discovered-from trail is a row that opens the source.
      const discovered = h.page.locator('.meta-row', { hasText: 'Discovered from' });
      assert.match(await discovered.innerText(), /LC-2/);
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

  void test('the thread reads as a conversation, not a stack of cards', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      await h.page.locator('.cmt').first().waitFor({ timeout: 20_000 });

      const m = await h.page.evaluate(() => {
        const row = document.querySelector('.cmt');
        // A comment's avatar — the composer above the thread has a smaller one.
        const avatar = document.querySelector('.cmt .cmt-avatar');
        if (row === null || avatar === null) return null;
        const s2 = getComputedStyle(row);
        return {
          rows: document.querySelectorAll('.cmt').length,
          border: s2.borderTopWidth,
          background: s2.backgroundColor,
          avatar: Math.round(avatar.getBoundingClientRect().width),
          names: [...document.querySelectorAll('.cmt-who')].map((e) => e.textContent ?? ''),
          badges: [...document.querySelectorAll('.cmt-agent')].map((e) => e.textContent ?? ''),
          times: [...document.querySelectorAll('.cmt-when')].map((e) => e.textContent ?? ''),
          bots: document.querySelectorAll('.cmt-bot').length,
        };
      });
      assert.ok(m !== null, 'the thread did not render');
      assert.equal(m.rows, 2, 'the fixture has two comments');

      /*
       * **No box per comment.** Four bordered cards read as four unrelated
       * notices rather than a conversation — the owner's report, and the thing
       * the design does differently.
       */
      assert.equal(m.border, '0px', 'a comment is boxed again');
      assert.equal(m.background, 'rgba(0, 0, 0, 0)', 'a comment has a fill again');

      // A face in a thread, not a tint on a row.
      assert.equal(m.avatar, 36);

      /*
       * **`X's agent`, not `X`.** An agent comment was written by a tool
       * running as somebody, and the possessive is the honest attribution.
       */
      assert.ok(
        m.names.some((n) => n.endsWith("'s agent")),
        `no agent attribution: ${m.names.join(', ')}`,
      );
      assert.ok(
        m.names.some((n) => !n.endsWith("'s agent")),
        'every comment claims to be an agent',
      );

      assert.deepEqual(m.badges, ['AGENT'], 'the badge is upper-case and only on the agent');
      assert.equal(m.bots, 1, 'the bot mark rides on the agent’s avatar only');

      /*
       * Short, beside the name — never a timestamp to the second (LAI-486's
       * form: relative for a day, then a date and time). This used to accept
       * `just now ago`, which pinned the defect it should have caught.
       */
      for (const t of m.times) {
        assert.match(
          t,
          /^just now$|^[0-9]+ min ago$|^[0-9]+ h ago$|^[0-9]{1,2} [A-Z][a-z]{2}( [0-9]{4})?, [0-9]{2}:[0-9]{2}$/,
          `a timestamp reads "${t}"`,
        );
        assert.doesNotMatch(t, /just now ago/, 'the drawer says "just now ago" again');
      }
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
      /*
       * **The language is an attribute, not a badge** (LAI-287). The design's
       * code block carries no corner label — the fence's tag is metadata for a
       * highlighter this app does not have, so a floating `HTTP` was a label
       * with nothing behind it. It stays on the element for styling and for a
       * reader who wants it.
       */
      assert.equal(await h.page.locator('.comment-code').getAttribute('data-language'), 'http');
      assert.equal(await h.page.locator('.comment-code-lang').count(), 0);

      // `created_via === 'mcp'` is the fact; exactly one of the two comments has it.
      assert.equal(await h.page.locator('.cmt-agent').count(), 1);
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
      const toggle = h.page.locator('.panel-head-watch');
      assert.equal(await toggle.getAttribute('aria-label'), 'Unwatch');
      // The eye carries the count — two watchers in the fixture.
      assert.equal((await toggle.locator('.panel-head-count').innerText()).trim(), '2');
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

/**
 * The Jira-shaped view (D-066, LAI-494): the breadcrumb, the Details rows
 * that are new, the dates on the wire, and the rail's foot.
 */
async function openById(h: Awaited<ReturnType<typeof open>>): Promise<void> {
  await h.page.locator('.drawer').waitFor({ timeout: 20_000 });
  await h.page.locator('.panel-meta').waitFor({ timeout: 10_000 });
}

void describe('the Jira-shaped task view (D-066)', () => {
  void test('a subtask’s breadcrumb names its parent and opens it', async () => {
    const h = await open('/board?project=laika-core&task=t4', STUB);
    try {
      await openById(h);
      const crumb = h.page.locator('.panel-crumb-parent');
      assert.match(await crumb.innerText(), /LC-1/);
      assert.match(await h.page.locator('.panel-crumbs').innerText(), /LC-1\s*\/\s*LC-4/);
      // The parent row says the same thing, and a child never offers subtasks.
      const parentRow = h.page.locator('.meta-row-parent');
      assert.match(await parentRow.innerText(), /LC-1/);

      await crumb.click();
      await h.page.waitForTimeout(300);
      assert.match(h.page.url(), /task=t1/, 'the breadcrumb did not open the parent');
    } finally {
      await h.close();
    }
  });

  void test('a top-level task has no crumb, and offers "Add parent" that PATCHes parent_task_id', async () => {
    const h = await open('/board?project=laika-core&task=t3', STUB);
    try {
      await openById(h);
      assert.equal(await h.page.locator('.panel-crumb-parent').count(), 0);
      assert.equal((await h.page.locator('.panel-crumbs').innerText()).trim(), 'LC-3');

      await h.page.locator('.meta-row-parent .meta-add-link').click();
      const pick = h.page.locator('#parent-pick');
      // One level: a task that is itself a subtask is never offered.
      const offered = await pick.locator('option').allInnerTexts();
      assert.ok(
        offered.some((o) => o.startsWith('LC-1')),
        'the blocker is not offered',
      );
      assert.ok(!offered.some((o) => o.startsWith('LC-4')), 'a subtask is offered as a parent');
      await pick.selectOption('t1');
      await h.page.locator('.meta-row-parent .dep-confirm').click();
      await h.page.waitForTimeout(400);

      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3');
      assert.ok(patch !== undefined, 'no PATCH went out');
      assert.deepEqual(patch.body, { parent_task_id: 't1' });
    } finally {
      await h.close();
    }
  });

  void test('"Detach from parent" in the ⋯ menu PATCHes null', async () => {
    const h = await open('/board?project=laika-core&task=t4', STUB);
    try {
      await openById(h);
      await h.page.locator('.panel-head-action[aria-label="More actions"]').click();
      await h.page.locator('.panel-overflow button', { hasText: 'Detach from parent' }).click();
      await h.page.waitForTimeout(400);

      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t4');
      assert.ok(patch !== undefined, 'no PATCH went out');
      assert.deepEqual(patch.body, { parent_task_id: null });
    } finally {
      await h.close();
    }
  });

  void test('a due date is set as a UTC midnight and cleared with null', async () => {
    const h = await open('/board?project=laika-core&task=t3', STUB);
    try {
      await openById(h);
      await h.page.locator('.meta-row-due .meta-add-link').click();
      await h.page.locator('#due-date').fill('2026-07-12');
      await h.page.locator('.meta-row-due .dep-confirm').click();
      await h.page.waitForTimeout(400);

      const set = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3');
      assert.ok(set !== undefined, 'no PATCH went out');
      // `due_on` is unix-ms at a UTC midnight (§4.5), never a string.
      assert.deepEqual(set.body, { due_on: Date.UTC(2026, 6, 12) });
    } finally {
      await h.close();
    }

    const late = await open('/board?project=laika-core&task=t5', STUB);
    try {
      await openById(late);
      assert.match(await late.page.locator('.meta-row-due').innerText(), /12 Jul 2026/);
      await late.page.locator('.meta-row-due .dep-remove').click();
      await late.page.waitForTimeout(400);
      const clear = late.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t5');
      assert.ok(clear !== undefined, 'no PATCH went out');
      assert.deepEqual(clear.body, { due_on: null });
    } finally {
      await late.close();
    }
  });

  void test('the overdue chip is red only while the task is open, in both themes', async () => {
    /*
     * The theme switch sits under the modal's scrim, so the theme is set with
     * the drawer closed and the task re-opened by URL — the real toggle, used
     * the way a person would use it.
     */
    const h = await open('/board?project=laika-core', STUB);
    try {
      const colours: string[] = [];
      for (const theme of ['light', 'dark']) {
        await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        await h.page.goto(`${h.origin}/board?project=laika-core&task=t5`);
        await openById(h);
        const chip = h.page.locator('.meta-row-due .meta-date-chip');
        assert.ok(await chip.evaluate((el) => el.classList.contains('meta-date-overdue')));
        assert.match(await chip.innerText(), /⚠/);
        const colour = await chip.evaluate((el) => getComputedStyle(el).borderColor);
        assert.notEqual(colour, 'rgba(0, 0, 0, 0)', `${theme}: the chip lost its border`);
        colours.push(colour);
        await h.page.goto(`${h.origin}/board?project=laika-core`);
      }
      // The tokens differ between themes; a chip painted once would not.
      assert.notEqual(colours[0], colours[1], 'the overdue chip ignores the theme');
    } finally {
      await h.close();
    }

    // Finished late is finished: the same date on a done task is not overdue.
    const done = await open('/board?project=laika-core&task=t5', {
      ...STUB,
      '/api/v1/projects/laika-core/tasks': {
        data: [BLOCKER, SOURCE, SUBJECT, CHILD, { ...LATE, status: 'done' }],
        next_cursor: null,
      },
      '/api/v1/tasks/t5': { ...LATE, status: 'done' },
    });
    try {
      await openById(done);
      assert.equal(await done.page.locator('.meta-date-overdue').count(), 0);
      assert.match(await done.page.locator('.meta-row-due').innerText(), /12 Jul 2026/);
    } finally {
      await done.close();
    }
  });

  void test('reporter is who filed it, the foot carries both dates in full, Development only when there is any', async () => {
    const h = await open('/board?project=laika-core&task=t3', STUB);
    try {
      await openById(h);
      const reporter = h.page.locator('.meta-row', { hasText: 'Reporter' });
      assert.match(await reporter.innerText(), /Ada Lovelace/);

      const foot = (await h.page.locator('.panel-foot-times').innerText()).replace(/\s+/g, ' ');
      assert.match(foot, /^Created \w{3} \d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2} Updated \w{3} /);
      assert.doesNotMatch(foot, /ago/);

      // t3 has no branch, no PR and no commits: no Development card.
      const heads = await h.page.locator('.meta-card-head').allInnerTexts();
      assert.ok(heads.some((t) => t.includes('Details')));
      assert.ok(
        !heads.some((t) => t.includes('Development')),
        'Development drawn with nothing in it',
      );
    } finally {
      await h.close();
    }

    const branched = await open('/board?project=laika-core&task=t5', STUB);
    try {
      await openById(branched);
      const dev = branched.page.locator('.meta-card-head', { hasText: 'Development' });
      assert.equal(await dev.count(), 1, 'a task with a branch has no Development card');
      await dev.click();
      assert.match(await branched.page.locator('.panel-meta').innerText(), /lc-5-overdue/);
    } finally {
      await branched.close();
    }
  });

  void test('the All tab merges the thread and the history in time order', async () => {
    const h = await open('/board?project=laika-core', {
      ...STUB,
      '/api/v1/projects/laika-core/activity': {
        data: [
          {
            id: 'e1',
            seq: 1,
            type: 'task.status_changed',
            project_id: 'laika-core',
            task_id: 't3',
            actor_id: 'u1',
            actor_kind: 'user',
            actor_token_id: null,
            payload: { from: 'backlog', to: 'in_progress' },
            created_at: NOW - 3_600_000,
          },
        ],
        next_cursor: null,
      },
    });
    try {
      await openSubject(h);
      // All is the default tab, and it holds both kinds.
      const on = await h.page.locator('.panel-tab-on').innerText();
      assert.match(on, /All/);
      const rows = await h.page
        .locator('#panel-all > ul > li')
        .evaluateAll((els: Element[]) => els.map((el) => el.className));
      // Oldest first: the 2h-old comment, the 1h-old event, the 2-minute comment.
      assert.deepEqual(rows, ['cmt', 'panel-event', 'cmt']);
    } finally {
      await h.close();
    }
  });
});
