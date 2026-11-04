/**
 * The state panel complete (LAI-1122): the review panel's commits and test
 * runs, *Full summary in activity ↓*, the sent-back panel's round evidence,
 * the Proof section folded under the review panel with everything still in
 * the page, and each round's decision — *Sent back by*, *Accepted by*.
 *
 * Each test asserts what only the real path produces: the words on screen,
 * which rows exist before and after a toggle, the state of a `<details>`.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

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
  started_at: NOW - 90 * MIN,
  completed_at: null,
  ...over,
});

const REVIEW = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Launcher runs visible',
  status: 'review',
});
const SENT = task({
  id: 't3',
  key: 'LC-3',
  number: 3,
  title: 'Quote the viewer path',
  status: 'in_progress',
  send_back: {
    reason_md: 'The viewer breaks on a space.',
    decided_by: 'u1',
    created_at: NOW - 6 * MIN,
  },
});
const DONE = task({
  id: 't4',
  key: 'LC-4',
  number: 4,
  title: 'Accepted work',
  status: 'done',
  completed_at: NOW - 30 * MIN,
});

const item = (id: string, state = 'confirmed') => ({
  id,
  state,
  state_source: state === 'claimed' ? null : 'github',
  state_at: state === 'claimed' ? null : NOW - 20 * MIN,
});
const run = (id: string, command: string, exit_code = 0) => ({
  ...item(id, 'claimed'),
  command,
  exit_code,
});

const round = (over: Record<string, unknown>) => ({
  id: 'r',
  task_id: 't1',
  number: 1,
  finished_by: 'u1',
  client_name: null,
  agent: { id: 'g1', harness: 'claude-code', device_label: 'laptop-1' },
  by_registered_agent: true,
  summary_md: 'Done.',
  commits: [],
  branch: null,
  pull_request: null,
  tests: [],
  ci: null,
  decision: null,
  created_at: NOW - 60 * MIN,
  ...over,
});

const RUNS = [
  'node --test a.test.ts',
  'node --test b.test.ts',
  'node --test c.test.ts',
  'node --test d.test.ts',
  'node --test e.test.ts',
  'pnpm exec tsc --noEmit',
];

const R2 = round({
  id: 'r2',
  number: 2,
  summary_md: 'LC-1 is in review as PR #260.\n\n- **Notifications** on start and exit.',
  commits: [
    { ...item('c1'), sha: '8edb8d7d11112222', message: 'feat(cli): launcher runs are visible' },
    { ...item('c2'), sha: '3d8662ab33334444', message: 'chore(tasks): LC-1 to review' },
  ],
  pull_request: {
    ...item('p1'),
    url: 'https://github.com/PawanSirsat/Laika/pull/260',
    merged: false,
  },
  tests: RUNS.map((command, i) => run(`x${String(i)}`, command)),
  ci: {
    head_sha: 'd0cdedc24312aaaa',
    total: 13,
    passed: 13,
    failed: 0,
    pending: 0,
    failed_names: [],
  },
  created_at: NOW - 24 * MIN,
});
const R1 = round({
  id: 'r1',
  number: 1,
  summary_md: 'First go.',
  decision: {
    kind: 'sent_back',
    decided_by: 'u1',
    reason_md: 'Quote the worktree path and add a test.',
    created_at: NOW - 40 * MIN,
  },
  created_at: NOW - 50 * MIN,
});

const SENT_ROUND = round({
  id: 'r31',
  task_id: 't3',
  number: 1,
  commits: [
    { ...item('s1'), sha: 'aaaabbbbcccc1111', message: 'feat: the Terminal viewer' },
    { ...item('s2'), sha: 'ddddeeeeffff2222', message: 'test: the viewer opens' },
  ],
  pull_request: {
    ...item('sp'),
    url: 'https://github.com/PawanSirsat/Laika/pull/261',
    merged: false,
  },
  tests: [run('st1', 'pnpm --filter cli test'), run('st2', 'pnpm lint')],
  ci: {
    head_sha: 'ddddeeeeffff2222',
    total: 3,
    passed: 3,
    failed: 0,
    pending: 0,
    failed_names: [],
  },
  decision: {
    kind: 'sent_back',
    decided_by: 'u1',
    reason_md: 'The viewer breaks on a space.',
    created_at: NOW - 6 * MIN,
  },
  created_at: NOW - 20 * MIN,
});

const DONE_ROUND = round({
  id: 'r41',
  task_id: 't4',
  number: 1,
  commits: [{ ...item('d1'), sha: '9999888877776666', message: 'fix: the thing' }],
  decision: { kind: 'accepted', decided_by: 'u1', reason_md: null, created_at: NOW - 30 * MIN },
  created_at: NOW - 45 * MIN,
});

const FINISH_COMMENT = {
  id: 'cm2',
  task_id: 't1',
  author_id: 'u1',
  body_md: R2.summary_md,
  created_via: 'mcp',
  edited_at: null,
  sent_back: false,
  created_at: R2.created_at,
  updated_at: R2.created_at,
};

const empty = { data: [], next_cursor: null };

function stub(): ApiStub {
  const perTask = (
    id: string,
    body: unknown,
    rounds: unknown,
    comments: unknown[] = [],
  ): ApiStub => ({
    [`/api/v1/tasks/${id}`]: body,
    [`/api/v1/tasks/${id}/comments`]: { data: comments, next_cursor: null },
    [`/api/v1/tasks/${id}/watchers`]: { watchers: [] },
    [`/api/v1/tasks/${id}/rounds`]: rounds,
    [`/api/v1/projects/laika-core/tasks?parent=${id}&limit=200`]: empty,
    [`/api/v1/projects/laika-core/activity?task_id=${id}`]: empty,
  });
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
          task_counts: { backlog: 0, todo: 0, in_progress: 1, review: 1, done: 1, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': {
      data: [REVIEW, SENT, DONE],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
    '/api/v1/projects/laika-core/sprints': empty,
    '/api/v1/projects/laika-core/tags': { tags: [] },
    ...perTask('t1', REVIEW, { rounds: [R2, R1], send_back: null }, [FINISH_COMMENT]),
    ...perTask('t3', SENT, {
      rounds: [SENT_ROUND],
      send_back: {
        id: 'sb1',
        reason_md: 'The viewer breaks on a space.',
        decided_by: 'u1',
        comment_id: null,
        round_number: 1,
        created_at: NOW - 6 * MIN,
      },
    }),
    ...perTask('t4', DONE, { rounds: [DONE_ROUND], send_back: null }),
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

async function openTask(title: string) {
  const h = await open('/board?project=laika-core', stub());
  await h.page.setViewportSize({ width: 1600, height: 1000 });
  await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
  await h.page.locator('.card', { hasText: title }).first().click();
  await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
  return h;
}

void after(async () => {
  await closeBrowser();
});

void describe('the state panel complete (LAI-1122)', () => {
  void test('in review: the commits, the first four runs, then all six on request', async () => {
    const h = await openTask('Launcher runs visible');
    try {
      const hero = h.page.locator('[data-hero="review"]');
      const commits = hero.locator('[data-list="commits"]');
      await commits.waitFor({ timeout: 10_000 });
      assert.deepEqual(await commits.locator('.hero-sha').allInnerTexts(), [
        '8edb8d7d1111',
        '3d8662ab3333',
      ]);
      assert.match(await commits.innerText(), /feat\(cli\): launcher runs are visible/);
      // The agent's mark: *C* for Claude Code, beside its name.
      assert.equal(await hero.locator('.hero-agent .hero-agentmark').innerText(), 'C');
      assert.match(await hero.locator('.hero-agent').innerText(), /Claude Code · laptop-1/);

      const runs = hero.locator('[data-list="tests"]');
      const commands = () => runs.locator('.hero-run-command').allInnerTexts();
      assert.deepEqual(await commands(), RUNS.slice(0, 4));
      assert.equal(await runs.getByText('node --test e.test.ts').count(), 0);
      assert.match(
        await runs.locator('.hero-run').first().innerText(),
        /✓\s+node --test a\.test\.ts\s+exit 0/,
      );

      await runs.getByRole('button', { name: 'Show all 6 runs' }).click();
      await until(async () => (await commands()).length === 6);
      assert.deepEqual(await commands(), RUNS);
      await runs.getByRole('button', { name: 'Show fewer' }).click();
      await until(async () => (await commands()).length === 4);
      assert.deepEqual(await commands(), RUNS.slice(0, 4));
    } finally {
      await h.close();
    }
  });

  void test('Full summary in activity ↓ opens the round’s finish summary in the feed', async () => {
    const h = await openTask('Launcher runs visible');
    try {
      const link = h.page.locator('[data-hero="review"]').getByRole('link', {
        name: 'Full summary in activity ↓',
      });
      await link.waitFor({ timeout: 10_000 });
      assert.equal(await link.getAttribute('href'), '#activity');
      // The feed's card for the round the link names (LAI-1122's contract).
      const finish = h.page.locator('.cmt-finish[data-round="2"]');
      await finish.waitFor({ timeout: 10_000 });
      assert.equal(await finish.getAttribute('data-open'), 'false');

      await link.click();
      await until(async () => (await finish.getAttribute('data-open')) === 'true');
      assert.equal(await finish.getAttribute('data-open'), 'true', 'the link did not open it');
      assert.match(
        await finish.locator('.cmt-finish-title').innerText(),
        /Finish summary · round 2/,
      );
      assert.ok(await finish.getByText('Notifications').isVisible(), 'the summary did not open');
    } finally {
      await h.close();
    }
  });

  void test('the Proof section folds under the review panel, with every item still in the page', async () => {
    const h = await openTask('Launcher runs visible');
    try {
      const proof = h.page.locator('[data-section="proof"]');
      await proof.waitFor({ timeout: 10_000 });
      await until(async () => (await proof.locator('details.ev-fold').count()) === 1);
      const fold = proof.locator('details.ev-fold');
      assert.equal(await fold.evaluate((d) => (d as HTMLDetailsElement).open), false);
      assert.equal(
        (await fold.locator('summary.ev-fold-summary').innerText()).trim(),
        'Proof · round 2 · 3 of 9 confirmed',
      );
      // Folded, not gone: both rounds and their items are in the DOM, unseen.
      assert.equal(await proof.locator('.ev-round').count(), 2);
      assert.equal(await proof.locator('.ev-round').first().isVisible(), false);
      assert.equal((await proof.locator('.ev-item').count()) > 0, true);

      await fold.locator('summary.ev-fold-summary').click();
      await proof.locator('.ev-round').first().waitFor({ timeout: 5_000 });
      // Round 2 waits for a decision: no decision line on it.
      assert.equal(await proof.locator('[data-round="2"] [data-decision]').count(), 0);

      // The earlier round says who sent it back, and why.
      await proof.locator('.ev-earlier > summary').click();
      const decided = proof.locator('[data-round="1"] [data-decision="sent_back"]');
      await decided.waitFor({ timeout: 5_000 });
      const said = await decided.innerText();
      assert.match(said, /Sent back by\s+Ada Lovelace/);
      assert.match(said, /Quote the worktree path and add a test\./);
    } finally {
      await h.close();
    }
  });

  void test('sent back: Round 1 evidence, and Show commits & tests toggles its lists', async () => {
    const h = await openTask('Quote the viewer path');
    try {
      const hero = h.page.locator('[data-hero="sent_back"]');
      const line = hero.locator('[data-round-evidence="1"]');
      await line.waitFor({ timeout: 10_000 });
      const text = await line.innerText();
      assert.match(text, /Round 1 evidence/);
      assert.match(text, /PR #261 not merged/);
      assert.match(text, /CI 3\/3 passed/);
      assert.match(text, /2 commits/);
      assert.match(text, /2 tests passed/);
      assert.equal(await hero.locator('.hero-lists').count(), 0);

      await line.getByRole('button', { name: 'Show commits & tests' }).click();
      await hero.locator('.hero-lists').waitFor({ timeout: 5_000 });
      assert.deepEqual(await hero.locator('.hero-sha').allInnerTexts(), [
        'aaaabbbbcccc',
        'ddddeeeeffff',
      ]);
      assert.deepEqual(await hero.locator('.hero-run-command').allInnerTexts(), [
        'pnpm --filter cli test',
        'pnpm lint',
      ]);
      await line.getByRole('button', { name: 'Hide' }).click();
      await until(async () => (await hero.locator('.hero-lists').count()) === 0);

      // The proof stays open while sent back; its round says it was sent
      // back, and leaves the reason to the note above it.
      const proof = h.page.locator('[data-section="proof"]');
      await proof.locator('.ev-round').waitFor({ timeout: 10_000 });
      assert.equal(await proof.locator('details.ev-fold').count(), 0);
      assert.match(
        await proof.locator('[data-decision="sent_back"]').innerText(),
        /Sent back by\s+Ada Lovelace/,
      );
      assert.equal(await proof.locator('.ev-decision-reason').count(), 0);
      assert.match(
        await proof.locator('.ev-sendback').innerText(),
        /The viewer breaks on a space\./,
      );
    } finally {
      await h.close();
    }
  });

  void test('an accepted round says who accepted it, with no reason', async () => {
    const h = await openTask('Accepted work');
    try {
      const proof = h.page.locator('[data-section="proof"]');
      const decided = proof.locator('[data-decision="accepted"]');
      await decided.waitFor({ timeout: 10_000 });
      assert.match(await decided.innerText(), /Accepted by\s+Ada Lovelace/);
      assert.equal(await decided.locator('.ev-decision-reason').count(), 0);
      assert.equal(await proof.locator('details.ev-fold').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('fits a 390px window in both themes with every run showing', async () => {
    const h = await openTask('Launcher runs visible');
    try {
      const runs = h.page.locator('[data-hero="review"] [data-list="tests"]');
      await runs.getByRole('button', { name: 'Show all 6 runs' }).click();
      for (const theme of ['dark', 'light']) {
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 390, height: 844 });
        await runs.locator('.hero-run').nth(5).waitFor({ timeout: 5_000 });
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(overflow, 0, `${theme}: the page scrolls sideways`);
      }
    } finally {
      await h.close();
    }
  });
});
