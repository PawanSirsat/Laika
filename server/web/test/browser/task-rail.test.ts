/**
 * The task detail's rail, to the 2026-11-04 design (LAI-1122): the status
 * pill, the Details card in the design's order with priority in words, the
 * Links & dates card that took the subtasks and the linked tasks from the main
 * column, Development from the round's proof, the Estimate card — effort,
 * similar tasks with their times and why one was sent back
 * (`GET /tasks/:id/similar`), the actual with its verdict, tokens against the
 * estimate's high end — and the foot. The confirmed time people logged
 * (`GET /tasks/:id/time`) left the rail for *Tracked on this task* under the
 * the panel's foot (the last describe here); this checks the rail no longer says it.
 *
 * Each assertion reads what only the real path draws: words from the stubbed
 * answers, the requests that went out, the layout at phone width.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  asServed,
  closeBrowser,
  open,
  refuse,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { tipText } from './tooltip-probe.ts';

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;

const CORE = {
  id: 'laika-core',
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

const SIZE = {
  level: 'M',
  computed: 'M',
  overridden: false,
  weight: 1,
  build_p50_ms: 35 * MIN,
  build_p80_ms: 60 * MIN,
  subtasks: 0,
};

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
    project_id: 'laika-core',
    title: 'A task',
    description_md: '',
    acceptance_md: null,
    deliverables: [],
    solves: [],
    unlocks: [],
    status: 'backlog',
    priority: 'p2',
    assignee_id: 'u1',
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
    size: null,
    created_at: NOW - 2 * HOUR,
    updated_at: NOW - HOUR,
    started_at: null,
    completed_at: null,
    ...over,
  });

const SUBJECT = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Launcher runs visible on the laptop',
  status: 'review',
  priority: 'p1',
  created_via: 'mcp',
  created_by_client: 'claude-code',
  tags: ['host-belka'],
  blocked_by: ['t2'],
  blocks: ['t3'],
  discovered_from: 't2',
  due_on: Date.UTC(2026, 11, 12),
  external_ref: 'LAI-1113',
  started_at: NOW - 64 * MIN,
  size: SIZE,
});
const BLOCKER = task({ id: 't2', key: 'LC-2', number: 2, title: 'The launcher itself' });
const BLOCKED = task({ id: 't3', key: 'LC-3', number: 3, title: 'Watch from the phone' });
const CHILD_DONE = task({
  id: 't4',
  key: 'LC-4',
  number: 4,
  title: 'Start notification',
  status: 'done',
  parent_task_id: 't1',
});
const CHILD_OPEN = task({
  id: 't7',
  key: 'LC-7',
  number: 7,
  title: 'Exit notification',
  status: 'in_progress',
  parent_task_id: 't1',
});

const ESTIMATE = {
  task_id: 't1',
  size: SIZE,
  why: {
    early: false,
    method: 'text_similar',
    typical: { words: 220, build_ms: 35 * MIN },
    factors: [{ key: 'tag:cli', label: 'Tagged “cli”', levels: 0.4 }],
    similar: [
      { task_id: 't5', key: 'LC-5', title: 'Launcher logs', build_ms: 44 * MIN, similarity: 0.7 },
      { task_id: 't6', key: 'LC-6', title: 'Launcher retry', build_ms: 38 * MIN, similarity: 0.6 },
    ],
    model_version: 'abc123',
    computed_at: NOW - HOUR,
  },
  override: null,
  at_start: {
    level: 'M',
    build_p50_ms: 35 * MIN,
    build_p80_ms: 60 * MIN,
    tokens_p50: 228_000,
    tokens_p80: 716_000,
    estimated_at: NOW - 64 * MIN,
  },
  actual: {
    build_ms: 40 * MIN,
    review_wait_ms: 24 * MIN,
    rework_ms: 0,
    finishes: 1,
    first_finish_at: NOW - 24 * MIN,
  },
  tokens: { p50: 228_000, p80: 716_000, learned_from: 14, forecasts_after: 10 },
  actual_tokens: { build: 597_000, total: 597_000, rework: 0 },
  claim_estimate: null,
  scope_grew: null,
  split: null,
  history: [],
};

const SIMILAR = {
  similar: [
    {
      task_id: 't5',
      key: 'LC-5',
      title: 'Launcher logs',
      status: 'done',
      similarity: 0.7,
      rounds: 1,
      send_backs: [],
    },
    {
      task_id: 't6',
      key: 'LC-6',
      title: 'Launcher retry',
      status: 'done',
      similarity: 0.6,
      rounds: 2,
      send_backs: [{ round: 1, reason: 'The retry gives up after one try\n\nSee the log.' }],
    },
  ],
};

const cost = (usd: number) => ({
  usd,
  unpriced_tokens: 0,
  unpriced_models: [],
  unconfirmed_models: [],
});

const USAGE = {
  task_id: 't1',
  key: 'LC-1',
  tz: 'UTC',
  first_day: '2026-11-03',
  last_day: '2026-11-03',
  totals: {
    tokens: 597_000,
    input: 59_700,
    output: 119_400,
    cache_write: 417_900,
    cache_read: 9_000_000,
    cost: cost(14.02),
  },
  people: 'everyone',
  by_person: [],
  by_round: [{ number: 1, finished_on: '2026-11-03', tokens: 597_000, cache_read: 9_000_000 }],
  attributed: null,
  budget: null,
  runaway: null,
};

const ROUND = {
  id: 'r1',
  task_id: 't1',
  number: 1,
  finished_by: 'u1',
  client_name: 'claude-code',
  agent: null,
  by_registered_agent: false,
  summary_md: 'Done.',
  commits: [],
  branch: {
    id: 'b1',
    state: 'confirmed',
    state_source: 'github',
    state_at: NOW - 20 * MIN,
    name: 'LAI-1113-visible-runs',
  },
  pull_request: {
    id: 'p1',
    state: 'confirmed',
    state_source: 'github',
    state_at: NOW - 20 * MIN,
    url: 'https://github.com/PawanSirsat/Laika/pull/260',
    merged: false,
  },
  tests: [],
  ci: null,
  created_at: NOW - 24 * MIN,
};

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

function stub(over: Record<string, unknown> = {}): ApiStub {
  const all = [SUBJECT, BLOCKER, BLOCKED, CHILD_DONE, CHILD_OPEN];
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 2, todo: 0, in_progress: 1, review: 1, done: 1, cancelled: 0 },
          blocked_count: 1,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: all, next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t1&limit=200': {
      data: [CHILD_DONE, CHILD_OPEN],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' },
        { user_id: 'u2', name: 'Grace Hopper', email: 'g@example.com', role: 'member' },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/budgets': {
      project_budget: null,
      sprints: [],
      tasks: [],
      can_set: true,
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
    '/api/v1/tasks/t1': SUBJECT,
    '/api/v1/tasks/t1/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t1/watchers': { watchers: ['u1'] },
    '/api/v1/tasks/t1/rounds': { rounds: [ROUND], send_back: null },
    '/api/v1/tasks/t1/estimate': ESTIMATE,
    '/api/v1/tasks/t1/usage': USAGE,
    '/api/v1/tasks/t1/similar': SIMILAR,
    '/api/v1/tasks/t1/time': {
      total_minutes: 130,
      people: 2,
      entries: 3,
      agent_minutes: 0,
      my_draft_minutes: 0,
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    ...over,
  };
}

async function openRail(over: Record<string, unknown> = {}): Promise<Harness> {
  const h = await open('/board?project=laika-core&task=t1', stub(over));
  await h.page.setViewportSize({ width: 1600, height: 1000 });
  await h.page.locator('.drawer').waitFor({ timeout: 20_000 });
  await h.page.locator('.panel-meta').waitFor({ timeout: 10_000 });
  return h;
}

const card = (h: Harness, head: string) =>
  h.page.locator('.panel-meta .meta-card', {
    has: h.page.locator('.meta-card-head, .meta-card-title', { hasText: head }),
  });

const labelsOf = async (h: Harness, head: string) =>
  (await card(h, head).locator('.meta-label').allInnerTexts()).map((t) => t.trim());

void after(async () => {
  await closeBrowser();
});

void describe('the rail, to the 2026-11-04 design', () => {
  void test('the status pill, and Details in the design’s order with priority in words', async () => {
    const h = await openRail();
    try {
      const pill = h.page.locator('.panel-meta .meta-status');
      await pill.locator('.dd-value').waitFor({ timeout: 10_000 });
      assert.equal(await pill.locator('.meta-status-dot').count(), 1, 'no dot in the pill');
      assert.equal((await pill.locator('.dd-value').innerText()).trim(), 'Review');
      assert.equal(await pill.locator('[role="combobox"]').count(), 1, 'the pill is no control');
      await until(async () => (await h.page.locator('[data-status-sub]').count()) === 1);
      assert.match(await h.page.locator('[data-status-sub]').innerText(), /^In review/);

      await until(async () => (await labelsOf(h, 'Details')).includes('Discovered from'));
      assert.deepEqual(await labelsOf(h, 'Details'), [
        'Assignee',
        'Agent',
        'Priority',
        'Labels',
        'Sprint',
        'Reporter',
        'Created via',
        'Outside id',
        'Watchers',
        'Discovered from',
      ]);
      const prio = h.page.locator('.meta-value-prio');
      assert.equal((await prio.locator('.dd-value').innerText()).trim(), 'P1 · High');
      // The icon is still the level's mark, and the control is still the dropdown.
      assert.equal(await prio.locator('.priority-icon').count(), 1);
      assert.equal(await prio.locator('[role="combobox"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('Links & dates: parent, subtasks n of m done, both kinds of link, both dates', async () => {
    const h = await openRail();
    try {
      const links = card(h, 'Links & dates');
      await links.locator('.sub-row', { hasText: 'LC-7' }).waitFor({ timeout: 10_000 });
      // No Parent row: a task with subtasks cannot have one (one level, D-066).
      assert.deepEqual(await labelsOf(h, 'Links & dates'), [
        'Subtasks',
        'Blocked by',
        'Blocks',
        'Due date',
        'Planned start',
      ]);
      assert.equal((await links.locator('.sub-count').innerText()).trim(), '1 of 2 done');
      assert.equal(await links.locator('.sub-row').count(), 2);
      assert.equal(await links.locator('.sub-link', { hasText: '+ Add subtask' }).count(), 1);
      const blockedBy = links.locator('.meta-row-blocked-by');
      assert.match(await blockedBy.locator('.dep-chip').innerText(), /LC-2/);
      assert.equal(await blockedBy.locator('.dep-link').count(), 1, 'no way to link a blocker');
      assert.equal(await blockedBy.locator('.dep-remove').count(), 1, 'no way to unlink one');
      assert.match(await links.locator('.meta-row-blocks .dep-chip').innerText(), /LC-3/);
      assert.match(await links.locator('.meta-row-due').innerText(), /12 Dec 2026/);
      assert.equal(await links.locator('.meta-row-parent').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Development from the round’s proof: its branch and pull request', async () => {
    const h = await openRail();
    try {
      const dev = card(h, 'Development');
      await dev.locator('.meta-row-pr').waitFor({ timeout: 10_000 });
      assert.equal(
        (await dev.locator('.meta-row-pr .meta-value').innerText()).trim(),
        '#260 · not merged',
      );
      assert.equal(
        await dev.locator('.meta-row-pr a').getAttribute('href'),
        'https://github.com/PawanSirsat/Laika/pull/260',
      );
      assert.match(await dev.innerText(), /LAI-1113-visible-runs/);
      assert.match(await dev.innerText(), /LAI-1113/);
    } finally {
      await h.close();
    }
  });

  void test('the Estimate card: effort, similar tasks with why one went back, actual, tokens — and time in the foot', async () => {
    const h = await openRail();
    try {
      const est = card(h, 'Estimate');
      await est.locator('.est-similar-item').first().waitFor({ timeout: 10_000 });
      const effort = est.locator('[data-section="effort"]');
      assert.equal((await effort.locator('.fc-level').innerText()).trim(), 'M');
      assert.equal(await effort.locator('.fc-effort').innerText(), 'Medium');
      assert.equal(await effort.locator('.fc-time').innerText(), 'about 35 min to 1 h');
      assert.equal(
        (await effort.locator('details.fc-why summary').innerText()).trim(),
        'Why Medium?',
      );
      assert.equal(await effort.locator('.fc-change').count(), 1, 'the override went missing');

      // Similar: each key a link beside its title, how long it took under
      // them (LAI-1123); the reason folded.
      await until(() => h.calls.some((c) => c.path === '/api/v1/tasks/t1/similar'));
      await until(async () => (await est.locator('details.est-sent-back').count()) === 1);
      const rows = await est
        .locator('.est-similar-item')
        .evaluateAll((els) =>
          els.map((el) => [
            el.querySelector('.est-similar-link')?.textContent?.trim(),
            el.querySelector('.est-similar-title')?.textContent?.trim(),
            el.querySelector('.est-similar-time')?.textContent?.trim(),
          ]),
        );
      assert.deepEqual(rows, [
        ['LC-5', 'Launcher logs', 'took 44 min'],
        ['LC-6', 'Launcher retry', 'took 38 min'],
      ]);
      const back = est.locator('.est-similar-item', { hasText: 'LC-6' }).locator('details');
      assert.equal(await back.getAttribute('open'), null, 'the reason is not folded');
      await back.locator('summary').click();
      await until(async () => (await back.getAttribute('open')) !== null);
      assert.equal(
        (await back.locator('.est-sent-back-reason').innerText()).trim(),
        'sent back in round 1: The retry gives up after one try',
      );

      // Actual, with its verdict.
      const actual = est.locator('.est-actual-row');
      assert.equal(
        await actual.locator('.fc-compare').innerText(),
        'Estimated at start 35 min–1 h · took 40 min · on target',
      );
      assert.equal(
        await actual.locator('.fc-timeline').innerText(),
        'Building 40 min · waiting for review 24 min',
      );

      // Tokens of the estimate's high end, and the cost line.
      const tokens = est.locator('[data-section="tokens"]');
      await tokens.locator('.tk-of').waitFor({ timeout: 10_000 });
      assert.equal(await tokens.locator('.tk-of').innerText(), '597K of 716K (83%)');
      assert.equal(await tokens.locator('.tk-of').getAttribute('data-state'), 'warn');
      assert.equal(await tokens.locator('.tk-cost').innerText(), '$14.02');
      assert.match(
        await tokens.locator('.tk-headline').innerText(),
        /API-equivalent, not your bill/,
      );
      assert.equal(await tokens.locator('details.tk-details').count(), 1, 'Details went missing');

      // Time people confirmed on it, totals only — said once, in the panel's
      // foot, and no longer on the rail.
      const tracked = h.page.locator('.drawer .tt');
      await tracked.waitFor({ timeout: 10_000 });
      assert.equal((await tracked.locator('.tt-total').innerText()).replace(/\s+/g, ''), '2h10m');
      assert.match(await tracked.innerText(), /by 2 people · 3 entries/);
      assert.doesNotMatch(await est.innerText(), /Time logged/);
    } finally {
      await h.close();
    }
  });

  void test('no time logged draws no row, and a failed similar read keeps the estimate’s list', async () => {
    const h = await openRail({
      '/api/v1/tasks/t1/time': {
        total_minutes: 0,
        people: 0,
        entries: 0,
        agent_minutes: 0,
        my_draft_minutes: 0,
      },
      '/api/v1/tasks/t1/similar': () => refuse(500, 'internal', 'down'),
    });
    try {
      const est = card(h, 'Estimate');
      await est.locator('.est-similar-item').first().waitFor({ timeout: 10_000 });
      await until(() => h.calls.some((c) => c.path === '/api/v1/tasks/t1/time'));
      // Positive control: the card drew, from the same reads.
      await est.locator('.tk-of').waitFor({ timeout: 10_000 });
      assert.equal(await est.locator('.est-time').count(), 0);
      assert.doesNotMatch(await est.innerText(), /\b0 min|Time logged/);
      assert.equal(await est.locator('.est-similar-item').count(), 2);
      assert.equal(await est.locator('details.est-sent-back').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the main column no longer carries Subtasks, Linked tasks, Effort or Tokens', async () => {
    const h = await openRail();
    try {
      // Positive control: each is drawn, in the rail.
      const side = h.page.locator('.panel-side');
      await side.locator('[data-section="effort"]').waitFor({ timeout: 10_000 });
      await side.locator('[data-section="tokens"]').waitFor({ timeout: 10_000 });
      await side.locator('.sub-section').waitFor({ timeout: 10_000 });
      await side.locator('.dep-section').waitFor({ timeout: 10_000 });
      const main = h.page.locator('.panel-main');
      assert.equal(
        await main
          .locator('[data-section="effort"], [data-section="tokens"], .sub-section, .dep-section')
          .count(),
        0,
      );
      const headings = (await main.locator('.panel-section-title').allInnerTexts()).map((t) =>
        t.trim(),
      );
      for (const gone of ['Subtasks', 'Linked tasks', 'Effort', 'Tokens']) {
        assert.ok(!headings.some((t) => t.startsWith(gone)), `${gone} is still in the main column`);
      }
    } finally {
      await h.close();
    }
  });

  void test('the foot: created via, updated, who is watching, the permission note', async () => {
    const h = await openRail();
    try {
      const foot = h.page.locator('.panel-side-foot');
      await until(async () => (await foot.locator('.panel-foot-watching').count()) === 1);
      const times = (await foot.locator('.panel-foot-times').innerText()).replace(/\s+/g, ' ');
      // Short dates, the full one on hover (LAI-1123).
      assert.match(
        times,
        /^Created via MCP · claude-code · \d{1,2} \w{3}(?: \d{4})?, \d{1,2}:\d{2} [AP]M/,
      );
      assert.match(times, / Updated \d{1,2} \w{3}(?: \d{4})?, \d{1,2}:\d{2} [AP]M/);
      assert.match(
        await tipText(foot.locator('.panel-foot-times time').first()),
        /\w{3} \d{1,2} \w{3} \d{4}, /,
      );
      assert.equal(
        await foot.locator('.panel-foot-watching').innerText(),
        'Watching: Ada Lovelace',
      );
      assert.equal(
        await foot.locator('.panel-permission').innerText(),
        'Members can move and comment. Viewers see this panel read-only.',
      );
    } finally {
      await h.close();
    }
  });

  void test('22rem wide, and no sideways scroll at 390px, in light and dark', async () => {
    const h = await openRail();
    try {
      await card(h, 'Estimate').locator('.tk-of').waitFor({ timeout: 10_000 });
      const width = await h.page.locator('.panel-side').evaluate(
        (el) =>
          // Its box less its borders — the 1px rule on its left is the
          // column's edge — so a scrollbar, where a platform draws one, is in it.
          ((el as HTMLElement).offsetWidth -
            parseFloat(getComputedStyle(el).borderLeftWidth) -
            parseFloat(getComputedStyle(el).borderRightWidth)) /
          parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
      assert.equal(width, 22, `the rail is ${String(width)}rem`);
      const inks: string[] = [];
      for (const dark of [false, true]) {
        await h.page.evaluate((d: boolean) => {
          if (d) document.documentElement.removeAttribute('data-theme');
          else document.documentElement.setAttribute('data-theme', 'light');
        }, dark);
        for (const [w, hgt] of [
          [1366, 900],
          [390, 844],
        ] as const) {
          await h.page.setViewportSize({ width: w, height: hgt });
          await until(
            async () =>
              (await h.page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth,
              )) <= 0,
          );
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(
            overflow <= 0,
            `${dark ? 'dark' : 'light'} at ${String(w)}: ${String(overflow)}px sideways`,
          );
          // Nothing in the rail is wider than the rail — or, on a phone, than
          // the sheet: below 600px the rail's wrapper is `display: contents`
          // and has no box of its own (the one column, LAI-1122).
          const wider = await h.page.locator('.panel-side').evaluate((side) => {
            const own = side.getBoundingClientRect();
            const box =
              own.width > 0 ? own : (side.closest('.drawer') ?? side).getBoundingClientRect();
            const edge = box.right + 0.5;
            return [...side.querySelectorAll('.meta-card *')]
              .filter(
                (el) => el.getBoundingClientRect().right > edge && el.getClientRects().length > 0,
              )
              .map((el) => el.className)
              .slice(0, 5);
          });
          assert.deepEqual(wider, [], `${dark ? 'dark' : 'light'} at ${String(w)}: past the rail`);
        }
        inks.push(
          await h.page
            .locator('.panel-meta .meta-status')
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        );
      }
      assert.notEqual(inks[0], inks[1], 'the status pill ignores the theme');
    } finally {
      await h.close();
    }
  });
});

void describe('Tracked on this task, pinned to the panel’s foot', () => {
  const TIME = {
    total_minutes: 402,
    people: 3,
    entries: 7,
    agent_minutes: 125,
    my_draft_minutes: 72,
  };
  const running = (task: { id: string; key: string } | null, title: string | null = null) => ({
    started_at: Date.now() - 65_000,
    resumed_at: Date.now() - 65_000,
    paused_at: null,
    accumulated_ms: 0,
    tz: 'UTC',
    task: task === null ? null : { ...task, title: 'A task' },
    kind: null,
    title,
  });
  const day = (mode: string, timer: unknown) => ({ settings: { org_mode: mode }, timer });
  const block = (h: Harness) => h.page.locator('.drawer .tt');

  void test('the confirmed total, large, with who, the reader’s drafts and agent minutes beside it', async () => {
    const h = await openRail({
      '/api/v1/tasks/t1/time': TIME,
      '/api/v1/me/time': day('drafts', null),
    });
    try {
      await block(h).waitFor({ timeout: 10_000 });
      assert.equal((await block(h).locator('.tt-total').innerText()).replace(/\s+/g, ''), '6h42m');
      const text = await block(h).innerText();
      assert.match(text, /by 3 people · 7 entries/);
      assert.match(text, /\+1h 12m in your drafts/);
      // Minutes, never hours (D-088 item 8).
      assert.match(text, /125 agent min/);
      // A slim bar at the foot of the panel, below both scrolling columns,
      // where scrolling the document cannot move it. Measured once the
      // drawer's slide-in has finished, and all in one frame: measured apart
      // while it moved, the bar read 1.8px "above" the columns' foot.
      await h.page
        .locator('.drawer')
        .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const measure = () =>
        h.page.evaluate(() => {
          const rect = (selector: string) => {
            const el = document.querySelector(selector);
            if (el === null) throw new Error(`no ${selector}`);
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height };
          };
          return {
            bar: rect('.drawer .tt'),
            columns: rect('.panel-columns'),
            panel: rect('.drawer'),
          };
        });
      const at = await measure();
      assert.ok(
        at.bar.top >= at.columns.bottom - 1,
        `the bar (top ${String(at.bar.top)}) is not below the columns (bottom ${String(at.columns.bottom)})`,
      );
      assert.ok(Math.abs(at.bar.bottom - at.panel.bottom) <= 2, 'not at the foot');
      assert.ok(at.bar.height <= 56, `the bar is ${String(at.bar.height)}px tall — not slim`);
      await h.page.locator('.panel-main').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const after = await measure();
      assert.equal(after.bar.top, at.bar.top, 'the bar moved when the document scrolled');
      await block(h).getByRole('button', { name: 'Start timer' }).waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('no drafts or agent lines when there are none, and no button when time is off', async () => {
    const h = await openRail({
      '/api/v1/tasks/t1/time': { ...TIME, agent_minutes: 0, my_draft_minutes: null },
      '/api/v1/me/time': day('off', null),
    });
    try {
      await block(h).waitFor({ timeout: 10_000 });
      await until(() => h.calls.some((c) => c.path === '/api/v1/me/time'));
      const text = await block(h).innerText();
      assert.doesNotMatch(text, /drafts|agent min/);
      // Positive control: the block drew from the same read.
      assert.match(text, /by 3 people/);
      assert.equal(await block(h).locator('button').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Start timer starts one on this task, and then it runs here with Stop', async () => {
    let timer: unknown = null;
    let posted: unknown;
    const h = await openRail({
      '/api/v1/tasks/t1/time': TIME,
      '/api/v1/me/time': () => day('drafts', timer),
      '/api/v1/me/time/timer': (call: StubCall) => {
        posted = call.body;
        timer = running({ id: 't1', key: 'LAI-7' });
        return timer;
      },
    });
    try {
      await block(h).getByRole('button', { name: 'Start timer' }).click();
      await block(h).locator('.tt-clock').waitFor({ timeout: 10_000 });
      assert.deepEqual(
        { task: (posted as { task?: string }).task, tz: typeof (posted as { tz?: unknown }).tz },
        { task: 't1', tz: 'string' },
      );
      assert.match(await block(h).locator('.tt-clock').innerText(), /^1:0\d$/);
      await block(h).getByRole('button', { name: 'Stop' }).waitFor();
      assert.equal(await block(h).getByRole('button', { name: 'Start timer' }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a timer running on another task is named, never a second start', async () => {
    const h = await openRail({
      '/api/v1/tasks/t1/time': TIME,
      '/api/v1/me/time': day('drafts', running({ id: 't9', key: 'LAI-9' })),
    });
    try {
      await block(h).getByText('Your timer is running on LAI-9.').waitFor({ timeout: 10_000 });
      assert.equal(await block(h).getByRole('button', { name: 'Start timer' }).count(), 0);
      await block(h).getByRole('button', { name: 'Open My day' }).waitFor();
    } finally {
      await h.close();
    }
  });
});
