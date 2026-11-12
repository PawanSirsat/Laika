/**
 * Insights → Time → Time logging in a real browser (D-148, LAI-1175), on
 * the pinned clock:
 *
 *  - the third segment for an owner and a space admin, absent for a member;
 *  - the current month asked for by its first and last day, the stepper's
 *    addresses, ‹ changing the month and the request, › disabled at today's;
 *  - every cell state as drawn, from the server's facts — the verdict, a day
 *    off with time on it, before joining, not yet, today — and a row's Total;
 *  - a cell is a door to that person's Day; a name to their profile;
 *  - the lead's caption, the cut-list note, the empty state with the stepper
 *    still there, the server's error with Retry;
 *  - both themes at 1440 and 390, nothing sideways, the first column pinned.
 *
 * `/time/days` is answered by `page.route`, which sees the whole query — the
 * stub server matches paths, and the month asked for is what this is about.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page, Route } from 'playwright';
import type { TimeLogging, TimeLoggingPerson } from '../../src/api/time-logging.ts';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { LAIKA, ONROUTE } from './capacity-org.ts';
import { open, TODAY } from './my-day-clock.ts';
import { addDays } from './my-day-week.ts';

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const ME = (role: string) => ({
  id: 'u1',
  email: 'pawan@kvelld.example',
  name: 'Pawan Sirsat',
  org_role: role,
  is_active: true,
  memberships: [{ project_id: 'p1', role: role === 'member' ? 'member' : 'lead' }],
});

function permissions(role: string, actions: readonly string[], lead: boolean): unknown {
  return {
    org_roles: ['owner', 'admin', 'member', 'viewer'],
    project_roles: ['lead', 'member', 'viewer'],
    permissions: [],
    me: {
      org_role: role,
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: null,
      actions: ['project.read', 'task.watch', ...actions],
      projects: [
        {
          project_id: 'p1',
          role: lead ? 'lead' : 'member',
          actions: lead
            ? ['project.read', 'time.report.read_project', 'time.days.read_project']
            : ['project.read'],
        },
      ],
    },
  };
}

function base(role: string, actions: readonly string[], lead: boolean): ApiStub {
  return {
    '/api/v1/me': ME(role),
    '/api/v1/permissions': permissions(role, actions, lead),
    '/api/v1/projects': { data: [LAIKA, ONROUTE], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/unlisted': { data: [], next_cursor: null },
  };
}

const OWNER_STUB = (): ApiStub =>
  base('owner', ['time.report.read', 'people.analytics.read', 'audit_log.export'], true);
const LEAD_STUB = (): ApiStub => base('member', [], true);
const MEMBER_STUB = (): ApiStub => base('member', [], false);

const THIS_MONTH = TODAY.slice(0, 7);
const lastOf = (month: string): string => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return addDays(d.toISOString().slice(0, 10), -1);
};
const prevMonth = (month: string): string => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

function person(
  id: string,
  name: string,
  facts: Partial<TimeLoggingPerson> & { readonly days: TimeLoggingPerson['days'] },
): TimeLoggingPerson {
  return {
    user: { id, name, org_role: 'member', deactivated: false },
    zone: 'UTC',
    joined_day: '2026-01-05',
    today_day: TODAY,
    work_days: [1, 2, 3, 4, 5],
    ...facts,
  };
}

/** This month, the pinned today: the owner and Bea, with time today and yesterday. */
function thisMonth(url: URL, scope: 'people' | 'lead' = 'people'): TimeLogging {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const yesterday = addDays(TODAY, -1);
  const inMonth = (day: string) => day >= from && day <= to;
  const on = (day: string, c: number, d = 0) =>
    inMonth(day) ? [{ day, confirmed_minutes: c, drafted_minutes: d }] : [];
  return {
    from,
    to,
    scope,
    threshold_minutes: 480,
    people: [
      person('u2', 'Bea Nkosi', { days: [...on(yesterday, 540), ...on(TODAY, 60, 30)] }),
      person('u1', 'Pawan Sirsat', {
        user: { id: 'u1', name: 'Pawan Sirsat', org_role: 'owner', deactivated: false },
        days: on(TODAY, 120),
      }),
    ],
    truncated: false,
  };
}

/**
 * October 2026 as the server tells it: Bea joined Monday the 5th, and it is
 * Thursday the 15th in her zone. A full Monday, an under Tuesday, a quiet
 * Wednesday, a Saturday with time on it, time before she joined, time filed
 * for tomorrow, and this morning's hour and a half.
 */
const OCT_FIXTURE: TimeLogging = {
  from: '2026-10-01',
  to: '2026-10-31',
  scope: 'people',
  threshold_minutes: 480,
  people: [
    person('u2', 'Bea Nkosi', {
      joined_day: '2026-10-05',
      today_day: '2026-10-15',
      days: [
        { day: '2026-10-02', confirmed_minutes: 480, drafted_minutes: 0 }, // before she joined
        { day: '2026-10-10', confirmed_minutes: 120, drafted_minutes: 0 }, // Saturday
        { day: '2026-10-12', confirmed_minutes: 300, drafted_minutes: 240 }, // full, drafts counted
        { day: '2026-10-13', confirmed_minutes: 180, drafted_minutes: 0 }, // under
        { day: '2026-10-15', confirmed_minutes: 90, drafted_minutes: 0 }, // today
        { day: '2026-10-16', confirmed_minutes: 480, drafted_minutes: 0 }, // not yet
      ],
    }),
  ],
  truncated: false,
};

type Answer = (url: URL) => { status: number; body: unknown };
const ok = (body: unknown) => ({ status: 200, body });

async function routeDays(page: Page, asked: URL[], answer: Answer): Promise<void> {
  await page.route('**/api/v1/time/days?**', async (route: Route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const a = answer(url);
    await route.fulfill({
      status: a.status,
      contentType: 'application/json',
      body: JSON.stringify(a.body),
    });
  });
}

async function openWith(
  path: string,
  stub: ApiStub,
  asked: URL[],
  answer: Answer,
  width = 1440,
): Promise<Harness> {
  return open(path, stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 1000 });
      await routeDays(page, asked, answer);
    },
  });
}

async function done(h: Harness): Promise<void> {
  await h.page.unrouteAll({ behavior: 'ignoreErrors' });
  await h.close();
}

async function noSideways(page: Page, width: number): Promise<void> {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= width, `the page is ${String(wide)}px wide at ${String(width)}`);
}

const grid = (page: Page) => page.locator('[data-time-logging]');
const cell = (page: Page, user: string, day: string) =>
  page.locator(`tr[data-person="${user}"] td[data-day="${day}"]`);

after(async () => {
  await closeBrowser();
});

void describe('the third segment, this month', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: an owner's grid of this month, nothing sideways`, async () => {
        const asked: URL[] = [];
        const h = await openWith(
          '/insights?tab=time&view=days',
          OWNER_STUB(),
          asked,
          (u) => ok(thisMonth(u)),
          width,
        );
        try {
          await setTheme(h.page, theme);
          const g = grid(h.page);
          await g.locator('tbody tr').first().waitFor({ timeout: 20_000 });
          assert.equal(
            await h.page.locator('[data-time-view="days"]').getAttribute('aria-current'),
            'page',
          );
          // The current month, first day to last, and no `month=` in the address.
          const first = asked[0];
          assert.ok(first !== undefined, 'nothing was asked');
          assert.equal(first.searchParams.get('from'), `${THIS_MONTH}-01`);
          assert.equal(first.searchParams.get('to'), lastOf(THIS_MONTH));
          assert.equal(new URL(h.page.url()).searchParams.get('month'), null);
          assert.match(
            await g.locator('[data-tlg-caption]').innerText(),
            /^Everyone in Borealis Labs$/,
          );
          assert.match(await g.innerText(), /8h\+ full day/);
          assert.match(await g.innerText(), /Owners, admins and space admins · read-only/);
          // Every calendar day is a column, and a Total.
          assert.equal(
            await g.locator('thead th[data-tlg-day]').count(),
            Number(lastOf(THIS_MONTH).slice(8, 10)),
          );
          assert.equal(await g.locator('thead th.tlg-total').innerText(), 'Total');
          // A whole list: no cut-short note.
          assert.equal(await g.locator('[data-tlg-truncated]').count(), 0);
          // People A–Z as sent; the owner's role under their name.
          assert.deepEqual(await g.locator('tbody .tlg-name').allInnerTexts(), [
            'Bea Nkosi',
            'Pawan Sirsat',
          ]);
          assert.match(await h.page.locator('tr[data-person="u1"] .tlg-role').innerText(), /Owner/);
          // Today: the hours so far, with the neutral glyph and no verdict.
          const today = cell(h.page, 'u2', TODAY);
          assert.equal(await today.getAttribute('data-state'), 'today');
          assert.match(await today.innerText(), /1h 30m/);
          // › is disabled at the current month; ‹ names last month.
          assert.equal(await g.locator('[data-tlg-next]').getAttribute('aria-disabled'), 'true');
          assert.equal(
            await g.locator('[data-tlg-prev]').getAttribute('href'),
            `/insights?tab=time&view=days&month=${prevMonth(THIS_MONTH)}`,
          );
          const text = await g.innerText();
          assert.doesNotMatch(text, /utili[sz]|rank|\$|€|£/i);
          await noSideways(h.page, width);
          await shoot(h.page, `time-logging-owner-${theme}-${String(width)}`);
        } finally {
          await done(h);
        }
      });
    }
  }

  void test('‹ asks for last month and puts it in the address; › then comes back', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time&view=days', OWNER_STUB(), asked, (u) =>
      ok(thisMonth(u)),
    );
    try {
      const g = grid(h.page);
      await g.locator('tbody tr').first().waitFor({ timeout: 20_000 });
      const prev = prevMonth(THIS_MONTH);
      await g.locator('[data-tlg-prev]').click();
      await until(() => asked.length === 2);
      assert.equal(asked.length, 2, 'stepping back did not ask for the month');
      assert.equal(asked[1]?.searchParams.get('from'), `${prev}-01`);
      assert.equal(asked[1]?.searchParams.get('to'), lastOf(prev));
      assert.equal(new URL(h.page.url()).searchParams.get('month'), prev);
      await until(async () => (await g.locator('[data-tlg-next]').getAttribute('href')) !== null);
      assert.equal(
        await g.locator('[data-tlg-next]').getAttribute('href'),
        '/insights?tab=time&view=days',
        '› at a past month is a link to the current month',
      );
      await g.locator('[data-tlg-next]').click();
      await until(() => asked.length === 3);
      assert.equal(asked[2]?.searchParams.get('from'), `${THIS_MONTH}-01`);
      assert.equal(new URL(h.page.url()).searchParams.get('month'), null);
    } finally {
      await done(h);
    }
  });
});

void describe('every cell state, from the server’s facts', () => {
  void test('full, under, nothing, a Saturday with time, before joining, not yet, today — and the Total', async () => {
    const asked: URL[] = [];
    const h = await openWith(
      '/insights?tab=time&view=days&month=2026-10',
      OWNER_STUB(),
      asked,
      () => ok(OCT_FIXTURE),
    );
    try {
      const g = grid(h.page);
      await g.locator('tbody tr').first().waitFor({ timeout: 20_000 });
      assert.equal(asked[0]?.searchParams.get('from'), '2026-10-01');
      assert.equal(asked[0]?.searchParams.get('to'), '2026-10-31');
      assert.equal(await g.locator('[data-tlg-label]').innerText(), 'October 2026');
      const c = (day: string) => cell(h.page, 'u2', day);
      // What is drawn: the door's glyph and figure, or the dash — not the words for a screen reader.
      const stateAndText = async (day: string) => [
        await c(day).getAttribute('data-state'),
        (await c(day).locator('.tlg-cell, .tlg-dash > [aria-hidden="true"]').innerText())
          .replace(/\s+/g, ' ')
          .trim(),
      ];
      assert.deepEqual(await stateAndText('2026-10-12'), ['full', '✓ 9h']);
      assert.deepEqual(await stateAndText('2026-10-13'), ['under', '◷ 3h']);
      assert.deepEqual(await stateAndText('2026-10-14'), ['none', '✕']);
      assert.deepEqual(await stateAndText('2026-10-10'), ['off', '— 2h']);
      assert.deepEqual(await stateAndText('2026-10-11'), ['off', '—']);
      assert.deepEqual(await stateAndText('2026-10-02'), ['before', '—']);
      assert.deepEqual(await stateAndText('2026-10-16'), ['future', '—']);
      assert.deepEqual(await stateAndText('2026-10-15'), ['today', '— 1h 30m']);
      // The words, on hover and for a screen reader.
      assert.equal(
        await c('2026-10-12').locator('a').getAttribute('aria-label'),
        'Bea Nkosi, Mon 12 Oct: 9h, 8h or more, full day',
      );
      assert.equal(
        await c('2026-10-02').locator('.tlg-dash').getAttribute('title'),
        'Bea Nkosi, Fri 2 Oct: 8h, before they joined',
      );
      // Saturdays and Sundays are marked in the head; Friday is not.
      assert.equal(
        await g.locator('th[data-tlg-day="2026-10-10"]').getAttribute('data-weekend'),
        'true',
      );
      assert.equal(
        await g.locator('th[data-tlg-day="2026-10-11"]').getAttribute('data-weekend'),
        'true',
      );
      assert.equal(
        await g.locator('th[data-tlg-day="2026-10-09"]').getAttribute('data-weekend'),
        null,
      );
      // Every minute toward hours — before joining, the Saturday, today and
      // tomorrow included: 8h + 2h + 9h + 3h + 1h 30m + 8h; only due days (Mon
      // 5 – Wed 14: eight) toward days, and only the Monday reached 8h.
      const total = h.page.locator('tr[data-person="u2"] [data-tlg-total]');
      assert.match(await total.innerText(), /31h 30m/);
      assert.match(await total.innerText(), /1 \/ 8 days/);
      await shoot(h.page, 'time-logging-states');
      // A cell is a door to that person's Day.
      await c('2026-10-12').locator('a').click();
      await until(() => new URL(h.page.url()).pathname === '/people');
      const to = new URL(h.page.url());
      assert.equal(to.pathname, '/people');
      assert.equal(to.search, '?user=u2&tab=day&day=2026-10-12');
    } finally {
      await done(h);
    }
  });

  void test('a deactivated person: the hours, no days owed', async () => {
    const asked: URL[] = [];
    const h = await openWith(
      '/insights?tab=time&view=days&month=2026-10',
      OWNER_STUB(),
      asked,
      () =>
        ok({
          ...OCT_FIXTURE,
          people: [
            person('u3', 'Cleo Adams', {
              user: { id: 'u3', name: 'Cleo Adams', org_role: 'member', deactivated: true },
              joined_day: '2026-10-05',
              today_day: '2026-10-15',
              days: [{ day: '2026-10-12', confirmed_minutes: 480, drafted_minutes: 0 }],
            }),
          ],
        }),
    );
    try {
      const row = h.page.locator('tr[data-person="u3"]');
      await row.waitFor({ timeout: 20_000 });
      assert.match(await row.locator('.tlg-role').innerText(), /deactivated/);
      const total = row.locator('[data-tlg-total]');
      assert.match(await total.innerText(), /8h/);
      assert.doesNotMatch(await total.innerText(), /days/);
    } finally {
      await done(h);
    }
  });
});

void describe('who may look', () => {
  void test('a space admin: the segment, their people, and the lead caption', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time&view=days', LEAD_STUB(), asked, (u) =>
      ok(thisMonth(u, 'lead')),
    );
    try {
      const g = grid(h.page);
      await g.locator('tbody tr').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await g.locator('[data-tlg-caption]').innerText(),
        'People in the spaces you lead',
      );
      assert.equal(await h.page.locator('[data-time-view="days"]').count(), 1);
      await shoot(h.page, 'time-logging-lead');
    } finally {
      await done(h);
    }
  });

  void test('a member is refused the address, and nothing asks for anyone’s days', async () => {
    const asked: URL[] = [];
    const h = await openWith('/insights?tab=time&view=days', MEMBER_STUB(), asked, (u) =>
      ok(thisMonth(u)),
    );
    try {
      await h.page
        .getByText(/You do not have access to the Time report/)
        .waitFor({ timeout: 20_000 });
      assert.equal(await grid(h.page).count(), 0);
      assert.equal(asked.length, 0, 'a member session asked for the grid');
    } finally {
      await done(h);
    }
  });
});

void describe('the other states', () => {
  void test('a cut list says so; an empty month keeps the stepper', async () => {
    const asked: URL[] = [];
    let shape: 'cut' | 'empty' = 'cut';
    const h = await openWith('/insights?tab=time&view=days', OWNER_STUB(), asked, (u) =>
      ok(shape === 'cut' ? { ...thisMonth(u), truncated: true } : { ...thisMonth(u), people: [] }),
    );
    try {
      const g = grid(h.page);
      await g.locator('[data-tlg-truncated]').waitFor({ timeout: 20_000 });
      assert.equal(
        await g.locator('[data-tlg-truncated]').innerText(),
        'Showing the first 2 people, A–Z — the list was cut short.',
      );
      shape = 'empty';
      await g.locator('[data-tlg-prev]').click();
      await g.locator('[data-tlg-empty]').waitFor({ timeout: 20_000 });
      assert.match(
        await g.locator('[data-tlg-empty]').innerText(),
        /^Nobody has time in \w+ \d{4}\./,
      );
      assert.equal(await g.locator('[data-tlg-prev]').count(), 1, 'the stepper went with the grid');
      assert.equal(await g.locator('[data-tlg-truncated]').count(), 0);
      await shoot(h.page, 'time-logging-empty');
    } finally {
      await done(h);
    }
  });

  void test('the server’s error, and Retry asks again', async () => {
    const asked: URL[] = [];
    let fail = true;
    const h = await openWith('/insights?tab=time&view=days', OWNER_STUB(), asked, (u) =>
      fail
        ? { status: 500, body: { error: { code: 'internal', message: 'Something broke' } } }
        : ok(thisMonth(u)),
    );
    try {
      const retry = h.page.getByRole('button', { name: /retry|try again/i });
      await retry.waitFor({ timeout: 20_000 });
      assert.equal(asked.length, 1);
      fail = false;
      await retry.click();
      await until(() => asked.length === 2);
      assert.equal(asked.length, 2, 'Retry did not ask again');
      await grid(h.page).locator('tbody tr').first().waitFor({ timeout: 20_000 });
    } finally {
      await done(h);
    }
  });
});

void describe('on a phone', () => {
  void test('at 390 the days scroll under a pinned first column', async () => {
    const asked: URL[] = [];
    const h = await openWith(
      '/insights?tab=time&view=days',
      OWNER_STUB(),
      asked,
      (u) => ok(thisMonth(u)),
      390,
    );
    try {
      const g = grid(h.page);
      await g.locator('tbody tr').first().waitFor({ timeout: 20_000 });
      await noSideways(h.page, 390);
      const moved = await h.page.evaluate(() => {
        const scroll = document.querySelector('.tlg-scroll');
        const who = document.querySelector('tbody th.tlg-who');
        if (!(scroll instanceof HTMLElement) || !(who instanceof HTMLElement)) return null;
        const before = who.getBoundingClientRect().left;
        scroll.scrollLeft = 300;
        return { scrolled: scroll.scrollLeft, before, after: who.getBoundingClientRect().left };
      });
      assert.ok(moved !== null, 'the grid or its first column is missing');
      assert.ok(moved.scrolled > 0, 'the grid does not scroll sideways at 390');
      assert.ok(
        Math.abs(moved.after - moved.before) < 2,
        `the first column moved from ${String(moved.before)} to ${String(moved.after)}`,
      );
      await shoot(h.page, 'time-logging-390-scrolled');
    } finally {
      await done(h);
    }
  });
});
