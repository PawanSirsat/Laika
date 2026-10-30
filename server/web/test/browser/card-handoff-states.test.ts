/**
 * *Recovery available* and *Save needs attention* on the board's cards
 * (LAI-1006; server LAI-1005), from the `handoff` summary every task read
 * carries — the shape `TaskHandoffView` serves (`view-type-drift.test.ts`
 * pairs the two).
 *
 * - `t1`'s claim expired with a verified save: the server says
 *   `recovery_available`, and an open recovery offer.
 * - `t2`'s newest save is `uncertain` and nothing holds it:
 *   `save_needs_attention`.
 * - `t3` has neither; `t4` is held by a live session whose save is
 *   `uncertain` — the server leaves the flag off, and the card says *Working*.
 * - Two hundred more, the board's page, so "no request per card" is asserted
 *   where it would cost.
 *
 * `LAIKA_SHOTS=<dir>` writes the screenshots: light and dark, 1440 and 390.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

const SHOTS = process.env.LAIKA_SHOTS;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.now();
const SHA = '3f2a9c1d'.padEnd(40, '0');
const PAGE = 200;

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: 'owner/laika',
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  agents_allowed: true,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const ADA = { id: 'u1', name: 'Ada Lovelace' };
const LAPTOP = {
  id: 'ag-laptop',
  display_name: 'Laptop agent',
  harness: 'claude-code',
  device_label: 'laptop-1',
  status: 'active',
  owner: ADA,
};

/** `TaskHandoffView` with nothing to say. */
const NONE = {
  checkpoint: null,
  offer: null,
  recovery_available: false,
  save_needs_attention: false,
};
const savedAs = (verification: string) => ({
  verification,
  saved_at: NOW - 40 * MIN,
  pending_since: null,
  pending_notice: false,
});

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
    project_id: 'laika-core',
    title: 'A task',
    description_md: '',
    acceptance_md: '',
    status: 'in_progress',
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
    started_at: NOW - 2 * HOUR,
    completed_at: null,
    created_at: NOW - 5 * HOUR,
    updated_at: NOW - HOUR,
    size: null,
    selected_agent: LAPTOP,
    claim: null,
    handoff: NONE,
    ...over,
  });

let seq = 100;
function event(taskId: string, over: Record<string, unknown>) {
  seq += 1;
  return {
    id: `e${String(seq)}`,
    seq,
    type: 'task.updated',
    project_id: 'laika-core',
    task_id: taskId,
    actor_id: 'u1',
    actor_kind: 'agent',
    actor_token_id: 'tok-1',
    agent_id: 'ag-laptop',
    payload: {},
    created_at: NOW - HOUR,
    ...over,
  };
}

/** A take and then its expiry, newest first, as the feed serves them. */
function lapsed(taskId: string, generation: number) {
  const taken = event(taskId, {
    type: 'task.status_changed',
    payload: {
      from: 'todo',
      to: 'in_progress',
      from_status_id: 'st-todo',
      to_status_id: 'st-progress',
      via: 'claim',
      claim_generation: generation,
    },
    created_at: NOW - 2 * HOUR,
  });
  const expired = event(taskId, {
    type: 'task.claim_expired',
    actor_id: null,
    actor_kind: 'system',
    actor_token_id: null,
    agent_id: null,
    payload: { generation, session_id: '01SESSION', agent_id: 'ag-laptop', lease_expires_at: 1 },
    created_at: NOW - 30 * MIN,
  });
  return [expired, taken];
}

/** `CheckpointView`. */
const checkpoint = (taskId: string, over: Record<string, unknown> = {}) => ({
  id: `01CKPT${taskId.toUpperCase()}`,
  task_id: taskId,
  session_id: '01SESSION',
  agent_id: 'ag-laptop',
  claim_generation: 3,
  repo: 'owner/laika',
  branch: 'LAI-1006-card-states',
  remote_ref: `refs/tags/laika-ckpt/LC/${taskId}`,
  commit_sha: SHA,
  manifest: [{ path: 'server/web/src/a.ts', added: 4, removed: 0 }],
  summary: {
    work_done: 'Half the cards',
    next_step: 'The other half',
    decisions: '',
    open_questions: '',
    failing: '',
  },
  summary_commit_sha: SHA,
  created_at: NOW - 40 * MIN,
  verification: 'verified',
  verified_at: NOW - 39 * MIN,
  pending_since: null,
  pending_notice: false,
  superseded: false,
  refs: [{ ref: `refs/tags/laika-ckpt/LC/${taskId}`, revision: 0, state: 'verified' }],
  ...over,
});

/** `HandoffOfferView`: the recovery the server opened for `t1`. */
const recoveryOffer = (over: Record<string, unknown> = {}) => ({
  id: '01RECOVERY',
  task_id: 't1',
  kind: 'recovery',
  state: 'open',
  from_session_id: null,
  from_agent_id: null,
  from_claim_generation: 3,
  to_agent_id: null,
  checkpoint_id: '01CKPTT1',
  checkpoint_commit_sha: SHA,
  checkpoint: {
    commit_sha: SHA,
    verification: 'verified',
    summary: checkpoint('t1').summary,
    summary_commit_sha: SHA,
  },
  reason: null,
  note_hash: 'f'.repeat(64),
  requires_approval: false,
  approved_by_user_id: null,
  approved_at: null,
  expires_at: NOW + 30 * MIN,
  accepted_session_id: null,
  accepted_claim_id: null,
  receiver_commit_sha: null,
  closed_reason: null,
  created_by_user_id: 'u1',
  created_at: NOW - 30 * MIN,
  closed_at: null,
  ...over,
});

const liveClaim = (over: Record<string, unknown> = {}) => ({
  generation: 4,
  state: 'active',
  agent_id: 'ag-laptop',
  session_id: '01SESSIONLIVE',
  lease_expires_at: Date.now() + 300_000,
  last_heartbeat_at: Date.now(),
  heartbeat_age_ms: 0,
  connection: 'live',
  suspect_after_ms: 90_000,
  device_label: 'Belka',
  ...over,
});

const PROJECT_ACTIONS = [
  'project.settings.edit',
  'task.create',
  'task.write',
  'task.claim',
  'task.assign_other',
  'comment.create',
  'task.watch',
  'project.read',
  'usage.read_project',
  'task.handoff.approve',
  'task.handoff.cancel',
];

interface World {
  readonly stub: ApiStub;
  /** Every task the list serves, mutable so a test can move the server on. */
  readonly tasks: Record<string, unknown>[];
  /** `t1`'s offers, as `GET /tasks/t1/handoff-offers` answers now. */
  offers: Record<string, unknown>[];
  /** `t5`'s one save, as the server reads it now: `pending` until its notice arrives. */
  t5: 'pending' | 'uncertain';
  /**
   * Serve `t5` with a fresh `updated_at` on every list read, its summary
   * unchanged: the store then hands the drawer a new task object each walk —
   * the shape a re-read loop would feed on.
   */
  churnT5: boolean;
}

function world(): World {
  const recoverable = task({
    id: 't1',
    key: 'LC-1',
    number: 1,
    title: 'Lapsed with a verified save',
    handoff: {
      checkpoint: savedAs('verified'),
      offer: { kind: 'recovery', state: 'open', requires_approval: false },
      recovery_available: true,
      save_needs_attention: false,
    },
  });
  const attention = task({
    id: 't2',
    key: 'LC-2',
    number: 2,
    title: 'Its save does not match',
    handoff: {
      checkpoint: savedAs('uncertain'),
      offer: null,
      recovery_available: false,
      save_needs_attention: true,
    },
  });
  const plain = task({ id: 't3', key: 'LC-3', number: 3, title: 'Nothing saved' });
  const working = task({
    id: 't4',
    key: 'LC-4',
    number: 4,
    title: 'Held, with an uncertain save',
    claim: liveClaim(),
    // The server lets the live claim speak first (LAI-1005).
    handoff: { ...NONE, checkpoint: savedAs('uncertain') },
  });
  const waiting = task({
    id: 't5',
    key: 'LC-5',
    number: 5,
    title: 'Its save waits for a notice',
    handoff: {
      ...NONE,
      checkpoint: { ...savedAs('pending'), pending_since: NOW - 40 * MIN },
    },
  });
  const filler = Array.from({ length: PAGE - 5 }, (_, i) =>
    task({
      id: `f${String(i)}`,
      key: `LC-${String(100 + i)}`,
      number: 100 + i,
      title: `Filler ${String(i)}`,
      status: 'todo',
      selected_agent: null,
      started_at: null,
    }),
  );
  const tasks: Record<string, unknown>[] = [
    recoverable,
    attention,
    plain,
    working,
    waiting,
    ...filler,
  ];
  const w: World = { stub: {}, tasks, offers: [recoveryOffer()], t5: 'pending', churnT5: false };
  const byId = (id: string) => () => w.tasks.find((t) => t.id === id);

  const perTask = (id: string) => ({
    [`/api/v1/tasks/${id}`]: byId(id),
    [`/api/v1/tasks/${id}/comments`]: { data: [], next_cursor: null },
    [`/api/v1/tasks/${id}/watchers`]: { watchers: [] },
    [`/api/v1/tasks/${id}/usage`]: {
      task_id: id,
      key: id,
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
    [`/api/v1/projects/laika-core/tasks?parent=${id}&limit=200`]: { data: [], next_cursor: null },
  });

  const stub: ApiStub = {
    '/api/v1/me': {
      id: 'u1',
      email: 'me@example.com',
      name: 'Ada Lovelace',
      org_role: 'admin',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/permissions': {
      org_roles: ['owner', 'admin', 'member', 'viewer'],
      project_roles: ['lead', 'member', 'viewer'],
      permissions: [],
      me: {
        org_role: 'admin',
        credential: 'session',
        project_scope: 'all',
        implicit_project_role: 'lead',
        actions: ['project.create'],
        projects: [{ project_id: 'laika-core', role: 'lead', actions: PROJECT_ACTIONS }],
      },
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: {
            backlog: 0,
            todo: PAGE - 5,
            in_progress: 5,
            review: 0,
            done: 0,
            cancelled: 0,
          },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': () => ({
      data: w.churnT5
        ? w.tasks.map((t) => (t.id === 't5' ? { ...t, updated_at: Date.now() } : t))
        : w.tasks,
      next_cursor: null,
    }),
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/activity?task_id=t1': () => ({
      data: lapsed('t1', 3),
      next_cursor: null,
    }),
    '/api/v1/projects/laika-core/activity?task_id=t2': { data: lapsed('t2', 2), next_cursor: null },
    '/api/v1/tasks/t1/checkpoints': { data: [checkpoint('t1')] },
    '/api/v1/tasks/t1/handoff-offers': () => ({ data: w.offers }),
    '/api/v1/tasks/t2/checkpoints': {
      data: [
        checkpoint('t2', {
          verification: 'uncertain',
          verified_at: null,
          refs: [{ ref: 'refs/tags/laika-ckpt/LC/t2', revision: 0, state: 'uncertain' }],
        }),
      ],
    },
    '/api/v1/tasks/t2/handoff-offers': { data: [] },
    '/api/v1/projects/laika-core/activity?task_id=t5': { data: lapsed('t5', 2), next_cursor: null },
    '/api/v1/tasks/t5/checkpoints': () => ({
      data: [
        checkpoint('t5', {
          verification: w.t5,
          verified_at: null,
          pending_since: w.t5 === 'pending' ? NOW - 40 * MIN : null,
          pending_notice: false,
          refs: [{ ref: 'refs/tags/laika-ckpt/LC/t5', revision: 0, state: w.t5 }],
        }),
      ],
    }),
    '/api/v1/tasks/t5/handoff-offers': { data: [] },
    '/api/v1/agents': { data: [], next_cursor: null },
    ...perTask('t1'),
    ...perTask('t2'),
    ...perTask('t5'),
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
  Object.assign(w, { stub });
  return w;
}

void after(async () => {
  await closeBrowser();
});

const card = (page: Page, id: string) => page.locator(`.card[data-task-id="${id}"]`);

async function stateOf(page: Page, id: string): Promise<string | null> {
  const line = card(page, id).locator('[data-exec-state]');
  return (await line.count()) === 0 ? null : line.getAttribute('data-exec-state');
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

async function shoot(page: Page, name: string, target: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      const el = page.locator(target).first();
      await el.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `${name}-${theme}-${String(width)}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

/** Task reads the board made beyond its one list: per-task reads of any kind. */
function perCardReads(h: Harness): string[] {
  return h.calls
    .map((c) => c.path.split('?')[0]!)
    .filter((path) => /^\/api\/v1\/tasks\/[^/]+(\/|$)/.test(path));
}

void describe('the card states, from the task list alone', () => {
  void test('each state in words beside a shape, and nothing on a task without one — with no request per card', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    try {
      await card(h.page, 't1').waitFor({ timeout: 20_000 });
      await until(async () => (await stateOf(h.page, 't1')) !== null, 10_000);

      assert.equal(await stateOf(h.page, 't1'), 'recovery_available');
      assert.equal(await stateOf(h.page, 't2'), 'save_needs_attention');
      assert.equal(await stateOf(h.page, 't3'), null);
      // A live claim speaks first: the server left the flag off.
      assert.equal(await stateOf(h.page, 't4'), 'working');

      const line = (id: string) => card(h.page, id).locator('[data-exec-state]');
      assert.equal(
        (await line('t1').locator('.exec-state-label').innerText()).trim(),
        'Recovery available',
      );
      assert.equal(
        (await line('t2').locator('.exec-state-label').innerText()).trim(),
        'Save needs attention',
      );
      // A shape beside the words; never a colour alone.
      assert.equal(await line('t1').locator('svg[data-shape="recovery_available"]').count(), 1);
      assert.equal(await line('t2').locator('svg[data-shape="save_needs_attention"]').count(), 1);

      // The whole page drew, and not one card read anything of its own.
      assert.equal(await h.page.locator('.card').count(), PAGE);
      assert.deepEqual(perCardReads(h), []);
      const lists = h.calls.filter((c) => c.path === '/api/v1/projects/laika-core/tasks');
      assert.ok(lists.length >= 1, 'the board read its list');

      await shoot(h.page, 'card-states', '.card[data-task-id="t1"]');
    } finally {
      await h.close();
    }
  });

  void test('the meaning on hover and on focus, and the card still opens from the keyboard', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    try {
      await until(async () => (await stateOf(h.page, 't2')) !== null, 20_000);
      const line = card(h.page, 't2').locator('[data-exec-state]');
      const meaning = 'The saved work could not be fetched or did not match. A person has to look.';
      assert.equal(await line.getAttribute('title'), meaning);

      const button = card(h.page, 't2').locator('.card-open');
      const describedBy = (await button.getAttribute('aria-describedby')) ?? '';
      const lineId = await line.getAttribute('id');
      assert.ok(lineId !== null && describedBy.split(' ').includes(lineId), describedBy);
      // What a screen reader hears on focus: the label and its meaning.
      assert.match((await line.textContent()) ?? '', /Save needs attention.*did not match/);

      // Hovering the line shows its own title, above the card's hit area.
      await line.hover();
      const top = await h.page.evaluate((id) => {
        const el = document.getElementById(id);
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        return (
          document.elementFromPoint(r.left + 4, r.top + r.height / 2)?.closest('[data-exec-state]')
            ?.id ?? null
        );
      }, lineId);
      assert.equal(top, lineId);

      await button.focus();
      await h.page.keyboard.press('Enter');
      await h.page.locator('.drawer [data-exec-panel]').waitFor({ timeout: 20_000 });
      assert.match(h.page.url(), /task=t2/);
    } finally {
      await h.close();
    }
  });

  void test('a reader who hides the field sees neither state, and the agent’s still', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, {
      before: async (page) => {
        await fakeStream(page);
        await page.addInitScript(() => {
          localStorage.setItem(
            'laika.board-view',
            JSON.stringify({ 'laika-core': { fields: { handoff: false } } }),
          );
        });
      },
    });
    try {
      await until(async () => (await stateOf(h.page, 't4')) === 'working', 20_000);
      assert.equal(await stateOf(h.page, 't1'), null);
      assert.equal(await stateOf(h.page, 't2'), null);
    } finally {
      await h.close();
    }
  });
});

void describe('card and drawer', () => {
  void test('agree on Recovery available, and both move on once the recovery is accepted', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t1', w.stub, { before: fakeStream });
    try {
      const panel = h.page.locator('.drawer [data-exec-panel]');
      await panel.waitFor({ timeout: 20_000 });
      const drawerState = () =>
        panel.locator('[data-exec-state]').first().getAttribute('data-exec-state');
      await until(async () => (await drawerState()) === 'recovery_available', 10_000);
      // The card renders on its own schedule; wait for it rather than race it.
      await until(async () => (await stateOf(h.page, 't1')) === 'recovery_available', 10_000);
      assert.equal(await stateOf(h.page, 't1'), 'recovery_available');
      await shoot(h.page, 'card-and-drawer-recovery', '.drawer [data-exec-panel]');

      // A receiver accepts the recovery, elsewhere: the server's next reads
      // say a live claim holds t1 and the summary has nothing left to flag.
      w.offers = [
        recoveryOffer({
          state: 'accepted',
          to_agent_id: 'ag-desk',
          accepted_session_id: '01RECEIVER',
          accepted_claim_id: '01CLAIM4',
          receiver_commit_sha: SHA,
          closed_at: Date.now(),
        }),
      ];
      const i = w.tasks.findIndex((t) => t.id === 't1');
      w.tasks[i] = {
        ...w.tasks[i],
        claim: liveClaim({ session_id: '01RECEIVER' }),
        handoff: { ...NONE, checkpoint: savedAs('verified') },
        updated_at: Date.now(),
      };
      const accepted = event('t1', {
        type: 'task.handoff_accepted',
        agent_id: 'ag-desk',
        payload: { offer_id: '01RECOVERY', kind: 'recovery', generation: 4 },
        created_at: Date.now(),
      });
      await emit(h.page, 'task.handoff_accepted', accepted, String(accepted.seq));

      await until(async () => (await stateOf(h.page, 't1')) === 'working', 15_000);
      await until(async () => (await drawerState()) === 'working', 15_000);
      assert.equal(await stateOf(h.page, 't1'), await drawerState());
      // Neither still says Recovery available anywhere.
      assert.equal(
        await card(h.page, 't1').locator('[data-exec-state="recovery_available"]').count(),
        0,
      );
      assert.equal(await panel.locator('[data-exec-state="recovery_available"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('LAI-1006 review fixes', () => {
  void test('a drawer poll that finds the save turned uncertain moves the card and the drawer together', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t5', w.stub, {
      before: async (page) => {
        await fakeStream(page);
        await page.clock.install();
      },
    });
    try {
      const panel = h.page.locator('.drawer [data-exec-panel]');
      await panel.waitFor({ timeout: 20_000 });
      await panel.locator('[data-checkpoint="pending"]').first().waitFor({ timeout: 10_000 });
      assert.equal(await stateOf(h.page, 't5'), null);
      assert.equal(await panel.locator('[data-exec-state="save_needs_attention"]').count(), 0);
      const lists = () =>
        h.calls.filter((c) => c.path === '/api/v1/projects/laika-core/tasks').length;
      const before = lists();

      // GitHub's notice lands: the save is `uncertain`. No frame is written
      // for it (LAI-1010) — only the drawer's own poll can see it.
      w.t5 = 'uncertain';
      const i = w.tasks.findIndex((t) => t.id === 't5');
      w.tasks[i] = {
        ...w.tasks[i],
        handoff: {
          ...NONE,
          checkpoint: savedAs('uncertain'),
          save_needs_attention: true,
        },
        updated_at: Date.now(),
      };
      await h.page.clock.fastForward(61_000);

      // The poll saw it, the board re-read its list, and both now say it.
      await until(() => lists() > before, 15_000);
      await until(async () => (await stateOf(h.page, 't5')) === 'save_needs_attention', 15_000);
      await until(
        async () => (await panel.locator('[data-exec-state="save_needs_attention"]').count()) === 1,
        15_000,
      );
      // And it asked once: with the summary caught up, nothing re-reads the board.
      const after = lists();
      await h.page.clock.fastForward(61_000);
      await h.page.waitForTimeout(500);
      assert.equal(lists(), after, 'the drawer kept re-reading the board');
    } finally {
      await h.close();
    }
  });

  void test('a list that still disagrees after the re-read is not asked again and again', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t5', w.stub, {
      before: async (page) => {
        await fakeStream(page);
        await page.clock.install();
      },
    });
    try {
      const panel = h.page.locator('.drawer [data-exec-panel]');
      await panel.waitFor({ timeout: 20_000 });
      await panel.locator('[data-checkpoint="pending"]').first().waitFor({ timeout: 10_000 });
      const lists = () =>
        h.calls.filter((c) => c.path === '/api/v1/projects/laika-core/tasks').length;
      const before = lists();

      // The saves read says `uncertain`; the list's summary never catches up,
      // and every read of it hands the store a new t5.
      w.t5 = 'uncertain';
      w.churnT5 = true;
      await h.page.clock.fastForward(61_000);
      await until(() => lists() > before, 15_000);
      for (let i = 0; i < 3; i += 1) {
        await h.page.clock.fastForward(61_000);
        await h.page.waitForTimeout(300);
      }
      assert.equal(lists(), before + 1, 'one re-read per thing the drawer saw, not a loop');
    } finally {
      await h.close();
    }
  });

  void test('a click on the card’s state line opens the card, as the rest of the card does', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    try {
      await until(async () => (await stateOf(h.page, 't2')) === 'save_needs_attention', 20_000);
      const line = card(h.page, 't2').locator('[data-exec-state]');
      // A real pointer at the line's own box: Playwright refuses if something
      // else would receive the click.
      await line.click();
      await h.page.locator('.drawer [data-exec-panel]').waitFor({ timeout: 20_000 });
      assert.match(h.page.url(), /task=t2/);
      // The tooltip survived the fix.
      assert.match((await line.getAttribute('title')) ?? '', /A person has to look/);
    } finally {
      await h.close();
    }
  });
});
