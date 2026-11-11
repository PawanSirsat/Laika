/**
 * The Command Center at `/home` (LAI-1202) in a real browser, against the
 * built SPA and a stubbed API in the shapes the server serves.
 *
 * - Every section draws from fixture rows, and each row opens what it names:
 *   the review dialog, a task in its own space.
 * - Counts lead to the filtered list.
 * - A section the reader may not read is absent: by `GET /permissions` for
 *   agents and activity, by a `403` for the task sections.
 * - Empty is one quiet line per section.
 * - One section failing leaves the rest, offers Retry, and Retry recovers; a
 *   failed re-read keeps the rows and says so.
 * - At 390px one column, attention first; at 1024 and 1440, two.
 * - The page opens no `EventSource` the shell would not open anyway.
 *
 * Every wait is followed by an assertion: `until` returns quietly on timeout.
 *
 * `LAIKA_SHOTS=<dir>` writes screenshots: light and dark, 1440, 1024 and 390,
 * and an empty organisation.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const TODAY = NOW - (NOW % DAY);
const MIN = 60_000;

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [
    { project_id: 'p1', role: 'member' },
    { project_id: 'p2', role: 'member' },
  ],
};

const project = (id: string, slug: string, name: string, prefix: string) => ({
  id,
  slug,
  name,
  prefix,
  description: null,
  repo: null,
  visibility: 'private',
  color: 'violet',
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [] as string[],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [],
  last_activity_at: 1,
});

function task(
  id: string,
  key: string,
  title: string,
  status: string,
  projectId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    key,
    project_id: projectId,
    number: Number(key.split('-')[1]),
    title,
    status,
    status_id: `st-${status}`,
    status_name: status === 'in_progress' ? 'In progress' : status === 'todo' ? 'To do' : status,
    priority: 'p2',
    assignee_id: 'u1',
    sprint_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    position: 'a0',
    ready: false,
    stale_flagged_at: null,
    blocked_by: [],
    blocks: [],
    send_back: null,
    size: null,
    comment_count: 0,
    tags: [],
    started_at: null,
    completed_at: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    selected_agent: null,
    claim: null,
    created_at: 1,
    updated_at: NOW - 10 * MIN,
    ...extra,
  };
}

const claim = (agentId: string, connection: 'live' | 'suspect') => ({
  generation: 1,
  state: 'active',
  agent_id: agentId,
  session_id: `s-${agentId}`,
  lease_expires_at: NOW + 5 * MIN,
  last_heartbeat_at: NOW,
  heartbeat_age_ms: 1_000,
  connection,
  suspect_after_ms: 90_000,
  device_label: null,
});

const RAIL = task('t1', 'LAI-1', 'Rail polish', 'in_progress', 'p1', {
  claim: claim('ag1', 'live'),
  updated_at: NOW - MIN,
});
const DRAWER = task('t2', 'OPS-2', 'Drawer keyboard order', 'in_progress', 'p2', {
  blocked_by: ['b1'],
});
const NOTES = task('t3', 'LAI-3', 'Write the release notes', 'todo', 'p1', {
  due_on: TODAY + 3 * DAY,
});
const LOGIN = task('t4', 'LAI-4', 'Fix the login copy', 'todo', 'p1', {
  due_on: TODAY - 2 * DAY,
});
const BLOCKER = task('b1', 'LAI-50', 'Shared focus trap', 'in_progress', 'p1', {
  assignee_id: 'u2',
});
const REVIEWED = task('t9', 'LAI-9', 'Cache the board query', 'review', 'p1');

const REVIEW_ITEM = {
  task: { ...REVIEWED, description_md: null, acceptance_md: null },
  project: { id: 'p1', slug: 'laika', name: 'Laika', prefix: 'LAI' },
  assignee_name: 'Ada Lovelace',
  waiting_since: NOW - 2 * DAY,
  round: null,
  finished_by_name: null,
  can_decide: true,
  cue: null,
};

const HANDOFF = {
  id: 'o1',
  kind: 'handoff',
  state: 'pending_approval',
  task_id: 't7',
  task_key: 'OPS-7',
  task_title: 'Split the export job',
  project_id: 'p2',
  project_slug: 'ops',
  from_agent: null,
  to_agent: null,
  from_agent_redacted: false,
  to_agent_redacted: false,
  checkpoint_id: null,
  checkpoint: null,
  reason: null,
  requires_approval: true,
  approved: false,
  approved_at: null,
  expires_at: NOW + 20 * MIN,
  closed_reason: null,
  created_at: NOW - 5 * MIN,
  closed_at: null,
  next_action: 'approve',
};

const agent = (id: string, name: string, status = 'active') => ({
  id,
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: name,
  harness: 'claude-code',
  device_label: null,
  status,
  grants: [],
  tokens: [],
  created_at: 1,
  revoked_at: status === 'revoked' ? 2 : null,
  last_seen_at: NOW - MIN,
  launcher: { state: 'off' },
});

const session = (agentId: string, connection: 'live' | 'suspect' | 'ended') => ({
  id: `s-${agentId}`,
  agent_id: agentId,
  started_at: NOW - 60 * MIN,
  last_heartbeat_at: NOW - MIN,
  ended_at: connection === 'ended' ? NOW - 30 * MIN : null,
  end_reason: connection === 'ended' ? 'ended' : null,
  client_version: null,
  harness: 'claude-code',
  harness_version: null,
  model: null,
  connection,
});

const EVENTS = [
  {
    id: 'e1',
    seq: 2,
    type: 'task.created',
    project_id: 'p1',
    task_id: 't1',
    actor_id: 'u2',
    actor_kind: 'user',
    actor_token_id: null,
    payload: null,
    created_at: NOW - 5 * MIN,
  },
  {
    id: 'e2',
    seq: 1,
    type: 'comment.added',
    project_id: 'p2',
    task_id: null,
    actor_id: 'u1',
    actor_kind: 'user',
    actor_token_id: null,
    payload: null,
    created_at: NOW - 2 * 60 * MIN,
  },
];

const page = (data: unknown[]) => ({ data, next_cursor: null });

interface World {
  /** Answer `GET /tasks` with this status instead of rows. */
  tasksFail?: number;
  /** Answer `GET /activity` with a 500. */
  activityFails?: boolean;
  /** Org actions to withhold from `GET /permissions`. */
  withhold?: readonly string[];
  /** Nothing at all: a new organisation. */
  empty?: boolean;
}

function stub(w: World): ApiStub {
  const empty = w.empty === true;
  const tasks = (status: string) => () => {
    if (w.tasksFail !== undefined) return refuse(w.tasksFail, 'internal', 'the database is locked');
    if (empty) return page([]);
    if (status === 'in_progress') return page([RAIL, DRAWER]);
    if (status === 'todo') return page([NOTES, LOGIN]);
    return page([]);
  };
  const inbox = (rows: unknown[]) => ({
    data: rows,
    next_cursor: null,
    counts: { received: 0, sent: 0, needs_approval: rows.length, recovery: 0 },
  });
  const members = {
    members: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'member',
        created_at: 1,
      },
      {
        user_id: 'u2',
        name: 'Sam Okafor',
        email: 'sam@example.com',
        role: 'member',
        created_at: 1,
      },
    ],
  };
  const permissions = defaultPermissions(ME) as {
    me: { actions: string[] };
  };
  permissions.me.actions = permissions.me.actions.filter((a) => !(w.withhold ?? []).includes(a));
  return {
    '/api/v1/me': ME,
    '/api/v1/permissions': permissions,
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    '/api/v1/projects': page(
      empty
        ? []
        : [project('p1', 'laika', 'Laika', 'LAI'), project('p2', 'ops', 'Laika Ops', 'OPS')],
    ),
    '/api/v1/tasks?assignee=u1&status=backlog': tasks('backlog'),
    '/api/v1/tasks?assignee=u1&status=todo': tasks('todo'),
    '/api/v1/tasks?assignee=u1&status=in_progress': tasks('in_progress'),
    '/api/v1/tasks?assignee=u1&status=review': tasks('review'),
    '/api/v1/tasks/b1': BLOCKER,
    '/api/v1/projects/laika/members': members,
    '/api/v1/projects/ops/members': members,
    '/api/v1/review': { tasks: empty ? [] : [REVIEW_ITEM], truncated: false },
    '/api/v1/tasks/t9/rounds': { rounds: [], send_back: null },
    '/api/v1/handoff-offers?view=needs_approval': inbox(empty ? [] : [HANDOFF]),
    '/api/v1/handoff-offers?view=received': inbox(empty ? [] : [HANDOFF]),
    '/api/v1/agents': page(
      empty
        ? []
        : [agent('ag1', 'Belka'), agent('ag2', 'Strelka'), agent('ag3', 'Old desk', 'revoked')],
    ),
    '/api/v1/agents/ag1': { ...agent('ag1', 'Belka'), sessions: [session('ag1', 'live')] },
    '/api/v1/agents/ag2': { ...agent('ag2', 'Strelka'), sessions: [session('ag2', 'suspect')] },
    '/api/v1/activity': () =>
      w.activityFails === true
        ? refuse(500, 'internal', 'the feed is down')
        : page(empty ? [] : EVENTS),
  };
}

/** Count every `EventSource` the page constructs, by URL. */
async function countStreams(p: Page): Promise<void> {
  await p.addInitScript({
    content: `
      window.__streams = [];
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url, options) { super(url, options); window.__streams.push(String(url)); }
      };
    `,
  });
}

async function openHome(w: World = {}, path = '/home', width?: number): Promise<Harness> {
  // A width set before the first paint, as a phone opens the page: the shell
  // decides its rail from the width it boots at.
  const h = await open(path, stub(w), {
    before: async (p) => {
      if (width !== undefined) await p.setViewportSize({ width, height: 1000 });
      await countStreams(p);
    },
  });
  try {
    await h.page
      .locator(path === '/home' ? '[data-home-section]' : '.page')
      .first()
      .waitFor({ timeout: 20_000 });
  } catch (cause) {
    // A page that never drew must not leave its server holding the process open.
    await h.close();
    throw cause;
  }
  return h;
}

const section = (p: Page, id: string) => p.locator(`[data-home-section="${id}"]`);

/** Wait for a section to leave its skeleton, then say it did. */
async function settled(p: Page, id: string): Promise<void> {
  await until(
    async () =>
      (await section(p, id).locator('.state-skeleton, [aria-busy="true"]').count()) === 0 &&
      (await section(p, id)
        .locator(
          '[data-home-row], [data-home-agent], [data-home-event], [data-home-empty], [data-home-error]',
        )
        .count()) > 0,
  );
  assert.ok(
    (await section(p, id)
      .locator(
        '[data-home-row], [data-home-agent], [data-home-event], [data-home-empty], [data-home-error]',
      )
      .count()) > 0,
    `${id} never left its skeleton`,
  );
}

const ALL = ['attention', 'active', 'blocked', 'agents', 'coming-up', 'activity'];

async function settleAll(p: Page, ids: readonly string[] = ALL): Promise<void> {
  for (const id of ids) await settled(p, id);
}

async function rowKeys(p: Page, id: string): Promise<string[]> {
  return section(p, id)
    .locator('[data-home-row]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-home-row') ?? ''));
}

after(async () => {
  await closeBrowser();
});

void describe('the Command Center draws every section from what the server sent', () => {
  void test('each section, its rows and their notes', async () => {
    const h = await openHome();
    try {
      await settleAll(h.page);
      assert.equal(await h.page.locator('h1').innerText(), 'Home');

      const attention = section(h.page, 'attention');
      assert.deepEqual(await rowKeys(h.page, 'attention'), ['LAI-9', 'OPS-7', 'LAI-4']);
      assert.equal(
        await attention.locator('[data-home-group="review"] [data-home-count]').innerText(),
        '1',
      );
      assert.match(await attention.locator('[data-home-row="LAI-4"]').innerText(), /Due \d+ \w{3}/);

      // Overdue work that is up next is both: late, and still the reader's to do.
      assert.deepEqual(await rowKeys(h.page, 'active'), ['LAI-1', 'LAI-3', 'LAI-4']);
      assert.match(
        await section(h.page, 'active').locator('[data-home-row="LAI-1"]').innerText(),
        /Agent working/,
      );
      assert.equal(
        await section(h.page, 'active').locator('[data-home-count="active"]').innerText(),
        '3',
      );

      assert.deepEqual(await rowKeys(h.page, 'blocked'), ['OPS-2']);
      assert.match(
        await section(h.page, 'blocked').locator('[data-home-row="OPS-2"]').innerText(),
        /Waiting on LAI-50 \(Sam Okafor\)/,
      );

      assert.deepEqual(await rowKeys(h.page, 'coming-up'), ['LAI-3']);

      const agents = section(h.page, 'agents');
      const conn = await agents
        .locator('[data-home-agent]')
        .evaluateAll((els) =>
          els.map((el) => [
            el.getAttribute('data-home-agent'),
            el.querySelector('[data-connection]')?.getAttribute('data-connection'),
            el.querySelector('[data-connection]')?.textContent,
          ]),
        );
      assert.deepEqual(conn, [
        ['ag1', 'live', 'Connected'],
        ['ag2', 'lost', 'Connection lost'],
      ]);
      assert.equal(
        await agents.locator('[data-home-agent="ag1"] a').textContent(),
        'LAI-1Rail polish',
      );

      const feed = section(h.page, 'activity');
      assert.equal(await feed.locator('[data-home-event]').count(), 2);
      assert.match(
        await feed.locator('[data-home-event="e1"]').innerText(),
        /Sam Okafor created this task/,
      );
      assert.equal(
        await feed.locator('[data-home-event="e1"] a').getAttribute('href'),
        '/board?project=laika&task=t1',
      );
      assert.equal(
        await feed.locator('[data-home-event="e2"] a').getAttribute('href'),
        '/activity?project=ops',
      );
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('the sidebar offers Home, and the landing route is unchanged', async () => {
    const h = await openHome();
    try {
      const link = h.page.locator('nav a[href="/home"]');
      await link.first().waitFor({ timeout: 10_000 });
      assert.equal(await link.first().getAttribute('aria-current'), 'page');
    } finally {
      await h.close();
    }
  });
});

void describe('each row and count opens the right thing', () => {
  void test('a review row opens the review dialog on that item', async () => {
    const h = await openHome();
    try {
      await settled(h.page, 'attention');
      await section(h.page, 'attention').locator('[data-home-row="LAI-9"] a').click();
      const dialog = h.page.locator('[data-dialog="review"]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(await dialog.getAttribute('data-task'), 'LAI-9');
      const url = new URL(h.page.url());
      assert.equal(url.pathname, '/inbox');
      assert.equal(url.searchParams.get('item'), 't9');
    } finally {
      await h.close();
    }
  });

  for (const [id, key, want] of [
    ['active', 'LAI-1', '/board?project=laika&task=t1'],
    ['blocked', 'OPS-2', '/board?project=ops&task=t2'],
    ['attention', 'OPS-7', '/board?project=ops&task=t7'],
  ] as const) {
    void test(`${id}: ${key} opens its task in its own space`, async () => {
      const h = await openHome();
      try {
        await settled(h.page, id);
        await section(h.page, id).locator(`[data-home-row="${key}"] a`).click();
        await until(() => new URL(h.page.url()).pathname !== '/home');
        const url = new URL(h.page.url());
        assert.equal(`${url.pathname}${url.search}`, want);
      } finally {
        await h.close();
      }
    });
  }

  for (const [id, count, want] of [
    ['attention', 'overdue', '/list?project=laika&assignee=u1&overdue=true'],
    ['attention', 'handoffs', '/inbox?tab=review&view=handoffs'],
    // Every unblocked active task is in Laika, so its List; spanning spaces is
    // the Work tab (home-derive.test.ts).
    ['active', 'active', '/list?project=laika&assignee=u1'],
    ['blocked', 'blocked', '/list?project=ops&assignee=u1&blocked=true'],
    ['coming-up', 'coming-up', '/calendar?project=laika'],
  ] as const) {
    void test(`the ${count} count leads to its filtered list`, async () => {
      const h = await openHome();
      try {
        await settled(h.page, id);
        const link = section(h.page, id).locator(`[data-home-count="${count}"]`);
        assert.equal(await link.getAttribute('href'), want);
        await link.click();
        await until(() => new URL(h.page.url()).pathname !== '/home');
        const url = new URL(h.page.url());
        // The address it lands on starts as the link's; a page may add its own defaults.
        assert.equal(url.pathname, new URL(want, h.origin).pathname);
        for (const [k, v] of new URL(want, h.origin).searchParams) {
          assert.equal(url.searchParams.get(k), v, `${count}: ${k} was lost`);
        }
      } finally {
        await h.close();
      }
    });
  }
});

void describe('what the reader may not read is absent, not an error', () => {
  void test('without agent.read_own and member_list.read: no agents, no activity, and neither is asked', async () => {
    const h = await openHome({ withhold: ['agent.read_own', 'member_list.read'] });
    try {
      await settleAll(h.page, ['attention', 'active', 'blocked', 'coming-up']);
      assert.equal(await section(h.page, 'agents').count(), 0);
      assert.equal(await section(h.page, 'activity').count(), 0);
      assert.ok(!h.calls.some((c) => c.path === '/api/v1/agents'), 'agents were read');
      assert.ok(!h.calls.some((c) => c.path === '/api/v1/activity'), 'activity was read');
    } finally {
      await h.close();
    }
  });

  void test('a 403 on the task list drops the task sections; reviews and hand-offs still draw', async () => {
    const h = await openHome({ tasksFail: 403 });
    try {
      await settleAll(h.page, ['attention', 'agents', 'activity']);
      await until(async () => (await rowKeys(h.page, 'attention')).length === 2);
      for (const id of ['active', 'blocked', 'coming-up']) {
        assert.equal(await section(h.page, id).count(), 0, `${id} drew without permission`);
      }
      assert.deepEqual(await rowKeys(h.page, 'attention'), ['LAI-9', 'OPS-7']);
      assert.equal(await h.page.locator('[data-home-error]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('empty and failing sections', () => {
  void test('a new organisation: every section is one quiet line', async () => {
    const h = await openHome({ empty: true });
    try {
      await settleAll(h.page);
      for (const id of ALL) {
        const s = section(h.page, id);
        assert.equal(await s.locator('[data-home-empty]').count(), 1, `${id} has no one-liner`);
        assert.match(
          (await s.getAttribute('class')) ?? '',
          /home-section-quiet/,
          `${id} is not quiet`,
        );
        assert.equal(
          await s.locator('[data-home-count]').count(),
          0,
          `${id} shows a count of nothing`,
        );
      }
      assert.equal(
        await section(h.page, 'agents').locator('[data-home-empty] a').getAttribute('href'),
        '/developer',
      );
    } finally {
      await h.close();
    }
  });

  void test('one section failing leaves the rest; Retry brings it back', async () => {
    const w: World = { activityFails: true };
    const h = await openHome(w);
    try {
      await settleAll(h.page);
      const feed = section(h.page, 'activity');
      assert.equal(await feed.locator('[data-home-error]').count(), 1);
      assert.match(await feed.locator('[data-home-error]').innerText(), /the feed is down/);
      for (const id of ['attention', 'active', 'blocked', 'agents', 'coming-up']) {
        assert.ok(
          (await section(h.page, id).locator('[data-home-row], [data-home-agent]').count()) > 0,
          `${id} blanked`,
        );
      }
      w.activityFails = false;
      await feed.getByRole('button', { name: 'Retry' }).click();
      await until(async () => (await feed.locator('[data-home-event]').count()) === 2);
      assert.equal(await feed.locator('[data-home-event]').count(), 2);
      assert.equal(await feed.locator('[data-home-error]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a failed re-read keeps the rows and says how old they are', async () => {
    const w: World = {};
    const h = await openHome(w);
    try {
      await settled(h.page, 'active');
      assert.deepEqual(await rowKeys(h.page, 'active'), ['LAI-1', 'LAI-3', 'LAI-4']);
      w.tasksFail = 500;
      // The tab coming back is a re-read (`startPolling`).
      await h.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      const stale = section(h.page, 'active').locator('[data-home-stale]');
      await until(async () => (await stale.count()) === 1);
      assert.equal(await stale.count(), 1);
      assert.match(await stale.innerText(), /Couldn’t refresh — showing what was read just now/);
      assert.deepEqual(await rowKeys(h.page, 'active'), ['LAI-1', 'LAI-3', 'LAI-4']);
    } finally {
      await h.close();
    }
  });
});

void describe('layout, landmarks and streams', () => {
  async function lefts(p: Page): Promise<Record<string, { x: number; y: number }>> {
    const boxes = await p.locator('[data-home-section]').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute('data-home-section') ?? '',
          x: Math.round(r.x),
          y: Math.round(r.y),
        };
      }),
    );
    return Object.fromEntries(boxes.map((b) => [b.id, { x: b.x, y: b.y }]));
  }

  void test('390: one column, attention first, nothing scrolls sideways', async () => {
    const h = await openHome({}, '/home', 390);
    try {
      await settleAll(h.page);
      const at = await lefts(h.page);
      const order = Object.entries(at)
        .sort((a, b) => a[1].y - b[1].y)
        .map(([id]) => id);
      assert.deepEqual(order, [
        'attention',
        'active',
        'blocked',
        'agents',
        'coming-up',
        'activity',
      ]);
      assert.equal(new Set(Object.values(at).map((p) => p.x)).size, 1, 'not one column');
      const scroll = await h.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(scroll <= 0, `scrolls sideways by ${String(scroll)}px`);
    } finally {
      await h.close();
    }
  });

  for (const width of [1024, 1440]) {
    void test(`${String(width)}: two columns, your work on the left`, async () => {
      const h = await openHome({}, '/home', width);
      try {
        await settleAll(h.page);
        const at = await lefts(h.page);
        assert.equal(at.attention?.x, at.active?.x);
        assert.ok(
          (at.agents?.x ?? 0) > (at.attention?.x ?? 0),
          'agents is not in the right column',
        );
        assert.equal(at.agents?.y, at.attention?.y, 'the columns do not start together');
      } finally {
        await h.close();
      }
    });
  }

  void test('sections are labelled regions with headings and lists', async () => {
    const h = await openHome();
    try {
      await settleAll(h.page);
      const regions = await h.page
        .getByRole('region')
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute('data-home-section')).filter((v) => v !== null),
        );
      assert.deepEqual(regions, ALL);
      assert.equal(
        await h.page.getByRole('heading', { level: 2, name: 'Needs your attention' }).count(),
        1,
      );
      assert.equal(
        await section(h.page, 'active').getByRole('list').getByRole('listitem').count(),
        3,
      );
      assert.equal(await h.page.locator('main#main [data-home-section]').count(), ALL.length);
    } finally {
      await h.close();
    }
  });

  void test('Home opens no EventSource another page would not', async () => {
    const home = await openHome();
    const inbox = await openHome({}, '/inbox');
    try {
      await settleAll(home.page);
      const streams = (p: Page) =>
        p.evaluate(() => (window as unknown as { __streams: string[] }).__streams);
      assert.deepEqual(await streams(home.page), await streams(inbox.page));
    } finally {
      await home.close();
      await inbox.close();
    }
  });

  for (const theme of ['Light', 'Dark']) {
    void test(`${theme}: sections sit on the card surface, with readable text`, async () => {
      const h = await openHome();
      try {
        await setTheme(h.page, theme);
        await settleAll(h.page);
        const look = await section(h.page, 'active').evaluate((el) => {
          const probe = document.createElement('div');
          probe.style.background = 'var(--bg-card)';
          probe.style.color = 'var(--text-primary)';
          document.body.append(probe);
          const want = getComputedStyle(probe);
          const out = {
            bg: getComputedStyle(el).backgroundColor,
            wantBg: want.backgroundColor,
            title: getComputedStyle(el.querySelector('.home-row-title')!).color,
            wantText: want.color,
          };
          probe.remove();
          return out;
        });
        assert.equal(look.bg, look.wantBg);
        assert.equal(look.title, look.wantText);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('screenshots', () => {
  void test(
    'both themes at 1440, 1024 and 390, and an empty organisation',
    { skip: SHOTS === undefined },
    async () => {
      const dir = SHOTS ?? '';
      mkdirSync(dir, { recursive: true });
      for (const theme of ['light', 'dark']) {
        for (const [label, w] of [
          ['full', {}],
          ['empty', { empty: true }],
        ] as const) {
          for (const width of label === 'full' ? [1440, 1024, 390] : [1440, 390]) {
            const h = await openHome(w, '/home', width);
            try {
              await setTheme(h.page, theme);
              await settleAll(h.page);
              await h.page.screenshot({
                path: join(dir, `home-${label}-${theme}-${String(width)}.png`),
                fullPage: true,
              });
            } finally {
              await h.close();
            }
          }
        }
      }
    },
  );
});
