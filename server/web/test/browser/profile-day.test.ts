/**
 * The profile's **Day** tab, in a real browser (SPEC §11.4.2.1, D-139 items
 * 6–7, LAI-1155; the owner's *Laika Profile*, frames D and G), on the pinned
 * clock (LAI-954):
 *
 *  - your own: *Edit in My day ›* for that date, tiles, the timeline with
 *    your lane and an Agents lane, the list, and the agents beside your hours
 *    — from `GET /me/time`, and nobody else's route;
 *  - someone else's: *Read-only · only <first> can change their day*, their
 *    drafts shown, nothing that writes — from `GET /people/:id/time`, the read
 *    the server logs as a `time` look (D-102 rule 1);
 *  - the stepper back, forward and to *Today*; the empty day for both;
 *  - every duration in hours, never `h:mm` (D-139 item 7, LAI-1147);
 *  - both themes, and a phone at 390px.
 *
 * Screenshots land in `LAIKA_SHOTS` when it is set.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, setTheme, type ApiStub, type Harness } from './harness.ts';
import { NOW, open, TODAY } from './my-day-clock.ts';

const DAY = 86_400_000;
const YESTERDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
const BEFORE = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 2 * DAY).toISOString().slice(0, 10);

void after(async () => {
  await closeBrowser();
});

const at = (hh: number, mm = 0, day = TODAY): number =>
  Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);

const profileOf = (id: string, name: string, org_role: string) => ({
  user: {
    id,
    name,
    email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
    org_role,
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
});

const SIGNALS = { prompts: 0, replies: 0, sessions: 0, commits: 0, marks: 0 };

const entry = (
  id: string,
  from: number,
  to: number,
  kind: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  day: TODAY,
  tz: 'UTC',
  started_at: from,
  ended_at: to,
  minutes: Math.round((to - from) / 60_000),
  source: 'manual',
  task: null,
  project: null,
  note: null,
  kind,
  title: null,
  description: null,
  revision: 1,
  created_at: 1,
  updated_at: 1,
  ...extra,
});

const draft = (id: string, from: number, to: number, extra: Record<string, unknown> = {}) => ({
  id,
  source: 'collector',
  day: TODAY,
  tz: 'UTC',
  started_at: from,
  ended_at: to,
  minutes: Math.round((to - from) / 60_000),
  task: null,
  task_key: null,
  project: null,
  general: false,
  signals: SIGNALS,
  note: null,
  ...extra,
});

/** One day's answer, the shape `/me/time` and `/people/:id/time` both give. */
function dayView(day: string, busy: boolean) {
  return {
    day,
    tz: 'UTC',
    today: TODAY,
    settings: {},
    drafts: busy
      ? [
          draft('d1', at(13, 0, day), at(14, 20, day), {
            task: { id: 't3', key: 'SKY-40', title: 'Decrypt test fails on large payloads' },
          }),
          draft('d2', at(14, 20, day), at(14, 52, day), { note: 'Thinking time' }),
        ]
      : [],
    entries: busy
      ? [
          entry('e1', at(8, 30, day), at(9, 0, day), 'meeting', { title: 'Stand-up' }),
          entry('e2', at(9, 0, day), at(10, 45, day), 'work', {
            task: { id: 't1', key: 'LAIKA-657', title: 'Settle and Confirm day summary' },
          }),
          entry('e3', at(10, 45, day), at(11, 30, day), 'review', {
            task: { id: 't2', key: 'LAIKA-1010', title: 'Board lane drag on touch' },
          }),
          entry('e4', at(12, 15, day), at(13, 0, day), 'meeting', { title: 'Weekly planning' }),
        ]
      : [],
    breaks: [],
    drafts_held: { count: 0, minutes: 0 },
    agent: {
      minutes: busy ? 130 : 0,
      keyboard_minutes: 0,
      by_task: busy
        ? [
            { task: { id: 't1', key: 'LAIKA-657', title: 'x' }, minutes: 70 },
            { task: { id: 't3', key: 'SKY-40', title: 'y' }, minutes: 42 },
          ]
        : [],
      unattributed_minutes: busy ? 18 : 0,
      lane: busy
        ? [
            [at(9, 30, day), 300, 300],
            [at(9, 35, day), 300, 300],
            [at(13, 30, day), 300, 0],
          ]
        : [],
    },
    state: busy ? 'drafted' : 'no_signal',
    week: [],
    timer: null,
    day_note: null,
  };
}

/** Ada (u1, the owner) reads; Hemant (u2) is someone else. Busy today, quiet before. */
function stub(): ApiStub {
  const routes: Record<string, unknown> = {
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/me': {
      id: 'u1',
      name: 'Ada Owner',
      email: 'ada@example.com',
      org_role: 'owner',
      is_active: true,
      created_at: 1,
      updated_at: 1,
      memberships: [],
    },
    '/api/v1/me/profile': profileOf('u1', 'Ada Owner', 'owner'),
    '/api/v1/users/u1/profile': profileOf('u1', 'Ada Owner', 'owner'),
    '/api/v1/users/u2/profile': profileOf('u2', 'Hemant Purohit', 'member'),
    '/api/v1/me/analytics-views': { data: [], next_cursor: null },
    '/api/v1/people/availability': { data: [] },
  };
  for (const [day, busy] of [
    [TODAY, true],
    [YESTERDAY, false],
    [BEFORE, true],
  ] as const) {
    const view = { ...dayView(day, busy), day };
    routes[`/api/v1/me/time?day=${day}`] = view;
    routes[`/api/v1/people/u2/time?day=${day}`] = view;
  }
  return routes;
}

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** The page, and every `/api/` URL it asked for with its query — `calls` keeps the path only. */
async function openAt(
  path: string,
  width = 1440,
): Promise<Harness & { readonly urls: readonly URL[] }> {
  const urls: URL[] = [];
  const h = await open(path, stub(), {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
      page.on('request', (r) => {
        const url = new URL(r.url());
        if (url.pathname.startsWith('/api/')) urls.push(url);
      });
    },
  });
  return { ...h, urls };
}

/** The `day` of every request to `path`, in order. */
const daysAsked = (h: { readonly urls: readonly URL[] }, path: string): (string | null)[] =>
  h.urls.filter((u) => u.pathname === path).map((u) => u.searchParams.get('day'));

const writes = (h: Harness) => h.calls.filter((c) => c.method !== 'GET');
const asked = (h: Harness, path: string) => h.calls.filter((c) => c.path === path).length;

async function ready(page: Page): Promise<void> {
  await page.locator('[data-profile-day] [data-pday-table]').waitFor({ timeout: 20_000 });
}

/** The first match's text, its whitespace folded. */
const text = async (page: Page, selector: string): Promise<string> =>
  (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ').trim();

/** A duration written as a clock: `1:45`. The Day tab writes hours. */
const H_MM = /\d:\d\d(?!:)/;

void describe('your own Day (frame D)', () => {
  for (const theme of ['Dark', 'Light'] as const) {
    void test(`tiles, timeline, list and agents, from GET /me/time (${theme})`, async () => {
      const h = await openAt(`/people?user=u1&tab=day`);
      try {
        await ready(h.page);
        await setTheme(h.page, theme);
        assert.deepEqual(daysAsked(h, '/api/v1/me/time'), [TODAY]);
        assert.equal(asked(h, '/api/v1/people/u1/time'), 0, 'your own day asked as a look');

        assert.equal(await text(h.page, '[data-pday-date]'), `${dayName(TODAY)} · today`);
        assert.equal(await h.page.locator('[data-pday-next]').isDisabled(), true);
        assert.equal(await h.page.locator('[data-pday-today]').count(), 0);
        const edit = h.page.locator('[data-profile-edit-day]');
        assert.equal(await edit.getAttribute('href'), `/my-day?day=${TODAY}`);
        assert.equal((await edit.innerText()).trim(), 'Edit in My day');
        assert.equal(await h.page.locator('[data-pday-readonly]').count(), 0);

        // 3h 45m confirmed + 1h 52m drafted; the meetings are 30m + 45m.
        assert.deepEqual(
          await h.page
            .locator('[data-pday-tile]')
            .evaluateAll((els) => els.map((el) => el.textContent)),
          ['Tracked5h 37m', 'Confirmed3h 45m', 'Drafts1h 52m', 'Meetings1h 15m'],
        );

        assert.equal(await text(h.page, '[data-pday-lane]'), 'You');
        assert.equal(await h.page.locator('[data-pday-block="confirmed"]').count(), 4);
        assert.equal(await h.page.locator('[data-pday-block="draft"]').count(), 2);
        assert.equal(
          await h.page
            .locator('[data-pday-block="draft"]')
            .first()
            .evaluate((el) => getComputedStyle(el).borderTopStyle),
          'dashed',
        );
        // Coloured by its kind: the meeting block wears --kind-meeting.
        const [border, token] = await h.page
          .locator('[data-pday-block="confirmed"][data-kind="meeting"]')
          .first()
          .evaluate((el) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--kind-meeting)';
            el.appendChild(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return [getComputedStyle(el).borderTopColor, want];
          });
        assert.equal(border, token);
        assert.equal(await h.page.locator('[data-pday-agents] .pday-agent').count(), 2);
        assert.equal(await h.page.locator('[data-pday-now]').count(), 1);
        assert.equal(await h.page.locator('[data-pday-timeline]').getAttribute('data-from'), '8');
        assert.equal(await h.page.locator('[data-pday-timeline]').getAttribute('data-to'), '18');
        assert.match(
          await text(h.page, '.pday-legend'),
          /Confirmed Draft Colour is the kind; it is also written in the list below\./,
        );

        const rows = h.page.locator('[data-pday-row]');
        assert.equal(await rows.count(), 6);
        assert.deepEqual(await rows.locator('[data-pday-when]').allInnerTexts(), [
          '08:30–09:00',
          '09:00–10:45',
          '10:45–11:30',
          '12:15–13:00',
          '13:00–14:20',
          '14:20–14:52',
        ]);
        assert.deepEqual(await rows.locator('[data-pday-duration]').allInnerTexts(), [
          '30m',
          '1h 45m',
          '45m',
          '45m',
          '1h 20m',
          '32m',
        ]);
        for (const cell of [
          ...(await rows.locator('[data-pday-duration]').allInnerTexts()),
          ...(await h.page.locator('[data-pday-tile] dd').allInnerTexts()),
        ]) {
          assert.doesNotMatch(cell, H_MM, `a duration as a clock: ${cell}`);
        }
        assert.equal(
          await text(h.page, '[data-pday-row]:nth-child(3) [data-pday-what]'),
          'LAIKA-657 Settle and Confirm day summary',
        );
        // A draft has no kind in the API: a dash, never a guess.
        assert.deepEqual(
          await h.page.locator('[data-pday-row="draft"] [data-pday-kind]').allInnerTexts(),
          ['—', '—'],
        );
        assert.deepEqual(
          await h.page.locator('[data-pday-row="confirmed"] [data-pday-kind]').allInnerTexts(),
          ['Meeting', 'Work', 'Review', 'Meeting'],
        );
        assert.match(await text(h.page, '[data-pday-row="draft"] .pday-status'), /Draft/);
        assert.match(await text(h.page, '[data-pday-row="confirmed"] .pday-status'), /Confirmed/);

        assert.equal(
          await text(h.page, '[data-pday-agents-line]'),
          '›_ Agents · 1h 52m on cards — beside your hours, never added to them',
        );
        assert.deepEqual(writes(h), []);
        await shoot(h.page, `profile-day-own-${theme.toLowerCase()}-1440`);
      } finally {
        await h.close();
      }
    });
  }

  void test('Edit in My day › opens My day on that date', async () => {
    const h = await openAt(`/people?user=u1&tab=day&day=${BEFORE}`);
    try {
      await ready(h.page);
      await h.page.locator('[data-profile-edit-day]').click();
      await h.page.waitForURL(
        (u) => u.pathname === '/my-day' && u.searchParams.get('day') === BEFORE,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('someone else’s Day (frame G)', () => {
  for (const theme of ['Dark', 'Light'] as const) {
    void test(`read-only, their drafts shown, from GET /people/:id/time (${theme})`, async () => {
      const h = await openAt(`/people?user=u2&tab=day`);
      try {
        await ready(h.page);
        await setTheme(h.page, theme);
        assert.deepEqual(daysAsked(h, '/api/v1/people/u2/time'), [TODAY]);
        assert.equal(asked(h, '/api/v1/me/time'), 0, 'the reader’s own day asked instead');

        assert.equal(
          await text(h.page, '[data-pday-readonly]'),
          'Read-only · only Hemant can change their day',
        );
        assert.equal(await h.page.locator('[data-profile-edit-day]').count(), 0);
        assert.equal(await text(h.page, '[data-pday-lane]'), 'Hemant');
        assert.equal(await h.page.locator('[data-pday-row="draft"]').count(), 2);
        assert.equal(
          await text(h.page, '[data-pday-row="draft"] [data-pday-what]'),
          'SKY-40 Decrypt test fails on large payloads',
        );
        // Nothing on the panel writes: no button but the stepper's, no input.
        assert.deepEqual(
          await h.page
            .locator('[data-profile-day] button')
            .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent)),
          ['Previous day', 'Next day'],
        );
        assert.equal(
          await h.page.locator('[data-profile-day] input, [data-profile-day] textarea').count(),
          0,
        );
        assert.equal(
          await text(h.page, '[data-pday-agents-line]'),
          '›_ Agents · 1h 52m on cards — beside Hemant’s hours, never added to them',
        );
        assert.deepEqual(writes(h), []);
        await shoot(h.page, `profile-day-other-${theme.toLowerCase()}-1440`);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the stepper', () => {
  void test('back a day, forward again, and Today', async () => {
    const h = await openAt(`/people?user=u2&tab=day`);
    try {
      await ready(h.page);
      await h.page.locator('[data-pday-prev]').click();
      await h.page.waitForURL((u) => u.searchParams.get('day') === YESTERDAY);
      await h.page.locator('[data-pday-empty]').waitFor({ timeout: 10_000 });
      assert.equal(await text(h.page, '[data-pday-date]'), dayName(YESTERDAY));
      assert.equal(await h.page.locator('[data-pday-next]').isDisabled(), false);
      assert.equal(await h.page.locator('[data-pday-today]').count(), 1);

      await h.page.locator('[data-pday-prev]').click();
      await h.page.waitForURL((u) => u.searchParams.get('day') === BEFORE);
      await ready(h.page);
      assert.equal(await h.page.locator('[data-pday-now]').count(), 0, 'a now line on a past day');

      await h.page.locator('[data-pday-next]').click();
      await h.page.waitForURL((u) => u.searchParams.get('day') === YESTERDAY);
      await h.page.locator('[data-pday-empty]').waitFor({ timeout: 10_000 });

      await h.page.locator('[data-pday-today]').click();
      await h.page.waitForURL((u) => u.searchParams.get('day') === TODAY);
      await ready(h.page);
      assert.equal(await text(h.page, '[data-pday-date]'), `${dayName(TODAY)} · today`);
      assert.equal(await h.page.locator('[data-pday-next]').isDisabled(), true);
      assert.equal(await h.page.locator('[data-pday-today]').count(), 0);
      // Each day asked of her route, by date, and never the reader's own.
      assert.deepEqual(daysAsked(h, '/api/v1/people/u2/time'), [
        TODAY,
        YESTERDAY,
        BEFORE,
        YESTERDAY,
        TODAY,
      ]);
      assert.equal(asked(h, '/api/v1/me/time'), 0);
      assert.deepEqual(writes(h), []);
    } finally {
      await h.close();
    }
  });
});

void describe('an empty day', () => {
  void test('your own says where time comes from', async () => {
    const h = await openAt(`/people?user=u1&tab=day&day=${YESTERDAY}`);
    try {
      await h.page.locator('[data-pday-empty]').waitFor({ timeout: 20_000 });
      assert.equal(
        await text(h.page, '[data-pday-empty]'),
        `No time on ${shortName(YESTERDAY)} Nothing tracked or drafted. Add time or let drafts arrive from your agents in My day.`,
      );
      assert.equal(await h.page.locator('[data-pday-table], [data-pday-tile]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('someone else’s names them', async () => {
    const h = await openAt(`/people?user=u2&tab=day&day=${YESTERDAY}`);
    try {
      await h.page.locator('[data-pday-empty]').waitFor({ timeout: 20_000 });
      assert.equal(
        await text(h.page, '[data-pday-empty]'),
        `No time on ${shortName(YESTERDAY)} Hemant tracked nothing and has no drafts on this day.`,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a phone, 390px', () => {
  for (const theme of ['Dark', 'Light'] as const) {
    void test(`labels hidden, every third hour, three columns (${theme})`, async () => {
      const h = await openAt(`/people?user=u1&tab=day`, 390);
      try {
        await ready(h.page);
        await setTheme(h.page, theme);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(overflow <= 0, `scrolls sideways by ${String(overflow)}px`);
        assert.equal(
          await h.page
            .locator('.pday-block-label')
            .first()
            .evaluate((el) => getComputedStyle(el).display),
          'none',
        );
        assert.deepEqual(
          await h.page
            .locator('.pday-tick')
            .evaluateAll((els) =>
              els
                .filter((el) => getComputedStyle(el).display !== 'none')
                .map((el) => el.textContent),
            ),
          ['08:00', '11:00', '14:00', '17:00'],
        );
        const lane = await h.page.locator('[data-pday-lane]').boundingBox();
        assert.ok(
          lane !== null && Math.abs(lane.width - 56) < 1,
          `lane name ${String(lane?.width)}px`,
        );
        assert.equal(
          await h.page.locator('.pday-row-head').evaluate((el) => getComputedStyle(el).display),
          'none',
        );
        // What spans the row; When, Kind and Duration share the line under it.
        const row = h.page.locator('[data-pday-row]').nth(1);
        const [rowBox, whatBox, whenBox, durBox] = await Promise.all([
          row.boundingBox(),
          row.locator('[data-pday-what]').boundingBox(),
          row.locator('[data-pday-when]').boundingBox(),
          row.locator('[data-pday-duration]').boundingBox(),
        ]);
        assert.ok(rowBox && whatBox && whenBox && durBox);
        assert.ok(whatBox.y < whenBox.y, 'What is not above When');
        assert.ok(Math.abs(whenBox.y - durBox.y) < 4, 'When and Duration are not on one line');
        assert.ok(whatBox.width > rowBox.width * 0.9, 'What does not span the row');
        await shoot(h.page, `profile-day-own-${theme.toLowerCase()}-390`);
      } finally {
        await h.close();
      }
    });
  }
});

function dayName(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function shortName(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
