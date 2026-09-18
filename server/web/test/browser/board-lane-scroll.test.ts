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
import { closeBrowser, open, type ApiStub, setTheme } from './harness.ts';

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
  /**
   * **Three sprints, because an empty list is not the real thing.**
   *
   * The 146px page overflow LAI-243 fixed did not reproduce against an empty
   * sprint list: no sprint strip means a different width above the board and the
   * arithmetic lands elsewhere. It was found on a seeded instance instead. A
   * fixture that omits what the screen normally has is the same defect as a stub
   * that answers regardless of the query — it makes the assertion narrower than
   * it reads.
   */
  '/api/v1/projects/laika-core/sprints': {
    data: [
      {
        id: 's1',
        project_id: 'p1',
        name: 'Sprint 1',
        goal: 'Get the engine standing up',
        status: 'completed',
        starts_on: 1786492800000,
        ends_on: 1787616000000,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 's2',
        project_id: 'p1',
        name: 'Sprint 2',
        goal: 'Policy and MCP parity',
        status: 'active',
        starts_on: 1788307200000,
        ends_on: 1789430400000,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 's3',
        project_id: 'p1',
        name: 'Sprint 3',
        goal: null,
        status: 'planned',
        starts_on: 1789516800000,
        ends_on: 1790640000000,
        created_at: 1,
        updated_at: 1,
      },
    ],
    next_cursor: null,
  },
  /**
   * **Real feed rows, because the rail's markup is what broke the page.**
   *
   * Each row renders a `span.visually-hidden`, and `.visually-hidden` is
   * `position: absolute` with no coordinates — so inside a horizontal scroller
   * it sits at its static position, far right of the viewport, and escapes the
   * clip unless the scroller is its containing block. An empty feed has none of
   * them, and the 146px page overflow LAI-243 fixed **did not reproduce** until
   * this fixture carried rows.
   */
  '/api/v1/projects/laika-core/activity': {
    data: [
      {
        id: 'a1',
        org_id: 'o1',
        project_id: 'p1',
        actor_id: 'u1',
        actor_kind: 'user',
        actor_token_id: null,
        actor_name: 'Ada Lovelace',
        type: 'task.moved',
        payload: { task_id: 't3', from: 'todo', to: 'in_progress' },
        created_at: 1788300000000,
      },
      {
        id: 'a2',
        org_id: 'o1',
        project_id: 'p1',
        actor_id: 'u1',
        actor_kind: 'agent',
        actor_token_id: 'tok1',
        actor_name: 'Ada Lovelace',
        type: 'task.created',
        payload: { task_id: 't4' },
        created_at: 1788300100000,
      },
      {
        id: 'a3',
        org_id: 'o1',
        project_id: 'p1',
        actor_id: null,
        actor_kind: 'system',
        actor_token_id: null,
        actor_name: null,
        type: 'task.stale_flagged',
        payload: { task_id: 't5' },
        created_at: 1788300200000,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

/** Measured from `docs/design/Laika Prototype.dc.html`: `206px` lanes, 11px gap. */
const DESIGN_LANE = 206;

/**
 * Resize, then **wait for the layout to stop moving** rather than for a clock.
 *
 * A fixed `waitForTimeout` was enough when this file ran alone and not enough
 * under the full suite: a lane measured **254px** at 1600px — between 1920's
 * 270px and 1600's 206px — because the assertion read a layout that was still
 * settling from the previous viewport. A flake that only appears under load is
 * still a wrong answer, and it was *my* test that was wrong, not the CSS.
 *
 * Two consecutive frames with identical lane widths is the condition that
 * actually matters, and it cannot pass early the way a timeout can.
 */
const settle = async (h: Awaited<ReturnType<typeof open>>, width: number) => {
  await h.page.setViewportSize({ width, height: 1000 });
  await h.page.waitForFunction((w: number) => document.documentElement.clientWidth === w, width, {
    timeout: 10_000,
  });
  await h.page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const read = () =>
          [...document.querySelectorAll('.lane')]
            .map((l) => Math.round(l.getBoundingClientRect().width))
            .join(',');
        const first = read();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(read() === first && first !== '');
          });
        });
      }),
    undefined,
    { timeout: 10_000 },
  );
};

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
        await settle(h, width);

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

        // **An upper bound too, whenever the row is scrolling.** A floor alone
        // passes for lanes that ballooned: `flex-basis: auto` on the strip sizes
        // it to the grid's *max-content*, which `1fr` leaves unbounded, and 311px
        // lanes satisfy ">= 206" while being just as wrong. If the row has to
        // scroll, every lane should be sitting exactly on the floor.
        const scrolling = await h.page.evaluate(() => {
          const row = document.querySelector('.board-main');
          return row !== null && row.scrollWidth > row.clientWidth + 1;
        });
        if (scrolling) {
          for (const [i, w] of widths.entries()) {
            assert.ok(
              Math.abs(w - DESIGN_LANE) <= 2,
              `at ${String(width)}px the row scrolls, so lane ${String(i)} should be ` +
                `${String(DESIGN_LANE)}px — it is ${String(Math.round(w))}px, which means the ` +
                `strip is sizing to its own content rather than to the row`,
            );
          }
        }
      }
    } finally {
      await h.close();
    }
  });

  /**
   * **The property, not the mechanism** (LAI-243 AC6).
   *
   * The first version of this asserted `.kanban` had `overflow-x: auto`. That
   * pinned *which element scrolls*, and LAI-243 legitimately moved it up to
   * `.board-main` so the rail travels with the lanes — so the assertion went red
   * for a change that was correct. That is the LAI-158 shape, and the fix is to
   * ask **"does the board scroll instead of squeezing"** rather than **"is the
   * overflow on this selector"**.
   */
  void test('the board scrolls rather than squeezing, and does so at every width', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);

      // Narrow enough that five 206px lanes plus the rail cannot fit — but well
      // above the old `1100px` special case, which is the width the owner was at
      // and which used to squeeze instead of scrolling.
      for (const width of [1440, 1280]) {
        await settle(h, width);

        // Whichever element carries it, something between the lanes and the
        // viewport must scroll horizontally — and the page body must not.
        const scroller = await h.page.evaluate(() => {
          let node: Element | null = document.querySelector('.lane');
          while (node !== null && node !== document.documentElement) {
            if (node.scrollWidth > node.clientWidth + 1) {
              return { selector: node.className.toString().split(' ')[0], scrollable: true };
            }
            node = node.parentElement;
          }
          return { selector: null as string | null, scrollable: false };
        });

        assert.ok(
          scroller.scrollable,
          `at ${String(width)}px nothing scrolls — the lanes are still being squeezed`,
        );

        const bodyOverflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(bodyOverflow, 0, `at ${String(width)}px the page itself scrolls sideways`);
      }
    } finally {
      await h.close();
    }
  });

  /**
   * **What the owner asked for**, after seeing LAI-175:
   *
   * > *"also add that live stream in the scroll row so that will not fixed there
   * > on screen"*
   *
   * Asserted as movement, because that is the complaint: the rail stayed put
   * while the lanes slid underneath it.
   */
  void test('the Live stream rail travels with the lanes rather than staying pinned', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);
      await settle(h, 1280);

      const railLeft = async () =>
        h.page.locator('.rail').evaluate((el: Element) => el.getBoundingClientRect().left);

      const before = await railLeft();
      const moved = await h.page.evaluate(() => {
        let node: Element | null = document.querySelector('.lane');
        while (node !== null && node !== document.documentElement) {
          if (node.scrollWidth > node.clientWidth + 1) {
            node.scrollLeft = 400;
            return node.scrollLeft;
          }
          node = node.parentElement;
        }
        return 0;
      });
      // Wait for the rail to have actually moved rather than for a clock — the
      // same lesson as `settle()` above, on the axis this test is about.
      await h.page
        .waitForFunction(
          (start: number) => {
            const rail = document.querySelector('.rail');
            return rail !== null && Math.abs(rail.getBoundingClientRect().left - start) > 1;
          },
          before,
          { timeout: 10_000 },
        )
        .catch(() => {
          // Swallowed so the assertion below reports *how far* it moved, which
          // is a better failure than "waitForFunction timed out".
        });
      const after = await railLeft();

      assert.ok(moved > 0, 'nothing scrolled, so this proves nothing about the rail');
      assert.ok(
        before - after > 100,
        `the rail moved ${String(Math.round(before - after))}px for ${String(moved)}px of ` +
          `scroll — it is pinned to the screen instead of riding with the board`,
      );
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
        await settle(h, width);

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
      await settle(h, 1440);

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
      await settle(h, 1280);

      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        await h.page.waitForTimeout(300);

        const clearance = await h.page.evaluate(() => {
          // The scroller's own box, whichever it is — the scrollbar paints at
          // the bottom of that, not of `.kanban`.
          const row = document.querySelector('.board-main') ?? document.querySelector('.kanban');
          if (row === null) return null;
          const box = row.getBoundingClientRect();
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
