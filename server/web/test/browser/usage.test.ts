/**
 * The Usage page and the profile's Tokens card (LAI-769, D-084), as each
 * reader sees them.
 *
 * The fixtures are served **as the server answers each reader**: an owner's
 * `GET /usage` carries `by_developer`, a member's and a token's carry `null`
 * (`services/token-usage.ts`). So these tests hold the client to drawing what
 * is sent — and the server's tests hold the server to sending it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { LAIKA, ONROUTE } from './capacity-org.ts';
import { offered, pick } from './dropdown.ts';
import {
  closeBrowser,
  open,
  reply,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

void after(async () => {
  await closeBrowser();
});

const DAY_MS = 86_400_000;
const today = new Date();
const dayOf = (back: number): string =>
  new Date(today.getTime() - back * DAY_MS).toISOString().slice(0, 10);

const OWNER = {
  id: 'u1',
  email: 'ada@example.test',
  name: 'Ada Owner',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};
const MEMBER = {
  id: 'u2',
  email: 'bea@example.test',
  name: 'Bea Builder',
  org_role: 'member',
  is_active: true,
  memberships: [
    { project_id: 'p2', role: 'member' },
    { project_id: 'p1', role: 'member' },
  ],
};

/** A cost as the server prices one (LAI-773): dollars, and what went unpriced or inferred. */
const cost = (usd: number, unpriced = 0, models: string[] = [], inferred: string[] = []) => ({
  usd,
  unpriced_tokens: unpriced,
  unpriced_models: models,
  unconfirmed_models: inferred,
});

const figures = (tokens: number, cacheRead: number, attributed: number) => ({
  tokens,
  input: Math.round(tokens * 0.01),
  output: Math.round(tokens * 0.2),
  cache_write: tokens - Math.round(tokens * 0.01) - Math.round(tokens * 0.2),
  cache_read: cacheRead,
  attributed_tokens: attributed,
  cost: cost(Math.round(tokens * 1.2e-5 * 100) / 100),
});

/** A budget as `services/token-budgets.ts` answers one. */
const budget = (over: Record<string, unknown>) => ({
  scope: 'task',
  id: 't1',
  project: { slug: 'laika', name: 'Laika' },
  label: 'LAI-769',
  title: 'Token usage, phase 1',
  source: 'forecast',
  tokens: 10_000_000,
  period: null,
  used: 12_000_000,
  share: 1.2,
  state: 'over',
  crossed: [
    { threshold: 80, at: 1 },
    { threshold: 100, at: 2 },
  ],
  ...over,
});

function trend(days: number, perDay: (i: number) => number) {
  return Array.from({ length: days }, (_, i) => ({
    day: dayOf(days - 1 - i),
    tokens: perDay(i),
    cache_read: perDay(i) * 60,
  }));
}

/** The whole organisation, as an owner on a web session is answered. */
function orgUsage(days = 30) {
  return {
    from: dayOf(days - 1),
    to: dayOf(0),
    tz: 'UTC',
    days,
    project: null,
    totals: figures(254_973_258, 16_346_307_361, 12_000_000),
    trend: trend(days, (i) => (i % 7 === 5 ? 0 : 4_000_000 + i * 150_000)),
    by_developer: [
      {
        user_id: 'u1',
        name: 'Ada Owner',
        tokens: 200_000_000,
        cache_read: 13e9,
        attributed_tokens: 0,
        cost: cost(2_400),
      },
      {
        user_id: 'u2',
        name: 'Bea Builder',
        tokens: 54_973_258,
        cache_read: 3_346_307_361,
        attributed_tokens: 12_000_000,
        cost: cost(659.68),
      },
    ],
    by_agent: [
      { agent: 'claude-code', tokens: 254_937_201, cache_read: 16_340_000_000 },
      { agent: 'codex', tokens: 36_057, cache_read: 6_307_361 },
    ],
    by_model: [
      { model: 'claude-opus-5-5', tokens: 230_000_000, cache_read: 15e9, cost: 2_210.5 },
      { model: 'claude-fable-5-1', tokens: 24_937_201, cache_read: 1.34e9, cost: 849.18 },
      { model: 'gpt-6.1-sol', tokens: 36_057, cache_read: 6_307_361, cost: 0.42 },
    ],
    top_tasks: [
      {
        task_id: 't1',
        key: 'LAI-769',
        title: 'Token usage, phase 1',
        project_slug: 'laika',
        tokens: 12_000_000,
        cache_read: 800_000_000,
      },
    ],
    no_token_data: ['cursor', 'windsurf'],
    org_totals: null,
    // LAI-772: what send-backs cost, per space.
    rework: [
      {
        project: { slug: 'laika', name: 'Laika' },
        send_backs: 3,
        tasks: 2,
        tokens: 1_230_000,
        cache_read: 9_000_000,
        time_ms: 6 * 3_600_000,
        open: 1,
        share: 0.12,
      },
    ],
    // LAI-773: telemetry, cache, accepted-task cost, budgets, runaway counts.
    telemetry: { tokens: 18_400_000, cost_usd_reported: 3_120.55 },
    cache: { share: 0.984, saving_usd: 41_520.3 },
    cache_by_project: [
      {
        project: { slug: 'laika', name: 'Laika' },
        cache_read: 800_000_000,
        input_side: 812_000_000,
        share: 0.985,
        saving_usd: 3_200.5,
      },
    ],
    accepted: {
      by_project: [
        {
          project: { slug: 'laika', name: 'Laika' },
          tasks: 6,
          tokens: 9_000_000,
          cost: cost(62.4),
          cost_per_task: 10.4,
        },
      ],
      by_agent: [
        {
          agent: 'claude-code',
          tasks: 6,
          people: 3,
          tokens: 8_700_000,
          cost: cost(60.1),
          cost_per_task: 10.02,
        },
      ],
      // An owner on a session sees every agent (D-087 item 7): nothing folded.
      agents_withheld: 0,
    },
    budgets: [
      budget({
        scope: 'project',
        id: 'p1',
        label: 'Laika',
        title: null,
        source: 'set',
        tokens: 15_000_000,
        period: { from: '2026-10-01', to: '2026-10-31' },
        used: 12_000_000,
        share: 0.8,
        state: 'warn',
        crossed: [{ threshold: 80, at: 1 }],
      }),
      budget({}),
    ],
    runaway: [{ project: { slug: 'laika', name: 'Laika' }, alerts: 2 }],
  };
}

/**
 * One space: only tokens tied to its tasks, so all of them attributed. An
 * owner is also sent the organisation's totals, to say what no space holds; a
 * member is sent `null`.
 */
function spaceUsage(slug: string, reader: 'owner' | 'member' = 'member') {
  return {
    ...orgUsage(30),
    project: { slug, name: slug === 'laika' ? 'Laika' : 'Onroute' },
    totals: figures(12_000_000, 800_000_000, 12_000_000),
    by_developer: null,
    org_totals: reader === 'owner' ? figures(254_973_258, 16_346_307_361, 12_000_000) : null,
    // Telemetry ties to no task, so a space has none; counts are for owners and admins.
    telemetry: null,
    runaway: reader === 'owner' ? [{ project: { slug, name: 'Laika' }, alerts: 2 }] : null,
    ...(reader === 'member' ? folded() : {}),
  };
}

/**
 * What a member is sent (D-087 item 7): every agent and model fewer than three
 * people used is one last row with `few_people`, its `agent` `other` — beside
 * the `other` kind's own row, which three people stand behind. The folded
 * model and the folded accepted agent are unpriced with only cache reads, so
 * `unpriced_tokens` is 0 and only the model list says there is no price.
 */
function folded() {
  return {
    by_agent: [
      { agent: 'claude-code', tokens: 11_000_000, cache_read: 790_000_000 },
      { agent: 'other', tokens: 900_000, cache_read: 9_000_000 },
      { agent: 'other', tokens: 100_000, cache_read: 1_000_000, few_people: 2 },
    ],
    by_model: [
      { model: 'claude-opus-5-5', tokens: 11_900_000, cache_read: 799_000_000, cost: 98.2 },
      { model: 'other', tokens: 0, cache_read: 1_000_000, cost: null, few_people: 1 },
    ],
    accepted: {
      by_project: [
        {
          project: { slug: 'laika', name: 'Laika' },
          tasks: 6,
          tokens: 9_000_000,
          cost: cost(62.4),
          cost_per_task: 10.4,
        },
      ],
      by_agent: [
        {
          agent: 'claude-code',
          tasks: 6,
          people: 3,
          tokens: 8_700_000,
          cost: cost(62.4),
          cost_per_task: 10.4,
        },
        {
          agent: 'other',
          tasks: 2,
          people: 2,
          tokens: 0,
          cost: cost(0, 0, ['mystery-1']),
          cost_per_task: 0,
          few_people: 1,
        },
      ],
      agents_withheld: 1,
    },
  };
}

/** A space nothing is tied to yet — every member's, until agents mark their tasks. */
function emptySpace(slug: string) {
  return {
    ...spaceUsage(slug),
    totals: figures(0, 0, 0),
    trend: trend(30, () => 0),
    by_agent: [],
    by_model: [],
    top_tasks: [],
  };
}

const weeks = Array.from({ length: 12 }, (_, i) => ({
  start: dayOf((11 - i) * 7 + ((today.getUTCDay() + 6) % 7)),
  tokens: i < 4 ? 0 : 3_000_000 * (i - 3),
  cache_read: i < 4 ? 0 : 200_000_000 * (i - 3),
}));

function personUsage(userId: string) {
  return {
    user_id: userId,
    from: weeks[0]?.start ?? '',
    to: dayOf(-1),
    weeks,
    totals: figures(
      weeks.reduce((n, w) => n + w.tokens, 0),
      weeks.reduce((n, w) => n + w.cache_read, 0),
      12_000_000,
    ),
    by_agent: [
      { agent: 'claude-code', tokens: 100_000_000, cache_read: 7e9 },
      { agent: 'codex', tokens: 8_000_000, cache_read: 2e8 },
    ],
    by_model: [
      { model: 'claude-opus-5-5', tokens: 108_000_000, cache_read: 7.2e9, cost: 1_872.44 },
    ],
    no_token_data: ['cursor'],
    sharing: { org_enabled: true, enabled: true },
  };
}

/** The person's own plan limit, as `services/plan-limit.ts` answers one. */
const planLimit = (over: Record<string, unknown> = {}) => ({
  plan: null,
  window: null,
  limit_tokens: null,
  week_reset: null,
  tz: 'UTC',
  used: 0,
  rate_per_hour: 0,
  window_start: null,
  window_end: null,
  reaches_limit_at: null,
  reached: false,
  estimate: true,
  ...over,
});

const projectBudgets = (canSet: boolean) => ({
  project_budget: null,
  sprints: [],
  tasks: [],
  can_set: canSet,
});

const BASE: ApiStub = {
  '/api/v1/projects': { data: [LAIKA, ONROUTE], next_cursor: null },
  '/api/v1/me/plan-limit': planLimit(),
  '/api/v1/projects/laika/budgets': projectBudgets(false),
  '/api/v1/projects/onroute/budgets': projectBudgets(false),
  '/api/v1/org': {
    id: 'o1',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/unlisted': { data: [], next_cursor: null },
};

function ownerStub(): ApiStub {
  return {
    ...BASE,
    '/api/v1/me': OWNER,
    '/api/v1/usage?days=30': orgUsage(30),
    '/api/v1/usage?days=7': orgUsage(7),
    '/api/v1/usage?days=30&project=laika': spaceUsage('laika', 'owner'),
    '/api/v1/users/u1/usage': personUsage('u1'),
  };
}

function memberStub(): ApiStub {
  return {
    ...BASE,
    '/api/v1/me': MEMBER,
    '/api/v1/usage?days=30&project=laika': spaceUsage('laika'),
    '/api/v1/usage?days=30&project=onroute': emptySpace('onroute'),
    '/api/v1/users/u2/usage': personUsage('u2'),
  };
}

async function ready(page: Page): Promise<void> {
  await page.locator('.usage-tiles [data-stat="tokens"]').waitFor({ timeout: 20_000 });
}

const stat = async (page: Page, name: string): Promise<string> =>
  (await page.locator(`.usage-tiles [data-stat="${name}"] .usage-stat-value`).innerText()).trim();

const rows = async (page: Page, section: string): Promise<string[]> =>
  (
    await page
      .locator(`.usage-card[data-section="${section}"] .usage-row .usage-row-name`)
      .allInnerTexts()
  ).map((t) => t.trim());

void describe('an owner', () => {
  void test('sees the organisation: a floor without cache reads, cache reads apart, the unattributed share', async () => {
    const h = await open('/usage', ownerStub());
    try {
      await ready(h.page);
      assert.equal(await stat(h.page, 'tokens'), '255M');
      assert.equal(await stat(h.page, 'cache-reads'), '16.3B');
      assert.equal(await stat(h.page, 'unattributed'), '95%');
      assert.match(
        await h.page.locator('.usage-tiles [data-stat="tokens"]').innerText(),
        /at least/i,
      );
      assert.match(await h.page.locator('.usage-floor').innerText(), /at least/i);
      // One bar a day of the range, each with its words for a screen reader.
      assert.equal(await h.page.locator('.usage-trend .usage-bar').count(), 30);
      assert.match(
        (await h.page.locator('.usage-trend .usage-bar').last().getAttribute('aria-label')) ?? '',
        /tokens/,
      );
      // Rework cost, per space and nobody's (LAI-772).
      const rework = h.page.locator('[data-section="rework"]');
      assert.equal(await rework.locator('.usage-rework-name').innerText(), 'Laika');
      assert.equal(
        await rework.locator('.usage-rework-line').innerText(),
        '3 send-backs on 2 tasks · 1.23M tokens (12% of the space’s) · 6.0 h of rework, 1 still open',
      );
      // Asked for the organisation: no project, the reader's zone.
      const asked = h.calls.find((c) => c.path === '/api/v1/usage');
      assert.ok(asked !== undefined);
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('by developer in name order — never ranked — then agents, models and tasks', async () => {
    const h = await open('/usage', ownerStub());
    try {
      await ready(h.page);
      assert.deepEqual(await rows(h.page, 'developers'), ['Ada Owner', 'Bea Builder']);
      const agents = await rows(h.page, 'agents');
      assert.deepEqual(agents.slice(0, 2), ['Claude Code', 'Codex']);
      // Agents with no token source say so, not zero.
      const noData = await h.page
        .locator('.usage-card[data-section="agents"] [data-no-data]')
        .allInnerTexts();
      assert.equal(noData.length, 2);
      for (const line of noData) assert.match(line, /no token data/);
      assert.deepEqual(await rows(h.page, 'models'), [
        'claude-opus-5-5',
        'claude-fable-5-1',
        'gpt-6.1-sol',
      ]);
      assert.match(
        await h.page.locator('.usage-card[data-section="tasks"]').innerText(),
        /LAI-769/,
      );
      // A name is the way into their profile, for a reader who may open it.
      assert.equal(
        await h.page
          .locator('.usage-card[data-section="developers"] a[href="/people?user=u2"]')
          .count(),
        1,
      );
    } finally {
      await h.close();
    }
  });

  void test('can narrow to a space and a range', async () => {
    const h = await open('/usage', ownerStub());
    try {
      await ready(h.page);
      const space = h.page.getByRole('combobox', { name: 'Space' });
      assert.deepEqual(await offered(space), ['All spaces', 'Laika', 'Onroute']);
      await h.page.keyboard.press('Escape');
      await pick(space, 'laika');
      await until(async () => (await stat(h.page, 'tokens')) === '12M');
      assert.equal(await stat(h.page, 'tokens'), '12M');
      // A space holds only task-tied tokens: never "0% unattributed · 100% tied"
      // (D-084 item 6). Beside it, what no space can hold — the organisation's
      // unattributed share — and the way to it.
      assert.equal(await h.page.locator('.usage-tiles [data-stat="unattributed"]').count(), 0);
      assert.equal(await stat(h.page, 'outside'), '95%');
      const note = await h.page.locator('.usage-space-note').innerText();
      assert.match(note, /cannot be placed in a space/i);
      assert.doesNotMatch(await h.page.locator('.usage-page').innerText(), /100% tied to a task/);
      await h.page.getByRole('button', { name: 'Show all spaces' }).click();
      await until(async () => (await stat(h.page, 'tokens')) === '255M');
      assert.equal(await stat(h.page, 'unattributed'), '95%');

      await pick(space, '');
      await h.page.getByRole('button', { name: '7 days' }).click();
      await until(async () => (await h.page.locator('.usage-trend .usage-bar').count()) === 7);
      assert.equal(await h.page.locator('.usage-trend .usage-bar').count(), 7);
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('sees a member’s Tokens card on their profile', async () => {
    const h = await open('/people?user=u2', {
      ...ownerStub(),
      '/api/v1/users/u2/profile': {
        user: {
          id: 'u2',
          name: 'Bea Builder',
          email: 'bea@example.test',
          org_role: 'member',
          is_active: true,
          profile_kind: 'manager',
          created_at: 1,
        },
        window: { weeks: 12, since: Date.now() - 84 * DAY_MS, until: Date.now() },
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
        activity_sharing: { org_enabled: true, enabled: true },
        queue: { projects_led: 0, waiting: 0, oldest_waiting_since: null, projects: [] },
      },
      '/api/v1/people/u2/activity': {
        range: '12w',
        start: dayOf(83),
        end: dayOf(0),
        tz: 'UTC',
        sharing: { org_enabled: true, enabled: true },
        series: {
          github: null,
          local_commits: null,
          prompts: null,
          sessions: null,
          board_self: Array.from({ length: 84 }, () => 0),
          board_agent: Array.from({ length: 84 }, () => 0),
        },
        prompts_by_agent: {},
        agents: [],
      },
      '/api/v1/users/u2/usage': personUsage('u2'),
    });
    try {
      const card = h.page.locator('.prof-card[data-section="tokens"]');
      // The first weeks are empty, so their bars have no height: wait on a figure.
      await card.locator('[data-stat="tokens"]').waitFor({ timeout: 20_000 });
      assert.equal(await card.locator('.usage-week').count(), 12);
      const text = await card.innerText();
      assert.match(text, /at least/i);
      assert.match(text, /Claude Code/);
      assert.match(text, /claude-opus-5-5/);
      assert.match(text, /tied to a task/i);
      assert.match(text, /Cursor.*no token data/s);
    } finally {
      await h.close();
    }
  });
});

void describe('a member', () => {
  void test('sees their spaces’ totals and never a per-person split', async () => {
    const h = await open('/usage', memberStub());
    try {
      await ready(h.page);
      const space = h.page.getByRole('combobox', { name: 'Space' });
      assert.deepEqual(await offered(space), ['Laika', 'Onroute']);
      await h.page.keyboard.press('Escape');
      assert.equal(
        await h.page.locator('.usage-card[data-section="developers"] .usage-row').count(),
        0,
      );
      assert.match(await h.page.locator('.usage-page').innerText(), /owners and admins/i);
      // Every read named a space: the organisation is never asked for.
      const reads = h.calls.filter((c) => c.path === '/api/v1/usage');
      assert.ok(reads.length > 0);
      assert.deepEqual(h.unmatched, []);
      // Their own tokens, on the same page.
      assert.equal(
        await h.page.locator('.usage-card[data-section="mine"] .usage-week').count(),
        12,
      );
      // No organisation-wide share for a member: the page says why instead.
      assert.match(await stat(h.page, 'outside'), /^—$/);
      assert.match(
        await h.page.locator('.usage-space-note').innerText(),
        /cannot be placed in a space/i,
      );
    } finally {
      await h.close();
    }
  });

  void test('a space nothing is tied to yet says so honestly, rather than showing zeros', async () => {
    const h = await open('/usage', memberStub());
    try {
      await ready(h.page);
      await pick(h.page.getByRole('combobox', { name: 'Space' }), 'onroute');
      const empty = h.page.locator('[data-state="space-empty"]');
      await empty.waitFor({ timeout: 20_000 });
      assert.match(await empty.innerText(), /No tokens are tied to Onroute’s tasks yet/);
      assert.match(await empty.innerText(), /mark the task they work on/);
      assert.equal(await h.page.locator('.usage-trend').count(), 0, 'an empty chart is drawn');
    } finally {
      await h.close();
    }
  });
});

const NOW_MS = Date.now();

/** A person's own alerts, as `GET /me/token-alerts` answers them (LAI-773). */
const ALERTS = [
  {
    id: 'a-run',
    kind: 'runaway',
    scope: 'task',
    threshold: 95,
    tokens: 7_000_000,
    limit_tokens: 5_994_000,
    created_at: NOW_MS - 600_000,
    project: { slug: 'laika', name: 'Laika' },
    task: { id: 't1', key: 'LAI-769', title: 'Token usage, phase 1' },
    sprint: null,
  },
  {
    id: 'a-80',
    kind: 'budget',
    scope: 'task',
    threshold: 80,
    tokens: 2_100_000,
    limit_tokens: 2_500_000,
    created_at: NOW_MS - 900_000,
    project: { slug: 'laika', name: 'Laika' },
    task: { id: 't2', key: 'LAI-770', title: 'Attribution' },
    sprint: null,
  },
];

const text = async (page: Page, selector: string): Promise<string> =>
  (await page.locator(selector).innerText()).trim();

void describe('LAI-773: cost, cache, budgets, alerts and the plan limit', () => {
  void test('an owner: cost labelled API-equivalent, cache, telemetry, accepted-task cost, budgets and runaway counts', async () => {
    const h = await open('/usage', ownerStub());
    try {
      await ready(h.page);
      assert.equal(await stat(h.page, 'cost'), '$3,060');
      assert.match(
        await text(h.page, '.usage-tiles [data-stat="cost"]'),
        /API-equivalent, not your bill/,
      );
      assert.equal(await stat(h.page, 'cache'), '98%');
      assert.match(await text(h.page, '.usage-tiles [data-stat="cache"]'), /saved \$41,520/);
      assert.match(
        await text(h.page, '[data-telemetry]'),
        /18\.4M of these tokens came from Claude Code’s own telemetry/,
      );
      assert.match(await text(h.page, '[data-telemetry]'), /nothing is counted twice/);
      // Each model priced; each person's, for an owner only.
      assert.match(await text(h.page, '.usage-card[data-section="models"]'), /\$0\.42/);
      assert.match(await text(h.page, '.usage-card[data-section="models"]'), /API-equivalent/);
      assert.match(await text(h.page, '.usage-card[data-section="developers"]'), /\$2,400/);

      const accepted = await text(h.page, '.usage-card[data-section="accepted"]');
      assert.match(accepted, /Laika\s+6\s+\$10\.40\s+\$62\.40/);
      assert.match(accepted, /Claude Code/);
      // An owner on a session: every agent its own row, nothing folded.
      assert.doesNotMatch(accepted, /fewer than 3 people/);
      assert.equal(await h.page.locator('[data-withheld]').count(), 0);
      assert.doesNotMatch(await text(h.page, '.usage-card[data-section="agents"]'), /fewer than/);

      assert.match(
        await text(h.page, '.usage-card[data-section="cache"]'),
        /Laika\s+99%\s+\$3,201/,
      );

      const budgets = h.page.locator('.usage-card[data-section="budgets"]');
      assert.equal(
        await budgets.locator('[data-scope="project"] .budget-badge').innerText(),
        '80%',
      );
      assert.equal(await budgets.locator('[data-scope="task"] .budget-badge').innerText(), '100%');
      assert.match(await budgets.innerText(), /12M of 10M · 120%/);
      assert.match(await budgets.innerText(), /Choose a space to set/);
      // All spaces: read-only.
      assert.equal(await budgets.locator('.budget-editor').count(), 0);

      const runaway = await text(h.page, '.usage-card[data-section="runaway"]');
      assert.match(runaway, /Laika\s+2 alerts/);
      assert.doesNotMatch(runaway, /LAI-769|Ada|Bea/);
    } finally {
      await h.close();
    }
  });

  void test('a member in a space: no runaway counts, no per-person cost, no budget to set', async () => {
    const h = await open('/usage', memberStub());
    try {
      await ready(h.page);
      assert.equal(await h.page.locator('.usage-card[data-section="runaway"]').count(), 0);
      assert.equal(await h.page.locator('[data-telemetry]').count(), 0);
      await h.page.locator('.usage-card[data-section="budgets"]').waitFor();
      await until(() => h.calls.some((c) => c.path === '/api/v1/projects/laika/budgets'));
      assert.equal(
        await h.page.locator('.usage-card[data-section="budgets"] .budget-editor').count(),
        0,
      );
      assert.doesNotMatch(await text(h.page, '.usage-card[data-section="developers"]'), /\$/);
    } finally {
      await h.close();
    }
  });

  void test('a member: what fewer than three people used is one row, Other (fewer than 3 people), and no price is never $0', async () => {
    const h = await open('/usage', memberStub());
    try {
      await ready(h.page);
      // Beside the `other` kind's own row, under its own name (review B2);
      // then the agents with no token data, as for everyone.
      assert.deepEqual(await rows(h.page, 'agents'), [
        'Claude Code',
        'another agent',
        'Other (fewer than 3 people)',
        'Cursor',
        'Windsurf',
      ]);
      assert.deepEqual(await rows(h.page, 'models'), [
        'claude-opus-5-5',
        'Other (fewer than 3 people)',
      ]);
      // A model with no price and only cache reads (review, ALSO FIX 7).
      const models = await text(h.page, '.usage-card[data-section="models"]');
      assert.match(models, /Other \(fewer than 3 people\)\s+0\s+no price/);
      const folded = h.page.locator('.usage-card[data-section="accepted"] tr[data-few-people]');
      assert.equal(await folded.count(), 1);
      assert.match(
        (await folded.innerText()).replace(/\s+/g, ' '),
        /^Other \(fewer than 3 people\) 2 no price no price$/,
      );
      assert.match(
        await text(h.page, '[data-withheld]'),
        /1 agent is in “Other”: fewer than three people used it on these tasks\./,
      );
      assert.doesNotMatch(
        await text(h.page, '.usage-card[data-section="accepted"]'),
        /\$0(?![.\d])/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a lead in a space sets the month’s budget and a sprint’s, and the page reads again', async () => {
    const writes: StubCall[] = [];
    const h = await open('/usage', {
      ...ownerStub(),
      '/api/v1/projects/laika/budgets': projectBudgets(true),
      '/api/v1/projects/laika/sprints': {
        data: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'Sprint 12',
            goal: null,
            starts_on: 1,
            ends_on: 2,
            status: 'active',
            created_at: 1,
            updated_at: 1,
          },
        ],
        next_cursor: null,
      },
      '/api/v1/projects/laika/budget': (call: StubCall) => {
        writes.push(call);
        return { budget: null };
      },
      '/api/v1/sprints/s1/budget': (call: StubCall) => {
        writes.push(call);
        return { budget: null };
      },
    });
    try {
      await ready(h.page);
      await pick(h.page.getByRole('combobox', { name: 'Space' }), 'laika');
      const card = h.page.locator('.usage-card[data-section="budgets"]');
      const month = card.locator('[data-group="month"]');
      await month.locator('.budget-editor input').waitFor({ timeout: 10_000 });
      await month.locator('.budget-editor input').fill('15M');
      const reads = h.calls.filter((c) => c.path === '/api/v1/usage').length;
      await month.getByRole('button', { name: 'Set' }).click();
      await until(() => writes.length === 1);
      assert.deepEqual(writes[0]?.body, { tokens: 15_000_000 });
      assert.equal(writes[0]?.method, 'PUT');
      await until(() => h.calls.filter((c) => c.path === '/api/v1/usage').length > reads);
      assert.ok(h.calls.filter((c) => c.path === '/api/v1/usage').length > reads, 'not read again');

      await pick(card.getByRole('combobox', { name: 'Sprint to budget' }), 's1');
      const add = card.locator('.usage-budget-add .budget-editor');
      await add.locator('input').fill('4,000,000');
      await add.getByRole('button', { name: 'Set' }).click();
      await until(() => writes.length === 2);
      assert.equal(writes[1]?.path, '/api/v1/sprints/s1/budget');
      assert.deepEqual(writes[1]?.body, { tokens: 4_000_000 });
    } finally {
      await h.close();
    }
  });

  void test('alerts for the person: a banner with a way to each, put away one at a time, and the rail’s count', async () => {
    let open_ = [...ALERTS];
    const dismissed: string[] = [];
    const h = await open('/usage', {
      ...ownerStub(),
      '/api/v1/me/token-alerts': () => ({ alerts: open_ }),
      '/api/v1/me/token-alerts/a-80/dismiss': (call: StubCall) => {
        dismissed.push(call.method);
        open_ = open_.filter((a) => a.id !== 'a-80');
        return reply(204, null);
      },
    });
    try {
      await ready(h.page);
      const banner = h.page.locator('[data-section="alerts"]');
      await banner.waitFor({ timeout: 10_000 });
      assert.match(await banner.innerText(), /For you · 2 alerts/);
      assert.match(
        await banner.innerText(),
        /LAI-769: your agent passed the task’s p95 of 5\.99M at 7M with nothing landed for an hour\./,
      );
      assert.match(
        await banner.innerText(),
        /LAI-770 reached 80% of its budget — 2\.1M of 2\.5M\./,
      );
      assert.match(await banner.innerText(), /never reported on you/);
      const badge = h.page.locator('a[href="/usage"] .sidebar-count');
      // The figure, then the visually hidden name the rail adds for a reader.
      const count = async (): Promise<string> => (await badge.innerText()).split('\n')[0] ?? '';
      await until(async () => (await badge.count()) > 0);
      assert.equal(await count(), '2');

      await banner
        .locator('.usage-alert', { hasText: 'LAI-770' })
        .getByRole('button', { name: 'Dismiss' })
        .click();
      await until(() => dismissed.length === 1);
      assert.deepEqual(dismissed, ['POST']);
      await until(async () => (await count()) === '1');
      assert.equal(await count(), '1');
      assert.equal(await banner.locator('.usage-alert').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('the plan limit: the person’s own, set here, and said as an estimate with a time', async () => {
    const puts: StubCall[] = [];
    const set = planLimit({
      plan: 'claude-max-5x',
      window: '5h',
      limit_tokens: 3_000_000,
      used: 1_200_000,
      rate_per_hour: 600_000,
      window_start: NOW_MS - 5 * 3_600_000,
      reaches_limit_at: NOW_MS + 3 * 3_600_000,
    });
    const h = await open('/usage', {
      ...ownerStub(),
      '/api/v1/me/plan-limit': (call: StubCall) => {
        if (call.method === 'PUT') {
          puts.push(call);
          return set;
        }
        return planLimit();
      },
    });
    try {
      const card = h.page.locator('[data-section="plan-limit"]');
      await card.locator('form').waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), /yours only · an estimate/);
      await pick(card.getByRole('combobox', { name: 'Plan' }), 'claude-max-5x');
      assert.match(await card.innerText(), /Five times Pro’s per-session usage/);
      await card.getByLabel('Your limit, in tokens').fill('3M');
      await card.getByRole('button', { name: 'Save' }).click();
      await until(() => puts.length === 1);
      assert.deepEqual(
        { ...(puts[0]?.body as Record<string, unknown>), tz: 'any' },
        { plan: 'claude-max-5x', window: '5h', limit_tokens: 3_000_000, tz: 'any' },
      );
      const forecast = card.locator('[data-forecast]');
      await forecast.waitFor();
      assert.match(
        await forecast.innerText(),
        /^At this rate you reach your limit around \d\d:\d\d\.$/,
      );
      assert.match(await card.innerText(), /Estimate\s+1\.2M of 3M used · 600K an hour/);
      // Never asked about anybody else: one path, the reader's own.
      assert.ok(
        h.calls
          .filter((c) => c.path.includes('plan-limit'))
          .every((c) => c.path === '/api/v1/me/plan-limit'),
      );
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, laptop and phone', () => {
  void test('1366 and 390 px in light and dark: nothing scrolls sideways, every card fits, bars drawn', async () => {
    const h = await open('/usage', ownerStub());
    try {
      await ready(h.page);
      for (const theme of ['Light', 'Dark']) {
        // The theme switch is in the sidebar, off-canvas on a phone: switch at
        // laptop width, then measure each width.
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1366, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(overflow <= 0, `${theme} at ${String(width)}: ${String(overflow)} px sideways`);
          const outside = await h.page
            .locator('.usage-card, .usage-stat')
            .evaluateAll(
              (els) =>
                els.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
                  .length,
            );
          assert.equal(outside, 0, `${theme} at ${String(width)}: a card runs off the page`);
          const colour = await h.page
            .locator('.usage-trend .usage-bar')
            .last()
            .evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.notEqual(colour, 'rgba(0, 0, 0, 0)', `${theme}: the bars have no colour`);
        }
      }
    } finally {
      await h.close();
    }
  });
});
