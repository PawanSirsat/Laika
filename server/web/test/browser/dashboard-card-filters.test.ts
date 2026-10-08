/**
 * The Dashboard's range reaches Status overview and Work by person, and each
 * card has a filter of its own (LAI-732).
 *
 * The owner, on the production Dashboard: the range buttons changed the stat
 * cards *"but not this section in the status overview and the work by person
 * section"*, and *"add more filter in that … in compact popup"*. A card now
 * counts the tasks **updated** within the range (the "N updated" stat's rule)
 * and says so in its subtitle; each has an icon that opens a compact popover,
 * its choices kept in the URL under its own prefix.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const task = (n: number, over: Record<string, unknown>) => ({
  id: `t${String(n)}`,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task ${String(n)}`,
  description_md: '',
  acceptance_md: '',
  status: 'todo',
  priority: 'p2',
  position: null,
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
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
  created_at: NOW - 60 * DAY,
  updated_at: NOW - HOUR,
  started_at: null,
  completed_at: null,
  ...over,
});

/*
 * Four touched this week (one cancelled), three forty days ago. Under the
 * default 7 days the Status overview counts 3 live tasks and Work by person 2
 * open ones; under All time, 6 and 4.
 */
const TASKS = [
  task(1, {
    status: 'in_progress',
    assignee_id: 'u1',
    priority: 'p1',
    tags: ['api'],
    sprint_id: 's1',
  }),
  task(2, {
    status: 'done',
    assignee_id: 'u1',
    priority: 'p1',
    sprint_id: 's1',
    created_via: 'mcp',
  }),
  task(3, { status: 'todo', updated_at: NOW - 2 * DAY, tags: ['web'], sprint_id: 's2' }),
  task(4, { status: 'cancelled', assignee_id: 'u2' }),
  task(5, {
    status: 'review',
    assignee_id: 'u2',
    priority: 'p1',
    tags: ['api'],
    sprint_id: 's1',
    updated_at: NOW - 40 * DAY,
  }),
  task(6, { status: 'backlog', updated_at: NOW - 40 * DAY }),
  task(7, { status: 'done', assignee_id: 'u2', sprint_id: 's2', updated_at: NOW - 40 * DAY }),
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
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: 1, todo: 1, in_progress: 1, review: 1, done: 2, cancelled: 1 },
        blocked_count: 0,
        member_count: 2,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: TASKS, next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead', created_at: 1 },
      {
        user_id: 'u2',
        name: 'Grace Hopper',
        email: 'g@example.com',
        role: 'member',
        created_at: 1,
      },
    ],
  },
  '/api/v1/projects/laika-core/mentionable': { users: [] },
  '/api/v1/projects/laika-core/sprints': {
    data: [
      {
        id: 's1',
        project_id: 'laika-core',
        name: 'Foundations',
        goal: null,
        status: 'active',
        starts_on: NOW - 3 * DAY,
        ends_on: NOW + 10 * DAY,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 's2',
        project_id: 'laika-core',
        name: 'Polish',
        goal: null,
        status: 'planned',
        starts_on: NOW + 11 * DAY,
        ends_on: NOW + 20 * DAY,
        created_at: 1,
        updated_at: 1,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/metrics': {
    since: NOW - 7 * DAY,
    throughput: [],
    cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null, p90_ms: null },
  },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

const STATUS = '.dash-status';
const PEOPLE = '.dash-people';

async function ready(page: Page): Promise<void> {
  await page.locator(`${STATUS} .dash-card-meta`).waitFor({ timeout: 20_000 });
  await page.locator(`${PEOPLE} .dash-card-meta`).waitFor({ timeout: 10_000 });
}

const meta = async (page: Page, card: string): Promise<string> =>
  ((await page.locator(`${card} .dash-card-meta`).textContent()) ?? '').trim();

const centre = async (page: Page, card: string): Promise<string> =>
  ((await page.locator(`${card} .donut-value`).textContent()) ?? '').trim();

const badge = async (page: Page, card: string): Promise<string | null> => {
  const b = page.locator(`${card} .dcf-badge`);
  return (await b.count()) === 0 ? null : ((await b.textContent()) ?? '').trim();
};

const param = (page: Page, key: string): string | null => new URL(page.url()).searchParams.get(key);

async function openPop(page: Page, card: string): Promise<void> {
  await page.locator(`${card} .dcf-button`).click();
  await page.locator(`${card} .dcf-pop`).waitFor({ timeout: 5_000 });
}

const field = (page: Page, card: string, label: string) =>
  page.locator(`${card} .dcf-pop .dcf-field`, { hasText: label }).locator('select');

void after(async () => {
  await closeBrowser();
});

void describe('the range reaches both cards', () => {
  void test('7 days counts tasks updated within it, and All time is the whole project', async () => {
    const h = await open('/dashboard?project=laika-core', STUB);
    try {
      await ready(h.page);
      // The default range is 7 days.
      assert.equal(await meta(h.page, STATUS), '3 tasks updated in the last 7 days');
      assert.equal(await centre(h.page, PEOPLE), '2');
      assert.match(await meta(h.page, PEOPLE), /open work updated in the last 7 days$/);
      assert.match(
        (await h.page.locator(`${STATUS} .dash-card-foot`).textContent()) ?? '',
        /1 cancelled, not counted in the 3/,
      );

      await h.page.locator('.dash-range', { hasText: 'All time' }).click();
      await h.page.waitForFunction(
        (sel) => document.querySelector(sel)?.textContent?.trim() === '6 tasks',
        `${STATUS} .dash-card-meta`,
        { timeout: 10_000 },
      );
      assert.equal(await centre(h.page, PEOPLE), '4');
      assert.equal(await meta(h.page, PEOPLE), '2 people · open work', 'All time is today’s card');
      assert.equal(await h.page.locator(`${PEOPLE} [data-person="unassigned"]`).textContent(), '2');
    } finally {
      await h.close();
    }
  });
});

void describe('the Status overview filter', () => {
  void test('opens, takes focus, filters, counts, writes the URL, clears, and closes on Escape', async () => {
    const h = await open('/dashboard?project=laika-core&range=all', STUB);
    try {
      await ready(h.page);
      assert.equal(await badge(h.page, STATUS), null, 'positive control: nothing set');

      await openPop(h.page, STATUS);
      assert.equal(
        await h.page.evaluate(
          () =>
            document.querySelector('.dash-status .dcf-pop')?.contains(document.activeElement) ===
            true,
        ),
        true,
        'focus did not move into the popover',
      );

      await field(h.page, STATUS, 'Priority').selectOption('p1');
      await h.page.waitForFunction(
        () => new URL(location.href).searchParams.get('so_priority') === 'p1',
      );
      // p1 over All time: LC-1, LC-2, LC-5 — 3 live tasks.
      await h.page.waitForFunction(
        (sel) => document.querySelector(sel)?.textContent?.trim() === '3 tasks · 1 filter',
        `${STATUS} .dash-card-meta`,
        { timeout: 5_000 },
      );
      assert.equal(await badge(h.page, STATUS), '1');
      assert.equal(await badge(h.page, PEOPLE), null, 'the other card was filtered');

      await field(h.page, STATUS, 'Sprint').selectOption('active');
      await h.page.waitForFunction(
        (sel) => document.querySelector(sel)?.textContent?.trim() === '3 tasks · 2 filters',
        `${STATUS} .dash-card-meta`,
      );
      assert.equal(param(h.page, 'so_sprint'), 'active');

      await h.page.locator(`${STATUS} .dcf-clear`).click();
      await h.page.waitForFunction(() => !new URL(location.href).search.includes('so_'));
      assert.equal(await meta(h.page, STATUS), '6 tasks');
      assert.equal(await badge(h.page, STATUS), null);

      await h.page.keyboard.press('Escape');
      await h.page.locator(`${STATUS} .dcf-pop`).waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(
        await h.page.evaluate(
          () => document.activeElement?.classList.contains('dcf-button') === true,
        ),
        true,
        'Escape did not hand focus back to the icon',
      );
    } finally {
      await h.close();
    }
  });

  void test('a click outside closes it', async () => {
    const h = await open('/dashboard?project=laika-core', STUB);
    try {
      await ready(h.page);
      await openPop(h.page, STATUS);
      await h.page.locator('.dash-ranges').click({ position: { x: 2, y: 2 } });
      await h.page.locator(`${STATUS} .dcf-pop`).waitFor({ state: 'detached', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('"All tasks" ignores the dashboard range, and says so', async () => {
    const h = await open('/dashboard?project=laika-core&so_range=all', STUB);
    try {
      await ready(h.page);
      assert.equal(await meta(h.page, STATUS), '6 tasks · all time');
      assert.equal(await badge(h.page, STATUS), '1');
      // The other card still follows the 7 days.
      assert.equal(await centre(h.page, PEOPLE), '2');
    } finally {
      await h.close();
    }
  });
});

void describe('the Work by person filter', () => {
  void test('kept in the URL: a shared link opens filtered, and Include done counts finished work', async () => {
    const h = await open(
      '/dashboard?project=laika-core&range=all&wp_status=all&wp_priority=p1',
      STUB,
    );
    try {
      await ready(h.page);
      // p1, open and done: LC-1 and LC-2 (Ada), LC-5 (Grace).
      assert.equal(await centre(h.page, PEOPLE), '3');
      assert.equal(await badge(h.page, PEOPLE), '2');
      assert.equal(await meta(h.page, PEOPLE), '2 people · open and done work · 2 filters');
      assert.match(
        (await h.page
          .locator(`${PEOPLE} .dash-legend-row`, { hasText: 'Ada Lovelace' })
          .textContent()) ?? '',
        /1 done/,
      );

      await h.page.reload();
      await ready(h.page);
      assert.equal(await centre(h.page, PEOPLE), '3', 'a refresh lost the card’s filter');

      await openPop(h.page, PEOPLE);
      assert.equal(await field(h.page, PEOPLE, 'Statuses').inputValue(), 'all');
      await field(h.page, PEOPLE, 'Statuses').selectOption('');
      await h.page.waitForFunction(
        () => new URL(location.href).searchParams.get('wp_status') === null,
      );
      assert.equal(await centre(h.page, PEOPLE), '2', 'open only: LC-1 and LC-5');
    } finally {
      await h.close();
    }
  });

  void test('an invalid value is ignored and not counted (LAI-487)', async () => {
    // One valid value per card beside the invalid ones, so "not counted" is
    // measured against something that is: each badge says 1, not 0 and not 3.
    const h = await open(
      '/dashboard?project=laika-core&range=all&so_tag=api&so_priority=p9&so_sprint=nope' +
        '&wp_priority=p1&wp_status=bogus&wp_tag=-x',
      STUB,
    );
    try {
      await ready(h.page);
      assert.equal(await badge(h.page, STATUS), '1');
      assert.equal(await badge(h.page, PEOPLE), '1');
      // api: LC-1 and LC-5. p1, open: LC-1 and LC-5.
      assert.equal(await meta(h.page, STATUS), '2 tasks · 1 filter');
      assert.equal(await centre(h.page, PEOPLE), '2');
    } finally {
      await h.close();
    }
  });
});

void describe('both themes', () => {
  void test('the open popover draws from the theme in light and in dark', async () => {
    const h = await open('/dashboard?project=laika-core&so_priority=p1', STUB);
    try {
      await ready(h.page);
      const looks: string[] = [];
      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        await openPop(h.page, STATUS);
        looks.push(
          await h.page
            .locator(`${STATUS} .dcf-pop`)
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        const set = h.page.locator(`${STATUS} .dcf-field-set .dcf-label`);
        assert.equal(await set.count(), 1, 'the set field is not marked');
        await h.page.keyboard.press('Escape');
      }
      assert.notEqual(looks[0], looks[1], 'the popover looks the same in both themes');
    } finally {
      await h.close();
    }
  });
});
