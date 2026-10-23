/**
 * Changing a space's visibility after it exists (LAI-961; moved by LAI-977).
 *
 * It could only be chosen on the create form, while `PATCH /projects/:slug`
 * has taken `visibility` all along. LAI-961 put the control in the board's
 * View settings; D-103 moved it to the space's own settings page, **Access**,
 * as the owner's two cards — the panel keeps view options and links there.
 * Same `project.settings.edit` gate, same confirmation before going public.
 *
 * The stub is **stateful**: the PATCH writes the project every GET then reads,
 * so the page is measured against what the server would answer, not against
 * a value it kept for itself.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  DEFAULT_STATUSES,
  open,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';

const BASE = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LAI',
  description: null,
  repo: null,
  visibility: 'private',
  color: null,
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada' }],
  last_activity_at: 2,
};

const TASK = {
  id: 't1',
  key: 'LAI-1',
  project_id: 'p1',
  number: 1,
  title: 'A task',
  description_md: null,
  acceptance_md: null,
  status: 'todo',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: true,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
};

/** A lead, or a plain member who may read the setting and not change it. */
function stub(
  role: 'lead' | 'member',
  visibility: 'private' | 'public' = 'private',
): { stub: ApiStub; project: { visibility: string } } {
  const project = { ...BASE, visibility };
  return {
    project,
    stub: {
      '/api/v1/me': {
        id: 'u1',
        email: 'a@example.com',
        name: 'Ada',
        org_role: 'member',
        is_active: true,
        memberships: [{ project_id: 'p1', role }],
      },
      '/api/v1/projects': () => ({ data: [{ ...project }], next_cursor: null }),
      '/api/v1/projects/laika-core': (call: StubCall) => {
        if (call.method === 'PATCH') Object.assign(project, call.body as object);
        return { ...project };
      },
      '/api/v1/projects/laika-core/statuses': { data: DEFAULT_STATUSES },
      '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
      '/api/v1/projects/laika-core/members': {
        members: [{ user_id: 'u1', name: 'Ada', email: 'a@example.com', role, created_at: 1 }],
      },
      '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
      '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
      '/api/v1/projects/laika-core/tags': { tags: [] },
      '/api/v1/presence': { data: [], next_cursor: null },
    },
  };
}

const ACCESS = '/spaces/laika-core/settings?tab=access';

/** The two cards, once the grants are in: buttons for a holder, text for a reader. */
async function openAccess(h: Harness): Promise<void> {
  await h.page.locator('[data-visibility="private"]').waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator('.ss-reader').innerText()) !== 'Space settings');
}

const card = (h: Harness, value: 'private' | 'public') =>
  h.page.locator(`[data-visibility="${value}"]`);
const checked = async (h: Harness, value: 'private' | 'public') =>
  (await card(h, value).getAttribute('aria-checked')) === 'true';

const patches = (h: Harness): StubCall[] =>
  h.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/projects/laika-core');

after(async () => {
  await closeBrowser();
});

void describe('a lead', () => {
  void test('makes a private space public after confirming, and the page shows the server’s answer', async () => {
    const { stub: api } = stub('lead');
    const h = await open(ACCESS, api);
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await openAccess(h);

      assert.equal(
        await h.page.locator('[data-visibility][role="radio"]').count(),
        2,
        'a lead is offered both visibilities',
      );
      // The owner's design, word for word; no org name in this stub's org.
      assert.match(await card(h, 'private').innerText(), /Only members can see the board\./);
      assert.match(await card(h, 'public').innerText(), /can find it and join\./);
      assert.equal(await checked(h, 'private'), true, 'private is the current value');

      await card(h, 'public').click();
      const confirm = h.page.locator('.ss-confirm');
      await confirm.waitFor();
      assert.equal(patches(h).length, 0, 'nothing is sent before the confirmation');
      assert.equal(await checked(h, 'private'), true, 'the value stays private until confirmed');

      await confirm.locator('button', { hasText: 'Make public' }).click();
      await until(() => patches(h).length === 1);
      assert.deepEqual(
        patches(h).map((c) => c.body),
        [{ visibility: 'public' }],
      );
      await until(async () => checked(h, 'public'));
      assert.equal(await checked(h, 'public'), true, "the cards show the server's answer");
      assert.equal(await confirm.count(), 0, 'the confirmation goes once answered');
      // And the header's badge with it.
      assert.equal(await h.page.locator('.ss-badge').first().innerText(), 'PUBLIC');
    } finally {
      await h.close();
    }
  });

  void test('can cancel, and nothing is sent', async () => {
    const { stub: api } = stub('lead');
    const h = await open(ACCESS, api);
    try {
      await openAccess(h);
      await card(h, 'public').click();
      await h.page.locator('.ss-confirm button', { hasText: 'Cancel' }).click();
      assert.equal(await h.page.locator('.ss-confirm').count(), 0);
      assert.equal(await checked(h, 'private'), true, 'still private');
      await h.page.waitForTimeout(200);
      assert.equal(patches(h).length, 0, 'a cancelled change reached the server');
    } finally {
      await h.close();
    }
  });

  void test('makes a public space private without being asked twice', async () => {
    const { stub: api } = stub('lead', 'public');
    const h = await open(ACCESS, api);
    try {
      await openAccess(h);
      assert.equal(await checked(h, 'public'), true);
      await card(h, 'private').click();
      await until(() => patches(h).length === 1);
      assert.deepEqual(
        patches(h).map((c) => c.body),
        [{ visibility: 'private' }],
      );
      assert.equal(await h.page.locator('.ss-confirm').count(), 0, 'narrowing needs no confirm');
    } finally {
      await h.close();
    }
  });

  void test('fits 1440 and 390, light and dark, with the confirmation open', async () => {
    const { stub: api } = stub('lead');
    const h = await open(ACCESS, api);
    try {
      for (const width of [1440, 390]) {
        for (const theme of ['light', 'dark']) {
          await h.page.setViewportSize({ width: 1440, height: 900 });
          await h.page.goto(`${h.origin}${ACCESS}`);
          await openAccess(h);
          await setTheme(h.page, theme);
          await h.page.setViewportSize({ width, height: 844 });
          await card(h, 'public').click();
          const confirm = h.page.locator('.ss-confirm');
          await confirm.waitFor();
          await confirm.scrollIntoViewIfNeeded();

          const label = `${String(width)} ${theme}`;
          const box = await confirm.boundingBox();
          assert.ok(box !== null, `${label}: no confirmation`);
          assert.ok(
            box.x >= 0 && box.x + box.width <= width + 1,
            `${label}: confirmation off-screen ${JSON.stringify(box)}`,
          );
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(overflow <= 1, `${label}: page scrolls sideways by ${String(overflow)}px`);

          for (const name of ['Make public', 'Cancel']) {
            const button = confirm.locator('button', { hasText: name });
            assert.equal(await button.isVisible(), true, `${label}: ${name} hidden`);
            const ink = await button.evaluate((el) => {
              const s = getComputedStyle(el);
              return { color: s.color, background: s.backgroundColor };
            });
            assert.notEqual(ink.color, ink.background, `${label}: ${name} is unreadable`);
          }
          assert.equal(
            await h.page.evaluate(
              () => document.documentElement.getAttribute('data-theme') === 'light',
            ),
            theme === 'light',
            `${label}: not in that theme`,
          );
        }
      }
      assert.equal(patches(h).length, 0, 'measuring the confirmation sent a change');
    } finally {
      await h.close();
    }
  });
});

void describe('a member who is not a space admin', () => {
  void test('reads the visibility and is offered no control', async () => {
    const { stub: api } = stub('member', 'public');
    const h = await open(ACCESS, api);
    try {
      await openAccess(h);
      assert.equal(await h.page.locator('[data-visibility][role="radio"]').count(), 0);
      assert.equal(await card(h, 'public').getAttribute('aria-current'), 'true');
      assert.match(await card(h, 'public').innerText(), /can find it and join/);
      assert.equal(
        await h.page.locator('.ss-reader').innerText(),
        'Space settings · read only — space admins change these',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the board', () => {
  void test('View settings no longer carries Visibility; it links to the space’s settings', async () => {
    const { stub: api } = stub('lead');
    const h = await open('/board?project=laika-core', api);
    try {
      await h.page.waitForSelector('.card-title', { timeout: 20_000 });
      await h.page.locator('.bt-icon[title="View settings"]').click();
      await h.page.waitForSelector('.view-settings');
      assert.equal(await h.page.locator('input[name="vs-visibility"]').count(), 0);
      const link = h.page.locator('.vs-settings-link');
      assert.equal(await link.getAttribute('href'), '/spaces/laika-core/settings');
      await link.click();
      await until(() => new URL(h.page.url()).pathname === '/spaces/laika-core/settings');
      assert.equal(await h.page.locator('.view-settings').count(), 0, 'the panel stayed open');
    } finally {
      await h.close();
    }
  });
});
