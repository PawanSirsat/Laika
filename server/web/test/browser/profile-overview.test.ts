/**
 * The profile's Overview as rows, in a real browser (LAI-1153, D-139, SPEC
 * §11.4.2.1): Work + This week · Projects + Agents · Activity · Review for
 * others + LLM tokens, each row's cards one height, one column on a phone.
 *
 * Three people, as the design draws them: a busy one read by an owner (frame
 * A), a new member (frame B) and the owner's own profile (frame G). Every
 * figure on the page is one these fixtures carry; figures that sit side by
 * side are given different values so a card showing one under another's label
 * fails rather than matching by coincidence.
 *
 * **This week is two numbers on an empty track** (D-131 item 4): the tests
 * assert the track holds nothing and that no element in the card is sized as
 * a share of anything sideways. **Durations are hours** (D-139 item 7): no
 * `h:mm` anywhere in the rows.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  open as openPage,
  setTheme,
  until,
  type ApiStub,
} from './harness.ts';

const NOW = Date.now();

/** Every page runs on a clock pinned to `NOW`, so every age is exact (LAI-830). */
const open: typeof openPage = (path, stub, options = {}) =>
  openPage(path, stub, {
    ...options,
    before: async (page) => {
      await page.clock.setFixedTime(NOW);
      await options.before?.(page);
    },
  });

void after(async () => {
  await closeBrowser();
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Monday 00:00 UTC of this week, as the server counts the profile's window. */
const MONDAY = (() => {
  const d = new Date(NOW);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
})();
const SINCE = MONDAY - 11 * WEEK;

/**
 * The reader's week, as the page works it out: today in the browser's zone,
 * which is this process's, then Monday to Sunday around it.
 */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(NOW);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const WEEK_DAYS = (() => {
  const back = (new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(TODAY, i - back));
})();

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
  memberships: [{ project_id: 'p1', role: 'lead' }],
});

const OWNER = person('u1', 'Ada Owner', 'owner');

const task = (n: number, key: string, startedAgo: number, reviewAgo: number | null = null) => ({
  id: `t${String(n)}`,
  key: `${key}-${String(n)}`,
  title: `Task number ${String(n)}`,
  project_slug: 'laika',
  status: reviewAgo === null ? 'in_progress' : 'review',
  status_name: reviewAgo === null ? 'In progress' : 'Review',
  started_at: NOW - startedAgo,
  review_since: reviewAgo === null ? null : NOW - reviewAgo,
});

const project = (
  id: string,
  name: string,
  key: string,
  role: string | null,
  open: number,
  minutes: number | undefined,
  accepted: number,
  reviewed: number,
) => ({
  id,
  slug: name.toLowerCase().replace(/[^a-z]+/g, '-'),
  name,
  key,
  role,
  archived: false,
  open_tasks: open,
  accepted,
  reviewed,
  ...(minutes === undefined ? {} : { minutes_14d: minutes }),
});

const ACCEPTED = [0, 0, 3, 0, 0, 29, 2, 0, 49, 0, 1, 1];
const SENT_BACK = [0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0];

/** Frame A: a busy builder, read by an owner. */
const BUSY = {
  user: {
    id: 'u2',
    name: 'Lindiwe Dube',
    email: 'lindiwe@example.com',
    org_role: 'admin',
    is_active: true,
    profile_kind: 'builder',
    created_at: NOW - 250 * DAY,
  },
  window: { weeks: 12, since: SINCE, until: NOW },
  projects: [
    project('p4', 'RMB', 'RMB', 'member', 2, 40, 0, 0),
    project('p1', 'Laika', 'LAIKA', 'lead', 46, 2300, 31, 212),
    project('p5', 'Waybill', 'WAY', 'member', 0, 0, 0, 0),
    project('p3', 'Skynet', 'SKY', 'lead', 9, 370, 2, 2),
    project('p6', 'Admin Internal', 'ADMI', 'member', 0, undefined, 0, 0),
  ],
  review: {
    accepted: 82,
    sent_back: 3,
    last_30_days: 54,
    per_week: ACCEPTED.map((accepted, i) => ({
      week_start: SINCE + i * WEEK,
      accepted,
      sent_back: SENT_BACK[i]!,
    })),
    time_to_decide: { measured: 80, unmeasured: 5, p50_ms: 7 * DAY + 11 * HOUR },
    recent: [],
  },
  ratings: [],
  ratings_total: 0,
  activity_sharing: { org_enabled: false, enabled: false },
  current_work: {
    // Oldest start first, as the server sends them: the first is 21 d 1 h old.
    in_progress: Array.from({ length: 12 }, (_, i) =>
      task(i + 1, 'SKY', 21 * DAY + HOUR - i * DAY),
    ),
    in_progress_total: 12,
    // The server's cap is 50; there are 330.
    in_review: Array.from({ length: 50 }, (_, i) =>
      task(100 + i, 'LAIKA', 30 * DAY, 9 * DAY - i * HOUR),
    ),
    in_review_total: 330,
    due_7d: 5,
  },
  delivery: {
    accepted_per_week: [],
    accepted: 82,
    sent_back: 4,
    reopened: 1,
    cycle_time: {
      measured: 60,
      unmeasured: 361,
      p50_ms: 6 * DAY + 8 * HOUR,
      p75_ms: 9 * DAY + 20 * HOUR,
    },
  },
  agents: {
    tokens: [
      ['k1', 'claude-code', NOW - MIN],
      ['k2', 'claude-code', NOW - 2 * DAY],
      ['k3', 'omnigent', NOW - 9 * MIN],
      ['k4', 'codex', NOW - 3 * DAY],
    ].map(([id, client, used]) => ({
      id,
      name: `Token ${String(id)}`,
      client,
      client_name: null,
      last_used_at: used,
      last_mcp_at: null,
      created_at: NOW - 100 * DAY,
    })),
    tokens_total: 4,
    online: { enabled: true, clients: ['claude-code'], last_seen: NOW - MIN },
    writes: [],
    writes_total: 0,
  },
};

/** Frame B: a manager who joined four days ago, with work and nothing else. */
const NEW_MEMBER = {
  ...BUSY,
  user: {
    ...BUSY.user,
    id: 'u3',
    name: 'Naledi Mokoena',
    email: 'naledi@example.com',
    org_role: 'member',
    profile_kind: 'manager',
    created_at: NOW - 4 * DAY,
  },
  projects: [
    project('p7', 'Human Resources', 'HR', 'member', 9, undefined, 0, 0),
    project('p8', 'Admin', 'ADMI', 'member', 4, undefined, 0, 0),
  ],
  review: {
    accepted: 0,
    sent_back: 0,
    last_30_days: 0,
    per_week: ACCEPTED.map((_, i) => ({ week_start: SINCE + i * WEEK, accepted: 0, sent_back: 0 })),
    time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
    recent: [],
  },
  current_work: {
    in_progress: Array.from({ length: 7 }, (_, i) =>
      task(200 + i, 'HR', 2 * DAY + 14 * HOUR - i * HOUR),
    ),
    in_progress_total: 7,
    in_review: Array.from({ length: 6 }, (_, i) => task(300 + i, 'HR', 3 * DAY, DAY)),
    in_review_total: 6,
    due_7d: 0,
  },
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
};

/** Frame G: the owner's own profile — busy, as the design draws it. */
const OWN = {
  ...BUSY,
  user: { ...BUSY.user, id: 'u1', name: 'Ada Owner', email: 'ada@example.com', org_role: 'owner' },
  agents: { ...NEW_MEMBER.agents },
};

const usage = (userId: string, tokens: number) => ({
  user_id: userId,
  from: '2026-08-17',
  to: '2026-11-08',
  weeks: Array.from({ length: 12 }, (_, i) => ({
    start: new Date(Date.UTC(2026, 7, 17 + 7 * i)).toISOString().slice(0, 10),
    tokens: i < 6 ? 0 : tokens / 6,
    cache_read: 0,
  })),
  totals: {
    tokens,
    input: tokens / 2,
    output: tokens / 4,
    cache_write: tokens / 4,
    cache_read: tokens * 40,
    attributed_tokens: tokens * 0.28,
    cost: {
      usd: tokens === 0 ? 0 : 2212,
      unpriced_tokens: 0,
      unpriced_models: [],
      unconfirmed_models: [],
    },
  },
  by_agent:
    tokens === 0
      ? []
      : [
          { agent: 'claude-code', tokens: 74_000_000, cache_read: 0 },
          { agent: 'omnigent', tokens: 25_800_000, cache_read: 0 },
          { agent: 'codex', tokens: 190_000, cache_read: 0 },
        ],
  by_model:
    tokens === 0
      ? []
      : [
          { model: 'claude-opus-5-5', tokens: 92_200_000, cache_read: 0, cost: 2000 },
          { model: 'claude-fable-5-1', tokens: 7_790_000, cache_read: 0, cost: 212 },
        ],
  no_token_data: [],
  sharing: { org_enabled: true, enabled: true },
});

/** Each day's [confirmed, drafted] minutes this week: 36 h 58 min tracked in all. */
const DAYS: readonly (readonly [number, number])[] = [
  [520, 0],
  [455, 15],
  [498, 40],
  [430, 25],
  [140, 95],
  [0, 0],
  [0, 0],
];

const report = (minutes: readonly (readonly [number, number])[], agents: number) => {
  const byDay = WEEK_DAYS.map((day, i) => ({
    day,
    confirmed_minutes: minutes[i]![0],
    drafted_minutes: minutes[i]![1],
  })).filter((d) => d.confirmed_minutes + d.drafted_minutes > 0);
  const confirmed = byDay.reduce((n, d) => n + d.confirmed_minutes, 0);
  const drafted = byDay.reduce((n, d) => n + d.drafted_minutes, 0);
  return {
    from: WEEK_DAYS[0],
    to: WEEK_DAYS[6],
    days: 7,
    scope: 'people',
    include_drafts: true,
    totals: {
      confirmed_minutes: confirmed,
      drafted_minutes: drafted,
      meeting_minutes: 0,
      manual_minutes: 0,
      active_days: byDay.length,
      people: 1,
    },
    agent_minutes: agents,
    by_day: byDay,
    rows: [],
  };
};

const quietYear = () => ({
  range: '12w',
  start: '2026-08-17',
  end: TODAY,
  tz: 'UTC',
  sharing: { org_enabled: false, enabled: false },
  series: {
    github: null,
    local_commits: null,
    prompts: null,
    sessions: null,
    board_self: new Array<number>(84).fill(0),
    board_agent: new Array<number>(84).fill(0),
  },
  prompts_by_agent: {},
  agents: [],
});

const BASE: ApiStub = {
  '/api/v1/me': OWNER,
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/people/u1/activity': quietYear,
  '/api/v1/people/u2/activity': quietYear,
  '/api/v1/people/u3/activity': quietYear,
};

/** The page's stub for one profile: the profile, its usage, and its week. */
/**
 * Someone else's load, as an analytics reader's pill reads it (LAI-1159): one
 * person, never the list that logs everyone. This week takes the hours they set
 * and their time away from this same read rather than asking again.
 */
const loadOf = (workWeek: number | null, away: readonly { from: string; to: string }[]) => {
  const availability = {
    status: 'capacity',
    away: null,
    hours_per_week: null,
    note: null,
    tags: [],
    work_week:
      workWeek === null
        ? null
        : { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', minutes: workWeek },
    away_periods: away.map((a, i) => ({ id: `a${String(i)}`, ...a })),
    updated_at: NOW - DAY,
  };
  return {
    availability,
    projects: [],
    cards: { in_progress: 0, in_review: 0, due_7d: 0 },
    week: {
      from: WEEK_DAYS[0],
      to: WEEK_DAYS[6],
      confirmed_minutes: 0,
      drafted_minutes: 0,
      set_minutes: workWeek,
    },
    away,
  };
};

const AWAY = [{ from: '2026-11-20', to: '2026-11-23' }];

function stubFor(
  profile: { readonly user: { readonly id: string } },
  options: {
    tokens: number;
    week: readonly (readonly [number, number])[];
    agents: number;
    load?: ReturnType<typeof loadOf>;
  },
): ApiStub {
  const id = profile.user.id;
  return {
    ...BASE,
    [`/api/v1/people/${id}/load`]: options.load ?? loadOf(2400, AWAY),
    // The list answers too, with the same row, so a page that read it would
    // draw the same figures: only the call count can tell (LAI-1159).
    '/api/v1/people/availability': {
      data: [
        {
          user: { id, name: 'Someone' },
          availability: (options.load ?? loadOf(2400, AWAY)).availability,
          spaces: [],
        },
      ],
    },
    [`/api/v1/users/${id}/profile`]: profile,
    // Your own profile is read as yours (D-139 item 1, LAI-1150).
    ...(id === OWNER.id ? { '/api/v1/me/profile': profile, '/api/v1/me/activity': quietYear } : {}),
    [`/api/v1/users/${id}/usage`]: usage(id, options.tokens),
    // The one read This week makes: this person, with drafts (D-139 item 4).
    [`/api/v1/time/report?members=${id}&drafts=include`]: report(options.week, options.agents),
  };
}

async function card(page: Page, name: string) {
  const found = page.locator(`.prof-card[data-section="${name}"]`);
  await found.waitFor({ timeout: 20_000 });
  return found;
}

const tile = async (page: Page, name: string) =>
  (await page.locator(`[data-stat="${name}"] .prof-stat-value`).innerText()).trim();

/** Each card's box, by section, for the row checks. */
async function boxes(page: Page) {
  return page.locator('.ov .ov-card').evaluateAll((els) =>
    Object.fromEntries(
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return [
          el.getAttribute('data-section') ?? '',
          { top: Math.round(r.top), left: Math.round(r.left), height: Math.round(r.height) },
        ];
      }),
    ),
  );
}

/** Rows that share a height: same top, same height, side by side. */
async function assertRows(page: Page, where: string) {
  const b = await boxes(page);
  for (const [a, c] of [
    ['work', 'week'],
    ['projects', 'agents'],
    ['review', 'tokens'],
  ] as const) {
    const left = b[a];
    const right = b[c];
    assert.ok(left !== undefined && right !== undefined, `${where}: ${a} and ${c} are drawn`);
    assert.equal(left.top, right.top, `${where}: ${a} and ${c} share a row`);
    assert.ok(Math.abs(left.height - right.height) <= 1, `${where}: ${a} and ${c} share a height`);
    assert.ok(left.left < right.left, `${where}: ${a} is left of ${c}`);
  }
}

/** No `h:mm` anywhere in the Overview's rows (D-139 item 7); Activity is LAI-1154's. */
async function assertNoClockDurations(page: Page) {
  const text = (
    await page
      .locator('.ov .ov-row')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText))
  ).join('\n');
  // A time of day always carries AM or PM here (LAI-830); anything else is a
  // duration written as a clock — `8:40`, `38:20` — which the design drew.
  assert.doesNotMatch(text, /\d:\d\d(?!\s?[AP]M)/, 'a duration reads as a clock');
}

// ---------------------------------------------------------------- frame A

void describe('someone else’s busy profile (frame A)', () => {
  void test('rows share a height, both themes, and every card carries its figures', async () => {
    const h = await open(
      '/people?user=u2',
      stubFor(BUSY, { tokens: 128_000_000, week: DAYS, agents: 242 }),
    );
    try {
      await h.page.setViewportSize({ width: 1440, height: 1000 });
      const work = await card(h.page, 'work');
      const week = await card(h.page, 'week');
      await until(async () => (await week.locator('[data-week-total]').count()) === 1, 15_000);
      await card(h.page, 'tokens');
      await until(async () => (await h.page.locator('[data-stat="tokens"]').count()) === 1);

      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 1440, height: 1000 });
        await assertRows(h.page, `1440 ${theme}`);
      }

      // ---- Work: tiles that are tabs, five rows, the footer.
      const tabs = work.getByRole('tab');
      assert.deepEqual(
        (await tabs.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
        ['In progress 12', 'In review 330', 'Due in 7 days 5'],
      );
      assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
      assert.match(
        await work.locator('.prof-card-caption').innerText(),
        /^oldest started 21 d 1 h$/,
      );
      assert.equal(await work.locator('.ov-work-row').count(), 5);
      assert.match(
        await work.locator('.ov-work-row').first().innerText(),
        /SKY-1.*Task number 1.*21 d 1 h/s,
      );
      assert.equal(
        (await work.locator('[data-delivered]').innerText()).replace(/\s+/g, ' ').trim(),
        'Delivered · 12 weeks · 82 accepted · 1 reopened · cycle p50 6 d 8 h, p75 9 d 20 h · 361 done with no recorded start, counted but not measured',
      );

      // Show all opens the rest inside the card, in a scroll of its own.
      await work.getByRole('button', { name: 'Show all 12' }).click();
      assert.equal(await work.locator('.ov-work-row').count(), 12);
      await work.getByRole('button', { name: 'Show fewer' }).click();
      assert.equal(await work.locator('.ov-work-row').count(), 5);

      // In review: waiting ages, and the server's cap said in the design's words.
      await tabs.nth(1).click();
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
      assert.match(await work.locator('.ov-work-row').first().innerText(), /waiting 9 d/);
      await work.getByRole('button', { name: 'Show all 330' }).click();
      assert.equal(await work.locator('.ov-work-row').count(), 50);
      assert.equal(
        (await work.locator('.prof-more').innerText()).trim(),
        'Showing 50 of 330, oldest first. Open in Work to filter the rest.',
      );
      const panel = await work.locator('.ov-work-panel').evaluate((el) => ({
        scroll: el.scrollHeight,
        client: el.clientHeight,
        max: getComputedStyle(el).maxHeight,
      }));
      assert.ok(panel.scroll > panel.client, 'the opened list scrolls inside the card');
      assert.notEqual(panel.max, 'none', 'and the scroll is bounded');

      // Due in 7 days: the count, and Work for the list the profile does not serve.
      await tabs.nth(2).click();
      assert.match(
        await work.locator('[data-work-due]').innerText(),
        /^5 due in the next 7 days\. See them in Work$/,
      );
      assert.equal(await work.locator('.ov-work-row').count(), 0);

      // ---- This week: two numbers on an empty track.
      await until(async () =>
        (await week.locator('[data-week-total]').innerText()).includes('set'),
      );
      assert.equal(
        (await week.locator('[data-week-total]').innerText()).replace(/\s+/g, ' ').trim(),
        '36 h 58 min tracked · 40 h set',
      );
      assert.equal(
        (await week.locator('[data-away]').innerText()).replace(/\s+/g, ' ').trim(),
        'Away Fri 20 – Mon 23 Nov',
      );
      // An analytics reader never reads the list, which would log a look at
      // everyone on it (LAI-1159); the hours and away dates are the pill's one
      // load, read once, not again for this card.
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/people/availability').length,
        0,
        'someone else’s Overview read the whole availability list',
      );
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/people/u2/load').length,
        1,
        'the load was read more than once',
      );
      const track = week.locator('[data-week-track]');
      assert.equal(await track.count(), 1);
      assert.equal(
        await track.evaluate((el) => el.childElementCount),
        0,
        'the track holds nothing',
      );
      assert.equal(
        await week.evaluate(
          (el) =>
            [el, ...el.querySelectorAll('*')].filter((n) =>
              /width:\s*[\d.]+%/.test((n as HTMLElement).getAttribute('style') ?? ''),
            ).length,
        ),
        0,
        'no element in This week is sized as a share sideways',
      );
      const days = week.locator('.ov-day');
      assert.equal(await days.count(), 7);
      assert.deepEqual(
        await days.evaluateAll((els) => els.map((el) => el.getAttribute('data-day'))),
        WEEK_DAYS,
      );
      assert.equal(
        await week.locator(`.ov-day[data-today="true"]`).getAttribute('data-day'),
        TODAY,
      );
      assert.match(await days.nth(0).innerText(), /8h 40m/);
      // Drafts hatched beside the solid confirmed part, on the days that have them.
      assert.equal(await days.nth(4).locator('.ov-day-draft').count(), 1);
      assert.equal(await days.nth(0).locator('.ov-day-draft').count(), 0);
      assert.equal(
        (await week.locator('[data-fact="confirmed"] dd').innerText()).trim(),
        '34 h 3 min',
      );
      assert.equal(
        (await week.locator('[data-fact="drafts"] dd').innerText()).trim(),
        '2 h 55 min',
      );
      // Agents apart, in minutes (D-088 item 8), never added to the person's.
      assert.equal((await week.locator('[data-fact="agents"] dd').innerText()).trim(), '242 min');
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/time/report'),
        'This week is one time report read',
      );
      assert.deepEqual(h.unmatched, [], 'the report asked for this person with drafts');

      // ---- Projects: the table, open first, the quiet fold.
      const projects = await card(h.page, 'projects');
      const rows = projects.locator('[role="rowgroup"] + [role="rowgroup"] > .ov-project');
      assert.deepEqual(
        await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-project'))),
        ['laika', 'skynet', 'rmb'],
      );
      const laika = await rows
        .nth(0)
        .evaluate((el): Record<string, string> =>
          Object.fromEntries(
            [...el.querySelectorAll('[data-col]')].map((c): [string, string] => [
              c.getAttribute('data-col') ?? '',
              (c as HTMLElement).innerText.trim(),
            ]),
          ),
        );
      assert.deepEqual(laika, {
        role: 'Space admin',
        open: '46',
        hours: '38h 20m',
        accepted: '31',
        reviewed: '212',
      });
      const fold = projects.locator('[data-quiet]');
      assert.equal(
        (await fold.innerText()).replace(/\s+/g, ' ').trim(),
        '› 2 quiet projects nothing open or tracked · Admin Internal, Waybill',
      );
      assert.equal(await fold.getAttribute('aria-expanded'), 'false');
      await fold.click();
      assert.equal(await fold.getAttribute('aria-expanded'), 'true');
      assert.equal(await projects.locator('.ov-project[data-project="waybill"]').count(), 1);
      assert.equal(
        (
          await projects
            .locator('.ov-project[data-project="waybill"] [data-col="hours"]')
            .innerText()
        ).trim(),
        '—',
      );

      // ---- Agents: the share of LLM tokens, a row per tool.
      const agents = await card(h.page, 'agents');
      await until(async () => (await agents.locator('.prof-share-part').count()) === 3);
      assert.equal(await agents.locator('.prof-card-caption').innerText(), '3 tools · 1 online');
      assert.match(await agents.innerText(), /Share of LLM tokens, 12 weeks/);
      assert.deepEqual(
        await agents
          .locator('.ov-tool')
          .evaluateAll((els) =>
            els.map((el) => [
              el.getAttribute('data-client'),
              el.querySelector('[data-share]')?.textContent,
            ]),
          ),
        [
          ['claude-code', '74%'],
          ['omnigent', '26%'],
          ['codex', '<1%'],
        ],
      );
      assert.match(
        await agents.locator('.ov-tool[data-online="true"]').innerText(),
        /Claude Code\s*online\s*2 tokens · active /,
      );

      // ---- Review for others: tiles and the weekly bars.
      const review = await card(h.page, 'review');
      assert.equal(await tile(h.page, 'review_30d'), '54');
      assert.equal(await tile(h.page, 'review_accepted'), '82');
      assert.equal(await tile(h.page, 'review_sent_back'), '3');
      assert.equal(await tile(h.page, 'decide_p50'), '7 d 11 h');
      assert.equal(await review.locator('.prof-bar').count(), 12);
      assert.match(
        await review.locator('figcaption').innerText(),
        /Accepted\s*Sent back\s*this week$/,
      );

      // ---- LLM tokens: half the row, the cost line, by agent and by model.
      const tokens = await card(h.page, 'tokens');
      const tokenText = await tokens.innerText();
      assert.match(tokenText, /Cost is the API-equivalent price, not a bill\./);
      assert.match(tokenText, /By agent/);
      assert.match(tokenText, /By model/);

      await assertNoClockDurations(h.page);
    } finally {
      await h.close();
    }
  });

  void test('the header links go to Work, the Time report tab and Developer setup', async () => {
    const stub = stubFor(BUSY, { tokens: 128_000_000, week: DAYS, agents: 242 });
    const permissions = defaultPermissions(OWNER) as {
      me: { actions: string[] };
    };
    permissions.me.actions.push('developer_setup.read_any');
    const h = await open('/people?user=u2', { ...stub, '/api/v1/permissions': permissions });
    try {
      const week = await card(h.page, 'week');
      await week.locator('[data-card-link="time"]').click();
      await until(() => new URL(h.page.url()).searchParams.get('tab') === 'time');
      assert.equal(new URL(h.page.url()).searchParams.get('tab'), 'time');

      await h.page.goBack();
      const agents = await card(h.page, 'agents');
      assert.equal(
        (await agents.locator('[data-card-link="setup"]').innerText()).trim(),
        'Developer setup ›',
      );
      await agents.locator('[data-card-link="setup"]').click();
      await until(() => new URL(h.page.url()).searchParams.get('tab') === 'dev');
      assert.equal(new URL(h.page.url()).searchParams.get('tab'), 'dev');

      await h.page.goBack();
      const work = await card(h.page, 'work');
      await work.locator('[data-card-link="work"]').click();
      // Work is the Organisation page's tab since D-147 (LAI-1170).
      await until(() => new URL(h.page.url()).pathname === '/organisation');
      const at = new URL(h.page.url());
      assert.equal(at.pathname, '/organisation');
      assert.equal(at.searchParams.get('tab'), 'work');
      assert.equal(at.searchParams.get('person'), 'u2');
    } finally {
      await h.close();
    }
  });
});

void describe('who is online, in the Agents card', () => {
  void test('says presence is off rather than nobody online, and an online tool keeps its row', async () => {
    const off = {
      ...BUSY,
      agents: { ...BUSY.agents, online: { enabled: false, clients: [], last_seen: null } },
    };
    const h = await open('/people?user=u2', stubFor(off, { tokens: 0, week: DAYS, agents: 0 }));
    try {
      const agents = await card(h.page, 'agents');
      assert.equal(
        await agents.locator('.prof-card-caption').innerText(),
        '3 tools · presence off',
      );
      assert.equal(await agents.locator('.ov-tool[data-online="true"]').count(), 0);
    } finally {
      await h.close();
    }

    // Online on a token the profile does not list: still a row, with no share.
    const elsewhere = {
      ...BUSY,
      agents: { ...BUSY.agents, online: { enabled: true, clients: ['cursor'], last_seen: NOW } },
    };
    const g = await open(
      '/people?user=u2',
      stubFor(elsewhere, { tokens: 0, week: DAYS, agents: 0 }),
    );
    try {
      const agents = await card(g.page, 'agents');
      const row = agents.locator('.ov-tool[data-client="cursor"]');
      await row.waitFor({ timeout: 10_000 });
      assert.equal(await row.getAttribute('data-online'), 'true');
      assert.equal((await row.locator('[data-share]').innerText()).trim(), '—');
      assert.match(await row.innerText(), /no usable token now/);
    } finally {
      await g.close();
    }
  });
});

// ---------------------------------------------------------------- frame B

void describe('a new member (frame B)', () => {
  void test('every card says what is empty, in the design’s words', async () => {
    const h = await open(
      '/people?user=u3',
      stubFor(NEW_MEMBER, {
        tokens: 0,
        week: DAYS.map(() => [0, 0] as const),
        agents: 0,
        load: loadOf(null, []),
      }),
    );
    try {
      await h.page.setViewportSize({ width: 1440, height: 1000 });
      const work = await card(h.page, 'work');
      assert.deepEqual(
        (await work.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
        ['In progress 7', 'In review 6', 'Due in 7 days 0'],
      );
      assert.match(
        await work.locator('[data-delivered]').innerText(),
        /^Delivered · 12 weeks · Nothing accepted yet\. Joined 4 days ago\.$/,
      );
      await work.getByRole('tab', { name: /Due in 7 days/ }).click();
      assert.equal(
        (await work.locator('[data-work-due]').innerText()).trim(),
        'Nothing due in the next 7 days.',
      );

      const week = await card(h.page, 'week');
      await until(async () => (await week.locator('[data-week-total]').count()) === 1, 15_000);
      await until(async () =>
        (await week.locator('[data-week-total]').innerText()).includes('set'),
      );
      assert.equal(
        (await week.locator('[data-week-total]').innerText()).replace(/\s+/g, ' ').trim(),
        '0 min tracked · no working hours set',
      );
      assert.equal(
        (await week.locator('[data-away]').innerText()).replace(/\s+/g, ' ').trim(),
        'Away No time away planned',
      );
      assert.equal(await week.locator('.ov-day[data-zero="true"]').count(), 7);

      const projects = await card(h.page, 'projects');
      assert.equal(
        await projects
          .locator('.ov-project[data-project] [data-col="hours"]')
          .allInnerTexts()
          .then((t) => t.join(',')),
        '—,—',
      );
      assert.equal(await projects.locator('[data-quiet]').count(), 0);

      const agents = await card(h.page, 'agents');
      assert.equal(await agents.locator('.prof-card-caption').innerText(), 'none set up');
      assert.equal(
        (await agents.locator('[data-empty]').innerText()).replace(/\s+/g, ' ').trim(),
        'Naledi hasn’t set up an agent yet No device is paired and no token has been used. Their own work and time are not affected.',
      );

      const review = await card(h.page, 'review');
      assert.equal(
        (await review.locator('[data-empty]').innerText()).trim(),
        'No review decisions in these 12 weeks.',
      );
      const tokens = await card(h.page, 'tokens');
      await until(async () => (await tokens.locator('[data-empty]').count()) === 1);
      assert.equal(
        (await tokens.locator('[data-empty]').innerText()).trim(),
        'No LLM tokens recorded in these 12 weeks.',
      );

      // The manager kind draws the same rows (D-139 item 2).
      await assertRows(h.page, 'new member');
      await assertNoClockDurations(h.page);
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------------- frame G

void describe('your own profile (frame G)', () => {
  void test('This week reads your own time and the hours you set; Agents speaks to you', async () => {
    const h = await open('/people?user=u1', {
      // No tool and no LLM tokens: the Agents card speaks to you.
      ...stubFor(OWN, { tokens: 0, week: DAYS, agents: 242 }),
      '/api/v1/me/availability': {
        status: 'open',
        away: null,
        hours_per_week: 6,
        note: null,
        tags: [],
        work_week: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', minutes: 2400 },
        away_periods: [{ id: 'a1', from: '2026-11-20', to: '2026-11-23' }],
        updated_at: NOW - DAY,
      },
    });
    try {
      const week = await card(h.page, 'week');
      await until(async () => (await week.locator('[data-week-total]').count()) === 1, 15_000);
      await until(async () =>
        (await week.locator('[data-week-total]').innerText()).includes('set'),
      );
      assert.equal(
        (await week.locator('[data-week-total]').innerText()).replace(/\s+/g, ' ').trim(),
        '36 h 58 min tracked · 40 h set',
      );
      assert.equal(
        (await week.locator('[data-away]').innerText()).replace(/\s+/g, ' ').trim(),
        'Away Fri 20 – Mon 23 Nov',
      );
      assert.deepEqual(h.unmatched, [], 'your own week is a report of you, with drafts');

      const agents = await card(h.page, 'agents');
      assert.match(
        (await agents.locator('[data-empty]').innerText()).replace(/\s+/g, ' '),
        /^You haven’t set up an agent yet Pair a device and add a tool from Developer access\./,
      );
      const tokens = await card(h.page, 'tokens');
      assert.match(await tokens.locator('.prof-card-title').innerText(), /^Your LLM tokens$/);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------------ phone

void describe('a phone (frame C)', () => {
  void test('one column at 390 in both themes, two-line project rows, nothing sideways', async () => {
    const h = await open(
      '/people?user=u2',
      stubFor(BUSY, { tokens: 128_000_000, week: DAYS, agents: 242 }),
    );
    try {
      await card(h.page, 'week');
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 390, height: 900 });
        await until(async () => {
          const b = await boxes(h.page);
          return b.work !== undefined && b.week !== undefined && b.week.top > b.work.top;
        });
        const b = await boxes(h.page);
        const lefts = new Set(Object.values(b).map((x) => x.left));
        assert.equal(lefts.size, 1, `${theme}: every card in one column`);
        assert.ok(b.week!.top > b.work!.top, `${theme}: This week under Work`);
        assert.ok(b.agents!.top > b.projects!.top, `${theme}: Agents under Projects`);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(overflow <= 0, `${theme}: scrolls sideways by ${String(overflow)}px`);

        const laika = h.page.locator('.ov-project[data-project="laika"]');
        assert.equal(
          (await laika.locator('[data-phone-line]').innerText()).trim(),
          'Space admin · 38h 20m in 2 weeks · 31 accepted · 212 reviewed',
        );
        assert.match(await laika.innerText(), /46 open/);
        assert.equal(await laika.locator('[data-col="hours"]').isVisible(), false);
        assert.equal(await h.page.locator('.ov-projects-head').isVisible(), false);
      }
      await assertNoClockDurations(h.page);
    } finally {
      await h.close();
    }
  });
});
