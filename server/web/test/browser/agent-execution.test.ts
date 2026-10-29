/**
 * An agent's work on the board (LAI-543, server LAI-541): *Waiting for agent*
 * on a card and in the drawer, and the drawer's execution panel — the agent
 * picked beside the one that took the work, and an expired claim in words.
 *
 * Every state comes from a field the server serves: `selected_agent` and the
 * status on the task view, and the claim rows in its activity, in the shapes
 * `services/tasks.ts` and `services/claims.ts` write them
 * (`execution-derive.test.ts` reads those files to keep the shapes honest).
 *
 * **Working and Connection lost** come from the live claim every task read
 * carries since LAI-568 (LAI-597): `t4` is held by a session checking in, `t5`
 * by one the server already served `suspect`. Heartbeats write no activity, so
 * the flip from one to the other is the reader's clock — asserted with
 * Playwright's, and with no request. A task with no live claim still draws
 * neither.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  asServed,
  closeBrowser,
  fakeStream,
  open,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';

const HOUR = 3_600_000;
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
  agents_allowed: true,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const ADA = { id: 'u1', name: 'Ada Lovelace' };

/** `SelectedAgentView`, as the task view carries it. */
const LAPTOP = {
  id: 'ag-laptop',
  display_name: 'Laptop agent',
  harness: 'claude-code',
  device_label: 'laptop-1',
  status: 'active',
  owner: ADA,
};

/** The reader's agents, as `GET /agents` answers them. */
const AGENTS = [
  {
    id: 'ag-laptop',
    owner_user_id: 'u1',
    display_name: 'Laptop agent',
    harness: 'claude-code',
    device_label: 'laptop-1',
    status: 'active',
    grants: [{ project_id: 'laika-core', scope: 'full' }],
    tokens: [],
    created_at: 1,
    revoked_at: null,
    last_seen_at: NOW - 60_000,
  },
];

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
    started_at: null,
    completed_at: null,
    created_at: NOW - 5 * HOUR,
    updated_at: NOW - HOUR,
    size: null,
    selected_agent: null,
    ...over,
  });

let seq = 100;

/** An activity row as `EventView` sends it. */
function event(over: Record<string, unknown>) {
  seq += 1;
  return {
    id: `e${String(seq)}`,
    seq,
    type: 'task.updated',
    project_id: 'laika-core',
    task_id: 't2',
    actor_id: 'u1',
    actor_kind: 'agent',
    actor_token_id: 'tok-1',
    agent_id: 'ag-laptop',
    payload: {},
    created_at: NOW - HOUR,
    ...over,
  };
}

/** `services/tasks.ts`: an agent's session claims a task not yet started. */
const claimTaken = (generation: number, at: number) =>
  event({
    type: 'task.status_changed',
    payload: {
      from: 'todo',
      to: 'in_progress',
      from_status_id: 'st-todo',
      to_status_id: 'st-progress',
      // No `assignee_id`: a claim does not assign (LAI-541 round 2).
      via: 'claim',
      claim_generation: generation,
    },
    created_at: at,
  });

/** `services/claims.ts`: the expiry scan, as the system. */
const claimExpired = (generation: number, at: number) =>
  event({
    type: 'task.claim_expired',
    actor_id: null,
    actor_kind: 'system',
    actor_token_id: null,
    agent_id: null,
    payload: {
      generation,
      session_id: '01SESSIONLAPTOP',
      agent_id: 'ag-laptop',
      lease_expires_at: at - 1,
    },
    created_at: at,
  });

interface World {
  readonly stub: ApiStub;
  readonly tasks: Record<string, unknown>[];
  /** The subject task's rows, newest first, as the feed serves them. */
  readonly activity: Record<string, unknown>[];
}

/** `TaskLiveClaimView`, as `services/claims.ts` serves it; the heartbeat is now. */
const SUSPECT_AFTER_MS = 90_000;
const liveClaim = (over: Record<string, unknown> = {}) => {
  const beat = Date.now();
  return {
    generation: 4,
    state: 'active',
    agent_id: 'ag-laptop',
    session_id: '01SESSIONBELKA',
    lease_expires_at: beat + 300_000,
    last_heartbeat_at: beat,
    heartbeat_age_ms: 0,
    connection: 'live',
    suspect_after_ms: SUSPECT_AFTER_MS,
    device_label: 'Belka',
    ...over,
  };
};

/**
 * Five tasks: `t1` picked for an agent and not started; `t2` taken by that
 * agent's session (in progress, a claim on record, no live claim served); `t3`
 * with no agent; `t4` held by a live session; `t5` by one served `suspect`.
 * Activity is `t2`'s alone, so the drawer's claim rows are its own.
 */
function world(): World {
  const waiting = task({
    id: 't1',
    key: 'LC-1',
    number: 1,
    title: 'Picked for the laptop agent',
    selected_agent: LAPTOP,
  });
  const taken = task({
    id: 't2',
    key: 'LC-2',
    number: 2,
    title: 'Taken by the laptop agent',
    status: 'in_progress',
    selected_agent: LAPTOP,
    started_at: NOW - 2 * HOUR,
  });
  const plain = task({ id: 't3', key: 'LC-3', number: 3, title: 'Nobody’s agent' });
  const working = task({
    id: 't4',
    key: 'LC-4',
    number: 4,
    title: 'Held by a session checking in',
    status: 'in_progress',
    selected_agent: LAPTOP,
    started_at: NOW - HOUR,
    claim: liveClaim(),
  });
  const quiet = task({
    id: 't5',
    key: 'LC-5',
    number: 5,
    title: 'Held by a session gone quiet',
    status: 'in_progress',
    selected_agent: LAPTOP,
    started_at: NOW - HOUR,
    claim: liveClaim({
      session_id: '01SESSIONQUIET',
      last_heartbeat_at: Date.now() - 4 * 60_000,
      heartbeat_age_ms: 4 * 60_000,
      connection: 'suspect',
    }),
  });
  const tasks = [waiting, taken, plain, working, quiet];
  const activity: Record<string, unknown>[] = [claimTaken(3, NOW - 2 * HOUR)];

  const perTask = (t: Record<string, unknown>) => {
    const id = String(t.id);
    return {
      [`/api/v1/tasks/${id}`]: t,
      [`/api/v1/tasks/${id}/comments`]: { data: [], next_cursor: null },
      [`/api/v1/tasks/${id}/watchers`]: { watchers: [] },
      [`/api/v1/tasks/${id}/usage`]: {
        task_id: id,
        key: t.key,
        tz: 'UTC',
        first_day: null,
        last_day: null,
        totals: {
          tokens: 0,
          input: 0,
          output: 0,
          cache_write: 0,
          cache_read: 0,
          cost: { usd: 0, unpriced_tokens: 0, unpriced_models: [], unconfirmed_models: [] },
        },
        people: 'everyone',
        by_person: [],
        by_round: [],
        attributed: null,
        budget: null,
        runaway: null,
      },
      [`/api/v1/projects/laika-core/tasks?parent=${id}&limit=200`]: {
        data: [],
        next_cursor: null,
      },
    };
  };

  const stub: ApiStub = {
    '/api/v1/me': {
      id: 'u1',
      email: 'me@example.com',
      name: 'Ada Lovelace',
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 2, in_progress: 1, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': () => ({ data: tasks, next_cursor: null }),
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    // Per task, as the drawer asks (`task_id`): only `t2` has claim rows. The
    // stream's unfiltered history read is refused, which it shrugs off.
    '/api/v1/projects/laika-core/activity?task_id=t2': () => ({
      data: activity,
      next_cursor: null,
    }),
    '/api/v1/projects/laika-core/activity?task_id=t1': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity?task_id=t3': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity?task_id=t4': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity?task_id=t5': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/estimates/accuracy': {
      project_id: 'laika-core',
      finished: 0,
      forecasts_after: 10,
      live: null,
      backtest: null,
      by_client: [],
      model_version: 'abc123',
    },
    '/api/v1/agents': { data: AGENTS, next_cursor: null },
    ...perTask(waiting),
    ...perTask(taken),
    ...perTask(plain),
    ...perTask(working),
    ...perTask(quiet),
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
  return { stub, tasks, activity };
}

void after(async () => {
  await closeBrowser();
});

const card = (page: Page, id: string) => page.locator(`article.card[data-task-id="${id}"]`);

async function boardReady(h: Harness): Promise<void> {
  await card(h.page, 't3').waitFor({ timeout: 20_000 });
}

async function panel(h: Harness) {
  const found = h.page.locator('.drawer [data-exec-panel]');
  await found.waitFor({ timeout: 20_000 });
  return found;
}

async function emit(page: Page, type: string, body: unknown, id: string): Promise<void> {
  await until(
    async () =>
      (await page.evaluate(() =>
        (window as unknown as { __laikaStream: { count: () => number } }).__laikaStream.count(),
      )) > 0,
  );
  await page.evaluate(
    ({ type: t, body: b, id: i }) => {
      (
        window as unknown as {
          __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
        }
      ).__laikaStream.emit(t, b, i);
    },
    { type, body, id },
  );
}

void describe('cards', () => {
  void test('a task picked for an agent and not started says Waiting for agent, in words and a shape', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub);
    try {
      await boardReady(h);
      const line = card(h.page, 't1').locator('[data-exec-state]');
      await line.waitFor({ timeout: 10_000 });
      assert.equal(await line.getAttribute('data-exec-state'), 'waiting_for_agent');
      assert.equal((await line.innerText()).trim(), 'Waiting for agent');
      // A shape beside the words, never a colour alone.
      assert.equal(await line.locator('svg[data-shape="waiting_for_agent"]').count(), 1);
      assert.equal(await line.locator('svg').getAttribute('aria-hidden'), 'true');

      // Started, and no agent: no state line at all.
      assert.equal(await card(h.page, 't2').locator('[data-exec-state]').count(), 0);
      assert.equal(await card(h.page, 't3').locator('[data-exec-state]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the line rides the Agent card field: hidden with the chip', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub, {
      // The reader's own layout, stored as the board stores it.
      before: async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem(
            'laika.board-view',
            JSON.stringify({ 'laika-core': { fields: { agent: false } } }),
          );
        });
      },
    });
    try {
      await boardReady(h);
      // Positive control first: the card is there with its title.
      assert.match(await card(h.page, 't1').innerText(), /Picked for the laptop agent/);
      assert.equal(await card(h.page, 't1').locator('.agent-chip').count(), 0);
      assert.equal(await card(h.page, 't1').locator('[data-exec-state]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the drawer', () => {
  void test('waiting: the Agent row says it; there is no claim panel yet', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const row = h.page.locator('.meta-row-agent');
      await row.waitFor({ timeout: 20_000 });
      await until(async () => (await row.innerText()).includes('Waiting for agent'));
      assert.match(
        await row.innerText(),
        /Waiting for agent · Ada Lovelace’s Claude Code · laptop-1/,
      );
      assert.equal(await h.page.locator('.drawer [data-exec-panel]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a claim on record: intended agent beside the one that took it; generation under Details', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const found = await panel(h);
      const text = await found.innerText();
      assert.match(text, /Intended agent\s*Claude Code · laptop-1/);
      assert.match(text, /Last claim\s*Claude Code · laptop-1\s*took it/);
      // In progress: the Agent row no longer says Waiting, and nothing says Working.
      assert.doesNotMatch(await h.page.locator('.drawer').innerText(), /Waiting for agent/);
      assert.doesNotMatch(text, /\bWorking\b|Connection lost/);
      // Not served yet, so not drawn — never "Never" or "No session".
      assert.doesNotMatch(text, /Working session|Last seen|No session holds/);
      assert.equal(await found.locator('[data-claim-expired]').count(), 0);

      const details = found.locator('[data-exec-details]');
      const toggle = details.getByRole('button', { name: 'Details' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.match(await details.innerText(), /Claim generation\s*3/);
    } finally {
      await h.close();
    }
  });

  void test('an expired claim says so, and that nothing was restored', async () => {
    const { stub, activity } = world();
    activity.unshift(claimExpired(3, NOW - HOUR));
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const found = await panel(h);
      const notice = found.locator('[data-claim-expired]');
      await notice.waitFor({ timeout: 10_000 });
      assert.equal(await notice.getAttribute('role'), 'status');
      assert.match(
        await notice.innerText(),
        /Claim expired\s*The agent must reclaim explicitly; nothing was restored automatically\./,
      );
      assert.equal(await notice.locator('svg[data-shape="claim_expired"]').count(), 1);
      assert.match(
        await found.innerText(),
        /Last claim\s*Claude Code · laptop-1\s*its claim expired/,
      );

      // The history row is worded too — the client mirror of the verb.
      const history = h.page.locator('.drawer').getByRole('tab', { name: /History/ });
      await history.click();
      await until(async () =>
        (await h.page.locator('.drawer').innerText()).includes('expired an agent’s claim'),
      );
      assert.match(
        await h.page.locator('.drawer').innerText(),
        /expired an agent’s claim — the agent must reclaim explicitly; nothing was restored automatically/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a claim that lapses while the drawer is open shows live, and the focus stays where it was', async () => {
    const { stub, activity } = world();
    const h = await open('/board?project=laika-core&task=t2', stub, { before: fakeStream });
    try {
      const found = await panel(h);
      assert.equal(await found.locator('[data-claim-expired]').count(), 0);

      // The reader is on the Details toggle when the claim lapses.
      const summary = found.locator('.exec-details-toggle');
      await summary.focus();
      assert.equal(await summary.evaluate((el) => el === document.activeElement), true);

      const reads = () =>
        h.calls.filter(
          (c) => c.method === 'GET' && c.path === '/api/v1/projects/laika-core/activity',
        ).length;
      const before = reads();

      const lapsed = claimExpired(3, Date.now());
      activity.unshift(lapsed);
      await emit(h.page, 'task.claim_expired', lapsed, String(lapsed.seq));

      const notice = h.page.locator('.drawer [data-claim-expired]');
      await until(async () => (await notice.count()) > 0, 10_000);
      assert.equal(await notice.count(), 1, 'the lapsed claim never reached the drawer');
      assert.ok(reads() > before, 'the drawer did not re-read its activity');
      assert.equal(
        await h.page
          .locator('.drawer .exec-details-toggle')
          .evaluate((el) => el === document.activeElement),
        true,
        'the live update moved the focus',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, a phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the card line and the expired notice are legible at 390 px with no sideways scroll`, async () => {
      const { stub, activity } = world();
      activity.unshift(claimExpired(3, NOW - HOUR));
      const h = await open('/board?project=laika-core', stub);
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await boardReady(h);
        await setTheme(h.page, theme);

        const line = card(h.page, 't1').locator('[data-exec-state]');
        await line.waitFor({ timeout: 10_000 });
        const ink = await line.evaluate((el) => {
          const label = el.querySelector('.exec-state-label');
          return label === null ? '' : getComputedStyle(label).color;
        });
        const ground = await card(h.page, 't1').evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        );
        assert.notEqual(ink, ground, 'the words are the colour of the card');
        assert.equal(
          await h.page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
          true,
          'the board scrolls sideways at 390 px',
        );

        await card(h.page, 't2').locator('.card-open').click();
        const notice = h.page.locator('.drawer [data-claim-expired]');
        await notice.waitFor({ timeout: 20_000 });
        const box = await notice.boundingBox();
        assert.ok(box !== null && box.width <= 390, `the notice is ${String(box?.width)} px wide`);
      } finally {
        await h.close();
      }
    });
  }
});

/** Task reads after the board drew: the list and each task, by GET. */
const taskReads = (h: Harness) =>
  h.calls.filter(
    (c) =>
      c.method === 'GET' &&
      (c.path === '/api/v1/projects/laika-core/tasks' || c.path.startsWith('/api/v1/tasks/')),
  ).length;

void describe('the live claim (LAI-597)', () => {
  void test('cards say Working and Connection lost, in words and a shape, naming the agent and its device', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub);
    try {
      await boardReady(h);
      const working = card(h.page, 't4').locator('[data-exec-state]');
      await working.waitFor({ timeout: 10_000 });
      assert.equal(await working.getAttribute('data-exec-state'), 'working');
      assert.equal((await working.innerText()).trim(), 'Working · Claude Code · Belka');
      assert.equal(await working.locator('svg[data-shape="working"]').count(), 1);

      const quiet = card(h.page, 't5').locator('[data-exec-state]');
      assert.equal(await quiet.getAttribute('data-exec-state'), 'connection_lost');
      assert.equal((await quiet.innerText()).trim(), 'Connection lost · Claude Code · Belka');
      assert.equal(await quiet.locator('svg[data-shape="connection_lost"]').count(), 1);

      // No live claim: what LAI-543 drew, unchanged.
      assert.equal(await card(h.page, 't2').locator('[data-exec-state]').count(), 0);
      assert.equal(
        await card(h.page, 't1').locator('[data-exec-state]').getAttribute('data-exec-state'),
        'waiting_for_agent',
      );
    } finally {
      await h.close();
    }
  });

  void test('a card held open past suspect_after_ms goes from Working to Connection lost with no request', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub, {
      before: async (page) => {
        await page.clock.install();
      },
    });
    try {
      await boardReady(h);
      const line = card(h.page, 't4').locator('[data-exec-state]');
      await line.waitFor({ timeout: 10_000 });
      assert.equal(await line.getAttribute('data-exec-state'), 'working');
      const before = taskReads(h);

      // Just short of the boundary: still Working.
      await h.page.clock.fastForward(SUSPECT_AFTER_MS - 5_000);
      assert.equal(await line.getAttribute('data-exec-state'), 'working');

      await h.page.clock.fastForward(10_000);
      await until(async () => (await line.getAttribute('data-exec-state')) === 'connection_lost');
      assert.equal(await line.getAttribute('data-exec-state'), 'connection_lost');
      assert.match(await line.innerText(), /Connection lost · Claude Code · Belka/);
      assert.equal(taskReads(h), before, 'the flip re-read a task');
    } finally {
      await h.close();
    }
  });

  /*
   * LAI-597 review: the browser's clock is never compared with the server's.
   * The served claim is fresh by the server (`heartbeat_age_ms: 0`), and this
   * browser's clock is five minutes off either way. Both must say Working, and
   * turn only after `suspect_after_ms` has really elapsed on the page.
   */
  for (const [skew, words] of [
    [5 * 60_000, 'five minutes ahead'],
    [-5 * 60_000, 'five minutes behind'],
  ] as const) {
    void test(`a browser ${words}: a fresh claim is Working, and turns only after suspect_after_ms here`, async () => {
      const { stub } = world();
      const h = await open('/board?project=laika-core', stub, {
        before: async (page) => {
          await page.clock.install({ time: Date.now() + skew });
        },
      });
      try {
        await boardReady(h);
        const line = card(h.page, 't4').locator('[data-exec-state]');
        await line.waitFor({ timeout: 10_000 });
        assert.equal(await line.getAttribute('data-exec-state'), 'working');

        await h.page.clock.fastForward(SUSPECT_AFTER_MS - 5_000);
        assert.equal(await line.getAttribute('data-exec-state'), 'working');

        await h.page.clock.fastForward(10_000);
        await until(async () => (await line.getAttribute('data-exec-state')) === 'connection_lost');
        assert.equal(await line.getAttribute('data-exec-state'), 'connection_lost');
      } finally {
        await h.close();
      }
    });
  }

  /*
   * LAI-597 review, round 2: the claim's age runs from its response's
   * arrival, not from the first time a card draws it. With the Agent field
   * hidden the card draws no state at all; shown 95 s later it must already
   * say Connection lost — and from the one read the board made, not a new one.
   */
  void test('a card whose Agent field was hidden for 95 s says Connection lost the moment it is shown', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub, {
      before: async (page) => {
        await page.clock.install();
        await page.addInitScript(() => {
          localStorage.setItem(
            'laika.board-view',
            JSON.stringify({ 'laika-core': { fields: { agent: false } } }),
          );
        });
      },
    });
    try {
      await boardReady(h);
      assert.match(await card(h.page, 't4').innerText(), /Held by a session checking in/);
      assert.equal(await card(h.page, 't4').locator('[data-exec-state]').count(), 0);
      const before = taskReads(h);

      await h.page.clock.fastForward(95_000);

      await h.page.locator('.bt-icon[title="View settings"]').click();
      await h.page.waitForSelector('.view-settings');
      await h.page.locator('.vs-search').fill('Agent');
      await h.page.locator('.vs-add').first().click();

      const line = card(h.page, 't4').locator('[data-exec-state]');
      await line.waitFor({ timeout: 10_000 });
      assert.equal(await line.getAttribute('data-exec-state'), 'connection_lost');
      assert.equal(taskReads(h), before, 'showing the field re-read the tasks');
    } finally {
      await h.close();
    }
  });

  void test('the drawer shows the holding session and its last heartbeat, and flips live without moving the focus', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t4', stub, {
      before: async (page) => {
        await page.clock.install();
      },
    });
    try {
      const found = await panel(h);
      const text = await found.innerText();
      assert.match(text, /Working\s*An agent session holds the task and is checking in\./);
      assert.match(text, /Working session\s*Claude Code · Belka/);
      assert.match(text, /Last seen\s*just now/);
      const seen = found.locator('[data-last-seen] time');
      assert.ok((await seen.getAttribute('datetime')) !== null);

      const details = found.locator('[data-exec-details]');
      const toggle = details.getByRole('button', { name: 'Details' });
      await toggle.click();
      assert.match(await details.innerText(), /Claim generation\s*4/);
      assert.match(await details.innerText(), /Working session\s*01SESSIONBELKA/);

      // The reader is on the Details toggle when the session goes quiet.
      await toggle.focus();
      const before = taskReads(h);
      await h.page.clock.fastForward(SUSPECT_AFTER_MS + 5_000);
      const state = found.locator('[data-exec-state]');
      await until(async () => (await state.getAttribute('data-exec-state')) === 'connection_lost');
      assert.equal(await state.getAttribute('role'), 'status');
      assert.match(await found.innerText(), /Connection lost\s*The agent stopped checking in/);
      assert.match(await found.innerText(), /Last seen\s*1 min ago/);
      assert.equal(taskReads(h), before, 'the flip re-read the task');
      assert.equal(
        await toggle.evaluate((el) => el === document.activeElement),
        true,
        'the live update moved the focus',
      );
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('the working session’s line says what ran; its version and model wait under Details (LAI-593)', async () => {
    const { stub, tasks } = world();
    const held = tasks.find((t) => t.id === 't4')!;
    held.claim = {
      ...(held.claim as Record<string, unknown>),
      harness: 'codex',
      harness_version: '0.9.1',
      model: 'gpt-5.5',
    };
    const h = await open('/board?project=laika-core&task=t4', stub);
    try {
      const found = await panel(h);
      const line = found.locator('[data-session-line]');
      await line.waitFor({ timeout: 10_000 });
      assert.equal((await line.innerText()).trim(), 'Claude Code · Belka · Codex · gpt-5.5');
      // The chip still names the agent; the line is beneath it, not instead.
      assert.match(
        await found.locator('[data-working-session]').innerText(),
        /^Claude Code · Belka\s+Claude Code · Belka · Codex · gpt-5\.5$/,
      );
      // The card stays the agent alone (D-118): no session words on it.
      assert.doesNotMatch(await card(h.page, 't4').innerText(), /gpt-5\.5|Codex/);

      const details = found.locator('[data-exec-details]');
      await details.getByRole('button', { name: 'Details' }).click();
      const text = await details.innerText();
      assert.match(text, /Working session harness version\s*0\.9\.1/);
      assert.match(text, /Working session model\s*gpt-5\.5/);
      assert.match(text, /self-reported by the session; they decide nothing/);
    } finally {
      await h.close();
    }
  });

  void test('a session that reported nothing draws no line — the chip alone', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t4', stub);
    try {
      const found = await panel(h);
      assert.match(await found.innerText(), /Working session\s*Claude Code · Belka/);
      assert.equal(await found.locator('[data-session-line]').count(), 0);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390] as const) {
      void test(`${theme}, ${String(width)} px: Working and Connection lost are legible, with no sideways scroll`, async () => {
        const { stub } = world();
        const h = await open('/board?project=laika-core', stub);
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await boardReady(h);
          await setTheme(h.page, theme);
          for (const id of ['t4', 't5']) {
            const line = card(h.page, id).locator('[data-exec-state]');
            await line.waitFor({ timeout: 10_000 });
            const [ink, ground] = await Promise.all([
              line.evaluate((el) => {
                const label = el.querySelector('.exec-state-label');
                return label === null ? '' : getComputedStyle(label).color;
              }),
              card(h.page, id).evaluate((el) => getComputedStyle(el).backgroundColor),
            ]);
            assert.notEqual(ink, ground, `${id}: the words are the colour of the card`);
            const box = await line.boundingBox();
            const cardBox = await card(h.page, id).boundingBox();
            assert.ok(
              box !== null &&
                cardBox !== null &&
                box.x + box.width <= cardBox.x + cardBox.width + 1,
              `${id}: the line overflows its card`,
            );
          }
          assert.equal(
            await h.page.evaluate(
              () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
            true,
            `the board scrolls sideways at ${String(width)} px`,
          );
        } finally {
          await h.close();
        }
      });
    }
  }
});

void describe('without a live claim', () => {
  void test('a task the read serves no claim for says neither Working nor Connection lost, and no demo hand-off survives', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const found = await panel(h);
      assert.doesNotMatch(await found.innerText(), /\bWorking\b|Connection lost|Last seen/);
      for (const id of ['t1', 't2', 't3']) {
        const states = await card(h.page, id)
          .locator('[data-exec-state]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-exec-state')));
        assert.ok(
          states.every((s) => s === 'waiting_for_agent'),
          `${id} drew ${JSON.stringify(states)}`,
        );
      }
      const page = await h.page.locator('body').innerText();
      assert.doesNotMatch(page, /Hand to my agent|claim lock until/i);
    } finally {
      await h.close();
    }
  });
});
