/**
 * A nav click keeps the project you are reading (LAI-423, harness by LAI-227).
 *
 * The owner opened a seeded board, clicked "Sprints", and was told the project
 * had none. It had three — the click had moved them to a different project,
 * because `Sidebar` rendered a bare `href={route.path}` and the screens then
 * fell back to the alphabetically-first project.
 *
 * `nav-truth.test.ts` passed throughout: it asserts *which* destinations exist.
 * **Nothing asserted that clicking one takes you where you were**, because
 * nothing in this suite could click. Shown red against the pre-fix commit.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

/** Two projects, and the one we are reading is **not** alphabetically first. */
function project(id: string, slug: string, name: string, lastActivity: number) {
  return {
    id,
    slug,
    name,
    prefix: slug.slice(0, 3).toUpperCase(),
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
    task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
    blocked_count: 0,
    member_count: 1,
    members: [{ user_id: 'u1', name: 'Ada' }],
    last_activity_at: lastActivity,
  };
}

const ATLAS = project('p0', 'atlas', 'Atlas', 10);
const CORE = project('p1', 'laika-core', 'Laika Core', 99);

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [],
  },
  '/api/v1/projects': { data: [ATLAS, CORE], next_cursor: null },
  '/api/v1/projects/atlas': ATLAS,
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/atlas/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/atlas/members': { members: [] },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/atlas/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/atlas/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/atlas/tags': { tags: [] },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

void after(async () => {
  await closeBrowser();
});

void describe('the nav keeps the project', () => {
  void test('clicking Sprints from a board stays on the same project', async () => {
    // Deliberately `atlas`, which is alphabetically first — so a fallback bug
    // would land here too and hide itself. Starting on the *other* project is
    // what makes the failure visible.
    const h = await open('/board?project=laika-core', STUB);
    try {
      const sprints = h.page.locator('.sidebar-link', { hasText: 'Sprints' }).first();
      await sprints.waitFor({ timeout: 15_000 });

      // The probe must be able to see a nav link at all, or "the project was
      // lost" is indistinguishable from "there was no link".
      assert.ok((await sprints.count()) > 0, 'no Sprints nav link — this proves nothing');

      await sprints.click();
      await h.page.waitForURL(/\/sprints/, { timeout: 10_000 });

      const url = new URL(h.page.url());
      assert.equal(
        url.searchParams.get('project'),
        'laika-core',
        `clicking Sprints moved the reader to a different project: ${h.page.url()}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('the href itself carries it, so copy-link gives the same board', async () => {
    // Not just the click: `Sidebar` uses a real anchor precisely so middle-click
    // and copy-link work, and a handler that patched the URL afterwards would
    // fix the left-click while silently breaking those.
    const h = await open('/board?project=laika-core', STUB);
    try {
      const sprints = h.page.locator('.sidebar-link', { hasText: 'Sprints' }).first();
      await sprints.waitFor({ timeout: 15_000 });
      const href = await sprints.getAttribute('href');
      assert.ok(href !== null, 'the nav item is not an anchor with an href');
      assert.match(href, /project=laika-core/, `the href drops the project: ${href}`);
    } finally {
      await h.close();
    }
  });
});
