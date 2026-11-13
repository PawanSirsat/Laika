/**
 * The task feed as the design draws it (D-129, LAI-1122): runs under one
 * header row with the agent chip that opens *Who did this*, a mark and the
 * design's words per event, comments as cards, a finish summary folded with
 * how many points it hides, Edit and Delete on the reader's own comments, and
 * the composer's resting box.
 *
 * Each test asserts what only the real path produces: the request that went
 * out, the words on screen, the element a run draws once.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { answerConfirm } from './confirm.ts';
import {
  closeBrowser,
  open,
  reply,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { NEVER_REPORTED } from '../helpers/launcher.ts';
import { tipText } from './tooltip-probe.ts';

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

const TASK = {
  id: 't1',
  key: 'LC-1',
  number: 1,
  project_id: 'laika-core',
  title: 'Launcher runs visible on the laptop',
  description_md: '',
  acceptance_md: null,
  deliverables: [{ id: 'd1', title: 'Terminal viewer', detail: null, state: 'done' }],
  solves: [],
  unlocks: [],
  status: 'in_progress',
  priority: 'p2',
  assignee_id: 'u1',
  created_by: 'u1',
  created_via: 'mcp',
  created_by_client: 'Polly',
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 3,
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
  created_at: NOW - 60 * MIN,
  updated_at: NOW - 4 * MIN,
  started_at: NOW - 59 * MIN,
  completed_at: null,
};

const SUMMARY = [
  'LC-1 is in review as PR #260. CI is green on every gate job: cli, lint and format, server and web.',
  '',
  '- **Notifications** on run start and exit, built only from a checked task key.',
  '- **watch**: read-only, shows audit events and the transcript with control characters stripped.',
  '- **Terminal viewer**: runs the watch command; closing the window never stops the run.',
  '- **permissions: skip** keeps the deny list and the caps.',
  '',
  'The D-128 draft is in the PR body.',
].join('\n');
const FINISHED_AT = NOW - 24 * MIN;

const ROUND = {
  id: 'r1',
  task_id: 't1',
  number: 1,
  finished_by: 'u1',
  client_name: 'claude-code',
  agent: { id: 'g1', harness: 'claude-code', device_label: 'laptop-1' },
  by_registered_agent: true,
  summary_md: SUMMARY,
  commits: [],
  branch: null,
  pull_request: null,
  tests: [],
  ci: null,
  created_at: FINISHED_AT,
};

const SESSION = {
  id: 's1',
  harness: 'claude-code',
  harness_version: '2.1.280',
  model: 'claude-opus-5-5',
};
const BY_AGENT = {
  actor_id: 'u1',
  actor_kind: 'agent',
  actor_token_id: 'tok',
  agent_id: 'g1',
  agent_session: SESSION,
  project_id: 'laika-core',
  task_id: 't1',
};
const BY_ADA = {
  actor_id: 'u1',
  actor_kind: 'user',
  actor_token_id: null,
  project_id: 'laika-core',
  task_id: 't1',
};
const BY_GRACE = { ...BY_ADA, actor_id: 'u2' };

/** Oldest first here, served newest first as the server does. */
const OLDEST_FIRST = [
  { id: 'e1', type: 'task.created', payload: { key: 'LC-1' }, at: -60, by: BY_AGENT },
  {
    id: 'e2',
    type: 'task.agent_selected',
    payload: { from: null, to: 'g1' },
    at: -60,
    by: BY_AGENT,
  },
  {
    id: 'e3',
    type: 'task.status_changed',
    payload: {
      from: 'backlog',
      to: 'in_progress',
      from_status_name: 'Backlog',
      to_status_name: 'In progress',
      via: 'claim',
    },
    at: -59,
    by: BY_AGENT,
  },
  {
    id: 'e4',
    type: 'task.updated',
    payload: { field: 'claim', from: null, to: { generation: 1, session_id: 's1' } },
    at: -59,
    by: BY_AGENT,
  },
  {
    id: 'e5',
    type: 'task.updated',
    payload: {
      field: 'deliverables',
      marked: [{ id: 'd1', title: 'Terminal viewer', from: 'in_progress', to: 'done' }],
    },
    at: -30,
    by: BY_AGENT,
  },
  {
    id: 'e6',
    type: 'comment.added',
    payload: { action: 'created', comment_id: 'cm1' },
    at: -24,
    by: BY_AGENT,
  },
  {
    id: 'e7',
    type: 'task.status_changed',
    payload: {
      from: 'in_progress',
      to: 'review',
      from_status_name: 'In progress',
      to_status_name: 'Review',
    },
    at: -24,
    by: BY_AGENT,
  },
  {
    id: 'e8',
    type: 'comment.added',
    payload: { action: 'created', comment_id: 'cm2' },
    at: -9,
    by: BY_ADA,
  },
  {
    id: 'e9',
    type: 'task.status_changed',
    payload: {
      from: 'review',
      to: 'in_progress',
      from_status_name: 'Review',
      to_status_name: 'In progress',
      via: 'send_back',
    },
    at: -6,
    by: BY_GRACE,
  },
  {
    id: 'e10',
    type: 'comment.added',
    payload: { action: 'created', comment_id: 'cm3' },
    at: -6,
    by: BY_GRACE,
  },
  // An agent of Grace's this reader may not see (LAI-1011).
  {
    id: 'e11',
    type: 'task.updated',
    payload: { field: 'claim', from: null, to: { generation: 2 } },
    at: -4,
    by: {
      ...BY_GRACE,
      actor_kind: 'agent',
      actor_token_id: null,
      agent_id: null,
      agent_redacted: true,
    },
  },
];
const ACTIVITY = OLDEST_FIRST.map((e, i) => ({
  id: e.id,
  seq: i + 1,
  type: e.type,
  payload: e.payload,
  created_at: NOW + e.at * MIN,
  ...e.by,
})).reverse();

const comment = (over: Record<string, unknown>) => ({
  task_id: 't1',
  created_via: 'web',
  edited_at: null,
  sent_back: false,
  ...over,
});
const COMMENTS = [
  comment({
    id: 'cm1',
    author_id: 'u1',
    body_md: SUMMARY,
    created_via: 'mcp',
    created_at: FINISHED_AT,
    updated_at: FINISHED_AT,
  }),
  comment({
    id: 'cm2',
    author_id: 'u1',
    body_md: 'Checking the Terminal viewer before I merge.',
    edited_at: NOW - 8 * MIN,
    created_at: NOW - 9 * MIN,
    updated_at: NOW - 8 * MIN,
  }),
  comment({
    id: 'cm3',
    author_id: 'u2',
    body_md: 'The viewer breaks when the worktree path has a space.',
    sent_back: true,
    created_at: NOW - 6 * MIN,
    updated_at: NOW - 6 * MIN,
  }),
];

const AGENT = {
  id: 'g1',
  owner_user_id: 'u1',
  display_name: 'Laptop agent',
  harness: 'claude-code',
  device_label: 'laptop-1',
  status: 'active',
  grants: [{ project_id: 'laika-core', scope: 'full' }],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: NOW - MIN,
  launcher: NEVER_REPORTED,
};

interface World {
  comments: Record<string, unknown>[];
}

function stub(world: World, over: Record<string, unknown> = {}): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'member' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 0, in_progress: 1, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: [TASK], next_cursor: null },
    '/api/v1/projects/laika-core/tasks?parent=t1&limit=200': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'member' },
        { user_id: 'u2', name: 'Grace Hopper', email: 'grace@example.com', role: 'lead' },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': {
      users: [
        { id: 'u1', name: 'Ada Lovelace' },
        { id: 'u2', name: 'Grace Hopper' },
      ],
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity?task_id=t1': { data: ACTIVITY, next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/agents': { data: [AGENT], next_cursor: null },
    '/api/v1/tasks/t1': TASK,
    '/api/v1/tasks/t1/comments': () => ({ data: world.comments, next_cursor: null }),
    '/api/v1/tasks/t1/watchers': { watchers: ['u1'] },
    '/api/v1/tasks/t1/rounds': { rounds: [ROUND], send_back: null },
    '/api/v1/comments/cm2': (call: StubCall) => {
      if (call.method === 'PATCH') {
        const body = (call.body as { body_md: string }).body_md;
        world.comments = world.comments.map((c) =>
          c.id === 'cm2' ? { ...c, body_md: body, edited_at: NOW, updated_at: NOW } : c,
        );
        return world.comments.find((c) => c.id === 'cm2');
      }
      if (call.method === 'DELETE') {
        world.comments = world.comments.filter((c) => c.id !== 'cm2');
        return reply(204, null);
      }
      return reply(405, null);
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    ...over,
  };
}

async function openFeed(world: World = { comments: [...COMMENTS] }, over = {}) {
  const h = await open('/board?project=laika-core', stub(world, over));
  await h.page.setViewportSize({ width: 1600, height: 1000 });
  await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
  await h.page.locator('.card', { hasText: 'Launcher runs' }).first().click();
  await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
  await h.page.locator('#panel-all .feed-list').waitFor({ timeout: 10_000 });
  // The chip names the agent once the reader's own agents are read.
  await until(
    async () =>
      (await h.page.locator('#panel-all .who-chip').first().innerText()).includes('laptop-1'),
    10_000,
  );
  return h;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

void after(async () => {
  await closeBrowser();
});

void describe('the task feed (D-129, LAI-1122)', () => {
  void test('one header per run, and no avatar on the items that continue it', async () => {
    const h = await openFeed();
    try {
      const items = h.page.locator('#panel-all .feed-list > li');
      const runs = await items.evaluateAll((els) =>
        els.map((el) => ({
          run: el.getAttribute('data-run'),
          heads: el.querySelectorAll(':scope > .feed-head').length,
          avatars: el.querySelectorAll('.cmt-avatar').length,
        })),
      );
      // The agent's run: created … the move to Review (the finish comment
      // inside it); Ada's comment; Grace's reason and send-back; Grace's agent.
      assert.deepEqual(
        runs.map((r) => r.run),
        ['start', 'mid', 'mid', 'mid', 'mid', 'mid', 'end', 'solo', 'start', 'end', 'solo'],
      );
      for (const r of runs) {
        const starts = r.run === 'start' || r.run === 'solo';
        assert.equal(r.heads, starts ? 1 : 0, `a ${String(r.run)} item's header`);
        assert.equal(r.avatars, starts ? 1 : 0, `a ${String(r.run)} item's avatar`);
      }
      // The header's avatar is the thread's 36px face, and the ⓘ is gone.
      const avatar = h.page.locator('#panel-all .feed-head .cmt-avatar').first();
      assert.equal(Math.round((await avatar.boundingBox())?.width ?? 0), 36);
      assert.doesNotMatch(await h.page.locator('#panel-all').innerText(), /ⓘ/);
      // The run's rail is drawn: a continuing item has a line beside it.
      const rail = await items.nth(1).evaluate((el) => getComputedStyle(el, '::before').width);
      assert.equal(rail, '1px');
      // The header names the person and the agent; the time is exact in its title.
      const head = h.page.locator('#panel-all .feed-head').first();
      assert.equal(
        squash(await head.locator('.panel-event-who').innerText()),
        // The harness is said once when it is the agent's own (LAI-1123).
        'Ada Lovelace via Claude Code · laptop-1 · claude-opus-5-5',
      );
      assert.equal(squash(await head.locator('.who-chip').innerText()), 'Claude Code · laptop-1');
      assert.match(await tipText(head.locator('time')), /\d{4}, \d/);
    } finally {
      await h.close();
    }
  });

  void test('the chip opens Who did this on hover and on click, and Escape keeps the drawer', async () => {
    const h = await openFeed();
    try {
      const chip = h.page.locator('#panel-all .feed-head .who-chip').first();
      const who = h.page.getByRole('dialog', { name: 'Who did this' });
      await chip.hover();
      await who.waitFor({ timeout: 5_000 });
      const said = await who.innerText();
      assert.match(said, /Person\s+Ada Lovelace/);
      assert.match(said, /Agent\s+Claude Code · laptop-1 · owned by Ada Lovelace/);
      assert.match(said, /Device\s+laptop-1/);
      assert.match(said, /Tool\s+Claude Code 2\.1\.280/);
      assert.match(said, /Model\s+claude-opus-5-5/);
      await h.page.mouse.move(5, 5);
      await who.waitFor({ state: 'detached', timeout: 5_000 });

      await chip.click();
      await who.waitFor({ timeout: 5_000 });
      assert.equal(await chip.getAttribute('aria-expanded'), 'true');
      await h.page.keyboard.press('Escape');
      await who.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await h.page.locator('.drawer').count(), 1, 'Escape closed the task too');
    } finally {
      await h.close();
    }
  });

  void test('a withheld agent reads “an agent”, with no device, tool or model', async () => {
    const h = await openFeed();
    try {
      const last = h.page.locator('#panel-all .feed-list > li').last();
      const chip = last.locator('.who-chip');
      assert.equal(squash(await chip.innerText()), 'an agent');
      assert.equal(
        squash(await last.locator('.panel-event-who').innerText()),
        'Grace Hopper via an agent',
      );
      await chip.click();
      const who = h.page.getByRole('dialog', { name: 'Who did this' });
      await who.waitFor({ timeout: 5_000 });
      const said = await who.innerText();
      assert.match(said, /Person\s+Grace Hopper/);
      assert.match(said, /Agent\s+an agent/);
      assert.doesNotMatch(said, /Device|Tool|Model|laptop-1|claude/i);
      assert.doesNotMatch(await last.innerText(), /claude-opus|2\.1\.280/);
    } finally {
      await h.close();
    }
  });

  void test('each event draws its mark and the design’s words', async () => {
    const h = await openFeed();
    try {
      const rows = await h.page
        .locator('#panel-all .feed-row[data-event-icon]')
        .evaluateAll((els) =>
          els.map((el) => [
            el.querySelector('.feed-icon svg')?.getAttribute('data-icon') ?? '',
            (el.querySelector('.feed-what')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ]),
        );
      assert.deepEqual(rows, [
        ['plus', 'Created this task · via MCP · Polly'],
        ['swap', 'Sent the work request to Claude Code · laptop-1'],
        ['arrow-right', 'Moved Backlog → In progress · Claude Code 2.1.280 · claude-opus-5-5'],
        ['play', 'Accepted and started work · Claude Code 2.1.280 · claude-opus-5-5'],
        ['check', 'Marked Terminal viewer built'],
        ['arrow-right', 'Moved In progress → Review · Claude Code 2.1.280 · claude-opus-5-5'],
        ['reply', 'Sent back Review → In progress'],
        ['play', 'Accepted and started work'],
      ]);
      // The status names are pills.
      assert.deepEqual(
        await h.page
          .locator('#panel-all .feed-row[data-event-icon="sent_back"] .feed-pill')
          .allInnerTexts(),
        ['Review', 'In progress'],
      );
      // A comment's own `comment.added` row is not drawn beside the comment in All…
      assert.doesNotMatch(await h.page.locator('#panel-all').innerText(), /Commented/);
      // …and History keeps every row.
      await h.page.locator('#tab-history').click();
      await h.page.locator('#panel-history .feed-list').waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('#panel-history .panel-event').count(), ACTIVITY.length);
    } finally {
      await h.close();
    }
  });

  void test('comments are cards: a person’s edited, a reason, and a summary folded with its count', async () => {
    const h = await openFeed();
    try {
      const own = h.page.locator('#panel-all [data-comment-kind="person"]');
      assert.match(await own.innerText(), /Checking the Terminal viewer/);
      const edited = own.locator('.cmt-edited');
      assert.equal((await edited.innerText()).trim(), 'Edited');
      assert.match(await tipText(edited), /^Edited \w{3} \d/);
      assert.equal(
        await h.page.locator('#panel-all [data-comment-kind="reason"] .cmt-sent-back').count(),
        1,
      );

      const summary = h.page.locator('#panel-all .cmt-finish');
      assert.match(
        await summary.locator('.cmt-finish-title').innerText(),
        /Finish summary · round 1/,
      );
      const body = summary.locator('.cmt-finish-body');
      const fold = summary.locator('.cmt-fold');
      // Six points: the opening paragraph shows, five more are folded away.
      assert.equal((await fold.innerText()).trim(), 'Show full summary · 5 more points');
      assert.equal(await body.getAttribute('data-folded'), 'true');
      assert.equal(Math.round((await body.boundingBox())?.height ?? 0), 112);
      await fold.click();
      assert.equal((await fold.innerText()).trim(), 'Show less');
      assert.equal(await fold.getAttribute('aria-expanded'), 'true');
      assert.ok(((await body.boundingBox())?.height ?? 0) > 112, 'the summary did not open');
      assert.match(await body.innerText(), /The D-128 draft is in the PR body\./);
    } finally {
      await h.close();
    }
  });

  void test('Edit sends a PATCH of the comment with the new text, and the thread shows it', async () => {
    const world = { comments: [...COMMENTS] };
    const h = await openFeed(world);
    try {
      // Only the reader's own comments offer it: Ada wrote two, Grace one.
      assert.equal(await h.page.getByRole('button', { name: 'Edit comment' }).count(), 2);
      const own = h.page.locator('#panel-all .cmt', { hasText: 'Checking the Terminal viewer' });
      await own.getByRole('button', { name: 'Edit comment' }).click();
      const editor = own.locator('.rich-editor');
      await editor.waitFor({ timeout: 10_000 });
      await editor.getByRole('button', { name: 'Markdown source' }).click();
      const source = editor.locator('textarea');
      await source.waitFor({ timeout: 5_000 });
      await source.fill('Checked on Belka: the path is quoted.');
      await editor.getByRole('button', { name: 'Save' }).click();
      await until(() =>
        h.calls.some((c) => c.method === 'PATCH' && c.path === '/api/v1/comments/cm2'),
      );
      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/comments/cm2');
      assert.ok(patch, 'no PATCH went out');
      assert.deepEqual(patch.body, { body_md: 'Checked on Belka: the path is quoted.' });
      await editor.waitFor({ state: 'detached', timeout: 5_000 });
      await until(async () =>
        (await h.page.locator('#panel-all').innerText()).includes('the path is quoted'),
      );
      assert.match(
        await h.page.locator('#panel-all').innerText(),
        /Checked on Belka: the path is quoted\./,
      );
    } finally {
      await h.close();
    }
  });

  void test('Delete asks in the app’s dialog, then sends DELETE and drops the comment', async () => {
    const world = { comments: [...COMMENTS] };
    const h = await openFeed(world);
    try {
      const own = h.page.locator('#panel-all .cmt', { hasText: 'Checking the Terminal viewer' });
      // Cancel first: nothing goes out.
      await own.getByRole('button', { name: 'Delete comment' }).click();
      const said = await answerConfirm(h.page, false);
      assert.match(said, /Delete this comment\?/);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);

      await own.getByRole('button', { name: 'Delete comment' }).click();
      await answerConfirm(h.page, true);
      await until(() =>
        h.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/comments/cm2'),
      );
      assert.ok(h.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/comments/cm2'));
      await until(async () => (await own.count()) === 0);
      assert.equal(await own.count(), 0, 'the deleted comment is still drawn');
      assert.equal(await h.page.locator('.drawer').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('Escape in the delete dialog closes the dialog and not the task', async () => {
    const h = await openFeed();
    try {
      const own = h.page.locator('#panel-all .cmt', { hasText: 'Checking the Terminal viewer' });
      await own.getByRole('button', { name: 'Delete comment' }).click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await h.page.locator('.drawer').count(), 1, 'Escape closed the task too');
    } finally {
      await h.close();
    }
  });

  void test('the composer rests as the design draws it, and an empty thread invites a comment', async () => {
    const h = await openFeed({ comments: [] });
    try {
      const rest = h.page.locator('.panel-composer .cmt-composer-rest');
      assert.equal(squash(await rest.locator('.cmt-composer-start').innerText()), 'Add a comment…');
      assert.equal(
        squash(await rest.locator('.cmt-composer-hint').innerText()),
        'Markdown · @ to mention someone',
      );
      assert.equal(squash(await rest.locator('.cmt-composer-send').innerText()), 'Comment');
      assert.equal(
        squash(await h.page.locator('#panel-all .feed-empty').innerText()),
        'No comments yet. Ask a question here, or @mention someone to leave them a note.',
      );
      // The composer follows the thread.
      const list = await h.page.locator('#panel-all').boundingBox();
      const box = await rest.boundingBox();
      assert.ok(list !== null && box !== null && box.y >= list.y + list.height - 1);
      await rest.locator('.cmt-composer-send').click();
      await h.page.locator('.panel-composer .rich-editor').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('fits a 390px window in both themes, with a folded summary and the chip open', async () => {
    const h = await openFeed();
    try {
      for (const theme of ['dark', 'light']) {
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 390, height: 844 });
        await h.page.locator('#panel-all .feed-head .who-chip').first().click();
        await h.page.getByRole('dialog', { name: 'Who did this' }).waitFor({ timeout: 5_000 });
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(overflow, 0, `${theme}: the page scrolls sideways`);
        const drawer = await h.page
          .locator('.drawer')
          .evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.equal(drawer, 0, `${theme}: the drawer scrolls sideways`);
        await h.page.keyboard.press('Escape');
      }
    } finally {
      await h.close();
    }
  });
});
