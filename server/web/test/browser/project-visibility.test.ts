/**
 * Changing a space's visibility after it exists (LAI-961).
 *
 * It could only be chosen on the create form, while `PATCH /projects/:slug`
 * has taken `visibility` all along. The control sits beside Hide done in View
 * settings, the board's one other project-wide setting, behind the same
 * `project.settings.edit` gate.
 *
 * The stub is **stateful**: the PATCH writes the project every GET then reads,
 * so "Projects shows it at once" is measured against what the server would
 * answer, not against a value the page kept for itself.
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

async function openPanel(h: Harness): Promise<void> {
  await h.page.waitForSelector('.card-title', { timeout: 20_000 });
  await h.page.locator('.bt-icon[title="View settings"]').click();
  await h.page.waitForSelector('.view-settings');
}

const patches = (h: Harness): StubCall[] =>
  h.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/v1/projects/laika-core');

after(async () => {
  await closeBrowser();
});

void describe('a lead', () => {
  void test('makes a private space public after confirming, and Projects shows it', async () => {
    const { stub: api } = stub('lead');
    const h = await open('/board?project=laika-core', api);
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await openPanel(h);

      const radios = h.page.locator('input[name="vs-visibility"]');
      assert.equal(await radios.count(), 2, 'a lead is offered both visibilities');
      // The create form's wording, word for word.
      const text = await h.page.locator('.vs-visibility').innerText();
      assert.match(text, /Private — invited members only/);
      assert.match(text, /Public — anyone in the org can join/);
      assert.equal(await radios.nth(0).isChecked(), true, 'private is the current value');

      await radios.nth(1).click();
      const confirm = h.page.locator('.vs-confirm');
      await confirm.waitFor();
      assert.equal(patches(h).length, 0, 'nothing is sent before the confirmation');
      assert.equal(
        await radios.nth(0).isChecked(),
        true,
        'the value stays private until confirmed',
      );

      await confirm.locator('button', { hasText: 'Make public' }).click();
      await until(() => patches(h).length === 1);
      assert.deepEqual(
        patches(h).map((c) => c.body),
        [{ visibility: 'public' }],
      );
      await until(async () => radios.nth(1).isChecked());
      assert.equal(await radios.nth(1).isChecked(), true, "the panel shows the server's answer");
      assert.equal(await confirm.count(), 0, 'the confirmation goes once answered');

      // In-app navigation, not a reload — the router's own popstate path — so
      // nothing but the Projects list's own read can put PUBLIC there.
      await h.page.keyboard.press('Escape');
      await h.page.evaluate(() => {
        window.history.pushState({}, '', '/projects');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      const chip = h.page.locator('.project-card .project-chip').first();
      await chip.waitFor({ timeout: 10_000 });
      assert.equal(await chip.innerText(), 'PUBLIC');
    } finally {
      await h.close();
    }
  });

  void test('can cancel, and nothing is sent', async () => {
    const { stub: api } = stub('lead');
    const h = await open('/board?project=laika-core', api);
    try {
      await openPanel(h);
      const radios = h.page.locator('input[name="vs-visibility"]');
      await radios.nth(1).click();
      await h.page.locator('.vs-confirm button', { hasText: 'Cancel' }).click();
      assert.equal(await h.page.locator('.vs-confirm').count(), 0);
      assert.equal(await radios.nth(0).isChecked(), true, 'still private');
      await h.page.waitForTimeout(200);
      assert.equal(patches(h).length, 0, 'a cancelled change reached the server');
    } finally {
      await h.close();
    }
  });

  void test('makes a public space private without being asked twice', async () => {
    const { stub: api } = stub('lead', 'public');
    const h = await open('/board?project=laika-core', api);
    try {
      await openPanel(h);
      const radios = h.page.locator('input[name="vs-visibility"]');
      assert.equal(await radios.nth(1).isChecked(), true);
      await radios.nth(0).click();
      await until(() => patches(h).length === 1);
      assert.deepEqual(
        patches(h).map((c) => c.body),
        [{ visibility: 'private' }],
      );
      assert.equal(await h.page.locator('.vs-confirm').count(), 0, 'narrowing needs no confirm');
    } finally {
      await h.close();
    }
  });

  void test('fits 1440 and 390, light and dark, with the confirmation open', async () => {
    const { stub: api } = stub('lead');
    const h = await open('/board?project=laika-core', api);
    try {
      for (const width of [1440, 390]) {
        for (const theme of ['light', 'dark']) {
          await h.page.setViewportSize({ width: 1440, height: 900 });
          await h.page.goto(`${h.origin}/board?project=laika-core`);
          await h.page.waitForSelector('.card-title', { timeout: 20_000 });
          await setTheme(h.page, theme);
          await h.page.setViewportSize({ width, height: 844 });
          await openPanel(h);
          await h.page.locator('input[name="vs-visibility"]').nth(1).click();
          const confirm = h.page.locator('.vs-confirm');
          await confirm.waitFor();
          await confirm.scrollIntoViewIfNeeded();

          const label = `${String(width)} ${theme}`;
          const box = await h.page.locator('.view-settings').boundingBox();
          assert.ok(box !== null, `${label}: no panel`);
          assert.ok(
            box.x >= 0 && box.x + box.width <= width + 1,
            `${label}: panel off-screen ${JSON.stringify(box)}`,
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
          await h.page.keyboard.press('Escape');
        }
      }
      assert.equal(patches(h).length, 0, 'measuring the confirmation sent a change');
    } finally {
      await h.close();
    }
  });
});

void describe('a member who is not a lead', () => {
  void test('reads the visibility and is offered no control', async () => {
    const { stub: api } = stub('member', 'public');
    const h = await open('/board?project=laika-core', api);
    try {
      await openPanel(h);
      const section = h.page.locator('.vs-visibility');
      await section.waitFor();
      assert.match(await section.innerText(), /Public — anyone in the org can join/);
      assert.equal(await h.page.locator('input[name="vs-visibility"]').count(), 0);
      assert.match(await section.innerText(), /Only a project lead can change this/);
    } finally {
      await h.close();
    }
  });
});
