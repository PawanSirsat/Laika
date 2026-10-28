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
  navigateInApp,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { offered, pick } from './dropdown.ts';
import { AGENT_SAVE_DEADLINE_MS } from '../../src/api/agent-writes.ts';

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
    // The reader's own agent, selected on no task: named from `GET /agents`.
    event({ actor_kind: 'agent', actor_token_id: 'tok-ro', agent_id: 'ag-ro' }),
    // Somebody's agent this reader can see nowhere: never given a name.
    event({ actor_kind: 'agent', actor_token_id: 'tok-x', agent_id: 'ag-theirs' }),
    // Who wrote each agent comment below — `CommentView` itself does not say.
    event({
      type: 'comment.added',
      actor_kind: 'agent',
      actor_token_id: 'tok-legacy',
      agent_id: null,
      payload: { action: 'created', comment_id: 'c-legacy' },
    }),
    event({
      type: 'comment.added',
      actor_kind: 'agent',
      actor_token_id: 'tok-1',
      agent_id: 'ag-laptop',
      payload: { action: 'created', comment_id: 'c-reg' },
    }),
  ];

  const comment = (id: string, createdVia: string, body: string) => ({
    id,
    task_id: 't1',
    author_id: 'u1',
    body_md: body,
    created_via: createdVia,
    edited_at: null,
    sent_back: false,
    created_at: NOW - 2 * HOUR,
    updated_at: NOW - 2 * HOUR,
  });
  const comments: Record<string, unknown[]> = {
    t1: [
      comment('c-legacy', 'mcp', 'Written with a legacy token'),
      comment('c-reg', 'mcp', 'Written by a registered agent'),
      // An agent comment whose activity row is not in the page read.
      comment('c-orphan', 'mcp', 'Row not loaded'),
      comment('c-human', 'web', 'Written by Ada herself'),
    ],
  };

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
    // Every write moves `updated_at` forward, as the server's does — the
    // drawer tells a newer read from an older one by it.
    Object.assign(current, {
      selected_agent: sent === null ? null : viewOf(sent),
      updated_at: Math.max(Number(current.updated_at) + 1, Date.now()),
    });
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
      [`/api/v1/tasks/${id}/comments`]: { data: comments[id] ?? [], next_cursor: null },
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
          text: 'Claude Code · laptop-1 — Ada Lovelace Available',
          disabled: false,
        },
        { value: 'ag-desktop', text: 'Codex · desktop-2 — Ada Lovelace Offline', disabled: false },
        {
          value: 'ag-ro',
          text: 'Cursor · tablet — Ada Lovelace Read-only on this space',
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

  // **Reached, read and refused** (LAI-536's reviewed rule, WAI-ARIA APG
  // combobox; decided for the integration of LAI-536 and LAI-538): a disabled
  // agent is not stepped over — the keys reach it so its reason is announced —
  // and it cannot be chosen. The agent above it still can.
  void test('a disabled agent cannot be taken by the keyboard either', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const box = await agentBox(h);
      const before = await box.getAttribute('data-value');
      const active = async () => {
        const id = await box.getAttribute('aria-activedescendant');
        assert.ok(id !== null, 'nothing is active');
        return h.page.locator(`[id="${id}"]`);
      };
      await box.focus();
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
      // Past the last pickable agent, as far as the keys go: the read-only one.
      for (let i = 0; i < 6; i += 1) await h.page.keyboard.press('ArrowDown');
      const last = await active();
      assert.equal(await last.getAttribute('data-value'), 'ag-ro');
      assert.equal(await last.getAttribute('aria-disabled'), 'true');
      assert.match(
        (await last.innerText()).replace(/\s+/g, ' '),
        /Read-only on this space/,
        'the reason is not read with it',
      );
      // Enter there chooses nothing: no request, the field unchanged, still open.
      await h.page.keyboard.press('Enter');
      await h.page.waitForTimeout(150);
      assert.deepEqual(patches(h, 't1'), [], 'the read-only agent was sent');
      assert.equal(await box.getAttribute('data-value'), before);
      assert.equal(await box.getAttribute('aria-expanded'), 'true');
      // Home and End reach the ends, End the disabled one as well.
      await h.page.keyboard.press('Home');
      assert.equal(await (await active()).getAttribute('data-value'), '');
      await h.page.keyboard.press('End');
      assert.equal(await (await active()).getAttribute('data-value'), 'ag-ro');
      // One up is the last pickable agent, and the keyboard takes it.
      await h.page.keyboard.press('ArrowUp');
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

  // **Search keeps the rule** (LAI-538's search, LAI-536's reachability):
  // typing on the field starts the search; a disabled agent that matches is
  // still reached and named, by the search box now, and still not taken.
  void test('a search reaches a disabled match and reads its reason, and Enter takes nothing', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      const box = await agentBox(h);
      const before = await box.getAttribute('data-value');
      await box.focus();
      await h.page.keyboard.press('ArrowDown');
      await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
      // Open, and focus is still on the field, which names the active agent.
      assert.ok((await box.getAttribute('aria-activedescendant')) !== null);

      // The device, which is a keyword and not in the name's first words.
      await h.page.keyboard.type('tablet');
      const search = h.page.getByRole('combobox', { name: 'Search agents' });
      await until(async () => (await search.inputValue()) === 'tablet');
      await until(async () => {
        const values = (await optionsOpen(h.page, box)).map((o) => o.value);
        return values.includes('ag-ro') && !values.includes('ag-laptop');
      });
      // One element names the active option: the one with focus.
      assert.equal(await box.getAttribute('aria-activedescendant'), null);

      await h.page.keyboard.press('Alt+ArrowDown');
      const id = await search.getAttribute('aria-activedescendant');
      assert.ok(id !== null, 'the search box names no active agent');
      const match = h.page.locator(`[id="${id}"]`);
      assert.equal(await match.getAttribute('data-value'), 'ag-ro');
      assert.equal(await match.getAttribute('aria-disabled'), 'true');
      const listId = (await box.getAttribute('aria-controls')) ?? '';
      const named = h.page
        .locator(`[id="${listId}"]`)
        .getByRole('option', { name: /Cursor .*Read-only on this space/ });
      assert.equal(await named.getAttribute('id'), id, 'the reason is not in its accessible name');

      await h.page.keyboard.press('Enter');
      await h.page.waitForTimeout(150);
      assert.deepEqual(patches(h, 't1'), [], 'the read-only agent was sent');
      assert.equal(await box.getAttribute('data-value'), before);
    } finally {
      await h.close();
    }
  });

  // **Whoever has focus names the active agent, after any close** (Codex,
  // integration round 2): a search left the search box "focused" in the
  // picker's state when the list closed, so a reopened list named its active
  // option from the unfocused search box and not from the trigger.
  for (const close of ['a click outside', 'Escape'] as const) {
    void test(`after a search closed by ${close}, a reopened list is named by the focused field`, async () => {
      const { stub } = world();
      const h = await open('/board?project=laika-core&task=t1', stub);
      try {
        const box = await agentBox(h);
        await box.focus();
        await h.page.keyboard.press('ArrowDown');
        await until(async () => (await box.getAttribute('aria-expanded')) === 'true');
        await h.page.keyboard.type('laptop');
        const search = h.page.getByRole('combobox', { name: 'Search agents' });
        await until(async () => (await search.inputValue()) === 'laptop');

        if (close === 'Escape') {
          await h.page.keyboard.press('Escape');
        } else {
          await h.page.locator('.panel-meta p.meta-label', { hasText: 'Reporter' }).click();
        }
        await until(async () => (await box.getAttribute('aria-expanded')) === 'false');

        // Reopen on End: the last agent, the disabled read-only one.
        await box.focus();
        await h.page.keyboard.press('End');
        await until(async () => (await box.getAttribute('aria-expanded')) === 'true');

        const focused = await h.page.evaluate(() => {
          const el = document.activeElement;
          return {
            role: el?.getAttribute('role') ?? null,
            label: el?.getAttribute('aria-label') ?? null,
            active: el?.getAttribute('aria-activedescendant') ?? null,
          };
        });
        assert.equal(focused.label, null, `focus is on ${JSON.stringify(focused)}, not the field`);
        assert.equal(focused.active, await box.getAttribute('aria-activedescendant'));
        assert.ok(focused.active !== null, 'the focused field names no active agent');
        // Exactly one element names an active option: the focused one.
        const naming = await h.page.locator('[aria-activedescendant]').count();
        assert.equal(naming, 1, 'an unfocused element also names the active option');

        const option = h.page.locator(`[id="${focused.active}"]`);
        assert.equal(await option.getAttribute('data-value'), 'ag-ro');
        assert.equal(await option.getAttribute('aria-disabled'), 'true');
        const listId = (await box.getAttribute('aria-controls')) ?? '';
        const named = h.page
          .locator(`[id="${listId}"]`)
          .getByRole('option', { name: /Cursor .*Read-only on this space/ });
        assert.equal(await named.getAttribute('id'), focused.active, 'the reason is not announced');
      } finally {
        await h.close();
      }
    });
  }

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
      // A Viewer may still read their own agents (§3.1 `agent.read_own`,
      // every role), which is what names them in the activity; no picker.
      assert.equal(await row.getByRole('alert').count(), 0);
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

  void test('an agent the reader may see is named, wherever it was selected or not; another is not', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      await agentRow(h);
      await h.page.locator('#tab-history').click();
      const history = h.page.locator('#panel-history');
      await history.waitFor({ timeout: 10_000 });
      const who = () => history.locator('.panel-event-who').allInnerTexts();
      // `ag-ro` is selected on no task: only the reader's own `GET /agents` names it.
      await until(async () => (await who()).includes('Ada Lovelace via Cursor · tablet'));
      const lines = await who();
      assert.ok(
        lines.includes('Ada Lovelace via Cursor · tablet'),
        `the reader's own agent was not named: ${JSON.stringify(lines)}`,
      );
      assert.ok(
        lines.includes('Ada Lovelace via a registered agent'),
        `an agent the reader cannot see was given a name: ${JSON.stringify(lines)}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('a comment names its agent, a legacy token’s says so, and none is anybody’s agent', async () => {
    const { stub } = world();
    const h = await open('/board?project=laika-core&task=t1', stub);
    try {
      await agentRow(h);
      await h.page.locator('#tab-comments').click();
      const list = h.page.locator('#panel-comments .cmt-who');
      await until(async () => (await list.count()) === 4);
      await until(async () =>
        (await list.allInnerTexts()).includes('Ada Lovelace via Claude Code · laptop-1'),
      );
      assert.deepEqual(await list.allInnerTexts(), [
        'Ada Lovelace via agent (unregistered token)',
        'Ada Lovelace via Claude Code · laptop-1',
        'Ada Lovelace via an agent',
        'Ada Lovelace',
      ]);
      assert.doesNotMatch(
        await h.page.locator('#panel-comments').innerText(),
        /Ada Lovelace['’]s agent/,
      );
    } finally {
      await h.close();
    }
  });

  void test('the Activity screen names the agent the same way', async () => {
    const { stub } = world();
    const h = await open('/activity?project=laika-core', stub);
    try {
      const feed = h.page.locator('.rail-feed-what');
      await feed.first().waitFor({ timeout: 20_000 });
      const text = async () => (await feed.allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
      await until(async () => (await text()).some((t) => t.includes('via Cursor · tablet')));
      const rows = await text();
      for (const want of [
        'Ada Lovelace via Claude Code · laptop-1',
        'Ada Lovelace via agent (unregistered token)',
        'Ada Lovelace via Cursor · tablet',
        'Ada Lovelace via a registered agent',
      ]) {
        assert.ok(
          rows.some((r) => r.startsWith(want)),
          `no "${want}" on the Activity screen: ${JSON.stringify(rows)}`,
        );
      }
    } finally {
      await h.close();
    }
  });
});

void describe('a selection still in flight when the drawer moves on', () => {
  /** A promise for the next response matching method, path and status — set up before acting. */
  const nextResponse = (
    h: Harness,
    method: string,
    path: string | RegExp,
    status?: number,
  ): Promise<unknown> =>
    h.page.waitForResponse(
      (r) => {
        const at = new URL(r.url()).pathname;
        return (
          r.request().method() === method &&
          (typeof path === 'string' ? at === path : path.test(at)) &&
          (status === undefined || r.status() === status)
        );
      },
      { timeout: 15_000 },
    );

  /** A gate a route waits on, opened by the test. */
  const gate = () => {
    let open: () => void = () => undefined;
    const shut = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { shut, open: () => open() };
  };

  const settledRow = async (h: Harness, value: string, line: RegExp | null) => {
    const box = await agentBox(h);
    const row = await agentRow(h);
    await until(
      async () =>
        (await box.getAttribute('data-value')) === value &&
        !(await row.innerText()).includes('Saving agent') &&
        (line === null
          ? !(await row.innerText()).includes('Waiting for agent')
          : line.test(await row.innerText())),
    );
    assert.equal(await box.getAttribute('data-value'), value);
    assert.doesNotMatch(await row.innerText(), /Saving agent/);
    if (line === null) assert.doesNotMatch(await row.innerText(), /Waiting for agent/);
    else assert.match(await row.innerText(), line);
    assert.equal(await row.getByRole('alert').count(), 0);
    assert.equal(await box.isDisabled(), false);
  };

  const LAPTOP_LINE = /Waiting for agent · Ada Lovelace’s Claude Code · laptop-1/;
  const DESKTOP_LINE = /Waiting for agent · Ada Lovelace’s Codex · desktop-2/;

  const goTo = async (h: Harness, id: string, title: string) => {
    await navigateInApp(h.page, `/board?project=laika-core&task=${id}`);
    await h.page.getByRole('dialog').filter({ hasText: title }).waitFor({ timeout: 10_000 });
  };

  void test('stays with its own task: the next task shows its own agent and can be picked', async () => {
    const { stub } = world();
    const held = gate();
    let sent = false;
    const h = await open('/board?project=laika-core&task=t2', stub, {
      before: async (page) => {
        await page.route('**/api/v1/tasks/t2', async (route) => {
          if (route.request().method() === 'PATCH') {
            sent = true;
            await held.shut;
          }
          await route.continue();
        });
      },
    });
    try {
      const box = await agentBox(h);
      await until(async () => (await box.getAttribute('data-value')) === 'ag-laptop');
      await pick(box, 'ag-desktop');
      await until(() => sent);
      assert.ok(sent, 'the PATCH on LC-2 was never sent — nothing was tested');

      await goTo(h, 't1', 'Wire the agent field');
      await settledRow(h, '', null);

      // LC-1 can be picked while LC-2's write is still out.
      const t1Done = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      await pick(box, 'ag-laptop');
      await t1Done;
      await settledRow(h, 'ag-laptop', LAPTOP_LINE);

      // LC-2's answer arrives late — awaited, not slept on — and changes nothing here.
      const t2Done = nextResponse(h, 'PATCH', '/api/v1/tasks/t2', 200);
      held.open();
      await t2Done;
      assert.deepEqual(patches(h, 't2')[0]?.body, { selected_agent_id: 'ag-desktop' });
      await settledRow(h, 'ag-laptop', LAPTOP_LINE);
    } finally {
      held.open();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('A → B → back to A: an old write still out holds A, and its late refusal is not shown', async () => {
    const { stub } = world();
    const held = gate();
    let t1Patches = 0;
    const h = await open('/board?project=laika-core&task=t1', stub, {
      before: async (page) => {
        await page.route('**/api/v1/tasks/t1', async (route) => {
          if (route.request().method() !== 'PATCH') return route.continue();
          t1Patches += 1;
          if (t1Patches > 1) return route.continue();
          await held.shut;
          return route.fulfill({
            status: 422,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'unprocessable',
                message: 'stale',
                details: { field: 'selected_agent_id', reason: 'agent_read_only' },
              },
            }),
          });
        });
      },
    });
    try {
      const box = await agentBox(h);
      await pick(box, 'ag-desktop');
      await until(() => t1Patches === 1);
      assert.equal(t1Patches, 1, 'the first LC-1 request was never sent');

      await goTo(h, 't2', 'Chip on the card');
      await settledRow(h, 'ag-laptop', LAPTOP_LINE);

      // Back on LC-1 with its first write still out: held, and said.
      await goTo(h, 't1', 'Wire the agent field');
      const row = await agentRow(h);
      await until(async () => (await row.innerText()).includes('Saving agent…'));
      assert.match(await row.innerText(), /Saving agent…/);
      assert.equal(await box.isDisabled(), true, 'a second write on LC-1 could start');
      await box.click({ force: true });
      assert.equal(t1Patches, 1, 'a second LC-1 write went out over the first');

      // The old write is refused — the response itself is awaited.
      const refused = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 422);
      held.open();
      await refused;
      await settledRow(h, '', null);

      // Now the reader's pick goes out, alone, and stands.
      const done = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      await pick(box, 'ag-laptop');
      await done;
      assert.equal(t1Patches, 2);
      await settledRow(h, 'ag-laptop', LAPTOP_LINE);
    } finally {
      held.open();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('an old withdraw held across a revisit lands first; the reader’s last pick is what the server holds', async () => {
    const { stub, tasks } = world();
    const held = gate();
    let t2Patches = 0;
    const h = await open('/board?project=laika-core&task=t2', stub, {
      before: async (page) => {
        await page.route('**/api/v1/tasks/t2', async (route) => {
          if (route.request().method() === 'PATCH') {
            t2Patches += 1;
            // The withdraw waits here, before it reaches the server.
            if (t2Patches === 1) await held.shut;
          }
          await route.continue();
        });
      },
    });
    try {
      const box = await agentBox(h);
      await until(async () => (await box.getAttribute('data-value')) === 'ag-laptop');
      await pick(box, '');
      await until(() => t2Patches === 1);

      await goTo(h, 't1', 'Wire the agent field');
      await goTo(h, 't2', 'Chip on the card');
      const row = await agentRow(h);
      await until(async () => (await row.innerText()).includes('Saving agent…'));
      assert.equal(await box.isDisabled(), true);
      // The newer selection cannot overtake the withdraw.
      await box.click({ force: true });
      assert.equal(t2Patches, 1, 'a select went out while the withdraw was still in flight');

      const withdrawn = nextResponse(h, 'PATCH', '/api/v1/tasks/t2', 200);
      held.open();
      await withdrawn;
      await settledRow(h, '', null);

      const selected = nextResponse(h, 'PATCH', '/api/v1/tasks/t2', 200);
      await pick(box, 'ag-desktop');
      await selected;
      await settledRow(h, 'ag-desktop', DESKTOP_LINE);

      // The server holds the reader's last intent, in the order it was asked.
      const t2 = tasks.find((t) => t.id === 't2');
      assert.equal((t2?.selected_agent as { id?: string } | null)?.id, 'ag-desktop');
      assert.deepEqual(
        patches(h, 't2').map((c) => c.body),
        [{ selected_agent_id: null }, { selected_agent_id: 'ag-desktop' }],
      );
    } finally {
      held.open();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  for (const [what, second, value, line] of [
    ['a newer select', 'ag-desktop', 'ag-desktop', DESKTOP_LINE],
    ['a withdraw', '', '', null],
  ] as const) {
    void test(`${what} confirmed after the read caught up to the earlier one still shows`, async () => {
      // Confirm X → send Y → the read reaches X while Y is out → Y confirms,
      // and its follow-up read fails. The drawer must show Y, not X.
      const { stub } = world();
      let reads: 'pass' | 'hold' | 'fail' = 'pass';
      const readGate = gate();
      const patchGate = gate();
      let t1Patches = 0;
      const fail = {
        status: 500,
        contentType: 'application/json',
        body: '{"error":{"code":"internal","message":"down"}}',
      };
      const read = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
        if (reads === 'hold') await readGate.shut;
        if (reads === 'fail') return route.fulfill(fail);
        return route.continue();
      };
      const h = await open('/board?project=laika-core&task=t1', stub, {
        before: async (page) => {
          await page.route('**/api/v1/tasks/t1', async (route) => {
            if (route.request().method() !== 'PATCH') return read(route);
            t1Patches += 1;
            if (t1Patches === 2) await patchGate.shut;
            return route.continue();
          });
          await page.route('**/api/v1/projects/laika-core/tasks**', read);
        },
      });
      try {
        const box = await agentBox(h);
        reads = 'hold';
        const first = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
        await pick(box, 'ag-laptop');
        await first;
        await settledRow(h, 'ag-laptop', LAPTOP_LINE);

        await pick(box, second);
        await until(() => t1Patches === 2);

        // The held read now lands, carrying X.
        const caughtUp = nextResponse(h, 'GET', /\/api\/v1\/projects\/laika-core\/tasks$/, 200);
        reads = 'pass';
        readGate.open();
        await caughtUp;

        // Y confirms; every read after it fails.
        reads = 'fail';
        const confirmed = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
        const failedRead = nextResponse(
          h,
          'GET',
          /\/api\/v1\/(projects\/laika-core\/tasks|tasks\/t1)$/,
          500,
        );
        patchGate.open();
        await confirmed;
        await failedRead;
        await settledRow(h, value, line);
      } finally {
        readGate.open();
        patchGate.open();
        await h.page.unrouteAll({ behavior: 'ignoreErrors' });
        await h.close();
      }
    });
  }

  /** Move the stub's copy of a task to what the server now holds, one version on. */
  const serverHolds = (tasks: Record<string, unknown>[], id: string, agent: string | null) => {
    const task = tasks.find((t) => t.id === id);
    if (task === undefined) throw new Error(`no task ${id}`);
    Object.assign(task, {
      selected_agent: agent === null ? null : viewOf(agent),
      updated_at: Math.max(Number(task.updated_at) + 1, Date.now()),
    });
  };

  /** A PATCH on `id` that never answers the first time; later ones go through. */
  const hangFirstPatch = (id: string, counter: { n: number }) => async (page: Page) => {
    await page.clock.install();
    await page.route(`**/api/v1/tasks/${id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        counter.n += 1;
        // Never answered: no continue, no fulfil.
        if (counter.n === 1) return;
      }
      await route.continue();
    });
  };

  void test('a PATCH that never answers: at the deadline the task is read back, and the picker shows the server’s agent', async () => {
    const { stub, tasks } = world();
    const sent = { n: 0 };
    const h = await open('/board?project=laika-core&task=t1', stub, {
      before: hangFirstPatch('t1', sent),
    });
    try {
      const box = await agentBox(h);
      await pick(box, 'ag-laptop');
      await until(() => sent.n === 1);
      const row = await agentRow(h);
      await until(async () => (await row.innerText()).includes('Saving agent…'));
      assert.match(await row.innerText(), /Saving agent…/);
      // Whatever happened on the server, it now holds Codex — not what was asked.
      serverHolds(tasks, 't1', 'ag-desktop');

      const readBack = nextResponse(h, 'GET', '/api/v1/tasks/t1', 200);
      await h.page.clock.fastForward(AGENT_SAVE_DEADLINE_MS + 1_000);
      await readBack;
      await settledRow(h, 'ag-desktop', DESKTOP_LINE);

      // And the next write goes.
      const next = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      await pick(box, 'ag-laptop');
      await next;
      await settledRow(h, 'ag-laptop', LAPTOP_LINE);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('when the read-back fails too, the row says it could not confirm, and does not hold the picker', async () => {
    const { stub } = world();
    const sent = { n: 0 };
    let failReads = false;
    const h = await open('/board?project=laika-core&task=t1', stub, {
      before: async (page) => {
        await hangFirstPatch('t1', sent)(page);
        await page.route('**/api/v1/tasks/t1', async (route) => {
          if (route.request().method() === 'GET' && failReads) {
            return route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: '{"error":{"code":"internal","message":"down"}}',
            });
          }
          return route.fallback();
        });
      },
    });
    try {
      const box = await agentBox(h);
      await pick(box, 'ag-laptop');
      await until(() => sent.n === 1);
      failReads = true;
      const failed = nextResponse(h, 'GET', '/api/v1/tasks/t1', 500);
      await h.page.clock.fastForward(AGENT_SAVE_DEADLINE_MS + 1_000);
      await failed;

      const row = await agentRow(h);
      const alert = row.getByRole('alert');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(
        (await alert.innerText()).trim(),
        'Couldn’t confirm the agent was saved — reload to check.',
      );
      await until(async () => !(await row.innerText()).includes('Saving agent'));
      assert.doesNotMatch(await row.innerText(), /Saving agent/);
      assert.equal(await box.isDisabled(), false);

      const next = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      await pick(box, 'ag-desktop');
      await next;
      await settledRow(h, 'ag-desktop', DESKTOP_LINE);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a PATCH that never answers does not outlive the session: sign out, sign in, and the picker is free', async () => {
    const { stub } = world();
    const sent = { n: 0 };
    let signedIn = true;
    const me = stub['/api/v1/me'];
    const h = await open(
      '/board?project=laika-core&task=t1',
      {
        ...stub,
        '/api/v1/me': () => (signedIn ? me : refuse(401, 'unauthorized', 'Sign in to continue.')),
        '/api/v1/auth/sign-out': () => {
          signedIn = false;
          return reply(200, {});
        },
        '/api/v1/auth/sign-in/email': () => {
          signedIn = true;
          return reply(200, {});
        },
      },
      { before: hangFirstPatch('t1', sent) },
    );
    try {
      const box = await agentBox(h);
      await pick(box, 'ag-laptop');
      await until(() => sent.n === 1);

      await h.page.locator('.user-menu-trigger').dispatchEvent('click');
      await h.page.locator('.user-menu-signout').dispatchEvent('click');
      await h.page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });
      await h.page.locator('input[type="email"]').fill('me@example.com');
      await h.page.locator('input[type="password"]').fill('correct horse battery');
      await h.page.getByRole('button', { name: 'Sign in' }).click();
      await h.page.waitForURL((url) => url.pathname !== '/login', { timeout: 10_000 });

      // No clock moved: only the session reset can have freed it.
      await navigateInApp(h.page, '/board?project=laika-core&task=t1');
      await settledRow(h, '', null);
      const next = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      await pick(await agentBox(h), 'ag-desktop');
      await next;
      await settledRow(h, 'ag-desktop', DESKTOP_LINE);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('the drawer closed and reopened while a PATCH hangs: still held, then freed at the deadline with the server’s agent', async () => {
    const { stub, tasks } = world();
    const sent = { n: 0 };
    const h = await open('/board?project=laika-core&task=t1', stub, {
      before: hangFirstPatch('t1', sent),
    });
    try {
      await pick(await agentBox(h), 'ag-laptop');
      await until(() => sent.n === 1);

      await navigateInApp(h.page, '/board?project=laika-core');
      await h.page.locator('.meta-row-agent').waitFor({ state: 'detached', timeout: 10_000 });
      await navigateInApp(h.page, '/board?project=laika-core&task=t1');
      const box = await agentBox(h);
      const row = await agentRow(h);
      await until(async () => (await row.innerText()).includes('Saving agent…'));
      assert.equal(await box.isDisabled(), true, 'a remounted row let a second write start');

      serverHolds(tasks, 't1', 'ag-desktop');
      const readBack = nextResponse(h, 'GET', '/api/v1/tasks/t1', 200);
      await h.page.clock.fastForward(AGENT_SAVE_DEADLINE_MS + 1_000);
      await readBack;
      await settledRow(h, 'ag-desktop', DESKTOP_LINE);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('on a timestamp tie, a list snapshot taken before the save completed does not overturn it', async () => {
    // The PATCH answers with the `updated_at` the props already carry. A list
    // read that began before it answered lands after, still saying no agent:
    // that is the past, and the confirmed agent stays.
    const { stub, tasks } = world();
    const t1 = tasks.find((t) => t.id === 't1');
    if (t1 === undefined) throw new Error('no t1');
    const tie = Number(t1.updated_at);
    const patchGate = gate();
    const snapshotGate = gate();
    const laterGate = gate();
    let patchArrived = false;
    let snapshotTaken = false;
    let lists: 'pass' | 'snapshot' | 'hold' = 'pass';
    const h = await open('/board?project=laika-core&task=t1', stub, {
      before: async (page) => {
        await fakeStream(page);
        await page.route('**/api/v1/tasks/t1', async (route) => {
          if (route.request().method() !== 'PATCH') return route.continue();
          patchArrived = true;
          await patchGate.shut;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...t1, selected_agent: viewOf('ag-laptop'), updated_at: tie }),
          });
        });
        await page.route('**/api/v1/projects/laika-core/tasks**', async (route) => {
          if (lists === 'pass') return route.continue();
          if (lists === 'snapshot' && !snapshotTaken) {
            snapshotTaken = true;
            // Read from the server now — before the save completes — and hand it over later.
            const response = await route.fetch();
            await snapshotGate.shut;
            return route.fulfill({ response });
          }
          await laterGate.shut;
          return route.continue();
        });
      },
    });
    try {
      const box = await agentBox(h);
      await pick(box, 'ag-laptop');
      await until(() => patchArrived);

      // A live frame starts a list read while the PATCH is still out.
      lists = 'snapshot';
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
          ).__laikaStream.emit('task.updated', body, '950');
        },
        event({ task_id: 't1', seq: 950, created_at: Date.now() }),
      );
      await until(() => snapshotTaken, 10_000);
      assert.ok(
        snapshotTaken,
        'no list read started before the save completed — nothing was tested',
      );

      // The save lands on the server at the same millisecond, and is confirmed.
      Object.assign(t1, { selected_agent: viewOf('ag-laptop') });
      lists = 'hold';
      const confirmed = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      patchGate.open();
      await confirmed;

      // Now the old snapshot arrives: equal timestamp, no agent.
      const old = nextResponse(h, 'GET', /\/api\/v1\/projects\/laika-core\/tasks$/, 200);
      snapshotGate.open();
      await old;
      await settledRow(h, 'ag-laptop', LAPTOP_LINE);
    } finally {
      patchGate.open();
      snapshotGate.open();
      laterGate.open();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('on a timestamp tie, a read started after the save completed is the truth, whatever agent it names', async () => {
    // Another write sets Codex in the same millisecond the save confirmed
    // Claude Code. The read the save itself triggers starts after it
    // completed, carries the same `updated_at`, and must not be ignored.
    const { stub, tasks } = world();
    const t1 = tasks.find((t) => t.id === 't1');
    if (t1 === undefined) throw new Error('no t1');
    const tie = Number(t1.updated_at);
    const h = await open('/board?project=laika-core&task=t1', stub, {
      before: async (page) => {
        await page.route('**/api/v1/tasks/t1', async (route) => {
          if (route.request().method() !== 'PATCH') return route.continue();
          const answer = { ...t1, selected_agent: viewOf('ag-laptop'), updated_at: tie };
          // The other write, same millisecond: what every later read returns.
          Object.assign(t1, { selected_agent: viewOf('ag-desktop'), updated_at: tie });
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(answer),
          });
        });
      },
    });
    try {
      const box = await agentBox(h);
      const confirmed = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      const fresh = nextResponse(h, 'GET', /\/api\/v1\/projects\/laika-core\/tasks$/, 200);
      await pick(box, 'ag-laptop');
      await confirmed;
      await fresh;
      await settledRow(h, 'ag-desktop', DESKTOP_LINE);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a confirmed write shows, and the picker stays usable, when the follow-up read fails', async () => {
    const { stub } = world();
    let failReads = false;
    const fail = {
      status: 500,
      contentType: 'application/json',
      body: '{"error":{"code":"internal","message":"down"}}',
    };
    const h = await open('/board?project=laika-core&task=t1', stub, {
      before: async (page) => {
        await page.route('**/api/v1/tasks/t1', async (route) => {
          if (route.request().method() === 'PATCH') {
            await route.continue();
            failReads = true;
            return;
          }
          return failReads ? route.fulfill(fail) : route.continue();
        });
        await page.route('**/api/v1/projects/laika-core/tasks**', async (route) =>
          failReads ? route.fulfill(fail) : route.continue(),
        );
      },
    });
    try {
      const box = await agentBox(h);
      const first = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      // Proof the follow-up read really failed, not just that a flag was set.
      const failedRead = nextResponse(
        h,
        'GET',
        /\/api\/v1\/(projects\/laika-core\/tasks|tasks\/t1)$/,
        500,
      );
      await pick(box, 'ag-laptop');
      await first;
      await failedRead;
      await settledRow(h, 'ag-laptop', LAPTOP_LINE);

      // Not held by a refresh that will never come: the next pick goes out and settles.
      const second = nextResponse(h, 'PATCH', '/api/v1/tasks/t1', 200);
      await pick(box, 'ag-desktop');
      await second;
      assert.deepEqual(patches(h, 't1')[1]?.body, { selected_agent_id: 'ag-desktop' });
      await settledRow(h, 'ag-desktop', DESKTOP_LINE);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

void describe('a Viewer whose own agents cannot be read', () => {
  void test('still sees the selected agent, gets no picker, and no error', async () => {
    const { stub } = world({ role: 'viewer' });
    const refused = {
      ...stub,
      '/api/v1/agents': refuse(403, 'forbidden', 'You may not read agents'),
    };
    const h = await open('/board?project=laika-core&task=t2', refused);
    try {
      const row = await agentRow(h);
      await until(() => h.calls.some((c) => c.path === '/api/v1/agents'));
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/agents'),
        'GET /agents was never asked — the 403 was not tested',
      );
      await until(async () => (await row.innerText()).includes('laptop-1'));
      assert.match(await row.innerText(), /Claude Code · laptop-1/);
      assert.equal(await row.getByRole('combobox').count(), 0);
      assert.equal(await row.getByRole('alert').count(), 0);
      assert.doesNotMatch(
        await h.page.getByRole('dialog').first().innerText(),
        /Could not load your agents|forbidden|You may not read agents/i,
      );
    } finally {
      await h.close();
    }
  });
});

/*
 * **Two of the reader's agents with one harness on one device** (LAI-583).
 * Measured live in LAI-582: the label is `harness · device` (D-118), so two
 * Claude Code agents on one laptop read the same on the card, in the picker,
 * in History and in the List. Each now carries the name its owner gave it, in
 * brackets, and only because the two collide; `ag-desktop` stays
 * `Codex · desktop-2`.
 */
void describe('two agents that share a harness and a device', () => {
  const twin = {
    ...AGENTS[0],
    id: 'ag-twin',
    display_name: 'Second laptop agent',
    created_at: 4,
  };
  const twinView = { ...viewOf('ag-laptop'), id: twin.id, display_name: twin.display_name };
  const twins = () => {
    const w = world();
    // t1 gets the twin; t2 keeps `ag-laptop`; an agent row on t1 is the twin's.
    Object.assign(w.tasks[0] ?? {}, { selected_agent: twinView });
    w.activity.unshift(
      event({ actor_kind: 'agent', actor_token_id: 'tok-t', agent_id: 'ag-twin', created_at: NOW }),
    );
    const stub: ApiStub = {
      ...w.stub,
      '/api/v1/agents': { data: [...AGENTS, twin], next_cursor: null },
    };
    return stub;
  };
  const FIRST = 'Claude Code · laptop-1 (Laptop agent)';
  const SECOND = 'Claude Code · laptop-1 (Second laptop agent)';
  const folded = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

  void test('the cards, the picker and History tell them apart, in both themes', async () => {
    const h = await open('/board?project=laika-core&task=t1', twins());
    try {
      const chip = (id: string) => h.page.locator(`article.card[data-task-id="${id}"] .agent-chip`);
      await chip('t2').waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        // Read aloud in full; on screen, the name that differs (LAI-583).
        assert.equal(folded(await chip('t2').textContent()), FIRST, theme);
        assert.equal(folded(await chip('t1').textContent()), SECOND, theme);
        const shown = (id: string) =>
          chip(id).evaluate((el) => {
            const copy = el.cloneNode(true) as HTMLElement;
            for (const hidden of copy.querySelectorAll('.visually-hidden')) hidden.remove();
            return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
          });
        assert.equal(await shown('t1'), 'Claude Code · Second laptop agent', theme);
        assert.equal(await shown('t2'), 'Claude Code · Laptop agent', theme);
        assert.match(
          (await chip('t1').getAttribute('title')) ?? '',
          /on laptop-1 \(Second laptop agent\)$/,
        );
        assert.equal(folded(await chip('t3').textContent()), 'Codex · desktop-2', theme);
      }

      const box = await agentBox(h);
      await box.click();
      await until(async () => (await optionsOpen(h.page, box)).length >= 3);
      const offered = (await optionsOpen(h.page, box)).map((o) => o.text);
      assert.ok(
        offered.some((t) => t.includes('laptop-1 (Laptop agent)')),
        `picker: ${offered.join(' | ')}`,
      );
      assert.ok(
        offered.some((t) => t.includes('laptop-1 (Second laptop agent)')),
        `picker: ${offered.join(' | ')}`,
      );
      await h.page.keyboard.press('Escape');

      await h.page.locator('#tab-history').click();
      const history = h.page.locator('#panel-history');
      await history.waitFor({ timeout: 10_000 });
      const who = () => history.locator('.panel-event-who').allInnerTexts();
      await until(async () => (await who()).includes(`Ada Lovelace via ${SECOND}`));
      const rows = await who();
      assert.ok(rows.includes(`Ada Lovelace via ${SECOND}`), rows.join(' | '));
      assert.ok(rows.includes(`Ada Lovelace via ${FIRST}`), rows.join(' | '));
    } finally {
      await h.close();
    }
  });

  void test('the List tells them apart, and says so on hover', async () => {
    const h = await open('/list?project=laika-core', twins());
    try {
      const cell = (id: string) =>
        h.page.locator(`tbody tr[data-task-id="${id}"] .list-agent-cell`);
      await cell('t1').waitFor({ timeout: 20_000 });
      assert.equal(folded(await cell('t2').textContent()), FIRST);
      assert.equal(folded(await cell('t1').textContent()), SECOND);
      assert.match(
        (await cell('t1').getAttribute('title')) ?? '',
        /^Claude Code · laptop-1 \(Second laptop agent\) — /,
      );
      // On screen, the narrow cell shows what differs, not two `laptop…`.
      const visible = (id: string) =>
        cell(id).evaluate((el) => {
          const copy = el.cloneNode(true) as HTMLElement;
          for (const hidden of copy.querySelectorAll('.visually-hidden')) hidden.remove();
          return (copy.textContent ?? '').trim();
        });
      assert.equal(await visible('t1'), 'Second laptop agent');
      assert.equal(await visible('t2'), 'Laptop agent');
      assert.equal(await visible('t3'), 'desktop-2', 'an agent with no twin keeps its device');
    } finally {
      await h.close();
    }
  });
});
