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
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

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
  // LAI-831: no gap waved away; the one draft held is today's.
  breaks: [],
  drafts_held: { count: 1, minutes: 95 },
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

function privatePlateStub(role: 'owner' | 'admin' | 'member' | 'viewer'): ApiStub {
  const privateProject = {
    id: 'private-observatory',
    slug: 'private-observatory',
    prefix: 'OBS',
    name: 'Private Observatory',
    archived_at: null,
    visibility: 'private',
    task_counts: { backlog: 0, todo: 0, in_progress: 1, review: 0, done: 0, cancelled: 0 },
    member_count: 0,
    members: [],
  };
  return {
    ...STUB,
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: role,
      is_active: true,
      memberships: [],
    },
    '/api/v1/projects': { data: [privateProject], next_cursor: null },
    '/api/v1/projects/private-observatory/tasks?assignee=u1&status=in_progress': {
      data: [
        {
          ...task('private-task', 'OBS-7', 'Private Observatory migration', 'in_progress'),
          project_id: 'private-observatory',
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/private-observatory/tasks?assignee=u1&status=todo': {
      data: [],
      next_cursor: null,
    },
  };
}

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
      assert.match(await head.innerText(), /Only you see drafts/);
      assert.match(
        await head.locator('.myday-chip-primary').innerText(),
        /Confirm day · 1 h 35 min/,
        'Confirm day does not say what it confirms',
      );
      await until(
        async () => (await head.getByRole('button', { name: 'Previous week' }).count()) === 1,
      );
      assert.equal(await head.getByRole('button', { name: 'Previous week' }).count(), 1);
      await until(
        async () => (await head.getByRole('button', { name: 'Next week' }).count()) === 1,
      );
      assert.equal(await head.getByRole('button', { name: 'Next week' }).count(), 1);
      await until(async () => (await head.locator('.myday-week-day').count()) === 7);
      assert.equal(await head.locator('.myday-week-day').count(), 7);
    } finally {
      await h.close();
    }
  });

  // LAI-867: the hint names the step that sends agent minutes, not a screen.
  void test('no agent minutes: the hint says to run laika activity on on each laptop', async () => {
    const none = { minutes: 0, keyboard_minutes: 0, by_task: [], unattributed_minutes: 0 };
    const h = await open('/my-day', { ...STUB, '/api/v1/me/time': { ...DAY, agent: none } });
    try {
      const hint = h.page.locator('.myday-agent [data-agent-hint]');
      await hint.waitFor({ timeout: 20_000 });
      const text = await hint.innerText();
      assert.match(text, /run laika activity on on each laptop\./);
      assert.equal(await hint.locator('code').innerText(), 'laika activity on');
      assert.doesNotMatch(text, /\(Connect\)/);
    } finally {
      await h.close();
    }
  });

  void test('the day is a lane of confirmed and drafted blocks, with a line at now', async () => {
    const h = await open('/my-day', STUB);
    try {
      const track = h.page.locator('[data-dayline-track]');
      await track.waitFor({ timeout: 20_000 });
      // Wait for each count it asserts, not the track (LAI-715).
      await until(
        async () => (await h.page.locator('.dayline-block.dayline-confirmed').count()) === 1,
      );
      assert.equal(await h.page.locator('.dayline-block.dayline-confirmed').count(), 1);
      await until(
        async () => (await h.page.locator('.dayline-block.dayline-drafted').count()) === 1,
      );
      assert.equal(await h.page.locator('.dayline-block.dayline-drafted').count(), 1);
      await until(async () => (await h.page.locator('.dayline-now').count()) === 1);
      assert.equal(await h.page.locator('.dayline-now').count(), 1, 'today has no now line');
      // The untimed call is not placed somewhere invented; it is counted.
      assert.match(await h.page.locator('.dayline-untimed').innerText(), /1 block has no set time/);

      // Inside the track, in the order of the day.
      const box = await track.boundingBox();
      const drafted = await h.page.locator('.dayline-block.dayline-drafted').boundingBox();
      const confirmed = await h.page.locator('.dayline-block.dayline-confirmed').boundingBox();
      assert.ok(box && drafted && confirmed);
      for (const b of [drafted, confirmed]) {
        assert.ok(b.x >= box.x - 1 && b.x + b.width <= box.x + box.width + 1, 'a block escapes');
        assert.ok(b.width > 2, 'a block has no width');
      }
      assert.ok(drafted.x < confirmed.x, '08:40 is drawn after 11:30');

      // To settle, then Confirmed, then Add time — the lists the lane pictures.
      const order = await h.page
        .locator('.myday-main')
        .evaluate((el: Element) => el.textContent ?? '');
      const drafts = order.indexOf('To settle');
      const confirmedAt = order.indexOf('Confirmed', drafts + 1);
      const add = order.indexOf('Add time', confirmedAt + 1);
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

  void test('On your plate reads Private Observatory through owner/admin implicit lead', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const h = await open('/my-day', privatePlateStub(role));
      try {
        const progress = h.page.locator('[data-plate="progress"]');
        await progress.getByText('Private Observatory migration', { exact: true }).waitFor({
          timeout: 20_000,
        });
        assert.match(await progress.innerText(), /Private Observatory migration/);
        assert.ok(
          h.calls.some((call) => call.path === '/api/v1/projects/private-observatory/tasks'),
          `Private Observatory task list was not read for ${role}`,
        );
      } finally {
        await h.close();
      }
    }
  });

  void test('On your plate excludes Private Observatory for a non-member org member/viewer', async () => {
    for (const role of ['member', 'viewer'] as const) {
      const h = await open('/my-day', privatePlateStub(role));
      try {
        await h.page.locator('.myday-plate .plate-groups').waitFor({ timeout: 20_000 });
        assert.equal(
          await h.page.getByText('Private Observatory migration', { exact: true }).count(),
          0,
          `Private Observatory migration was shown to a ${role}`,
        );
        assert.equal(
          h.calls.filter((call) => call.path === '/api/v1/projects/private-observatory/tasks')
            .length,
          0,
          `Private Observatory task list was read for a ${role}`,
        );
      } finally {
        await h.close();
      }
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

/*
 * LAI-830 — the owner's two crops of the Confirmed list read `14:29–14:48 ·
 * confirmed draft`, `0:19`, `0:15`, `0:08` and `entries · 1:09`: *"is this
 * minutes or hours?"*. The same day, as it reads now.
 */
const entry = (
  id: string,
  from: number | null,
  to: number | null,
  minutes: number,
  note: string,
) => ({
  id,
  day: TODAY,
  tz: 'UTC',
  started_at: from,
  ended_at: to,
  minutes,
  source: 'manual',
  task: null,
  project: null,
  note,
  revision: 1,
  created_at: 1,
  updated_at: 1,
});

const OWNER_DAY = {
  ...DAY,
  entries: [
    entry('o1', at(14, 29), at(14, 48), 19, 'confirmed draft'),
    entry('o2', at(11, 40), at(12, 10), 27, 'across noon'),
    entry('o3', at(15, 0), at(15, 15), 15, 'a review'),
    entry('o4', null, null, 8, 'a call'),
  ],
};

void describe('times and durations say their units (LAI-830)', () => {
  void test('a 12-hour clock with AM/PM, and minutes and hours in words', async () => {
    const h = await open('/my-day', { ...STUB, '/api/v1/me/time': OWNER_DAY });
    try {
      const confirmed = h.page.locator('.myday-entries');
      await confirmed.locator('[data-entry="o1"]').waitFor({ timeout: 20_000 });
      const row = (id: string) => confirmed.locator(`[data-entry="${id}"]`);

      // The owner's row: was `14:29–14:48` and `0:19`.
      assert.equal(await row('o1').locator('.myday-row-time').innerText(), '2:29–2:48 PM');
      assert.equal(await row('o1').locator('.myday-row-minutes').innerText(), '19 min');
      // Each end says its own AM/PM across noon.
      assert.equal(await row('o2').locator('.myday-row-time').innerText(), '11:40 AM–12:10 PM');
      assert.equal(await row('o3').locator('.myday-row-minutes').innerText(), '15 min');
      assert.equal(await row('o4').locator('.myday-row-minutes').innerText(), '8 min');
      // The header total: was `entries · 1:09`.
      assert.equal(
        await confirmed.locator('[data-confirmed-caption]').innerText(),
        '4 entries · 1 h 9 min',
      );

      // The drafted list, Confirm day, the week strip and the bar say the same.
      const drafted = h.page.locator('[data-draft="d1"]');
      assert.equal(await drafted.locator('.myday-row-time').innerText(), '8:40–10:15 AM');
      assert.equal(await drafted.locator('.myday-row-minutes').innerText(), '1 h 35 min');
      assert.match(
        await h.page.locator('.screen-page .myday-chip-primary').innerText(),
        /Confirm day · 1 h 35 min/,
      );
      // Today's cell: 75 confirmed and 95 drafted, was `2:50`.
      assert.equal(
        await h.page.locator(`.myday-week-day[data-day="${TODAY}"] .myday-week-figure`).innerText(),
        '2 h 50 min',
      );
      // Every hour on the 12-hour clock — but not the one under the now pill,
      // which hides it (LAI-888), so no one hour is asked for by name but 8 AM.
      const ticks = await h.page.locator('.dayline-axis-hour').allInnerTexts();
      assert.ok(
        ticks.includes('8 AM') && ticks.some((t) => t.endsWith(' PM')),
        `ticks: ${ticks.join(', ')}`,
      );
      assert.ok(
        ticks.every((t) => /^\d{1,2} [AP]M$/.test(t)),
        `a tick is not on the 12-hour clock: ${ticks.join(', ')}`,
      );

      // Nothing on the page is a duration or a clock in the old form.
      const text = await h.page.locator('.myday-main').innerText();
      assert.doesNotMatch(
        text,
        /\b\d{1,2}:\d{2}\b(?! ?[AP]M)(?!–\d)/,
        'an h:mm or 24-hour time is left',
      );
      assert.doesNotMatch(text, /\b(?:1[3-9]|2[0-3]):\d{2}\b/, 'a 24-hour time is left');
    } finally {
      await h.close();
    }
  });

  void test('a typed length says what it understood before anything is saved', async () => {
    const h = await open('/my-day', { ...STUB, '/api/v1/me/time': OWNER_DAY });
    try {
      const add = h.page.locator('form[aria-label="Add time"]');
      await add.waitFor({ timeout: 20_000 });
      // The chips are one click; any other length is typed, and read back.
      await add.getByRole('button', { name: 'Other…' }).click();
      const howLong = add.getByLabel('How long, typed');
      for (const [typed, read] of [
        ['45', '45 min'],
        ['45m', '45 min'],
        ['1h 30m', '1 h 30 min'],
        ['1:30', '1 h 30 min'],
      ] as const) {
        await howLong.fill(typed);
        assert.equal(
          await add.locator('[data-understood]').innerText(),
          `Reads as ${read}`,
          `"${typed}" is not shown as understood`,
        );
      }
      // The inspector names the block on the 12-hour clock (LAI-831: Split in
      // two cuts at the middle, so no time is typed for it).
      await h.page.locator('[data-select="d1"]').click();
      assert.match(
        await h.page.locator('[data-inspector-for="d1"] .inspector-range').innerText(),
        /^8:40–10:15 AM$/,
      );
      // Nothing was sent while typing.
      assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0, 'typing saved something');
    } finally {
      await h.close();
    }
  });
});
