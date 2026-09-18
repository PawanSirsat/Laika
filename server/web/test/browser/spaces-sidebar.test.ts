/**
 * The spaces sidebar and the view tabs (LAI-248).
 *
 * The live design replaces WORK/REVIEW with **SPACES** — your three most-recent
 * projects, then *More spaces* — and ties every view to the space you are in.
 * The views became a tab bar.
 *
 * What only a browser can show:
 *
 * - **the spaces are real projects**, with the project's own `prefix` as the key
 *   and counts from `task_counts` / `member_count` — not a fixture;
 * - **the fetch is gated on the session**, so `/login` does not 401 on every
 *   page load;
 * - **the tab bar carries `?project=`**, which is what makes it honest.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub, type StubCall } from './harness.ts';

const project = (slug: string, name: string, prefix: string, tasks: number, members: number) => ({
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
  task_counts: { backlog: tasks, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: members,
  members: [],
  last_activity_at: 2,
});

const CORE = project('laika-core', 'Laika Core', 'LC', 5, 5);
const WEB = project('laika-web', 'Laika Web', 'LW', 3, 1);
const INFRA = project('laika-infra', 'Laika Infra', 'LI', 14, 2);
const DOCS = project('laika-docs', 'Laika Docs', 'LD', 9, 2);

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [CORE, WEB, INFRA, DOCS], next_cursor: null },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

void after(async () => {
  await closeBrowser();
});

void describe('the SPACES section', () => {
  void test('lists real projects, keyed by their own prefix', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-key').first().waitFor({ timeout: 20_000 });

      const keys = await h.page.locator('.space-key').allInnerTexts();
      // Three spaces plus the More spaces row — the design's number.
      assert.deepEqual(keys, ['LC', 'LW', 'LI', 'MS'], `saw ${keys.join(', ')}`);

      const sidebar = await h.page.locator('#sidebar').innerText();
      assert.match(sidebar, /SPACES/);
      // **Real counts, not a fixture**: `34 tasks · 4 members` is the design's
      // sample, and ours must come from the project payload.
      assert.match(sidebar, /5 tasks · 5 members/, "laika-core's counts are missing");
      assert.match(sidebar, /3 tasks · 1 member/, 'singular member is not pluralised down');
      assert.doesNotMatch(sidebar, /34 tasks/, "the design's fixture leaked into the app");
    } finally {
      await h.close();
    }
  });

  void test('the current space is the active row, and only it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-key').first().waitFor({ timeout: 20_000 });
      const active = h.page.locator('.sidebar-link-active');
      assert.equal(await active.count(), 1, 'more than one row is marked current');
      assert.match(await active.innerText(), /Laika Core/);
    } finally {
      await h.close();
    }
  });

  /**
   * The old sidebar listed the views. If any of them is still there, the
   * restructure did not happen — it just gained a section.
   */
  void test('the sidebar no longer lists the views', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-key').first().waitFor({ timeout: 20_000 });
      const sidebar = await h.page.locator('#sidebar').innerText();
      for (const group of ['WORK', 'REVIEW']) {
        assert.doesNotMatch(sidebar, new RegExp(group), `${group} is still a sidebar group`);
      }
      // Capacity stays — it reads across every project and is not a space view.
      assert.match(sidebar, /Capacity/);
      assert.match(sidebar, /ORG/);
    } finally {
      await h.close();
    }
  });
});

void describe('the view tabs', () => {
  void test('are the project-scoped views, and every one carries the project', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-tab').first().waitFor({ timeout: 20_000 });

      const labels = (await h.page.locator('.space-tab').allInnerTexts()).map(
        (s) => s.split('\n')[0],
      );
      assert.deepEqual(labels, ['Board', 'Timeline', 'Sprints', 'Dashboard', 'Meeting review']);

      // **The project travels with every tab.** A bare path drops `?project=`
      // and the destination falls back to a different project (LAI-423).
      for (const href of await h.page
        .locator('.space-tab')
        .evaluateAll((els: Element[]) => els.map((e) => e.getAttribute('href') ?? ''))) {
        assert.match(href, /project=laika-core/, `a tab drops the project: ${href}`);
      }
    } finally {
      await h.close();
    }
  });

  void test('Capacity is not a tab — it is not a view of one space', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-tab').first().waitFor({ timeout: 20_000 });
      const labels = await h.page.locator('.space-tab').allInnerTexts();
      assert.ok(
        !labels.some((l) => l.includes('Capacity')),
        'Capacity is a tab, which claims it is about this project',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the fetch is gated on the session', () => {
  /**
   * `listProjects` needs a session. The shell renders on `/login` too, and an
   * ungated fetch there is a `401` on every sign-in page load — the trap
   * `useShellContext` already documents for the sprint count.
   */
  void test('signed out, the project list is never requested', async () => {
    const h = await open('/login', { '/api/v1/me': { error: { code: 'unauthorized' } } });
    try {
      await h.page.waitForTimeout(1500);
      const asked = h.calls.filter((c: StubCall) => c.path === '/api/v1/projects');
      assert.deepEqual(
        asked,
        [],
        `the sign-in page fetched projects ${String(asked.length)} time(s)`,
      );
      assert.equal(await h.page.locator('.space-key').count(), 0, 'spaces rendered signed out');
    } finally {
      await h.close();
    }
  });
});
