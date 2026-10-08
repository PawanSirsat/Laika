/**
 * The Timeline, Jira's way: one row per sprint on an axis that scrolls
 * sideways (LAI-721, D-074).
 *
 * The owner, 2026-10-08, over five screenshots of a row per task: *"by the
 * sprints, like Jira … I don't want the tasks in time."*
 *
 * The stub answers task requests **only** when they name a sprint (or
 * `none`): a request for every task is refused and recorded, which is how
 * "no whole-project walk" is asserted rather than hoped for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  fakeStream,
  open,
  refuse,
  setTheme,
  type ApiStub,
  type Harness,
} from './harness.ts';

const DAY = 86_400_000;
/** Midday today, UTC, so no assertion depends on the hour the suite runs. */
const NOW = Math.floor(Date.now() / DAY) * DAY + DAY / 2;
const at = (days: number, from = NOW): number => Math.floor(from / DAY) * DAY + days * DAY;

const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'] as const;
const counts = (by: Partial<Record<(typeof STATUSES)[number], number>>) => {
  const by_status = Object.fromEntries(STATUSES.map((s) => [s, by[s] ?? 0]));
  return {
    total: Object.values(by_status).reduce((a, b) => a + b, 0),
    by_status,
  };
};

const sprint = (
  id: string,
  name: string,
  from: number,
  to: number,
  status: string,
  task_counts: ReturnType<typeof counts> = counts({}),
) => ({
  id,
  project_id: 'laika-core',
  name,
  goal: `${name} goal`,
  starts_on: from,
  ends_on: to,
  status,
  created_at: 1,
  updated_at: 1,
  task_counts,
});

/** Ended, running, and to come — in API order deliberately not date order. */
const PAST = sprint('s1', 'Baseline build', at(-40), at(-27), 'completed');
const NOW_SPRINT = sprint(
  's2',
  'Finish what is open',
  at(-5),
  at(8),
  'active',
  counts({ done: 2, in_progress: 1, todo: 2 }),
);
const NEXT = sprint('s3', 'Reliability', at(15), at(28), 'planned', counts({ todo: 1 }));

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
    title: 'Route planner for every depot and carrier',
    status: 'in_progress',
    sprint_id: 's2',
    assignee_id: 'u1',
    blocked_by: ['t1x'],
  }),
  task({ id: 't1x', key: 'LC-9', title: 'Carrier config', status: 'todo', sprint_id: 's2' }),
  // Blocked by a task in another sprint: not loaded here, so not knowable.
  task({ id: 't5', key: 'LC-5', title: 'Uptime alerts', sprint_id: 's2', blocked_by: ['t3'] }),
  // Finished: whatever it waited on, it is not "blocked?" now.
  task({
    id: 't6',
    key: 'LC-6',
    title: 'Shipped report',
    status: 'done',
    sprint_id: 's2',
    blocked_by: ['t3'],
  }),
];
const IN_NEXT = [task({ id: 't3', key: 'LC-3', title: 'Uptime checks', sprint_id: 's3' })];
const LOOSE = [task({ id: 't4', key: 'LC-4', title: 'Unplanned idea', status: 'backlog' })];

const TASKS = '/api/v1/projects/laika-core/tasks';
const SPRINTS = '/api/v1/projects/laika-core/sprints';

const PROJECT = {
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
};

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
        ...PROJECT,
        task_counts: { backlog: 1, todo: 3, in_progress: 1, review: 0, done: 1, cancelled: 0 },
        blocked_count: 1,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': PROJECT,
  [SPRINTS]: { data: [NEXT, PAST, NOW_SPRINT], next_cursor: null },
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

/**
 * How many task requests the stub has seen. `h.calls` records from the first
 * request, so nothing made before a listener is attached can be missed.
 */
const taskCalls = (h: Harness): number => h.calls.filter((c) => c.path === TASKS).length;
const sprintCalls = (h: Harness): number => h.calls.filter((c) => c.path === SPRINTS).length;

/** Every task request the page made, as its query string. */
function taskRequests(h: Harness): string[] {
  const seen: string[] = [];
  h.page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === TASKS) seen.push(url.search);
  });
  return seen;
}

const openTimeline = async (
  path = '/timeline?project=laika-core',
  width = 1440,
  stub: ApiStub = STUB,
  height = 900,
) => {
  const h = await open(path, stub);
  await h.page.setViewportSize({ width, height });
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

const tokenColour = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const probe = document.createElement('div');
    probe.style.background = `var(${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, name);

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
      assert.equal(await h.page.locator('.tlx-task').count(), 0, 'a task row before any opened');
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

  void test('every bar says done over total without being opened', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      const count = (id: string) => group(h, id).locator('.tlx-bar-count').innerText();
      assert.equal(await count('s1'), 'no tasks');
      assert.equal(await count('s2'), '2/5');
      assert.equal(await count('s3'), '0/1');
      assert.ok(sprintCalls(h) >= 1, 'positive control: the sprints were asked for');
      assert.equal(taskCalls(h), 0, 'the counts cost a task request');
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
      assert.ok(sprintCalls(h) >= 1, 'positive control: the sprints were asked for');
      assert.equal(taskCalls(h), 0, 'tasks were fetched up front');
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
      // Months: 10px a day. S2 is fourteen days, S1 starts 35 days before S2.
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
    } finally {
      await h.close();
    }
  });

  void test('the header stays at the top while the rows scroll under it', async () => {
    // Short, with a sprint open, so the chart really has rows to scroll.
    const h = await openTimeline('/timeline?project=laika-core', 1366, STUB, 520);
    try {
      await group(h, 's2').locator('.tlx-chevron').click();
      await group(h, 's2').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      const scroller = h.page.locator('.tlx');
      const headBefore = await box(h, '.tlx-head');
      const scrolled = await scroller.evaluate((el) => {
        el.scrollTop += 60;
        return el.scrollTop;
      });
      assert.ok(scrolled > 0, `positive control: the chart scrolls down (${String(scrolled)}px)`);
      assert.equal((await box(h, '.tlx-head')).y, headBefore.y, 'the header scrolled away');

      // **One vertical scroller**: the chart, not the page around it.
      assert.ok(
        await h.page.evaluate(
          () => (document.scrollingElement?.scrollHeight ?? 0) <= innerHeight + 1,
        ),
        'the page scrolls vertically around the chart',
      );
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

  void test('the chart is one tab stop that the arrow keys pan; a sprint is one more', async () => {
    const h = await openTimeline('/timeline?project=laika-core&zoom=weeks', 1366);
    try {
      const scroller = h.page.locator('.tlx');
      await scroller.focus();
      const before = await scroller.evaluate((el) => el.scrollLeft);
      await h.page.keyboard.press('ArrowRight');
      const after = await scroller.evaluate((el) => el.scrollLeft);
      assert.ok(after - before >= 80, `ArrowRight moved ${String(after - before)}px`);

      const stops = await group(h, 's2').evaluate(
        (el) =>
          [...el.querySelectorAll<HTMLElement>('button, [tabindex], a[href]')].filter(
            (n) => n.tabIndex >= 0,
          ).length,
      );
      assert.equal(stops, 1, `a sprint row has ${String(stops)} tab stops, not 1`);
    } finally {
      await h.close();
    }
  });

  void test('no tick label sits under the today pill, at Months or Quarters', async () => {
    for (const zoom of ['months', 'quarters']) {
      const h = await openTimeline(`/timeline?project=laika-core&zoom=${zoom}`, 1366);
      try {
        const clash = await h.page.evaluate(() => {
          const pill = document.querySelector('.tlx-today-pill')!.getBoundingClientRect();
          return [...document.querySelectorAll('.tlx-scale-tick')]
            .filter((t) => (t.textContent ?? '').trim() !== '')
            .map((t) => {
              const r = document.createRange();
              r.selectNodeContents(t);
              return { text: t.textContent ?? '', b: r.getBoundingClientRect() };
            })
            .filter(({ b }) => b.right > pill.left && b.left < pill.right)
            .map(({ text }) => text);
        });
        assert.deepEqual(clash, [], `${zoom}: labels under the pill`);
        // And the labels are there to give way: one either side of the pill.
        const sides = await h.page.evaluate(() => {
          const pill = document.querySelector('.tlx-today-pill')!.getBoundingClientRect();
          const corner = document.querySelector('.tlx-corner')!.getBoundingClientRect();
          const labelled = [...document.querySelectorAll('.tlx-scale-tick')]
            .filter((t) => (t.textContent ?? '').trim() !== '')
            .map((t) => t.getBoundingClientRect())
            .filter((r) => r.left >= corner.right);
          return {
            before: labelled.filter((r) => r.right <= pill.left).length,
            after: labelled.filter((r) => r.left >= pill.right).length,
          };
        });
        assert.ok(sides.before > 0, `${zoom}: no label left of the pill`);
        assert.ok(sides.after > 0, `${zoom}: no label right of the pill`);
      } finally {
        await h.close();
      }
    }
  });

  void test('a month label is whole or absent — and the month under the view is named', async () => {
    const h = await openTimeline('/timeline?project=laika-core&zoom=weeks', 1366);
    try {
      // Walk across the window. At every stop: each drawn label sits wholly in
      // its band and right of the sprint column; at least one is in view; and
      // when the month under the view's left edge has room for its name, the
      // leftmost label is that month's.
      const scroller = h.page.locator('.tlx');
      const width = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      let checked = 0;
      let named = 0;
      for (let x = 0; x <= width; x += 97) {
        await scroller.evaluate((el, to) => {
          el.scrollLeft = to;
        }, x);
        await h.page.waitForTimeout(40);
        const stop = await h.page.evaluate(() => {
          const chart = document.querySelector<HTMLElement>('.tlx')!;
          const corner = document.querySelector('.tlx-corner')!.getBoundingClientRect();
          const from = Number(chart.dataset.windowFrom);
          const dayWidth = Number(chart.dataset.dayWidth);
          const leftDay = from + Math.floor(chart.scrollLeft / dayWidth) * 86_400_000;
          const expected = new Date(leftDay).toLocaleDateString('en-GB', {
            timeZone: 'UTC',
            month: 'short',
            year: 'numeric',
          });
          const labels = [...document.querySelectorAll('.tlx-scale-label')].map((label) => {
            const l = label.getBoundingClientRect();
            const band = label.parentElement!.getBoundingClientRect();
            return {
              text: label.textContent ?? '',
              left: l.left,
              visible: l.right > corner.right && l.left < chart.getBoundingClientRect().right,
              whole: l.left >= band.left - 0.5 && l.right <= band.right + 0.5,
              clear: l.left >= corner.right - 1,
            };
          });
          const visible = labels.filter((l) => l.visible).sort((a, b) => a.left - b.left);
          // The band under the left edge, and how much of it is in view.
          const under = [...document.querySelectorAll('.tlx-scale-band')]
            .map((b) => b.getBoundingClientRect())
            .find((b) => b.left <= corner.right + 1 && b.right > corner.right + 1);
          return {
            bad: labels.filter((l) => l.visible && !(l.whole && l.clear)).map((l) => l.text),
            count: visible.length,
            first: visible[0]?.text,
            expected,
            room: under === undefined ? 0 : under.right - corner.right,
          };
        });
        assert.deepEqual(stop.bad, [], `at scrollLeft ${String(x)}`);
        assert.ok(stop.count > 0, `no month named at scrollLeft ${String(x)}`);
        if (stop.room >= 140) {
          assert.equal(stop.first, stop.expected, `at scrollLeft ${String(x)}`);
          named += 1;
        }
        checked += 1;
      }
      assert.ok(checked > 10, 'positive control: walked the axis');
      assert.ok(named > 5, 'positive control: the left-edge month was checked');
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
      assert.deepEqual(keys.sort(), ['LC-1', 'LC-2', 'LC-5', 'LC-6', 'LC-9']);
      assert.equal(
        await group(h, 's2').locator('.tlx-task .tlx-bar').count(),
        0,
        'a task has a bar',
      );
      assert.equal(
        await group(h, 's2').locator('.tlx-task .tlx-track > *').count(),
        0,
        'something is drawn on a task row’s track',
      );
      assert.equal((await group(h, 's2').locator('.tlx-bar-count').innerText()).trim(), '2/5');

      await chevron.click();
      assert.equal(await group(h, 's2').locator('.tlx-task').count(), 0);
      assert.equal(await chevron.getAttribute('aria-expanded'), 'false');
    } finally {
      await h.close();
    }
  });

  void test('blocked counts what it knows and says what it cannot judge', async () => {
    const h = await openTimeline();
    try {
      await group(h, 's2').locator('.tlx-chevron').click();
      await group(h, 's2').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      assert.equal(
        (await group(h, 's2').locator('.tlx-bar-blocked').innerText()).trim(),
        '1 blocked · 1 blocked?',
      );
      const label = (key: string) =>
        group(h, 's2')
          .locator('.tlx-task', { has: h.page.locator('.tlx-task-key', { hasText: key }) })
          .locator('.tlx-task-blocked');
      assert.equal((await label('LC-2').innerText()).trim(), 'Blocked');
      assert.equal((await label('LC-5').innerText()).trim(), 'Blocked?');
      assert.equal(await label('LC-9').count(), 0, 'an unblocked task is marked');
      assert.equal(await label('LC-6').count(), 0, 'a finished task is marked "blocked?"');

      // **The title wins** (LAI-721 review): LC-2's long title keeps its room
      // and the label gives way to its icon, its words kept in the tooltip.
      const row = group(h, 's2').locator('.tlx-task', {
        has: h.page.locator('.tlx-task-key', { hasText: 'LC-2' }),
      });
      const titleWidth = (await row.locator('.tlx-task-title').boundingBox())?.width ?? 0;
      const labelWidth = (await row.locator('.tlx-task-blocked').boundingBox())?.width ?? 999;
      assert.ok(titleWidth >= 100, `the title was squeezed to ${String(titleWidth)}px`);
      assert.ok(labelWidth <= 40, `the label kept ${String(labelWidth)}px`);
      assert.ok(
        ((await row.locator('.tlx-task-blocked').getAttribute('title')) ?? '').length > 10,
        'the shrunk label lost its tooltip',
      );
    } finally {
      await h.close();
    }
  });

  void test('an unassigned task wears a neutral mark, not a colour', async () => {
    const h = await openTimeline();
    try {
      await group(h, 's2').locator('.tlx-chevron').click();
      const unassigned = group(h, 's2')
        .locator('.tlx-task', { has: h.page.locator('.tlx-task-key', { hasText: 'LC-9' }) })
        .locator('.tlx-avatar');
      await unassigned.waitFor({ timeout: 10_000 });
      assert.match((await unassigned.getAttribute('class')) ?? '', /tlx-avatar-none/);
      assert.equal(
        await unassigned.evaluate((el) => getComputedStyle(el).backgroundColor),
        await tokenColour(h.page, '--bg-column'),
      );
    } finally {
      await h.close();
    }
  });

  void test('an empty sprint says so', async () => {
    const h = await openTimeline();
    try {
      await group(h, 's1').locator('.tlx-chevron').click();
      await group(h, 's1')
        .locator('.tlx-task-none', { hasText: 'No tasks in this sprint.' })
        .waitFor({ timeout: 10_000 });
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

  void test('a sprint that fails to load says so, and opening it again retries', async () => {
    let calls = 0;
    const flaky: ApiStub = {
      ...STUB,
      [`${TASKS}?sprint=s3`]: () => {
        calls += 1;
        return calls === 1
          ? refuse(500, 'internal', 'try later')
          : { data: IN_NEXT, next_cursor: null };
      },
    };
    const h = await openTimeline('/timeline?project=laika-core', 1440, flaky);
    try {
      const chevron = group(h, 's3').locator('.tlx-chevron');
      await chevron.click();
      await group(h, 's3')
        .locator('.tlx-task-none', { hasText: 'Could not load' })
        .waitFor({ timeout: 10_000 });
      await chevron.click();
      await chevron.click();
      await group(h, 's3')
        .locator('.tlx-task-key', { hasText: 'LC-3' })
        .waitFor({ timeout: 10_000 });
      assert.equal(calls, 2);
    } finally {
      await h.close();
    }
  });

  void test('Expand all asks for at most three sprints at a time', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      sprint(`m${String(i)}`, `Sprint ${String(i)}`, at(i * 15 - 30), at(i * 15 - 17), 'planned'),
    );
    const stub: ApiStub = {
      ...STUB,
      [SPRINTS]: { data: many, next_cursor: null },
      ...Object.fromEntries(
        many.map((s) => [`${TASKS}?sprint=${s.id}`, { data: [], next_cursor: null }]),
      ),
    };
    const h = await openTimeline('/timeline?project=laika-core', 1440, stub);
    let live = 0;
    let peak = 0;
    let done = 0;
    await h.page.route(
      (url) => url.pathname === TASKS,
      async (route) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 250));
        live -= 1;
        done += 1;
        await route.continue();
      },
    );
    try {
      await h.page.getByRole('button', { name: 'Expand all', exact: true }).click();
      // Loaded, not merely asked for: "Loading tasks…" shares the row's class.
      await h.page.waitForFunction(
        (n: number) =>
          [...document.querySelectorAll('.tlx-task-none')].filter((el) =>
            (el.textContent ?? '').includes('No tasks in this sprint.'),
          ).length === n,
        many.length,
        { timeout: 20_000 },
      );
      assert.equal(done, many.length, 'positive control: every sprint was fetched');
      assert.ok(peak <= 3, `${String(peak)} task requests at once`);
      assert.ok(peak >= 2, `positive control: requests overlapped (${String(peak)})`);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a sprint whose tasks run past the page cap says the list is cut', async () => {
    let n = 0;
    const endless: ApiStub = {
      ...STUB,
      [`${TASKS}?sprint=s3`]: () => {
        n += 1;
        return {
          data: [task({ id: `e${String(n)}`, key: `LC-${String(100 + n)}`, sprint_id: 's3' })],
          next_cursor: `more-${String(n)}`,
        };
      },
    };
    const h = await openTimeline('/timeline?project=laika-core', 1440, endless);
    try {
      await group(h, 's3').locator('.tlx-chevron').click();
      await group(h, 's3')
        .locator('.tlx-task-none', { hasText: /Only the first \d+ tasks/ })
        .waitFor({ timeout: 20_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('`?sprint=` from a link (LAI-721 review)', () => {
  void test('a real sprint opens, and the chart starts at that sprint, not at today', async () => {
    const h = await openTimeline('/timeline?project=laika-core&zoom=weeks&sprint=s3', 1366);
    try {
      await group(h, 's3').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      assert.equal(await group(h, 's2').locator('.tlx-task').count(), 0);
      const bar = await box(h, '.tlx-group[data-sprint-id="s3"] .tlx-bar');
      const side = await box(h, '.tlx-corner');
      const chart = await box(h, '.tlx');
      const view = chart.x + chart.width - (side.x + side.width);
      const offset = bar.x - (side.x + side.width);
      assert.ok(
        offset >= 0 && offset <= view * 0.25,
        `S3 starts ${String(Math.round(offset))}px into a ${String(Math.round(view))}px view`,
      );
    } finally {
      await h.close();
    }
  });

  void test('the Board’s `all` and `none` open nothing and ask for nothing', async () => {
    for (const value of ['all', 'none', 'not-a-sprint']) {
      const h = await open(`/timeline?project=laika-core&sprint=${value}`, STUB);
      try {
        await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
        await h.page.waitForTimeout(400);
        assert.ok(sprintCalls(h) >= 1, 'positive control: the sprints were asked for');
        assert.equal(taskCalls(h), 0, `sprint=${value} asked for tasks`);
        assert.equal(
          await h.page.locator('.tlx-task').count(),
          0,
          `sprint=${value} opened a sprint`,
        );
        assert.equal(
          await h.page.getByRole('button', { name: /Unscheduled/ }).getAttribute('aria-expanded'),
          'false',
          `sprint=${value} opened the tray`,
        );
      } finally {
        await h.close();
      }
    }
  });
});

void describe('distant and impossible dates (LAI-721 review)', () => {
  const wide: ApiStub = {
    ...STUB,
    [SPRINTS]: {
      data: [
        NEXT,
        PAST,
        NOW_SPRINT,
        sprint('old', 'Six years back', at(-6 * 366), at(-6 * 366 + 13), 'completed'),
        sprint('someday', 'Someday', at(6 * 366), at(6 * 366 + 13), 'planned'),
        sprint('far', 'Far future', at(30), Date.UTC(2062, 2, 1), 'planned'),
        sprint('y9999', 'Year 9999', at(40), Date.UTC(9999, 0, 1), 'planned'),
        sprint('huge', 'Not a date', at(50), 1e17, 'planned'),
      ],
      next_cursor: null,
    },
  };

  void test('distant sprints are drawn; impossible ones are listed, each in its own words', async () => {
    const h = await openTimeline('/timeline?project=laika-core&zoom=weeks', 1366, wide);
    try {
      const names = await h.page.locator('.tlx-sprint .tlx-sprint-name').allInnerTexts();
      for (const name of ['Six years back', 'Someday', 'Far future']) {
        assert.ok(names.includes(name), `${name} is not drawn: ${names.join(', ')}`);
      }
      assert.ok(!names.includes('Year 9999') && !names.includes('Not a date'), names.join(', '));

      const notices = await h.page.locator('.tlx-notice').allInnerTexts();
      const invalid = notices.find((n) => n.includes('Not a date')) ?? '';
      const beyond = notices.find((n) => n.includes('Year 9999')) ?? '';
      assert.match(invalid, /not a valid date/);
      assert.doesNotMatch(invalid, /Year 9999/);
      assert.match(beyond, /beyond the timeline's reach/);
      assert.ok(
        !(await h.page.locator('.tlx').innerText()).includes('Invalid Date'),
        '"Invalid Date" on the axis',
      );
    } finally {
      await h.close();
    }
  });

  void test('a window of decades draws only the header in view, and stays quick', async () => {
    const h = await openTimeline('/timeline?project=laika-core&zoom=weeks', 1366, wide);
    try {
      // The work, counted: a 2062 window at Weeks is ~1,850 weeks; only the
      // stretch around the view is drawn.
      const span = await h.page.locator('.tlx').evaluate((el) => el.scrollWidth);
      assert.ok(span > 400_000, `positive control: decades wide (${String(span)}px)`);
      const ticks = await h.page.locator('.tlx-scale-tick').count();
      const bands = await h.page.locator('.tlx-scale-band').count();
      assert.ok(ticks > 0 && ticks < 40, `${String(ticks)} week ticks drawn`);
      assert.ok(bands > 0 && bands < 15, `${String(bands)} month bands drawn`);

      // Scrolled to the far end, the header there is drawn too.
      await h.page.locator('.tlx').evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await h.page.waitForTimeout(100);
      assert.ok((await h.page.locator('.tlx-scale-label').count()) > 0, 'no month at the far end');

      // A time bound only as a backstop behind the counts — generous.
      const clicked = Date.now();
      await h.page.getByRole('button', { name: 'Today', exact: true }).click();
      await group(h, 's2').locator('.tlx-chevron').click();
      await group(h, 's2').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      const click = Date.now() - clicked;
      assert.ok(click < 3000, `opening a sprint took ${String(click)} ms`);
    } finally {
      await h.close();
    }
  });
});

void describe('the unscheduled tray and the empty project (LAI-721)', () => {
  void test('the tray loads its tasks only when opened', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    const asked = taskRequests(h);
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      const tray = h.page.getByRole('button', { name: /Unscheduled/ });
      assert.equal(await tray.getAttribute('aria-expanded'), 'false');
      assert.ok(sprintCalls(h) >= 1, 'positive control: the sprints were asked for');
      assert.equal(taskCalls(h), 0, 'the tray’s tasks were fetched before it opened');
      await tray.click();
      await h.page.locator('.tlx-task', { hasText: 'Unplanned idea' }).waitFor({ timeout: 10_000 });
      assert.deepEqual(
        asked.map((q) => new URLSearchParams(q).get('sprint')),
        ['none'],
      );
    } finally {
      await h.close();
    }
  });

  void test('opening the tray does not squeeze the chart — it is the chart’s last group', async () => {
    const h = await openTimeline('/timeline?project=laika-core', 1440, STUB, 800);
    try {
      const height = () => h.page.locator('.tlx').evaluate((el) => el.clientHeight);
      const before = await height();
      await h.page.getByRole('button', { name: /Unscheduled/ }).click();
      await h.page.locator('.tlx-task', { hasText: 'Unplanned idea' }).waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page.locator('.tlx .tlx-task', { hasText: 'Unplanned idea' }).count(),
        1,
        'the tray’s tasks are outside the chart',
      );
      assert.ok((await height()) >= before - 1, `the chart shrank from ${String(before)}px`);
      assert.ok(
        await h.page.evaluate(
          () => (document.scrollingElement?.scrollHeight ?? 0) <= innerHeight + 1,
        ),
        'the page scrolls around the chart',
      );
    } finally {
      await h.close();
    }
  });

  void test('a project with no sprints says so, and still has its tray', async () => {
    const h = await open('/timeline?project=laika-core', {
      ...STUB,
      [SPRINTS]: { data: [], next_cursor: null },
    });
    try {
      await h.page
        .locator('.state-headline', { hasText: 'Nothing scheduled yet' })
        .waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('button', { name: /Unscheduled/ }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('a sprint list that fails offers a retry that works', async () => {
    // Failing until the retry is pressed — not "the first call fails": a live
    // refetch can make a second call before the error is even drawn.
    let failing = true;
    const h = await open('/timeline?project=laika-core', {
      ...STUB,
      [SPRINTS]: () =>
        failing
          ? refuse(500, 'internal', 'try later')
          : { data: [NEXT, PAST, NOW_SPRINT], next_cursor: null },
    });
    try {
      const retry = h.page.getByRole('button', { name: 'Try again' });
      await retry.waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.tlx-sprint').count(), 0, 'positive control: no rows');
      failing = false;
      await retry.click();
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.tlx-sprint').count(), 3);
    } finally {
      await h.close();
    }
  });
});

void describe('live, and the day (LAI-721 review)', () => {
  void test('an edit elsewhere lands on an open sprint’s rows', async () => {
    const tasks = [...IN_NOW];
    const stub: ApiStub = {
      ...STUB,
      [`${TASKS}?sprint=s2`]: () => ({ data: tasks, next_cursor: null }),
    };
    const h = await open('/timeline?project=laika-core', stub, { before: fakeStream });
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      await group(h, 's2').locator('.tlx-chevron').click();
      await group(h, 's2').locator('.tlx-task-title', { hasText: 'Carrier config' }).waitFor();

      // The task is renamed in the drawer — the server's stream says so.
      tasks[2] = { ...tasks[2]!, title: 'Carrier config, renamed' };
      await h.page.evaluate(() => {
        (
          window as unknown as {
            __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
          }
        ).__laikaStream.emit(
          'task.updated',
          {
            id: 'e1',
            seq: 1,
            type: 'task.updated',
            project_id: 'laika-core',
            task_id: 't1x',
            actor_id: 'u1',
            actor_kind: 'human',
            actor_token_id: null,
            payload: {},
            created_at: Date.now(),
          },
          '1',
        );
      });
      await group(h, 's2')
        .locator('.tlx-task-title', { hasText: 'Carrier config, renamed' })
        .waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  /** A live frame, as the server's stream sends one. */
  const frame = (h: Harness, seq: number) =>
    h.page.evaluate((n) => {
      (
        window as unknown as {
          __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
        }
      ).__laikaStream.emit(
        'task.updated',
        {
          id: `e${String(n)}`,
          seq: n,
          type: 'task.updated',
          project_id: 'laika-core',
          task_id: 't1',
          actor_id: 'u2',
          actor_kind: 'agent',
          actor_token_id: null,
          payload: {},
          created_at: Date.now(),
        },
        String(n),
      );
    }, seq);

  void test('a fast, steady stream still refetches while it lasts', async () => {
    const h = await open('/timeline?project=laika-core', STUB, { before: fakeStream });
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(300);
      const before = sprintCalls(h);
      // A frame every 300 ms for ~4.5 s — closer than the 500 ms settle, so a
      // debounce reset by every frame would not fire until the stream stopped.
      for (let n = 1; n <= 15; n += 1) {
        await frame(h, n);
        await h.page.waitForTimeout(300);
      }
      const during = sprintCalls(h) - before;
      assert.ok(during >= 2, `the stream starved the refetch (${String(during)} while it ran)`);
    } finally {
      await h.close();
    }
  });

  void test('refetches are at least two seconds apart', async () => {
    const h = await open('/timeline?project=laika-core', STUB, { before: fakeStream });
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(300);
      const before = sprintCalls(h);
      // A frame every 700 ms for ~4.2 s: past the 500 ms settle each time, so a
      // refetch per frame was the old behaviour.
      for (let n = 1; n <= 6; n += 1) {
        await frame(h, n);
        await h.page.waitForTimeout(700);
      }
      await h.page.waitForTimeout(600);
      const refetches = sprintCalls(h) - before;
      assert.ok(refetches >= 1, 'positive control: the stream refetched at all');
      assert.ok(refetches <= 3, `${String(refetches)} refetches in ~4.8 s`);
    } finally {
      await h.close();
    }
  });

  void test('the pill names the UTC day its line is on, wherever the browser is', async () => {
    // 23:30 UTC on Thursday 8 October — already Friday in Auckland.
    const T = Date.UTC(2026, 9, 8, 23, 30);
    const near: ApiStub = {
      ...STUB,
      [SPRINTS]: {
        data: [sprint('s2', 'Around the day', at(-5, T), at(8, T), 'active')],
        next_cursor: null,
      },
    };
    const h = await open('/timeline?project=laika-core', near, {
      before: async (page) => {
        await page.clock.setFixedTime(T);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Pacific/Auckland' });
      },
    });
    try {
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.evaluate(() => new Date().getDate()),
        9,
        'positive control: the browser’s local date is the 9th',
      );
      assert.equal(
        (await h.page.locator('.tlx-today-pill').innerText()).trim(),
        'TODAY · THU 8 OCT',
      );
    } finally {
      await h.close();
    }
  });

  void test('a past sprint is dimmed, the current one is the accent, in both themes', async () => {
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

/**
 * **The shared store, when another screen already holds the project**
 * (LAI-724 on LAI-721). Arriving from the Board, which walked the project's
 * whole set, an opened sprint is that set's tasks in the sprint — no
 * `?sprint=` request. Cold, the tests above show it reads on demand instead.
 */
void describe('the Timeline reads the task set the Board already holds (LAI-724)', () => {
  const HELD: ApiStub = {
    ...STUB,
    [`${TASKS}?limit=200`]: { data: [...IN_NOW, ...IN_NEXT, ...LOOSE], next_cursor: null },
  };

  void test('from the Board, a sprint and the tray open with no task request', async () => {
    const seen: string[] = [];
    const h = await open('/board?project=laika-core&sprint=all', HELD, {
      before: (page) => {
        page.on('request', (r) => {
          const url = new URL(r.url());
          if (url.pathname === TASKS) seen.push(url.search);
        });
        return Promise.resolve();
      },
    });
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(seen, ['?limit=200'], 'positive control: the Board walked the project');

      await h.page.locator('.view-tab', { hasText: 'Timeline' }).click();
      await h.page.locator('.tlx-sprint').first().waitFor({ timeout: 20_000 });
      seen.length = 0;

      await group(h, 's2').locator('.tlx-chevron').click();
      await group(h, 's2').locator('.tlx-task').first().waitFor({ timeout: 10_000 });
      const keys = await group(h, 's2').locator('.tlx-task .tlx-task-key').allInnerTexts();
      assert.deepEqual(keys.sort(), ['LC-1', 'LC-2', 'LC-5', 'LC-6', 'LC-9']);

      await h.page.getByRole('button', { name: /Unscheduled/ }).click();
      await h.page.locator('.tlx-task', { hasText: 'LC-4' }).first().waitFor({ timeout: 10_000 });

      await h.page.waitForTimeout(500);
      assert.deepEqual(
        seen.filter((q) => new URLSearchParams(q).has('sprint')),
        [],
        'a ?sprint= read for tasks the store already holds',
      );
    } finally {
      await h.close();
    }
  });
});
