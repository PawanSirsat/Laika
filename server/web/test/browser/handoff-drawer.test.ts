/**
 * The task drawer's saves, hand-off and recovery (LAI-549; server LAI-545,
 * LAI-546), against the built SPA and a stubbed API in the shapes
 * `CheckpointView` and `HandoffOfferView` serve.
 *
 * - `t1` is held by a session that offered it on: a verified save, a newer
 *   one whose push notice is late, and a cross-owner offer waiting for
 *   approval. A person approves it; the sender's screen then says *Waiting
 *   for … to accept* and only says *Accepted* once the server does.
 * - `t2`'s claim expired with a verified save: *Recovery available*.
 * - `t3`'s claim expired with no save: *Automatic recovery unavailable*, and
 *   the person's path.
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
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.now();
const SHA = '3f2a9c1d'.padEnd(40, '0');
const NEWER_SHA = '9b7e4410'.padEnd(40, '1');

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
  device_label: 'Belka',
  status: 'active',
  owner: ADA,
};
const AGENTS = [
  {
    id: 'ag-laptop',
    owner_user_id: 'u1',
    display_name: 'Laptop agent',
    harness: 'claude-code',
    device_label: 'Belka',
    status: 'active',
    grants: [{ project_id: 'laika-core', scope: 'full' }],
    tokens: [],
    created_at: 1,
    revoked_at: null,
    last_seen_at: NOW - MIN,
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
const claimTaken = (taskId: string, generation: number) =>
  event(taskId, {
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
const claimExpired = (taskId: string, generation: number) =>
  event(taskId, {
    type: 'task.claim_expired',
    actor_id: null,
    actor_kind: 'system',
    actor_token_id: null,
    agent_id: null,
    payload: { generation, session_id: '01SESSION', agent_id: 'ag-laptop', lease_expires_at: 1 },
    created_at: NOW - 30 * MIN,
  });

/** A take and then its expiry, written in that order (by `seq`), newest first. */
function lapsed(taskId: string, generation: number) {
  const taken = claimTaken(taskId, generation);
  return [claimExpired(taskId, generation), taken];
}

/** `CheckpointView`. */
const checkpoint = (over: Record<string, unknown>) => ({
  id: '01CKPTVERIFIED',
  task_id: 't1',
  session_id: '01SESSION',
  agent_id: 'ag-laptop',
  claim_generation: 2,
  repo: 'owner/laika',
  branch: 'LAI-549-handoff-ui',
  remote_ref: 'refs/tags/laika-ckpt/LC-1/01CKPTVERIFIED',
  commit_sha: SHA,
  manifest: [{ path: 'server/web/src/a.ts', added: 40, removed: 2 }],
  summary: {
    work_done: 'Parser handles nested lists',
    next_step: 'Wire the renderer to the parser',
    decisions: 'Kept the old AST shape',
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
  refs: [{ ref: 'refs/tags/laika-ckpt/LC-1/01CKPTVERIFIED', revision: 0, state: 'verified' }],
  ...over,
});

/** `HandoffOfferView`: a cross-owner hand-off waiting for a person. */
const offer = (over: Record<string, unknown>) => ({
  id: '01OFFER',
  task_id: 't1',
  kind: 'handoff',
  state: 'pending_approval',
  from_session_id: '01SESSION',
  from_agent_id: 'ag-laptop',
  from_claim_generation: 2,
  to_agent_id: 'ag-desk',
  checkpoint_id: '01CKPTVERIFIED',
  checkpoint_commit_sha: SHA,
  checkpoint: {
    commit_sha: SHA,
    verification: 'verified',
    summary: checkpoint({}).summary,
    summary_commit_sha: SHA,
  },
  reason: 'Context window is nearly full',
  note_hash: 'f'.repeat(64),
  requires_approval: true,
  approved_by_user_id: null,
  approved_at: null,
  expires_at: NOW + 30 * MIN,
  accepted_session_id: null,
  accepted_claim_id: null,
  receiver_commit_sha: null,
  closed_reason: null,
  created_by_user_id: 'u1',
  created_at: NOW - 5 * MIN,
  closed_at: null,
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
  /** `t1`'s offers, as `GET /tasks/t1/handoff-offers` answers them now. */
  offers: Record<string, unknown>[];
  /** The newer save's `pending_notice`, as the server answers it now. */
  notice: boolean;
}

function world(): World {
  const handedOff = task({
    id: 't1',
    key: 'LC-1',
    number: 1,
    title: 'Offered to another owner’s agent',
    claim: {
      generation: 2,
      state: 'paused',
      agent_id: 'ag-laptop',
      session_id: '01SESSION',
      lease_expires_at: Date.now() + 300_000,
      last_heartbeat_at: Date.now(),
      heartbeat_age_ms: 0,
      connection: 'live',
      suspect_after_ms: 90_000,
      device_label: 'Belka',
    },
  });
  const recoverable = task({ id: 't2', key: 'LC-2', number: 2, title: 'Lapsed with a save' });
  const stranded = task({ id: 't3', key: 'LC-3', number: 3, title: 'Lapsed with no save' });
  const tasks = [handedOff, recoverable, stranded];
  const w: World = { stub: {}, offers: [offer({})], notice: true };

  const perTask = (t: Record<string, unknown>) => {
    const id = String(t.id);
    return {
      [`/api/v1/tasks/${id}`]: t,
      [`/api/v1/tasks/${id}/comments`]: { data: [], next_cursor: null },
      [`/api/v1/tasks/${id}/watchers`]: { watchers: [] },
      [`/api/v1/projects/laika-core/tasks?parent=${id}&limit=200`]: { data: [], next_cursor: null },
    };
  };

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
          task_counts: { backlog: 0, todo: 0, in_progress: 3, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: tasks, next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'u1@example.com', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/projects/laika-core/activity?task_id=t1': {
      data: [claimTaken('t1', 2)],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core/activity?task_id=t2': {
      // Newest first, as the feed serves it; `seq` is write order, take first.
      data: lapsed('t2', 3),
      next_cursor: null,
    },
    '/api/v1/projects/laika-core/activity?task_id=t3': {
      // Newest first, as the feed serves it; `seq` is write order, take first.
      data: lapsed('t3', 1),
      next_cursor: null,
    },
    '/api/v1/tasks/t1/checkpoints': () => ({
      data: [
        checkpoint({
          id: '01CKPTNEWER',
          commit_sha: NEWER_SHA,
          summary_commit_sha: SHA,
          remote_ref: 'refs/tags/laika-ckpt/LC-1/01CKPTNEWER',
          created_at: NOW - 14 * MIN,
          verification: 'pending',
          verified_at: null,
          pending_since: NOW - 14 * MIN,
          pending_notice: w.notice,
          refs: [{ ref: 'refs/tags/laika-ckpt/LC-1/01CKPTNEWER', revision: 0, state: 'pending' }],
        }),
        checkpoint({}),
      ],
    }),
    '/api/v1/tasks/t1/handoff-offers': () => ({ data: w.offers }),
    '/api/v1/handoff-offers/01OFFER/approve': (call: StubCall) => {
      assert.equal(call.method, 'POST');
      const approved = offer({ state: 'open', approved_by_user_id: 'u1', approved_at: Date.now() });
      w.offers = [approved];
      return approved;
    },
    '/api/v1/tasks/t2/checkpoints': { data: [checkpoint({ id: '01CKPTT2', task_id: 't2' })] },
    '/api/v1/tasks/t2/handoff-offers': {
      data: [
        offer({
          id: '01RECOVERY',
          task_id: 't2',
          kind: 'recovery',
          state: 'open',
          from_session_id: null,
          from_agent_id: null,
          to_agent_id: null,
          checkpoint_id: '01CKPTT2',
          reason: null,
          requires_approval: false,
        }),
      ],
    },
    '/api/v1/tasks/t3/checkpoints': { data: [] },
    '/api/v1/tasks/t3/handoff-offers': { data: [] },
    '/api/v1/agents': { data: AGENTS, next_cursor: null },
    ...perTask(handedOff),
    ...perTask(recoverable),
    ...perTask(stranded),
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

const focusedInside = (page: Page, selector: string) =>
  page.evaluate(
    (sel) => document.querySelector(sel)?.contains(document.activeElement) === true,
    selector,
  );

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

void describe('saves in the drawer', () => {
  void test('the latest verified save, and a newer one whose notice is late, both from API fields', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t1', w.stub, { before: fakeStream });
    try {
      const found = await panel(h);
      const verified = found.locator('[data-checkpoint="verified"]').first();
      await verified.waitFor({ timeout: 10_000 });
      const text = await verified.innerText();
      assert.match(text, /Parser handles nested lists/);
      assert.match(text, /3f2a9c1/);
      assert.match(text, /saved 40 min ago/);
      assert.match(text, /Verified/);
      assert.match(text, /Note describes this save/);

      const newer = found.locator('[data-newer-save] [data-checkpoint="pending"]');
      const late = await newer.innerText();
      assert.match(late, /Verification pending — no push notice from GitHub yet/);
      // The newer save carries the older note: stale, in words.
      assert.match(late, /Note describes an earlier save/);
      // An admin gets the Redeliver pointer.
      assert.match(late, /Recent Deliveries.*Redeliver/);

      // The full SHAs wait under Details.
      await found.getByRole('button', { name: 'Details' }).click();
      const details = await found.locator('[data-exec-details]').innerText();
      assert.ok(details.includes(SHA), 'the verified SHA is not under Details');
      assert.ok(details.includes(NEWER_SHA), 'the unverified SHA is not under Details');
    } finally {
      await h.close();
    }
  });
});

void describe('the hand-off dialog', () => {
  void test('traps focus, closes on Escape and gives focus back to the button that opened it', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t1', w.stub, { before: fakeStream });
    try {
      const found = await panel(h);
      const opener = found.locator('[data-open-handoff]');
      await opener.waitFor({ timeout: 10_000 });
      assert.equal((await opener.innerText()).trim(), 'Review hand-off');
      await opener.focus();
      await h.page.keyboard.press('Enter');

      const dialog = h.page.locator('[data-handoff-offer-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      assert.equal(await dialog.getAttribute('role'), 'dialog');
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      assert.equal(
        await focusedInside(h.page, '[data-handoff-offer-dialog]'),
        true,
        'focus did not come in',
      );

      // Twenty Tabs and Shift+Tabs never leave it.
      for (let i = 0; i < 10; i += 1) {
        await h.page.keyboard.press('Tab');
        assert.equal(
          await focusedInside(h.page, '[data-handoff-offer-dialog]'),
          true,
          `Tab ${String(i)} left`,
        );
      }
      for (let i = 0; i < 10; i += 1) {
        await h.page.keyboard.press('Shift+Tab');
        assert.equal(
          await focusedInside(h.page, '[data-handoff-offer-dialog]'),
          true,
          `Shift+Tab ${String(i)} left`,
        );
      }

      const facts = await dialog.innerText();
      assert.match(facts, /From\s*Claude Code · Belka/);
      assert.match(facts, /To\s*a registered agent/);
      assert.match(facts, /Context window is nearly full/);
      assert.match(facts, /Parser handles nested lists/);
      assert.match(facts, /saved 40 min ago/);
      assert.match(facts, /Wire the renderer to the parser/);
      assert.match(facts, /Required — from the task’s assignee or a project lead/);
      assert.match(facts, /The receiver must accept/);

      await shoot(h.page, 'handoff-dialog', '[data-handoff-offer-dialog]');

      await h.page.keyboard.press('Escape');
      await until(async () => (await dialog.count()) === 0);
      assert.equal(await dialog.count(), 0, 'Escape did not close it');
      // The drawer stays open: one Escape, one layer.
      assert.equal(await h.page.locator('.drawer [data-exec-panel]').count(), 1);
      assert.equal(
        await opener.evaluate((el) => el === document.activeElement),
        true,
        'focus did not go back to the opener',
      );
    } finally {
      await h.close();
    }
  });

  void test('approve → waiting for the receiver → accepted only when the server says so', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t1', w.stub, { before: fakeStream });
    try {
      const found = await panel(h);
      const status = found.locator('[data-handoff-status]');
      await status.waitFor({ timeout: 10_000 });
      assert.equal(
        (await status.innerText()).trim(),
        'Waiting for approval, then for a registered agent to accept',
      );
      await shoot(h.page, 'handoff-drawer-pending-approval', '.drawer [data-exec-panel]');

      await found.locator('[data-open-handoff]').click();
      const dialog = h.page.locator('[data-handoff-offer-dialog]');
      await dialog.getByRole('button', { name: 'Approve' }).click();

      const line = dialog.locator('[data-offer-status]');
      await until(async () => (await dialog.getAttribute('data-offer-state')) === 'open');
      assert.match(await line.innerText(), /^Waiting for a registered agent to accept/);
      assert.doesNotMatch(await line.innerText(), /accepted/i);
      assert.doesNotMatch(await found.innerText(), /Accepted by/);
      // The browser approved; it never accepted on the receiver's behalf.
      const posts = h.calls.filter((c) => c.method === 'POST').map((c) => c.path);
      assert.deepEqual(posts, ['/api/v1/handoff-offers/01OFFER/approve']);
      // The answer moved the focus nowhere outside the dialog.
      assert.equal(await focusedInside(h.page, '[data-handoff-offer-dialog]'), true);

      // The receiver accepts, elsewhere; the server says so on the stream.
      w.offers = [
        offer({
          state: 'accepted',
          approved_by_user_id: 'u1',
          approved_at: Date.now(),
          accepted_session_id: '01RECEIVER',
          accepted_claim_id: '01CLAIM3',
          receiver_commit_sha: SHA,
          closed_at: Date.now(),
        }),
      ];
      const accepted = event('t1', {
        type: 'task.handoff_accepted',
        agent_id: 'ag-desk',
        payload: { offer_id: '01OFFER', kind: 'handoff', generation: 3 },
        created_at: Date.now(),
      });
      await emit(h.page, 'task.handoff_accepted', accepted, String(accepted.seq));
      await until(
        async () => (await dialog.getAttribute('data-offer-state')) === 'accepted',
        10_000,
      );
      assert.equal((await line.innerText()).trim(), 'Accepted by a registered agent');
      assert.match(await dialog.innerText(), /Receiver confirmed commit 3f2a9c1/);
      // The live update did not steal the focus out of the dialog.
      assert.equal(await focusedInside(h.page, '[data-handoff-offer-dialog]'), true);
    } finally {
      await h.close();
    }
  });
});

void describe('recovery after an expired claim', () => {
  void test('a verified save: Recovery available, in words and a shape', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t2', w.stub, { before: fakeStream });
    try {
      const found = await panel(h);
      const state = found.locator('[data-exec-state]');
      await until(
        async () => (await state.getAttribute('data-exec-state')) === 'recovery_available',
        10_000,
      );
      assert.equal(await state.getAttribute('data-exec-state'), 'recovery_available');
      // Said once, by the state line, in words beside a shape.
      assert.match(
        await state.innerText(),
        /Recovery available\s*The claim expired\. Another agent can continue from the last verified save\./,
      );
      assert.equal(await state.locator('svg[data-shape="recovery_available"]').count(), 1);
      assert.equal((await found.innerText()).match(/Recovery available/g)?.length, 1);
      assert.equal(
        (await found.locator('[data-handoff-status]').innerText()).trim(),
        'Waiting for any eligible agent to accept',
      );
      assert.equal(
        (await found.locator('[data-open-handoff]').innerText()).trim(),
        'Review recovery offer',
      );
      await shoot(h.page, 'recovery-available', '.drawer [data-exec-panel]');
    } finally {
      await h.close();
    }
  });

  void test('no save at all: Automatic recovery unavailable, and the person’s path', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t3', w.stub, { before: fakeStream });
    try {
      const found = await panel(h);
      const box = found.locator('[data-recovery="unavailable"]');
      await box.waitFor({ timeout: 10_000 });
      const text = await box.innerText();
      assert.match(text, /Automatic recovery unavailable — no saved checkpoint/);
      assert.match(text, /reassigns this task or releases it to the backlog/);
      assert.equal(await box.getByRole('button', { name: 'Release to backlog' }).count(), 1);
      assert.equal(await found.locator('[data-open-handoff]').count(), 0);
      await shoot(h.page, 'recovery-unavailable', '.drawer [data-exec-panel]');
    } finally {
      await h.close();
    }
  });
});

void describe('review fixes (LAI-549, Codex round 1)', () => {
  void test('a quiet drawer picks up the server’s pending notice, without moving the focus', async () => {
    const w = world();
    w.notice = false;
    const h = await open('/board?project=laika-core&task=t1', w.stub, {
      before: async (page) => {
        await fakeStream(page);
        await page.clock.install();
      },
    });
    try {
      const found = await panel(h);
      const newer = found.locator('[data-newer-save] [data-checkpoint="pending"]');
      await newer.waitFor({ timeout: 10_000 });
      assert.equal(
        (await newer.locator('[data-verification]').innerText()).trim(),
        'Verification pending',
      );
      assert.equal(await newer.locator('[data-pending-hint]').count(), 0);

      const toggle = found.getByRole('button', { name: 'Details' });
      await toggle.focus();
      const reads = () =>
        h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/tasks/t1/checkpoints')
          .length;
      const before = reads();

      // The server now says the notice is late. Nothing on the page changes
      // until the drawer asks again — no frame is written for it.
      w.notice = true;
      await h.page.clock.fastForward(30_000);
      assert.equal(reads(), before, 're-read before the interval');
      await h.page.clock.fastForward(31_000);
      await until(() => reads() > before, 10_000);
      assert.ok(reads() > before, 'the drawer never re-read its saves');
      await until(
        async () =>
          (await newer.locator('[data-verification]').innerText()).trim() !==
          'Verification pending',
        10_000,
      );
      assert.equal(
        (await newer.locator('[data-verification]').innerText()).trim(),
        'Verification pending — no push notice from GitHub yet',
      );
      assert.equal(await newer.locator('[data-pending-hint]').count(), 1);
      assert.equal(
        await toggle.evaluate((el) => el === document.activeElement),
        true,
        'the re-read moved the focus',
      );
    } finally {
      await h.close();
    }
  });

  void test('no pending save: the drawer does not poll', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t2', w.stub, {
      before: async (page) => {
        await fakeStream(page);
        await page.clock.install();
      },
    });
    try {
      const found = await panel(h);
      await found.locator('[data-checkpoint="verified"]').waitFor({ timeout: 10_000 });
      const reads = () =>
        h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/tasks/t2/checkpoints')
          .length;
      const before = reads();
      await h.page.clock.fastForward(130_000);
      assert.equal(reads(), before, 'a drawer with nothing pending re-read its saves');
    } finally {
      await h.close();
    }
  });

  void test('a failed read of the saves is not "no saved checkpoint", and offers no Release', async () => {
    const w = world();
    const stub = {
      ...w.stub,
      '/api/v1/tasks/t3/checkpoints': refuse(500, 'internal', 'Something broke.'),
    };
    const h = await open('/board?project=laika-core&task=t3', stub, { before: fakeStream });
    try {
      const found = await panel(h);
      const unknown = found.locator('[data-recovery="unknown"]');
      await unknown.waitFor({ timeout: 10_000 });
      // The same element says *Checking…* while the read is in flight, so wait
      // for the failure's words rather than reading the first frame (LAI-550:
      // CI caught it mid-read).
      await until(
        async () => (await unknown.innerText()).includes('Could not read this task’s saves'),
        10_000,
      );
      // `until` returns on its timeout without failing; this is the assertion.
      assert.match(await unknown.innerText(), /Could not read this task’s saves/);
      assert.equal(await found.locator('[data-recovery="unavailable"]').count(), 0);
      assert.doesNotMatch(await found.innerText(), /Automatic recovery unavailable/);
      assert.equal(await found.getByRole('button', { name: 'Release to backlog' }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Approve waits for the reader’s own agents; disabled with a reason while they fail', async () => {
    const w = world();
    const stub = { ...w.stub, '/api/v1/agents': refuse(500, 'internal', 'Something broke.') };
    const h = await open('/board?project=laika-core&task=t1', stub, { before: fakeStream });
    try {
      const found = await panel(h);
      await found.locator('[data-open-handoff]').click();
      const dialog = h.page.locator('[data-handoff-offer-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      const approve = dialog.getByRole('button', { name: 'Approve' });
      await until(async () => (await dialog.locator('[data-approve-reason]').count()) > 0, 10_000);
      assert.equal(await approve.isDisabled(), true, 'Approve enabled on an unknown owner');
      assert.equal(
        (await dialog.locator('[data-approve-reason]').innerText()).trim(),
        'Could not check whether you own the receiving agent.',
      );
      assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
    } finally {
      await h.close();
    }
  });
});
