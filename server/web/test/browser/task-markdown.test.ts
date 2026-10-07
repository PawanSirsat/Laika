/**
 * The description and acceptance render as markdown (LAI-709).
 *
 * The owner's crop was ONR-331, an HLD written with `## headings`, `**bold**`,
 * tables and inline code, printed as raw asterisks. These tests assert the
 * **elements**, not the look: an `h2`, a `strong`, a `table`, a `code`. Text
 * matching cannot tell a rendered heading from the literal `## Heading`, since
 * both contain the word.
 *
 * The safety half matters as much as the rendering half. A description is
 * written by anyone on the project, and by agents. Each hostile line below is
 * asserted by the element that must **not** exist, plus the text that must
 * still be there, so a renderer that dropped the whole description could not
 * pass.
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

const DESCRIPTION = [
  'Owner: Sakshi. **Deliverable of this task:** the HLD.',
  '',
  '## What exists today',
  '',
  'Frontend is `Next.js 15`, with [the repo](https://example.com/repo).',
  '',
  '| Surface | Screens |',
  '|---|---|',
  '| Auth | 3 |',
  '| Operator console | 15 |',
  '',
  '- first point',
  '- second point',
  '',
  // `*`, not `-`: two `-` lists with a blank line between are one list.
  '* [x] done item',
  '* [ ] open item',
  '',
  '```ts',
  'const answer = 42;',
  '```',
  '',
  // Blank lines between: a raw HTML line opens an HTML block that swallows
  // every line after it up to the next blank, which would hide the two below.
  '<script>window.__pwned = true</script>',
  '',
  '<img src="x" onerror="window.__pwned = true">',
  '',
  '[click me](javascript:window.__pwned=true)',
  '',
  '![a diagram](https://tracker.example.com/pixel.png)',
].join('\n');

const NOW = Date.now();

const SUBJECT = {
  id: 't3',
  key: 'LC-3',
  number: 3,
  project_id: 'laika-core',
  title: 'Product UI/UX overhaul',
  description_md: DESCRIPTION,
  acceptance_md: 'Reviewed by **two** people:\n\n1. design\n2. engineering',
  status: 'todo',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
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
        task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
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
  '/api/v1/tasks/t3/comments': { data: [], next_cursor: null },
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
  await h.page.locator('.card', { hasText: 'Product UI/UX' }).first().waitFor({ timeout: 20_000 });
  await h.page.locator('.card', { hasText: 'Product UI/UX' }).first().click();
  await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
  await h.page.locator('.panel-section .md h2').waitFor({ timeout: 10_000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('the description renders as markdown', () => {
  void test('headings, bold, code, tables, lists and links are elements', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      const md = h.page.locator('.panel-section .inline-edit .md');

      assert.equal(await md.locator('h2').innerText(), 'What exists today');
      assert.equal(await md.locator('strong').first().innerText(), 'Deliverable of this task:');
      assert.equal(await md.locator('p code').first().innerText(), 'Next.js 15');
      assert.equal((await md.locator('pre code').innerText()).trim(), 'const answer = 42;');
      assert.deepEqual(await md.locator('th').allInnerTexts(), ['Surface', 'Screens']);
      assert.equal(await md.locator('tbody tr').count(), 2);
      assert.equal(await md.locator('ul').first().locator('li').count(), 2);
      assert.equal(await md.locator('input[type=checkbox]:checked').count(), 1, 'GFM task list');

      // The markers are consumed, not printed.
      const text = await md.innerText();
      assert.doesNotMatch(text, /\*\*|## |\|---/);

      // Links leave in a new tab and cannot reach back to the opener.
      const link = md.locator('a', { hasText: 'the repo' });
      assert.equal(await link.getAttribute('href'), 'https://example.com/repo');
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');

      // Acceptance renders too.
      const acceptance = h.page.locator('.panel-acceptance .md');
      assert.equal(await acceptance.locator('strong').innerText(), 'two');
      assert.equal(await acceptance.locator('ol li').count(), 2);
    } finally {
      await h.close();
    }
  });

  void test('raw HTML, a javascript: link and a remote image stay inert', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      const md = h.page.locator('.panel-section .inline-edit .md');

      assert.equal(await md.locator('script').count(), 0, 'a <script> became an element');
      // …and is still there to read, as text.
      assert.match(await md.innerText(), /<script>window\.__pwned = true<\/script>/);
      assert.equal(await md.locator('img').count(), 0, 'an image was loaded');
      assert.equal(
        await h.page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
        undefined,
      );

      // The javascript: link keeps its words and loses its target.
      const bad = md.locator('a', { hasText: 'click me' });
      assert.equal(await bad.count(), 1);
      const href = (await bad.getAttribute('href')) ?? '';
      assert.doesNotMatch(href, /javascript:/i);

      // The image's alt text stands in for it, and no request left for it.
      assert.equal(await md.locator('.md-img-alt').innerText(), 'a diagram');
      assert.ok(!h.calls.some((c) => c.path.includes('pixel')));
    } finally {
      await h.close();
    }
  });

  void test('clicking the rendered text opens the raw markdown; a link does not', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      const section = h.page.locator('.panel-section', { hasText: 'Description' }).first();

      // A link is followed, not edited.
      const popup = h.page.context().waitForEvent('page', { timeout: 5_000 });
      await section.locator('.md a', { hasText: 'the repo' }).click();
      await (await popup).close();
      assert.equal(await section.locator('textarea').count(), 0, 'a link click opened the editor');

      // The text itself opens the editor, holding the source, not the render.
      await section.locator('.md h2').click();
      const field = section.locator('textarea');
      await field.waitFor({ timeout: 5_000 });
      assert.equal(await field.inputValue(), DESCRIPTION);
    } finally {
      await h.close();
    }
  });

  void test('a keyboard user reaches the editor through a real button', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await openSubject(h);
      const section = h.page.locator('.panel-section', { hasText: 'Description' }).first();
      const button = section.getByRole('button', { name: 'Edit description' });
      await button.focus();
      await h.page.keyboard.press('Enter');
      await section.locator('textarea').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});
