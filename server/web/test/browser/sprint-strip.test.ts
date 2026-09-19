/**
 * The sprint strip is one row (LAI-269).
 *
 * The owner supplied the Claude Design render: `[All sprints] [S1 …] [S2 …]
 * [S3 …] [S4 …] [DONE x/y | BLK n | LEFT n] [›]`, on a single line. Ours had a
 * second band carrying a percentage ring, the sprint's name, its dates and its
 * goal — none of which the design has.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

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
  // Presence **on**, with somebody in it: the band-order test needs WORKING NOW
  // to render at all, and `enabled: false` makes the strip render nothing.
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

      // And the filters really are in the bar, not merely gone.
      assert.ok((await h.page.locator('.space-select').count()) >= 2, 'the filters vanished');
      assert.match(
        await h.page.locator('.space-select').first().innerText(),
        /Priority/,
        'priority must read as a named dropdown, not a cycling button',
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

void describe('the bands are in the design’s order (LAI-272)', () => {
  /**
   * **Tabs → sprints → working now → the view.**
   *
   * Ours had the sprint strip *below* WORKING NOW, because the strip belongs to
   * the board and the presence strip belongs to the space, so the board could
   * only render underneath. Measured by position, which is the only thing that
   * can tell the two arrangements apart — both render all four bands.
   */
  void test('the sprint strip sits above WORKING NOW', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.strip-chip').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.presence').waitFor({ timeout: 20_000 });

      const top = async (selector: string) =>
        (await h.page.locator(selector).first().boundingBox())?.y ?? -1;

      const tabs = await top('.view-tabs');
      const sprints = await top('.strip');
      const working = await top('.presence');
      const lanes = await top('.kanban');

      assert.ok(tabs > 0 && sprints > 0 && working > 0 && lanes > 0, 'a band is missing');
      assert.ok(tabs < sprints, `the tabs are below the sprints (${tabs} vs ${sprints})`);
      assert.ok(
        sprints < working,
        `the sprint strip is below WORKING NOW (${sprints} vs ${working}) — the owner's report`,
      );
      assert.ok(working < lanes, `WORKING NOW is below the lanes (${working} vs ${lanes})`);
    } finally {
      await h.close();
    }
  });
});

void describe('the sprint strip', () => {
  void test('is a single row of pills and figures', async () => {
    const h = await open('/board?project=laika-core', STUB);
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

  void test('carries the reference’s three figures, from real counts', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      /*
       * **Wait for the tasks, not the element.** The figures render as `0/0`
       * the moment the strip mounts and fill in when the board's tasks land —
       * reading on the element's appearance is a race, and it read `0/0` once.
       */
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(
        () => /DONE\s*1/.test(document.querySelector('.strip-stats')?.textContent ?? ''),
        { timeout: 10_000 },
      );
      const stats = (await h.page.locator('.strip-stats').innerText()).replace(/\s+/g, ' ');

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
    const h = await open('/board?project=laika-core', STUB);
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
    const h = await open('/board?project=laika-core', {
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
