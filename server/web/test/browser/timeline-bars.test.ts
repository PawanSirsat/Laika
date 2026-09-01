/**
 * Solid means measured; an outline means placed (LAI-434, D-049).
 *
 * **This is the criterion that is not cosmetic.** What survives D-014 is that
 * Laika never asserts a date it was not told, and the whole of that promise is
 * carried by whether a bar looks measured. A test that only checked the class
 * names would pass while both rendered identically — so this reads the
 * **computed** fill and border, in both themes, which is the thing a reader
 * actually sees.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 7, 3);

const SPRINT = {
  id: 's1',
  project_id: 'p1',
  name: 'Sprint 1',
  goal: null,
  starts_on: T0,
  ends_on: T0 + 13 * DAY,
  status: 'active',
  created_at: T0,
  updated_at: T0,
};

function task(over: Record<string, unknown>) {
  return {
    id: 't',
    key: 'LAI-0',
    project_id: 'p1',
    number: 0,
    title: 'A task',
    description_md: null,
    acceptance_md: null,
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: 's1',
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
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
    created_at: T0,
    updated_at: T0,
    ...over,
  };
}

/** One measured, one placed, in the same sprint — the pair AC7 names. */
const MEASURED = task({
  id: 'done1',
  key: 'LAI-1',
  title: 'Finished, and we know when',
  status: 'done',
  started_at: T0 + DAY,
  completed_at: T0 + 4 * DAY,
});
const PLACED = task({ id: 'todo1', key: 'LAI-2', title: 'Only ever planned', status: 'todo' });

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [],
  },
  '/api/v1/projects': {
    data: [
      {
        id: 'p1',
        slug: 'laika-core',
        name: 'Laika Core',
        prefix: 'LAI',
        description: null,
        repo: null,
        visibility: 'private',
        context_md: '',
        archived_at: null,
        created_at: T0,
        updated_at: T0,
        task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 1, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: T0,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/tasks': { data: [MEASURED, PLACED], next_cursor: null },
  '/api/v1/projects/laika-core/sprints': { data: [SPRINT], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
};

void after(async () => {
  await closeBrowser();
});

void describe('a measured bar does not look like a placed one', () => {
  void test('solid vs outlined, by fill and border — in both themes', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-row').first().waitFor({ timeout: 15_000 });

      // Prove the probe can see both before asserting they differ: "no bars"
      // and "two identical bars" must not look the same to this test.
      assert.equal(await h.page.locator('.tl-bar-actual').count(), 1, 'no measured bar rendered');
      assert.equal(await h.page.locator('.tl-bar-planned').count(), 1, 'no planned bar rendered');

      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        const style = async (sel: string) =>
          h.page
            .locator(sel)
            .first()
            .evaluate((el) => {
              const cs = getComputedStyle(el);
              return { bg: cs.backgroundColor, border: cs.borderStyle };
            });

        const measured = await style('.tl-bar-actual');
        const placed = await style('.tl-bar-planned');

        // Not "a different colour token" — a different *shape*. A colour-only
        // difference disappears for a colour-blind reader and in a screenshot.
        assert.notEqual(
          measured.border,
          placed.border,
          `${theme}: both bars have ${measured.border} borders — the difference is colour only`,
        );
        assert.notEqual(
          measured.bg,
          'rgba(0, 0, 0, 0)',
          `${theme}: the measured bar is not filled`,
        );
        assert.equal(
          placed.bg,
          'rgba(0, 0, 0, 0)',
          `${theme}: the placed bar is filled like a measurement`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('the row says when a range came from the sprint', async () => {
    // The bar cannot say it, so the label must: a sprint's range presented in
    // the same voice as a measured one is the misreading D-014 prevents.
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-row').first().waitFor({ timeout: 15_000 });
      assert.equal(await h.page.locator('.tl-dates-planned').count(), 1);
      assert.match(await h.page.locator('.tl-dates-planned').first().innerText(), /sprint/i);
    } finally {
      await h.close();
    }
  });

  void test('the today marker sits inside the axis', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-row').first().waitFor({ timeout: 15_000 });
      // The stub's sprint is in the past, so `todayPosition` reports off-axis
      // and the marker is absent — which is correct, and the note says so.
      const marker = await h.page.locator('.tl-today').count();
      const note = await h.page.locator('.timeline-note').count();
      assert.equal(
        marker + note,
        1,
        'today is either on the axis or explained, never both or neither',
      );
    } finally {
      await h.close();
    }
  });
});
