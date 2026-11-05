import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, refuse, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { SETTINGS, viewOf, weekData, weekStub } from './my-day-week.ts';

/**
 * My day with time tracking off (LAI-1141, the UX audit's V2), and a re-read
 * that fails (B7). Off, the page is the reader's open work — overdue, due
 * soon, in progress, the rest — each opening in its own space, under a note
 * whose way to the setting is only for a reader holding `org.time.set`.
 */

const SHOTS = process.env.LAIKA_SHOTS;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIDNIGHT = Date.parse(`${TODAY}T00:00:00Z`);

function task(
  id: string,
  key: string,
  title: string,
  status: string,
  project: 'p1' | 'p2',
  due: number | null,
  updated: number,
) {
  return {
    id,
    key,
    title,
    status,
    status_id: `st-${status}`,
    status_name: status === 'in_progress' ? 'In progress' : status === 'todo' ? 'To do' : status,
    project_id: project,
    number: Number(key.split('-')[1]),
    priority: 'p2',
    assignee_id: 'u1',
    sprint_id: null,
    due_on: due,
    blocked_by: [],
    blocks: [],
    updated_at: updated,
  };
}

/** Across two spaces, in an order the page must not keep. */
const OPEN = {
  in_progress: [
    task('t31', 'LAI-31', 'Wire the exporter', 'in_progress', 'p1', null, 900),
    task('t32', 'ORB-32', 'Due in three days', 'in_progress', 'p2', MIDNIGHT + 3 * DAY_MS, 100),
  ],
  review: [],
  todo: [
    task('t33', 'ORB-33', 'Two days late', 'todo', 'p2', MIDNIGHT - 2 * DAY_MS, 50),
    task('t34', 'LAI-34', 'Due next month', 'todo', 'p1', MIDNIGHT + 30 * DAY_MS, 800),
  ],
  backlog: [task('t35', 'LAI-35', 'Five days late', 'backlog', 'p1', MIDNIGHT - 5 * DAY_MS, 10)],
} as const;

/** A space as `GET /projects` serves it — the shell reads all of this. */
const space = (id: string, slug: string, prefix: string, name: string) => ({
  id,
  slug,
  prefix,
  name,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
});

interface Opts {
  readonly role?: 'owner' | 'member';
}

function offStub({ role = 'owner' }: Opts = {}): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as Record<string, unknown>),
    settings: { ...SETTINGS, org_mode: 'off', drafting: false },
  });
  routes['/api/v1/me'] = {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: role,
    is_active: true,
    memberships: [
      { project_id: 'p1', role: 'member' },
      { project_id: 'p2', role: 'member' },
    ],
  };
  routes['/api/v1/projects'] = {
    data: [space('p1', 'atlas', 'LAI', 'Atlas'), space('p2', 'orbit', 'ORB', 'Orbit')],
    next_cursor: null,
  };
  routes['/api/v1/org'] = { id: 'o1', name: 'Kvelld' };
  for (const [status, data] of Object.entries(OPEN)) {
    routes[`/api/v1/tasks?assignee=u1&status=${status}`] = { data, next_cursor: null };
  }
  return routes;
}

async function openOff(opts: Opts = {}, width = 1440): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, offStub(opts), {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
  await h.page.locator('[data-off-plate-list]').waitFor({ timeout: 20_000 });
  return h;
}

async function shoot(h: Harness, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await h.page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

after(async () => {
  await closeBrowser();
});

void describe('My day with time tracking off (LAI-1141)', () => {
  void test('lists your open work, overdue first, then due soon, then in progress, then the rest', async () => {
    const h = await openOff();
    try {
      const rows = h.page.locator('[data-off-plate-list] > li[data-off-plate-row]');
      const keys = await rows.locator('.plate-key').allInnerTexts();
      assert.deepEqual(keys, ['LAI-35', 'ORB-33', 'ORB-32', 'LAI-31', 'LAI-34']);
      assert.deepEqual(
        await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-off-plate-row'))),
        ['overdue', 'overdue', 'soon', 'progress', 'open'],
      );
      assert.match(await rows.nth(0).innerText(), /Overdue/);
      assert.match(await h.page.locator('[data-off-plate-count]').innerText(), /^5 open$/);
      // The note says so in one line, and the page has nothing that does nothing.
      assert.match(
        await h.page.locator('[data-day-off]').innerText(),
        /Time tracking is off for Kvelld/,
      );
      for (const sel of [
        '[data-add-time]',
        '[data-timer-start]',
        '[data-confirm-day]',
        '[data-day-settings]',
        '[data-who-looked]',
        '[data-who-can-see]',
        '[data-shortcuts-button]',
        '.myday-week',
        '[data-day-total]',
        '[data-dayline]',
      ]) {
        assert.equal(await h.page.locator(sel).count(), 0, `${sel} is drawn with tracking off`);
      }
    } finally {
      await h.close();
    }
  });

  void test('a row opens the task in its own space', async () => {
    const h = await openOff();
    try {
      const row = h.page.locator('[data-off-plate-row]').filter({ hasText: 'ORB-33' });
      assert.equal(
        await row.locator('a.plate-item').getAttribute('href'),
        '/board?project=orbit&task=t33',
      );
      await row.locator('a.plate-item').click();
      await h.page.waitForURL(
        (url) =>
          url.pathname === '/board' &&
          url.searchParams.get('project') === 'orbit' &&
          url.searchParams.get('task') === 't33',
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('the way to the setting is there for a reader holding org.time.set', async () => {
    const h = await openOff({ role: 'owner' });
    try {
      const link = h.page.locator('[data-day-off-settings]');
      assert.equal(await link.count(), 1);
      await link.click();
      await h.page.waitForURL((url) => url.pathname === '/organisation', { timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('and not for a reader without it', async () => {
    const h = await openOff({ role: 'member' });
    try {
      await h.page.locator('[data-day-off]').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-day-off-settings]').count(), 0);
      assert.doesNotMatch(await h.page.locator('[data-day-off]').innerText(), /settings/i);
    } finally {
      await h.close();
    }
  });

  void test('at 390: the work, with no week strip and no “nothing yet”', async () => {
    const h = await openOff({}, 390);
    try {
      assert.equal(await h.page.locator('[data-off-plate-row]').count(), 5);
      for (const sel of ['[data-phone-week]', '[data-phone-summary]', '[data-day-nav]']) {
        assert.equal(await h.page.locator(sel).count(), 0, `${sel} is drawn with tracking off`);
      }
      assert.doesNotMatch(await h.page.locator('.myday-page').innerText(), /nothing yet/);
      const overflow = await h.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.equal(overflow, 0, 'the page scrolls sideways at 390');
    } finally {
      await h.close();
    }
  });

  if (SHOTS !== undefined) {
    for (const theme of ['dark', 'light'] as const) {
      for (const width of [1440, 390] as const) {
        void test(`screenshot: ${theme} ${String(width)}`, async () => {
          const h = await openOff({}, width);
          try {
            await setTheme(h.page, theme);
            await shoot(h, `my-day-off-${String(width)}-${theme}`);
          } finally {
            await h.close();
          }
        });
      }
    }
  }
});

void describe('a re-read that fails keeps the day (LAI-1141, B7)', () => {
  void test('the day stays, under a stale notice whose Retry reads it again', async () => {
    const data = weekData();
    const routes: Record<string, unknown> = { ...weekStub(data) };
    let failing = false;
    let reads = 0;
    routes[`/api/v1/me/time?day=${TODAY}`] = () => {
      reads += 1;
      if (failing) return refuse(503, 'unavailable', 'The server is restarting.');
      return {
        ...(viewOf(TODAY, data) as Record<string, unknown>),
        settings: { ...SETTINGS, draft_my_time: false },
      };
    };
    routes['/api/v1/me/time-settings'] = { ...SETTINGS, draft_my_time: true };
    const h = await open(`/my-day?day=${TODAY}`, routes, {
      before: async (page) => {
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    });
    try {
      await h.page.locator('[data-draft-off]').waitFor({ timeout: 20_000 });
      failing = true;
      // A write re-reads the day; this one's re-read fails.
      await h.page.locator('[data-draft-off]').getByRole('button', { name: 'Turn on' }).click();
      const stale = h.page.locator('[data-day-stale]');
      await stale.waitFor({ timeout: 10_000 });
      assert.match(await stale.innerText(), /Couldn’t refresh/);
      assert.match(await stale.innerText(), /The server is restarting\./);
      // The day is still the page, not the error card.
      assert.equal(await h.page.locator('[data-day-error]').count(), 0);
      assert.equal(await h.page.locator('[data-myday-ready]').count(), 1);
      assert.equal(await h.page.locator('[data-dayline]').count(), 1);

      failing = false;
      const before = reads;
      await stale.getByRole('button', { name: 'Retry' }).click();
      await until(() => reads > before);
      await until(async () => (await stale.count()) === 0, 10_000);
      assert.equal(await stale.count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a day never read is still the error card', async () => {
    const routes: Record<string, unknown> = { ...weekStub() };
    routes[`/api/v1/me/time?day=${TODAY}`] = refuse(503, 'unavailable', 'Down.');
    const h = await open(`/my-day?day=${TODAY}`, routes);
    try {
      await h.page.locator('[data-day-error]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-day-stale]').count(), 0);
    } finally {
      await h.close();
    }
  });
});
