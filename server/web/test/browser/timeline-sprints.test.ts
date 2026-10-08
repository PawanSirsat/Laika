/**
 * The Timeline, Jira's way: one row per sprint on an axis that scrolls
 * sideways (LAI-721, D-074).
 *
 * The owner, 2026-10-08, over five screenshots of a row per task: *"by the
 * sprints, like Jira … I don't want the tasks in time."* Every assertion here
 * fails against the per-task timeline it replaces — each was run against it.
 *
 * The stub answers task requests **only** when they name a sprint (or
 * `none`): a request for every task is refused and recorded, which is how
 * "no whole-project walk" is asserted rather than hoped for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, type ApiStub, type Harness } from './harness.ts';

const DAY = 86_400_000;
/** Midday today, UTC, so no assertion depends on the hour the suite runs. */
const NOW = Math.floor(Date.now() / DAY) * DAY + DAY / 2;
const at = (days: number): number => Math.floor(NOW / DAY) * DAY + days * DAY;

const sprint = (id: string, name: string, from: number, to: number, status: string) => ({
  id,
  project_id: 'laika-core',
  name,
  goal: `${name} goal`,
  starts_on: at(from),
  ends_on: at(to),
  status,
  created_at: 1,
  updated_at: 1,
});

/** Ended, running, and to come — in API order deliberately not date order. */
const PAST = sprint('s1', 'Baseline build', -40, -27, 'completed');
const NOW_SPRINT = sprint('s2', 'Finish what is open', -5, 8, 'active');
const NEXT = sprint('s3', 'Reliability', 15, 28, 'planned');

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-0',
  number: 0,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'todo',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  ready: false,
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
  updated_at: 1,
  started_at: null,
  completed_at: null,
  ...over,
});

const IN_NOW = [
  task({ id: 't1', key: 'LC-1', title: 'Driver login', status: 'done', sprint_id: 's2' }),
  task({
    id: 't2',
    key: 'LC-2',
    title: 'Route planner',
    status: 'in_progress',
    sprint_id: 's2',
    assignee_id: 'u1',
    blocked_by: ['t1x'],
  }),
  task({ id: 't1x', key: 'LC-9', title: 'Carrier config', status: 'todo', sprint_id: 's2' }),
];
const IN_NEXT = [task({ id: 't3', key: 'LC-3', title: 'Uptime checks', sprint_id: 's3' })];
const LOOSE = [task({ id: 't4', key: 'LC-4', title: 'Unplanned idea', status: 'backlog' })];

const TASKS = '/api/v1/projects/laika-core/tasks';

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': {
    data: [
      {
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
        task_counts: { backlog: 1, todo: 2, in_progress: 1, review: 0, done: 1, cancelled: 0 },
        blocked_count: 1,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': {
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
  },
  '/api/v1/projects/laika-core/sprints': { data: [NEXT, PAST, NOW_SPRINT], next_cursor: null },
  [`${TASKS}?sprint=s1`]: { data: [], next_cursor: null },
  [`${TASKS}?sprint=s2`]: { data: IN_NOW, next_cursor: null },
  [`${TASKS}?sprint=s3`]: { data: IN_NEXT, next_cursor: null },
  [`${TASKS}?sprint=none`]: { data: LOOSE, next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: true, present: [] },
};

void after(async () => {
  await closeBrowser();
});

/** Every task request the page made, as its query string. */
function taskRequests(h: Harness): string[] {
  const seen: string[] = [];
  h.page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === TASKS) seen.push(url.search);
  });
  return seen;
}

const openTimeline = async (path = '/timeline?project=laika-core', width = 1440) => {
  const h = await open(path, STUB);
  await h.page.setViewportSize({ width, height: 900 });
  await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
  return h;
};

/** A sprint's row, by its id. */
const group = (h: Harness, id: string) => h.page.locator(`.tlx-group[data-sprint-id="${id}"]`);

const box = async (h: Harness, selector: string) => {
  const b = await h.page.locator(selector).first().boundingBox();
  assert.ok(b !== null, `${selector} is not on the page`);
  return b;
};

void describe('the Timeline is one row per sprint (LAI-721)', () => {
  void test('three sprints, three rows, in date order — and not one task on the axis', async () => {
    const h = await openTimeline();
    try {
      const names = await h.page.locator('.tlx-sprint .tlx-sprint-name').allInnerTexts();
      assert.deepEqual(names, ['Baseline build', 'Finish what is open', 'Reliability']);
      assert.deepEqual(await h.page.locator('.tlx-sprint .tlx-sprint-key').allInnerTexts(), [
        'S1',
        'S2',
        'S3',
      ]);
      assert.equal(
        await h.page.locator('.tlx-task').count(),
        0,
        'a task row before any sprint opened',
      );
      assert.equal(await h.page.locator('.tlx-bar').count(), 3, 'one bar per sprint');

      // The state comes from the dates. (Text, not `innerText`: CSS uppercases it.)
      assert.deepEqual(await h.page.locator('.tlx-sprint .tlx-lozenge').allTextContents(), [
        'Ended',
        'Active',
        'Planned',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('loads the sprints and no tasks until a sprint is opened', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    const asked = taskRequests(h);
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(500);
      assert.deepEqual(asked, [], `tasks were fetched up front: ${asked.join(', ')}`);
      assert.deepEqual(h.unmatched, [], 'a task request named no sprint');

      await group(h, 's2').locator('.tlx-chevron').click();
      await group(h, 's2').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      assert.ok(
        asked.length > 0 && asked.every((q) => new URLSearchParams(q).get('sprint') === 's2'),
        `opening S2 asked for ${asked.join(', ')}`,
      );
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('each bar spans its sprint’s dates at the zoom’s scale', async () => {
    const h = await openTimeline();
    try {
      // Months: 10px a day. S2 is fourteen days, S1 ends 22 days before S2.
      const s1 = await box(h, '.tlx-group[data-sprint-id="s1"] .tlx-bar');
      const s2 = await box(h, '.tlx-group[data-sprint-id="s2"] .tlx-bar');
      const s3 = await box(h, '.tlx-group[data-sprint-id="s3"] .tlx-bar');
      assert.ok(Math.abs(s2.width - 140) <= 1, `S2 is ${String(s2.width)}px, not 14 days`);
      assert.ok(Math.abs(s2.x - s1.x - 35 * 10) <= 1, `S1 → S2 is ${String(s2.x - s1.x)}px`);
      assert.ok(Math.abs(s3.x - s2.x - 20 * 10) <= 1, `S2 → S3 is ${String(s3.x - s2.x)}px`);
    } finally {
      await h.close();
    }
  });
});

void describe('the axis scrolls sideways (LAI-721)', () => {
  void test('the chart scrolls and the sprint column stays put; the page does not', async () => {
    const h = await openTimeline('/timeline?project=laika-core&zoom=weeks', 1366);
    try {
      const scroller = h.page.locator('.tlx');
      const room = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.ok(room > 1000, `positive control: the axis overflows (${String(room)}px)`);
      assert.ok(
        await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'the page itself scrolls sideways',
      );

      const sideBefore = await box(h, '.tlx-group[data-sprint-id="s2"] .tlx-side');
      const barBefore = await box(h, '.tlx-group[data-sprint-id="s2"] .tlx-bar');
      await scroller.evaluate((el) => {
        el.scrollLeft += 300;
      });
      const sideAfter = await box(h, '.tlx-group[data-sprint-id="s2"] .tlx-side');
      const barAfter = await box(h, '.tlx-group[data-sprint-id="s2"] .tlx-bar');
      assert.equal(sideAfter.x, sideBefore.x, 'the sprint column scrolled away');
      assert.ok(
        Math.abs(barBefore.x - barAfter.x - 300) <= 1,
        'the bar did not move with the axis',
      );

      // The header stays at the top while rows scroll under it.
      const headBefore = await box(h, '.tlx-head');
      await scroller.evaluate((el) => {
        el.scrollTop += 40;
      });
      assert.equal((await box(h, '.tlx-head')).y, headBefore.y, 'the header scrolled away');
    } finally {
      await h.close();
    }
  });

  void test('zoom changes the scale and is kept in the URL', async () => {
    const h = await openTimeline();
    try {
      const width = async () => (await box(h, '.tlx-group[data-sprint-id="s2"] .tlx-bar')).width;
      assert.ok(Math.abs((await width()) - 140) <= 1, 'Months is 10px a day');

      await h.page.getByRole('button', { name: 'Weeks', exact: true }).click();
      await h.page.waitForURL(/zoom=weeks/, { timeout: 5_000 });
      assert.ok(Math.abs((await width()) - 14 * 36) <= 1, `Weeks: ${String(await width())}px`);
      assert.equal(
        await h.page
          .getByRole('button', { name: 'Weeks', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );

      await h.page.getByRole('button', { name: 'Quarters', exact: true }).click();
      await h.page.waitForURL(/zoom=quarters/, { timeout: 5_000 });
      assert.ok(Math.abs((await width()) - 14 * 3.5) <= 1, `Quarters: ${String(await width())}px`);
    } finally {
      await h.close();
    }
  });

  void test('opens with today in view, and Today brings it back', async () => {
    const h = await openTimeline('/timeline?project=laika-core&zoom=weeks', 1366);
    try {
      const todayInView = () =>
        h.page.evaluate(() => {
          const line = document.querySelector('.tlx-today')!.getBoundingClientRect();
          const chart = document.querySelector('.tlx')!.getBoundingClientRect();
          const side = document.querySelector('.tlx-corner')!.getBoundingClientRect();
          return line.left >= side.right && line.left <= chart.right;
        });
      assert.equal(await todayInView(), true, 'today is not in view on open');
      assert.match(await h.page.locator('.tlx-today-pill').innerText(), /^TODAY/);

      await h.page.locator('.tlx').evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      assert.equal(await todayInView(), false, 'positive control: scrolled away from today');
      await h.page.getByRole('button', { name: 'Today', exact: true }).click();
      assert.equal(await todayInView(), true, 'Today did not bring today back');
    } finally {
      await h.close();
    }
  });
});

void describe('a sprint opens to list its tasks (LAI-721)', () => {
  void test('the chevron opens and closes it; tasks are rows, never bars', async () => {
    const h = await openTimeline();
    try {
      const chevron = group(h, 's2').locator('.tlx-chevron');
      assert.equal(await chevron.getAttribute('aria-expanded'), 'false');
      await chevron.focus();
      await h.page.keyboard.press('Enter');
      await group(h, 's2').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      assert.equal(await chevron.getAttribute('aria-expanded'), 'true');

      const keys = await group(h, 's2').locator('.tlx-task .tlx-task-key').allInnerTexts();
      assert.deepEqual(keys.sort(), ['LC-1', 'LC-2', 'LC-9']);
      assert.equal(
        await group(h, 's2').locator('.tlx-task .tlx-bar').count(),
        0,
        'a task has a bar',
      );

      // Loaded, the sprint says how far along it is, and what is blocked.
      assert.equal((await group(h, 's2').locator('.tlx-bar-count').innerText()).trim(), '1/3');
      assert.match(await group(h, 's2').locator('.tlx-bar').innerText(), /1 blocked/);

      await chevron.click();
      assert.equal(await group(h, 's2').locator('.tlx-task').count(), 0);
      assert.equal(await chevron.getAttribute('aria-expanded'), 'false');
    } finally {
      await h.close();
    }
  });

  void test('a task opens in the drawer', async () => {
    const h = await openTimeline();
    try {
      await group(h, 's3').locator('.tlx-chevron').click();
      await group(h, 's3').locator('.tlx-task-open').first().click();
      await h.page.waitForURL(/task=t3/, { timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('a sprint named by `?sprint=` opens on arrival; the rest stay closed', async () => {
    const h = await openTimeline('/timeline?project=laika-core&sprint=s3');
    try {
      await group(h, 's3').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      assert.equal(await group(h, 's2').locator('.tlx-task').count(), 0);
      assert.equal(await group(h, 's1').locator('.tlx-task').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the unscheduled tray loads its tasks only when opened', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    const asked = taskRequests(h);
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      const tray = h.page.getByRole('button', { name: /Unscheduled/ });
      assert.equal(await tray.getAttribute('aria-expanded'), 'false');
      assert.deepEqual(asked, []);
      await tray.click();
      await h.page
        .locator('.timeline-task', { hasText: 'Unplanned idea' })
        .waitFor({ timeout: 10_000 });
      assert.deepEqual(
        asked.map((q) => new URLSearchParams(q).get('sprint')),
        ['none'],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('it reads in both themes (LAI-721)', () => {
  void test('a past sprint is dimmed, the current one is the accent', async () => {
    const h = await openTimeline();
    try {
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const style = (id: string) =>
          group(h, id)
            .locator('.tlx-bar')
            .evaluate((el) => ({
              opacity: Number(getComputedStyle(el).opacity),
              border: getComputedStyle(el).borderTopColor,
            }));
        const accent = await h.page.evaluate(() => {
          const probe = document.createElement('div');
          probe.style.border = '1px solid var(--accent)';
          document.body.append(probe);
          const value = getComputedStyle(probe).borderTopColor;
          probe.remove();
          return value;
        });
        assert.ok((await style('s1')).opacity < 1, `${theme}: the past sprint is not dimmed`);
        assert.equal((await style('s2')).opacity, 1, `${theme}: the current sprint is dimmed`);
        assert.equal(
          (await style('s2')).border,
          accent,
          `${theme}: the current sprint is not the accent`,
        );
      }
    } finally {
      await h.close();
    }
  });
});
