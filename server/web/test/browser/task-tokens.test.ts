/**
 * The task panel's Tokens section on screen (D-084, LAI-770): what each
 * reader is shown — an owner everyone's part, a person their own, a member
 * who did none of the work the total and what it counts — nothing for a task
 * never started, and never one task's figures under another's key.
 *
 * The server decides whose part a reader sees (`people`); these stubs answer
 * as it would for each reader, and the tests read what the section draws.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Route } from 'playwright';
import {
  asServed,
  closeBrowser,
  open,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.now();

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
    project_id: 'laika-core',
    title: 'A task',
    description_md: '',
    acceptance_md: '',
    status: 'todo',
    priority: 'p2',
    position: null,
    assignee_id: null,
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
    send_back: null,
    started_at: null,
    completed_at: null,
    created_at: NOW - 5 * HOUR,
    updated_at: NOW - HOUR,
    size: null,
    ...over,
  });

const size = {
  level: 'M',
  computed: 'M',
  overridden: false,
  weight: 1,
  build_p50_ms: 25 * MIN,
  build_p80_ms: 50 * MIN,
  subtasks: 0,
};

const STARTED = task({
  id: 't3',
  key: 'LC-3',
  number: 3,
  title: 'Tie agent tokens to tasks',
  status: 'in_progress',
  assignee_id: 'u2',
  started_at: NOW - 3 * HOUR,
  size,
});
const OTHER = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Rename the column',
  status: 'in_progress',
  assignee_id: 'u2',
  started_at: NOW - 2 * HOUR,
});
const NEVER = task({ id: 't4', key: 'LC-4', number: 4, title: 'Not started' });

const ESTIMATE = {
  task_id: 't3',
  size,
  why: {
    early: false,
    method: 'text_similar',
    typical: { words: 220, build_ms: 35 * MIN },
    factors: [],
    similar: [
      {
        task_id: 't1',
        key: 'LC-1',
        title: 'Rename the column',
        build_ms: 40 * MIN,
        similarity: 0.6,
      },
    ],
    model_version: 'abc123',
    computed_at: NOW - HOUR,
  },
  override: null,
  at_start: null,
  actual: { build_ms: null, review_wait_ms: 0, rework_ms: 0, finishes: 0, first_finish_at: null },
  // LAI-772: the forecast the Tokens section draws beside the actual.
  tokens: { p50: 1_200_000, p80: 2_500_000, learned_from: 14, forecasts_after: 10 },
  actual_tokens: { build: 3_210_000, total: 4_010_000, rework: 800_000 },
  claim_estimate: null,
  scope_grew: null,
  split: null,
  history: [],
};

/** A cost as the server prices one (LAI-773). */
const cost = (usd: number, unpriced = 0, models: string[] = []) => ({
  usd,
  unpriced_tokens: unpriced,
  unpriced_models: models,
  unconfirmed_models: [],
});

const totals = (tokens: number, cacheRead: number) => ({
  tokens,
  input: Math.round(tokens * 0.1),
  output: Math.round(tokens * 0.2),
  cache_write: tokens - Math.round(tokens * 0.1) - Math.round(tokens * 0.2),
  cache_read: cacheRead,
  cost: cost(Math.round(tokens * 1.1e-5 * 100) / 100),
});

const ROUNDS = [
  { number: 1, finished_on: '2026-10-13', tokens: 2_567_400, cache_read: 51_500_000 },
  { number: 2, finished_on: '2026-10-15', tokens: 809_700, cache_read: 16_900_000 },
  { number: 3, finished_on: null, tokens: 629_600, cache_read: 12_600_000 },
];
const BEA = {
  user_id: 'u2',
  name: 'Bea Lindqvist',
  tokens: 3_523_700,
  cache_read: 70_000_000,
  cost: cost(38.76),
  by_agent: [
    { agent: 'claude-code', tokens: 3_421_700, cache_read: 68_000_000 },
    { agent: 'codex', tokens: 102_000, cache_read: 2_000_000 },
  ],
};
const CAL = {
  user_id: 'u3',
  name: 'Cal Moreno',
  tokens: 483_000,
  cache_read: 11_000_000,
  cost: cost(5.31),
  by_agent: [
    { agent: 'codex', tokens: 302_000, cache_read: 6_000_000 },
    { agent: 'gemini-cli', tokens: 181_000, cache_read: 5_000_000 },
  ],
};

const usage = (over: Record<string, unknown>) => ({
  task_id: 't3',
  key: 'LC-3',
  tz: 'UTC',
  first_day: '2026-10-12',
  last_day: '2026-10-17',
  totals: totals(4_006_700, 81_000_000),
  people: 'everyone',
  by_person: [BEA, CAL],
  by_round: ROUNDS,
  attributed: { tokens: 4_171_800, of: 5_149_800 },
  budget: null,
  runaway: null,
  ...over,
});

const EMPTY = (taskId: string, key: string) =>
  usage({
    task_id: taskId,
    key,
    first_day: null,
    last_day: null,
    totals: totals(0, 0),
    by_person: [],
    by_round: [],
    attributed: null,
  });

function stub(role: 'owner' | 'member', t3Usage: unknown): ApiStub {
  const all = [STARTED, OTHER, NEVER];
  const id = role === 'owner' ? 'u1' : 'u2';
  return {
    '/api/v1/me': {
      id,
      email: `${id}@example.com`,
      name: role === 'owner' ? 'Ada Lovelace' : 'Bea Lindqvist',
      org_role: role,
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: role === 'owner' ? 'lead' : 'member' }],
    },
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
    '/api/v1/projects/laika-core/tasks?limit=200': { data: all, next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t3&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t1&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t4&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead' },
        { user_id: 'u2', name: 'Bea Lindqvist', email: 'u2@example.com', role: 'member' },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    // LAI-773: whether this reader may set a budget — a lead, on a session.
    '/api/v1/projects/laika-core/budgets': {
      project_budget: null,
      sprints: [],
      tasks: [],
      can_set: role === 'owner',
    },
    '/api/v1/projects/laika-core/estimates/accuracy': {
      project_id: 'laika-core',
      finished: 42,
      forecasts_after: 10,
      live: { n: 12, typical_error: 1.7, bias: 1.1, p80_hit_rate: 0.75 },
      backtest: null,
      by_client: [],
      tokens: {
        learned_from: 14,
        forecasts_after: 10,
        live: { n: 0, typical_error: null, bias: null, p80_hit_rate: null },
        backtest: null,
      },
      agent: {
        size: { n: 0, agent_error: null, median_error: null, model_error: null, weight: 0 },
        confidence: [],
      },
      model_version: 'abc123',
    },
    '/api/v1/tasks/t3': STARTED,
    '/api/v1/tasks/t3/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t3/watchers': { watchers: [] },
    '/api/v1/tasks/t3/estimate': ESTIMATE,
    '/api/v1/tasks/t3/usage': t3Usage,
    '/api/v1/tasks/t1': OTHER,
    '/api/v1/tasks/t1/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t1/watchers': { watchers: [] },
    '/api/v1/tasks/t1/usage': usage({
      task_id: 't1',
      key: 'LC-1',
      totals: totals(12_300, 400_000),
      by_person: [
        {
          ...BEA,
          tokens: 12_300,
          by_agent: [{ agent: 'claude-code', tokens: 12_300, cache_read: 400_000 }],
        },
      ],
      by_round: [{ number: 1, finished_on: null, tokens: 12_300, cache_read: 400_000 }],
    }),
    '/api/v1/tasks/t4': NEVER,
    '/api/v1/tasks/t4/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t4/watchers': { watchers: [] },
    '/api/v1/tasks/t4/usage': EMPTY('t4', 'LC-4'),
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
}

void after(async () => {
  await closeBrowser();
});

async function tokens(h: Harness): Promise<string> {
  const section = h.page.locator('[data-section="tokens"]');
  await section.waitFor({ timeout: 20_000 });
  await until(async () => (await section.locator('.tk-total, .tk-empty').count()) > 0);
  return section.innerText();
}

void describe('the task panel’s Tokens section, per reader', () => {
  void test('an owner: the total without cache reads, the share, each round, everyone by name and agent', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub('owner', usage({})));
    try {
      const text = await tokens(h);
      const section = h.page.locator('[data-section="tokens"]');
      assert.equal(await section.locator('.tk-total').innerText(), '4.01M');
      assert.equal(await section.locator('.tk-cache').innerText(), '81M');
      assert.equal(
        await section.locator('[data-figure="attributed"] .tk-share').innerText(),
        '81%',
      );
      // The forecast beside the actual (LAI-772): the build's range, and what it spent.
      await until(async () => (await section.locator('[data-figure="forecast"]').count()) > 0);
      assert.equal(await section.locator('.tk-forecast').innerText(), '1.2M–2.5M');
      assert.match(
        await section.locator('[data-figure="forecast"] .tk-sub').innerText(),
        /likely to pessimistic · spent on it 3\.21M/,
      );
      assert.match(text, /at least/);
      assert.match(text, /of its people’s work those days/);
      assert.match(text, /Round 1 · handed in 13 Oct/);
      assert.match(text, /Round 3 · open/);
      assert.match(text, /By person and agent/);
      assert.match(text, /Bea Lindqvist[\s\S]*Cal Moreno/, 'people are not in name order');
      assert.match(text, /Claude Code 3\.42M · Codex 102K/);
    } finally {
      await h.close();
    }
  });

  void test('the person themselves: their own part only, and their own share', async () => {
    const h = await open(
      '/board?project=laika-core&task=t3',
      stub(
        'member',
        usage({
          people: 'own',
          by_person: [BEA],
          attributed: { tokens: 3_688_800, of: 4_556_800 },
        }),
      ),
    );
    try {
      const text = await tokens(h);
      assert.match(text, /Yours, by agent/);
      assert.match(text, /Bea Lindqvist/);
      assert.doesNotMatch(text, /Cal Moreno/);
      assert.match(text, /of yours those days/);
      assert.match(text, /the rest of your work those days counts for no task/);
    } finally {
      await h.close();
    }
  });

  void test('a member who did none of it: the total and what it counts, no share, nobody named', async () => {
    const h = await open(
      '/board?project=laika-core&task=t3',
      stub('member', usage({ people: 'own', by_person: [], attributed: null })),
    );
    try {
      const text = await tokens(h);
      const section = h.page.locator('[data-section="tokens"]');
      assert.equal(await section.locator('.tk-total').innerText(), '4.01M');
      assert.equal(await section.locator('[data-figure="attributed"]').count(), 0);
      assert.match(
        text,
        /Counted only where an agent marked this task or worked on a branch named LC-3-…/,
      );
      assert.match(text, /None of these are yours/);
      assert.doesNotMatch(text, /Bea Lindqvist|Cal Moreno/);
    } finally {
      await h.close();
    }
  });

  void test('a task never started that has none: no section at all', async () => {
    const h = await open('/board?project=laika-core&task=t4', stub('owner', usage({})));
    try {
      // Positive control: the panel is open on LC-4, and its usage was asked for.
      await h.page.locator('.panel-section').first().waitFor({ timeout: 20_000 });
      await until(() => h.calls.some((c) => c.path === '/api/v1/tasks/t4/usage'));
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/tasks/t4/usage'),
        'its usage was never read',
      );
      await until(async () => (await h.page.locator('[data-section="tokens"]').count()) > 0, 1_000);
      assert.equal(await h.page.locator('[data-section="tokens"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('moving to another task', () => {
  void test('never shows the last task’s figures while the next one’s load', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await open('/board?project=laika-core&task=t3', stub('owner', usage({})), {
      before: async (page) => {
        await page.route('**/api/v1/tasks/t1/usage**', async (route: Route) => {
          await held;
          await route.continue();
        });
      },
    });
    try {
      await tokens(h);
      assert.equal(await h.page.locator('.tk-total').innerText(), '4.01M');

      // In the app, not a reload: the effort's link to a similar task, inside
      // its folded *why* (LAI-785).
      await h.page.locator('details.fc-why summary').click();
      await h.page.locator('.fc-similar-link', { hasText: 'LC-1' }).click();
      await until(() => h.page.url().includes('task=t1'));
      assert.match(h.page.url(), /task=t1/);
      // LC-1's answer is held back: whatever is drawn must not be LC-3's.
      await until(async () => (await h.page.locator('.tk-total').count()) === 0, 2_000);
      assert.equal(await h.page.locator('.tk-total').count(), 0, 'LC-3’s figures stayed on LC-1');

      release();
      await until(async () => (await h.page.locator('.tk-total').count()) > 0, 10_000);
      assert.equal(await h.page.locator('.tk-total').innerText(), '12.3K');
    } finally {
      release();
      await h.close();
    }
  });
});

/** The task's budget in force, as `services/token-budgets.ts` answers it (LAI-773). */
const BUDGET = {
  scope: 'task',
  id: 't3',
  project: { slug: 'laika-core', name: 'Laika Core' },
  label: 'LC-3',
  title: 'Tie agent tokens to tasks',
  source: 'forecast',
  tokens: 2_500_000,
  period: null,
  used: 4_006_700,
  share: 1.6,
  state: 'over',
  crossed: [
    { threshold: 80, at: NOW - 2 * HOUR },
    { threshold: 100, at: NOW - HOUR },
  ],
};

void describe('LAI-773: cost, the budget and the runaway banner', () => {
  void test('a lead: the cost labelled API-equivalent, the budget over with its badge, and a way to set it', async () => {
    const writes: StubCall[] = [];
    const h = await open('/board?project=laika-core&task=t3', {
      ...stub('owner', usage({ budget: BUDGET })),
      '/api/v1/tasks/t3/budget': (call: StubCall) => {
        writes.push(call);
        return {
          budget: {
            ...BUDGET,
            source: 'set',
            tokens: 6_000_000,
            share: 0.67,
            state: 'under',
            crossed: [],
          },
        };
      },
    });
    try {
      await tokens(h);
      const section = h.page.locator('[data-section="tokens"]');
      assert.equal(await section.locator('.tk-cost').innerText(), '$44.07');
      assert.match(
        await section.locator('[data-figure="cost"]').innerText(),
        /API-equivalent, not your bill/,
      );
      const meter = section.locator('[data-block="budget"] .budget');
      await meter.waitFor();
      assert.equal(await meter.locator('.budget-badge').innerText(), '100%');
      assert.match(
        await meter.innerText(),
        /4\.01M of 2\.5M · 160% · the forecast’s p80, frozen at claim/,
      );
      const editor = section.locator('[data-block="budget"] .budget-editor');
      await editor.waitFor({ timeout: 10_000 });
      await editor.locator('input').fill('6M');
      await editor.getByRole('button', { name: 'Set' }).click();
      await until(() => writes.length === 1);
      assert.equal(writes[0]?.method, 'PUT');
      assert.deepEqual(writes[0]?.body, { tokens: 6_000_000 });
      assert.equal(await section.locator('.tk-runaway').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a member: the budget as a figure, and nothing to set — the server said can_set false', async () => {
    const h = await open(
      '/board?project=laika-core&task=t3',
      stub('member', usage({ people: 'own', by_person: [BEA], budget: BUDGET })),
    );
    try {
      await tokens(h);
      const section = h.page.locator('[data-section="tokens"]');
      await section.locator('[data-block="budget"] .budget').waitFor();
      await until(() => h.calls.some((c) => c.path === '/api/v1/projects/laika-core/budgets'));
      assert.equal(await section.locator('.budget-editor').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the person it is for: the runaway banner, about their quota', async () => {
    const h = await open(
      '/board?project=laika-core&task=t3',
      stub(
        'member',
        usage({
          people: 'own',
          by_person: [BEA],
          runaway: {
            alert_id: 'a1',
            tokens: 7_000_000,
            p95: 5_994_000,
            since: NOW - 10 * 60_000,
            last_progress_at: NOW - 75 * 60_000,
          },
        }),
      ),
    );
    try {
      await tokens(h);
      const banner = h.page.locator('[data-section="tokens"] .tk-runaway');
      await banner.waitFor();
      assert.match(
        await banner.innerText(),
        /^Your agent has spent 7M on this task, past its p95 of 5\.99M, and nothing has landed for 7\d min — no commit pushed and no new session on it\.$/,
      );
    } finally {
      await h.close();
    }
  });

  void test('light and dark at 1366 and 390: the section fits, the bar is drawn', async () => {
    const h = await open(
      '/board?project=laika-core&task=t3',
      stub('owner', usage({ budget: BUDGET })),
    );
    try {
      await tokens(h);
      await h.page.locator('[data-block="budget"] .budget').waitFor();
      for (const theme of ['Light', 'Dark']) {
        // The open drawer covers the rail's theme switch, so the attribute the
        // switch sets is set directly: light is `data-theme="light"`, dark is
        // the bare root (LAI-606).
        await h.page.evaluate((dark: boolean) => {
          if (dark) document.documentElement.removeAttribute('data-theme');
          else document.documentElement.setAttribute('data-theme', 'light');
        }, theme === 'Dark');
        for (const [width, height] of [
          [1366, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width, height });
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(overflow <= 0, `${theme} at ${String(width)}: ${String(overflow)} px sideways`);
          const colour = await h.page
            .locator('[data-block="budget"] .budget-bar')
            .evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.notEqual(colour, 'rgba(0, 0, 0, 0)', `${theme}: the bar has no colour`);
        }
      }
    } finally {
      await h.close();
    }
  });
});
