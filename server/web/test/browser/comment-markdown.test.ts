/**
 * A comment renders as markdown, the way the description does (LAI-734).
 *
 * The owner's screenshot was ONR-305: an agent's progress comment with
 * `**Progress**`, backticked paths, `- [ ]` checklists and bullets, printed as
 * raw asterisks and dashes, because comments still went through LAI-284's
 * fences-only parser while the description had moved to `TaskMarkdown`.
 *
 * Like `task-markdown.test.ts`, these assert **elements**, not text. A
 * rendered `strong` and a literal `**Progress**` both contain the word.
 *
 * The hostile comments are asserted by the element that must **not** exist and
 * the text that must still be there, so a renderer that dropped the comment
 * whole could not pass.
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

const PROGRESS = [
  '**Progress** on the import, @Ada Lovelace — see `server/src/import.ts`.',
  'Next line, same paragraph.',
  '',
  '- parsed the CSV',
  '- mapped the columns',
  '',
  '* [x] dry run',
  '* [ ] real run',
  '',
  '1. first',
  '2. second',
  '',
  '```http',
  'POST /api/v1/projects/laika-core/import?mode=dry-run&with=a-deliberately-long-query-string-that-does-not-fit-in-the-drawer',
  '```',
].join('\n');

const HOSTILE_LINK = '[x](javascript:window.__pwned=true)';
const HOSTILE_HTML = '<img src="x" onerror="window.__pwned = true">';

const comment = (id: string, body_md: string, at: number) => ({
  id,
  task_id: 't3',
  author_id: 'u1',
  body_md,
  created_via: 'mcp',
  edited_at: null,
  created_at: NOW - at,
  updated_at: NOW - at,
});

const COMMENTS = [
  comment('c1', PROGRESS, 300_000),
  comment('c2', HOSTILE_LINK, 200_000),
  comment('c3', HOSTILE_HTML, 100_000),
];

const SUBJECT = {
  id: 't3',
  key: 'LC-3',
  number: 3,
  project_id: 'laika-core',
  title: 'Import the backlog',
  description_md: '',
  acceptance_md: '',
  status: 'in_progress',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: COMMENTS.length,
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
};

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
        task_counts: { backlog: 0, todo: 0, in_progress: 1, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks?limit=200': { data: [SUBJECT], next_cursor: null },
  '/api/v1/projects/laika-core/tasks?parent=t3&limit=200': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/tasks/t3/comments': { data: COMMENTS, next_cursor: null },
  '/api/v1/tasks/t3/watchers': { watchers: [] },
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

type H = Awaited<ReturnType<typeof open>>;

async function openSubject(h: H): Promise<void> {
  await h.page
    .locator('.card', { hasText: 'Import the backlog' })
    .first()
    .waitFor({ timeout: 20_000 });
  await h.page.locator('.card', { hasText: 'Import the backlog' }).first().click();
  await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
  await h.page.locator('.cmt').nth(2).waitFor({ timeout: 10_000 });
}

/** The body of the `n`th comment in the thread. */
const body = (h: H, n: number) =>
  h.page.locator('.cmt').nth(n).locator('.cmt-body .panel-comment-body');

void after(async () => {
  await closeBrowser();
});

void describe('a comment renders as markdown', () => {
  void test('bold, inline code, lists and task-list checkboxes are elements', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      const md = body(h, 0);

      assert.equal(await md.locator('strong').innerText(), 'Progress');
      assert.equal(await md.locator('p code').innerText(), 'server/src/import.ts');
      assert.deepEqual(await md.locator('ul').first().locator('li').allInnerTexts(), [
        'parsed the CSV',
        'mapped the columns',
      ]);
      assert.equal(await md.locator('ol li').count(), 2);

      // The task list: two boxes, one ticked, and neither can be toggled.
      const boxes = md.locator('input[type=checkbox]');
      assert.equal(await boxes.count(), 2, 'the GFM task list did not render');
      assert.equal(await md.locator('input[type=checkbox]:checked').count(), 1);
      for (const box of await boxes.all()) assert.ok(await box.isDisabled(), 'a checkbox is live');

      // The markers are consumed, not printed.
      assert.doesNotMatch(await md.innerText(), /\*\*|`|\[ \]|\[x\]|^- /m);

      // The `@`-mention is still the author's words, in the paragraph, and a
      // single newline is still a line break, as a comment always showed it.
      const first = await md.locator('p').first().innerText();
      assert.match(first, /@Ada Lovelace/);
      assert.match(first, /import\.ts\.\nNext line, same paragraph\.$/);
    } finally {
      await h.close();
    }
  });

  void test('a fence is still LAI-284’s code block, and a long line stays inside the drawer', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      const md = body(h, 0);
      const block = md.locator('pre.comment-code');

      assert.equal(await block.count(), 1, 'the fence is not a .comment-code block');
      assert.equal(await block.getAttribute('data-language'), 'http');
      assert.match(await block.innerText(), /^POST \/api\/v1\/projects/);

      // The long request line scrolls inside its block; the comment does not
      // grow past the drawer.
      const m = await block.evaluate((pre) => {
        const drawer = pre.closest('.drawer');
        const cmt = pre.closest('.cmt');
        return {
          scrolls: pre.scrollWidth > pre.clientWidth,
          overflow: getComputedStyle(pre).overflowX,
          cmtRight: cmt?.getBoundingClientRect().right ?? Infinity,
          drawerRight: drawer?.getBoundingClientRect().right ?? 0,
        };
      });
      assert.equal(m.overflow, 'auto');
      assert.ok(m.scrolls, 'the long line wrapped or was cut instead of scrolling');
      assert.ok(m.cmtRight <= m.drawerRight + 0.5, 'a long code line widened the comment');
    } finally {
      await h.close();
    }
  });

  void test('a javascript: link and raw HTML in a comment stay inert', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);

      // The link keeps its words and loses its target.
      const link = body(h, 1).locator('a');
      assert.equal(await link.count(), 1);
      assert.equal(await link.innerText(), 'x');
      assert.doesNotMatch((await link.getAttribute('href')) ?? '', /javascript:/i);
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');

      // The raw `<img>` is text, not an element.
      const html = body(h, 2);
      assert.equal(await html.locator('img').count(), 0, 'an <img> became an element');
      assert.match(await html.innerText(), /<img src="x" onerror="window\.__pwned = true">/);

      assert.equal(
        await h.page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
        undefined,
      );
    } finally {
      await h.close();
    }
  });
});
