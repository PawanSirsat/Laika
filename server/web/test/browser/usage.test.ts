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
import { PROTOTYPE_SAMPLES } from '../helpers/prototype-samples.ts';
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
    // LAI-814: each space, most first; the 12M tied to a task is all in them.
    by_project: [
      {
        project: { slug: 'laika', name: 'Laika' },
        tokens: 9_000_000,
        cache_read: 600_000_000,
        cost: cost(108.5),
        share: 9_000_000 / 254_973_258,
      },
      {
        project: { slug: 'onroute', name: 'Onroute' },
        tokens: 3_000_000,
        cache_read: 200_000_000,
        cost: cost(36.2),
        share: 3_000_000 / 254_973_258,
      },
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
    // A space is one space: no per-space rows (LAI-814).
    by_project: null,
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
    await page.locator(`[data-section="${section}"] .usage-row .usage-row-name`).allInnerTexts()
  ).map((t) => t.trim());

void describe('an owner', () => {
  void test('sees the organisation: a floor without cache reads, cache reads apart, the unattributed share', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      assert.equal(await stat(h.page, 'tokens'), '255M');
      assert.equal(await stat(h.page, 'cache-reads'), '16.3B');
      assert.equal(await stat(h.page, 'unattributed'), '95%');
      assert.match(
        await h.page.locator('.usage-tiles [data-stat="tokens"]').innerText(),
        /at least/i,
      );
      // The floor is behind *How we count* (LAI-1127), named on the context line.
      assert.match(await h.page.locator('.usage-context').innerText(), /counts are minimums/);
      assert.equal(await h.page.locator('.usage-floor').count(), 0);
      const how = h.page.getByRole('button', { name: 'How we count' });
      assert.equal(await how.getAttribute('aria-expanded'), 'false');
      await how.click();
      assert.match(await h.page.locator('#usage-how.usage-floor').innerText(), /at least/i);
      assert.equal(
        await h.page.getByRole('button', { name: 'Hide details' }).getAttribute('aria-expanded'),
        'true',
      );
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
        '3 send-backs on 2 tasks · 1.23M tokens (12% of the space’s) · 6 h of rework, 1 still open',
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
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      assert.deepEqual(await rows(h.page, 'developers'), ['Ada Owner', 'Bea Builder']);
      const agents = await rows(h.page, 'agents');
      assert.deepEqual(agents.slice(0, 2), ['Claude Code', 'Codex']);
      // Agents with no token source say so, not zero.
      const noData = await h.page.locator('[data-section="agents"] [data-no-data]').allInnerTexts();
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
        await h.page.locator('[data-section="developers"] a[href="/people?user=u2"]').count(),
        1,
      );
    } finally {
      await h.close();
    }
  });

  void test('Breakdown is one card with tabs — Space, Developer, Agent, Model — arrow keys move between them (LAI-1127)', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      const card = h.page.locator('.usage-card[data-section="breakdown"]');
      const list = card.getByRole('tablist', { name: 'Break down by' });
      const tabs = (await list.getByRole('tab').allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(tabs, ['Space', 'Developer', 'Agent', 'Model']);
      // By space first, and the only panel drawn.
      const space = card.getByRole('tab', { name: 'Space' });
      assert.equal(await space.getAttribute('aria-selected'), 'true');
      assert.equal(await card.locator('[role="tabpanel"]:visible').count(), 1);
      assert.ok(await card.locator('[data-section="spaces"]').isVisible());
      // One tab stop: only the chosen tab is in the order.
      assert.deepEqual(
        await list.getByRole('tab').evaluateAll((els) => els.map((el) => el.tabIndex)),
        [0, -1, -1, -1],
      );

      await space.focus();
      await h.page.keyboard.press('ArrowRight');
      const developer = card.getByRole('tab', { name: 'Developer' });
      assert.equal(await developer.getAttribute('aria-selected'), 'true');
      assert.ok(await developer.evaluate((el) => el === document.activeElement));
      assert.ok(await card.locator('[data-section="developers"]').isVisible());
      assert.ok(!(await card.locator('[data-section="spaces"]').isVisible()));
      assert.match(await text(h.page, '[data-section="developers"]'), /By name/);

      await h.page.keyboard.press('End');
      assert.equal(
        await card.getByRole('tab', { name: 'Model' }).getAttribute('aria-selected'),
        'true',
      );
      await h.page.keyboard.press('ArrowRight');
      assert.equal(
        await space.getAttribute('aria-selected'),
        'true',
        'the last wraps to the first',
      );
      await card.getByRole('tab', { name: 'Agent' }).click();
      assert.ok(await card.locator('[data-section="agents"]').isVisible());
      // The panel is named by its tab.
      assert.equal(
        await card.locator('[data-section="agents"]').getAttribute('aria-labelledby'),
        await card.getByRole('tab', { name: 'Agent' }).getAttribute('id'),
      );
    } finally {
      await h.close();
    }
  });

  void test('the design’s order, and none of its sample data on the page (LAI-1127)', async () => {
    const h = await open('/insights?tab=usage', {
      ...ownerStub(),
      '/api/v1/me/token-alerts': () => ({ alerts: ALERTS }),
    });
    try {
      await ready(h.page);
      await h.page.locator('.usage-alert').first().waitFor({ timeout: 10_000 });
      // KPI strip, then the day chart, alerts beside top tasks, the breakdown
      // beside cache, accepted cost, budgets — then only the reader's own.
      const order = await h.page
        .locator(
          '.usage > *, .usage .usage-pair > *, .usage .usage-you > *, .usage .usage-you .usage-pair > *',
        )
        .evaluateAll((els: Element[]): string[] =>
          els
            .map((el) => el.getAttribute('data-section') ?? el.classList.item(0) ?? '')
            .filter((name) => name !== 'usage-pair' && name !== ''),
        );
      assert.deepEqual(order, [
        'usage-context',
        'usage-tiles',
        'usage-telemetry',
        'trend',
        'alerts',
        'tasks',
        'breakdown',
        'cache',
        'accepted',
        'budgets',
        'usage-you',
        'usage-you-divider',
        'mine',
        'plan-limit',
      ]);
      assert.deepEqual(await h.page.locator('.usage-tiles .usage-stat-label').allInnerTexts(), [
        'Tokens',
        'Cache reads',
        'Unattributed',
        'Per day',
        'Cost',
        'From cache',
      ]);
      assert.match(await text(h.page, '.usage-you-divider'), /you · visible only to you/i);
      // Rework and runaway counts sit beside accepted cost, as designed.
      const accepted = h.page.locator('.usage-card[data-section="accepted"]');
      assert.equal(await accepted.locator('.usage-side [data-section="rework"]').count(), 1);
      assert.equal(await accepted.locator('.usage-side [data-section="runaway"]').count(), 1);

      // Every panel and the folded text included: nothing from the prototype.
      const all = (await h.page.locator('.usage-page').textContent()) ?? '';
      assert.ok(all.includes('Breakdown'), 'the page was not read');
      assert.deepEqual(
        PROTOTYPE_SAMPLES.filter((n) => all.includes(n)),
        [],
      );
    } finally {
      await h.close();
    }
  });

  void test('can narrow to a space and a range', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
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

  void test('By space: each space’s tokens, share and cost, most first, then what no space holds; a space opens its own view (LAI-814)', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      const card = h.page.locator('[data-section="spaces"]');
      assert.deepEqual(await rows(h.page, 'spaces'), ['Laika', 'Onroute', 'Outside any space']);
      const values = (await card.locator('.usage-row-value').allInnerTexts()).map((v) =>
        v.replace(/\s+/g, ' ').trim(),
      );
      assert.deepEqual(values, ['9M 4% · $108.50', '3M 1% · $36.20', '243M 95% · tied to no task']);
      // The rows add up to the Tokens tile, exactly: each row's title is its count.
      const exact = await card
        .locator('.usage-row-value')
        .evaluateAll((els) =>
          els.map((el) =>
            Number((el.getAttribute('title') ?? '').split(' tokens')[0]?.replace(/,/g, '')),
          ),
        );
      assert.deepEqual(exact, [9_000_000, 3_000_000, 242_973_258]);
      assert.equal(
        exact.reduce((n, x) => n + x, 0),
        254_973_258,
      );
      // What no space holds is not a space: no link.
      assert.equal(await card.locator('a').count(), 2);

      const laika = card.getByRole('link', { name: 'Laika' });
      assert.equal(await laika.getAttribute('href'), '/insights?tab=usage&project=laika');
      await laika.click();
      await until(async () => (await stat(h.page, 'tokens')) === '12M');
      assert.equal(await stat(h.page, 'tokens'), '12M');
      assert.equal(new URL(h.page.url()).searchParams.get('project'), 'laika');
      // A space view has no By space.
      assert.equal(await card.count(), 0);
      // Back returns to the organisation.
      await h.page.goBack();
      await until(async () => (await stat(h.page, 'tokens')) === '255M');
      assert.equal(new URL(h.page.url()).searchParams.get('project'), null);
      await card.waitFor();
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('an archived space is counted but not a link — its ?project= would open All spaces — and says archived (LAI-814 review)', async () => {
    const usage = orgUsage(30);
    const archived = {
      project: { slug: 'oldsite', name: 'Old site' },
      tokens: 2_000_000,
      cache_read: 100_000_000,
      cost: cost(20),
      share: 2_000_000 / 254_973_258,
    };
    const h = await open('/insights?tab=usage', {
      ...ownerStub(),
      // `GET /projects` sends an archived space as a tombstone (§6.3).
      '/api/v1/projects': {
        data: [LAIKA, ONROUTE, { id: 'p9', deleted: true }],
        next_cursor: null,
      },
      '/api/v1/usage?days=30': { ...usage, by_project: [...usage.by_project, archived] },
    });
    try {
      await ready(h.page);
      const card = h.page.locator('[data-section="spaces"]');
      await card.locator('.usage-row').first().waitFor();
      // Wait for the count it asserts, not the first row (LAI-715).
      await until(async () => (await card.locator('.usage-row').count()) === 4);
      // Still a row, so the rows add up…
      assert.equal(await card.locator('.usage-row').count(), 4);
      const row = card.locator('.usage-row', { hasText: 'Old site' });
      assert.equal(await row.count(), 1);
      assert.match(
        (await row.locator('.usage-row-value').innerText()).replace(/\s+/g, ' '),
        /^2M <1% · \$20\.00$/,
      );
      // …but no way into a view the selector does not offer.
      assert.equal(await row.locator('a').count(), 0);
      assert.equal((await row.locator('.usage-space-archived').innerText()).trim(), 'archived');
      assert.deepEqual(
        (await card.locator('a').allInnerTexts()).map((t) => t.trim()),
        ['Laika', 'Onroute'],
      );
      // The spaces the selector does offer keep their links and no marker.
      assert.equal(await card.locator('.usage-space-archived').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('?project= is the space shown: a link to a space’s usage opens it, and All spaces leaves it (LAI-814)', async () => {
    const h = await open('/insights?tab=usage&project=laika', ownerStub());
    try {
      await ready(h.page);
      assert.equal(await stat(h.page, 'tokens'), '12M');
      assert.equal(await h.page.locator('[data-section="spaces"]').count(), 0);
      await pick(h.page.getByRole('combobox', { name: 'Space' }), '');
      await until(async () => (await stat(h.page, 'tokens')) === '255M');
      assert.equal(await stat(h.page, 'tokens'), '255M');
      assert.equal(new URL(h.page.url()).searchParams.get('project'), null);
      assert.equal(new URL(h.page.url()).searchParams.get('tab'), 'usage');
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
      await until(async () => (await card.locator('.usage-week').count()) === 12);
      assert.equal(await card.locator('.usage-week').count(), 12);
      const text = await card.innerText();
      assert.match(text, /at least/i);
      assert.match(text, /Claude Code/);
      // LLM tokens, so the word is not read as a credential (LAI-1058).
      assert.match(text, /LLM tokens/i);
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
    const h = await open('/insights?tab=usage', memberStub());
    try {
      await ready(h.page);
      const space = h.page.getByRole('combobox', { name: 'Space' });
      assert.deepEqual(await offered(space), ['Laika', 'Onroute']);
      await h.page.keyboard.press('Escape');
      assert.equal(await h.page.locator('[data-section="developers"] .usage-row').count(), 0);
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
    const h = await open('/insights?tab=usage', memberStub());
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

/*
 * The plan limit's forecast names a clock time, and the weekday as well once
 * that time is not today (`clockLabel`, `api/plan-limit.ts`). On the real clock
 * the test passed or failed by the hour it ran: GitHub's run at 23:45 UTC got
 * `around Tue 02:49` (now `Tue 2:49 AM`, LAI-830) where it expected a bare time (LAI-794). So these tests
 * pin the browser's clock and zone, as `timeline-sprints.test.ts` does: Monday
 * 19 October 2026, at midday and at a quarter to midnight, in UTC.
 */
const MIDDAY = Date.UTC(2026, 9, 19, 12, 0);
const LATE = Date.UTC(2026, 9, 19, 23, 45);

async function pinClock(page: Page, at: number): Promise<void> {
  await page.clock.setFixedTime(at);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
}

/** What the page's own clock reads, so a pin that did not take fails here. */
const browserClock = (page: Page): Promise<{ now: number; zone: string }> =>
  page.evaluate(() => ({
    now: Date.now(),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));

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
    const h = await open('/insights?tab=usage', ownerStub());
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
      assert.match(await text(h.page, '[data-section="models"]'), /\$0\.42/);
      assert.match(await text(h.page, '[data-section="models"]'), /API-equivalent/);
      assert.match(await text(h.page, '[data-section="developers"]'), /\$2,400/);

      const accepted = await text(h.page, '.usage-card[data-section="accepted"]');
      assert.match(accepted, /Laika\s+6\s+\$10\.40\s+\$62\.40/);
      assert.match(accepted, /Claude Code/);
      // An owner on a session: every agent its own row, nothing folded.
      assert.doesNotMatch(accepted, /fewer than 3 people/);
      assert.equal(await h.page.locator('[data-withheld]').count(), 0);
      assert.doesNotMatch(await text(h.page, '[data-section="agents"]'), /fewer than/);

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

      const runaway = await text(h.page, '[data-section="runaway"]');
      assert.match(runaway, /Laika\s+2 alerts/);
      assert.doesNotMatch(runaway, /LAI-769|Ada|Bea/);
    } finally {
      await h.close();
    }
  });

  void test('a member in a space: no runaway counts, no per-person cost, no budget to set', async () => {
    const h = await open('/insights?tab=usage', memberStub());
    try {
      await ready(h.page);
      assert.equal(await h.page.locator('[data-section="runaway"]').count(), 0);
      assert.equal(await h.page.locator('[data-telemetry]').count(), 0);
      await h.page.locator('.usage-card[data-section="budgets"]').waitFor();
      await until(() => h.calls.some((c) => c.path === '/api/v1/projects/laika/budgets'));
      assert.equal(
        await h.page.locator('.usage-card[data-section="budgets"] .budget-editor').count(),
        0,
      );
      assert.doesNotMatch(await text(h.page, '[data-section="developers"]'), /\$/);
    } finally {
      await h.close();
    }
  });

  void test('a member: what fewer than three people used is one row, Other (fewer than 3 people), and no price is never $0', async () => {
    const h = await open('/insights?tab=usage', memberStub());
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
      // A model with no price and only cache reads (review, ALSO FIX 7) — on
      // the Model tab, drawn, so its words are laid out (LAI-1127).
      await h.page.getByRole('tab', { name: 'Model' }).click();
      const models = await text(h.page, '[data-section="models"]');
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
    const h = await open('/insights?tab=usage', {
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

  void test('Budget alerts: the person’s own, most spent first, a way to each, put away one at a time, and the rail’s count', async () => {
    let open_ = [...ALERTS];
    const dismissed: string[] = [];
    const h = await open('/insights?tab=usage', {
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
      const card = h.page.locator('.usage-card[data-section="alerts"]');
      await card.locator('.usage-alert').first().waitFor({ timeout: 10_000 });
      assert.match(await card.innerText(), /Budget alerts/);
      // Two alerts; the 80% one has not reached its budget, so none is over.
      assert.equal(await text(h.page, '[data-alert-summary]'), '2 alerts · 0 over budget');
      // Most spent against its limit first: the runaway (117% of its p95), then 84%.
      const marks = (await card.locator('.usage-alert-mark').allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(marks, ['p95', '84%']);
      const lines = (await card.locator('.usage-alert-line').allInnerTexts()).map((t) =>
        t.replace(/\s+/g, ' ').trim(),
      );
      assert.deepEqual(lines, [
        'LAI-769 Token usage, phase 1 · runaway agent',
        'LAI-770 Attribution',
      ]);
      assert.match(await card.locator('.usage-alert').nth(1).innerText(), /2\.1M \/ 2\.5M/);
      // The whole sentence is still the row's title, for a pointer.
      assert.equal(
        await card.locator('.usage-alert').nth(1).getAttribute('title'),
        'LAI-770 reached 80% of its budget — 2.1M of 2.5M.',
      );
      assert.equal(
        await card.locator('.usage-alert-line').nth(1).getAttribute('href'),
        '/board?project=laika&task=t2',
      );
      assert.match(await text(h.page, '.usage-alerts-foot'), /Soft alerts · nothing is blocked/);
      // Two alerts fit: nothing is folded away.
      assert.equal(await card.getByRole('button', { name: /^Show all/ }).count(), 0);
      // Usage is Insights' tab since LAI-796; the badge rides on Insights, and
      // while it shows the link opens Usage, where the alerts are (LAI-1191).
      const badge = h.page.locator('a[href="/insights?tab=usage"] .sidebar-count');
      // The figure, then the visually hidden name the rail adds for a reader.
      const count = async (): Promise<string> => (await badge.innerText()).split('\n')[0] ?? '';
      await until(async () => (await badge.count()) > 0);
      assert.equal(await count(), '2');

      await card
        .locator('.usage-alert', { hasText: 'LAI-770' })
        .getByRole('button', { name: 'Dismiss LAI-770' })
        .click();
      await until(() => dismissed.length === 1);
      assert.deepEqual(dismissed, ['POST']);
      await until(async () => (await count()) === '1');
      assert.equal(await count(), '1');
      assert.equal(await card.locator('.usage-alert').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('Budget alerts: over budget is said in words, eight fold to six with Show all 8, and Dismiss all puts each away', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `b-${String(i)}`,
      kind: 'budget',
      scope: 'task',
      threshold: i < 3 ? 100 : 80,
      tokens: (i < 3 ? 3_000_000 : 2_100_000) - i * 10_000,
      limit_tokens: 2_500_000,
      created_at: NOW_MS - 600_000,
      project: { slug: 'laika', name: 'Laika' },
      task: { id: `t${String(i)}`, key: `LAI-90${String(i)}`, title: `Task ${String(i)}` },
      sprint: null,
    }));
    let open_ = [...many];
    const dismissed: string[] = [];
    const routes: Record<string, ApiStub[string]> = {
      ...ownerStub(),
      '/api/v1/me/token-alerts': () => ({ alerts: open_ }),
    };
    for (const a of many) {
      routes[`/api/v1/me/token-alerts/${a.id}/dismiss`] = () => {
        dismissed.push(a.id);
        open_ = open_.filter((o) => o.id !== a.id);
        return reply(204, null);
      };
    }
    const h = await open('/insights?tab=usage', routes);
    try {
      await ready(h.page);
      const card = h.page.locator('.usage-card[data-section="alerts"]');
      await card.locator('.usage-alert').first().waitFor({ timeout: 10_000 });
      assert.equal(await text(h.page, '[data-alert-summary]'), '8 alerts · 3 over budget');
      assert.equal(await card.locator('.usage-alert').count(), 6);
      // Over budget is in the words, not only the red.
      assert.match(
        (await card.locator('.usage-alert[data-over="true"]').first().textContent()) ?? '',
        /over budget/,
      );
      const more = card.getByRole('button', { name: 'Show all 8' });
      assert.equal(await more.getAttribute('aria-expanded'), 'false');
      await more.click();
      assert.equal(await card.locator('.usage-alert').count(), 8);
      await card.getByRole('button', { name: 'Show fewer' }).click();
      assert.equal(await card.locator('.usage-alert').count(), 6);

      await card.getByRole('button', { name: 'Dismiss all' }).click();
      await until(() => dismissed.length === 8);
      assert.deepEqual([...dismissed].sort(), many.map((a) => a.id).sort());
      await until(async () => (await card.locator('.usage-alert').count()) === 0);
      assert.match(await card.innerText(), /No budget alerts for you/);
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
      window_start: MIDDAY - 5 * 3_600_000,
      reaches_limit_at: MIDDAY + 3 * 3_600_000,
    });
    const h = await open(
      '/insights?tab=usage',
      {
        ...ownerStub(),
        '/api/v1/me/plan-limit': (call: StubCall) => {
          if (call.method === 'PUT') {
            puts.push(call);
            return set;
          }
          return planLimit();
        },
      },
      { before: (page) => pinClock(page, MIDDAY) },
    );
    try {
      assert.deepEqual(await browserClock(h.page), { now: MIDDAY, zone: 'UTC' });
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
      // Later the same day: the time alone.
      assert.equal(await forecast.innerText(), 'At this rate you reach your limit around 3:00 PM.');
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

  /*
   * LAI-830 review round 1: the reset field said `such as 9:00 AM` and read a
   * bare `2:30` on the 24-hour clock, so a person meaning the afternoon saved
   * a weekly reset twelve hours off, with nothing on screen to say so.
   */
  void test('the weekly reset time: a bare 2:30 is refused, and the field says what it read', async () => {
    const puts: StubCall[] = [];
    const h = await open('/insights?tab=usage', {
      ...ownerStub(),
      '/api/v1/me/plan-limit': (call: StubCall) => {
        if (call.method === 'PUT') puts.push(call);
        return planLimit();
      },
    });
    try {
      const card = h.page.locator('[data-section="plan-limit"]');
      await card.locator('form').waitFor({ timeout: 20_000 });
      await pick(card.getByRole('combobox', { name: 'Counted over' }), 'week');
      await card.getByLabel('Your limit, in tokens').fill('3M');
      const at = card.getByLabel('Reset time, such as 9:00 AM');
      const read = card.locator('[data-understood]');

      await at.fill('2:30');
      assert.equal(await read.innerText(), 'Add AM or PM: 2:30 AM or 2:30 PM?');
      await card.getByRole('button', { name: 'Save' }).click();
      assert.equal(
        await card.locator('.usage-form-error').innerText(),
        'Add AM or PM, e.g. 2:30 PM.',
      );
      assert.equal(puts.length, 0, 'a bare 2:30 was saved');

      await at.fill('2:30 PM');
      assert.equal(await read.innerText(), 'Reads as 2:30 PM');
      await card.getByRole('button', { name: 'Save' }).click();
      await until(() => puts.length === 1);
      const body = puts[0]?.body as { week_reset?: { minute: number } };
      assert.equal(body.week_reset?.minute, 870);
    } finally {
      await h.close();
    }
  });

  void test('the plan limit past midnight: the forecast names the day as well as the time', async () => {
    // GitHub's run: 23:45 on Monday, 1.84M left at 600K an hour, 3 h 4 min away.
    const h = await open(
      '/insights?tab=usage',
      {
        ...ownerStub(),
        '/api/v1/me/plan-limit': planLimit({
          plan: 'claude-max-5x',
          window: '5h',
          limit_tokens: 3_000_000,
          used: 1_160_000,
          rate_per_hour: 600_000,
          window_start: LATE - 2 * 3_600_000,
          reaches_limit_at: LATE + (3 * 60 + 4) * 60_000,
        }),
      },
      { before: (page) => pinClock(page, LATE) },
    );
    try {
      assert.deepEqual(await browserClock(h.page), { now: LATE, zone: 'UTC' });
      const forecast = h.page.locator('[data-section="plan-limit"] [data-forecast]');
      await forecast.waitFor({ timeout: 20_000 });
      assert.equal(
        await forecast.innerText(),
        'At this rate you reach your limit around Tue 2:49 AM.',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, laptop and phone', () => {
  void test('1440, 1366 and 390 px in light and dark: nothing scrolls sideways, every card fits, bars drawn', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      for (const theme of ['Light', 'Dark']) {
        // The theme switch is in the sidebar, off-canvas on a phone: switch at
        // laptop width, then measure each width.
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        for (const [width, height] of [
          [1440, 900],
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
          // By space (LAI-814): drawn at every width, its bars in colour.
          const spaceBar = h.page.locator('[data-section="spaces"] .usage-row-bar').first();
          assert.ok(
            (await spaceBar.evaluate((el) => el.getBoundingClientRect().width)) > 0,
            `${theme} at ${String(width)}: By space draws no bar`,
          );
          assert.notEqual(
            await spaceBar.evaluate((el) => getComputedStyle(el).backgroundColor),
            'rgba(0, 0, 0, 0)',
            `${theme}: By space's bars have no colour`,
          );
        }
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the period, the figures and the chart (LAI-1201)', () => {
  const bars = (page: Page) => page.locator('.usage-trend .usage-bar').count();
  const range = (page: Page) => new URL(page.url()).searchParams.get('range');

  void test('?range= is the period: 7 days survives a reload, a By space link keeps it, 30 days is the clean address', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      assert.equal(range(h.page), null);
      await h.page.getByRole('button', { name: '7 days' }).click();
      await until(async () => (await bars(h.page)) === 7 && range(h.page) === '7');
      assert.equal(range(h.page), '7');

      await h.page.reload();
      await ready(h.page);
      await until(async () => (await bars(h.page)) === 7);
      assert.equal(await bars(h.page), 7, 'the reload forgot the period');
      assert.equal(
        await h.page.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed'),
        'true',
      );
      // Opening a space keeps the period read.
      const laika = h.page.locator('[data-section="spaces"] a', { hasText: 'Laika' });
      assert.equal(await laika.getAttribute('href'), '/insights?tab=usage&project=laika&range=7');

      await h.page.getByRole('button', { name: '30 days' }).click();
      await until(async () => (await bars(h.page)) === 30);
      assert.equal(range(h.page), null, '30 days should leave no ?range=');
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('every headline figure opens the card that breaks it down — by click and by keyboard', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      const expected: Record<string, string> = {
        tokens: 'trend',
        'cache-reads': 'cache',
        unattributed: 'tasks',
        'per-day': 'trend',
        cost: 'breakdown',
        cache: 'cache',
      };
      const focused = () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-section') ?? null);
      for (const [figure, section] of Object.entries(expected)) {
        const a = h.page.locator(`.usage-tiles [data-stat="${figure}"] a.usage-figure`);
        assert.equal(await a.count(), 1, `${figure}: not a link`);
        assert.equal(await a.getAttribute('href'), `#usage-${section}`);
        assert.match((await a.getAttribute('aria-label')) ?? '', /, see /);
        await a.click();
        await until(async () => (await focused()) === section);
        assert.equal(await focused(), section, `${figure} did not open ${section}`);
      }
      // The keyboard reaches the same place.
      const cost = h.page.locator('.usage-tiles [data-stat="cost"] a.usage-figure');
      await cost.focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await focused()) === 'breakdown');
      assert.equal(await focused(), 'breakdown');
      // The figure still reads as the figure.
      assert.equal(await stat(h.page, 'tokens'), '255M');
    } finally {
      await h.close();
    }
  });

  void test('the trend is one tab stop that arrow keys walk, and every day is a row in its table', async () => {
    const h = await open('/insights?tab=usage', ownerStub());
    try {
      await ready(h.page);
      const chart = h.page.locator('.usage-trend');
      assert.equal(await chart.getAttribute('tabindex'), '0');
      assert.equal(await chart.getAttribute('role'), 'group');
      await chart.focus();
      await h.page.keyboard.press('Home');
      const tip = h.page.locator('.usage-trend .usage-tip');
      await until(async () => (await tip.innerText()).includes('tokens'));
      const first = await tip.innerText();
      await h.page.keyboard.press('ArrowRight');
      await until(async () => (await tip.innerText()) !== first);
      assert.notEqual(await tip.innerText(), first, 'ArrowRight did not move');

      const table = h.page.locator('.usage-trend-table');
      await table.locator('summary').click();
      const rowsShown = table.locator('tbody tr');
      await until(async () => (await rowsShown.count()) === 30);
      assert.equal(await rowsShown.count(), 30);
      assert.match(await rowsShown.first().innerText(), /\d/);
    } finally {
      await h.close();
    }
  });
});
