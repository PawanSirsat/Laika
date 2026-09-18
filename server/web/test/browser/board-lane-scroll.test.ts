/**
 * Board lanes keep their width and scroll (LAI-175).
 *
 * Asked for by the owner, with a screenshot:
 *
 * > *"don't decrease the card width here, add the left-right scroll so that it
 * > looks good"*
 *
 * ## The collision this file exists to guard
 *
 * `board.css` carried a comment saying a `minmax(13rem, …)` floor once *"forced
 * the grid past 1100px, so once the rail took its 266px the last column ran
 * underneath it."* **A comment is not a guard**, and the floor is back — so the
 * property has to be asserted instead of described.
 *
 * The property is narrow and checkable: **`.kanban` is `flex: 1; min-width: 0`
 * beside the rail, so its box is sized by what the rail leaves and can never
 * reach it.** The tracks overflow *inside* that box. If someone ever moves
 * `overflow-x` to an ancestor, or drops `min-width: 0`, the box grows and the
 * last lane paints over the rail again — and these assertions go red.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const BASE_TASK = {
  project_id: 'p1',
  description_md: null,
  acceptance_md: null,
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
};

/** One task per lane, so all five render and none is empty-and-narrow. */
const TASKS = [
  {
    ...BASE_TASK,
    id: 't1',
    key: 'LAI-1',
    number: 1,
    status: 'backlog',
    title: 'Calendar month grid',
  },
  {
    ...BASE_TASK,
    id: 't2',
    key: 'LAI-2',
    number: 2,
    status: 'todo',
    title: 'Dashboard throughput chart',
  },
  {
    ...BASE_TASK,
    id: 't3',
    key: 'LAI-3',
    number: 3,
    status: 'in_progress',
    // The owner's screenshot: this title wrapped to three lines when squeezed.
    title: 'Transcript webhook authentication',
  },
  {
    ...BASE_TASK,
    id: 't4',
    key: 'LAI-4',
    number: 4,
    status: 'review',
    title: 'Rate limit headers',
  },
  {
    ...BASE_TASK,
    id: 't5',
    key: 'LAI-5',
    number: 5,
    status: 'done',
    title: 'Backfill task timestamps',
  },
];

const project = {
  ...PROJECT,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 1, todo: 1, in_progress: 1, review: 1, done: 1, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada' }],
  last_activity_at: 2,
};

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [project], next_cursor: null },
  '/api/v1/projects/laika-core': project,
  '/api/v1/projects/laika-core/tasks': { data: TASKS, next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

/** Measured from `docs/design/Laika Prototype.dc.html`: `206px` lanes, 11px gap. */
const DESIGN_LANE = 206;

const boardReady = async (h: Awaited<ReturnType<typeof open>>) => {
  await h.page.locator('.lane').first().waitFor({ timeout: 20_000 });
  // Five lanes, or every measurement below is about a board that did not render.
  assert.equal(await h.page.locator('.lane').count(), 5, 'the board did not render five lanes');
};

void after(async () => {
  await closeBrowser();
});

void describe('a lane keeps the width the design gives it', () => {
  void test('no lane is narrower than the prototype, at any width', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);

      for (const width of [1920, 1600, 1440, 1280, 1100, 900]) {
        await h.page.setViewportSize({ width, height: 1000 });
        await h.page.waitForTimeout(250);

        const widths = await h.page
          .locator('.lane')
          .evaluateAll((els: Element[]) => els.map((e) => e.getBoundingClientRect().width));

        for (const [i, w] of widths.entries()) {
          assert.ok(
            w >= DESIGN_LANE - 1,
            `at ${String(width)}px, lane ${String(i)} is ${String(Math.round(w))}px — ` +
              `the design gives it ${String(DESIGN_LANE)}px and it must not give any back`,
          );
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('the lane strip scrolls rather than squeezing, and does so at every width', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);

      // Narrow enough that five 206px lanes plus gaps cannot fit beside the
      // rail — but well above the old `1100px` special case, which is the case
      // the owner was in and which used to squeeze instead of scrolling.
      for (const width of [1440, 1280]) {
        await h.page.setViewportSize({ width, height: 1000 });
        await h.page.waitForTimeout(250);

        const kanban = await h.page.locator('.kanban').evaluate((el: Element) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: getComputedStyle(el).overflowX,
        }));

        assert.equal(kanban.overflowX, 'auto', `at ${String(width)}px the strip cannot scroll`);
        assert.ok(
          kanban.scrollWidth > kanban.clientWidth,
          `at ${String(width)}px the lanes fit (${String(kanban.scrollWidth)} <= ` +
            `${String(kanban.clientWidth)}) — they are still being squeezed`,
        );
      }
    } finally {
      await h.close();
    }
  });

  /**
   * **AC3, and the reason this file exists.** The comment in `board.css`
   * recorded this collision happening once. This is the assertion that stops it
   * happening twice.
   */
  void test('the lane strip never reaches BoardRail, at any width where they share a row', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);

      for (const width of [1920, 1600, 1440, 1280, 1220]) {
        await h.page.setViewportSize({ width, height: 1000 });
        await h.page.waitForTimeout(250);

        const geometry = await h.page.evaluate(() => {
          const kanban = document.querySelector('.kanban');
          const rail = document.querySelector('.rail');
          if (kanban === null || rail === null) return null;
          const k = kanban.getBoundingClientRect();
          const r = rail.getBoundingClientRect();
          const lanes = [...document.querySelectorAll('.lane')].map(
            (l) => l.getBoundingClientRect().right,
          );
          return {
            kanbanRight: k.right,
            railLeft: r.left,
            railTop: r.top,
            kanbanTop: k.top,
            lanes,
          };
        });

        assert.ok(geometry, `at ${String(width)}px the board or the rail is missing`);
        // Only meaningful while they actually share a row — below 1200px the
        // rail drops underneath and there is no collision to have.
        if (geometry.railTop > geometry.kanbanTop + 40) continue;

        assert.ok(
          geometry.kanbanRight <= geometry.railLeft + 1,
          `at ${String(width)}px the lane strip ends at ${String(Math.round(geometry.kanbanRight))} ` +
            `and the rail starts at ${String(Math.round(geometry.railLeft))} — the strip has grown ` +
            `into the rail, which is the bug the old comment described`,
        );
      }
    } finally {
      await h.close();
    }
  });
});

void describe('what the owner actually complained about', () => {
  void test('a card title does not wrap to three lines at a normal desktop width', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);
      await h.page.setViewportSize({ width: 1440, height: 1000 });
      await h.page.waitForTimeout(300);

      const title = h.page.locator('.card-title', { hasText: 'Transcript webhook authentication' });
      const lines = await title.evaluate((el: Element) => {
        const style = getComputedStyle(el);
        const lineHeight = Number.parseFloat(style.lineHeight);
        // A line-height of `normal` computes to a number in Chromium, so this is
        // a real division rather than a guess. Rounded, because sub-pixel.
        return Math.round(el.getBoundingClientRect().height / lineHeight);
      });
      assert.ok(
        lines <= 2,
        `the title wraps to ${String(lines)} lines — the screenshot's complaint exactly`,
      );
    } finally {
      await h.close();
    }
  });

  void test('the scrollbar does not paint over a card, in either theme', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);
      await h.page.setViewportSize({ width: 1280, height: 1000 });

      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        const clearance = await h.page.evaluate(() => {
          const kanban = document.querySelector('.kanban');
          if (kanban === null) return null;
          const box = kanban.getBoundingClientRect();
          const lowest = Math.max(
            ...[...document.querySelectorAll('.lane')].map((l) => l.getBoundingClientRect().bottom),
          );
          // What the scrollbar has to itself, below the tallest lane.
          return box.bottom - lowest;
        });

        assert.ok(clearance !== null, `${theme}: no board`);
        assert.ok(
          clearance >= 6,
          `${theme}: only ${String(Math.round(clearance))}px below the tallest lane — ` +
            `a scrollbar would paint over the last card`,
        );
      }
    } finally {
      await h.close();
    }
  });
});
