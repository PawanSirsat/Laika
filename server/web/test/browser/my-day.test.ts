/**
 * My day, laid out after the owner's reference (LAI-796), in a real browser:
 * the week and *Confirm day* in the header, the day as a bar above its two
 * lists, and beside it *On your plate*, *Agent minutes* and *Draft my time* —
 * in two columns on a laptop and one on a phone, in both themes.
 *
 * The day is **today, computed at run time** in UTC (CONVENTIONS: a fixture
 * may not be pinned to the calendar), so the now line is drawn.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';

const TODAY = new Date().toISOString().slice(0, 10);
const MIDNIGHT = Date.parse(`${TODAY}T00:00:00Z`);
const at = (h: number, m = 0): number => MIDNIGHT + (h * 60 + m) * 60_000;

const signals = { prompts: 4, replies: 3, sessions: 1, commits: 2, marks: 0 };

const DAY = {
  day: TODAY,
  tz: 'UTC',
  today: TODAY,
  settings: { org_mode: 'drafts', draft_my_time: true, drafting: true, min_sync_interval_s: 300 },
  drafts: [
    {
      id: 'd1',
      source: 'collector',
      day: TODAY,
      tz: 'UTC',
      started_at: at(8, 40),
      ended_at: at(10, 15),
      minutes: 95,
      task: { id: 't1', key: 'LAI-1', title: 'Search matches keys' },
      task_key: null,
      project: null,
      general: false,
      signals,
      note: null,
    },
  ],
  entries: [
    {
      id: 'e1',
      day: TODAY,
      tz: 'UTC',
      started_at: at(11, 30),
      ended_at: at(12),
      minutes: 30,
      source: 'manual',
      task: null,
      project: null,
      note: 'Standup',
      revision: 1,
      created_at: 1,
      updated_at: 1,
    },
    {
      id: 'e2',
      day: TODAY,
      tz: 'UTC',
      started_at: null,
      ended_at: null,
      minutes: 45,
      source: 'manual',
      task: null,
      project: null,
      note: 'A call',
      revision: 1,
      created_at: 1,
      updated_at: 1,
    },
  ],
  agent: { minutes: 54, keyboard_minutes: 12, by_task: [], unattributed_minutes: 0 },
  state: 'drafted',
  week: Array.from({ length: 7 }, (_, i) => {
    const weekday = (new Date(MIDNIGHT).getUTCDay() + 6) % 7;
    const day = new Date(MIDNIGHT + (i - weekday) * 86_400_000).toISOString().slice(0, 10);
    return {
      day,
      confirmed_minutes: day === TODAY ? 75 : 0,
      drafted_minutes: day === TODAY ? 95 : 0,
      state: day === TODAY ? 'drafted' : day < TODAY ? 'no_signal' : 'future',
    };
  }),
};

function task(id: string, key: string, title: string, status: string, blockedBy: string[] = []) {
  return {
    id,
    key,
    title,
    status,
    status_id: `st-${status}`,
    status_name: status,
    project_id: 'p1',
    number: 1,
    priority: 'p2',
    assignee_id: 'u1',
    blocked_by: blockedBy,
    blocks: [],
    updated_at: 5,
  };
}

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/me/time': DAY,
  '/api/v1/projects': {
    data: [
      {
        id: 'p1',
        slug: 'atlas',
        prefix: 'LAI',
        name: 'Atlas',
        archived_at: null,
        task_counts: { backlog: 0, todo: 1, in_progress: 1, review: 0, done: 0, cancelled: 0 },
        member_count: 1,
        members: [],
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/atlas/tasks?assignee=u1&status=in_progress': {
    data: [task('t1', 'LAI-1', 'Search matches keys', 'in_progress')],
    next_cursor: null,
  },
  '/api/v1/projects/atlas/tasks?assignee=u1&status=todo': {
    data: [task('t3', 'LAI-3', 'Empty states', 'todo', ['t9'])],
    next_cursor: null,
  },
  '/api/v1/tasks/t9': task('t9', 'LAI-9', 'The blocker', 'in_progress'),
  '/api/v1/review': {
    tasks: [
      {
        task: task('t4', 'LAI-4', 'Webhook retries', 'review'),
        project: { id: 'p1', slug: 'atlas', name: 'Atlas', prefix: 'LAI' },
        assignee_name: null,
        waiting_since: 1,
        round: {
          ci: { head_sha: 'a', total: 2, passed: 2, failed: 0, pending: 0, failed_names: [] },
        },
        finished_by_name: null,
        can_decide: true,
        cue: null,
      },
    ],
    truncated: false,
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('My day after the reference', () => {
  void test('the header carries the week and Confirm day with the drafted total', async () => {
    const h = await open('/my-day', STUB);
    try {
      const head = h.page.locator('.screen-page');
      await head.locator('.myday-week').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.screen-page-title').innerText(), 'My day');
      assert.match(await head.innerText(), /yours only/);
      assert.match(
        await head.locator('.myday-chip-primary').innerText(),
        /Confirm day · 1:35/,
        'Confirm day does not say what it confirms',
      );
      assert.equal(await head.getByRole('button', { name: 'Previous week' }).count(), 1);
      assert.equal(await head.getByRole('button', { name: 'Next week' }).count(), 1);
      assert.equal(await head.locator('.myday-week-day').count(), 7);
    } finally {
      await h.close();
    }
  });

  void test('the day is a bar of confirmed and drafted blocks, with a line at now', async () => {
    const h = await open('/my-day', STUB);
    try {
      const track = h.page.locator('.dayline-track');
      await track.waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.dayline-confirmed').count(), 1);
      assert.equal(await h.page.locator('.dayline-drafted').count(), 1);
      assert.equal(await h.page.locator('.dayline-now').count(), 1, 'today has no now line');
      // The untimed call is not placed somewhere invented; it is counted.
      assert.match(await h.page.locator('.dayline-untimed').innerText(), /1 block has no set time/);

      // Inside the track, in the order of the day.
      const box = await track.boundingBox();
      const drafted = await h.page.locator('.dayline-drafted').boundingBox();
      const confirmed = await h.page.locator('.dayline-confirmed').boundingBox();
      assert.ok(box && drafted && confirmed);
      for (const b of [drafted, confirmed]) {
        assert.ok(b.x >= box.x - 1 && b.x + b.width <= box.x + box.width + 1, 'a block escapes');
        assert.ok(b.width > 2, 'a block has no width');
      }
      assert.ok(drafted.x < confirmed.x, '08:40 is drawn after 11:30');

      // Drafted, then confirmed, then Add time — the lists the bar pictures.
      const order = await h.page
        .locator('.myday-main')
        .evaluate((el: Element) => el.textContent ?? '');
      const drafts = order.indexOf('Drafted — not yet confirmed');
      const confirmedAt = order.indexOf('Confirmed', drafts + 1);
      const add = order.indexOf('Add time');
      assert.ok(
        drafts > -1 && confirmedAt > drafts && add > confirmedAt,
        'the lists are out of order',
      );
    } finally {
      await h.close();
    }
  });

  void test('On your plate: in progress, waiting on your review, blocked — each a link', async () => {
    const h = await open('/my-day', STUB);
    try {
      const plate = h.page.locator('.myday-plate');
      await plate.locator('.plate-groups').waitFor({ timeout: 20_000 });
      const group = (id: string) => plate.locator(`[data-plate="${id}"]`);
      assert.match(await group('progress').innerText(), /LAI-1\s*Search matches keys/);
      assert.match(await group('review').innerText(), /LAI-4\s*Webhook retries/);
      assert.match(await group('review').innerText(), /CI passed/);
      assert.match(await group('blocked').innerText(), /LAI-3\s*Empty states/);
      assert.match(await group('blocked').innerText(), /Waiting on LAI-9/);

      // Only the reader's own work, read by assignee and status — never a
      // space's whole list.
      const reads = h.calls.filter((c) => c.path === '/api/v1/projects/atlas/tasks');
      assert.equal(reads.length, 2, `${String(reads.length)} reads of the task list`);
      // The queue is the shell's: My day does not ask for it again.
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/review').length, 1);

      await group('progress').locator('a.plate-item').click();
      await h.page.waitForURL(
        (url) =>
          url.pathname === '/board' &&
          url.searchParams.get('project') === 'atlas' &&
          url.searchParams.get('task') === 't1',
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('two columns on a laptop, one on a phone, in both themes, never sideways', async () => {
    const h = await open('/my-day', STUB);
    try {
      await h.page.locator('.myday-plate .plate-groups').waitFor({ timeout: 20_000 });
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1440, 900],
          [1366, 768],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          await h.page.waitForFunction(
            (w: number) => document.documentElement.clientWidth === w,
            width,
            { timeout: 5000 },
          );
          const m = await h.page.evaluate(() => {
            const main = document.querySelector('.myday-main')?.getBoundingClientRect();
            const side = document.querySelector('.myday-side')?.getBoundingClientRect();
            return {
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              main: main === undefined ? null : { x: main.x, bottom: main.bottom },
              side: side === undefined ? null : { x: side.x, y: side.y },
            };
          });
          assert.equal(m.overflow, 0, `${theme} at ${String(width)}: page scrolls sideways`);
          assert.ok(m.main !== null && m.side !== null);
          if (width >= 1366) {
            assert.ok(m.side.x > m.main.x + 200, `${theme} at ${String(width)}: not two columns`);
          } else {
            assert.ok(m.side.y >= m.main.bottom - 1, `${theme} at 390: the column is not below`);
          }
        }
      }
    } finally {
      await h.close();
    }
  });
});
