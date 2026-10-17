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
import { asServed, closeBrowser, open, until, type ApiStub, type Harness } from './harness.ts';

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
  history: [],
};

const totals = (tokens: number, cacheRead: number) => ({
  tokens,
  input: Math.round(tokens * 0.1),
  output: Math.round(tokens * 0.2),
  cache_write: tokens - Math.round(tokens * 0.1) - Math.round(tokens * 0.2),
  cache_read: cacheRead,
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
    '/api/v1/projects/laika-core/estimates/accuracy': {
      project_id: 'laika-core',
      finished: 42,
      forecasts_after: 10,
      live: { n: 12, typical_error: 1.7, bias: 1.1, p80_hit_rate: 0.75 },
      backtest: null,
      by_client: [],
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

      // In the app, not a reload: the forecast's link to a similar task.
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
