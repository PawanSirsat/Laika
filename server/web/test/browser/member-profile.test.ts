/**
 * The member profile, in a real browser (LAI-743, D-078).
 *
 * The server tests own the figures and the door. What is left to prove is the
 * page a person reads: that every figure on it is the one the response
 * carried (the Overview's cards in detail are profile-overview.test.ts's,
 * LAI-1153), and that the way in — a name on Organisation, a Capacity card, a *Work by person*
 * row — is a link for an owner or admin and plain text for anyone else.
 *
 * Fixtures are anchored to `Date.now()`, never to a date (CONVENTIONS §4).
 * The delivery figures that sit side by side are given different values —
 * accepted 4, sent back 6, reopened 7, p50 3 d, p75 4.5 d — so a card showing
 * one field under another's label fails rather than matching by coincidence.
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
/** Open the Manage member panel (LAI-1134): ⋯ in the header, then *Manage member…*. */
async function managePanel(page: Page) {
  const more = page.locator('[data-profile-manage] button[aria-haspopup="menu"]');
  await more.waitFor({ timeout: 20_000 });
  await more.click();
  await page.getByRole('menuitem', { name: 'Manage member…' }).click();
  const panel = page.locator('[data-panel="manage-member"]');
  await panel.waitFor({ timeout: 10_000 });
  return panel;
}

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
      // The sub-line counts the response's projects; the notice above the
      // head card says who sees this (LAI-1152).
      assert.match(headText, /2 projects/);
      assert.match(
        await h.page.locator('[data-profile-notice]').innerText(),
        /Owners and admins only · read-only · Bea can see that you looked/,
      );
      // The kind is a chip in the header; the control is in the panel.
      assert.equal(
        (await head.locator('[data-kind-chip="builder"]').innerText()).trim(),
        'Builder',
      );
      const panel = await managePanel(h.page);
      assert.equal(
        await panel.locator('input[name="profile-kind"][value="builder"]').isChecked(),
        true,
      );
      await panel.getByRole('button', { name: 'Close' }).click();
      await panel.waitFor({ state: 'detached' });

      // The Overview's cards (LAI-1153): the figures are profile-overview.test.ts's;
      // here, that each is drawn from this response.
      const projects = await section(h.page, 'projects');
      assert.match(await projects.locator('.prof-card-count').innerText(), /^2$/);
      assert.match(await projects.innerText(), /Laika Core/);
      assert.match(await projects.innerText(), /ARCHIVED/);
      const work = await section(h.page, 'work');
      assert.deepEqual(
        (await work.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
        ['In progress 1', 'In review 1', 'Due in 7 days —'],
      );
      assert.match(await work.innerText(), /LC-7.*Seven: the migration runner.*3 d/s);
      assert.match(
        await work.locator('[data-delivered]').innerText(),
        /4 accepted · 7 reopened · cycle p50 3 d, p75 4 d 12 h · 1 done with no recorded start/,
      );
      await section(h.page, 'review');
      assert.equal(await stat(h.page, 'review_accepted'), '0');
      assert.equal(await stat(h.page, 'review_sent_back'), '1');
      assert.equal(await stat(h.page, 'review_30d'), '1');
      assert.equal(await stat(h.page, 'decide_p50'), '2 h');
      const agents = await section(h.page, 'agents');
      assert.equal(await agents.locator('.ov-tool[data-online="true"]').count(), 1);
      assert.match(await agents.locator('.prof-card-caption').innerText(), /1 online$/);

      // The response still carries ratings; the page draws none (D-139 item 8).
      assert.equal(await h.page.locator('[data-section="rating"]').count(), 0);
      assert.doesNotMatch(await h.page.locator('.prof').innerText(), /Clears review fast/);
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
      await section(h.page, 'work');
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

  void test('says what is empty for a person with no history', async () => {
    const h = await open('/people?user=u6', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u6/profile': EMPTY,
    });
    try {
      await section(h.page, 'work');
      await until(
        async () => (await h.page.locator('[data-section="tokens"] [data-empty]').count()) === 1,
      );
      const text = await h.page.locator('.prof').innerText();
      assert.match(text, /No projects yet/);
      assert.match(text, /Nothing here right now/);
      assert.match(text, /Nothing accepted yet/);
      assert.match(text, /Nia hasn’t set up an agent yet/);
      assert.equal(
        await h.page.locator('.prof-card[data-section="agents"] .prof-card-caption').innerText(),
        'none set up',
      );
      assert.match(text, /No review decisions in these 12 weeks/);
      assert.doesNotMatch(text, /undefined|NaN|null/);
      // A sentence inside the card, not twelve empty bars (LAI-750).
      assert.equal(
        await h.page.locator('.prof-card[data-section="review"] .prof-bars').count(),
        0,
        'an empty review card still draws a chart',
      );
      assert.equal(
        await h.page.locator('.prof-card[data-section="agents"] .prof-share').count(),
        0,
        'a share bar with no tokens',
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
    ['an owner', me('u1', 'owner'), /^No LLM tokens recorded in these 12 weeks\.$/],
    ['the person', me('u2', 'admin'), /^No LLM tokens recorded in these 12 weeks\. Tokens arrive /],
  ] as const) {
    void test(`${reader}: a stale personal “off” names no switch on the Tokens card`, async () => {
      const h = await open('/people?user=u2', {
        ...BASE,
        '/api/v1/me': readerRole,
        '/api/v1/users/u2/profile': BUILDER,
        // The person's own read (D-139, LAI-1150).
        '/api/v1/me/profile': BUILDER,
        '/api/v1/me/activity': activityStub,
        '/api/v1/users/u2/usage': {
          ...quietUsage('u2'),
          sharing: { org_enabled: true, enabled: false },
        },
      });
      try {
        const empty = (await section(h.page, 'tokens')).locator('.prof-empty');
        await until(async () => (await empty.innerText()).includes('No LLM tokens'));
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

void describe('the kind control', () => {
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
      // In the Manage member panel since LAI-1134.
      const group = (await managePanel(h.page)).locator('[role="radiogroup"]');
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
      await (
        await managePanel(h.page)
      )
        .locator('input[name="profile-kind"][value="manager"]')
        .click();

      // The kind is a label (D-139 item 2): the chip follows the answer, and
      // the same Overview stays — agents says none set up for this answer.
      await until(async () => (await h.page.locator('[data-kind-chip="manager"]').count()) === 1);
      assert.equal(await h.page.locator('[data-kind-chip="manager"]').count(), 1);
      assert.equal(
        await h.page.locator('.prof-card[data-section="agents"] .prof-card-caption').innerText(),
        'none set up',
      );
      const patch = h.calls.find((c) => c.method === 'PATCH');
      assert.deepEqual(patch?.body, { profile_kind: 'manager' });
      assert.equal(patch?.path, '/api/v1/users/u2/profile');
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
        const title = projects.locator('.ov-project-title').first();
        await until(async () => ((await title.boundingBox())?.width ?? 0) >= 60).catch(
          () => undefined,
        );
        const box = await title.boundingBox();
        assert.ok(
          (box?.width ?? 0) >= 60,
          `${String(width)}: the name is ${String(box?.width)}px wide`,
        );
        assert.equal(await title.getAttribute('title'), 'Customer onboarding');
        assert.match(await projects.locator('.ov-project-name').first().innerText(), /ARCHIVED/);
      }
    } finally {
      await h.close();
    }
  });
});
