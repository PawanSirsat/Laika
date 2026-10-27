/**
 * The selected agent on screen (LAI-538, server LAI-535): the drawer's Agent
 * row, the card's chip, the List's column and filter, and who an agent's
 * activity row says acted.
 *
 * The stub answers `PATCH /tasks/:id { selected_agent_id }` the way the server
 * does — the agent's view on the task, a `task.agent_selected` row in the
 * activity, `422` with `details.reason` for an agent it refuses — so a reload
 * reads back what the write left.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  asServed,
  closeBrowser,
  fakeStream,
  open,
  reply,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { offered, pick } from './dropdown.ts';

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

/** The reader's own agents, as `GET /agents` answers them. */
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
  {
    id: 'ag-desktop',
    owner_user_id: 'u1',
    display_name: 'Desktop agent',
    harness: 'codex',
    device_label: 'desktop-2',
    status: 'active',
    grants: [{ project_id: 'laika-core', scope: 'full' }],
    tokens: [],
    created_at: 2,
    revoked_at: null,
    last_seen_at: null,
  },
  {
    id: 'ag-ro',
    owner_user_id: 'u1',
    display_name: 'Reader',
    harness: 'cursor',
    device_label: 'tablet',
    status: 'active',
    grants: [{ project_id: 'laika-core', scope: 'read_only' }],
    tokens: [],
    created_at: 3,
    revoked_at: null,
    last_seen_at: NOW - 60_000,
  },
];

const ADA = { id: 'u1', name: 'Ada Lovelace' };

/** `SelectedAgentView` for one of {@link AGENTS}. */
function viewOf(id: string) {
  const agent = AGENTS.find((a) => a.id === id);
  if (agent === undefined) throw new Error(`no agent ${id}`);
  return {
    id: agent.id,
    display_name: agent.display_name,
    harness: agent.harness,
    device_label: agent.device_label,
    status: agent.status,
    owner: ADA,
  };
}

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
    task_id: 't1',
    actor_id: 'u1',
    actor_kind: 'user',
    actor_token_id: null,
    agent_id: null,
    payload: { changed: ['title'] },
    created_at: NOW - HOUR,
    ...over,
  };
}

interface World {
  readonly stub: ApiStub;
  readonly tasks: Record<string, unknown>[];
  readonly activity: Record<string, unknown>[];
}

function world(options: { readonly role?: 'lead' | 'viewer' } = {}): World {
  const role = options.role ?? 'lead';
  // Assigned to Ada, no agent: selecting one must leave Ada where she is.
  const plain = task({
    id: 't1',
    key: 'LC-1',
    number: 1,
    title: 'Wire the agent field',
    assignee_id: 'u1',
  });
  // Written through an agent (`created_via: mcp`) and meant for one.
  const chosen = task({
    id: 't2',
    key: 'LC-2',
    number: 2,
    title: 'Chip on the card',
    assignee_id: 'u1',
    created_via: 'mcp',
    selected_agent: viewOf('ag-laptop'),
  });
  const other = task({
    id: 't3',
    key: 'LC-3',
    number: 3,
    title: 'Another for Codex',
    selected_agent: viewOf('ag-desktop'),
  });
  const tasks = [plain, chosen, other];

  const activity: Record<string, unknown>[] = [
    // Newest first, as the feed is served.
    event({
      actor_kind: 'agent',
      actor_token_id: 'tok-1',
      agent_id: 'ag-laptop',
      payload: { changed: ['description_md'] },
    }),
    event({ actor_kind: 'agent', actor_token_id: 'tok-legacy', agent_id: null }),
  ];

  const editable = (current: Record<string, unknown>) => (call: StubCall) => {
    if (call.method !== 'PATCH') return current;
    const sent = (call.body as { selected_agent_id?: string | null }).selected_agent_id;
    if (sent === 'ag-ro') {
      return reply(422, {
        error: {
          code: 'unprocessable',
          message: 'That agent may only read in this project; it needs a full grant to do the work',
          details: {
            field: 'selected_agent_id',
            reason: 'agent_read_only',
            selected_agent_id: sent,
          },
        },
      });
    }
    if (sent === undefined) return current;
    const from = (current.selected_agent as { id?: string } | null)?.id ?? null;
    Object.assign(current, { selected_agent: sent === null ? null : viewOf(sent) });
    activity.unshift(
      event({
        type: 'task.agent_selected',
        task_id: current.id,
        payload: { from, to: sent },
        created_at: Date.now(),
      }),
    );
    return current;
  };

  const perTask = (t: Record<string, unknown>) => {
    const id = String(t.id);
    return {
      [`/api/v1/tasks/${id}`]: editable(t),
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
      id: role === 'lead' ? 'u1' : 'u2',
      email: 'me@example.com',
      name: role === 'lead' ? 'Ada Lovelace' : 'Vic Viewer',
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 3, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': () => ({ data: tasks, next_cursor: null }),
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead' },
        { user_id: 'u2', name: 'Vic Viewer', email: 'u2@example.com', role: 'viewer' },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': () => ({ data: activity, next_cursor: null }),
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
    // Only the caller's own — another member's agent is a 404, never listed.
    '/api/v1/agents': { data: AGENTS, next_cursor: null },
    ...perTask(plain),
    ...perTask(chosen),
    ...perTask(other),
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

const patches = (h: Harness, id: string) =>
  h.calls.filter((c) => c.method === 'PATCH' && c.path === `/api/v1/tasks/${id}`);

async function agentRow(h: Harness) {
  const row = h.page.locator('.meta-row-agent');
  await row.waitFor({ timeout: 20_000 });
  return row;
}

async function agentBox(h: Harness) {
  const row = await agentRow(h);
  const box = row.getByRole('combobox', { name: 'Agent' });
  await box.waitFor({ timeout: 10_000 });
  return box;
}

async function optionsOpen(page: Page, box: Awaited<ReturnType<typeof agentBox>>) {
  const list = page.locator(`[id="${(await box.getAttribute('aria-controls')) ?? ''}"]`);
  return list.locator('[role="option"]').evaluateAll((els) =>
    els.map((el) => ({
      value: el.getAttribute('data-value'),
      text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      disabled: el.getAttribute('aria-disabled') === 'true',
    })),
  );
}

void describe('the drawer’s Agent row', () => {
  void test('sits under Assignee and lists the reader’s agents, an ineligible one disabled with its reason', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const box = await agentBox(h);
      // Directly under Assignee, and Assignee still there.
      const order = await h.page
        .locator('.panel-meta .meta-row')
        .evaluateAll((rows) =>
          rows.map(
            (r) => r.querySelector('.meta-label, .agent-row-label')?.textContent?.trim() ?? '',
          ),
        );
      const at = order.indexOf('Assignee');
      assert.ok(at >= 0, `no Assignee row in ${JSON.stringify(order)}`);
      assert.equal(order[at + 1], 'Agent', `Agent is not under Assignee: ${JSON.stringify(order)}`);

      await box.focus();
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
      assert.deepEqual(await optionsOpen(h.page, box), [
        { value: '', text: 'No agent Human only', disabled: false },
        {
          value: 'ag-laptop',
          text: 'Claude Code — Ada Lovelace · laptop-1 Available',
          disabled: false,
        },
        { value: 'ag-desktop', text: 'Codex — Ada Lovelace · desktop-2 Offline', disabled: false },
        {
          value: 'ag-ro',
          text: 'Cursor — Ada Lovelace · tablet Read-only on this space',
          disabled: true,
        },
      ]);
      await h.page.keyboard.press('Escape');
    } finally {
      await h.close();
    }
  });

  void test('choosing by keyboard sends selected_agent_id, keeps the assignee, and survives a reload', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const box = await agentBox(h);
      await box.focus();
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
      // From "No agent": down once is Claude Code; Enter takes it.
      await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('Enter');
      await until(() => patches(h, 't1').length > 0);
      assert.deepEqual(patches(h, 't1')[0]?.body, { selected_agent_id: 'ag-laptop' });

      const row = await agentRow(h);
      await until(async () => (await row.innerText()).includes('Waiting for agent'));
      assert.match(
        await row.innerText(),
        /Waiting for agent · Ada Lovelace’s Claude Code · laptop-1/,
      );
      // Focus comes back to the field it left.
      assert.equal(
        await box.evaluate((el) => el === document.activeElement),
        true,
        'focus did not return to the Agent field',
      );
      // The person accountable is still the person.
      assert.match(await h.page.locator('.panel-meta').innerText(), /Assignee[\s\S]*Ada Lovelace/);

      await h.page.reload();
      const again = await agentBox(h);
      await until(async () => (await again.getAttribute('data-value')) === 'ag-laptop');
      assert.equal(await again.getAttribute('data-value'), 'ag-laptop');
      // …and the History tab says what happened, by name.
      await h.page.locator('#tab-history').click();
      const history = h.page.locator('#panel-history');
      await history.waitFor({ timeout: 10_000 });
      await until(async () => (await history.innerText()).includes('selected Claude Code'));
      assert.match(
        await history.innerText(),
        /Ada Lovelace\s*selected Claude Code · laptop-1 for this task/,
      );
    } finally {
      await h.close();
    }
  });

  void test('a disabled agent cannot be taken by the keyboard either', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const box = await agentBox(h);
      await box.focus();
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
      // Past the last pickable agent, as far as the keys go.
      for (let i = 0; i < 6; i += 1) await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('Enter');
      await until(() => patches(h, 't1').length > 0);
      assert.deepEqual(
        patches(h, 't1').map((c) => c.body),
        [{ selected_agent_id: 'ag-desktop' }],
        'the read-only agent was sent',
      );
    } finally {
      await h.close();
    }
  });

  void test('No agent withdraws it', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const box = await agentBox(h);
      await until(async () => (await box.getAttribute('data-value')) === 'ag-laptop');
      await pick(box, '');
      await until(() => patches(h, 't2').length > 0);
      assert.deepEqual(patches(h, 't2')[0]?.body, { selected_agent_id: null });
      const row = await agentRow(h);
      await until(async () => !(await row.innerText()).includes('Waiting for agent'));
      assert.doesNotMatch(await row.innerText(), /Waiting for agent/);
      assert.equal(await box.getAttribute('data-value'), '');
    } finally {
      await h.close();
    }
  });

  void test('a refusal is said in words and the field keeps what the server holds', async () => {
    const { stub } = world();
    // Grant it read-only *after* the list was drawn — the server is the last word.
    const agents = (stub['/api/v1/agents'] as { data: { id: string; grants: unknown[] }[] }).data;
    const ro = agents.find((a) => a.id === 'ag-ro');
    if (ro !== undefined) ro.grants = [{ project_id: 'laika-core', scope: 'full' }];
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const box = await agentBox(h);
      await pick(box, 'ag-ro');
      await until(() => patches(h, 't1').length > 0);
      const row = await agentRow(h);
      const alert = row.getByRole('alert');
      await alert.waitFor({ timeout: 5_000 });
      assert.equal(
        (await alert.innerText()).trim(),
        'That agent may only read in this space. Give it a full grant to do the work.',
      );
      await until(async () => (await box.getAttribute('data-value')) === '');
      assert.equal(
        await box.getAttribute('data-value'),
        '',
        'the refused agent is shown as chosen',
      );
    } finally {
      if (ro !== undefined) ro.grants = [{ project_id: 'laika-core', scope: 'read_only' }];
      await h.close();
    }
  });

  void test('a Viewer sees the agent and is offered no picker', async () => {
    const { stub } = world({ role: 'viewer' });
    const h = await open('/board?project=laika-core&task=t2', stub);
    try {
      const row = await agentRow(h);
      await until(async () => (await row.innerText()).includes('laptop-1'));
      assert.match(await row.innerText(), /Claude Code · laptop-1/);
      assert.equal(await row.getByRole('combobox').count(), 0);
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/agents').length,
        0,
        'a Viewer’s drawer read the agents',
      );
    } finally {
      await h.close();
    }
  });

  void test('a live update does not take focus from the Agent field', async () => {
    const { stub, tasks } = world();
    const h = await open('/board?project=laika-core&task=t1', stub, { before: fakeStream });
    try {
      const box = await agentBox(h);
      await box.focus();
      // Someone else renames the task; the frame below is how this reader hears.
      const t1 = tasks.find((t) => t.id === 't1');
      if (t1 !== undefined)
        Object.assign(t1, { title: 'Renamed elsewhere', updated_at: Date.now() });
      const shows = async () =>
        (await h.page.getByRole('dialog').first().innerText()).includes('Renamed elsewhere');
      await until(
        async () =>
          (await h.page.evaluate(() =>
            (window as unknown as { __laikaStream: { count: () => number } }).__laikaStream.count(),
          )) > 0,
      );
      await h.page.evaluate(
        (body) => {
          (
            window as unknown as {
              __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
            }
          ).__laikaStream.emit('task.updated', body, '900');
        },
        event({ task_id: 't1', seq: 900, created_at: Date.now() }),
      );
      await until(shows, 10_000);
      assert.ok(await shows(), 'the live update never reached the drawer — nothing was tested');
      assert.equal(
        await box.evaluate((el) => el === document.activeElement),
        true,
        'a live update moved focus off the Agent field',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the card’s agent chip', () => {
  void test('is on by default, beside the avatar, and the agent-written badge keeps its meaning', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub);
    try {
      const card = h.page.locator('article.card[data-task-id="t2"]');
      await card.waitFor({ timeout: 20_000 });
      const chip = card.locator('.agent-chip');
      assert.equal((await chip.innerText()).trim(), 'Claude Code · laptop-1');
      // The avatar is still there, and still wears the "written by an agent" badge.
      assert.equal(await card.locator('.card-avatar').count(), 1);
      assert.equal(await card.locator('.card-bot').count(), 1);
      // A card with no agent draws no chip; t1 was written on the web, so no badge.
      const plain = h.page.locator('article.card[data-task-id="t1"]');
      assert.equal(await plain.locator('.agent-chip').count(), 0);
      assert.equal(await plain.locator('.card-bot').count(), 0);
      // Clicking the card still opens it.
      await card.locator('.card-open').click();
      await h.page.locator('.meta-row-agent').waitFor({ timeout: 10_000 });
      assert.match(h.page.url(), /task=t2/);
    } finally {
      await h.close();
    }
  });

  void test('switched off, the chip is not rendered at all', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core', stub, {
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
      const card = h.page.locator('article.card[data-task-id="t2"]');
      await card.waitFor({ timeout: 20_000 });
      assert.equal(await card.locator('.agent-chip').count(), 0);
      assert.equal(await card.locator('.card-avatar').count(), 1, 'the avatar went with the chip');
    } finally {
      await h.close();
    }
  });
});

void describe('the List’s Agent column and the agent filter', () => {
  const keys = async (h: Harness) =>
    h.page.locator('tbody .list-row .list-open').evaluateAll((els) =>
      els.map(
        (el) =>
          (el as HTMLElement).innerText
            .replace(/\s+—.*$/, '')
            .trim()
            .split('\n')[0] ?? '',
      ),
    );

  void test('the column sorts by agent, says so with aria-sort, and keeps no-agent rows last', async () => {
    const { stub } = world();
    const h = await open('/list?project=laika-core', stub);
    try {
      const header = h.page.getByRole('columnheader', { name: /^Agent/ });
      await header.waitFor({ timeout: 20_000 });
      assert.equal(await header.getAttribute('aria-sort'), 'none');
      const t2 = h.page.locator('tbody tr[data-task-id="t2"] .list-agent');
      // The mark and the device on screen; the product's name read aloud.
      assert.equal(
        ((await t2.textContent()) ?? '').replace(/\s+/g, ' ').trim(),
        'Claude Code · laptop-1',
      );
      // The assignee column still names the person, not the agent.
      assert.match(await h.page.locator('tbody tr[data-task-id="t2"]').innerText(), /Ada Lovelace/);

      await header.getByRole('button').click();
      await until(async () => (await header.getAttribute('aria-sort')) === 'ascending');
      assert.deepEqual(await keys(h), ['LC-2', 'LC-3', 'LC-1']);
      await header.getByRole('button').click();
      await until(async () => (await header.getAttribute('aria-sort')) === 'descending');
      assert.deepEqual(await keys(h), ['LC-3', 'LC-2', 'LC-1']);
    } finally {
      await h.close();
    }
  });

  void test('?selected_agent= keeps that agent’s tasks and names it on a chip', async () => {
    const { stub } = world();
    const h = await open('/list?project=laika-core&selected_agent=ag-desktop', stub);
    try {
      await h.page.locator('tbody .list-row').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await keys(h), ['LC-3']);
      const chip = h.page.locator('.bt-chip', { hasText: 'Agent:' });
      assert.equal(
        (await chip.locator('.bt-chip-text').innerText()).trim(),
        'Agent: Codex · desktop-2',
      );
      await chip.click();
      await until(async () => (await keys(h)).length === 3);
      assert.equal((await keys(h)).length, 3);
      assert.doesNotMatch(h.page.url(), /selected_agent=/);
    } finally {
      await h.close();
    }
  });

  void test('No agent and Any agent split the board without counting an agent as a person', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&selected_agent=none', stub);
    try {
      await h.page.locator('article.card').first().waitFor({ timeout: 20_000 });
      const shown = async () =>
        h.page
          .locator('article.card')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-task-id')));
      assert.deepEqual(await shown(), ['t1']);
      await h.page.goto(`${h.origin}/board?project=laika-core&selected_agent=any`);
      await h.page.locator('article.card').first().waitFor({ timeout: 20_000 });
      await until(async () => (await shown()).length === 2);
      assert.deepEqual([...(await shown())].sort(), ['t2', 't3']);
      // The Assignee filter still offers people only.
      await h.page
        .getByRole('button', { name: /^Filter/ })
        .first()
        .click();
      const assignee = h.page.getByRole('combobox', { name: 'Assignee' });
      await assignee.waitFor({ timeout: 5_000 });
      const people = await offered(assignee);
      assert.ok(
        people.every((label) => !/laptop|desktop|Claude|Codex/.test(label)),
        `an agent is offered as a person: ${JSON.stringify(people)}`,
      );
      const agentField = h.page.getByRole('combobox', { name: 'Agent' });
      assert.deepEqual(await offered(agentField), [
        'Any',
        'Any agent',
        'No agent',
        'Claude Code · laptop-1',
        'Codex · desktop-2',
      ]);
    } finally {
      await h.close();
    }
  });
});

void describe('a space that uses no agents', () => {
  void test('draws no Agent column and offers no Agent filter', async () => {
    const { stub, tasks } = world();
    for (const t of tasks) t.selected_agent = null;
    const h = await open('/list?project=laika-core', stub);
    try {
      await h.page.locator('tbody .list-row').first().waitFor({ timeout: 20_000 });
      const headers = await h.page.getByRole('columnheader').allInnerTexts();
      assert.ok(
        headers.some((t) => /Assignee/i.test(t)),
        'the headers did not render',
      );
      assert.ok(
        !headers.some((t) => /^Agent/i.test(t.trim())),
        `an Agent column: ${headers.join()}`,
      );
      await h.page
        .getByRole('button', { name: /^Filter/ })
        .first()
        .click();
      await h.page.getByRole('combobox', { name: 'Assignee' }).waitFor({ timeout: 5_000 });
      assert.equal(await h.page.getByRole('combobox', { name: 'Agent' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('who an agent’s activity row says acted', () => {
  void test('a registered agent by name after its owner; a legacy token says so', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      await agentRow(h);
      await h.page.locator('#tab-history').click();
      const history = h.page.locator('#panel-history');
      await history.waitFor({ timeout: 10_000 });
      await until(async () => (await history.locator('.panel-event').count()) >= 2);
      const who = await history.locator('.panel-event-who').allInnerTexts();
      assert.ok(
        who.includes('Ada Lovelace via Claude Code · laptop-1'),
        `no owner + agent line in ${JSON.stringify(who)}`,
      );
      assert.ok(
        who.includes('Ada Lovelace via agent (unregistered token)'),
        `no legacy-token line in ${JSON.stringify(who)}`,
      );
    } finally {
      await h.close();
    }
  });
});
