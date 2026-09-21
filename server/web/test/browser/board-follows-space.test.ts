/**
 * The board follows the space you pick (LAI-261).
 *
 * **The shape the board suite was missing.** Every other board test opens at a
 * fixed `?project=` and never changes it, so a board that ignored a project
 * chosen from outside passed all of them — and did, until someone clicked a
 * space on a running instance and read another project's cards under the right
 * headline.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const project = (slug: string, name: string, prefix: string) => ({
  id: slug,
  slug,
  prefix,
  name,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 1, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
});

/** The by-slug shape the server really sends — no derived fields (LAI-259). */
const bare = (p: ReturnType<typeof project>) => ({
  id: p.id,
  slug: p.slug,
  prefix: p.prefix,
  name: p.name,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
});

const task = (id: string, key: string, projectId: string, title: string) => ({
  id,
  key,
  number: Number(key.split('-')[1]),
  project_id: projectId,
  title,
  description_md: '',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
});

const ALPHA = project('alpha-space', 'Alpha Space', 'AL');
const BETA = project('beta-space', 'Beta Space', 'BE');

/** Deliberately distinguishable: a card can only come from one of the two. */
const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [],
  },
  '/api/v1/projects': { data: [ALPHA, BETA], next_cursor: null },
  '/api/v1/projects/alpha-space': bare(ALPHA),
  '/api/v1/projects/beta-space': bare(BETA),
  '/api/v1/projects/alpha-space/tasks': {
    data: [task('t-a', 'AL-1', 'alpha-space', 'Only ever in Alpha')],
    next_cursor: null,
  },
  '/api/v1/projects/beta-space/tasks': {
    data: [task('t-b', 'BE-1', 'beta-space', 'Only ever in Beta')],
    next_cursor: null,
  },
  '/api/v1/projects/alpha-space/members': { members: [] },
  '/api/v1/projects/beta-space/members': { members: [] },
  '/api/v1/projects/alpha-space/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/beta-space/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/alpha-space/activity': { data: [], next_cursor: null },
  '/api/v1/projects/beta-space/activity': { data: [], next_cursor: null },
  '/api/v1/projects/alpha-space/tags': { tags: [] },
  '/api/v1/projects/beta-space/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

void after(async () => {
  await closeBrowser();
});

/** Which project's cards are on screen, by key prefix. */
async function cardKeys(page: Awaited<ReturnType<typeof open>>['page']): Promise<string> {
  const text = await page.locator('.kanban').innerText();
  return (text.match(/(AL|BE)-\d+/g) ?? []).join(',');
}

void describe('the board follows the space', () => {
  void test('clicking a space swaps the cards, with no reload', async () => {
    const h = await open('/board?project=alpha-space', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(() => document.body.innerText.includes('AL-1'), undefined, {
        timeout: 15_000,
      });
      assert.match(await cardKeys(h.page), /AL-1/);

      // The rail names a space by its **slug** since LAI-271, as the
      // reference does; the display name stays in the bar's headline.
      await h.page.locator('.sidebar-link', { hasText: 'Beta Space' }).click();
      await h.page.waitForURL(/project=beta-space/, { timeout: 10_000 });

      // The whole defect: the URL and the headline moved and the cards did not.
      await h.page.waitForFunction(() => document.body.innerText.includes('BE-1'), undefined, {
        timeout: 15_000,
      });
      const after = await cardKeys(h.page);
      assert.match(after, /BE-1/, 'the board did not follow the space');
      assert.doesNotMatch(after, /AL-1/, "the previous space's cards are still on screen");
      // The identity moved back to the bar (owner, 2026-09-21): switching
      // space renames the bar's headline, and the rail stays the product.
      assert.equal(await h.page.locator('.space-name').innerText(), 'Beta Space');
      assert.equal(await h.page.locator('.sidebar-wordmark').innerText(), 'Laika');
    } finally {
      await h.close();
    }
  });

  void test('and back again, so it is not a one-way sync', async () => {
    const h = await open('/board?project=alpha-space', STUB);
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(() => document.body.innerText.includes('AL-1'), undefined, {
        timeout: 15_000,
      });

      // The rail names a space by its **slug** since LAI-271, as the
      // reference does; the display name stays in the bar's headline.
      await h.page.locator('.sidebar-link', { hasText: 'Beta Space' }).click();
      await h.page.waitForFunction(() => document.body.innerText.includes('BE-1'), undefined, {
        timeout: 15_000,
      });

      await h.page.locator('.sidebar-link', { hasText: 'Alpha Space' }).click();
      await h.page.waitForFunction(() => document.body.innerText.includes('AL-1'), undefined, {
        timeout: 15_000,
      });
      assert.doesNotMatch(await cardKeys(h.page), /BE-1/);
    } finally {
      await h.close();
    }
  });

  void test('a board with no project in the URL still resolves one (LAI-423)', async () => {
    // The behaviour the state exists for, and which the fix must not break.
    const h = await open('/board', STUB);
    try {
      await h.page.waitForURL(/project=/, { timeout: 15_000 });
      await h.page.waitForFunction(() => /(AL|BE)-1/.test(document.body.innerText), undefined, {
        timeout: 15_000,
      });
      assert.match(h.page.url(), /project=(alpha|beta)-space/);
    } finally {
      await h.close();
    }
  });
});
