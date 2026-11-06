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
  navigateInApp,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open, NOW, TODAY } from './my-day-clock.ts';
import { addDays, viewOf, weekData, weekStub } from './my-day-week.ts';

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

  /** My record, kept as the server would, recording every write in order. */
  function awayStub(
    writes: StubCall[],
    start: Record<string, unknown>,
    refuseAdd = false,
  ): ApiStub {
    let record: Record<string, unknown> = start;
    let periods = (start.away_periods as { id: string; from: string; to: string }[]).slice();
    const current = (): Record<string, unknown> => {
      const now = periods.find((p) => p.from <= TODAY && p.to >= TODAY);
      return {
        ...record,
        away_periods: periods,
        away: now === undefined ? null : { until: now.to },
      };
    };
    return {
      '/api/v1/me/availability': (call: StubCall) => {
        if (call.method === 'PUT') {
          writes.push(call);
          record = { ...record, ...(call.body as object) };
        }
        return current();
      },
      '/api/v1/me/availability/away': (call: StubCall) => {
        writes.push(call);
        if (refuseAdd) {
          return reply(422, {
            error: {
              code: 'unprocessable',
              message: 'At most 20 current and upcoming away periods',
              details: { reason: 'too_many_away_periods' },
            },
          });
        }
        const body = call.body as { from: string; to: string };
        periods = [...periods, { id: `a${String(periods.length + 1)}`, ...body }];
        return reply(201, current());
      },
      '/api/v1/me/availability/away/a0': (call: StubCall) => {
        writes.push(call);
        periods = periods.filter((p) => p.id !== 'a0');
        return reply(204, null);
      },
    };
  }

  const AWAY_NOW = {
    ...RECORD,
    away: { until: addDays(TODAY, 3) },
    away_periods: [{ id: 'a0', from: TODAY, to: addDays(TODAY, 3) }],
  };
  const sent = (writes: readonly StubCall[]): string[] =>
    writes.map((w) =>
      `${w.method} ${w.path} ${w.method === 'PUT' ? '' : JSON.stringify(w.body ?? null)}`.trim(),
    );

  void test('choosing Away until… writes a period from today', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(awayStub(writes, { ...RECORD, away_periods: [] }));
    try {
      const panel = await openPopover(h.page);
      await panel.getByRole('radio', { name: /Away until…/ }).check();
      await panel.locator('input[type="date"]').first().fill(addDays(TODAY, 5));
      await panel.getByRole('button', { name: 'Save' }).click();
      await until(() => writes.length === 2);
      assert.deepEqual(sent(writes), [
        'PUT /api/v1/me/availability',
        `POST /api/v1/me/availability/away ${JSON.stringify({ from: TODAY, to: addDays(TODAY, 5) })}`,
      ]);
      const pill = h.page.locator('[data-my-availability] [data-avail-pill]');
      await until(async () => (await pill.getAttribute('data-avail-pill')) === 'away');
      assert.equal(await pill.getAttribute('data-avail-pill'), 'away');
    } finally {
      await h.close();
    }
  });

  void test('changing the away date adds the new period before removing the old', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(awayStub(writes, AWAY_NOW));
    try {
      const panel = await openPopover(h.page);
      await panel.locator('input[type="date"]').first().fill(addDays(TODAY, 9));
      await panel.getByRole('button', { name: 'Save' }).click();
      await until(() => writes.length === 3);
      assert.deepEqual(sent(writes), [
        'PUT /api/v1/me/availability',
        `POST /api/v1/me/availability/away ${JSON.stringify({ from: TODAY, to: addDays(TODAY, 9) })}`,
        'DELETE /api/v1/me/availability/away/a0 null',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('a refused move leaves the person away: the old period is never removed', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(awayStub(writes, AWAY_NOW, true));
    try {
      const panel = await openPopover(h.page);
      await panel.locator('input[type="date"]').first().fill(addDays(TODAY, 9));
      await panel.getByRole('button', { name: 'Save' }).click();
      const alert = panel.getByRole('alert');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(await alert.innerText(), 'At most 20 current and upcoming away periods');
      await h.page.waitForTimeout(500);
      assert.equal(
        writes.some((w) => w.method === 'DELETE'),
        false,
        'the old period was removed',
      );
      assert.equal(
        await h.page
          .locator('[data-my-availability] [data-avail-pill]')
          .getAttribute('data-avail-pill'),
        'away',
      );
    } finally {
      await h.close();
    }
  });

  void test('signing out and in as somebody else forgets the first person’s pill, form and count', async () => {
    // Review R1/N2: the shared record and the unread count are module state.
    // A different person on the same tab must never see — or Save over — them.
    let who: 'ada' | 'none' | 'bea' = 'ada';
    const person = (id: string, name: string) => ({
      id,
      email: `${name.toLowerCase()}@example.com`,
      name,
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    });
    const h = await myDay({
      '/api/v1/me': () =>
        who === 'ada'
          ? person('u1', 'Ada')
          : who === 'bea'
            ? person('u7', 'Bea')
            : refuse(401, 'unauthorized', 'Not signed in'),
      '/api/v1/me/availability': RECORD,
      '/api/v1/me/notices': NOTICES,
      '/api/v1/auth/sign-out': {},
      '/api/v1/auth/sign-in/email': () => {
        who = 'bea';
        return {};
      },
    });
    try {
      const pill = h.page.locator('[data-my-availability] [data-avail-pill]');
      await pill.waitFor({ timeout: 10_000 });
      const nav = h.page.locator('a.sidebar-link[href^="/my-day"] .sidebar-count');
      await until(async () => (await nav.count()) === 1);
      assert.match(await nav.innerText(), /^2/);

      // Bea's reads are held: anything on screen now is left over from Ada.
      await h.page.route('**/api/v1/me/availability', () => undefined);
      await h.page.route('**/api/v1/me/notices**', () => undefined);

      await h.page.locator('.user-menu-trigger').click();
      who = 'none';
      await h.page.locator('.user-menu-signout').click();
      await h.page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });
      await h.page.locator('input[autocomplete="username"]').fill('bea@example.com');
      await h.page.locator('input[autocomplete="current-password"]').fill('correct horse battery');
      await h.page.getByRole('button', { name: 'Sign in' }).click();
      await until(() => who === 'bea');
      await h.page.waitForURL((url) => url.pathname !== '/login', { timeout: 10_000 });
      await navigateInApp(h.page, `/my-day?day=${TODAY}`);
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      await h.page.locator('.user-menu-trigger', { hasText: 'Bea' }).waitFor({ timeout: 10_000 });

      const trigger = h.page.locator('[data-my-availability] > button');
      await trigger.waitFor({ timeout: 10_000 });
      assert.equal(
        await trigger.locator('[data-avail-pill]').count(),
        0,
        'Ada’s pill on Bea’s day',
      );
      assert.equal(await nav.count(), 0, 'Ada’s unread count on Bea’s rail');
      await trigger.click();
      const panel = h.page.getByRole('region', { name: /My availability/ });
      await panel.waitFor({ timeout: 10_000 });
      assert.doesNotMatch(await panel.innerText(), /Happy to review|Front-end|Reviews/);
      assert.equal(await panel.getByRole('button', { name: 'Save' }).count(), 0);
      assert.equal(await h.page.locator('[data-for-you]').count(), 0);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
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

  void test('a mark that fails leaves the count where it was, and says so', async () => {
    const h = await myDay({
      '/api/v1/me/notices': NOTICES,
      '/api/v1/me/notices/n2/read': refuse(500, 'internal', 'boom'),
    });
    try {
      const card = h.page.locator('[data-for-you="ready"]');
      await card.waitFor({ timeout: 10_000 });
      const nav = h.page.locator('a.sidebar-link[href^="/my-day"] .sidebar-count');
      await until(async () => (await nav.count()) === 1);
      await card
        .getByRole('button', { name: 'Mark read: Pawan Sirsat added you to Atlas' })
        .click();
      const alert = card.getByRole('alert');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(await alert.innerText(), 'That could not be marked read. Try again.');
      assert.match(await nav.innerText(), /^2/);
      assert.equal(await card.locator('[data-unread="true"]').count(), 2);
      assert.match(await card.locator('.foryou-count').innerText(), /^2$/);
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

/** Hemant's days, as `/people/u2/time` serves them (LAI-957), for the Day tab. */
function hemantsDays(): Record<string, unknown> {
  const data = weekData();
  const routes: Record<string, unknown> = {};
  for (let i = -21; i <= 21; i += 1) {
    const day = addDays(TODAY, i);
    routes[`/api/v1/people/u2/time?day=${day}`] = () => viewOf(day, data);
  }
  return routes;
}

const profileStub = (reader: { id: string; name: string; role: string }): ApiStub => ({
  ...hemantsDays(),
  // The reader's own notices and record: there to be read, so their absence
  // from somebody else's day is the page's choice, not an empty answer.
  '/api/v1/me/notices': NOTICES,
  '/api/v1/me/availability': RECORD,
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

void describe('the profile: the pill in the head card (D-137, D-139 item 8, LAI-1152)', () => {
  /** Calls for Hemant's load so far: the profile never makes one now. */
  const loads = (h: Harness): number => h.calls.filter((c) => c.path.endsWith('/load')).length;
  /** No read happens in a window: a fixed wait, because nothing can end it early. */
  const quiet = (page: Page): Promise<void> => page.waitForTimeout(1_000);

  for (const theme of ['Dark', 'Light'] as const) {
    void test(`the pill is their row of the list, on opening, and no load is read (${theme})`, async () => {
      const h = await open(
        '/people?user=u2&tab=overview',
        profileStub({ id: 'u1', name: 'Ada Owner', role: 'owner' }),
      );
      try {
        const pill = h.page.locator('.prof-head [data-profile-pill] [data-avail-pill="open"]');
        await pill.waitFor({ timeout: 20_000 });
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        await shoot(h.page, `profile-pill-${theme}`);
        assert.match(await pill.innerText(), /Open to more work/);
        const line = h.page.locator('.prof-head [data-profile-availability]');
        assert.match(await line.innerText(), /“Payments and API work”/);
        assert.match(await line.innerText(), /Payments/);
        assert.match(await line.innerText(), /set by Hemant/);
        // Current load and its button left the profile (D-139 item 8).
        assert.equal(await h.page.locator('[data-section="load"]').count(), 0);
        assert.equal(await h.page.getByText(/Show current load/).count(), 0);
        await quiet(h.page);
        assert.equal(loads(h), 0, 'opening Overview read the load');
        assert.ok(h.calls.some((c) => c.path === '/api/v1/people/availability'));
      } finally {
        await h.close();
      }
    });
  }

  for (const tab of ['overview', 'day', 'time'] as const) {
    void test(`opening ?tab=${tab} reads no load`, async () => {
      const h = await open(
        `/people?user=u2&tab=${tab}`,
        profileStub({ id: 'u1', name: 'Ada Owner', role: 'owner' }),
      );
      try {
        await h.page
          .locator(`[data-profile-tab="${tab}"][aria-current="page"]`)
          .waitFor({ timeout: 20_000 });
        if (tab === 'day') await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
        await quiet(h.page);
        assert.equal(loads(h), 0, `?tab=${tab} read the load`);
      } finally {
        await h.close();
      }
    });
  }

  void test('My availability and For you are never on somebody else’s day', async () => {
    const h = await open(
      '/people?user=u2&tab=day',
      profileStub({ id: 'u1', name: 'Ada Owner', role: 'owner' }),
    );
    try {
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      await h.page.locator('[data-day-tab="overview"]').click();
      await quiet(h.page);
      assert.equal(await h.page.locator('[data-my-availability]').count(), 0);
      assert.equal(await h.page.locator('[data-for-you]').count(), 0);
      // The day itself was read, so the absence is the page's choice.
      assert.ok(h.calls.some((c) => c.path === '/api/v1/people/u2/time'));
    } finally {
      await h.close();
    }
  });

  void test('a reader with profiles but not analytics asks for no load', async () => {
    // An admin whose *See everyone's analytics* was withdrawn, still holding
    // profiles and the developer-setup grant (LAI-1140's tab): the page may
    // have tabs for them, and the pill is still the list's.
    const stub = profileStub({ id: 'u1', name: 'Ada Admin', role: 'admin' });
    const h = await open('/people?user=u2', {
      ...stub,
      '/api/v1/permissions': {
        org_roles: ['owner', 'admin', 'member', 'viewer'],
        project_roles: ['lead', 'member', 'viewer'],
        permissions: [],
        me: {
          org_role: 'admin',
          credential: 'session',
          project_scope: 'all',
          implicit_project_role: 'lead',
          actions: ['project.read', 'profile.read', 'developer_setup.read_any'],
          projects: [],
        },
      },
    });
    try {
      await h.page.locator('.prof-head').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(1_000);
      assert.equal(await h.page.locator('[data-section="load"]').count(), 0);
      assert.equal(
        h.calls.some((c) => c.path.endsWith('/load')),
        false,
        'a reader without analytics asked for the load',
      );
    } finally {
      await h.close();
    }
  });

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
