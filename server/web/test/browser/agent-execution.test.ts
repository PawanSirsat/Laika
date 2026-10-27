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
 * **Working and Connection lost are absent here on purpose.** They need the
 * live claim and its session's heartbeat, which no task read returns yet
 * (LAI-568), so the last block asserts the board never draws them.
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
      assignee_id: 'u1',
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

/**
 * Three tasks: `t1` picked for an agent and not started; `t2` taken by that
 * agent's session (in progress, a claim on record); `t3` with no agent.
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
  const tasks = [waiting, taken, plain];
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

      const details = found.locator('details.exec-details');
      assert.equal(await details.evaluate((el) => (el as HTMLDetailsElement).open), false);
      await details.locator('summary').click();
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
      const summary = found.locator('details.exec-details summary');
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
          .locator('.drawer details.exec-details summary')
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

void describe('what is not served is not drawn', () => {
  void test('no card or drawer says Working or Connection lost, and no demo hand-off survives', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      await panel(h);
      const states = await h.page
        .locator('[data-exec-state]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-exec-state')));
      assert.ok(
        states.every((s) => s === 'waiting_for_agent'),
        `drew ${JSON.stringify(states)}`,
      );
      const page = await h.page.locator('body').innerText();
      assert.doesNotMatch(page, /Connection lost|Hand to my agent|claim lock until/i);
    } finally {
      await h.close();
    }
  });
});
