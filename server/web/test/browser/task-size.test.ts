/**
 * Sizes and forecasts on screen (D-085, LAI-771): the size chip on a card, the
 * List's sortable Size column, the task panel's Forecast section — the size,
 * Laika's own beside a person's, the range, the actual, the *why* with links
 * to the similar tasks, and the project's accuracy — and the override control,
 * which a reader who may not edit the task does not get.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  asServed,
  closeBrowser,
  open,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';
import { pick, valueOf } from './dropdown.ts';

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

const size = (over: Record<string, unknown>) => ({
  level: 'M',
  computed: 'M',
  overridden: false,
  weight: 1,
  build_p50_ms: 25 * MIN,
  build_p80_ms: 50 * MIN,
  subtasks: 0,
  ...over,
});

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

const SMALL = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Rename the column',
  size: size({
    level: 'XS',
    computed: 'XS',
    weight: 0.3,
    build_p50_ms: 8 * MIN,
    build_p80_ms: 20 * MIN,
  }),
});
const OVERRIDDEN = task({
  id: 't2',
  key: 'LC-2',
  number: 2,
  title: 'Migrate the sessions table',
  size: size({ level: 'XL', computed: 'M', overridden: true, weight: 1.1 }),
});
const LARGE = task({
  id: 't3',
  key: 'LC-3',
  number: 3,
  title: 'Size and forecast every task',
  status: 'in_progress',
  assignee_id: 'u1',
  started_at: NOW - 3 * HOUR,
  acceptance_md: '- [ ] a size on every card\n- [ ] a forecast range',
  size: size({
    level: 'L',
    computed: 'L',
    weight: 2.1,
    build_p50_ms: HOUR,
    build_p80_ms: 2.5 * HOUR,
  }),
});
const UNSIZED = task({ id: 't4', key: 'LC-4', number: 4, title: 'Not sized yet', size: null });
const COLD = task({
  id: 't5',
  key: 'LC-5',
  number: 5,
  title: 'A cold project task',
  size: size({ build_p50_ms: null, build_p80_ms: null }),
});

const ESTIMATE = {
  task_id: 't3',
  size: LARGE.size,
  why: {
    early: false,
    method: 'text_similar',
    typical: { words: 220, build_ms: 35 * MIN },
    factors: [
      {
        key: 'words',
        label: '640 words of description and acceptance (typical here: 220)',
        levels: 0.84,
      },
      { key: 'tag', label: 'Tagged docs', levels: -0.31 },
      { key: 'similar', label: '7 similar finished tasks (median 1.2 h)', levels: 0.55 },
      {
        key: 'priority',
        label: 'Priority is urgency, not size: it changes nothing here',
        levels: 0,
      },
    ],
    similar: [
      {
        task_id: 't1',
        key: 'LC-1',
        title: 'Rename the column',
        build_ms: 40 * MIN,
        similarity: 0.61,
      },
      {
        task_id: 't2',
        key: 'LC-2',
        title: 'Migrate the sessions table',
        build_ms: 70 * MIN,
        similarity: 0.44,
      },
    ],
    model_version: 'abc123',
    computed_at: NOW - HOUR,
  },
  override: null,
  at_start: {
    level: 'M',
    build_p50_ms: 20 * MIN,
    build_p80_ms: 45 * MIN,
    tokens_p50: null,
    tokens_p80: null,
    estimated_at: NOW - 3 * HOUR,
  },
  actual: {
    build_ms: 90 * MIN,
    review_wait_ms: 2 * HOUR,
    rework_ms: 30 * MIN,
    finishes: 2,
    first_finish_at: NOW - 90 * MIN,
  },
  tokens: { p50: null, p80: null, learned_from: 0, forecasts_after: 10 },
  actual_tokens: null,
  claim_estimate: null,
  scope_grew: null,
  split: null,
  history: [],
};

/** LAI-772: the same task with tokens forecast, spent, and the notes beside them. */
const PHASE2 = {
  ...ESTIMATE,
  at_start: { ...ESTIMATE.at_start, tokens_p50: 900_000, tokens_p80: 2_100_000 },
  tokens: { p50: 1_200_000, p80: 2_500_000, learned_from: 14, forecasts_after: 10 },
  actual_tokens: { build: 1_400_000, total: 1_700_000, rework: 300_000 },
  claim_estimate: {
    level: 'S',
    confidence: 'yellow',
    client_name: 'Claude Code',
    created_at: NOW - 3 * HOUR,
  },
  scope_grew: { from: 'M', to: 'L' },
  split: null,
};

const ACCURACY = {
  project_id: 'laika-core',
  finished: 42,
  forecasts_after: 10,
  live: { n: 12, typical_error: 1.7, bias: 1.1, p80_hit_rate: 0.75 },
  backtest: {
    n: 30,
    method_error: 1.68,
    median_error: 2.1,
    p80_hit_rate: 0.78,
    beats_median: true,
  },
  by_client: [],
  tokens: {
    learned_from: 14,
    forecasts_after: 10,
    live: { n: 0, typical_error: null, bias: null, p80_hit_rate: null },
    backtest: {
      n: 4,
      method_error: 1.9,
      median_error: 2.3,
      p80_hit_rate: 0.75,
      beats_median: true,
    },
  },
  agent: {
    size: { n: 0, agent_error: null, median_error: null, model_error: null, weight: 0 },
    confidence: [],
  },
  model_version: 'abc123',
};

function stub(role: 'lead' | 'viewer' = 'lead'): ApiStub {
  const all = [SMALL, OVERRIDDEN, LARGE, UNSIZED, COLD];
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: role === 'lead' ? 'owner' : 'viewer',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 4, in_progress: 1, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: all, next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t3&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t5&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/estimates/accuracy': ACCURACY,
    '/api/v1/tasks/t3': LARGE,
    '/api/v1/tasks/t3/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t3/watchers': { watchers: [] },
    '/api/v1/tasks/t3/estimate': ESTIMATE,
    '/api/v1/tasks/t5': COLD,
    '/api/v1/tasks/t5/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t5/watchers': { watchers: [] },
    '/api/v1/tasks/t5/estimate': {
      ...ESTIMATE,
      task_id: 't5',
      size: COLD.size,
      why: { ...ESTIMATE.why, early: true, method: 'text', similar: [] },
      at_start: null,
      actual: {
        build_ms: null,
        review_wait_ms: 0,
        rework_ms: 0,
        finishes: 0,
        first_finish_at: null,
      },
    },
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

async function forecast(h: Harness): Promise<void> {
  await h.page.locator('.fc').waitFor({ timeout: 20_000 });
  await until(async () => (await h.page.locator('.fc-factor').count()) > 0);
}

void describe('the size chip on a card', () => {
  void test('draws each task’s size, marks one a person set, and draws nothing for no size', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      const chip = (key: string) =>
        h.page.locator('.card').filter({ hasText: key }).locator('.card-size');

      assert.equal(await chip('LC-1').innerText(), 'XS');
      assert.equal(await chip('LC-3').innerText(), 'L');
      assert.equal((await chip('LC-2').innerText()).trim(), 'XL');
      assert.equal(
        await chip('LC-2').locator('.size-chip-dot').count(),
        1,
        'no mark for a person’s size',
      );
      assert.match(
        (await chip('LC-2').getAttribute('title')) ?? '',
        /set by a person · Laika computed M/,
      );
      assert.equal(await chip('LC-1').locator('.size-chip-dot').count(), 0);
      // Positive control above; the absence is the unsized card.
      assert.equal(await chip('LC-4').count(), 0, 'a card with no size drew a chip');
    } finally {
      await h.close();
    }
  });
});

void describe('the List’s Size column', () => {
  void test('shows each size and sorts by it, unsized tasks last either way', async () => {
    const h = await open('/list?project=laika-core', stub());
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      const keys = async () => h.page.locator('.list-row .list-key').allInnerTexts();
      const header = h.page.locator('button.list-sort[title="Sort by Size"]');

      await header.click();
      await until(async () => (await keys())[0]?.startsWith('LC-1') === true);
      assert.deepEqual(
        (await keys()).map((k) => k.slice(0, 4)),
        ['LC-1', 'LC-5', 'LC-3', 'LC-2', 'LC-4'],
      );
      assert.equal(
        await h.page.locator('th', { has: header }).getAttribute('aria-sort'),
        'ascending',
      );

      await header.click();
      await until(async () => (await keys())[0]?.startsWith('LC-2') === true);
      assert.deepEqual(
        (await keys()).map((k) => k.slice(0, 4)),
        ['LC-2', 'LC-3', 'LC-5', 'LC-1', 'LC-4'],
      );

      const row = h.page.locator('.list-row').filter({ hasText: 'LC-2' });
      assert.equal((await row.locator('.list-size').innerText()).trim(), 'XL');
    } finally {
      await h.close();
    }
  });
});

void describe('the task panel’s Forecast section', () => {
  void test('shows the size, the range, the frozen copy, the actual, the why and the accuracy', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub());
    try {
      await forecast(h);
      const section = h.page.locator('.fc');

      assert.equal(await section.locator('.fc-size .size-chip').innerText(), 'L');
      assert.equal(await section.locator('.fc-range').innerText(), '1.0–2.5 h');
      assert.match(await section.locator('.fc-at-start').innerText(), /M · 20–45 min/);
      assert.equal(await section.locator('.fc-actual').innerText(), '1.5 h');
      assert.equal(await section.locator('.fc-review-wait').innerText(), '2.0 h');
      assert.equal(await section.locator('.fc-rework').innerText(), '30 min');

      const factors = await section.locator('.fc-factor').allInnerTexts();
      assert.ok(
        factors.some((f) => f.includes('+0.8') && f.includes('640 words')),
        factors.join(' | '),
      );
      assert.ok(factors.some((f) => f.includes('−0.3') && f.includes('Tagged docs')));
      assert.ok(factors.some((f) => f.includes('Priority is urgency')));

      const links = await section.locator('.fc-similar-link').allInnerTexts();
      assert.deepEqual(links, ['LC-1', 'LC-2']);

      assert.equal(
        await section.locator('.fc-accuracy').innerText(),
        'This project: Typically off by ×1.7 · p80 held 75% · 12 tasks measured',
      );
      // Nothing in the section names a person.
      assert.doesNotMatch(await section.innerText(), /Ada/);
    } finally {
      await h.close();
    }
  });

  void test('puts tokens beside the hours: forecast, frozen copy, spent, and the notes (LAI-772)', async () => {
    const h = await open('/board?project=laika-core&task=t3', {
      ...stub(),
      '/api/v1/tasks/t3/estimate': PHASE2,
    });
    try {
      await forecast(h);
      const section = h.page.locator('.fc');
      await until(async () => (await section.locator('.fc-tokens').innerText()) !== '—');
      assert.equal(await section.locator('.fc-tokens').innerText(), '1.2M–2.5M');
      assert.match(await section.locator('.fc-at-start').innerText(), /· 900K–2.1M tokens$/);
      assert.equal(await section.locator('.fc-actual-tokens').innerText(), '1.4M');
      const notes = await section.locator('.fc-note').allInnerTexts();
      assert.deepEqual(notes, [
        'Scope grew after start: M when work began, L now',
        'Said at claim: S, yellow · Claude Code',
      ]);
      assert.equal(
        await section.locator('.fc-accuracy-tokens').innerText(),
        'Tokens back-test: ×1.9 against ×2.3 for the project median, over 4 tasks',
      );
      assert.doesNotMatch(await section.innerText(), /Ada/);
    } finally {
      await h.close();
    }
  });

  void test('suggests splitting an XL task, and says what tokens wait for', async () => {
    const h = await open('/board?project=laika-core&task=t3', {
      ...stub(),
      '/api/v1/tasks/t3/estimate': {
        ...ESTIMATE,
        tokens: { p50: null, p80: null, learned_from: 3, forecasts_after: 10 },
        split: { xl_finished: 4, rounds_avg: 2.3 },
      },
    });
    try {
      await forecast(h);
      const section = h.page.locator('.fc');
      await until(async () => (await section.locator('.fc-note').count()) > 0);
      assert.equal(await section.locator('.fc-tokens').innerText(), 'Early');
      assert.equal(
        await section.locator('.fc-tokens-early').innerText(),
        'Tokens after 10 finished tasks with attributed token data (3 so far).',
      );
      assert.deepEqual(await section.locator('.fc-note').allInnerTexts(), [
        'Consider splitting it: XL tasks here took 2.3 rounds on average (4 finished)',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('opens a similar task from its link', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub());
    try {
      await forecast(h);
      await h.page.locator('.fc-similar-link', { hasText: 'LC-1' }).click();
      await until(() => h.page.url().includes('task=t1'));
      assert.match(h.page.url(), /task=t1/);
    } finally {
      await h.close();
    }
  });

  void test('says early, and how many finished tasks it waits for, in a cold start', async () => {
    const h = await open('/board?project=laika-core&task=t5', stub());
    try {
      await forecast(h);
      assert.match(await h.page.locator('.fc-range').innerText(), /Early/);
      assert.match(await h.page.locator('.fc').innerText(), /hours after 10 finished tasks/);
    } finally {
      await h.close();
    }
  });

  void test('sets a person’s size and goes back to the computed one', async () => {
    // The task as the server holds it: a PATCH changes what the next read says.
    let current: Record<string, unknown> = LARGE;
    const h = await open('/board?project=laika-core&task=t3', {
      ...stub(),
      // The board reads the task back through the project's list as well.
      '/api/v1/projects/laika-core/tasks?limit=200': () => ({
        data: [SMALL, OVERRIDDEN, current, UNSIZED, COLD],
        next_cursor: null,
      }),
      '/api/v1/tasks/t3': (call: { method: string; body: unknown }) => {
        if (call.method === 'PATCH') {
          const asked = (call.body as { size: string | null }).size;
          current = {
            ...LARGE,
            updated_at: Date.now(),
            size:
              asked === null
                ? LARGE.size
                : size({ level: asked, computed: 'L', overridden: true, weight: 2.1 }),
          };
        }
        return current;
      },
    });
    try {
      await forecast(h);
      const select = h.page.locator('.fc-override-select');
      assert.equal(await valueOf(select), 'computed', 'starts on the computed size');

      await pick(select, 'XS');
      await until(() => h.calls.some((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3'));
      const set = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3');
      assert.deepEqual(set?.body, { size: 'XS' });

      // The control follows the task as the server now holds it, then goes back.
      await until(async () => (await valueOf(select)) === 'XS');
      await pick(select, 'computed');
      await until(() => h.calls.filter((c) => c.method === 'PATCH').length === 2);
      const cleared = h.calls.filter((c) => c.method === 'PATCH')[1];
      assert.deepEqual(cleared?.body, { size: null });
    } finally {
      await h.close();
    }
  });

  void test('gives a viewer no control, and still the figures', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub('viewer'));
    try {
      await forecast(h);
      // Positive control: the section is there.
      assert.equal(await h.page.locator('.fc-range').innerText(), '1.0–2.5 h');
      assert.equal(await h.page.locator('.fc-override-select').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('fits a phone, light and dark, without scrolling sideways', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      for (const theme of ['light', 'dark']) {
        // The theme switch is the board's chrome, under the panel's scrim once
        // a task is open: set it on the board, then open the task on a phone.
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await h.page.goto(`${h.origin}/board?project=laika-core`);
        await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 390, height: 844 });
        await h.page.goto(`${h.origin}/board?project=laika-core&task=t3`);
        await forecast(h);
        // The theme survived the navigation, so this really measures `theme`.
        const light = await h.page.evaluate(
          () => document.documentElement.getAttribute('data-theme') === 'light',
        );
        assert.equal(light, theme === 'light', `${theme}: the page is not in that theme`);
        const overflow = await h.page
          .locator('.fc')
          .evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(overflow <= 1, `${theme}: the section scrolls sideways by ${String(overflow)}px`);
        // The chip's text and background differ in both themes.
        const chip = await h.page.locator('.fc-size .size-chip').evaluate((el) => {
          const s = getComputedStyle(el);
          return { color: s.color, background: s.backgroundColor };
        });
        assert.notEqual(chip.color, chip.background, `${theme}: the chip is unreadable`);
      }
    } finally {
      await h.close();
    }
  });
});
