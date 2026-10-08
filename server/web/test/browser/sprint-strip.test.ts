/**
 * The sprint strip is one row (LAI-269).
 *
 * The owner supplied the Claude Design render: `[All sprints] [S1 …] [S2 …]
 * [S3 …] [S4 …] [DONE x/y | BLK n | LEFT n] [›]`, on a single line. Ours had a
 * second band carrying a percentage ring, the sprint's name, its dates and its
 * goal — none of which the design has.
 *
 * **LAI-727 took the strip off the Board** on the owner's word, and kept its
 * three figures in the toolbar. So the tests here that are about the *strip*
 * — one row, the pager — now run on the Timeline, which still draws it; the
 * ones that are about the *board* — its figures, its band order, that it does
 * not jump — run on the Board against what replaced the strip.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';

const DAY = 86_400_000;
const NOW = Date.now();

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
  task_counts: { backlog: 1, todo: 0, in_progress: 0, review: 0, done: 1, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const sprint = (id: string, name: string, status: string, from: number, to: number) => ({
  id,
  project_id: 'laika-core',
  name,
  goal: 'Ship it.',
  status,
  starts_on: NOW + from * DAY,
  ends_on: NOW + to * DAY,
  created_at: 1,
  updated_at: 1,
});

const task = (id: string, key: string, status: string, sprintId: string | null) => ({
  id,
  key,
  number: Number(key.split('-')[1]),
  project_id: 'laika-core',
  title: `Task ${key}`,
  description_md: '',
  acceptance_md: '',
  status,
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: sprintId,
  tags: [],
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
  updated_at: NOW,
  started_at: null,
  completed_at: null,
});

/** Four sprints, as the reference has. */
const SPRINTS = [
  sprint('s1', 'Event store & SSE', 'completed', -28, -15),
  sprint('s2', 'Agent sessions', 'completed', -14, -1),
  sprint('s3', 'Presence & capacity', 'active', 0, 13),
  sprint('s4', 'Publish & harden', 'planned', 14, 27),
];

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [CORE], next_cursor: null },
  '/api/v1/projects/laika-core': {
    id: CORE.id,
    slug: CORE.slug,
    prefix: CORE.prefix,
    name: CORE.name,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/projects/laika-core/tasks': {
    data: [task('t1', 'LC-1', 'backlog', 's3'), task('t2', 'LC-2', 'done', 's3')],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/sprints': { data: SPRINTS, next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  // Presence **on**, with somebody in it: the state WORKING NOW used to draw
  // its row in, so the band-order test's "not back" means something
  // (LAI-727). `enabled: false` made the row render nothing anyway.
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u2',
        name: 'Grace Hopper',
        is_agent: true,
        matched_task_id: null,
        project_ids: ['laika-core'],
        last_seen: NOW,
        repo: 'kvelld/laika',
        branch: 'lc-1',
      },
    ],
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the board matches the reference (LAI-270)', () => {
  void test('the tabs are the design’s, and the badge is on Meeting review', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.view-tab').first().waitFor({ timeout: 20_000 });
      const labels = (await h.page.locator('.view-tab').allInnerTexts()).map(
        (t) => t.split('\n')[0],
      );
      assert.ok(labels.includes('List'), `List is not a tab — saw ${labels.join(', ')}`);
      assert.equal(labels[0], 'Board');
      assert.equal(labels[1], 'List', 'List sits beside Board, as the reference has it');
      assert.ok(labels.includes('Calendar'), `Calendar is not a tab — saw ${labels.join(', ')}`);

      // The badge belongs to Meeting review, not Sprints.
      const sprints = h.page.locator('.view-tab', { hasText: 'Sprints' });
      assert.equal(await sprints.locator('.view-tab-count').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('there is no second filter row — the filters are in the bar', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });

      /*
       * The reference has no band under the tabs. Ours carried `Any tag`,
       * `Anyone`, `Ready only` and a Board/List toggle; they moved to the top
       * bar and Board/List became tabs.
       */
      const slot = h.page.locator('.space-slot');
      assert.ok(
        !(await slot.isVisible()),
        'the second row is back — the slot should be empty with no filter active',
      );

      /*
       * And the filters really are reachable, not merely gone.
       *
       * **They moved again in LAI-290** — behind the board's own `Filter`
       * button, which is the reference's shape. The point of this assertion is
       * unchanged and is the reason it was not simply deleted: *no second row,
       * and the filters still exist somewhere a person can reach them.*
       */
      const filter = h.page.locator('.bt-button', { hasText: 'Filter' });
      assert.equal(await filter.count(), 1, 'the filters vanished');

      await filter.click();
      assert.match(
        await h.page.locator('.bt-pop').innerText(),
        // Case-insensitive: the panel's labels are uppercased by CSS, so
        // `innerText` returns `PRIORITY` rather than the source's casing.
        /priority/i,
        'priority must be a named control, not a cycling button',
      );
    } finally {
      await h.close();
    }
  });

  void test('the columns are one height and scroll their own cards', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 900 });
      await h.page.locator('.lane').first().waitFor({ timeout: 20_000 });

      const heights = await h.page
        .locator('.lane')
        .evaluateAll((els: Element[]) =>
          els.map((e) => Math.round(e.getBoundingClientRect().height)),
        );
      assert.equal(
        new Set(heights).size,
        1,
        `the columns are ragged: ${heights.join(', ')} — the reference's are equal`,
      );

      // The body scrolls, and `+ Add task` is outside it so it stays put.
      const bodyScrolls = await h.page
        .locator('.lane-body')
        .first()
        .evaluate((el) => getComputedStyle(el).overflowY);
      assert.equal(bodyScrolls, 'auto');
      const addInsideBody = await h.page.locator('.lane-body .lane-add').count();
      assert.equal(addInsideBody, 0, '“Add task” scrolls away with the cards');
    } finally {
      await h.close();
    }
  });

  void test('a card has a rule between its tags and its footer', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card-foot').first().waitFor({ timeout: 20_000 });
      const border = await h.page
        .locator('.card-foot')
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopWidth);
      assert.equal(border, '1px', 'the footer rule the reference draws is missing');
    } finally {
      await h.close();
    }
  });

  void test('the per-card status select is out of the way but reachable', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });

      // Clipped to a point — the reference has no such control on a card.
      const box = await h.page.locator('.lane-move').first().boundingBox();
      assert.ok(box !== null && box.height <= 2, `the select is ${String(box?.height)}px tall`);

      /*
       * **But still operable**: drag has no keyboard story, so this is the only
       * way a keyboard user moves a task. Focusing it brings it back.
       */
      await h.page.locator('.lane-move-select').first().focus();
      const focused = await h.page.locator('.lane-move').first().boundingBox();
      assert.ok(
        focused !== null && focused.height > 2,
        'focusing the select did not bring it back — the keyboard route is gone',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the bands are in the design’s order (LAI-272, LAI-727)', () => {
  /**
   * **Tabs → the board's own row → the view**, since LAI-727.
   *
   * This was *tabs → sprints → working now → the view*, and it caught the
   * sprint strip rendering below WORKING NOW. The owner then removed both
   * bands. What is left to get wrong is the order of the three that remain,
   * and that nothing has crept back between them. Measured by position, which
   * is the only thing that tells a band in the DOM from a band on the screen.
   */
  void test('the toolbar row follows the tabs, and the lanes follow it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.bstats').waitFor({ timeout: 20_000 });

      const top = async (selector: string) =>
        (await h.page.locator(selector).first().boundingBox())?.y ?? -1;

      const tabs = await top('.view-tabs');
      const row = await top('.board-bar');
      const lanes = await top('.kanban');

      assert.ok(tabs > 0 && row > 0 && lanes > 0, 'a band is missing');
      assert.ok(tabs < row, `the tabs are below the toolbar row (${tabs} vs ${row})`);
      assert.ok(row < lanes, `the toolbar row is below the lanes (${row} vs ${lanes})`);
      // Presence is on and somebody is in it: the state WORKING NOW drew in.
      assert.equal(await h.page.locator('.presence').count(), 0, 'WORKING NOW is back');
      assert.equal(await h.page.locator('.strip').count(), 0, 'the sprint strip is back');
    } finally {
      await h.close();
    }
  });
});

/** The strip itself, where it still is (LAI-727): the Timeline. */
void describe('the sprint strip', () => {
  void test('is a single row of pills and figures', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await h.page.locator('.strip-chip').first().waitFor({ timeout: 20_000 });

      assert.equal(await h.page.locator('.strip-chip').count(), 4, 'one pill per sprint');

      /*
       * **One row.** A pill is ~38px; the band that used to sit under it took
       * the strip past 100. Measuring the strip's height is what tells the two
       * shapes apart — counting elements would not.
       */
      const height = (await h.page.locator('.strip').boundingBox())?.height ?? 0;
      assert.ok(height < 80, `the strip is ${String(Math.round(height))}px tall — a row returned`);

      // The band's parts are gone, not merely hidden.
      assert.equal(await h.page.locator('.strip-ring').count(), 0, 'the ring survived');
      assert.equal(await h.page.locator('.strip-summary').count(), 0, 'the second row survived');
    } finally {
      await h.close();
    }
  });

  void test('the board carries the reference’s three figures, from real counts', async () => {
    /*
     * **On the Board, in the toolbar since LAI-727.** The figures were the
     * strip's on the board; they are the board's own now, and the requirement
     * — three figures, real counts, no WIP — is the same one.
     */
    const h = await open('/board?project=laika-core', STUB);
    try {
      /*
       * **Wait for the tasks, not the element.** The figures render as dashes
       * the moment the group mounts and fill in when the board's tasks land —
       * reading on the element's appearance is a race, and it read `0/0` once.
       */
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(
        () => /DONE\s*1/.test(document.querySelector('.bstats')?.textContent ?? ''),
        { timeout: 10_000 },
      );
      const stats = ((await h.page.locator('.bstats').textContent()) ?? '').replace(/\s+/g, ' ');

      // Two tasks, one done — the figures are the board's own, not a fixture.
      assert.match(stats, /DONE/);
      assert.match(stats, /1\s*\/\s*2/, `DONE should read 1/2 — saw "${stats}"`);
      assert.match(stats, /BLK/);
      assert.match(stats, /LEFT/);
      assert.doesNotMatch(stats, /WIP/, 'WIP belongs on the In Progress header, not here');
    } finally {
      await h.close();
    }
  });

  void test('the pager appears only when there are more sprints than fit', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await h.page.locator('.strip-chip').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(400);
      /*
       * **Present but disabled** (LAI-271). The reference draws the arrow
       * whether or not it can scroll, so it does not appear and vanish as
       * sprints are added; it is inert when there is nothing past the edge,
       * and says so rather than pretending.
       */
      const pager = h.page.locator('.strip-pager');
      assert.equal(await pager.count(), 1, 'the reference draws the arrow always');
      assert.equal(await pager.isDisabled(), true, 'four pills fit — it must be inert');
    } finally {
      await h.close();
    }
  });

  void test('and it does appear once there are', async () => {
    /*
     * **Many sprints, not a narrow window.** The pills share the row down to a
     * floor, so shrinking the viewport makes them narrower rather than
     * overflowing — the first version of this test resized to 900px and the
     * pager never came, correctly. Twelve sprints is the real condition.
     */
    const many = Array.from({ length: 12 }, (_, i) =>
      sprint(`s${String(i)}`, `Sprint number ${String(i)}`, 'planned', i * 14, i * 14 + 13),
    );
    const h = await open('/timeline?project=laika-core', {
      ...STUB,
      '/api/v1/projects/laika-core/sprints': { data: many, next_cursor: null },
    });
    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await h.page.locator('.strip-chip').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(
        () => document.querySelector('.strip-pager')?.hasAttribute('disabled') === false,
        { timeout: 10_000 },
      );

      // And it does something: the row is further along than it was.
      const before = await h.page.locator('.strip-chips').evaluate((el) => el.scrollLeft);
      await h.page.locator('.strip-pager').click();
      await h.page.waitForFunction(
        (was: number) => (document.querySelector('.strip-chips')?.scrollLeft ?? 0) > was,
        before,
        { timeout: 5000 },
      );
    } finally {
      await h.close();
    }
  });
});

/**
 * The strip reserves its height while the sprint list is in flight (LAI-297).
 *
 * **The strip is gone from the board (LAI-727); the guard is not.** What the
 * owner saw was the *board* jumping when the sprints landed, and the board
 * still reads sprints — for the default sprint, the Filter and the stats'
 * scope and days left. So this still waits for that answer and measures.
 *
 * It rendered `null` until the sprints arrived, then appeared at full height
 * and pushed the whole board down 57px. Measured on the seeded instance:
 * `.kanban` top **132 → 189**.
 *
 * **It only shows when sprints are slower than tasks**, which is why it
 * survived the rest of the loading work — with everything delayed together the
 * strip is already drawn by the time the board is, and the jump is zero. The
 * route delay here is therefore on `sprints` *alone*, deliberately.
 */
void describe('the strip holds its place while it loads (LAI-297)', () => {
  /** `.kanban`'s distance from the top — what a jump actually moves. */
  const boardTop = (h: Harness) =>
    h.page.evaluate(() => {
      const k = document.querySelector('.kanban');
      return k === null ? null : Math.round(k.getBoundingClientRect().top);
    });

  void test('the board does not move when the sprints land', async () => {
    const h = await open('/board?project=laika-core', STUB);

    try {
      await h.page.route('**/projects/*/sprints*', async (route) => {
        await h.page.waitForTimeout(1500);
        await route.continue();
      });
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      // **All sprints, chosen** (LAI-713): with no `?sprint=` the board now
      // waits for the sprint list before it draws, so it cannot move when the
      // list lands. An explicit choice draws at once, while the strip is still
      // loading, which is the case this guard exists for.
      await h.page.goto(`${h.origin}/board?project=laika-core&sprint=all`);
      await h.page.waitForTimeout(500);

      const during = await boardTop(h);
      assert.ok(during !== null, 'the board never rendered — nothing to measure');

      // The sprint list lands: the stats' LEFT is filled in from it.
      await h.page.waitForResponse((r) => r.url().includes('/sprints'), { timeout: 20_000 });
      await h.page.waitForTimeout(400);

      const after = await boardTop(h);
      assert.equal(
        after,
        during,
        `the board jumped ${String((after ?? 0) - during)}px when the sprints landed`,
      );
    } finally {
      /*
       * **Before `close()`, or the run fails with every assertion green.** The
       * delaying route is still sleeping when the test ends; its callback then
       * touches a closed page and node's test runner reports an
       * `unhandledRejection` — a non-zero exit with `# fail 0` above it, which
       * is the exact shape `CLAUDE.md` warns a pass-count grep cannot see.
       */
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a project with no sprints reserves nothing', async () => {
    /*
     * The other half, and the reason `loading` had to be a real flag rather
     * than "is the list empty": a board that genuinely has no sprints must
     * draw no strip at all. Reserving height for everyone would have turned
     * one jump into a permanent empty band.
     *
     * The board draws no strip for anyone since LAI-727, so this now guards
     * only that no empty band comes back with it.
     */
    const h = await open('/board?project=laika-core', {
      ...STUB,
      '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    });

    try {
      await h.page.setViewportSize({ width: 1600, height: 1000 });
      await h.page.locator('.lane').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(600);

      assert.equal(await h.page.locator('.strip').count(), 0, 'an empty strip is still drawn');
      assert.equal(await h.page.locator('.strip-chip-ghost').count(), 0);
    } finally {
      await h.close();
    }
  });
});

/**
 * LAI-702: the strip counted one page of the project's tasks. On production
 * Onroute's S3 read 7/42 while it held 157, because its 149 Review tasks were
 * the most recently updated and so fell outside the first 200. Here, page two
 * carries three more S3 tasks in Review.
 *
 * **Since LAI-727 the figures are counted from the board's own sprint read**,
 * not a whole-project walk — so it is that read that is paged here, and the
 * whole-project pages are gone from the stub. A request for them would now
 * be refused and show in `unmatched`.
 */
void describe('the figures count every page of tasks (LAI-702)', () => {
  const S3 = [task('t1', 'LC-1', 'backlog', 's3'), task('t2', 'LC-2', 'done', 's3')];
  const LATER = [
    task('t3', 'LC-3', 'review', 's3'),
    task('t4', 'LC-4', 'review', 's3'),
    task('t5', 'LC-5', 'review', 's3'),
  ];
  const PAGED: ApiStub = {
    ...STUB,
    // The board itself, scoped to the sprint — over two pages.
    '/api/v1/projects/laika-core/tasks?sprint=s3&limit=200': { data: S3, next_cursor: 'P2' },
    '/api/v1/projects/laika-core/tasks?sprint=s3&limit=200&cursor=P2': {
      data: LATER,
      next_cursor: null,
    },
  };

  void test('the DONE figure counts the second page too', async () => {
    const h = await open('/board?project=laika-core&sprint=s3', PAGED);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(
        () => /DONE\s*1\s*\/\s*5/.test(document.querySelector('.bstats')?.textContent ?? ''),
        { timeout: 10_000 },
      );
      const stats = ((await h.page.locator('.bstats').textContent()) ?? '').replace(/\s+/g, ' ');
      assert.match(stats, /DONE 1\s*\/\s*5/, `the summary read "${stats}"`);
      // The board under it agrees: five cards, three of them in Review.
      assert.equal(await h.page.locator('.card').count(), 5);
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/projects/laika-core/tasks' && c.method === 'GET'),
      );
      assert.deepEqual(h.unmatched, [], 'a request matched no stub');
    } finally {
      await h.close();
    }
  });

  void test('a list too long to read says its counts are partial', async () => {
    let served = 0;
    const endless: ApiStub = {
      ...PAGED,
      // Every page points at another: the helper's cap must stop it and say so.
      '/api/v1/projects/laika-core/tasks?sprint=s3&limit=200': () => {
        served += 1;
        return {
          data: [task(`x${String(served)}`, `LC-${String(100 + served)}`, 'todo', 's3')],
          next_cursor: `N${String(served)}`,
        };
      },
    };
    const h = await open('/board?project=laika-core&sprint=s3', endless);
    try {
      await h.page.locator('.bstats-partial').waitFor({ timeout: 20_000 });
      assert.match(
        (await h.page.locator('.bstats-partial').getAttribute('title')) ?? '',
        /partial|first/i,
      );
    } finally {
      await h.close();
    }
  });
});
