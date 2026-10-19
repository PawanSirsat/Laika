/**
 * Effort on screen (D-085, LAI-771; called effort and said plainly since
 * LAI-785): the chip on a card, the List's sortable Effort column — still
 * `sort=size` in the URL — and the task panel's Effort section: one headline,
 * one comparison line once there is an actual, where the time went, the
 * token estimate only when there is one, and *Why Large?* folded, in
 * sentences with arrows, with the similar tasks as links and the project's
 * accuracy in words. The *Change* control is for readers who may edit the
 * task. Nothing empty is drawn: no `—`, no *Early*.
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
import { optionsOf, pick, valueOf } from './dropdown.ts';

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
  claim_estimate: { level: 'S', confidence: 'yellow' },
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

/** The section, once its own read has drawn the folded *why*. */
async function effort(h: Harness) {
  const section = h.page.locator('[data-section="effort"]');
  await section.waitFor({ timeout: 20_000 });
  await until(async () => (await section.locator('.fc-factor').count()) > 0);
  return section;
}

/** Open *Why …?* the way a person does, and wait until it is drawn. */
async function openWhy(section: ReturnType<Harness['page']['locator']>) {
  const why = section.locator('details.fc-why');
  assert.equal(await why.getAttribute('open'), null, 'the why is not folded to begin with');
  await why.locator('summary').click();
  await until(async () => (await why.getAttribute('open')) !== null);
  return why;
}

/** What a reader sees: no dash for nothing, no *Early*, none of the old tiles. */
function assertNothingEmpty(text: string) {
  assert.doesNotMatch(text, /—|Early|early/, text);
  assert.doesNotMatch(text, /Build time|At start|Review wait|Actual build|Actual tokens/, text);
  assert.doesNotMatch(text, /p80|Typically off|\bSize\b/, text);
}

void describe('the effort chip on a card', () => {
  void test('draws each task’s effort, marks one a person set, and draws nothing for none', async () => {
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
        'no mark for a person’s effort',
      );
      assert.equal(
        await chip('LC-2').getAttribute('title'),
        'Effort: Extra large, set by a person · Laika’s estimate: Medium · about 25 to 50 min',
      );
      assert.equal(
        await chip('LC-1').getAttribute('title'),
        'Effort: Extra small · about 10 to 20 min',
      );
      assert.equal(await chip('LC-1').locator('.size-chip-dot').count(), 0);
      // Positive control above; the absence is the card with no effort yet.
      assert.equal(await chip('LC-4').count(), 0, 'a card with no effort drew a chip');
    } finally {
      await h.close();
    }
  });
});

void describe('the List’s Effort column', () => {
  void test('is called Effort, shows each level and sorts by it, unsized tasks last either way', async () => {
    const h = await open('/list?project=laika-core', stub());
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      const keys = async () => h.page.locator('.list-row .list-key').allInnerTexts();
      const header = h.page.locator('button.list-sort[title="Sort by Effort"]');
      // `textContent`: the header is upper-cased by CSS, and the word is what counts.
      assert.equal((await header.textContent())?.trim(), 'Effort');
      assert.equal(await h.page.locator('button.list-sort[title="Sort by Size"]').count(), 0);
      // The longer word fits its column at a laptop's width: it once read `EFFOR`.
      await h.page.setViewportSize({ width: 1366, height: 900 });
      const clipped = await header.evaluate((el) => {
        const cell = el.closest('th');
        if (cell === null) return 'no header cell';
        const label = el.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        return label.right <= box.right + 0.5 && el.scrollWidth <= el.clientWidth + 0.5
          ? null
          : `label ${String(label.right)} past cell ${String(box.right)}`;
      });
      assert.equal(clipped, null, 'the Effort header is cut off');

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
      // The URL keeps the API's name, so an address from before still works.
      assert.match(h.page.url(), /sort=size/);

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

  void test('an old `sort=size` address still sorts by effort', async () => {
    const h = await open('/list?project=laika-core&sort=size&dir=desc', stub());
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      const keys = async () => h.page.locator('.list-row .list-key').allInnerTexts();
      await until(async () => (await keys())[0]?.startsWith('LC-2') === true);
      assert.deepEqual(
        (await keys()).map((k) => k.slice(0, 4)),
        ['LC-2', 'LC-3', 'LC-5', 'LC-1', 'LC-4'],
      );
      const header = h.page.locator('button.list-sort[title="Sort by Effort"]');
      assert.equal(
        await h.page.locator('th', { has: header }).getAttribute('aria-sort'),
        'descending',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the task panel’s Effort section', () => {
  void test('one headline, one comparison line, where the time went, and the why folded', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub());
    try {
      const section = await effort(h);
      assert.equal(await section.getAttribute('aria-label'), 'Effort');
      assert.equal((await section.locator('.panel-section-title').textContent())?.trim(), 'Effort');

      assert.equal(await section.locator('.fc-effort').innerText(), 'Large');
      assert.equal(await section.locator('.fc-time').innerText(), 'about 1 to 2.5 h');
      // Twelve measured, typically within 2×: not rough.
      assert.equal(await section.locator('.fc-rough').count(), 0);
      assert.equal(
        await section.locator('.fc-compare').innerText(),
        'Estimated at start 20–45 min · took 1.5 h · well over',
      );
      assert.equal(await section.locator('.fc-compare').getAttribute('data-verdict'), 'well over');
      assert.doesNotMatch(await section.innerText(), /on average/);
      assert.equal(
        await section.locator('.fc-timeline').innerText(),
        'Building 1.5 h · waiting for review 2.0 h · rework 30 min',
      );
      // No token estimate: no line at all.
      assert.equal(await section.locator('.fc-tokens').count(), 0);
      assertNothingEmpty(await section.innerText());

      const why = await openWhy(section);
      assert.equal((await why.locator('summary').innerText()).trim(), 'Why Large?');
      const rows = await why
        .locator('.fc-factor')
        .evaluateAll((els) =>
          els.map(
            (el) =>
              `${el.getAttribute('data-arrow') ?? ''} ${el.querySelector('.fc-label')?.textContent ?? ''}`,
          ),
        );
      assert.deepEqual(rows, [
        '↑ Longer description than most tasks here (640 words; most have about 220)',
        '↓ Tagged “docs”: tasks with that tag are quicker here',
        '↑ 7 similar finished tasks took about 1.2 h',
      ]);
      assert.deepEqual(await why.locator('.fc-similar-link').allInnerTexts(), ['LC-1', 'LC-2']);
      assert.equal(
        await why.locator('.fc-typical').innerText(),
        'A typical task here has about 220 words and takes about 35 min.',
      );
      assert.equal(
        await why.locator('.fc-accuracy').innerText(),
        'Estimates here are typically off by about 1.7× (12 tasks so far). 9 of them took no longer than the estimate.',
      );
      const opened = await section.innerText();
      assertNothingEmpty(opened);
      assert.doesNotMatch(opened, /[+−]\d\.\d/, 'a signed weight is still drawn');
      // Nothing in the section names a person.
      assert.doesNotMatch(opened, /Ada/);
    } finally {
      await h.close();
    }
  });

  void test('the token estimate is one line, beside what was used (LAI-772)', async () => {
    const h = await open('/board?project=laika-core&task=t3', {
      ...stub(),
      '/api/v1/tasks/t3/estimate': PHASE2,
    });
    try {
      const section = await effort(h);
      await until(async () => (await section.locator('.fc-tokens').count()) > 0);
      assert.equal(
        await section.locator('.fc-tokens').innerText(),
        'Tokens: estimated 900K–2.1M · used 1.4M',
      );
      assert.deepEqual(await section.locator('.fc-note').allInnerTexts(), [
        'It grew after work started: Medium then, Large now.',
      ]);
      const why = await openWhy(section);
      assert.equal(
        await why.locator('.fc-claim').innerText(),
        'At claim: estimated Small, somewhat unsure it would land as asked.',
      );
      assert.equal(
        await why.locator('.fc-accuracy-tokens').innerText(),
        'Tried on 4 past tasks here, token estimates are typically off by about 1.9×.',
      );
      assertNothingEmpty(await section.innerText());
      assert.doesNotMatch(await section.innerText(), /Ada/);
    } finally {
      await h.close();
    }
  });

  void test('no token estimate: nothing about tokens but one hint, inside the why', async () => {
    const h = await open('/board?project=laika-core&task=t3', {
      ...stub(),
      '/api/v1/tasks/t3/estimate': {
        ...ESTIMATE,
        tokens: { p50: null, p80: null, learned_from: 3, forecasts_after: 10 },
        split: { xl_finished: 4, rounds_avg: 2.3 },
      },
    });
    try {
      const section = await effort(h);
      await until(async () => (await section.locator('.fc-note').count()) > 0);
      assert.deepEqual(await section.locator('.fc-note').allInnerTexts(), [
        'Consider splitting it: extra large tasks here took 2.3 review rounds on average (4 finished).',
      ]);
      assert.equal(await section.locator('.fc-tokens').count(), 0);
      assert.doesNotMatch(await section.innerText(), /[Tt]oken/, 'tokens before the why opened');
      const why = await openWhy(section);
      assert.equal(
        await why.locator('.fc-token-hint').innerText(),
        'Token estimates start after 10 finished tasks with token data (3 so far).',
      );
      const text = await section.innerText();
      const about = text.split('\n').filter((line) => /token/i.test(line));
      assert.deepEqual(about, [
        'Token estimates start after 10 finished tasks with token data (3 so far).',
      ]);
      assertNothingEmpty(text);
    } finally {
      await h.close();
    }
  });

  void test('says rough estimate when the project is often off, and never × in the headline', async () => {
    const h = await open('/board?project=laika-core&task=t3', {
      ...stub(),
      '/api/v1/projects/laika-core/estimates/accuracy': {
        ...ACCURACY,
        live: { n: 6, typical_error: 2.44, bias: 1.4, p80_hit_rate: 0.5 },
      },
    });
    try {
      const section = await effort(h);
      await until(async () => (await section.locator('.fc-rough').count()) > 0);
      assert.equal(await section.locator('.fc-rough').innerText(), 'rough estimate');
      assert.doesNotMatch(await section.locator('.fc-headline').innerText(), /×|p80|\d%/);
      const why = await openWhy(section);
      assert.equal(
        await why.locator('.fc-accuracy').innerText(),
        'Estimates here are typically off by about 2.4× (6 tasks so far). 3 of them took no longer than the estimate.',
      );
    } finally {
      await h.close();
    }
  });

  void test('opens a similar task from its link', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub());
    try {
      const section = await effort(h);
      const why = await openWhy(section);
      await why.locator('.fc-similar-link', { hasText: 'LC-1' }).click();
      await until(() => h.page.url().includes('task=t1'));
      assert.match(h.page.url(), /task=t1/);
    } finally {
      await h.close();
    }
  });

  void test('with too little history: the effort, and what the time waits for, once', async () => {
    const h = await open('/board?project=laika-core&task=t5', {
      ...stub(),
      '/api/v1/projects/laika-core/estimates/accuracy': {
        ...ACCURACY,
        finished: 3,
        live: { n: 0, typical_error: null, bias: null, p80_hit_rate: null },
        backtest: null,
      },
    });
    try {
      const section = await effort(h);
      assert.equal(await section.locator('.fc-effort').innerText(), 'Medium');
      assert.equal(await section.locator('.fc-time').count(), 0);
      await until(async () => (await section.locator('.fc-wait').innerText()).includes('so far'));
      assert.equal(
        await section.locator('.fc-wait').innerText(),
        'Time estimate after 10 finished tasks (3 so far)',
      );
      assert.equal(
        await section.locator('.fc-rough').count(),
        0,
        'rough, with no time to be rough',
      );
      assert.equal(await section.locator('.fc-compare, .fc-timeline').count(), 0);
      await openWhy(section);
      const text = await section.innerText();
      assert.equal((text.match(/Time estimate after/g) ?? []).length, 1, text);
      assertNothingEmpty(text);
    } finally {
      await h.close();
    }
  });

  void test('Change sets a person’s effort and goes back to Laika’s', async () => {
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
      const section = await effort(h);
      const change = section.locator('.fc-change');
      assert.equal((await change.innerText()).trim(), 'Change');
      assert.equal(await change.getAttribute('aria-label'), 'Change effort');
      assert.equal(await valueOf(change), 'computed', 'starts on Laika’s effort');
      assert.deepEqual((await optionsOf(change)).labels, [
        'Automatic (Large)',
        'Extra small',
        'Small',
        'Medium',
        'Large',
        'Extra large',
      ]);

      await pick(change, 'XS');
      await until(() => h.calls.some((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3'));
      const set = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t3');
      assert.deepEqual(set?.body, { size: 'XS' });

      // The control and the headline follow the task as the server now holds it.
      await until(async () => (await valueOf(change)) === 'XS');
      await until(async () => (await section.locator('.fc-effort').innerText()) === 'Extra small');
      assert.equal(await section.locator('.fc-effort').innerText(), 'Extra small');
      assert.match(await section.locator('.fc-set').innerText(), /Laika’s estimate: Large/);
      assert.equal(
        (await section.locator('details.fc-why summary').innerText()).trim(),
        'Why Laika estimated Large',
      );

      await pick(change, 'computed');
      await until(() => h.calls.filter((c) => c.method === 'PATCH').length === 2);
      const cleared = h.calls.filter((c) => c.method === 'PATCH')[1];
      assert.deepEqual(cleared?.body, { size: null });
    } finally {
      await h.close();
    }
  });

  void test('gives a viewer no Change, and still the estimate', async () => {
    const h = await open('/board?project=laika-core&task=t3', stub('viewer'));
    try {
      const section = await effort(h);
      // Positive control: the section is there.
      assert.equal(await section.locator('.fc-time').innerText(), 'about 1 to 2.5 h');
      assert.equal(await section.locator('.fc-change').count(), 0);
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
        const section = await effort(h);
        await section.locator('details.fc-why summary').click();
        // The theme survived the navigation, so this really measures `theme`.
        const light = await h.page.evaluate(
          () => document.documentElement.getAttribute('data-theme') === 'light',
        );
        assert.equal(light, theme === 'light', `${theme}: the page is not in that theme`);
        const overflow = await section.evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(overflow <= 1, `${theme}: the section scrolls sideways by ${String(overflow)}px`);
        // The headline's word and what it sits on differ in both themes.
        const ink = await section.locator('.fc-effort').evaluate((el) => {
          let bg = 'rgba(0, 0, 0, 0)';
          for (let at: Element | null = el; at !== null; at = at.parentElement) {
            const b = getComputedStyle(at).backgroundColor;
            if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
              bg = b;
              break;
            }
          }
          return { color: getComputedStyle(el).color, background: bg };
        });
        assert.notEqual(ink.color, ink.background, `${theme}: the effort is unreadable`);
      }
    } finally {
      await h.close();
    }
  });
});
