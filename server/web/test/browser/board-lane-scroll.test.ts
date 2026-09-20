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

/** The prototype's column floor (LAI-605): min 248px — the file's own
 * `minmax(248px, 1fr)`. The addendum's 256 preceded it; the mockup's raw 206
 * was mockup-scale and retired before either. */
const DESIGN_LANE = 248;

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

      /*
       * **Narrow enough that five lanes cannot fit.**
       *
       * This read `[1440, 1280]` when the board carried a 252px rail — five
       * 206px lanes *plus the rail* did not fit at 1440. LAI-281 moved the rail
       * to its own tab, so at 1440 the lanes genuinely fit and nothing needs to
       * scroll. The property is unchanged and so is its point; only the width
       * at which the board is actually crowded has moved, and a test asserting
       * scrolling where there is room to spare tests nothing.
       */
      for (const width of [1180, 1024]) {
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

  /*
   * **Two rail tests lived here and are gone with the rail** (LAI-281).
   *
   * They asserted that the Live stream travelled with the lanes rather than
   * staying pinned, and that the lane strip never overlapped it — both real
   * properties of a board that had a 252px column beside it. The owner's
   * updated design makes the board plain and moves those panels to the Activity
   * tab, so there is no rail to travel with the lanes and nothing for the strip
   * to reach.
   *
   * They are deleted rather than rewritten: `activity-tab.test.ts` asserts what
   * the panels do now, and a test kept alive against a component that no longer
   * exists is the exemption-that-never-expires shape.
   */
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

void describe('the lanes fill the window (LAI-283)', () => {
  /**
   * The owner's report, with a screenshot: the columns stopped well above the
   * bottom of the window with dead space beneath them.
   *
   * The cause was a hardcoded `calc(100dvh - 21rem)` — a figure standing in for
   * the height of every band above the board, which had to be re-guessed each
   * time one of them changed and was 99px short once the right rail moved to
   * its own tab. The height is measured now, not described.
   *
   * **Asserted at two window heights**, because a single one cannot tell a
   * measured height from a lucky constant.
   */
  void test('reach the bottom, at any window height', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await boardReady(h);

      const seen: number[] = [];
      for (const height of [900, 700]) {
        await h.page.setViewportSize({ width: 1440, height });
        await h.page.waitForTimeout(250);

        const m = await h.page.evaluate(() => {
          const lane = document.querySelector('.lane');
          if (lane === null) return null;
          const r = lane.getBoundingClientRect();
          return { bottom: r.bottom, height: r.height, viewport: window.innerHeight };
        });
        assert.ok(m !== null, 'no lane rendered');

        // The pane's own bottom padding is the only thing that may be left.
        const gap = m.viewport - m.bottom;
        assert.ok(
          gap >= 0 && gap <= 56,
          `at ${String(height)}px the lanes stop ${String(Math.round(gap))}px above the bottom`,
        );
        seen.push(Math.round(m.height));
      }

      /*
       * **And the height must track the window.** A constant would satisfy the
       * gap check at whichever height it was tuned for; two different windows
       * must give two different lane heights, differing by what the window did.
       */
      assert.equal(
        seen[0]! - seen[1]!,
        200,
        `the lanes measured ${seen.join(' and ')} — they are not following the window`,
      );
    } finally {
      await h.close();
    }
  });
});

/**
 * A board with **real columns**, so the `+` tile renders.
 *
 * The rest of this file predates `board_columns` and has no such route, so it
 * takes the 404 fallback — which draws one lane per status and, deliberately,
 * no column controls at all. A layout test for the tile written against that
 * stub measures a tile that is not there: it passed against the broken layout
 * and the fixed one alike, which is how the first version of this block was
 * caught being worthless.
 */
const COLUMNS_STUB: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/board-columns': {
    columns: [
      // Five, matching what `boardReady` expects of the fallback board — this
      // fixture differs only in that the columns are *real*, so the tile draws.
      ['c1', 'Backlog', ['backlog']],
      ['c2', 'To do', ['todo']],
      ['c3', 'In progress', ['in_progress']],
      ['c4', 'Review', ['review']],
      ['c5', 'Done', ['done']],
    ].map(([id, name, statuses], position) => ({
      id,
      project_id: 'p1',
      name,
      position,
      hidden: false,
      statuses,
      primary_status: (statuses as string[])[0],
    })),
  },
};

void describe('the lanes use the width they are given (LAI-290)', () => {
  void test('no column-sized gap is left beside the add-column tile', async () => {
    /*
     * **The `+` tile is a grid item, so it used to get a whole track.**
     * `grid-auto-columns` sizes *every* implicit track the same, so the tile's
     * was `minmax(206px, 1fr)` — a full column's share, measured at 301px on a
     * 1552px board — to draw a 32px button. The lanes were short by exactly
     * that, which is what the owner saw as empty space on the right.
     *
     * Asserted as arithmetic rather than by eye: what the lanes, the gaps and
     * the tile occupy must account for the whole row.
     */
    const h = await open('/board?project=laika-core', COLUMNS_STUB);

    try {
      await h.page.setViewportSize({ width: 1800, height: 1000 });
      await boardReady(h);

      const box = await h.page.evaluate(() => {
        const kanban = document.querySelector('.kanban');
        if (kanban === null) return null;
        const lanes = [...document.querySelectorAll('.lane')].map(
          (l) => l.getBoundingClientRect().width,
        );
        const tile = document.querySelector('.lane-new');
        const gap = Number.parseFloat(getComputedStyle(kanban).columnGap) || 0;
        return {
          width: kanban.getBoundingClientRect().width,
          lanes,
          tile: tile === null ? 0 : tile.getBoundingClientRect().width,
          gap,
        };
      });

      assert.ok(box !== null, 'no board rendered');

      assert.ok(box.tile > 0, 'the add-column tile is not rendered — this test proves nothing');

      const items = box.lanes.length + 1;
      const used =
        box.lanes.reduce((n, w) => n + w, 0) + box.tile + box.gap * Math.max(0, items - 1);

      // A pixel or two of rounding is fine; a whole column of slack is the bug.
      assert.ok(
        box.width - used < 24,
        `the lanes left ${String(Math.round(box.width - used))}px unused — the tile is taking a column's share`,
      );
    } finally {
      await h.close();
    }
  });

  void test('the lanes reach the bottom of the window', async () => {
    // The board is a full-height column; a margin under it is dead space, not
    // breathing room. The owner's words: "use the space … the bottom as well".
    const h = await open('/board?project=laika-core', COLUMNS_STUB);

    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await boardReady(h);

      const gap = await h.page.evaluate(() => {
        const lanes = [...document.querySelectorAll('.lane')];
        const lowest = Math.max(...lanes.map((l) => l.getBoundingClientRect().bottom));
        return window.innerHeight - lowest;
      });

      assert.ok(gap < 40, `the lanes stop ${String(Math.round(gap))}px short of the bottom`);
    } finally {
      await h.close();
    }
  });
});

/**
 * A crowded board: real columns **and** a dozen cards in the first lane.
 *
 * Both scroll tests refuse to run without something to scroll — the base
 * fixture is deliberately one task per lane, which gives a lane no vertical
 * overflow and the row no horizontal one.
 */
const CROWDED_STUB: ApiStub = {
  ...COLUMNS_STUB,
  '/api/v1/projects/laika-core/tasks': {
    data: Array.from({ length: 12 }, (_, i) => ({
      ...TASKS[0],
      id: `crowd-${String(i)}`,
      key: `LAI-${String(100 + i)}`,
      number: 100 + i,
      title: `A card with a title long enough to take two lines, number ${String(i)}`,
      status: 'todo',
    })),
    next_cursor: null,
  },
};

void describe('scrolling the board (LAI-290)', () => {
  void test('a sideways gesture over a card moves the columns', async () => {
    /*
     * **Chrome latches a wheel gesture to the first scroll container under the
     * pointer.** Over a card that is `.lane-body`, which scrolls vertically and
     * not horizontally — so `deltaX` was dropped and the columns never moved,
     * while the identical gesture over the lane's padding scrolled them.
     *
     * No CSS fixes it: `overflow-x: hidden` leaves the lane a scroll container,
     * and `clip` is coerced back to `hidden` when the other axis is `auto`.
     */
    const h = await open('/board?project=laika-core', CROWDED_STUB);

    try {
      // Narrow enough that the row genuinely has somewhere to scroll.
      await h.page.setViewportSize({ width: 820, height: 900 });
      await boardReady(h);

      /** Whichever element scrolls at this width — the pane, or the grid. */
      const scroller = () =>
        h.page.evaluate(() => {
          const pane = document.querySelector('.board-main');
          const grid = document.querySelector('.kanban');
          for (const el of [pane, grid]) {
            if (el !== null && el.scrollWidth > el.clientWidth) {
              return { room: el.scrollWidth - el.clientWidth, left: el.scrollLeft };
            }
          }
          return { room: 0, left: 0 };
        });

      assert.ok((await scroller()).room > 0, 'the board has nowhere to scroll — proves nothing');

      const card = await h.page.locator('.card').first().boundingBox();
      assert.ok(card !== null, 'no card to aim at');

      await h.page.mouse.move(card.x + card.width / 2, card.y + 10);
      await h.page.mouse.wheel(300, 0);
      await h.page.waitForTimeout(300);

      assert.ok(
        (await scroller()).left > 0,
        'a sideways gesture over a card did not move the columns',
      );
    } finally {
      await h.close();
    }
  });

  void test('a vertical gesture over a card still scrolls that lane', async () => {
    /*
     * The other half: forwarding the horizontal axis must not steal the
     * vertical one, or a lane full of cards becomes unreadable.
     *
     * **What this catches, measured rather than assumed.** React's `onWheel`
     * is a passive listener, so a `preventDefault()` added there is inert and
     * this test does not move — mutating the handler that way leaves it green.
     * It goes red on the version that can actually do the damage: a native
     * `addEventListener('wheel', …, { passive: false })` on `.board-main`,
     * which is the obvious next step for anyone who wants `preventDefault` and
     * finds the React prop ignoring them.
     */
    const h = await open('/board?project=laika-core', CROWDED_STUB);

    try {
      // Wide enough that the board stays a row (below 1200px it stacks and the
      // lanes grow instead of being constrained), and short enough that a lane
      // full of cards genuinely overflows.
      await h.page.setViewportSize({ width: 1400, height: 560 });
      await boardReady(h);

      /*
       * **The crowded lane, not the first one.** `CROWDED_STUB` puts every card
       * in `todo`, which is not column zero — measuring `.lane-body` and taking
       * the first match reports the *empty* lane, which has no overflow and
       * fails a guard that is doing its job.
       */
      const crowded = '.lane-body:has(.card)';

      const room = await h.page.evaluate((sel) => {
        const lane = document.querySelector(sel);
        return lane === null ? 0 : lane.scrollHeight - lane.clientHeight;
      }, crowded);
      assert.ok(room > 0, 'the lane has nowhere to scroll — this test proves nothing');

      const card = await h.page.locator('.card').first().boundingBox();
      assert.ok(card !== null, 'no card to aim at');

      await h.page.mouse.move(card.x + card.width / 2, card.y + 10);
      await h.page.mouse.wheel(0, 200);
      await h.page.waitForTimeout(300);

      const lane = await h.page.evaluate(
        (sel) => document.querySelector(sel)?.scrollTop ?? 0,
        crowded,
      );
      assert.ok(lane > 0, 'the lane did not scroll vertically');
    } finally {
      await h.close();
    }
  });

  void test('the board itself never grows a vertical scrollbar', async () => {
    // It is one screenful by design: the lanes reach the bottom and each
    // scrolls its own cards. `overflow-x: auto` silently coerces the other
    // axis to `auto`, which is how a scrollbar appeared over a 91px phantom.
    const h = await open('/board?project=laika-core', COLUMNS_STUB);

    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await boardReady(h);

      const overflowY = await h.page.evaluate(() => {
        const pane = document.querySelector('.board-main');
        return pane === null ? '' : getComputedStyle(pane).overflowY;
      });

      assert.ok(
        overflowY === 'hidden' || overflowY === 'clip',
        `the board pane scrolls vertically (overflow-y: ${overflowY})`,
      );
    } finally {
      await h.close();
    }
  });
});

/**
 * The board's own row sits below WORKING NOW, above the lanes (LAI-293).
 *
 * It used to portal into the space bar. The owner's reference puts it directly
 * on top of the columns, and getting there needed no slot from anyone: a board
 * screen's own output already renders straight after `<PresenceStrip>`.
 *
 * **Asserted by geometry, not by class name.** A row that is in the right part
 * of the DOM but painted somewhere else is the failure worth catching, and only
 * a rectangle can tell the difference.
 */
void describe('where the board row sits (LAI-293)', () => {
  void test('below WORKING NOW and above the first lane', async () => {
    const h = await open('/board?project=laika-core', COLUMNS_STUB);

    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await boardReady(h);

      const m = await h.page.evaluate(() => {
        const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
        const presence = document.querySelector('[class*="presence"]')?.getBoundingClientRect();
        return {
          presenceBottom: presence?.bottom ?? null,
          barTop: box('.board-bar')?.top ?? null,
          laneTop: box('.lane')?.top ?? null,
        };
      });

      assert.ok(m.barTop !== null, 'the board row is not rendered at all');
      assert.ok(m.laneTop !== null, 'no lane to measure against');
      assert.ok(
        m.presenceBottom !== null,
        'WORKING NOW is absent — this test cannot tell where the row sits',
      );
      assert.ok(
        m.presenceBottom <= m.barTop,
        `the row is above WORKING NOW (${String(m.barTop)} < ${String(m.presenceBottom)})`,
      );
      assert.ok(
        m.barTop < m.laneTop,
        `the row is not above the lanes (${String(m.barTop)} >= ${String(m.laneTop)})`,
      );
    } finally {
      await h.close();
    }
  });

  void test('and no longer inside the space bar', async () => {
    // The other half: moved, not copied.
    const h = await open('/board?project=laika-core', COLUMNS_STUB);

    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await boardReady(h);

      assert.equal(
        await h.page.locator('.space-bar .bt').count(),
        0,
        'the toolbar is still in the space bar',
      );
      assert.equal(await h.page.locator('.board-bar .bt').count(), 1, 'exactly one row expected');
    } finally {
      await h.close();
    }
  });

  void test('its edges line up with the lanes below it', async () => {
    /*
     * `.board` aligns its children with `margin-inline`, not padding, so a row
     * that sets its own horizontal padding lands inset from the columns. That
     * is the mistake this catches — it looks deliberate and reads as bolted on.
     *
     * **Measure the contents, not the container.** `getBoundingClientRect()`
     * returns the *border* box, so padding on `.board-bar` does not move its
     * own edges at all — it moves what is inside. Asserting on `.board-bar`
     * passed happily with the padding restored, which is how this comment came
     * to be here: the mutation survived and the test was the thing at fault.
     */
    const h = await open('/board?project=laika-core', COLUMNS_STUB);

    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await boardReady(h);

      const m = await h.page.evaluate(() => {
        const box = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
        const bar = box('.board-bar .bt');
        const main = box('.board-main');
        return bar === null || main === null
          ? null
          : {
              bl: Math.round(bar.left),
              br: Math.round(bar.right),
              ml: Math.round(main.left),
              mr: Math.round(main.right),
            };
      });

      assert.ok(m !== null, 'the row or the lane area is missing');
      assert.equal(m.bl, m.ml, 'the row starts at a different x from the columns');
      assert.equal(m.br, m.mr, 'the row ends at a different x from the columns');
    } finally {
      await h.close();
    }
  });
});

/**
 * A grouped board scrolls; an ungrouped one still does not (LAI-296).
 *
 * `.board-main` is `overflow-y: hidden` so the plain board cannot grow the
 * phantom scrollbar LAI-290 removed. Grouped, that same rule made every row
 * below the second unreachable — the board is one lane row *per group*, which
 * is taller than any viewport as soon as there are three or four people.
 *
 * Both halves are asserted here **in one file**, because the bug was fixing one
 * without noticing the other.
 */
void describe('a grouped board can reach its last row (LAI-296)', () => {
  void test('grouped, it scrolls', async () => {
    const h = await open('/board?project=laika-core&group=assignee', CROWDED_STUB);

    try {
      await h.page.setViewportSize({ width: 1400, height: 700 });
      await h.page.locator('.swim').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(400);

      const room = await h.page.evaluate(() => {
        const pane = document.querySelector('.board-main');
        return pane === null ? 0 : pane.scrollHeight - pane.clientHeight;
      });
      assert.ok(room > 0, 'the grouped board is not tall enough to prove anything');

      /*
       * **A wheel gesture, not `scrollTop = n`.** Assigning `scrollTop` moves
       * an `overflow: hidden` element perfectly well — script is not bound by
       * the property that stops a *person* scrolling. The first version of
       * this test did exactly that and **passed with the fix removed**, which
       * is the whole defect it exists to catch.
       *
       * The computed style is asserted too: the gesture proves a person can
       * reach the lower rows, the property says why.
       */
      const overflowY = await h.page.evaluate(() => {
        const pane = document.querySelector('.board-main');
        return pane === null ? '' : getComputedStyle(pane).overflowY;
      });
      assert.ok(
        overflowY === 'auto' || overflowY === 'scroll',
        `a grouped board cannot be scrolled by hand (overflow-y: ${overflowY})`,
      );

      const box = await h.page.locator('.swim').first().boundingBox();
      assert.ok(box !== null, 'no row to aim at');
      await h.page.mouse.move(box.x + box.width / 2, box.y + 40);
      await h.page.mouse.wheel(0, 400);
      await h.page.waitForTimeout(350);

      const top = await h.page.evaluate(
        () => document.querySelector('.board-main')?.scrollTop ?? 0,
      );
      assert.ok(top > 0, 'the grouped board refused to scroll — its lower rows are unreachable');
    } finally {
      await h.close();
    }
  });

  void test('ungrouped, it still refuses to', async () => {
    // The half that must not regress: LAI-290 removed a vertical scrollbar
    // that scrolled over a 91px phantom with no content under it.
    const h = await open('/board?project=laika-core', CROWDED_STUB);

    try {
      await h.page.setViewportSize({ width: 1400, height: 700 });
      await boardReady(h);

      const overflowY = await h.page.evaluate(() => {
        const pane = document.querySelector('.board-main');
        return pane === null ? '' : getComputedStyle(pane).overflowY;
      });
      assert.equal(overflowY, 'hidden', 'the plain board can scroll vertically again');
    } finally {
      await h.close();
    }
  });
});
