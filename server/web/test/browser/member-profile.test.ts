/**
 * The member profile, in a real browser (LAI-743, D-078).
 *
 * The server tests own the figures and the door. What is left to prove is the
 * page a person reads: that every figure on it is the one the response
 * carried, that a manager's page has no agent, work or delivery block, that a
 * rating is written through the dialog by keyboard and lands on top, and that
 * the way in — a name on Organisation, a Capacity card, a *Work by person*
 * row — is a link for an owner or admin and plain text for anyone else.
 *
 * Fixtures are anchored to `Date.now()`, never to a date (CONVENTIONS §4).
 * The delivery figures that sit side by side are given different values —
 * accepted 4, sent back 6, reopened 7, p50 3 d, p75 4.5 d — so a card showing
 * one field under another's label fails rather than matching by coincidence.
 * The manager's tiles likewise (LAI-750): led 1, decided in 30 days 4,
 * accepted 9, sent back 2, median 5 h, waiting 3, oldest 2 d.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { capacityPerson } from './capacity-org.ts';
import {
  closeBrowser,
  open as openPage,
  refuse,
  setTheme,
  until,
  type ApiStub,
} from './harness.ts';

const NOW = Date.now();

/**
 * **Every page here runs on a clock pinned to `NOW`** (LAI-830).
 *
 * The fixtures are `NOW - 2 * MIN`, `NOW - 5 * HOUR` and so on, while the
 * page read its own `Date.now()` — taken after the build and every test before
 * it. Under load that is a minute or more later, so "active 2 min" read
 * "active 3 min" and failed two builders' gates on 2026-10-20/21. Pinned, the
 * page computes every age from the same instant the fixtures were written
 * against, and an exact-minute assertion cannot drift. Timers still run.
 */
const open: typeof openPage = (path, stub, options = {}) =>
  openPage(path, stub, {
    ...options,
    before: async (page) => {
      await page.clock.setFixedTime(NOW);
      await options.before?.(page);
    },
  });
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Monday 00:00 UTC of this week, as the server counts it. */
const MONDAY = (() => {
  const d = new Date(NOW);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
})();
const SINCE = MONDAY - 11 * WEEK;
const WEEKLY = [0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 2, 0];
/** A manager's review decisions per week (LAI-750): 9 accepted, 2 sent back. */
const REVIEWED = [0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 2, 0];
const SENT_BACK = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

const reviewWeeks = (accepted: readonly number[], sentBack: readonly number[]) =>
  accepted.map((n, i) => ({ week_start: SINCE + i * WEEK, accepted: n, sent_back: sentBack[i] }));

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  person('u1', 'Ada Owner', 'owner'),
  person('u2', 'Bea Builder', 'member'),
  person('u3', 'Cal Lead', 'member'),
  person('u5', 'Vic Viewer', 'viewer'),
];

const me = (id: string, org_role: string) => ({
  ...person(id, PEOPLE.find((p) => p.id === id)?.name ?? 'Someone', org_role),
  memberships: [{ project_id: 'p1', role: 'lead' }],
});

const BUILDER = {
  user: {
    id: 'u2',
    name: 'Bea Builder',
    email: 'bea@example.com',
    org_role: 'member',
    is_active: true,
    profile_kind: 'builder',
    created_at: NOW - 200 * DAY,
  },
  window: { weeks: 12, since: SINCE, until: NOW },
  projects: [
    {
      id: 'p1',
      slug: 'laika-core',
      name: 'Laika Core',
      key: 'LC',
      role: 'member',
      archived: false,
      open_tasks: 2,
      accepted: 4,
      reviewed: 0,
    },
    {
      id: 'p2',
      slug: 'orbit',
      name: 'Orbit',
      key: 'ORB',
      role: null,
      archived: true,
      open_tasks: 1,
      accepted: 0,
      reviewed: 1,
    },
  ],
  review: {
    accepted: 0,
    sent_back: 1,
    last_30_days: 1,
    per_week: reviewWeeks(
      WEEKLY.map(() => 0),
      WEEKLY.map((_, i) => (i === 10 ? 1 : 0)),
    ),
    time_to_decide: { measured: 1, unmeasured: 0, p50_ms: 2 * HOUR },
    recent: [
      {
        task_id: 't9',
        key: 'ORB-2',
        title: 'Orbit two',
        project_slug: 'orbit',
        decision: 'sent_back',
        at: NOW - 2 * DAY,
        assignee: { id: 'u3', name: 'Cal Lead' },
      },
    ],
  },
  ratings: [
    {
      id: 'r2',
      score: 5,
      note: 'Clears review fast.',
      rated_by: { id: 'u1', name: 'Ada Owner' },
      created_at: NOW - DAY,
    },
    {
      id: 'r1',
      score: 3,
      note: 'Steady delivery on the billing work.',
      rated_by: { id: 'u4', name: 'Ari Admin' },
      created_at: NOW - 30 * DAY,
    },
  ],
  ratings_total: 2,
  // As `quietYear` answers: the Activity card's shape comes from these (LAI-751).
  activity_sharing: { org_enabled: false, enabled: false },
  current_work: {
    in_progress: [
      {
        id: 't7',
        key: 'LC-7',
        title: 'Seven: the migration runner',
        project_slug: 'laika-core',
        status: 'in_progress',
        status_name: 'In progress',
        started_at: NOW - 3 * DAY,
        review_since: null,
      },
    ],
    in_review: [
      {
        id: 't8',
        key: 'ORB-1',
        title: 'Orbit one',
        project_slug: 'orbit',
        status: 'review',
        status_name: 'Code review',
        started_at: NOW - DAY,
        review_since: NOW - 5 * HOUR,
      },
    ],
    in_progress_total: 1,
    in_review_total: 1,
  },
  delivery: {
    accepted_per_week: WEEKLY.map((accepted, i) => ({ week_start: SINCE + i * WEEK, accepted })),
    accepted: 4,
    sent_back: 6,
    reopened: 7,
    cycle_time: { measured: 3, unmeasured: 1, p50_ms: 3 * DAY, p75_ms: 4.5 * DAY },
  },
  agents: {
    tokens: [
      {
        id: 'k1',
        name: 'Laptop Claude',
        client: 'claude-code',
        client_name: 'claude-code',
        last_used_at: NOW - 2 * MIN,
        last_mcp_at: NOW - 2 * MIN,
        created_at: NOW - 100 * DAY,
      },
      {
        id: 'k2',
        name: 'Codex desk',
        client: 'codex',
        client_name: 'codex_cli_rs',
        last_used_at: NOW - 3 * DAY,
        last_mcp_at: NOW - 3 * DAY,
        created_at: NOW - 50 * DAY,
      },
    ],
    tokens_total: 2,
    online: { enabled: true, clients: ['claude-code'], last_seen: NOW - MIN },
    // Cursor wrote through a token since revoked: a share, and no token row.
    writes: [
      { client: 'claude-code', writes: 6 },
      { client: 'codex', writes: 3 },
      { client: 'cursor', writes: 1 },
    ],
    writes_total: 10,
  },
};

/** The same person as a manager: the three builder blocks are absent. */
function asManager(profile: typeof BUILDER) {
  const { current_work: _work, delivery: _delivery, agents: _agents, ...rest } = profile;
  return { ...rest, user: { ...rest.user, profile_kind: 'manager' } };
}

const MANAGER = {
  ...asManager({ ...BUILDER, user: { ...BUILDER.user, id: 'u3', name: 'Cal Lead' } }),
  review: {
    accepted: 9,
    sent_back: 2,
    last_30_days: 4,
    per_week: reviewWeeks(REVIEWED, SENT_BACK),
    time_to_decide: { measured: 10, unmeasured: 1, p50_ms: 5 * HOUR },
    recent: [
      {
        task_id: 't3',
        key: 'LC-3',
        title: 'Three',
        project_slug: 'laika-core',
        decision: 'accepted',
        at: NOW - DAY,
        assignee: { id: 'u2', name: 'Bea Builder' },
      },
      {
        task_id: 't2',
        key: 'LC-2',
        title: 'Two',
        project_slug: 'laika-core',
        decision: 'sent_back',
        at: NOW - 4 * DAY,
        assignee: { id: 'u2', name: 'Bea Builder' },
      },
    ],
  },
  ratings: [],
  ratings_total: 0,
  queue: {
    projects_led: 1,
    waiting: 3,
    oldest_waiting_since: NOW - 2 * DAY,
    projects: [{ project_id: 'p1', waiting: 3 }],
  },
};

const EMPTY = {
  ...BUILDER,
  user: { ...BUILDER.user, id: 'u6', name: 'Nia New' },
  projects: [],
  review: {
    accepted: 0,
    sent_back: 0,
    last_30_days: 0,
    per_week: reviewWeeks(
      WEEKLY.map(() => 0),
      WEEKLY.map(() => 0),
    ),
    time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
    recent: [],
  },
  ratings: [],
  ratings_total: 0,
  current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
  delivery: {
    accepted_per_week: WEEKLY.map((_, i) => ({ week_start: SINCE + i * WEEK, accepted: 0 })),
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

/** A year of nothing but a little board work (LAI-751): the Activity card's stub. */
function quietYear(range: string) {
  const days = range === '12w' ? 84 : 364;
  const end = new Date(NOW).toISOString().slice(0, 10);
  const start = new Date(NOW - (days - 1) * DAY).toISOString().slice(0, 10);
  const zeros = () => new Array<number>(days).fill(0);
  return {
    range,
    start,
    end,
    tz: 'UTC',
    sharing: { org_enabled: false, enabled: false },
    series: {
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
      board_self: zeros().map((_, i) => (i % 3 === 0 ? 1 : 0)),
      board_agent: zeros(),
    },
    prompts_by_agent: {},
    agents: [],
  };
}

const activityStub = (call: { path: string }) => {
  void call;
  return quietYear('52w');
};

/** Each person's Tokens card (LAI-769): sharing on, nothing arrived yet. */
const quietUsage = (userId: string) => ({
  user_id: userId,
  from: '2026-07-27',
  to: '2026-10-18',
  weeks: Array.from({ length: 12 }, (_, i) => ({
    start: new Date(Date.UTC(2026, 6, 27 + 7 * i)).toISOString().slice(0, 10),
    tokens: 0,
    cache_read: 0,
  })),
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

const BASE: ApiStub = {
  '/api/v1/users/u1/usage': quietUsage('u1'),
  '/api/v1/users/u2/usage': quietUsage('u2'),
  '/api/v1/users/u3/usage': quietUsage('u3'),
  '/api/v1/users/u6/usage': quietUsage('u6'),
  '/api/v1/people/u1/activity': activityStub,
  '/api/v1/people/u2/activity': activityStub,
  '/api/v1/people/u3/activity': activityStub,
  '/api/v1/people/u6/activity': activityStub,
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
};

void after(async () => {
  await closeBrowser();
});

async function section(page: Page, name: string) {
  const found = page.locator(`.prof-card[data-section="${name}"]`);
  await found.waitFor({ timeout: 20_000 });
  return found;
}

async function stat(page: Page, name: string): Promise<string> {
  return (await page.locator(`[data-stat="${name}"] .prof-stat-value`).innerText()).trim();
}

/** A week chart's bars, as each bar's values: `[accepted]` or `[accepted, sent back]`. */
async function bars(page: Page, card: string): Promise<number[][]> {
  return page
    .locator(`.prof-card[data-section="${card}"] .prof-bars [data-values]`)
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-values') ?? '').split(',').map(Number)),
    );
}

// ------------------------------------------------------------------ builder

void describe('a builder’s profile', () => {
  void test('renders every figure from the response, in its place', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const head = h.page.locator('.prof-head');
      await head.waitFor({ timeout: 20_000 });
      const headText = await head.innerText();
      assert.match(headText, /Bea Builder/);
      assert.match(headText, /bea@example\.com/);
      assert.match(headText, /Member/);
      // The sub-line counts the response's projects; the pill says who sees this.
      assert.match(headText, /2 projects/);
      assert.match(await head.locator('.prof-pill').innerText(), /owners and admins only/i);
      assert.equal(
        await h.page.locator('input[name="profile-kind"][value="builder"]').isChecked(),
        true,
      );

      const projects = await section(h.page, 'projects');
      assert.match(await projects.locator('.prof-card-count').innerText(), /^2$/);
      const projectText = await projects.innerText();
      assert.match(projectText, /Laika Core/);
      assert.match(projectText, /Orbit/);
      assert.match(projectText, /archived/i);

      const current = await section(h.page, 'current');
      const currentText = await current.innerText();
      assert.match(currentText, /LC-7/);
      assert.match(currentText, /Seven: the migration runner/);
      // One list at a time (LAI-751): in progress first, review a click away.
      assert.doesNotMatch(currentText, /ORB-1/);
      await current.locator('input[name="prof-work"][value="in_review"]').check();
      assert.match(await current.innerText(), /ORB-1.*Orbit one.*waiting 5 h/s);
      assert.equal(await stat(h.page, 'in_progress'), '1');
      assert.equal(await stat(h.page, 'in_review'), '1');
      // LC-7 started three days ago, and it is the oldest in progress.
      assert.equal(await stat(h.page, 'oldest_in_progress'), '3 d');

      await section(h.page, 'delivery');
      await until(async () => (await bars(h.page, 'delivery')).length === 12);
      const weekly = await bars(h.page, 'delivery');
      assert.equal(weekly.length, 12, 'one bar per week of the window');
      assert.deepEqual(
        weekly.map(([n]) => n),
        WEEKLY,
      );
      assert.equal(await stat(h.page, 'accepted'), '4');
      assert.equal(await stat(h.page, 'sent_back'), '6');
      assert.equal(await stat(h.page, 'reopened'), '7');
      assert.equal(await stat(h.page, 'cycle'), '3 d');
      assert.equal(
        (await h.page.locator('[data-stat="cycle"] .prof-stat-sub').innerText()).trim(),
        '/ 4 d 12 h',
      );
      assert.match(await h.page.locator('.prof-unmeasured').innerText(), /1 .*not measured/i);

      const review = await section(h.page, 'review');
      assert.equal(
        await review.locator('[data-stat="review_accepted"] .prof-stat-value').innerText(),
        '0',
      );
      assert.equal(
        await review.locator('[data-stat="review_sent_back"] .prof-stat-value').innerText(),
        '1',
      );

      assert.equal(await stat(h.page, 'review_30d'), '1');
      assert.equal(await stat(h.page, 'decide_p50'), '2 h');

      const agents = await section(h.page, 'agents');
      const agentText = await agents.innerText();
      assert.match(agentText, /Claude Code/);
      assert.match(agentText, /Codex/);
      // Token names wait behind each agent's expand (LAI-751).
      assert.doesNotMatch(agentText, /Laptop Claude/);
      await agents.locator('.prof-agent[data-client="claude-code"] .prof-tokens-toggle').click();
      assert.match(await agents.innerText(), /Laptop Claude/);
      assert.equal(await agents.locator('.prof-agent[data-online="true"]').count(), 1);
      // Who is online is this card's (LAI-751, owner, 2026-10-16).
      assert.equal(await agents.locator('.prof-card-caption').innerText(), '1 online');
      assert.match(
        await agents.locator('.prof-agent[data-online="true"]').innerText(),
        /Claude Code\s*online/,
      );

      const rating = await section(h.page, 'rating');
      const latest = await rating.locator('.prof-rating-latest').innerText();
      assert.match(latest, /5 \/ 5/);
      assert.match(latest, /Clears review fast\./);
      assert.match(latest, /Ada Owner/);
      const history = await rating.locator('.prof-rating-history li').allInnerTexts();
      assert.equal(history.length, 1, 'the history is everything but the latest');
      assert.match(history[0] ?? '', /3 \/ 5.*Steady delivery/s);
    } finally {
      await h.close();
    }
  });

  void test('fits 1366, 1024 and 390 in both themes, with nothing scrolling sideways', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await section(h.page, 'delivery');
      for (const theme of ['Light', 'Dark']) {
        // The theme switch is in the sidebar, which is off-canvas on a phone:
        // switch at laptop width, then measure both.
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        for (const width of [1366, 1024, 390]) {
          await h.page.setViewportSize({ width, height: 900 });
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(
            overflow <= 0,
            `${String(width)} ${theme}: scrolls sideways by ${String(overflow)}px`,
          );
          // Every card sits inside the viewport, not clipped off its right edge.
          const outside = await h.page
            .locator('.prof-card')
            .evaluateAll(
              (els) =>
                els.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
                  .length,
            );
          assert.equal(outside, 0, `${String(width)} ${theme}: a card runs off the page`);
        }
      }
    } finally {
      await h.close();
    }
  });

  /**
   * The server caps three lists at 50 and sends the total (LAI-746). The page
   * says how many it is not showing, and counts by the total, not the length.
   */
  void test('says how many more there are when a list was cut', async () => {
    const long = {
      ...BUILDER,
      ratings_total: 60,
      current_work: { ...BUILDER.current_work, in_progress_total: 4, in_review_total: 1 },
      agents: { ...BUILDER.agents, tokens_total: 9 },
    };
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': long,
    });
    try {
      const current = await section(h.page, 'current');
      assert.equal(await stat(h.page, 'in_progress'), '4');
      assert.match(await current.locator('.prof-more').innerText(), /and 3 more/);

      const agents = await section(h.page, 'agents');
      assert.match(await agents.locator('.prof-more').innerText(), /and 7 more/);

      const rating = await section(h.page, 'rating');
      assert.match(await rating.locator('.prof-sub').innerText(), /Earlier\s*59/i);
      assert.match(await rating.locator('.prof-more').innerText(), /and 58 more/);
    } finally {
      await h.close();
    }
  });

  void test('says nothing about more when nothing was cut', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await section(h.page, 'rating');
      assert.equal(await h.page.locator('.prof-more').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('says what is empty for a person with no history', async () => {
    const h = await open('/people?user=u6', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u6/profile': EMPTY,
    });
    try {
      const text = await (await section(h.page, 'rating')).page().locator('.prof').innerText();
      assert.match(text, /No projects yet/);
      assert.match(text, /Nothing in progress or in review/);
      assert.match(text, /Nothing accepted in these 12 weeks/);
      assert.match(text, /No agent has used their tokens yet/);
      assert.equal(
        await h.page.locator('.prof-card[data-section="agents"] .prof-card-caption').innerText(),
        'none online',
      );
      assert.match(text, /No review decisions in these 12 weeks/);
      assert.match(text, /Not rated yet/);
      // One line where there is nothing — no tiles of zeros and dashes under it
      // (LAI-751, owner, 2026-10-16).
      assert.equal(await h.page.locator('.prof-columns .prof-stats').count(), 0);
      assert.doesNotMatch(text, /undefined|NaN|null/);
      // A compact sentence inside the card, not twelve empty bars (LAI-750).
      for (const card of ['delivery', 'review']) {
        assert.equal(
          await h.page.locator(`.prof-card[data-section="${card}"] .prof-bars`).count(),
          0,
          `an empty ${card} card still draws a chart`,
        );
      }
      assert.equal(
        await h.page.locator('.prof-card[data-section="agents"] .prof-share').count(),
        0,
        'a share bar with no writes',
      );
    } finally {
      await h.close();
    }
  });

  /**
   * D-102 amended (LAI-967): a current server sends `enabled` equal to
   * `org_enabled`, so `enabled: false` beside an organisation that collects is
   * a stale personal answer. It decides nothing, and the Tokens card's empty
   * line sends nobody — the person or anyone reading — to a switch that is gone.
   */
  for (const [reader, readerRole, line] of [
    ['an owner', me('u1', 'owner'), /^Nothing has arrived from Bea Builder’s machines yet\.$/],
    ['the person', me('u2', 'admin'), /^Nothing has arrived from your machines yet: /],
  ] as const) {
    void test(`${reader}: a stale personal “off” names no switch on the Tokens card`, async () => {
      const h = await open('/people?user=u2', {
        ...BASE,
        '/api/v1/me': readerRole,
        '/api/v1/users/u2/profile': BUILDER,
        '/api/v1/users/u2/usage': {
          ...quietUsage('u2'),
          sharing: { org_enabled: true, enabled: false },
        },
      });
      try {
        const empty = (await section(h.page, 'tokens')).locator('.prof-empty');
        await until(async () => (await empty.innerText()).includes('Nothing has arrived'));
        const text = await empty.innerText();
        assert.match(text, line);
        assert.doesNotMatch(text, /Share local activity|turned on sharing|Turn on/);
      } finally {
        await h.close();
      }
    });
  }
});

// ------------------------------------------------------- v2 cards (LAI-750)

void describe('the agents card, with who is online in it', () => {
  void test('split one bar by share of writes, with each agent’s real mark, name and share', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const agents = await section(h.page, 'agents');
      assert.match(await agents.locator('.prof-card-title').innerText(), /3 types/);

      const parts = agents.locator('.prof-share-part');
      assert.deepEqual(
        await parts.evaluateAll((els) =>
          els.map((el) => [el.getAttribute('data-client'), (el as HTMLElement).style.flexGrow]),
        ),
        [
          ['claude-code', '6'],
          ['codex', '3'],
          ['cursor', '1'],
        ],
      );
      assert.match(
        (await agents.locator('.prof-share').getAttribute('aria-label')) ?? '',
        /Claude Code 60%, Codex 30%, Cursor 10%/,
      );

      const claude = agents.locator('.prof-agent[data-client="claude-code"]');
      assert.match(await claude.innerText(), /Claude Code.*60%/s);
      // The vendor's mark, not a two-letter monogram.
      assert.equal(await claude.locator('.agent-mark-logo svg').count(), 1);
      // Cursor wrote through a token that is gone: a share, and no token now.
      const cursor = await agents.locator('.prof-agent[data-client="cursor"]').innerText();
      assert.match(cursor, /10%/);
      assert.match(cursor, /no usable token now/);
    } finally {
      await h.close();
    }
  });

  void test('says who is online with a live dot on the row, and never where', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const agents = await section(h.page, 'agents');
      // *Online now* is not a card of its own any more (LAI-751, owner, 2026-10-16).
      assert.equal(await h.page.locator('.prof-card[data-section="online"]').count(), 0);
      assert.equal(await agents.locator('.prof-card-caption').innerText(), '1 online');
      const row = agents.locator('.prof-agent[data-client="claude-code"]');
      assert.equal(await row.locator('.prof-online .prof-live-dot').count(), 1);
      assert.equal(await row.locator('.agent-mark').count(), 1);
      // Laptop Claude was last used two minutes ago.
      assert.match(await row.innerText(), /Claude Code\s*online.*active 2 min/s);
      assert.equal(await agents.locator('.prof-live-dot').count(), 1, 'Codex is not online');
      assert.doesNotMatch(await agents.innerText(), /LC-|laika-core|Laika Core/);
    } finally {
      await h.close();
    }
  });

  void test('says presence is off, rather than nobody online, when the org turned it off', async () => {
    const off = {
      ...BUILDER,
      agents: { ...BUILDER.agents, online: { enabled: false, clients: [], last_seen: null } },
    };
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': off,
    });
    try {
      const agents = await section(h.page, 'agents');
      assert.equal(await agents.locator('.prof-card-caption').innerText(), 'presence off');
      assert.equal(await agents.locator('.prof-live-dot').count(), 0);
      await agents.locator('.prof-info-button').first().click();
      assert.match(await agents.innerText(), /Presence is off for this organisation/);
    } finally {
      await h.close();
    }
  });

  void test('an agent online on a token the list does not show still has its row', async () => {
    const shape = {
      ...BUILDER,
      agents: {
        ...BUILDER.agents,
        online: { enabled: true, clients: ['claude-code', 'gemini-cli'], last_seen: NOW - MIN },
      },
    };
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': shape,
    });
    try {
      const agents = await section(h.page, 'agents');
      assert.equal(await agents.locator('.prof-card-caption').innerText(), '2 online');
      const gemini = agents.locator('.prof-agent[data-client="gemini-cli"]');
      assert.match(await gemini.innerText(), /Gemini CLI\s*online/);
      assert.equal(await gemini.locator('.prof-live-dot').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('definitions and the kind control', () => {
  void test('keeps definitions in an (i) that opens and closes by keyboard, not in paragraphs', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const delivery = await section(h.page, 'delivery');
      assert.doesNotMatch(
        await h.page.locator('.prof').innerText(),
        /moved into a Done status by someone/i,
        'a definition is printed on the page',
      );

      const button = delivery.locator('.prof-info-button');
      assert.equal(await button.getAttribute('aria-label'), 'About delivered');
      await button.focus();
      await h.page.keyboard.press('Enter');
      assert.equal(await button.getAttribute('aria-expanded'), 'true');
      const pop = delivery.locator('.prof-info-pop');
      assert.match(await pop.innerText(), /Accepted\s*Moved into a Done status by someone other/);
      assert.match(await pop.innerText(), /Cycle time/);

      // Reading it with the pointer takes focus off the button; it stays open.
      await pop.click();
      assert.equal(await button.evaluate((el) => el === document.activeElement), false);
      assert.equal(await button.getAttribute('aria-expanded'), 'true');

      await h.page.keyboard.press('Escape');
      await pop.waitFor({ state: 'detached' });
      assert.equal(await button.getAttribute('aria-expanded'), 'false');
      assert.equal(await button.evaluate((el) => el === document.activeElement), true);

      // A tile carries its own meaning as a tooltip too.
      assert.match(
        (await h.page.locator('[data-stat="reopened"]').getAttribute('title')) ?? '',
        /out of Done/,
      );
    } finally {
      await h.close();
    }
  });

  void test('is a labelled radio group that a keyboard moves', async () => {
    let patched: unknown;
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': (call: { method: string; body: unknown }) => {
        if (call.method === 'PATCH') patched = call.body;
        return patched === undefined ? BUILDER : asManager(BUILDER);
      },
    });
    try {
      const group = h.page.locator('.prof-head [role="radiogroup"]');
      await group.waitFor({ timeout: 20_000 });
      const labelledBy = (await group.getAttribute('aria-labelledby')) ?? '';
      assert.equal(
        (await h.page.locator(`[id="${labelledBy}"]`).innerText()).trim(),
        'Profile kind',
      );
      const describedBy = (await group.getAttribute('aria-describedby')) ?? '';
      assert.match(
        await h.page.locator(`[id="${describedBy}"]`).innerText(),
        /a label, never a permission/,
      );

      await h.page.locator('input[name="profile-kind"][value="builder"]').focus();
      await h.page.keyboard.press('ArrowRight');
      await until(() => patched !== undefined);
      assert.deepEqual(patched, { profile_kind: 'manager' });
      await until(
        async () => (await h.page.locator('.prof-card[data-section="delivery"]').count()) === 0,
      );
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------------ manager

void describe('a manager’s profile', () => {
  void test('shows projects, review work and recent decisions, and no builder blocks', async () => {
    const h = await open('/people?user=u3', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u3/profile': MANAGER,
    });
    try {
      await section(h.page, 'projects');
      const review = await section(h.page, 'review');
      assert.equal(
        await review.locator('[data-stat="review_accepted"] .prof-stat-value').innerText(),
        '9',
      );
      assert.equal(
        await review.locator('[data-stat="review_sent_back"] .prof-stat-value').innerText(),
        '2',
      );

      // The queue's and the review's tiles, each its own field (LAI-750).
      assert.equal(await stat(h.page, 'projects_led'), '1');
      assert.equal(await stat(h.page, 'review_30d'), '4');
      assert.equal(await stat(h.page, 'decide_p50'), '5 h');
      assert.equal(
        (await h.page.locator('[data-stat="decide_p50"] .prof-stat-sub').innerText()).trim(),
        '10 timed',
      );
      assert.equal(await stat(h.page, 'waiting'), '3');
      assert.equal(await stat(h.page, 'oldest_waiting'), '2 d');

      // Review load per week: accepted and sent back, stacked, one bar a week.
      const stacked = JSON.stringify(REVIEWED.map((n, i) => [n, SENT_BACK[i]]));
      await until(async () => JSON.stringify(await bars(h.page, 'review')) === stacked);
      assert.deepEqual(
        await bars(h.page, 'review'),
        REVIEWED.map((n, i) => [n, SENT_BACK[i]]),
      );
      const load = h.page.locator('.prof-card[data-section="review"] .prof-bars');
      assert.match((await load.getAttribute('aria-label')) ?? '', /Review decisions per week/);
      assert.match(
        await load.locator('li').nth(4).innerText(),
        /0 accepted, 1 sent back/,
        'a bar without words for a screen reader',
      );

      // A manager's project bars count their decisions — Laika Core has 2 of
      // their own open and 0 reviewed — and say what waits.
      const projects = await section(h.page, 'projects');
      assert.match(await projects.locator('[data-project="laika-core"]').innerText(), /3 waiting/);
      assert.equal(
        (await projects.locator('[data-project="laika-core"] .prof-pbar-n').innerText()).trim(),
        '0',
      );

      const decisions = await section(h.page, 'decisions');
      const rows = await decisions.locator('li').allInnerTexts();
      assert.equal(rows.length, 2);
      assert.match(rows[0] ?? '', /Accepted.*LC-3/s);
      assert.match(rows[1] ?? '', /Sent back.*LC-2/s);

      for (const absent of ['agents', 'current', 'delivery', 'online']) {
        assert.equal(
          await h.page.locator(`.prof-card[data-section="${absent}"]`).count(),
          0,
          `a manager's page has a ${absent} block`,
        );
      }
      assert.equal(
        await h.page.locator('input[name="profile-kind"][value="manager"]').isChecked(),
        true,
      );
    } finally {
      await h.close();
    }
  });

  void test('switching the kind sends PATCH and redraws from the answer', async () => {
    let state: unknown = BUILDER;
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': (call: { method: string; body: unknown }) => {
        if (call.method === 'PATCH') {
          state =
            (call.body as { profile_kind?: string }).profile_kind === 'manager'
              ? asManager(BUILDER)
              : BUILDER;
        }
        return state;
      },
    });
    try {
      await section(h.page, 'agents');
      // `click`, not `check`: the control shows the server's answer, so the
      // radio moves when the PATCH comes back rather than on the click.
      await h.page.locator('input[name="profile-kind"][value="manager"]').click();

      await until(
        async () => (await h.page.locator('.prof-card[data-section="agents"]').count()) === 0,
      );
      assert.equal(await h.page.locator('.prof-card[data-section="agents"]').count(), 0);
      const patch = h.calls.find((c) => c.method === 'PATCH');
      assert.deepEqual(patch?.body, { profile_kind: 'manager' });
      assert.equal(patch?.path, '/api/v1/users/u2/profile');
    } finally {
      await h.close();
    }
  });
});

// -------------------------------------------------------------------- rating

void describe('rating a member', () => {
  void test('by keyboard: open, choose, write, send — and it lands on top', async () => {
    const ratings = [...BUILDER.ratings];
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': () => ({
        ...BUILDER,
        ratings: [...ratings],
        ratings_total: ratings.length,
      }),
      '/api/v1/users/u2/ratings': (call: { body: unknown }) => {
        const body = call.body as { score: number; note: string };
        const created = {
          id: `r${String(ratings.length + 1)}`,
          score: body.score,
          note: body.note,
          rated_by: { id: 'u1', name: 'Ada Owner' },
          created_at: Date.now(),
        };
        ratings.unshift(created);
        return created;
      },
    });
    try {
      const rate = h.page.locator('button.prof-rate');
      await rate.waitFor({ timeout: 20_000 });
      await rate.focus();
      await h.page.keyboard.press('Enter');

      const dialog = h.page.locator('.rating-dialog[role="dialog"]');
      await dialog.waitFor();
      const submit = dialog.locator('button.rating-submit');
      assert.equal(await submit.isDisabled(), true, 'sendable before anything was chosen');

      // Focus starts on the score; arrows move it, as a radio group's do.
      await h.page.keyboard.press('ArrowRight');
      await h.page.keyboard.press('ArrowRight');
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await dialog.locator('input[name="rating-score"][value="4"]').isChecked(), true);
      assert.equal(await submit.isDisabled(), true, 'sendable with no note');

      await h.page.keyboard.press('Tab');
      await h.page.keyboard.type('Owns the release checklist now.');
      await submit.focus();
      await h.page.keyboard.press('Enter');

      await dialog.waitFor({ state: 'detached' });
      await until(async () =>
        (
          await h.page
            .locator('.prof-rating-latest')
            .innerText()
            .catch(() => '')
        ).includes('Owns the release checklist'),
      );
      const latest = await h.page.locator('.prof-rating-latest').innerText();
      assert.match(latest, /4 \/ 5/);
      assert.match(latest, /Owns the release checklist now\./);
      // The one it superseded moved into the history, newest first.
      await until(async () =>
        /5 \/ 5.*Clears review fast/s.test(
          (await h.page.locator('.prof-rating-history li').allInnerTexts())[0] ?? '',
        ),
      );
      const history = await h.page.locator('.prof-rating-history li').allInnerTexts();
      assert.match(history[0] ?? '', /5 \/ 5.*Clears review fast/s);

      const post = h.calls.find(
        (c) => c.method === 'POST' && c.path === '/api/v1/users/u2/ratings',
      );
      assert.deepEqual(post?.body, { score: 4, note: 'Owns the release checklist now.' });
    } finally {
      await h.close();
    }
  });

  void test('Escape closes the dialog without sending, and gives focus back', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const rate = h.page.locator('button.prof-rate');
      await rate.waitFor({ timeout: 20_000 });
      await rate.click();
      await h.page.locator('.rating-dialog').waitFor();
      await h.page.keyboard.press('Escape');
      await h.page.locator('.rating-dialog').waitFor({ state: 'detached' });

      assert.equal(await rate.evaluate((el) => el === document.activeElement), true);
      assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
    } finally {
      await h.close();
    }
  });

  /**
   * A lost answer must not become two ratings (LAI-746). Each submit of one
   * rating carries the same `Idempotency-Key`, so the server answers a retry
   * from the row the first attempt wrote; a changed rating is a new attempt.
   */
  void test('retries a lost save with the same Idempotency-Key, and a changed rating with a new one', async () => {
    const keys: (string | undefined)[] = [];
    let answer: 'drop' | 'ok' = 'drop';
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await h.page.route('**/api/v1/users/u2/ratings', async (route) => {
        keys.push(route.request().headers()['idempotency-key']);
        if (answer === 'drop') {
          await route.abort('connectionreset');
          return;
        }
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...BUILDER.ratings[0], note: 'Second try.' }),
        });
      });

      await h.page.locator('button.prof-rate').click();
      const dialog = h.page.locator('.rating-dialog');
      const submit = dialog.locator('button.rating-submit');
      await dialog.locator('input[name="rating-score"][value="3"]').check();
      await dialog.locator('textarea').fill('First try.');

      await submit.click();
      await until(() => keys.length === 1);
      await dialog.locator('[role="alert"]').waitFor();
      await until(async () => !(await submit.isDisabled()));
      await submit.click();
      await until(() => keys.length === 2);

      await until(async () => !(await submit.isDisabled()));
      await dialog.locator('textarea').fill('Second try.');
      await submit.click();
      await until(() => keys.length === 3);

      answer = 'ok';
      await until(async () => !(await submit.isDisabled()));
      await submit.click();
      await dialog.waitFor({ state: 'detached' });

      assert.equal(keys.length, 4);
      assert.match(keys[0] ?? '', /^rating-[0-9a-f]{32}$/);
      assert.equal(keys[1], keys[0], 'a retry of the same rating took a new key');
      assert.notEqual(keys[2], keys[1], 'a changed rating kept the old key');
      assert.equal(keys[3], keys[2], 'the retry that went through took a new key');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  /**
   * An attempt belongs to the member it rates (LAI-749). The screen stays
   * mounted when `?user=` changes, so an attempt kept from one member's failed
   * save must not be reused for the next member's rating of the same score and
   * note: the server would answer `409` — that key already wrote, or tried to
   * write, a rating of someone else.
   */
  void test('does not carry a failed attempt’s key over to another member', async () => {
    const sent: { path: string; key: string | undefined }[] = [];
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
      '/api/v1/users/u3/profile': {
        ...BUILDER,
        user: { ...BUILDER.user, id: 'u3', name: 'Cal Lead' },
      },
    });
    try {
      await h.page.route('**/api/v1/users/*/ratings', async (route) => {
        const path = new URL(route.request().url()).pathname;
        sent.push({ path, key: route.request().headers()['idempotency-key'] });
        if (path.includes('/u2/')) {
          await route.abort('connectionreset');
          return;
        }
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(BUILDER.ratings[0]),
        });
      });

      const rate = async (): Promise<void> => {
        await h.page.locator('button.prof-rate').click();
        const dialog = h.page.locator('.rating-dialog');
        await dialog.locator('input[name="rating-score"][value="3"]').check();
        await dialog.locator('textarea').fill('Same note.');
        await dialog.locator('button.rating-submit').click();
      };

      // Bea: the save is lost; the dialog says so and is closed.
      await h.page.locator('.prof-head', { hasText: 'Bea Builder' }).waitFor({ timeout: 20_000 });
      await rate();
      await until(() => sent.length === 1);
      const dialog = h.page.locator('.rating-dialog');
      await dialog.locator('[role="alert"]').waitFor();
      await until(async () => !(await dialog.locator('button.rating-cancel').isDisabled()));
      await dialog.locator('button.rating-cancel').click();
      await dialog.waitFor({ state: 'detached' });

      // Cal, by changing `?user=` in place — the same screen, still mounted.
      await h.page.evaluate(() => {
        history.pushState({}, '', '/people?user=u3');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await h.page.locator('.prof-head', { hasText: 'Cal Lead' }).waitFor();
      await rate();
      await until(() => sent.length === 2);
      await dialog.waitFor({ state: 'detached' });

      assert.deepEqual(
        sent.map((s) => s.path),
        ['/api/v1/users/u2/ratings', '/api/v1/users/u3/ratings'],
      );
      assert.match(sent[0]?.key ?? '', /^rating-[0-9a-f]{32}$/);
      assert.match(sent[1]?.key ?? '', /^rating-[0-9a-f]{32}$/);
      assert.notEqual(sent[1]?.key, sent[0]?.key, 'Cal’s rating reused Bea’s attempt key');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('keeps the dialog open while a save is in flight — Escape, Cancel and ✕ wait', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let seen = false;
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await h.page.route('**/api/v1/users/u2/ratings', async (route) => {
        seen = true;
        await held;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(BUILDER.ratings[0]),
        });
      });

      await h.page.locator('button.prof-rate').click();
      const dialog = h.page.locator('.rating-dialog');
      await dialog.locator('input[name="rating-score"][value="5"]').check();
      await dialog.locator('textarea').fill('Held in flight.');
      await dialog.locator('button.rating-submit').click();
      await until(() => seen);

      await h.page.keyboard.press('Escape');
      await h.page.locator('.rating-scrim').click({ position: { x: 5, y: 5 }, force: true });
      assert.equal(await dialog.locator('button.rating-cancel').isDisabled(), true);
      assert.equal(await dialog.locator('button.rating-close').isDisabled(), true);
      await h.page.waitForTimeout(200);
      assert.equal(await dialog.count(), 1, 'the dialog let go of a save in flight');

      release();
      await dialog.waitFor({ state: 'detached' });
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('shows the server’s refusal in the dialog rather than closing it', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
      '/api/v1/users/u2/ratings': refuse(
        422,
        'unprocessable',
        'A rating needs a note of 1 to 500 characters',
      ),
    });
    try {
      await h.page.locator('button.prof-rate').click();
      const dialog = h.page.locator('.rating-dialog');
      await dialog.locator('input[name="rating-score"][value="2"]').check();
      await dialog.locator('textarea').fill('Something.');
      await dialog.locator('button.rating-submit').click();

      await dialog.locator('[role="alert"]').waitFor();
      assert.match(await dialog.locator('[role="alert"]').innerText(), /1 to 500 characters/);
    } finally {
      await h.close();
    }
  });

  void test('offers no rating of yourself', async () => {
    const self = {
      ...BUILDER,
      user: { ...BUILDER.user, id: 'u1', name: 'Ada Owner', org_role: 'owner' },
    };
    const h = await open('/people?user=u1', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u1/profile': self,
    });
    try {
      const rating = await section(h.page, 'rating');
      assert.equal(await h.page.locator('button.prof-rate').count(), 0);
      assert.match(await rating.innerText(), /cannot rate yourself/i);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------- who sees it

void describe('who is shown a profile', () => {
  void test('a member is told it is not theirs, and the profile is never asked for', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u3', 'member'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.state-forbidden').innerText(), /member profiles/i);
      await h.page.waitForTimeout(300);
      assert.equal(h.calls.filter((c) => c.path.endsWith('/profile')).length, 0);
    } finally {
      await h.close();
    }
  });

  void test('an id that names nobody says so', async () => {
    const h = await open('/people?user=nobody', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/nobody/profile': refuse(404, 'not_found', 'No user with id "nobody"'),
    });
    try {
      const text = h.page.locator('.prof');
      await until(async () =>
        /No such person|not found/i.test(await text.innerText().catch(() => '')),
      );
      assert.match(await text.innerText(), /No such person/i);
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------------- the ways in

void describe('the ways in are links for owners and admins only', () => {
  const ORG_STUB: ApiStub = {
    ...BASE,
    '/api/v1/users': { data: PEOPLE, next_cursor: null },
    '/api/v1/invites': { data: [], next_cursor: null },
  };

  void test('Organisation: a member’s name opens their profile', async () => {
    const h = await open('/organisation?tab=people', {
      ...ORG_STUB,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const link = h.page.locator('.org-people-table a[href="/people?user=u2"]');
      await link.waitFor({ timeout: 20_000 });
      assert.match(await link.innerText(), /Bea Builder/);
      await link.click();
      await h.page.locator('.prof-head').waitFor();
      await until(() => new URL(h.page.url()).pathname === '/people');
      assert.equal(new URL(h.page.url()).pathname, '/people');
      assert.ok(h.calls.some((c) => c.path === '/api/v1/users/u2/profile'));
    } finally {
      await h.close();
    }
  });

  void test('Organisation: a member or viewer sees names, not links', async () => {
    for (const [id, role] of [
      ['u3', 'member'],
      ['u5', 'viewer'],
    ] as const) {
      const h = await open('/organisation?tab=people', { ...ORG_STUB, '/api/v1/me': me(id, role) });
      try {
        await h.page
          .locator('.org-person', { hasText: 'Bea Builder' })
          .waitFor({ timeout: 20_000 });
        assert.equal(
          await h.page.locator('a[href^="/people"]').count(),
          0,
          `${role} is offered a profile`,
        );
      } finally {
        await h.close();
      }
    }
  });

  const CAP_STUB: ApiStub = {
    ...BASE,
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/capacity': {
      enabled: true,
      people: [
        capacityPerson({
          user_id: 'u2',
          name: 'Bea Builder',
          active_sessions: 1,
          last_seen: NOW - MIN,
          last_seen_via: 'agent',
          status: 'online',
        }),
      ],
    },
    '/api/v1/unlisted': refuse(403, 'forbidden', 'no'),
  };

  void test('Capacity: a card’s name opens the profile for an owner, and is plain for a member', async () => {
    const owner = await open('/insights?tab=capacity', {
      ...CAP_STUB,
      '/api/v1/me': me('u1', 'owner'),
    });
    try {
      // The loading skeleton's cards are `.cap-card` too, and hold no link, so
      // wait for the link itself rather than for the first card.
      const link = owner.page.locator('.cap-card a[href="/people?user=u2"]');
      await link.waitFor({ timeout: 20_000 });
      assert.equal(await link.count(), 1);
    } finally {
      await owner.close();
    }

    const member = await open('/insights?tab=capacity', {
      ...CAP_STUB,
      '/api/v1/me': me('u3', 'member'),
    });
    try {
      // The real card, found by its name: a skeleton has no name, and the
      // session gate draws no card before `/me`, so this is the member's view.
      const bea = member.page.locator('.cap-grid > .cap-card', {
        has: member.page.locator('.cap-name', { hasText: 'Bea Builder' }),
      });
      await bea.waitFor({ timeout: 20_000 });
      assert.equal((await bea.locator('.cap-status').innerText()).trim(), 'Online now');
      assert.equal(await member.page.locator('a[href^="/people"]').count(), 0);
    } finally {
      await member.close();
    }
  });

  const CORE = {
    id: 'p1',
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
  const task = (n: number, assignee: string | null, status: string) => ({
    id: `t${String(n)}`,
    key: `LC-${String(n)}`,
    number: n,
    project_id: 'p1',
    title: `Task ${String(n)}`,
    description_md: '',
    acceptance_md: '',
    status,
    status_id: `st-${status}`,
    status_name: status,
    priority: 'p2',
    position: null,
    assignee_id: assignee,
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
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    created_at: NOW - n * DAY,
    updated_at: NOW - n * 3_600_000,
    started_at: null,
    completed_at: null,
  });
  const DASH_STUB: ApiStub = {
    ...BASE,
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 1, in_progress: 2, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks': {
      data: [task(1, 'u2', 'in_progress'), task(2, 'u2', 'todo'), task(3, 'u3', 'in_progress')],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core/members': {
      members: ['u2', 'u3'].map((id) => ({
        user_id: id,
        name: PEOPLE.find((p) => p.id === id)?.name,
        email: `${id}@example.com`,
        role: 'member',
        created_at: 1,
      })),
    },
    '/api/v1/projects/laika-core/mentionable': {
      users: PEOPLE.map((p) => ({ id: p.id, name: p.name })),
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/metrics': {
      since: NOW - 7 * DAY,
      throughput: [],
      cycle_time: null,
    },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/presence': { enabled: false, present: [] },
  };

  // Work by person became Contributors (LAI-817); its Open work now tab holds
  // the people rows that open the board.
  void test('Open work now: each person has a profile link for an owner, none for a member', async () => {
    const owner = await open('/dashboard?project=laika-core', {
      ...DASH_STUB,
      '/api/v1/me': me('u1', 'owner'),
    });
    try {
      await owner.page
        .locator('.dash-people [role="tab"]', { hasText: 'Open work now' })
        .click({ timeout: 20_000 });
      await owner.page
        .locator('.dash-people .dash-legend-row')
        .first()
        .waitFor({ timeout: 20_000 });
      const profileLinks = owner.page.locator('.dash-people a[href^="/people?user="]');
      // Wait for the links it asserts, not the first row (LAI-715).
      await until(
        async () =>
          (
            await profileLinks.evaluateAll((els) => els.map((el) => el.getAttribute('href')).sort())
          ).join('|') === ['/people?user=u2', '/people?user=u3'].join('|'),
      );
      const links = await profileLinks.evaluateAll((els) =>
        els.map((el) => el.getAttribute('href')).sort(),
      );
      assert.deepEqual(links, ['/people?user=u2', '/people?user=u3']);
      // The row itself still opens the board, as it did.
      await until(
        async () =>
          (await owner.page
            .locator('.dash-people a.dash-legend-row[href*="assignee=u2"]')
            .count()) === 1,
      );
      assert.ok(
        (await owner.page
          .locator('.dash-people a.dash-legend-row[href*="assignee=u2"]')
          .count()) === 1,
      );
    } finally {
      await owner.close();
    }

    const member = await open('/dashboard?project=laika-core', {
      ...DASH_STUB,
      '/api/v1/me': me('u3', 'member'),
    });
    try {
      await member.page
        .locator('.dash-people [role="tab"]', { hasText: 'Open work now' })
        .click({ timeout: 20_000 });
      await member.page
        .locator('.dash-people .dash-legend-row')
        .first()
        .waitFor({ timeout: 20_000 });
      assert.equal(await member.page.locator('a[href^="/people"]').count(), 0);
    } finally {
      await member.close();
    }
  });
});

// --------------------------------------------- the everything-works pass (LAI-751)

/** The owner's own shape: 9 in progress and 34 in review, across two projects. */
function busy() {
  const task = (i: number, status: 'in_progress' | 'review') => ({
    id: `w${String(i)}`,
    key: `${i % 2 === 0 ? 'LC' : 'ORB'}-${String(100 + i)}`,
    title: `Work item ${String(i)} with a title long enough to need cutting at a narrow width`,
    project_slug: i % 2 === 0 ? 'laika-core' : 'orbit',
    status,
    status_name: status === 'review' ? 'Code review' : 'In progress',
    started_at: NOW - (60 - i) * DAY,
    // Longest waiting first, as the server sends it.
    review_since: status === 'review' ? NOW - (50 - i) * HOUR : null,
  });
  return {
    ...BUILDER,
    current_work: {
      in_progress: Array.from({ length: 9 }, (_, i) => task(i, 'in_progress')),
      in_progress_total: 9,
      in_review: Array.from({ length: 34 }, (_, i) => task(i + 9, 'review')),
      in_review_total: 34,
    },
  };
}

async function rowKeys(page: Page): Promise<string[]> {
  return page
    .locator('.prof-card[data-section="current"] .prof-work-row')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-task') ?? ''));
}

void describe('current work stays a card’s height (LAI-751)', () => {
  void test('five rows of one list, in the server’s order; Show all scrolls inside the card', async () => {
    const shape = busy();
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': shape,
    });
    try {
      const current = await section(h.page, 'current');
      // In progress first, capped at five, oldest started first.
      assert.equal(
        await current.locator('input[name="prof-work"][value="in_progress"]').isChecked(),
        true,
      );
      assert.deepEqual(
        await rowKeys(h.page),
        shape.current_work.in_progress.slice(0, 5).map((t) => t.key),
      );
      assert.match(
        await current.locator('.prof-work-switch').innerText(),
        /In progress 9.*In review 34/s,
      );

      // In review: five, longest waiting first, and their wait said.
      await current.locator('input[name="prof-work"][value="in_review"]').check();
      assert.deepEqual(
        await rowKeys(h.page),
        shape.current_work.in_review.slice(0, 5).map((t) => t.key),
      );
      assert.match(await current.locator('.prof-work-row').first().innerText(), /waiting 1 d 17 h/);
      // One line each: the whole title is on hover.
      const title = current.locator('.prof-work-row .prof-task-title').first();
      assert.equal(await title.getAttribute('title'), shape.current_work.in_review[0]?.title);

      const show = current.locator('button.prof-show-all');
      assert.equal(await show.innerText(), 'Show all 34');
      assert.equal(await show.getAttribute('aria-expanded'), 'false');
      await show.click();
      assert.equal((await rowKeys(h.page)).length, 34);
      assert.equal(await show.innerText(), 'Show less');
      const panel = await current.locator('.prof-work-panel').evaluate((el) => ({
        height: el.clientHeight,
        scroll: el.scrollHeight,
      }));
      assert.ok(panel.height <= 420, `the open list is ${String(panel.height)}px tall`);
      assert.ok(panel.scroll > panel.height, 'the rest does not scroll inside the card');

      await show.click();
      assert.equal((await rowKeys(h.page)).length, 5);
    } finally {
      await h.close();
    }
  });

  void test('no card at 1366 is taller than its content, and none is unbounded', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': busy(),
    });
    try {
      await h.page.setViewportSize({ width: 1366, height: 900 });
      await section(h.page, 'current');
      for (const expand of [false, true]) {
        if (expand) await h.page.locator('button.prof-show-all').click();
        const cards = await h.page
          .locator('.prof > .prof-card, .prof-column > .prof-card')
          .evaluateAll((els) =>
            els.map((el) => {
              const box = el.getBoundingClientRect();
              const last = el.lastElementChild?.getBoundingClientRect();
              return {
                name: el.getAttribute('data-section') ?? '',
                height: Math.round(box.height),
                // Card padding is 18px; more than that is a stretched card.
                slack: Math.round(box.bottom - (last?.bottom ?? box.bottom)),
              };
            }),
          );
        for (const card of cards) {
          assert.ok(card.slack <= 24, `${card.name}: ${String(card.slack)}px of empty card`);
          if (card.name !== 'activity') {
            assert.ok(card.height <= 640, `${card.name}: ${String(card.height)}px tall`);
          }
        }
      }
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------- the layout (LAI-751, owner, 2026-10-16)

/**
 * The owner's own profile as they saw it: 9 in progress, 34 in review, four
 * kinds of agent — one of them *Other agent*, one online with no writes —
 * three projects, and nothing accepted in the window.
 */
function ownerShape() {
  const base = busy();
  const token = (id: string, name: string, client: string, ago: number, clientName: string) => ({
    id,
    name,
    client,
    client_name: clientName,
    last_used_at: NOW - ago,
    last_mcp_at: NOW - ago,
    created_at: NOW - 60 * DAY,
  });
  return {
    ...base,
    projects: [
      ...BUILDER.projects.map((project) => ({ ...project, accepted: 0 })),
      {
        id: 'p3',
        slug: 'atlas',
        name: 'Atlas',
        key: 'ATL',
        role: 'member',
        archived: false,
        open_tasks: 6,
        accepted: 0,
        reviewed: 0,
      },
    ],
    review: EMPTY.review,
    delivery: {
      ...EMPTY.delivery,
      sent_back: 2,
    },
    agents: {
      tokens: [
        token('k1', 'Laptop Claude', 'claude-code', 2 * MIN, 'claude-code'),
        token('k2', 'Codex desk', 'codex', 3 * DAY, 'codex_cli_rs'),
        token('k5', 'Gemini on the desktop', 'gemini-cli', 20 * MIN, 'gemini-cli'),
        token('k6', 'Copilot in the terminal', 'other', 2 * DAY, 'copilot'),
      ],
      tokens_total: 4,
      online: { enabled: true, clients: ['claude-code', 'gemini-cli'], last_seen: NOW - MIN },
      writes: [
        { client: 'claude-code', writes: 20 },
        { client: 'codex', writes: 5 },
        { client: 'other', writes: 2 },
      ],
      writes_total: 27,
    },
  };
}

interface CardBox {
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  /** The tallest band inside the card's padding with nothing drawn in it, px. */
  readonly blank: number;
}

/**
 * Every card on the page, where it is, and the tallest stretch inside it with
 * nothing drawn — no text, no mark, no filled or bordered box. Measured from
 * what is painted, not from the profile's own classes, so it reads the same
 * on any version of the page.
 */
async function cardBoxes(page: Page): Promise<{ gap: number; cards: CardBox[] }> {
  return page.evaluate(() => {
    const prof = document.querySelector('.prof');
    const gap = prof === null ? Number.NaN : Number.parseFloat(getComputedStyle(prof).rowGap);
    const empty = (colour: string) => colour === 'transparent' || colour === 'rgba(0, 0, 0, 0)';
    const drawn = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || Number.parseFloat(style.opacity) === 0) return false;
      if (!empty(style.backgroundColor) || style.backgroundImage !== 'none') return true;
      for (const side of ['Top', 'Bottom'] as const) {
        if (
          Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
          style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none'
        )
          return true;
      }
      if (el instanceof SVGElement || el.tagName === 'IMG') return true;
      return [...el.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
    };
    const cards = [...document.querySelectorAll('.prof .prof-card')].map((card) => {
      const box = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      const top =
        box.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop);
      const bottom =
        box.bottom -
        Number.parseFloat(style.borderBottomWidth) -
        Number.parseFloat(style.paddingBottom);
      const spans: [number, number][] = [];
      for (const el of card.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1 || !drawn(el)) continue;
        let from = Math.max(rect.top, top);
        let to = Math.min(rect.bottom, bottom);
        // Only what shows: a row scrolled out of its list draws nothing here.
        for (let up = el.parentElement; up !== null && up !== card; up = up.parentElement) {
          if (getComputedStyle(up).overflowY === 'visible') continue;
          const clip = up.getBoundingClientRect();
          from = Math.max(from, clip.top);
          to = Math.min(to, clip.bottom);
        }
        if (to > from) spans.push([from, to]);
      }
      spans.sort((a, b) => a[0] - b[0]);
      let reached = top;
      let blank = 0;
      for (const [from, to] of spans) {
        blank = Math.max(blank, from - reached);
        reached = Math.max(reached, to);
      }
      blank = Math.max(blank, bottom - reached);
      return {
        name: card.getAttribute('data-section') ?? '',
        left: Math.round(box.left),
        top: box.top,
        bottom: box.bottom,
        blank: Math.round(blank),
      };
    });
    return { gap, cards };
  });
}

/**
 * The full-width cards that head the page, in order: Activity (LAI-751), then
 * Tokens (LAI-769). The columns start under the last of them.
 */
const FULL_WIDTH = ['activity', 'tokens'];

/** The cards below the full-width ones, grouped by the column they sit in, top first. */
function columnsOf(cards: readonly CardBox[]): CardBox[][] {
  const columns = new Map<number, CardBox[]>();
  for (const card of cards) {
    if (FULL_WIDTH.includes(card.name)) continue;
    columns.set(card.left, [...(columns.get(card.left) ?? []), card]);
  }
  return [...columns]
    .sort((a, b) => a[0] - b[0])
    .map(([, column]) => [...column].sort((a, b) => a.top - b.top));
}

/**
 * At 1366: three columns under the Activity card, the space between any two
 * cards in a column the page's own gap — never a row stretched to its
 * tallest neighbour — and no card with more than 48 px of nothing inside it.
 */
async function assertColumns(page: Page, want: number): Promise<CardBox[]> {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForTimeout(200);
  await until(async () => columnsOf((await cardBoxes(page)).cards).length === want);
  const { gap, cards } = await cardBoxes(page);
  assert.ok(gap > 0, 'the page has a gap between its blocks');
  assert.equal(
    cards.filter((card) => card.name === 'online').length,
    0,
    'Online now is a card of its own',
  );
  const activity = cards.find((card) => card.name === 'activity');
  assert.ok(activity !== undefined, 'the Activity card is on the page');
  const tokens = cards.find((card) => card.name === 'tokens');
  assert.ok(tokens !== undefined, 'the Tokens card is on the page');
  assert.ok(
    Math.abs(Math.round(tokens.top - activity.bottom) - gap) <= 1,
    'Tokens sits one gap under Activity',
  );
  const columns = columnsOf(cards);
  assert.equal(
    columns.length,
    want,
    `at 1366 the cards sit in ${String(columns.length)} columns, not ${String(want)}`,
  );
  for (const column of columns) {
    let above = tokens.bottom;
    for (const card of column) {
      const space = Math.round(card.top - above);
      assert.ok(
        Math.abs(space - gap) <= 1,
        `${card.name}: ${String(space)}px above it in its column, not the ${String(gap)}px gap`,
      );
      above = card.bottom;
    }
  }
  for (const card of cards) {
    assert.ok(card.blank <= 48, `${card.name}: ${String(card.blank)}px of empty card at 1366`);
  }
  return cards;
}

/** At 390, one column in reading order — the order the page's code says. */
async function assertOneColumn(page: Page, order: readonly string[]): Promise<void> {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(200);
  await until(
    async () => new Set((await cardBoxes(page)).cards.map((card) => card.left)).size === 1,
  );
  const { cards } = await cardBoxes(page);
  const lefts = new Set(cards.map((card) => card.left));
  assert.equal(lefts.size, 1, `at 390 the cards start at ${String(lefts.size)} different lefts`);
  assert.deepEqual(
    [...cards].sort((a, b) => a.top - b.top).map((card) => card.name),
    order,
    'at 390, top to bottom',
  );
  // And a screen reader meets them in the same order.
  assert.deepEqual(
    cards.map((card) => card.name),
    order,
  );
}

void describe('the profile’s layout (LAI-751, owner, 2026-10-16)', () => {
  void test('the owner’s own profile: columns, Online in Agents used, nothing stretched', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': ownerShape(),
    });
    try {
      await section(h.page, 'current');
      await h.page.locator('.prof-card[data-section="activity"][aria-busy="false"]').waitFor();
      await assertColumns(h.page, 3);

      // Online now is a line in Agents used: the header says how many, the
      // rows which, each with its dot and when it was last active.
      const agents = await section(h.page, 'agents');
      assert.match(await agents.locator('.prof-card-head').innerText(), /2 online/);
      await until(
        async () =>
          (
            await agents
              .locator('.prof-agent:has(.prof-live-dot)')
              .evaluateAll((els) => els.map((el) => el.getAttribute('data-client')))
          ).join('|') === ['claude-code', 'gemini-cli'].join('|'),
      );
      const live = await agents
        .locator('.prof-agent:has(.prof-live-dot)')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-client')));
      assert.deepEqual(live, ['claude-code', 'gemini-cli']);
      assert.match(
        await agents.locator('.prof-agent[data-client="gemini-cli"]').innerText(),
        /Gemini CLI\s*online.*active 20 min/s,
      );

      // *Other agent*, with its share as a number; no share and no dash for
      // an agent with no writes.
      const other = agents.locator('.prof-agent[data-client="other"]');
      assert.match(await other.innerText(), /^Other agent/m);
      assert.doesNotMatch(await agents.innerText(), /another agent/);
      assert.match(await other.locator('.prof-share-pct').innerText(), /^\d+%$/);
      const gemini = agents.locator('.prof-agent[data-client="gemini-cli"]');
      assert.equal(await gemini.locator('.prof-share-pct').count(), 0);
      assert.doesNotMatch(await gemini.innerText(), /—/);

      // Delivery with nothing accepted: one line, and no tiles of zeros.
      const delivery = await section(h.page, 'delivery');
      assert.match(
        await delivery.innerText(),
        /Nothing accepted in these 12 weeks · 2 sent back\./,
      );
      assert.equal(await delivery.locator('.prof-stats').count(), 0);
      // Review work with no decisions: one line.
      const review = await section(h.page, 'review');
      assert.equal(await review.locator('.prof-stats').count(), 0);
      assert.match(await review.innerText(), /No review decisions in these 12 weeks\./);

      await h.page.setViewportSize({ width: 1024, height: 900 });
      await h.page.waitForTimeout(200);
      await until(async () => columnsOf((await cardBoxes(h.page)).cards).length === 2);
      assert.equal(columnsOf((await cardBoxes(h.page)).cards).length, 2, 'two columns at 1024');

      await assertOneColumn(h.page, [
        'activity',
        'tokens',
        'delivery',
        'current',
        'agents',
        'review',
        'projects',
        'rating',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('an empty profile: every card its title and one short line', async () => {
    const h = await open('/people?user=u6', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u6/profile': EMPTY,
    });
    try {
      await section(h.page, 'rating');
      await h.page.locator('.prof-card[data-section="activity"][aria-busy="false"]').waitFor();
      await assertColumns(h.page, 3);
      await until(async () => (await h.page.locator('.prof-columns .prof-card').count()) === 6);
      const cards = await h.page.locator('.prof-columns .prof-card').evaluateAll((els) =>
        els.map((el) => {
          const lines = el.querySelectorAll('.prof-empty');
          const line = lines[0];
          const head = el.querySelector('.prof-card-head');
          const lineHeight =
            line === undefined ? 0 : Number.parseFloat(getComputedStyle(line).lineHeight);
          return {
            name: el.getAttribute('data-section') ?? '',
            lines: lines.length,
            oneLine:
              line === undefined ? false : line.getBoundingClientRect().height <= lineHeight * 1.5,
            rest: (el as HTMLElement).innerText
              .replace((head as HTMLElement | null)?.innerText ?? '', '')
              .replace((line as HTMLElement | undefined)?.innerText ?? '', '')
              .trim(),
          };
        }),
      );
      assert.equal(cards.length, 6);
      for (const card of cards) {
        assert.equal(card.lines, 1, `${card.name}: ${String(card.lines)} empty lines`);
        assert.ok(card.oneLine, `${card.name}: its empty line wraps at 1366`);
        assert.equal(card.rest, '', `${card.name}: more than its title and one line`);
      }
      // No dashed box, no tiles of zeros above it.
      assert.equal(
        await h.page
          .locator('.prof-empty')
          .evaluateAll(
            (els) => els.filter((el) => getComputedStyle(el).borderTopStyle !== 'none').length,
          ),
        0,
      );
      assert.equal(await h.page.locator('.prof-columns .prof-stats').count(), 0);

      await assertOneColumn(h.page, [
        'activity',
        'tokens',
        'delivery',
        'current',
        'agents',
        'review',
        'projects',
        'rating',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('a manager’s profile: the same columns, with their own cards', async () => {
    const h = await open('/people?user=u3', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u3/profile': MANAGER,
    });
    try {
      await section(h.page, 'decisions');
      await h.page.locator('.prof-card[data-section="activity"][aria-busy="false"]').waitFor();
      const cards = await assertColumns(h.page, 3);
      assert.deepEqual(cards.map((card) => card.name).sort(), [
        'activity',
        'decisions',
        'projects',
        'rating',
        'review',
        'tokens',
      ]);
      await assertOneColumn(h.page, [
        'activity',
        'tokens',
        'review',
        'decisions',
        'projects',
        'rating',
      ]);
    } finally {
      await h.close();
    }
  });
});

void describe('agents used, one row per agent (LAI-751)', () => {
  void test('says how many tokens and when last used, the names behind an expand', async () => {
    const shape = {
      ...BUILDER,
      agents: {
        ...BUILDER.agents,
        tokens: [
          ...BUILDER.agents.tokens,
          {
            id: 'k3',
            name: 'claude-code on macOS',
            client: 'claude-code',
            client_name: 'claude-code',
            last_used_at: NOW - 9 * MIN,
            last_mcp_at: null,
            created_at: NOW - 10 * DAY,
          },
          // Minted, never connected: no agent was used through it.
          {
            id: 'k4',
            name: 'claude-token',
            client: 'other',
            client_name: null,
            last_used_at: null,
            last_mcp_at: null,
            created_at: NOW - 5 * DAY,
          },
        ],
        tokens_total: 4,
      },
    };
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': shape,
    });
    try {
      const agents = await section(h.page, 'agents');
      const claude = agents.locator('.prof-agent[data-client="claude-code"]');
      assert.match(await claude.innerText(), /2 tokens · active 2 min ago/);
      const toggle = claude.locator('.prof-tokens-toggle');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.doesNotMatch(await agents.innerText(), /claude-code on macOS/);
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await claude.locator('.prof-token-names li').allInnerTexts(), [
        'Laptop Claude',
        'claude-code on macOS',
      ]);
      // The token that never connected is nobody's agent (LAI-751 e).
      assert.equal(await agents.locator('.prof-agent[data-client="other"]').count(), 0);
      assert.doesNotMatch(await agents.innerText(), /another agent|claude-token/);
    } finally {
      await h.close();
    }
  });

  void test('its (i) says a token used with two agents credits all its writes to the last one', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const agents = await section(h.page, 'agents');
      await agents.locator('.prof-info-button').first().click();
      assert.match(
        await agents.innerText(),
        /A token used with two agents credits all its writes to the last one it connected as/,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the profile’s smaller fixes (LAI-751)', () => {
  void test('an archived project with a long key keeps a readable name', async () => {
    const shape = {
      ...BUILDER,
      projects: [
        {
          ...BUILDER.projects[1]!,
          key: 'LONGKEY8',
          name: 'Customer onboarding',
          archived: true,
        },
      ],
    };
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': shape,
    });
    try {
      const projects = await section(h.page, 'projects');
      for (const width of [1366, 1024, 390]) {
        await h.page.setViewportSize({ width, height: 900 });
        const title = projects.locator('.prof-project-title').first();
        const box = await title.boundingBox();
        assert.ok(
          (box?.width ?? 0) >= 60,
          `${String(width)}: the name is ${String(box?.width)}px wide`,
        );
        assert.equal(
          await projects.locator('.prof-project-name').first().getAttribute('title'),
          'Customer onboarding',
        );
        assert.match(await projects.locator('.prof-row-meta').first().innerText(), /ARCHIVED/);
      }
    } finally {
      await h.close();
    }
  });

  void test('a decision on an unassigned task reads Unassigned, and waiting says nobody’s counts', async () => {
    const shape = {
      ...MANAGER,
      review: {
        ...MANAGER.review,
        recent: [{ ...MANAGER.review.recent[0]!, assignee: null }],
      },
    };
    const h = await open('/people?user=u3', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u3/profile': shape,
    });
    try {
      const decisions = await section(h.page, 'decisions');
      assert.match(await decisions.innerText(), /Unassigned/);
      assert.match(
        (await h.page.locator('[data-stat="waiting"]').getAttribute('title')) ?? '',
        /someone else’s, or nobody’s/,
      );
    } finally {
      await h.close();
    }
  });

  /**
   * LAI-749 keeps one attempt per member; nothing tested it until now (the
   * LAI-749 review). Bea fails, Cal fails, and back on Bea the same rating
   * must go with **Bea's** key — a store of one would have Cal's in it.
   */
  void test('going back to a member retries with that member’s own key', async () => {
    const sent: { path: string; key: string | undefined }[] = [];
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
      '/api/v1/users/u3/profile': {
        ...BUILDER,
        user: { ...BUILDER.user, id: 'u3', name: 'Cal Lead' },
      },
    });
    try {
      await h.page.route('**/api/v1/users/*/ratings', async (route) => {
        const path = new URL(route.request().url()).pathname;
        sent.push({ path, key: route.request().headers()['idempotency-key'] });
        await route.abort('connectionreset');
      });
      const dialog = h.page.locator('.rating-dialog');
      const rateAndClose = async (n: number): Promise<void> => {
        await h.page.locator('button.prof-rate').click();
        await dialog.locator('input[name="rating-score"][value="4"]').check();
        await dialog.locator('textarea').fill('Same rating, same note.');
        await dialog.locator('button.rating-submit').click();
        await until(() => sent.length === n);
        await dialog.locator('[role="alert"]').waitFor();
        await until(async () => !(await dialog.locator('button.rating-cancel').isDisabled()));
        await dialog.locator('button.rating-cancel').click();
        await dialog.waitFor({ state: 'detached' });
      };
      const goTo = async (id: string, name: string): Promise<void> => {
        await h.page.evaluate((to) => {
          history.pushState({}, '', `/people?user=${to}`);
          dispatchEvent(new PopStateEvent('popstate'));
        }, id);
        await h.page.locator('.prof-head', { hasText: name }).waitFor();
      };

      await h.page.locator('.prof-head', { hasText: 'Bea Builder' }).waitFor({ timeout: 20_000 });
      await rateAndClose(1);
      await goTo('u3', 'Cal Lead');
      await rateAndClose(2);
      await goTo('u2', 'Bea Builder');
      await rateAndClose(3);

      assert.deepEqual(
        sent.map((s) => s.path),
        ['/api/v1/users/u2/ratings', '/api/v1/users/u3/ratings', '/api/v1/users/u2/ratings'],
      );
      assert.notEqual(sent[1]?.key, sent[0]?.key, 'Cal’s rating reused Bea’s key');
      assert.equal(sent[2]?.key, sent[0]?.key, 'back on Bea, her retry took a new key');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('Back while a rating saves never draws the previous person over the page', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posted = false;
    const reads: string[] = [];
    const h = await open('/people?user=u3', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': (call: { path: string }) => {
        reads.push(call.path);
        return BUILDER;
      },
      '/api/v1/users/u3/profile': {
        ...BUILDER,
        user: { ...BUILDER.user, id: 'u3', name: 'Cal Lead' },
      },
    });
    try {
      await h.page.route('**/api/v1/users/u2/ratings', async (route) => {
        posted = true;
        await held;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(BUILDER.ratings[0]),
        });
      });
      await h.page.locator('.prof-head', { hasText: 'Cal Lead' }).waitFor({ timeout: 20_000 });
      // To Bea, as a link would: Back then returns to Cal.
      await h.page.evaluate(() => {
        history.pushState({}, '', '/people?user=u2');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await h.page.locator('.prof-head', { hasText: 'Bea Builder' }).waitFor();
      const before = reads.length;

      await h.page.locator('button.prof-rate').click();
      const dialog = h.page.locator('.rating-dialog');
      await dialog.locator('input[name="rating-score"][value="5"]').check();
      await dialog.locator('textarea').fill('Saved while leaving.');
      await dialog.locator('button.rating-submit').click();
      await until(() => posted);

      await h.page.goBack();
      await h.page.locator('.prof-head', { hasText: 'Cal Lead' }).waitFor();
      assert.equal(await dialog.count(), 0, 'Bea’s dialog followed onto Cal’s page');

      release();
      // Give a late answer every chance to land.
      await h.page.waitForTimeout(400);
      assert.match(await h.page.locator('.prof-head').innerText(), /Cal Lead/);
      assert.doesNotMatch(await h.page.locator('.prof-head').innerText(), /Bea Builder/);
      assert.equal(reads.length, before, 'Bea’s profile was read again after leaving her');
      assert.match(h.page.url(), /user=u3/);
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});
