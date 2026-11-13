import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type ApiStub, type StubCall } from './harness.ts';

/**
 * The Calendar, reworked (LAI-1178): overdue work in a lane of its own, every
 * day one height with "+N more" and the day in full, any month by ‹ Today ›,
 * ← → and the address, the toolbar's filters applied, one sprint band per
 * week, a chip dragged to a day moving its due date with Undo — and only for
 * a reader who may write tasks — and a phone's agenda with nothing sideways.
 */

const today = new Date();
/** A date-only value (D-066): the UTC midnight of the local date `days` from today. */
const dueIn = (days: number): number =>
  Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + days);
/** The local midnight a grid cell is keyed by (`data-day`), `days` from today. */
const cellAt = (days: number): number =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() + days).getTime();

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

const task = (n: number, dueOn: number | null, priority = 'p2', status = 'todo') => ({
  id: `t${String(n)}`,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task number ${String(n)} with a readable title`,
  description_md: '',
  acceptance_md: '',
  status,
  priority,
  position: null,
  assignee_id: null,
  created_by: 'u1',
  created_via: n % 4 === 0 ? 'mcp' : 'web',
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

type Task = ReturnType<typeof task>;

/** Three overdue, five due today (two of them P1), one in three days, one next month. */
function tasks(): Task[] {
  return [
    task(1, dueIn(-9), 'p1'),
    task(2, dueIn(-15)),
    task(3, dueIn(-2), 'p3'),
    task(4, dueIn(0), 'p1'),
    task(5, dueIn(0)),
    task(6, dueIn(0), 'p1'),
    task(7, dueIn(0), 'p3'),
    task(8, dueIn(0)),
    task(9, dueIn(3)),
    task(10, dueIn(40)),
  ];
}

function stub(opts: { role?: string; writes?: StubCall[]; list?: Task[] } = {}): ApiStub {
  const list = opts.list ?? tasks();
  const routes: Record<string, unknown> = {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: opts.role ?? 'owner',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 10, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks': { data: list, next_cursor: null },
    '/api/v1/projects/laika-core/sprints': {
      data: [
        {
          id: 's1',
          project_id: 'laika-core',
          name: 'Sprint Aurora',
          goal: null,
          starts_on: dueIn(-3),
          ends_on: dueIn(10),
          status: 'active',
          created_at: 1,
          updated_at: 1,
        },
      ],
      next_cursor: null,
    },
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
  };
  for (const t of list) {
    routes[`/api/v1/tasks/${t.id}`] = (call: StubCall) => {
      if (call.method === 'PATCH') opts.writes?.push(call);
      const body = (call.body ?? {}) as { due_on?: number | null };
      return { ...t, ...(body.due_on === undefined ? {} : { due_on: body.due_on }) };
    };
  }
  return routes;
}

const grid = (page: Page) => page.locator('.cal-card');
const dayCell = (page: Page, days: number) =>
  page.locator(`.cal-day[data-day="${String(cellAt(days))}"]`);
const monthParam = (page: Page): string | null => new URL(page.url()).searchParams.get('month');

void after(async () => {
  await closeBrowser();
});

void describe('the Calendar, reworked (LAI-1178)', () => {
  void test('overdue work sits in its own lane, oldest first, not on the days it missed', async () => {
    const h = await open('/calendar?project=laika-core', stub());
    try {
      const lane = h.page.locator('[data-overdue]');
      await lane.waitFor({ timeout: 20_000 });
      assert.equal((await lane.locator('.cal-overdue-count').textContent())?.trim(), '3');
      assert.deepEqual(await lane.locator('.cal-task-key').allTextContents(), [
        'LC-2',
        'LC-1',
        'LC-3',
      ]);
      for (const key of ['LC-1', 'LC-2', 'LC-3']) {
        assert.equal(await grid(h.page).locator('.cal-task', { hasText: key }).count(), 0, key);
      }
      assert.match((await h.page.locator('.space-context').textContent()) ?? '', /· 3 overdue/);
      // Folded by the reader, the count stays.
      await lane.locator('.cal-overdue-bar').click();
      assert.equal(await lane.locator('.cal-task').count(), 0);
      assert.equal((await lane.locator('.cal-overdue-count').textContent())?.trim(), '3');
    } finally {
      await h.close();
    }
  });

  void test('a busy day keeps its height: two chips, "+3 more", and the day in full', async () => {
    const h = await open('/calendar?project=laika-core', stub());
    try {
      const cell = dayCell(h.page, 0);
      await cell.locator('.cal-task').first().waitFor({ timeout: 20_000 });
      // P1 first: the two most urgent are what shows.
      assert.deepEqual(await cell.locator('.cal-task-key').allTextContents(), ['LC-4', 'LC-6']);
      const more = cell.locator('.cal-more');
      assert.equal((await more.textContent())?.trim(), '+3 more');
      const heights = await h.page
        .locator('.cal-week')
        .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
      // Every week the same height, the bands' row aside — within a band's height.
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 30, heights.join(','));
      await more.click();
      const panel = h.page.getByRole('dialog');
      await panel.waitFor();
      assert.equal(await panel.locator('.cal-task').count(), 5);
      assert.equal(await panel.locator('input[type="date"]').count(), 5);
      await h.page.keyboard.press('Escape');
      await until(async () => (await h.page.getByRole('dialog').count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('any month, by the buttons, the keys and the address', async () => {
    const h = await open('/calendar?project=laika-core', stub());
    try {
      const title = h.page.locator('[data-cal-month]');
      await title.waitFor({ timeout: 20_000 });
      const now = await title.textContent();
      assert.equal(monthParam(h.page), null);
      await h.page.getByRole('button', { name: 'Next month' }).click();
      await until(() => monthParam(h.page) !== null);
      const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      assert.equal(
        monthParam(h.page),
        `${String(next.getFullYear())}-${String(next.getMonth() + 1).padStart(2, '0')}`,
      );
      assert.notEqual(await title.textContent(), now);
      await h.page.keyboard.press('ArrowLeft');
      await until(() => monthParam(h.page) === null);
      assert.equal(await title.textContent(), now);
      await h.page.keyboard.press('ArrowLeft');
      await until(() => monthParam(h.page) !== null);
      await h.page.getByRole('button', { name: 'Today' }).click();
      await until(() => monthParam(h.page) === null);
      // Back walks the months as they were seen.
      await h.page.goBack();
      await until(() => monthParam(h.page) !== null);
    } finally {
      await h.close();
    }
  });

  void test('the toolbar’s filters apply here too', async () => {
    const h = await open('/calendar?project=laika-core&priority=p1', stub());
    try {
      await h.page.locator('[data-cal-month]').waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.cal-task').count()) > 0);
      const keys = await h.page.locator('.cal-task-key').allTextContents();
      assert.deepEqual([...new Set(keys)].sort(), ['LC-1', 'LC-4', 'LC-6']);
      assert.match((await h.page.locator('.space-context').textContent()) ?? '', /filtered/);
    } finally {
      await h.close();
    }
  });

  void test('a sprint is one band per week, named where it starts', async () => {
    const h = await open('/calendar?project=laika-core', stub());
    try {
      await h.page.locator('.cal-band').first().waitFor({ timeout: 20_000 });
      const named = await h.page.locator('.cal-band', { hasText: 'Sprint Aurora' }).count();
      assert.ok(named >= 1);
      assert.equal(
        await h.page.locator('.cal-band[data-running]').count(),
        await h.page.locator('.cal-band').count(),
      );
      assert.equal(
        await h.page.locator('.cal-sprint-tag').count(),
        0,
        'the per-cell S9 tags are back',
      );
    } finally {
      await h.close();
    }
  });

  void test('dragging a chip to a day moves its due date, and Undo puts it back', async () => {
    const writes: StubCall[] = [];
    const h = await open('/calendar?project=laika-core', stub({ writes }));
    try {
      const chip = dayCell(h.page, 3).locator('.cal-task', { hasText: 'LC-9' });
      await chip.waitFor({ timeout: 20_000 });
      assert.equal(await chip.getAttribute('draggable'), 'true');
      await chip.dragTo(dayCell(h.page, 1));
      await until(() => writes.length === 1);
      assert.deepEqual(writes[0]?.body, { due_on: dueIn(1) });
      await dayCell(h.page, 1).locator('.cal-task', { hasText: 'LC-9' }).waitFor();
      const toast = h.page.locator('.cal-toast');
      assert.match((await toast.textContent()) ?? '', /LC-9 moved to/);
      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(() => writes.length === 2);
      assert.deepEqual(writes[1]?.body, { due_on: dueIn(3) });
      await dayCell(h.page, 3).locator('.cal-task', { hasText: 'LC-9' }).waitFor();
    } finally {
      await h.close();
    }
  });

  void test('a reader who may not write tasks gets nothing to drag and no Move to', async () => {
    const h = await open('/calendar?project=laika-core', stub({ role: 'viewer' }));
    try {
      const chip = dayCell(h.page, 3).locator('.cal-task', { hasText: 'LC-9' });
      await chip.waitFor({ timeout: 20_000 });
      assert.equal(await chip.getAttribute('draggable'), 'false');
      await dayCell(h.page, 0).locator('.cal-more').click();
      await h.page.getByRole('dialog').waitFor();
      assert.equal(await h.page.getByRole('dialog').locator('input[type="date"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    void test(`390 px, ${theme}: an agenda of the days that hold work, nothing sideways`, async () => {
      const h = await open('/calendar?project=laika-core', stub(), {
        before: async (page) => {
          await page.setViewportSize({ width: 390, height: 844 });
        },
      });
      try {
        await setTheme(h.page, theme);
        const agenda = h.page.locator('[data-cal-agenda]');
        await agenda.waitFor({ timeout: 20_000 });
        assert.equal(await h.page.locator('.cal-card').count(), 0);
        assert.ok((await agenda.locator('.cal-agenda-day').count()) >= 1);
        const wide = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(wide <= 0, `the calendar scrolls ${String(wide)} px sideways at 390 px`);
      } finally {
        await h.close();
      }
    });
  }
});
