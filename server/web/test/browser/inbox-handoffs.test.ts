/**
 * Inbox → Hand-offs and the space's hand-off policy (LAI-550; server LAI-546,
 * LAI-1009), against the built SPA and a stubbed API in the shapes
 * `PersonHandoffInbox` and `HandoffPolicyView` serve.
 *
 * - The badge and the filter counts are the server's `counts` — live and
 *   unexpired only — so an expired offer on screen never reaches them.
 * - Kinds read apart in words and in shape; approval and acceptance are two
 *   lines; *Approve* never appears for the receiving agent's owner.
 * - Approving holds the row in place while the list re-reads.
 * - A failed first read is an error; a failed re-read keeps the rows, stale.
 * - The policy saves all four settings for a lead, is read-only for a member,
 *   and a refused save says so beside the form.
 *
 * `LAIKA_SHOTS=<dir>` writes the screenshots: light and dark, 1440 and 390.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;
const MIN = 60_000;
const NOW = Date.now();
const SHA = '3f2a9c1d'.padEnd(40, '0');

const PROJECT = {
  id: 'p1',
  slug: 'laika',
  name: 'Laika',
  prefix: 'LC',
  description: null,
  repo: 'owner/laika',
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
};

const ME = { id: 'u1', name: 'Ada Lovelace' };
const SAM = { id: 'u2', name: 'Sam Okafor' };
const KIM = { id: 'u3', name: 'Kim Mbeki' };

const agent = (
  id: string,
  owner: { id: string; name: string },
  device: string,
  harness = 'claude-code',
) => ({
  id,
  display_name: `${owner.name}'s ${device}`,
  harness,
  device_label: device,
  status: 'active',
  owner,
});
const MINE = agent('ag-mine', ME, 'Belka');
const SAMS = agent('ag-sam', SAM, 'Strelka', 'codex');
const KIMS = agent('ag-kim', KIM, 'kim-desk');

/** `PersonHandoffView`. */
const row = (over: Record<string, unknown>) => ({
  id: 'x',
  kind: 'handoff',
  state: 'open',
  task_id: 't1',
  task_key: 'LC-1',
  task_title: 'A task',
  project_id: 'p1',
  project_slug: 'laika',
  from_agent: SAMS,
  to_agent: MINE,
  checkpoint_id: 'c1',
  checkpoint: { commit_sha: SHA, verification: 'verified', saved_at: NOW - 12 * MIN },
  reason: 'Context window is nearly full',
  requires_approval: false,
  approved: false,
  approved_at: null,
  expires_at: NOW + 25 * MIN,
  closed_reason: null,
  created_at: NOW - 5 * MIN,
  closed_at: null,
  next_action: 'accept_with_your_agent',
  ...over,
});

const TO_ME = row({
  id: 'o-to-me',
  task_id: 't1',
  task_key: 'LC-1',
  task_title: 'Parser handles nested lists',
});
const TO_ME_PENDING = row({
  id: 'o-to-me-pending',
  task_id: 't2',
  task_key: 'LC-2',
  task_title: 'Split the export job',
  state: 'pending_approval',
  requires_approval: true,
  next_action: 'wait_for_approval',
});
const EXPIRED = row({
  id: 'o-expired',
  task_id: 't3',
  task_key: 'LC-3',
  task_title: 'Retry webhook deliveries',
  state: 'expired',
  expires_at: NOW - 10 * MIN,
  next_action: 'none',
});
const TO_APPROVE = row({
  id: 'o-approve',
  task_id: 't4',
  task_key: 'LC-4',
  task_title: 'Cache the board query',
  state: 'pending_approval',
  from_agent: SAMS,
  to_agent: KIMS,
  requires_approval: true,
  next_action: 'approve',
});
/** A hint the client must not trust alone: the receiver is the reader's own agent. */
const MINE_TO_APPROVE = row({
  id: 'o-mine-approve',
  task_id: 't5',
  task_key: 'LC-5',
  task_title: 'Receiver is yours',
  state: 'pending_approval',
  to_agent: MINE,
  requires_approval: true,
  next_action: 'approve',
});
/** Received's second page — and nobody else's. */
const LATE = row({
  id: 'o-late',
  task_id: 't8',
  task_key: 'LC-8',
  task_title: 'Second page of Received',
});
/** A second offer the reader may approve, for overlapping writes. */
const ALSO_TO_APPROVE = row({
  id: 'o-approve-2',
  task_id: 't9',
  task_key: 'LC-9',
  task_title: 'Second approval',
  state: 'pending_approval',
  from_agent: SAMS,
  to_agent: KIMS,
  requires_approval: true,
  next_action: 'approve',
});
const SENT = row({
  id: 'o-sent',
  task_id: 't6',
  task_key: 'LC-6',
  task_title: 'Wire the renderer',
  from_agent: MINE,
  to_agent: KIMS,
  next_action: 'cancel',
});
const RECOVERY = row({
  id: 'o-recovery',
  kind: 'recovery',
  task_id: 't7',
  task_key: 'LC-7',
  task_title: 'Fix the sprint rollover',
  from_agent: KIMS,
  to_agent: null,
  reason: null,
  next_action: 'name_receiver',
});

const PROJECT_ACTIONS = [
  'project.read',
  'task.create',
  'task.write',
  'comment.create',
  'task.watch',
  'task.handoff.approve',
  'task.handoff.cancel',
];

interface World {
  readonly stub: ApiStub;
  approved: boolean;
  /** `false` makes every inbox read fail — a re-read that cannot reach Laika. */
  reachable: boolean;
  policyWrites: unknown[];
}

function counts(w: World) {
  return { received: 2, sent: 1, needs_approval: w.approved ? 1 : 2, recovery: 1 };
}

function world(
  options: { lead?: boolean; refusePolicy?: boolean; paged?: boolean; twoToApprove?: boolean } = {},
): World {
  const lead = options.lead ?? true;
  const w: World = { stub: {}, approved: false, reachable: true, policyWrites: [] };
  const page = (data: () => unknown[]) => () =>
    w.reachable
      ? { data: data(), next_cursor: null, counts: counts(w) }
      : refuse(500, 'internal', 'the database is locked');
  const approveRows = () =>
    options.twoToApprove === true
      ? [TO_APPROVE, ALSO_TO_APPROVE]
      : w.approved
        ? [MINE_TO_APPROVE]
        : [TO_APPROVE, MINE_TO_APPROVE];
  const stub: ApiStub = {
    '/api/v1/me': {
      id: 'u1',
      email: 'u1@example.com',
      name: ME.name,
      org_role: lead ? 'admin' : 'member',
      is_active: true,
      memberships: [{ project_id: 'p1', role: lead ? 'lead' : 'member' }],
    },
    '/api/v1/permissions': {
      org_roles: ['owner', 'admin', 'member', 'viewer'],
      project_roles: ['lead', 'member', 'viewer'],
      permissions: [],
      me: {
        org_role: lead ? 'admin' : 'member',
        credential: 'session',
        project_scope: lead ? 'all' : ['p1'],
        implicit_project_role: lead ? 'lead' : null,
        actions: ['org.read'],
        projects: [
          {
            project_id: 'p1',
            role: lead ? 'lead' : 'member',
            actions: lead
              ? [...PROJECT_ACTIONS, 'project.settings.edit', 'project.handoff_policy.edit']
              : PROJECT_ACTIONS,
          },
        ],
      },
    },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
    '/api/v1/projects': {
      data: [
        {
          ...PROJECT,
          task_counts: { backlog: 0, todo: 0, in_progress: 7, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 3,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika': PROJECT,
    '/api/v1/projects/laika/members': {
      members: [
        {
          user_id: 'u1',
          name: ME.name,
          email: 'u1@example.com',
          role: lead ? 'lead' : 'member',
          created_at: 1,
        },
      ],
    },
    '/api/v1/handoff-offers?view=received': () => {
      const first = page(() => [TO_ME, TO_ME_PENDING])();
      // A second page of Received, for the test that a late page stays in its view.
      return options.paged === true && 'data' in first ? { ...first, next_cursor: 'C2' } : first;
    },
    '/api/v1/handoff-offers?view=received&cursor=C2': page(() => [LATE]),
    '/api/v1/handoff-offers?view=received&include_closed=true': page(() => [
      TO_ME,
      TO_ME_PENDING,
      EXPIRED,
    ]),
    '/api/v1/handoff-offers?view=sent': page(() => [SENT]),
    '/api/v1/handoff-offers?view=needs_approval': page(approveRows),
    '/api/v1/handoff-offers?view=recovery': page(() => [RECOVERY]),
    '/api/v1/handoff-offers/o-approve/approve': (call: StubCall) => {
      assert.equal(call.method, 'POST');
      w.approved = true;
      return { id: 'o-approve', state: 'open' };
    },
    '/api/v1/handoff-offers/o-approve-2/approve': (call: StubCall) => {
      assert.equal(call.method, 'POST');
      return { id: 'o-approve-2', state: 'open' };
    },
    '/api/v1/projects/laika/handoff-policy': (call: StubCall) => {
      if (call.method === 'PUT') {
        w.policyWrites.push(call.body);
        if (options.refusePolicy === true) {
          return refuse(403, 'forbidden', 'Only a space lead can change the hand-off policy');
        }
        return { project_id: 'p1', ...(call.body as object), updated_by: 'u1', is_set: true };
      }
      return {
        project_id: 'p1',
        allow_other_owners: false,
        cross_owner_requires_approval: true,
        max_handoffs: 3,
        offer_ttl_minutes: 30,
        updated_by: null,
        is_set: false,
      };
    },
  };
  Object.assign(w, { stub });
  return w;
}

/**
 * Wait for `done`, then **assert** it: `until` returns on its timeout without
 * failing (harness.ts), so a wait alone is not a check.
 */
async function eventually(done: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  await until(done, ms);
  assert.ok(await done(), `never became true: ${String(done)}`);
}

void after(async () => {
  await closeBrowser();
});

const tab = (page: Page) => page.locator('[data-handoffs-tab]');
const rowsOf = (page: Page) => tab(page).locator('.handoff-row');
const idsOf = async (page: Page) =>
  rowsOf(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-offer-id')));

async function inbox(w: World) {
  const h = await open('/inbox?tab=handoffs', w.stub);
  await rowsOf(h.page).first().waitFor({ timeout: 20_000 });
  return h;
}

void describe('Inbox → Hand-offs', () => {
  void test('the badge is the server’s counts, and an expired offer never reaches it', async () => {
    const w = world();
    const h = await inbox(w);
    try {
      const badge = h.page.locator('.sidebar-link', { hasText: 'Inbox' }).locator('.sidebar-count');
      // received 2 + needs approval 2; the review queue is empty.
      await eventually(async () => (await badge.innerText()).startsWith('4'));
      const tabCount = h.page.locator('[data-tab="handoffs"] .page-tab-count');
      assert.match(await tabCount.innerText(), /^4/);
      assert.match(await tab(h.page).locator('[data-count="needs_approval"]').innerText(), /^2/);

      await tab(h.page).getByLabel('Show closed and expired').check();
      await eventually(async () => (await idsOf(h.page)).includes('o-expired'));
      const expired = tab(h.page).locator('[data-offer-id="o-expired"]');
      assert.match(
        await expired.locator('[data-acceptance]').innerText(),
        /Expired before anyone accepted/,
      );
      assert.equal(await expired.locator('[data-approve], [data-withdraw]').count(), 0);
      assert.match(await badge.innerText(), /^4/, 'an expired row on screen changed the badge');
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('kinds, both agents, the save, approval apart from acceptance', async () => {
    const h = await inbox(world());
    try {
      const mine = tab(h.page).locator('[data-offer-id="o-to-me"]');
      assert.match(await mine.locator('.handoff-kind').innerText(), /Hand-off/);
      const route = await mine.locator('.handoff-route').innerText();
      assert.match(route, /Codex · Strelka/);
      assert.match(route, /Sam Okafor/);
      assert.match(route, /Claude Code · Belka/);
      assert.match(route, /yours/);
      assert.match(
        await mine.locator('[data-checkpoint]').innerText(),
        /Saved 12 min ago · verified/,
      );
      assert.match(await mine.innerText(), /Context window is nearly full/);
      assert.match(
        await mine.locator('[data-next]').innerText(),
        /accepts with laika agent accept/,
      );

      const pending = tab(h.page).locator('[data-offer-id="o-to-me-pending"]');
      assert.match(
        await pending.locator('[data-approval]').innerText(),
        /Waiting for a person to approve/,
      );
      assert.match(
        await pending.locator('[data-acceptance]').innerText(),
        /can accept once it is approved/,
      );
      assert.equal(await pending.locator('[data-approve]').count(), 0);

      await tab(h.page).locator('[data-filter="recovery"]').click();
      const recovery = tab(h.page).locator('[data-offer-id="o-recovery"]');
      await recovery.waitFor();
      assert.match(await recovery.locator('.handoff-kind').innerText(), /Recovery offer/);
      assert.match(await recovery.locator('.handoff-route').innerText(), /Any eligible agent/);
      const recoveryShape = await recovery.locator('.handoff-kind-icon').innerHTML();
      await tab(h.page).locator('[data-filter="sent"]').click();
      const sent = tab(h.page).locator('[data-offer-id="o-sent"]');
      await sent.waitFor();
      assert.equal(await sent.locator('[data-withdraw]').count(), 1);
      assert.equal(await sent.locator('[data-approve]').count(), 0);
      assert.notEqual(
        await sent.locator('.handoff-kind-icon').innerHTML(),
        recoveryShape,
        'a recovery and a hand-off draw the same shape',
      );
    } finally {
      await h.close();
    }
  });

  void test('Approve: never for the receiver’s owner; approving holds the row in place', async () => {
    const w = world();
    const h = await inbox(w);
    try {
      await tab(h.page).locator('[data-filter="needs_approval"]').click();
      await eventually(async () => (await idsOf(h.page)).join() === 'o-approve,o-mine-approve');
      assert.equal(
        await tab(h.page).locator('[data-offer-id="o-mine-approve"] [data-approve]').count(),
        0,
        'Approve offered to the owner of the receiving agent',
      );
      const approve = tab(h.page).locator('[data-offer-id="o-approve"] [data-approve]');
      await approve.click();
      const target = tab(h.page).locator('[data-offer-id="o-approve"]');
      await eventually(async () =>
        (await target.innerText()).includes(
          'Approved. The receiving agent still has to accept it.',
        ),
      );
      // The re-read no longer lists it; the focus is in the list, so it stays put.
      await eventually(async () => (await target.innerText()).includes('No longer in this view'));
      assert.deepEqual(await idsOf(h.page), ['o-approve', 'o-mine-approve']);
      const badge = h.page.locator('.sidebar-link', { hasText: 'Inbox' }).locator('.sidebar-count');
      await eventually(async () => (await badge.innerText()).startsWith('3'));
      assert.ok(
        h.calls.some(
          (c) => c.method === 'POST' && c.path === '/api/v1/handoff-offers/o-approve/approve',
        ),
      );
    } finally {
      await h.close();
    }
  });

  void test('keyboard: the views are tabs — one selected, arrows, Home and End', async () => {
    const h = await inbox(world());
    try {
      const list = tab(h.page).getByRole('tablist', { name: 'Show hand-offs' });
      const tabs = list.getByRole('tab');
      assert.equal(await tabs.count(), 4);
      const state = async () =>
        tabs.evaluateAll((els) =>
          els.map((el) => [
            el.getAttribute('data-filter'),
            el.getAttribute('aria-selected'),
            el.getAttribute('tabindex'),
          ]),
        );
      const only = (id: string) =>
        ['received', 'sent', 'needs_approval', 'recovery'].map((f) => [
          f,
          f === id ? 'true' : 'false',
          f === id ? '0' : '-1',
        ]);
      const focused = () =>
        h.page.evaluate(() => document.activeElement?.getAttribute('data-filter') ?? null);
      assert.deepEqual(await state(), only('received'));

      await tab(h.page).locator('[data-filter="received"]').focus();
      await h.page.keyboard.press('ArrowRight');
      await eventually(async () => JSON.stringify(await state()) === JSON.stringify(only('sent')));
      assert.equal(await focused(), 'sent');
      await tab(h.page).locator('[data-offer-id="o-sent"]').waitFor();
      const panel = tab(h.page).getByRole('tabpanel');
      assert.equal(
        await panel.getAttribute('aria-labelledby'),
        await tab(h.page).locator('[data-filter="sent"]').getAttribute('id'),
      );

      await h.page.keyboard.press('End');
      await eventually(async () => (await focused()) === 'recovery');
      assert.deepEqual(await state(), only('recovery'));
      await h.page.keyboard.press('ArrowRight');
      await eventually(async () => (await focused()) === 'received');
      assert.deepEqual(await state(), only('received'));
      await h.page.keyboard.press('ArrowLeft');
      await eventually(async () => (await focused()) === 'recovery');
      await h.page.keyboard.press('Home');
      await eventually(async () => (await focused()) === 'received');
      assert.deepEqual(await state(), only('received'));

      // Tab leaves the tablist rather than walking through the other tabs.
      await h.page.keyboard.press('Tab');
      assert.equal(await focused(), null);
    } finally {
      await h.close();
    }
  });

  void test('a late Show more page stays in the view that asked for it', async () => {
    const w = world({ paged: true });
    const h = await inbox(w);
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    let asked = false;
    let answered = false;
    await h.page.route('**/api/v1/handoff-offers?*cursor=C2*', async (route) => {
      asked = true;
      await held;
      await route.continue().catch(() => undefined);
      answered = true;
    });
    try {
      const more = tab(h.page).getByRole('button', { name: 'Show more' });
      await more.click();
      await eventually(() => asked);
      await tab(h.page).locator('[data-filter="sent"]').click();
      await tab(h.page).locator('[data-offer-id="o-sent"]').waitFor();
      release();
      await eventually(() => answered);
      // Give a late answer every chance to land.
      await new Promise((done) => setTimeout(done, 500));
      assert.deepEqual(await idsOf(h.page), ['o-sent'], 'Received’s page landed in Sent');
      await tab(h.page).locator('[data-filter="received"]').click();
      await eventually(async () => (await idsOf(h.page)).includes('o-to-me'));
      assert.ok(!(await idsOf(h.page)).includes('o-late'), 'a dropped page came back later');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('overlapping approvals: a row stays busy until its own request answers', async () => {
    const h = await inbox(world({ twoToApprove: true }));
    const gates = new Map<string, () => void>();
    const sent: string[] = [];
    h.page.on('request', (request) => {
      const id = /handoff-offers\/([^/]+)\/approve/.exec(request.url())?.[1];
      if (request.method() === 'POST' && id !== undefined) sent.push(id);
    });
    await h.page.route('**/api/v1/handoff-offers/*/approve', async (route) => {
      const id = /handoff-offers\/([^/]+)\/approve/.exec(route.request().url())?.[1] ?? '';
      await new Promise<void>((done) => gates.set(id, done));
      await route.continue().catch(() => undefined);
    });
    try {
      await tab(h.page).locator('[data-filter="needs_approval"]').click();
      const a = tab(h.page).locator('[data-offer-id="o-approve"] [data-approve]');
      const b = tab(h.page).locator('[data-offer-id="o-approve-2"] [data-approve]');
      await a.waitFor();
      await b.waitFor();

      await a.click();
      await eventually(() => gates.has('o-approve'));
      await b.click();
      await eventually(() => gates.has('o-approve-2'));
      assert.equal(await a.getAttribute('aria-disabled'), 'true');
      assert.equal(await b.getAttribute('aria-disabled'), 'true');

      // B answers; A's request is still out, so A stays busy and a second
      // press sends nothing.
      gates.get('o-approve-2')?.();
      await eventually(async () =>
        (await tab(h.page).locator('[data-offer-id="o-approve-2"]').innerText()).includes(
          'Approved.',
        ),
      );
      assert.equal(await a.getAttribute('aria-disabled'), 'true', 'A was re-enabled by B');
      await a.click({ force: true });
      await new Promise((done) => setTimeout(done, 300));
      assert.deepEqual(sent, ['o-approve', 'o-approve-2'], 'A was sent twice');

      gates.get('o-approve')?.();
      await eventually(async () =>
        (await tab(h.page).locator('[data-offer-id="o-approve"]').innerText()).includes(
          'Approved.',
        ),
      );
      assert.deepEqual(sent, ['o-approve', 'o-approve-2']);
    } finally {
      for (const release of gates.values()) release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('when a re-read takes the focused action away, the focus stays in its row', async () => {
    const h = await inbox(world());
    try {
      await tab(h.page).locator('[data-filter="needs_approval"]').click();
      const target = tab(h.page).locator('[data-offer-id="o-approve"]');
      const approve = target.locator('[data-approve]');
      await approve.waitFor();
      await approve.focus();
      await h.page.keyboard.press('Enter');
      // The re-read no longer lists it as the reader's to approve: Approve goes.
      await eventually(async () => (await approve.count()) === 0);
      await eventually(() =>
        h.page.evaluate(
          () =>
            document.activeElement?.closest('[data-offer-id]')?.getAttribute('data-offer-id') ===
              'o-approve' && document.activeElement.hasAttribute('data-next'),
        ),
      );
      assert.notEqual(
        await h.page.evaluate(() => document.activeElement?.tagName),
        'BODY',
        'the focus fell to the page',
      );
      const status = target.locator('[data-row-status]');
      assert.equal(await status.getAttribute('role'), 'status');
      assert.match(
        await status.innerText(),
        /Approved\. The receiving agent still has to accept it\./,
      );
    } finally {
      await h.close();
    }
  });

  void test('a failed first read is an error; a failed re-read keeps the rows, stale', async () => {
    const w = world();
    w.reachable = false;
    const h = await open('/inbox?tab=handoffs', w.stub);
    try {
      const retry = tab(h.page).getByRole('button', { name: /Try again|Retry/ });
      await retry.first().waitFor({ timeout: 20_000 });
      assert.equal(await rowsOf(h.page).count(), 0, 'a failed read drew rows');
      w.reachable = true;
      await retry.first().click();
      await tab(h.page).locator('[data-filter="needs_approval"]').click();
      await eventually(async () => (await idsOf(h.page)).includes('o-approve'));

      // The approve lands; the re-read after it does not.
      w.reachable = false;
      await tab(h.page).locator('[data-offer-id="o-approve"] [data-approve]').click();
      const stale = tab(h.page).locator('[data-stale]');
      await stale.waitFor();
      assert.match(await stale.innerText(), /Could not refresh — showing what was read at/);
      assert.ok((await idsOf(h.page)).includes('o-approve'), 'a failed re-read emptied the list');

      w.reachable = true;
      await stale.getByRole('button', { name: 'Try again' }).click();
      await eventually(async () => (await stale.count()) === 0);
    } finally {
      await h.close();
    }
  });
});

void describe('Settings → Access: the hand-off policy', () => {
  const access = '/spaces/laika/settings?tab=access';

  void test('a lead saves all four settings at once', async () => {
    const w = world();
    const h = await open(access, w.stub);
    try {
      const section = h.page.locator('[data-handoff-policy-section]');
      const others = section.getByRole('switch', { name: /Agents other people own/ });
      await others.waitFor({ timeout: 20_000 });
      assert.match(await section.innerText(), /Laika’s defaults/);
      await others.click();
      await eventually(() => w.policyWrites.length === 1);
      assert.deepEqual(w.policyWrites[0], {
        allow_other_owners: true,
        cross_owner_requires_approval: true,
        max_handoffs: 3,
        offer_ttl_minutes: 30,
      });
      await eventually(async () => !(await section.innerText()).includes('Laika’s defaults'));
      const max = section.getByRole('spinbutton', { name: 'Hand-offs per task' });
      assert.equal(await max.getAttribute('max'), '20');
      assert.equal(await max.getAttribute('min'), '0');
      await max.fill('25');
      await max.press('Enter');
      await eventually(() => w.policyWrites.length === 2);
      assert.equal((w.policyWrites[1] as { max_handoffs: number }).max_handoffs, 20, 'not clamped');
    } finally {
      await h.close();
    }
  });

  void test('a member sees the values and no control', async () => {
    const w = world({ lead: false });
    const h = await open(access, w.stub);
    try {
      const section = h.page.locator('[data-handoff-policy-section]');
      await section.locator('[data-policy-readonly]').waitFor({ timeout: 20_000 });
      for (const sw of await section.getByRole('switch').all())
        assert.equal(await sw.isDisabled(), true);
      assert.equal(
        await section.getByRole('spinbutton', { name: 'Hand-offs per task' }).isDisabled(),
        true,
      );
      assert.equal(
        await section.getByRole('spinbutton', { name: 'Hand-offs per task' }).inputValue(),
        '3',
      );
      assert.equal(w.policyWrites.length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a refused save says so beside the form and keeps what the server holds', async () => {
    const w = world({ refusePolicy: true });
    const h = await open(access, w.stub);
    try {
      const section = h.page.locator('[data-handoff-policy-section]');
      const others = section.getByRole('switch', { name: /Agents other people own/ });
      await others.waitFor({ timeout: 20_000 });
      await others.click();
      const alert = section.locator('[data-error="handoff_policy"]');
      await alert.waitFor();
      assert.match(
        await alert.innerText(),
        /Not saved: Only a space lead can change the hand-off policy/,
      );
      assert.equal(await others.getAttribute('aria-checked'), 'false');

      // A refused number goes back to what the server holds, and says why.
      const max = section.getByRole('spinbutton', { name: 'Hand-offs per task' });
      await max.fill('7');
      await max.press('Enter');
      await eventually(() => w.policyWrites.length === 2);
      await eventually(async () => (await max.inputValue()) === '3');
      assert.match(await alert.innerText(), /Not saved: Only a space lead/);
    } finally {
      await h.close();
    }
  });
});

/** Each view's first row, so a shot waits for its own view and never the last one's. */
const FIRST_OF: Readonly<Record<string, string>> = {
  received: 'o-to-me',
  sent: 'o-sent',
  needs_approval: 'o-approve',
  recovery: 'o-recovery',
};

void describe('screenshots', () => {
  void test(
    'every filter and the policy, both themes, desktop and phone',
    { skip: SHOTS === undefined },
    async () => {
      const dir = SHOTS ?? '';
      mkdirSync(dir, { recursive: true });
      for (const theme of ['light', 'dark']) {
        for (const width of [1440, 390]) {
          const h = await inbox(world());
          try {
            await h.page.setViewportSize({ width, height: 1000 });
            await setTheme(h.page, theme);
            for (const filter of ['received', 'sent', 'needs_approval', 'recovery']) {
              await tab(h.page).locator(`[data-filter="${filter}"]`).click();
              await tab(h.page)
                .locator(`[data-offer-id="${FIRST_OF[filter] ?? ''}"]`)
                .waitFor();
              const scroll = await h.page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
              );
              assert.ok(scroll <= 0, `${filter} scrolls sideways at ${String(width)}px`);
              await h.page.screenshot({
                path: join(dir, `inbox-handoffs-${filter}-${theme}-${String(width)}.png`),
                fullPage: true,
              });
            }
          } finally {
            await h.close();
          }
          const p = await open('/spaces/laika/settings?tab=access', world().stub);
          try {
            await p.page.setViewportSize({ width, height: 1000 });
            await setTheme(p.page, theme);
            const section = p.page.locator('[data-handoff-policy-section]');
            await section.getByRole('switch').first().waitFor({ timeout: 20_000 });
            await section.screenshot({
              path: join(dir, `access-handoff-policy-${theme}-${String(width)}.png`),
            });
          } finally {
            await p.close();
          }
        }
      }
    },
  );
});
