/**
 * The agent line (LAI-587, D-118; server LAI-586): which agent is doing the
 * work in one short line, and what exactly ran one click away.
 *
 * - **Cards** carry the agent alone, `Claude Code · Belka`.
 * - **The drawer and History** add what its session said ran: `Claude Code ·
 *   Belka · Codex · gpt-5.5` — and a row older than the snapshot is the agent
 *   alone, inventing nothing.
 * - **Details** holds the claim generation, session id, when it was claimed and
 *   the harness version, labelled self-reported, behind a button that a
 *   keyboard opens and a screen reader hears.
 * - **D-119's refusal** is said in words naming the agent.
 *
 * Rows are in the shapes `services/events.ts` serves (`agent_session`).
 * With `LAIKA_SHOTS` set, the board and drawer land there light and dark at
 * 1440 and 390 — the PR's evidence.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  asServed,
  closeBrowser,
  open,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { pick } from './dropdown.ts';

const SHOTS = process.env.LAIKA_SHOTS;

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
const BELKA = {
  id: 'ag-laptop',
  display_name: 'Belka agent',
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active',
  owner: ADA,
};

/** The reader's agents, as `GET /agents` answers them. */
const AGENTS = [
  {
    id: 'ag-laptop',
    owner_user_id: 'u1',
    display_name: 'Belka agent',
    harness: 'claude-code',
    device_label: 'Belka',
    status: 'active',
    grants: [{ project_id: 'laika-core', scope: 'full' }],
    tokens: [],
    created_at: 1,
    revoked_at: null,
    last_seen_at: NOW - 60_000,
  },
  {
    id: 'ag-codex',
    owner_user_id: 'u1',
    display_name: 'Codex agent',
    harness: 'codex',
    device_label: 'Belka',
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

/** `ActivitySessionView`: what the claiming session said ran (D-118, LAI-586). */
const SESSION = {
  id: '01SESSIONBELKA',
  harness: 'codex',
  harness_version: '0.47.0',
  model: 'gpt-5.5',
};

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
const claimTaken = (generation: number, at: number, session: unknown = SESSION) =>
  event({
    agent_session: session,
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
    title: 'Picked for the Belka agent',
    selected_agent: BELKA,
  });
  const taken = task({
    id: 't2',
    key: 'LC-2',
    number: 2,
    title: 'Taken by the Belka agent',
    status: 'in_progress',
    selected_agent: BELKA,
    started_at: NOW - 2 * HOUR,
  });
  const plain = task({ id: 't3', key: 'LC-3', number: 3, title: 'Nobody’s agent' });
  const tasks = [waiting, taken, plain];
  const activity: Record<string, unknown>[] = [
    claimTaken(3, NOW - 2 * HOUR),
    // Older than LAI-586: an agent row with no snapshot at all.
    event({
      type: 'task.updated',
      payload: { field: 'title', from: 'Old title', to: 'Taken by the agent' },
      agent_session: null,
      created_at: NOW - 4 * HOUR,
    }),
  ];

  const perTask = (t: Record<string, unknown>) => {
    const id = String(t.id);
    return {
      [`/api/v1/tasks/${id}`]: (call: StubCall) =>
        call.method === 'PATCH' && id === 't1' ? selectionRefused : t,
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

  /** D-119's refusal as `services/claims.ts` answers it, naming the selected agent. */
  const selectionRefused = reply(409, {
    error: {
      code: 'conflict',
      message: 'This task is selected for another agent',
      details: {
        reason: 'selected_for_another_agent',
        selected_agent_id: 'ag-laptop',
        selected_agent: {
          id: 'ag-laptop',
          display_name: 'Belka agent',
          harness: 'claude-code',
          device_label: 'Belka',
        },
      },
    },
  });

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

async function panel(h: Harness) {
  const found = h.page.locator('.drawer [data-exec-panel]');
  await found.waitFor({ timeout: 20_000 });
  return found;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

void describe('cards', () => {
  void test('a card carries the agent alone, in one neutral chip: no session, no model', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub);
    try {
      await card(h.page, 't3').waitFor({ timeout: 20_000 });
      const chip = card(h.page, 't2').locator('.agent-chip');
      await chip.waitFor({ timeout: 10_000 });
      assert.equal(squash(await chip.innerText()), 'Claude Code · Belka');
      // The session's words are the drawer's, not the card's.
      assert.doesNotMatch(await card(h.page, 't2').innerText(), /gpt-5\.5|Codex/);
      // Neutral: the existing chip family, not a colour of its own.
      const [bg, ink] = await chip.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.backgroundColor, style.color];
      });
      const neutral = await h.page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.background = 'var(--chip-neutral-bg)';
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      });
      assert.equal(bg, neutral, 'the chip is not on the neutral chip ground');
      assert.notEqual(ink, bg);
      assert.equal(await card(h.page, 't3').locator('.agent-chip').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the drawer', () => {
  void test('the claim says what ran in one line: agent · session harness · model', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const found = await panel(h);
      const line = found.locator('[data-agent-line]');
      await line.waitFor({ timeout: 10_000 });
      assert.equal(squash(await line.innerText()), 'Claude Code · Belka · Codex · gpt-5.5');
      assert.match(
        squash(await found.innerText()),
        /Ran as Claude Code · Belka · Codex · gpt-5\.5/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a claim row with no snapshot draws the chip alone — no line, nothing invented', async () => {
    const { stub, activity } = world();
    activity.splice(0, activity.length, claimTaken(3, NOW - 2 * HOUR, null));
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const found = await panel(h);
      // Positive control: the panel drew its claim.
      assert.match(squash(await found.innerText()), /Last claim Claude Code · Belka took it/);
      assert.equal(await found.locator('[data-agent-line]').count(), 0);
      assert.doesNotMatch(await found.innerText(), /Ran as|gpt|Codex/);
      await found.getByRole('button', { name: 'Details' }).click();
      const details = squash(await found.locator('[data-exec-details]').innerText());
      assert.match(details, /Claim generation 3/);
      assert.doesNotMatch(details, /Harness version|Model|self-reported|Session/);
    } finally {
      await h.close();
    }
  });

  void test('Details opens and closes from the keyboard, says so, and labels the session self-reported', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const found = await panel(h);
      const toggle = found.getByRole('button', { name: 'Details' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await found.locator('[data-self-reported]').count(), 0);

      await toggle.focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await toggle.getAttribute('aria-expanded')) === 'true');
      const region = h.page.locator(`[id="${(await toggle.getAttribute('aria-controls')) ?? ''}"]`);
      const text = squash(await region.innerText());
      assert.match(text, /Claim generation 3/);
      assert.match(text, /Session 01SESSIONBELKA/);
      assert.match(text, /Claimed \S/);
      assert.match(text, /Harness version 0\.47\.0/);
      assert.match(text, /Model gpt-5\.5/);
      assert.match(text, /self-reported by the session/);
      assert.equal(
        await toggle.evaluate((el) => el === document.activeElement),
        true,
        'opening Details moved the focus',
      );

      await h.page.keyboard.press('Space');
      await until(async () => (await toggle.getAttribute('aria-expanded')) === 'false');
      assert.equal(await region.count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('History: an agent row names what ran; an older row is the agent alone', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      await panel(h);
      const drawer = h.page.locator('.drawer');
      await drawer.getByRole('tab', { name: /History/ }).click();
      const rows = drawer.locator('.panel-event-who');
      await until(async () => (await rows.count()) >= 2);
      const who = (await rows.allInnerTexts()).map(squash);
      assert.ok(
        who.includes('Ada Lovelace via Claude Code · Belka · Codex · gpt-5.5'),
        `rows: ${JSON.stringify(who)}`,
      );
      assert.ok(
        who.includes('Ada Lovelace via Claude Code · Belka'),
        `rows: ${JSON.stringify(who)}`,
      );
      // Text, not colour: the agent row still carries the word.
      assert.ok((await drawer.locator('.panel-event .marker-agent').count()) >= 2);
    } finally {
      await h.close();
    }
  });
});

void describe('D-119', () => {
  void test('a selection refused as selected_for_another_agent names that agent in plain words', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const row = h.page.locator('.meta-row-agent');
      await row.waitFor({ timeout: 20_000 });
      const box = row.getByRole('combobox', { name: 'Agent' });
      await box.waitFor({ timeout: 10_000 });
      await pick(box, 'ag-codex');
      const alert = row.getByRole('alert');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(
        squash(await alert.innerText()),
        'Selected for Claude Code · Belka — only that agent can start it.',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, 1440 and 390', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390] as const) {
      void test(`${theme} ${String(width)}: the line is legible and nothing scrolls sideways`, async () => {
        const { stub } = world();
        const h = await open('/board?project=laika-core&task=t2', stub);
        try {
          await h.page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await setTheme(h.page, theme);
          const found = await panel(h);
          const line = found.locator('[data-agent-line]');
          await line.waitFor({ timeout: 10_000 });
          const [ink, ground] = await line.evaluate((el) => {
            let node: Element | null = el;
            let bg = 'rgba(0, 0, 0, 0)';
            while (node !== null && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
              bg = getComputedStyle(node).backgroundColor;
              node = node.parentElement;
            }
            return [getComputedStyle(el).color, bg];
          });
          assert.notEqual(ink, ground, 'the line is the colour of its ground');
          const box = await line.boundingBox();
          assert.ok(
            box !== null && box.x + box.width <= width,
            `the line ends at ${String(box?.x)}+${String(box?.width)}`,
          );
          assert.equal(
            await h.page.evaluate(
              () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
            true,
            `the page scrolls sideways at ${String(width)} px`,
          );
          await found.getByRole('button', { name: 'Details' }).click();
          await found.locator('[data-self-reported]').waitFor({ timeout: 5_000 });

          if (SHOTS !== undefined) {
            mkdirSync(SHOTS, { recursive: true });
            await found.scrollIntoViewIfNeeded();
            await found.screenshot({ path: join(SHOTS, `drawer-${theme}-${String(width)}.png`) });
            await h.page.screenshot({ path: join(SHOTS, `page-${theme}-${String(width)}.png`) });
            await h.page.goto(`${h.origin}/board?project=laika-core`);
            await card(h.page, 't2').locator('.agent-chip').waitFor({ timeout: 20_000 });
            await card(h.page, 't2').screenshot({
              path: join(SHOTS, `card-${theme}-${String(width)}.png`),
            });
          }
        } finally {
          await h.close();
        }
      });
    }
  }
});
