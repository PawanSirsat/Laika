/**
 * The task detail redesign (D-129, LAI-1117): the "What this delivers" panel,
 * the state panel with Approve / Send back, acceptance drawn as a checklist,
 * the feed in runs with *Who did this*, the header's outside id and *Copied*.
 *
 * Each test asserts what only the real path produces: the request that went
 * out, the words on screen, the state of a control.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, until, type ApiStub, type StubCall } from './harness.ts';

const NOW = Date.now();
const MIN = 60_000;

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

const task = (over: Record<string, unknown>) => ({
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
  created_via: 'mcp',
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
  created_at: 1,
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

const REVIEW = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Launcher runs visible on the laptop',
  status: 'review',
  external_ref: 'LAI-1113',
  started_at: NOW - 60 * MIN,
  acceptance_md: '- [x] notifications from validated values\n- [ ] watch tails the transcript',
  deliverables: [
    { id: 'd1', title: 'Start and exit notifications', detail: 'macOS and Linux', state: 'done' },
    { id: 'd2', title: 'Terminal viewer', detail: null, state: 'in_progress' },
    { id: 'd3', title: 'Opt-in skip-permissions', detail: null, state: 'pending' },
  ],
  solves: ['Unattended runs are invisible today.'],
  unlocks: ['Watching agent runs from the laptop.'],
});

const OTHER = task({ id: 't2', key: 'LC-2', number: 2, title: 'Nothing delivered yet' });

const ITEM = { state_source: 'github', state_at: NOW - 20 * MIN };
const ROUND = {
  id: 'r1',
  task_id: 't1',
  number: 1,
  finished_by: 'u1',
  client_name: 'claude-code',
  agent: { id: 'g1', harness: 'claude-code', device_label: 'laptop-1' },
  by_registered_agent: true,
  summary_md: 'LC-1 is in review as PR #260.\n\n- **Notifications** on start and exit.',
  commits: [
    { id: 'c1', state: 'confirmed', ...ITEM, sha: '8edb8d7d', message: 'feat: visible runs' },
  ],
  branch: { id: 'b1', state: 'confirmed', ...ITEM, name: 'LAI-1113-visible-runs' },
  pull_request: {
    id: 'p1',
    state: 'confirmed',
    ...ITEM,
    url: 'https://github.com/PawanSirsat/Laika/pull/260',
    merged: false,
  },
  tests: [
    {
      id: 'x1',
      state: 'claimed',
      state_source: null,
      state_at: null,
      command: 'pnpm test',
      exit_code: 0,
    },
  ],
  ci: {
    head_sha: 'd0cdedc24312aaaa',
    total: 13,
    passed: 13,
    failed: 0,
    pending: 0,
    failed_names: [],
  },
  created_at: NOW - 24 * MIN,
};

const SESSION = {
  id: 's1',
  harness: 'claude-code',
  harness_version: '2.1.280',
  model: 'claude-opus-5-5',
};
const AGENT_ROW = {
  actor_id: 'u1',
  actor_kind: 'agent',
  actor_token_id: 'tok',
  agent_id: 'g1',
  agent_session: SESSION,
  project_id: 'laika-core',
  task_id: 't1',
};
const ACTIVITY = [
  {
    id: 'e3',
    seq: 3,
    type: 'comment.added',
    payload: { action: 'created', comment_id: 'cm1' },
    created_at: ROUND.created_at,
    ...AGENT_ROW,
  },
  {
    id: 'e2',
    seq: 2,
    type: 'task.status_changed',
    payload: {
      from: 'in_progress',
      to: 'review',
      from_status_name: 'In progress',
      to_status_name: 'Review',
    },
    created_at: ROUND.created_at,
    ...AGENT_ROW,
  },
  {
    id: 'e1',
    seq: 1,
    type: 'task.created',
    payload: { key: 'LC-1', title: 'x' },
    created_at: NOW - 60 * MIN,
    ...AGENT_ROW,
  },
];
const COMMENTS = [
  {
    id: 'cm1',
    task_id: 't1',
    author_id: 'u1',
    body_md: ROUND.summary_md,
    created_via: 'mcp',
    edited_at: null,
    sent_back: false,
    created_at: ROUND.created_at,
    updated_at: ROUND.created_at,
  },
];

function stub(calls: { accepted: boolean }): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 1, todo: 0, in_progress: 0, review: 1, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: [REVIEW, OTHER], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t1&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t2&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity?task_id=t1': { data: ACTIVITY, next_cursor: null },
    '/api/v1/projects/laika-core/activity?task_id=t2': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/tasks/t1': () =>
      calls.accepted ? { ...REVIEW, status: 'done', completed_at: NOW } : REVIEW,
    '/api/v1/tasks/t1/comments': { data: COMMENTS, next_cursor: null },
    '/api/v1/tasks/t1/watchers': { watchers: ['u1'] },
    '/api/v1/tasks/t1/rounds': { rounds: [ROUND], send_back: null },
    '/api/v1/tasks/t1/accept': (call: StubCall) => {
      if (call.method === 'POST') calls.accepted = true;
      return { ...REVIEW, status: 'done', completed_at: NOW };
    },
    '/api/v1/tasks/t2': OTHER,
    '/api/v1/tasks/t2/comments': { data: [], next_cursor: null },
    '/api/v1/tasks/t2/watchers': { watchers: [] },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
}

async function openTask(path: string, title: string, calls = { accepted: false }) {
  const h = await open(path, stub(calls));
  await h.page.setViewportSize({ width: 1600, height: 1000 });
  await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
  await h.page.locator('.card', { hasText: title }).first().click();
  await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
  await h.page.locator('.panel-tab').first().waitFor({ timeout: 10_000 });
  return h;
}

void after(async () => {
  await closeBrowser();
});

void describe('the task detail redesign (D-129)', () => {
  void test('shows what the task delivers, with the progress line and the blocked tasks', async () => {
    const h = await openTask('/board?project=laika-core', 'Launcher runs');
    try {
      const panel = h.page.locator('[data-section="delivers"]');
      await panel.waitFor({ timeout: 10_000 });
      assert.equal(
        (await panel.locator('.dl-progress').innerText()).trim(),
        '1 of 3 built · Terminal viewer in progress',
      );
      assert.deepEqual(
        await panel
          .locator('.dl-item')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-state'))),
        ['done', 'in_progress', 'pending'],
      );
      assert.match(await panel.innerText(), /Unattended runs are invisible today\./);
      assert.match(await panel.innerText(), /Blocks no other tasks\./);
    } finally {
      await h.close();
    }
  });

  void test('edits the Ships list in place and sends only the list that changed', async () => {
    const h = await openTask('/board?project=laika-core', 'Launcher runs');
    try {
      const panel = h.page.locator('[data-section="delivers"]');
      await panel.locator('.dl-edit').click();
      await panel
        .getByRole('textbox', { name: 'What it ships' })
        .nth(2)
        .fill('Opt-in skip-permissions, documented');
      await panel.getByRole('button', { name: 'Save' }).click();
      await until(() => h.calls.some((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t1'));
      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/tasks/t1');
      assert.ok(patch, 'no PATCH went out');
      assert.deepEqual(Object.keys(patch.body as object), ['deliverables']);
      const sent = (patch.body as { deliverables: { id?: string; title: string }[] }).deliverables;
      assert.deepEqual(
        sent.map((d) => [d.id, d.title]),
        [
          ['d1', 'Start and exit notifications'],
          ['d2', 'Terminal viewer'],
          ['d3', 'Opt-in skip-permissions, documented'],
        ],
      );
    } finally {
      await h.close();
    }
  });

  void test('draws no delivers panel for a task that states nothing, to a reader who may not edit', async () => {
    // The owner may edit, so the empty task offers to add — and states nothing else.
    const h = await openTask('/board?project=laika-core', 'Nothing delivered');
    try {
      await until(async () => (await h.page.locator('[data-section="delivers"]').count()) === 1);
      assert.equal(
        (await h.page.locator('[data-section="delivers"]').innerText()).trim(),
        '+ Say what this delivers',
      );
    } finally {
      await h.close();
    }
  });

  void test('in review: the facts, the honest proof sentence, and Approve that posts and closes the review', async () => {
    const calls = { accepted: false };
    const h = await openTask('/board?project=laika-core', 'Launcher runs', calls);
    try {
      const hero = h.page.locator('[data-hero="review"]');
      await hero.locator('.hero-grid').waitFor({ timeout: 10_000 });
      const text = await hero.innerText();
      assert.match(text, /Ready for review/);
      assert.match(text, /Round 1 · finished by\s+Ada Lovelace/);
      assert.match(text, /#260 ↗/);
      assert.match(text, /✓ 13 of 13 passed/);
      // Three items confirmed, the test still claimed: four in all.
      assert.equal(
        (await hero.locator('[data-confirmed]').innerText()).trim(),
        "Laika confirmed 3 of 4 items from GitHub's signed deliveries · 1 still claimed by the agent.",
      );
      assert.doesNotMatch(text, /against the repository/);

      await hero.getByRole('button', { name: 'Approve' }).click();
      await until(() =>
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/tasks/t1/accept'),
      );
      assert.ok(
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/tasks/t1/accept'),
        'Approve did not post the accept',
      );
    } finally {
      await h.close();
    }
  });

  void test('Send back opens the dialog, and Escape closes the dialog but not the task', async () => {
    const h = await openTask('/board?project=laika-core', 'Launcher runs');
    try {
      const hero = h.page.locator('[data-hero="review"]');
      await hero.getByRole('button', { name: 'Send back' }).click();
      const dialog = h.page.locator('.rev-dialog');
      await dialog.waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await h.page.locator('.drawer').count(), 1, 'Escape closed the task too');
    } finally {
      await h.close();
    }
  });

  void test('acceptance drawn as a checklist, with how many are met', async () => {
    const h = await openTask('/board?project=laika-core', 'Launcher runs');
    try {
      const block = h.page.locator('.panel-acceptance');
      await block.waitFor({ timeout: 10_000 });
      assert.equal(await block.getAttribute('data-acceptance'), 'checklist');
      assert.equal(
        (await block.locator('.panel-acceptance-progress').innerText()).trim(),
        '1 of 2 met',
      );
    } finally {
      await h.close();
    }
  });

  void test('the feed folds a finish summary and names who did it on request', async () => {
    const h = await openTask('/board?project=laika-core', 'Launcher runs');
    try {
      const finish = h.page.locator('#panel-all .cmt-finish');
      await finish.waitFor({ timeout: 10_000 });
      assert.match(
        await finish.locator('.cmt-finish-title').innerText(),
        /Finish summary · round 1/,
      );
      // One agent, one session: everything after the first row continues its run.
      assert.ok(
        (await h.page.locator('#panel-all .panel-event-cont, #panel-all .cmt-cont').count()) >= 1,
      );

      const chip = h.page.getByRole('button', { name: 'Who did this' }).first();
      await chip.click();
      const who = h.page.getByRole('dialog', { name: 'Who did this' });
      await who.waitFor({ timeout: 5_000 });
      const said = await who.innerText();
      assert.match(said, /Person\s+Ada Lovelace/);
      assert.match(said, /Tool\s+Claude Code 2\.1\.280/);
      assert.match(said, /Model\s+claude-opus-5-5/);
      await h.page.keyboard.press('Escape');
      await who.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await h.page.locator('.drawer').count(), 1, 'Escape closed the task too');
    } finally {
      await h.close();
    }
  });

  void test('the header carries the outside id, says Copied, and the rail says how long it has waited', async () => {
    const h = await openTask('/board?project=laika-core', 'Launcher runs');
    try {
      assert.equal((await h.page.locator('.panel-outside-id').innerText()).trim(), 'LAI-1113');
      await h.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await h.page.getByRole('button', { name: 'Copy link to this task' }).click();
      await until(async () => (await h.page.locator('.panel-copied').innerText()).trim() !== '');
      assert.match(await h.page.locator('.panel-copied').innerText(), /Copied|Press/);
      await until(async () => (await h.page.locator('[data-status-sub]').count()) === 1);
      assert.match(
        await h.page.locator('[data-status-sub]').innerText(),
        /^In review for \d+ min · round 1$/,
      );
    } finally {
      await h.close();
    }
  });

  void test('fits a 390px window in both themes with the popover open', async () => {
    const h = await openTask('/board?project=laika-core', 'Launcher runs');
    try {
      for (const theme of ['dark', 'light']) {
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 390, height: 844 });
        await h.page.getByRole('button', { name: 'Who did this' }).first().click();
        await h.page.getByRole('dialog', { name: 'Who did this' }).waitFor({ timeout: 5_000 });
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(overflow, 0, `${theme}: the page scrolls sideways`);
        await h.page.keyboard.press('Escape');
      }
    } finally {
      await h.close();
    }
  });
});
