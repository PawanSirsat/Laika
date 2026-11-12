/**
 * The Calendar, refined (LAI-1200).
 *
 * The visual audit (#12) found the running sprint's days tinted the overdue
 * palette, so an ordinary week read as late and the chips that really were
 * late got lost in it. These pin the fix — a sprint is a calm band, red is for
 * overdue work only — and the rest of the refinement: a keyboard-operable
 * grid, `+N more` opening the day's whole list, a month/week switch with
 * Today, an empty period with a way on, and an agenda at phone width.
 *
 * **The clock is pinned** (CONVENTIONS §4, *a fixture may not be pinned to the
 * calendar* — "if a test genuinely needs a fixed instant, pin `now` too").
 * Overdue needs a day before today inside the grid, and keyboard moves need
 * known weekdays; anchoring to the real today would make both depend on which
 * day of the month the suite runs. `setFixedTime` fixes `Date` and leaves the
 * app's timers running.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type ApiStub, type Harness } from './harness.ts';

/** Wednesday 11 November 2026, noon local. */
const NOW = new Date(2026, 10, 11, 12, 0, 0);
/** A date-only value (D-066): the UTC midnight of a November 2026 date. */
const nov = (day: number): number => Date.UTC(2026, 10, day);
/** The grid's key for a day: its local midnight. */
const cell = (day: number, month = 10): string =>
  `[role="gridcell"][data-day="${String(new Date(2026, month, day).getTime())}"]`;

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
};

const NAMES: Readonly<Record<string, string>> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
};

const task = (n: number, status: string, dueOn: number | null, priority = 'p2') => ({
  id: `t${String(n)}`,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task ${String(n)} with a title long enough to need truncating in a narrow cell`,
  description_md: '',
  acceptance_md: '',
  status,
  // As the server sends them (LAI-739): the harness answers `st-<category>`.
  status_id: `st-${status}`,
  status_name: NAMES[status] ?? status,
  priority,
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
  due_on: dueOn,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
});

const sprint = (id: string, name: string, from: number, to: number, status: string) => ({
  id,
  project_id: 'laika-core',
  name,
  goal: null,
  starts_on: from,
  ends_on: to,
  status,
  created_at: 1,
  updated_at: 1,
});

const TASKS = [
  task(1, 'todo', nov(11)),
  // Before today and open: overdue — and inside the running sprint, so the
  // test can tell "the day is red" from "the chip is red".
  task(2, 'in_progress', nov(9), 'p1'),
  // Five on one day: more than a month cell draws.
  task(3, 'todo', nov(18)),
  task(4, 'review', nov(18), 'p1'),
  task(5, 'backlog', nov(18), 'p3'),
  task(6, 'todo', nov(18)),
  task(7, 'in_progress', nov(18)),
];

const SPRINTS = [
  sprint('s1', 'Sprint 14 — Receipts', nov(2), nov(22), 'active'),
  sprint('s2', 'Sprint 15', nov(23), Date.UTC(2026, 11, 6), 'planned'),
];

const stub = (tasks: readonly ReturnType<typeof task>[]): ApiStub => ({
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
        task_counts: { backlog: 1, todo: 3, in_progress: 2, review: 1, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: tasks, next_cursor: null },
  '/api/v1/projects/laika-core/sprints': { data: SPRINTS, next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
});

/**
 * The clock pinned, and motion off: colours are read straight after a theme
 * switch, and a chip mid-transition reads as neither theme's colour. The
 * screen honours `prefers-reduced-motion`, so this is also that path.
 */
const pinned = async (page: Page): Promise<void> => {
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
};

async function openCalendar(
  width = 1440,
  tasks: readonly ReturnType<typeof task>[] = TASKS,
): Promise<Harness> {
  const h = await open('/calendar?project=laika-core', stub(tasks), { before: pinned });
  await h.page.setViewportSize({ width, height: 900 });
  return h;
}

/** The day focus is on, as its `data-day`, or what has focus instead. */
const focusedDay = (h: Harness) =>
  h.page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute('role') === 'gridcell'
      ? (el.dataset.day ?? '')
      : `not a day: ${el?.tagName ?? 'none'}.${el?.className ?? ''}`;
  });

const dayKey = (day: number, month = 10): string => String(new Date(2026, month, day).getTime());

/** A colour as the browser computes it, for a token or any CSS colour. */
const resolve = (h: Harness, css: string) =>
  h.page.evaluate((value) => {
    const probe = document.createElement('div');
    probe.style.background = value;
    document.body.append(probe);
    const out = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return out;
  }, css);

const bg = (h: Harness, selector: string) =>
  h.page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

void after(async () => {
  await closeBrowser();
});

void describe('red means overdue, and nothing else (visual audit #12)', () => {
  for (const theme of ['dark', 'light'] as const) {
    void test(`${theme}: an ordinary sprint day is neutral; the overdue chip is flagged`, async () => {
      const h = await openCalendar();
      try {
        await h.page.locator(cell(13)).waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        // The sprint has arrived: its band is drawn on an ordinary weekday.
        await h.page.locator(`${cell(13)} .cal-band-now`).waitFor({ timeout: 10_000 });

        // Friday 13th is in the running sprint with nothing due; Thursday 26th
        // is in no running sprint. Same background — the sprint is not a tint.
        assert.equal(
          await bg(h, cell(13)),
          await bg(h, cell(26)),
          'a running-sprint day is tinted differently from an ordinary weekday',
        );
        const red = await resolve(h, 'var(--blocked-bg)');
        assert.notEqual(await bg(h, cell(13)), red, 'the sprint day took the overdue palette');
        assert.notEqual(
          await bg(h, `${cell(13)} .cal-band`),
          red,
          'the sprint band took the overdue palette',
        );

        // LC-2 was due on the 9th and is open: flagged, in words and colour.
        const late = h.page.locator('.cal-task', { hasText: 'LC-2' });
        assert.equal(await late.locator('.cal-task-flag').textContent(), 'Overdue');
        // Key, title, status and priority are all on the chip, all visible.
        for (const part of [
          '.cal-task-key',
          '.cal-task-title',
          '.cal-task-status',
          '.cal-task-pri',
        ])
          assert.ok(
            ((await late.locator(part).boundingBox())?.width ?? 0) > 0,
            `${part} is not visible on the chip`,
          );
        assert.equal(await late.locator('.cal-task-status').textContent(), 'In progress');
        assert.equal(await late.locator('.cal-task-pri').textContent(), 'P1');
        assert.equal(await bg(h, '.cal-task-overdue'), red);
        assert.match((await late.getAttribute('aria-label')) ?? '', /, overdue/);

        // LC-1 is due today: on time, not red. And a P1 that is not late
        // (LC-4) is not red either — priority is a label, not a tint.
        for (const key of ['LC-1', 'LC-4']) {
          const onTime = h.page.locator('.cal-task', { hasText: key });
          assert.equal(await onTime.locator('.cal-task-flag').count(), 0, `${key} says overdue`);
          assert.notEqual(
            await onTime.evaluate((el) => getComputedStyle(el).backgroundColor),
            red,
            `${key} is tinted red without being overdue`,
          );
        }
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the grid is driven from the keyboard', () => {
  void test('one day in the tab order; arrows, Home/End and PageUp/PageDown move it', async () => {
    const h = await openCalendar();
    try {
      await h.page.locator(cell(11)).waitFor({ timeout: 20_000 });

      // Roving tabindex: exactly one stop, and it is today.
      const stops = h.page.locator('[role="gridcell"][tabindex="0"]');
      assert.equal(await stops.count(), 1);
      assert.equal(await stops.getAttribute('data-day'), dayKey(11));
      assert.equal(await h.page.locator(cell(11)).getAttribute('aria-current'), 'date');

      await stops.focus();
      const press = async (key: string, want: string) => {
        await h.page.keyboard.press(key);
        await until(async () => (await focusedDay(h)) === want, 3_000).catch(() => undefined);
        assert.equal(await focusedDay(h), want, `${key} did not reach ${want}`);
      };
      await press('ArrowRight', dayKey(12));
      await press('ArrowDown', dayKey(19));
      await press('Home', dayKey(16)); // Monday of that week
      await press('End', dayKey(22)); // Sunday of that week
      await press('ArrowLeft', dayKey(21));
      await press('ArrowUp', dayKey(14));

      // PageDown: the same day next month, and the grid follows.
      await press('PageDown', dayKey(14, 11));
      assert.equal(await h.page.locator('.cal-title').textContent(), 'December 2026');
      assert.equal(await h.page.locator('[role="gridcell"][tabindex="0"]').count(), 1);
      await press('PageUp', dayKey(14));
      assert.equal(await h.page.locator('.cal-title').textContent(), 'November 2026');

      // Arrowing past the grid's edge pages it rather than stopping.
      await h.page.locator(cell(30)).focus();
      await press('ArrowDown', dayKey(7, 11));
      assert.equal(await h.page.locator('.cal-title').textContent(), 'December 2026');
    } finally {
      await h.close();
    }
  });

  void test('each day names itself, its tasks and what is overdue', async () => {
    const h = await openCalendar();
    try {
      await h.page
        .locator(`${cell(18)} .cal-task`)
        .first()
        .waitFor({ timeout: 20_000 });
      const label = (day: number) => h.page.locator(cell(day)).getAttribute('aria-label');
      assert.match((await label(18)) ?? '', /^Wednesday 18 November, 5 tasks\b/);
      assert.match((await label(9)) ?? '', /^Monday 9 November, 1 task, 1 overdue\b/);
      assert.match((await label(11)) ?? '', /^Wednesday 11 November, today, 1 task\b/);
      assert.match((await label(13)) ?? '', /^Friday 13 November, no tasks, S1 Sprint 14/);
    } finally {
      await h.close();
    }
  });

  void test('Enter on a day with one task opens it', async () => {
    const h = await openCalendar();
    try {
      await h.page.locator(`${cell(11)} .cal-task`).waitFor({ timeout: 20_000 });
      await h.page.locator(cell(11)).focus();
      await h.page.keyboard.press('Enter');
      await h.page.waitForURL(/task=t1\b/, { timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('a busy day says +N more and opens its whole list', () => {
  void test('two chips and +3 more; the list holds all five; Escape returns to the day', async () => {
    const h = await openCalendar();
    try {
      const day = h.page.locator(cell(18));
      await day.locator('.cal-task').first().waitFor({ timeout: 20_000 });
      assert.equal(await day.locator('.cal-task').count(), 2);
      const more = day.locator('.cal-more');
      assert.equal((await more.textContent())?.trim(), '+3 more');

      await more.click();
      const list = h.page.getByRole('dialog', { name: /^Tasks due Wednesday 18 November/ });
      await list.waitFor({ timeout: 5_000 });
      assert.equal(await list.locator('.cal-task').count(), 5);
      assert.equal(
        await list
          .locator('.cal-task')
          .first()
          .evaluate((el) => el === document.activeElement),
        true,
        'focus did not move into the list',
      );

      await h.page.keyboard.press('Escape');
      await list.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await focusedDay(h), dayKey(18));

      // The same list from the keyboard: Enter on the busy day.
      await h.page.keyboard.press('Enter');
      await list.waitFor({ timeout: 5_000 });
      assert.equal(await list.locator('.cal-task').count(), 5);
    } finally {
      await h.close();
    }
  });

  void test('no chip overflows its day', async () => {
    const h = await openCalendar();
    try {
      await h.page
        .locator(`${cell(18)} .cal-task`)
        .first()
        .waitFor({ timeout: 20_000 });
      const spills = await h.page.$$eval('.cal-day .cal-task', (chips) =>
        chips.flatMap((chip) => {
          const day = chip.closest('.cal-day');
          if (day === null) return ['a chip outside a day'];
          const c = chip.getBoundingClientRect();
          const d = day.getBoundingClientRect();
          const out: string[] = [];
          if (c.right > d.right + 0.5 || c.left < d.left - 0.5)
            out.push(`${chip.textContent ?? ''} leaves its day`);
          for (const line of chip.querySelectorAll('.cal-task-line'))
            if (line.scrollWidth > line.clientWidth + 1)
              out.push(`${chip.textContent ?? ''} overflows its line`);
          return out;
        }),
      );
      assert.deepEqual(spills, []);
    } finally {
      await h.close();
    }
  });
});

void describe('month, week and today', () => {
  void test('the switch and Today are labelled, and move the grid', async () => {
    const h = await openCalendar();
    try {
      await h.page.locator(cell(11)).waitFor({ timeout: 20_000 });
      const today = h.page.getByRole('button', { name: /^Today, Wednesday/ });
      assert.equal(await today.isDisabled(), true, 'Today is live while on today');

      await h.page
        .getByRole('group', { name: 'Calendar view' })
        .getByRole('button', { name: 'Week' })
        .click();
      await until(async () => (await h.page.locator('[role="gridcell"]').count()) === 7);
      assert.equal(await h.page.locator('[role="gridcell"]').count(), 7);
      assert.match((await h.page.locator('.cal-title').textContent()) ?? '', /^Week 46 · /);

      await h.page.getByRole('button', { name: 'Next week' }).click();
      assert.match((await h.page.locator('.cal-title').textContent()) ?? '', /^Week 47 · /);
      // A week view draws every task on the day, with no +N more.
      assert.equal(await h.page.locator(`${cell(18)} .cal-task`).count(), 5);
      assert.equal(await h.page.locator('.cal-more').count(), 0);

      assert.equal(await today.isDisabled(), false);
      await today.click();
      assert.match((await h.page.locator('.cal-title').textContent()) ?? '', /^Week 46 · /);
    } finally {
      await h.close();
    }
  });

  void test('an empty month says so, neutrally, and offers the way back to work', async () => {
    const h = await openCalendar();
    try {
      await h.page.locator(cell(11)).waitFor({ timeout: 20_000 });
      const next = h.page.getByRole('button', { name: 'Next month' });
      await next.click();
      await next.click();
      assert.equal(await h.page.locator('.cal-title').textContent(), 'January 2027');

      const empty = h.page.locator('.cal-empty');
      await empty.waitFor({ timeout: 5_000 });
      assert.equal(await empty.locator('.cal-empty-title').textContent(), 'Nothing due this month');
      assert.notEqual(await bg(h, '.cal-empty'), await resolve(h, 'var(--blocked-bg)'));

      await empty.getByRole('button', { name: /^Go to the last due date/ }).click();
      assert.equal(await h.page.locator('.cal-title').textContent(), 'November 2026');
      assert.equal(await h.page.locator('.cal-empty').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('at phone width the period is an agenda', () => {
  for (const theme of ['dark', 'light'] as const) {
    void test(`${theme}: 390px draws the days with work as a list, not a squeezed grid`, async () => {
      const h = await openCalendar(390);
      try {
        const agenda = h.page.locator('.cal-agenda');
        await agenda.waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        assert.equal(await h.page.locator('[role="grid"]').count(), 0, 'the grid is still drawn');

        // Today, then every day with work, in order: 9th, 11th (today), 18th.
        const dates = await agenda.locator('.cal-agenda-day').count();
        assert.equal(dates, 3);
        assert.equal(
          await agenda.locator('.cal-agenda-today .cal-agenda-badge').textContent(),
          'Today',
        );
        assert.equal(await agenda.locator('.cal-task').count(), 7);
        // In the tab order: a list has no roving stop to hand them out.
        assert.equal(await agenda.locator('.cal-task[tabindex="-1"]').count(), 0);
        assert.equal(await agenda.locator('.cal-task-overdue').count(), 1);

        // Nothing in the calendar body scrolls sideways.
        const sideways = await h.page
          .locator('.cal')
          .evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(sideways <= 0, `the calendar body is ${String(sideways)}px too wide`);
      } finally {
        await h.close();
      }
    });
  }
});
