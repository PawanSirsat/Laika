/**
 * The review gate in a browser (D-082, LAI-758): the Review page, its badge,
 * the proof it opens, accept and send back; and the task panel's Proof
 * section and the card's "sent back" marker.
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
  type StubCall,
} from './harness.ts';

const NOW = Date.now();
const HOUR = 3_600_000;

const ME = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'laika-core', role: 'lead' }],
};

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

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
    project_id: 'laika-core',
    title: 'A task',
    description_md: '',
    acceptance_md: '',
    status: 'review',
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
    send_back: null,
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    position: null,
    created_at: 1,
    updated_at: NOW - HOUR,
    started_at: null,
    completed_at: null,
    ...over,
  });

const claimed = { state: 'claimed', state_source: null, state_at: null };

const ROUND_2 = {
  id: 'r2',
  task_id: 't1',
  number: 2,
  finished_by: 'u1',
  // The client's own word, which no screen shows as the agent (D-120).
  client_name: 'omnigent on Belka',
  agent: { id: 'ag1', harness: 'omnigent', device_label: 'Belka' } as {
    id: string;
    harness: string;
    device_label: string | null;
  } | null,
  by_registered_agent: true,
  summary_md: 'Fixed the lint run',
  commits: [
    { id: 'e1', ...claimed, sha: 'abcdef0123456789abcdef0123456789abcdef01', message: 'fix: lint' },
  ],
  branch: { id: 'e2', ...claimed, name: 'build-review-gate' },
  pull_request: {
    id: 'e3',
    ...claimed,
    url: 'https://github.com/PawanSirsat/Laika/pull/42',
    merged: null,
  },
  tests: [
    { id: 'e4', ...claimed, command: 'pnpm test', exit_code: 0 },
    { id: 'e5', ...claimed, command: 'pnpm lint', exit_code: 1 },
  ],
  ci: null,
  created_at: NOW - 3 * HOUR,
};
const ROUND_1 = {
  ...ROUND_2,
  id: 'r1',
  number: 1,
  // A legacy token finished round 1: no registered agent to name.
  client_name: 'codex-mcp-client',
  agent: null,
  by_registered_agent: false,
  commits: [],
  branch: null,
  pull_request: null,
  tests: [{ id: 'e6', ...claimed, command: 'pnpm lint', exit_code: 2 }],
  created_at: NOW - 30 * HOUR,
};

const WORKED = task({ id: 't1', key: 'LC-1', number: 1, title: 'Agents never mark done' });
const BARE = task({ id: 't2', key: 'LC-2', number: 2, title: 'Moved to review by hand' });

interface QueueRow {
  task: Record<string, unknown>;
  round: typeof ROUND_2 | null;
  waiting_since: number;
  cue?: { kind: 'fast'; build_ms: number; forecast_p50_ms: number } | null;
}

/** A queue that shrinks when a task is decided, so the re-read can be seen. */
function server(
  first: QueueRow[] = [
    { task: BARE, round: null, waiting_since: NOW - 26 * HOUR },
    { task: WORKED, round: ROUND_2, waiting_since: NOW - 3 * HOUR },
  ],
): { stub: ApiStub; calls: () => StubCall[] } {
  const seen: StubCall[] = [];
  let rows: QueueRow[] = first;
  const queue = () => ({
    tasks: rows.map((r) => ({
      task: r.task,
      project: { id: 'laika-core', slug: 'laika-core', name: 'Laika Core', prefix: 'LC' },
      assignee_name: 'Ada Lovelace',
      waiting_since: r.waiting_since,
      round: r.round,
      finished_by_name: r.round === null ? null : 'Ada Lovelace',
      can_decide: true,
      cue: r.cue ?? null,
    })),
    truncated: false,
  });
  const decide = (id: string) => (call: StubCall) => {
    seen.push(call);
    const row = rows.find((r) => r.task.id === id);
    rows = rows.filter((r) => r.task.id !== id);
    return { ...(row?.task ?? {}), status: 'done' };
  };
  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/review': () => queue(),
    '/api/v1/tasks/t1/rounds': { rounds: [ROUND_2, ROUND_1], send_back: null },
    '/api/v1/tasks/t2/rounds': { rounds: [], send_back: null },
    '/api/v1/tasks/t1/accept': decide('t1'),
    '/api/v1/tasks/t2/accept': decide('t2'),
    '/api/v1/tasks/t1/send-back': decide('t1'),
  };
  return { stub, calls: () => seen };
}

void after(async () => {
  await closeBrowser();
});

void describe('the Review page', () => {
  void test('cues “check this one” on a finish far faster than forecast, and filters by it (LAI-772)', async () => {
    const h = await open(
      '/inbox?tab=review',
      server([
        { task: BARE, round: null, waiting_since: NOW - 26 * HOUR },
        {
          task: WORKED,
          round: ROUND_2,
          waiting_since: NOW - 3 * HOUR,
          cue: { kind: 'fast', build_ms: 60_000, forecast_p50_ms: 2 * HOUR },
        },
      ]).stub,
    );
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      const chip = h.page.locator('.rev-chip-check');
      await until(async () => (await chip.count()) === 1);
      assert.equal(await chip.count(), 1);
      assert.equal(await chip.innerText(), 'check this one');
      assert.match(
        (await chip.getAttribute('title')) ?? '',
        /Finished in 1 min against a forecast of 2 h, and CI has not confirmed it/,
      );
      assert.equal(await h.page.locator('[data-stat="check"] .prof-stat-value').innerText(), '1');
      await h.page.getByRole('button', { name: 'Check this one', exact: true }).click();
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-1']);
      // About the task, never the person: the cue names nobody.
      assert.doesNotMatch(await chip.innerText(), /Ada/);
    } finally {
      await h.close();
    }
  });

  void test('lists what waits, oldest first, with the proof summary and the badge', async () => {
    const h = await open('/inbox?tab=review', server().stub);
    try {
      const rows = h.page.locator('.rev-row');
      await rows.first().waitFor({ timeout: 20_000 });
      // Wait for both rows, not the first (LAI-715).
      await until(
        async () => (await h.page.locator('.rev-key').allInnerTexts()).join('|') === 'LC-2|LC-1',
      );
      assert.deepEqual(
        await h.page.locator('.rev-key').allInnerTexts(),
        ['LC-2', 'LC-1'],
        'oldest waiting first',
      );
      const worked = rows.nth(1);
      assert.match(await worked.innerText(), /1 commit/);
      assert.match(await worked.innerText(), /PR/);
      assert.match(await worked.innerText(), /✓ 1 passed/);
      assert.match(await worked.innerText(), /✗ 1 failed/);
      // The agent as harness and device (D-120), never the client's own word.
      assert.match(await worked.innerText(), /Omnigent · Belka/);
      assert.doesNotMatch(await worked.innerText(), /omnigent on Belka/);
      assert.match(await worked.innerText(), /round 2/);
      assert.match(await rows.first().innerText(), /no proof/);
      assert.match(await rows.first().innerText(), /1 d/);

      // The tab carries the count, and the sidebar's Inbox the same (LAI-796):
      // nothing is unlisted in this stub, so the sum is Review's alone.
      assert.match(await h.page.locator('.page-tab[data-tab="review"]').innerText(), /Review\s*2/);
      const badge = h.page.locator('.sidebar-link', { hasText: 'Inbox' }).locator('.sidebar-count');
      await badge.waitFor({ timeout: 10_000 });
      assert.match(await badge.innerText(), /^2/);

      // The filters mean what they say.
      await h.page.getByRole('button', { name: 'Failing tests', exact: true }).click();
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-1']);
      await h.page.getByRole('button', { name: 'Failing tests', exact: true }).click();
      await h.page.getByRole('button', { name: 'No proof', exact: true }).click();
      assert.deepEqual(await h.page.locator('.rev-key').allInnerTexts(), ['LC-2']);
    } finally {
      await h.close();
    }
  });

  void test('opening a row shows every item claimed, exit codes coloured, earlier rounds folded', async () => {
    const h = await open('/inbox?tab=review', server().stub);
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.rev-line', { hasText: 'LC-1' }).click();
      const detail = h.page.locator('.rev-detail');
      await detail.locator('.ev-round').first().waitFor({ timeout: 10_000 });
      const round2 = (cls: string) => detail.locator(`.ev-round[data-round="2"] ${cls}`);
      await until(
        async () =>
          (await round2('.ev-state-claimed').count()) === 5 &&
          (await round2('.ev-exit-pass').count()) === 1 &&
          (await round2('.ev-exit-fail').count()) === 1,
      );

      assert.equal(await detail.locator('.ev-round[data-round="2"] .ev-state-claimed').count(), 5);
      assert.equal(await detail.locator('.ev-round[data-round="2"] .ev-exit-pass').count(), 1);
      assert.equal(await detail.locator('.ev-round[data-round="2"] .ev-exit-fail').count(), 1);
      const link = detail.locator('a.ev-link');
      assert.equal(await link.getAttribute('href'), 'https://github.com/PawanSirsat/Laika/pull/42');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      // Who finished each round: the registered agent by its pair; the
      // legacy token's round by its client word, marked unregistered.
      assert.equal(
        await detail.locator('.ev-round[data-round="2"] .ev-agent').innerText(),
        'Omnigent · Belka',
      );
      assert.equal(
        await detail.locator('.ev-round[data-round="1"] .ev-agent').textContent(),
        'unregistered agent (codex-mcp-client)',
      );
      // Round 1 is kept, folded.
      const earlier = detail.locator('details.ev-earlier');
      assert.equal(await earlier.getAttribute('open'), null);
      assert.match(await earlier.locator('summary').innerText(), /Earlier round \(1\)/);
    } finally {
      await h.close();
    }
  });

  void test('accept posts, and the queue re-reads without it', async () => {
    const s = server();
    const h = await open('/inbox?tab=review', s.stub);
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.rev-line', { hasText: 'LC-2' }).click();
      await h.page.getByRole('button', { name: 'Accept', exact: true }).click();
      await h.page
        .locator('.rev-key', { hasText: 'LC-2' })
        .waitFor({ state: 'detached', timeout: 10_000 });
      assert.deepEqual(
        s.calls().map((c) => [c.method, c.path]),
        [['POST', '/api/v1/tasks/t2/accept']],
      );
    } finally {
      await h.close();
    }
  });

  void test('send back needs a reason, then posts it', async () => {
    const s = server();
    const h = await open('/inbox?tab=review', s.stub);
    try {
      await h.page.locator('.rev-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.rev-line', { hasText: 'LC-1' }).click();
      await h.page.getByRole('button', { name: 'Send back…' }).click();
      const dialog = h.page.getByRole('dialog', { name: 'Send back LC-1' });
      await dialog.waitFor({ timeout: 10_000 });

      const send = dialog.getByRole('button', { name: 'Send back' });
      assert.equal(await send.isDisabled(), true, 'nothing is sent without a reason');
      await dialog.locator('textarea').fill('The lint run exits 1: fix it before review.');
      assert.equal(await send.isDisabled(), false);
      await send.click();
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });

      const call = s.calls().find((c) => c.path === '/api/v1/tasks/t1/send-back');
      assert.deepEqual(call?.body, { reason: 'The lint run exits 1: fix it before review.' });
    } finally {
      await h.close();
    }
  });

  void test('says so when nothing waits, in both themes', async () => {
    const h = await open('/inbox?tab=review', {
      '/api/v1/me': ME,
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/review': { tasks: [], truncated: false },
    });
    try {
      await h.page.getByText('Nothing waiting for review').waitFor({ timeout: 20_000 });
      await setTheme(h.page, 'Dark');
      await h.page.getByText('Nothing waiting for review').waitFor({ timeout: 5_000 });
      await setTheme(h.page, 'Light');
    } finally {
      await h.close();
    }
  });
});

void describe('the task panel and the card (D-082)', () => {
  const SENT = task({
    id: 't7',
    key: 'LC-7',
    number: 7,
    title: 'Sent back once',
    status: 'in_progress',
    send_back: {
      reason_md: 'The lint run exits 1.',
      decided_by: 'u1',
      created_at: NOW - HOUR,
    },
  });
  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [{ ...CORE, task_counts: {}, members: [] }], next_cursor: null },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: [SENT], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t7&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/tasks/t7': SENT,
    '/api/v1/tasks/t7/comments': {
      data: [
        {
          id: 'c1',
          task_id: 't7',
          author_id: 'u1',
          body_md: 'The lint run exits 1.',
          created_via: 'web',
          edited_at: null,
          sent_back: true,
          created_at: NOW - HOUR,
          updated_at: NOW - HOUR,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/tasks/t7/watchers': { watchers: [] },
    '/api/v1/tasks/t7/rounds': {
      rounds: [{ ...ROUND_1, task_id: 't7' }],
      send_back: null,
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };

  void test('the card is marked and the panel reads the reason, then the proof', async () => {
    const h = await open('/board?project=laika-core', stub);
    try {
      const card = h.page.locator('.card', { hasText: 'Sent back once' }).first();
      await card.waitFor({ timeout: 20_000 });
      const marker = card.locator('.marker-sent-back');
      assert.match(await marker.innerText(), /sent back/);
      assert.equal(await marker.getAttribute('title'), 'Sent back: The lint run exits 1.');

      await card.click();
      const panel = h.page.locator('.drawer');
      await panel.locator('[data-section="proof"] .ev-round').waitFor({ timeout: 10_000 });
      const proof = panel.locator('[data-section="proof"]');
      assert.match(await proof.locator('.ev-sendback').innerText(), /The lint run exits 1\./);
      await until(
        async () =>
          (await proof.locator('.ev-exit-fail').count()) === 1 &&
          (await proof.locator('.ev-state-claimed').count()) === 1,
      );
      assert.equal(await proof.locator('.ev-exit-fail').count(), 1);
      assert.equal(await proof.locator('.ev-state-claimed').count(), 1);
      await panel.locator('.cmt-sent-back').first().waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });
});
