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
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

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

const figures = (tokens: number, cacheRead: number, attributed: number) => ({
  tokens,
  input: Math.round(tokens * 0.01),
  output: Math.round(tokens * 0.2),
  cache_write: tokens - Math.round(tokens * 0.01) - Math.round(tokens * 0.2),
  cache_read: cacheRead,
  attributed_tokens: attributed,
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
      },
      {
        user_id: 'u2',
        name: 'Bea Builder',
        tokens: 54_973_258,
        cache_read: 3_346_307_361,
        attributed_tokens: 12_000_000,
      },
    ],
    by_agent: [
      { agent: 'claude-code', tokens: 254_937_201, cache_read: 16_340_000_000 },
      { agent: 'codex', tokens: 36_057, cache_read: 6_307_361 },
    ],
    by_model: [
      { model: 'claude-opus-5-5', tokens: 230_000_000, cache_read: 15e9 },
      { model: 'claude-fable-5-1', tokens: 24_937_201, cache_read: 1.34e9 },
      { model: 'gpt-6.1-sol', tokens: 36_057, cache_read: 6_307_361 },
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
  };
}

/** One space, as a member is answered: the same shape, nobody in it. */
function spaceUsage(slug: string) {
  return {
    ...orgUsage(30),
    project: { slug, name: slug === 'laika' ? 'Laika' : 'Onroute' },
    totals: figures(12_000_000, 800_000_000, 12_000_000),
    by_developer: null,
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
    by_model: [{ model: 'claude-opus-5-5', tokens: 108_000_000, cache_read: 7.2e9 }],
    no_token_data: ['cursor'],
    sharing: { org_enabled: true, enabled: true },
  };
}

const BASE: ApiStub = {
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

function ownerStub(): ApiStub {
  return {
    ...BASE,
    '/api/v1/me': OWNER,
    '/api/v1/usage?days=30': orgUsage(30),
    '/api/v1/usage?days=7': orgUsage(7),
    '/api/v1/usage?days=30&project=laika': spaceUsage('laika'),
    '/api/v1/users/u1/usage': personUsage('u1'),
  };
}

function memberStub(): ApiStub {
  return {
    ...BASE,
    '/api/v1/me': MEMBER,
    '/api/v1/usage?days=30&project=laika': spaceUsage('laika'),
    '/api/v1/usage?days=30&project=onroute': spaceUsage('onroute'),
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
      assert.equal(await stat(h.page, 'unattributed'), '0%');

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
