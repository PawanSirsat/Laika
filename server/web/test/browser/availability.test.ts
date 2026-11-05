/**
 * Availability and For you, in a real browser (LAI-1139; D-131, D-134, D-137).
 *
 * The server owns who may read what and every figure (LAI-1130, LAI-1136).
 * What is left to prove is the page: that My availability saves through one
 * `PUT` and shows a refusal beside its field; that a notice's message — the
 * adder's free text — reaches the page as text, never as markup; that reading
 * a notice takes the rail's count down; that Current load prints the working
 * week as two numbers on a track with nothing drawn in proportion; and that a
 * member's session never asks for anybody's load.
 *
 * Every page here runs on a clock pinned to `NOW` (my-day-clock.ts).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open, NOW, TODAY } from './my-day-clock.ts';
import { addDays, weekStub } from './my-day-week.ts';

const DAY = 86_400_000;

/** Set `LAIKA_SHOTS` to a directory to keep a picture of each state for review. */
const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

void after(async () => {
  await closeBrowser();
});

const RECORD = {
  status: 'open',
  away: null,
  hours_per_week: 6,
  note: 'Happy to review front-end work',
  tags: ['Front-end', 'Reviews'],
  work_week: { days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00', minutes: 2400 },
  away_periods: [{ id: 'a1', from: addDays(TODAY, 15), to: addDays(TODAY, 18) }],
  updated_at: NOW - 3 * DAY,
};

const SCRIPT = '<img src=x onerror="window.__pwned=1"><b>bold</b> **stars**';

const NOTICES = {
  data: [
    {
      id: 'n2',
      kind: 'added_to_space',
      actor: { id: 'u9', name: 'Pawan Sirsat' },
      project: { id: 'p1', slug: 'atlas', name: 'Atlas' },
      task: { id: 't11', key: 'LAI-11', title: 'Search matches keys' },
      subject: null,
      message: SCRIPT,
      created_at: NOW - 20 * 60_000,
      read_at: null,
    },
    {
      id: 'n1',
      kind: 'added_to_space',
      actor: { id: 'u9', name: 'Pawan Sirsat' },
      project: null,
      task: null,
      subject: null,
      message: null,
      created_at: NOW - 2 * DAY,
      read_at: null,
    },
  ],
  next_cursor: null,
  unread_count: 2,
};

async function myDay(extra: ApiStub, width = 1440): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, { ...weekStub(), ...extra });
  await h.page.setViewportSize({ width, height: 900 });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  return h;
}

async function openPopover(page: Page) {
  const trigger = page.locator('[data-my-availability] > button');
  await trigger.waitFor({ timeout: 10_000 });
  await until(async () => (await trigger.locator('[data-avail-pill]').count()) > 0);
  await trigger.click();
  const panel = page.getByRole('region', { name: /My availability/ });
  await panel.waitFor({ timeout: 10_000 });
  return panel;
}

void describe('My availability on My day (frames 2a–2c)', () => {
  void test('the pill says it in words and a glyph; Save sends one PUT of the edit', async () => {
    const writes: StubCall[] = [];
    let saved: Record<string, unknown> = RECORD;
    const h = await myDay({
      '/api/v1/me/availability': (call: StubCall) => {
        if (call.method === 'PUT') {
          writes.push(call);
          saved = { ...saved, ...(call.body as object), updated_at: NOW };
        }
        return saved;
      },
    });
    try {
      const pill = h.page.locator('[data-my-availability] [data-avail-pill]');
      await pill.waitFor({ timeout: 10_000 });
      assert.equal(await pill.getAttribute('data-avail-pill'), 'open');
      // Not colour alone: a glyph and the words, and the hours beside them.
      const said = await pill.innerText();
      assert.match(said, /●/);
      assert.match(said, /Open to more work/);
      assert.match(said, /~6 h\/wk/);

      const panel = await openPopover(h.page);
      assert.match(
        await panel.innerText(),
        /updated 3 days ago · everyone in your spaces sees this/,
      );
      await shoot(h.page, 'popover-light');
      await setTheme(h.page, 'Dark');
      await shoot(h.page, 'popover-dark');
      if ((await panel.count()) === 0) await openPopover(h.page);
      await panel.getByLabel('Hours a week you could take on').fill('10');
      await panel.getByRole('textbox', { name: 'Skills and areas' }).fill('Maps');
      await panel.getByRole('textbox', { name: 'Skills and areas' }).press('Enter');
      await panel.getByRole('button', { name: 'Save' }).click();
      await until(() => writes.length > 0);
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0]?.body, {
        status: 'open',
        hours_per_week: 10,
        note: 'Happy to review front-end work',
        tags: ['Front-end', 'Reviews', 'Maps'],
        work_week: { days: [1, 2, 3, 4, 5], start: '08:00', end: '16:00' },
      });
      await until(async () => (await pill.innerText()).includes('~10 h/wk'));
      assert.match(await pill.innerText(), /~10 h\/wk/);
    } finally {
      await h.close();
    }
  });

  void test('a refusal is the server’s sentence beside the field it names, and the edit is kept', async () => {
    const h = await myDay({
      '/api/v1/me/availability': (call: StubCall) =>
        call.method === 'PUT'
          ? reply(422, {
              error: {
                code: 'unprocessable',
                message: 'hours_per_week is 1 to 80',
                details: { field: 'hours_per_week', reason: 'out_of_range' },
              },
            })
          : RECORD,
    });
    try {
      const panel = await openPopover(h.page);
      const hours = panel.getByLabel('Hours a week you could take on');
      await hours.fill('99');
      await panel.getByRole('button', { name: 'Save' }).click();
      const alert = panel.getByRole('alert');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(await alert.innerText(), 'hours_per_week is 1 to 80');
      assert.equal(await hours.getAttribute('aria-invalid'), 'true');
      assert.equal(await hours.inputValue(), '99');
    } finally {
      await h.close();
    }
  });

  void test('at 390 the popover is a sheet along the foot of the screen (frame 2c)', async () => {
    const h = await myDay({ '/api/v1/me/availability': RECORD }, 390);
    try {
      const panel = await openPopover(h.page);
      await shoot(h.page, 'popover-390');
      const box = await panel.boundingBox();
      assert.ok(box !== null);
      // Inside the screen on both sides, and never wider than it.
      assert.ok(
        box.x >= 0 && box.x + box.width <= 390,
        `the sheet spans ${String(box.x)}…${String(box.x + box.width)}`,
      );
      assert.ok(box.y + box.height <= 900);
      await shoot(h.page, 'popover-390');
    } finally {
      await h.close();
    }
  });

  void test('nobody has set anything: Set availability, never a guessed pill', async () => {
    const h = await myDay({});
    try {
      const trigger = h.page.locator('[data-my-availability] > button');
      await until(async () => (await trigger.innerText()) === 'Set availability');
      assert.equal(await trigger.innerText(), 'Set availability');
      assert.equal(await trigger.locator('[data-avail-pill]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('For you (D-134)', () => {
  void test('the message is drawn as text, a gone space says so, and reading takes the count down', async () => {
    const writes: StubCall[] = [];
    let unread = 2;
    const read = new Set<string>();
    const h = await myDay({
      '/api/v1/me/notices': () => ({
        ...NOTICES,
        data: NOTICES.data.map((n) => (read.has(n.id) ? { ...n, read_at: NOW } : n)),
        unread_count: unread,
      }),
      '/api/v1/me/notices/n2/read': (call: StubCall) => {
        writes.push(call);
        read.add('n2');
        unread = 1;
        return reply(204, null);
      },
      '/api/v1/me/notices/read-all': (call: StubCall) => {
        writes.push(call);
        read.add('n1');
        read.add('n2');
        unread = 0;
        return reply(204, null);
      },
    });
    try {
      const card = h.page.locator('[data-for-you="ready"]');
      await card.waitFor({ timeout: 10_000 });
      await shoot(h.page, 'for-you');
      const message = card.locator('[data-notice-message]');
      // The adder's words, character for character — no element made of them.
      assert.equal(await message.innerText(), `“${SCRIPT}”`);
      assert.equal(await message.locator('img, b').count(), 0);
      assert.equal(
        await h.page.evaluate(() => (window as { __pwned?: number }).__pwned),
        undefined,
      );
      assert.match(await card.innerText(), /Pawan Sirsat added you to Atlas/);
      assert.match(await card.innerText(), /First card LAI-11 Search matches keys/);
      // A space the reader can no longer open is said as gone (LAI-1136's review).
      assert.match(await card.innerText(), /Pawan Sirsat added you to a space/);
      assert.match(await card.innerText(), /The space is no longer open to you\./);

      const nav = h.page.locator('a.sidebar-link[href^="/my-day"] .sidebar-count');
      await until(async () => (await nav.count()) === 1);
      assert.match(await nav.innerText(), /^2/);

      await card
        .getByRole('button', { name: 'Mark read: Pawan Sirsat added you to Atlas' })
        .click();
      await until(() => writes.length === 1);
      assert.deepEqual(
        writes.map((w) => `${w.method} ${w.path}`),
        ['POST /api/v1/me/notices/n2/read'],
      );
      await until(async () => (await nav.innerText()).startsWith('1'));
      assert.match(await nav.innerText(), /^1/);

      await card.locator('[data-read-all]').click();
      await until(() => writes.length === 2);
      assert.equal(`${writes[1]?.method} ${writes[1]?.path}`, 'POST /api/v1/me/notices/read-all');
      await until(async () => (await nav.count()) === 0);
      assert.equal(await nav.count(), 0, 'no badge once nothing is unread');
      assert.equal(await card.locator('[data-unread="true"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('nothing to tell is no card at all', async () => {
    const h = await myDay({});
    try {
      await h.page.locator('[data-day-tab="overview"]').waitFor({ timeout: 10_000 });
      await until(() => h.calls.some((c) => c.path === '/api/v1/me/notices'));
      assert.equal(await h.page.locator('[data-for-you]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a read that fails says so, with Retry', async () => {
    const h = await myDay({
      '/api/v1/me/notices': refuse(500, 'internal', 'boom'),
    });
    try {
      const card = h.page.locator('[data-for-you="error"]');
      await card.waitFor({ timeout: 10_000 });
      assert.match(await card.innerText(), /Your notices could not be read\./);
      assert.equal(await card.getByRole('button', { name: 'Retry' }).count(), 1);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------ the profile

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const profileOf = (id: string, name: string) => ({
  user: {
    id,
    name,
    email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
    org_role: 'member',
    is_active: true,
    profile_kind: 'builder',
    created_at: NOW - 200 * DAY,
  },
  window: { weeks: 12, since: NOW - 84 * DAY, until: NOW },
  projects: [],
  review: {
    accepted: 0,
    sent_back: 0,
    last_30_days: 0,
    per_week: [],
    time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
    recent: [],
  },
  ratings: [],
  ratings_total: 0,
  activity_sharing: { org_enabled: false, enabled: false },
  current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
  delivery: {
    accepted_per_week: [],
    accepted: 0,
    sent_back: 0,
    reopened: 0,
    cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
  },
  agents: {
    tokens: [],
    tokens_total: 0,
    online: { enabled: true, clients: [], last_seen: null },
    writes: [],
    writes_total: 0,
  },
});

const LOAD = {
  availability: { ...RECORD, hours_per_week: 8, note: 'Payments and API work' },
  projects: [
    {
      project: { id: 'p1', slug: 'sauce', name: 'Sauce' },
      hidden: false,
      role: 'lead',
      confirmed_minutes: 2300,
      drafted_minutes: 0,
    },
    { project: null, hidden: true, role: null, confirmed_minutes: 55, drafted_minutes: 0 },
  ],
  cards: { in_progress: 2, in_review: 1, due_7d: 3 },
  week: {
    from: addDays(TODAY, -3),
    to: addDays(TODAY, 3),
    confirmed_minutes: 1265,
    drafted_minutes: 0,
    set_minutes: 2400,
  },
  away: [{ from: '2026-11-20', to: '2026-11-23' }],
};

/** A year with nothing in it: the Activity card's answer (LAI-751's shape). */
function quietYear() {
  const days = 364;
  const zeros = () => new Array<number>(days).fill(0);
  return {
    range: '52w',
    start: new Date(NOW - (days - 1) * DAY).toISOString().slice(0, 10),
    end: new Date(NOW).toISOString().slice(0, 10),
    tz: 'UTC',
    sharing: { org_enabled: false, enabled: false },
    series: {
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
      board_self: zeros(),
      board_agent: zeros(),
    },
    prompts_by_agent: {},
    agents: [],
  };
}

const quietUsage = (userId: string) => ({
  user_id: userId,
  from: '2026-07-27',
  to: '2026-10-18',
  weeks: [],
  totals: {
    tokens: 0,
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    attributed_tokens: 0,
    cost: { usd: 0, unpriced_tokens: 0, unpriced_models: [], unconfirmed_models: [] },
  },
  by_agent: [],
  by_model: [],
  no_token_data: [],
  sharing: { org_enabled: true, enabled: true },
});

const profileStub = (reader: { id: string; name: string; role: string }): ApiStub => ({
  '/api/v1/me': {
    ...person(reader.id, reader.name, reader.role),
    memberships: [{ project_id: 'p1', role: 'member' }],
  },
  '/api/v1/users/u2/profile': profileOf('u2', 'Hemant Purohit'),
  '/api/v1/users/u2/usage': quietUsage('u2'),
  '/api/v1/people/u2/activity': quietYear(),
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Borealis',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/people/u2/load': LOAD,
  '/api/v1/people/availability': {
    data: [
      {
        user: { id: 'u2', name: 'Hemant Purohit' },
        availability: {
          status: 'open',
          note: 'Payments and API work',
          tags: ['Payments'],
          away: null,
        },
        spaces: [{ id: 'p1', slug: 'sauce', name: 'Sauce' }],
      },
    ],
  },
});

void describe('the profile: pill and Current load (frames 2d–2f)', () => {
  for (const theme of ['Dark', 'Light'] as const) {
    void test(`an owner reads facts, not a score — the week is two numbers on an unfilled track (${theme})`, async () => {
      const h = await open(
        '/people?user=u2',
        profileStub({ id: 'u1', name: 'Ada Owner', role: 'owner' }),
      );
      try {
        const card = h.page.locator('[data-section="load"]');
        await card.locator('[data-load="week"]').waitFor({ timeout: 20_000 });
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        await card.scrollIntoViewIfNeeded();
        await shoot(h.page, `current-load-${theme}`);
        assert.match(
          await card.innerText(),
          /facts, not a score · read-only · Hemant can see you looked/,
        );
        assert.equal(
          await card.locator('[data-load-week]').innerText(),
          '21h 5m tracked of 40h set',
        );
        // Neutral and unfilled (plan Q2): the track draws nothing in proportion.
        const track = card.locator('[data-load-track]');
        assert.equal(await track.locator('*').count(), 0);
        assert.equal(await track.getAttribute('style'), null);
        assert.match(await card.innerText(), /Set by Hemant: Mon–Fri, 08:00–16:00/);
        assert.match(await card.innerText(), /In progress\s*2/);
        assert.match(await card.innerText(), /Waiting for review\s*1/);
        assert.match(await card.innerText(), /Due in 7 days\s*3/);
        assert.match(await card.innerText(), /Sauce · Space admin/);
        assert.match(await card.innerText(), /Spaces you can’t open/);
        assert.match(await card.innerText(), /Fri 20 – Mon 23 Nov/);
        assert.doesNotMatch(await card.innerText(), /free|%/i);

        const head = h.page.locator('[data-profile-availability]');
        assert.match(await head.innerText(), /Open to more work/);
        assert.match(await head.innerText(), /“Payments and API work”/);
        assert.match(await head.innerText(), /set by Hemant · updated 3 days ago/);
        // One logged read serves the header and the card: no list read for an owner.
        assert.equal(h.calls.filter((c) => c.path === '/api/v1/people/u2/load').length, 1);
        assert.equal(
          h.calls.some((c) => c.path === '/api/v1/people/availability'),
          false,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('a member never sees load figures and never asks for them', async () => {
    const h = await open(
      '/people?user=u2',
      profileStub({ id: 'u3', name: 'Cal Member', role: 'member' }),
    );
    try {
      // A member is not offered profiles at all (§3, profile.read): the page
      // says so, and nothing on it asked for anybody's load or availability.
      await h.page
        .getByText('You do not have access to member profiles')
        .waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-section="load"]').count(), 0);
      assert.equal(
        h.calls.some((c) => c.path.endsWith('/load') || c.path === '/api/v1/people/availability'),
        false,
        'a member session asked for somebody’s load',
      );
    } finally {
      await h.close();
    }
  });
});
