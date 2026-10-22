/**
 * The person admin panel and the reset-link page, in a real browser (D-104,
 * LAI-988).
 *
 * What the server tests cannot see: that the `409 open_tasks` a deactivation
 * or a removal is refused with becomes the offboarding dialog's question, with
 * **Unassign** pre-selected and the answer sent back; that a reset link is
 * drawn once and gone when put away, and never reaches the console; that the
 * public page says which of used, revoked, expired, unknown or deactivated a
 * link was; and that an admin the owner withdrew grants from is **never**
 * shown a control (`watchFor`, from before the app boots — LAI-970).
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  everSeen,
  open,
  refuse,
  reply,
  until,
  watchFor,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { optionsOf, pick } from './dropdown.ts';

const NOW = Date.now();
const DAY = 86_400_000;
const WEEK = 7 * DAY;

const person = (id: string, name: string, org_role: string, is_active = true) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  person('u1', 'Ada Owner', 'owner'),
  person('u2', 'Bea Builder', 'member'),
  person('u3', 'Cal Lead', 'member'),
  person('u4', 'Ari Admin', 'admin'),
];

const me = (id: string, org_role: string) => ({
  ...(PEOPLE.find((p) => p.id === id) ?? person(id, 'Someone', org_role)),
  org_role,
  memberships: [{ project_id: 'p1', role: 'lead' }],
});

/** A profile with nothing in it but the person — the panel is what is under test. */
function profile(user: ReturnType<typeof person>) {
  const zeros = Array.from({ length: 12 }, (_, i) => ({
    week_start: NOW - (12 - i) * WEEK,
    accepted: 0,
    sent_back: 0,
  }));
  return {
    user: { ...user, profile_kind: 'builder', created_at: NOW - 100 * DAY },
    window: { weeks: 12, since: NOW - 12 * WEEK, until: NOW },
    projects: [],
    review: {
      accepted: 0,
      sent_back: 0,
      last_30_days: 0,
      per_week: zeros,
      time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
      recent: [],
    },
    ratings: [],
    ratings_total: 0,
    activity_sharing: { org_enabled: false, enabled: false },
    current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
    delivery: {
      accepted_per_week: zeros.map((w) => ({ week_start: w.week_start, accepted: 0 })),
      accepted: 0,
      sent_back: 0,
      reopened: 0,
      cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
    },
    agents: {
      tokens: [],
      tokens_total: 0,
      online: { enabled: true, clients: [], last_seen: null },
      writes: [],
      writes_total: 0,
    },
  };
}

const quietActivity = () => {
  const days = 364;
  const zeros = () => new Array<number>(days).fill(0);
  return {
    range: '52w',
    start: new Date(NOW - (days - 1) * DAY).toISOString().slice(0, 10),
    end: new Date(NOW).toISOString().slice(0, 10),
    tz: 'UTC',
    sharing: { org_enabled: false, enabled: false },
    series: {
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
      board_self: zeros(),
      board_agent: zeros(),
    },
    prompts_by_agent: {},
    agents: [],
  };
};

const quietUsage = (userId: string) => ({
  user_id: userId,
  from: '2026-07-27',
  to: '2026-10-18',
  weeks: [],
  totals: {
    tokens: 0,
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    attributed_tokens: 0,
    cost: { usd: 0, unpriced_tokens: 0, unpriced_models: [], unconfirmed_models: [] },
  },
  by_agent: [],
  by_model: [],
  no_token_data: [],
  sharing: { org_enabled: true, enabled: true },
});

const SPACE = (id: string, slug: string, name: string, prefix: string) => ({
  id,
  slug,
  name,
  prefix,
  description: null,
  repo: null,
  visibility: 'private',
  color: null,
  task_create_min_role: 'member',
  agents_allowed: true,
  former_prefixes: [],
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 1,
});

const membership = (
  project_id: string,
  slug: string,
  name: string,
  prefix: string,
  role: string,
) => ({
  project_id,
  slug,
  name,
  prefix,
  role,
  archived: false,
  joined_at: NOW - 30 * DAY,
});

const token = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  prefix: `lai_${id}`,
  scope: 'full',
  project_ids: null,
  last_used_at: NOW - 2 * 3_600_000,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  expires_at: null,
  revoked_at: null,
  created_at: NOW - 40 * DAY,
  ...extra,
});

/** Bea's profile, read by `/me`; each test adds or replaces what it is about. */
function stub(viewer: ReturnType<typeof me>, overrides: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': viewer,
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/users': { data: PEOPLE, next_cursor: null },
    '/api/v1/projects': {
      data: [SPACE('p1', 'laika-core', 'Laika Core', 'LC'), SPACE('p2', 'orbit', 'Orbit', 'ORB')],
      next_cursor: null,
    },
    '/api/v1/users/u2/profile': profile(PEOPLE[1]!),
    '/api/v1/users/u1/profile': profile(PEOPLE[0]!),
    '/api/v1/users/u2/usage': quietUsage('u2'),
    '/api/v1/users/u1/usage': quietUsage('u1'),
    '/api/v1/people/u2/activity': quietActivity,
    '/api/v1/people/u1/activity': quietActivity,
    '/api/v1/users/u2/tokens': { data: [token('k1', 'Laptop Claude')], next_cursor: null },
    '/api/v1/users/u1/tokens': { data: [], next_cursor: null },
    '/api/v1/users/u2/memberships': {
      data: [membership('p1', 'laika-core', 'Laika Core', 'LC', 'member')],
    },
    '/api/v1/users/u1/memberships': { data: [] },
    '/api/v1/projects/laika-core/members': {
      members: [
        {
          user_id: 'u2',
          name: 'Bea Builder',
          email: 'u2@example.com',
          role: 'member',
          created_at: 1,
        },
        { user_id: 'u3', name: 'Cal Lead', email: 'u3@example.com', role: 'lead', created_at: 1 },
      ],
    },
    ...overrides,
  };
}

const OWNER = me('u1', 'owner');
const ADMIN = me('u4', 'admin');

async function panel(h: Harness) {
  const found = h.page.locator('.prof-card[data-section="admin"]');
  await found.waitFor({ timeout: 20_000 });
  return found;
}

/** The `409` a deactivation or a removal is refused with while they hold open work. */
const HOLDS_THREE = reply(409, {
  error: {
    code: 'conflict',
    message: 'They hold 3 open tasks; say whether to unassign or reassign them',
    details: { reason: 'open_tasks', count: 3, keys: ['LC-1', 'LC-2'], hidden: 1 },
  },
});

void after(async () => {
  await closeBrowser();
});

// -------------------------------------------------------------------- panel

void describe('the Admin panel', () => {
  void test('an owner sees every control, and the role picker never offers Owner', async () => {
    const h = await open('/people?user=u2', stub(OWNER));
    try {
      const admin = await panel(h);
      for (const sel of [
        '[data-admin-row="role"]',
        '[data-action="deactivate"]',
        '[data-action="sign-out"]',
        '[data-action="reset-link"]',
        '[data-token="k1"]',
        '[data-membership="laika-core"]',
        '[data-admin-add]',
      ]) {
        await admin.locator(sel).first().waitFor({ timeout: 10_000 });
      }
      const { labels } = await optionsOf(
        admin.locator('[data-admin-row="role"] button[role="combobox"]'),
      );
      assert.deepEqual(labels, ['Admin', 'Member', 'Viewer']);
      assert.equal(
        await admin.locator('[data-membership="laika-core"] [data-membership-role]').innerText(),
        'Member',
      );
    } finally {
      await h.close();
    }
  });

  void test('a role change asks, then sends org_role and reads the profile again', async () => {
    const sent: unknown[] = [];
    let reads = 0;
    const h = await open(
      '/people?user=u2',
      stub(OWNER, {
        '/api/v1/users/u2': (call: StubCall) => {
          sent.push(call.body);
          return { ...PEOPLE[1]!, org_role: 'admin' };
        },
        '/api/v1/users/u2/profile': () => {
          reads += 1;
          return profile(reads > 1 ? { ...PEOPLE[1]!, org_role: 'admin' } : PEOPLE[1]!);
        },
      }),
    );
    try {
      const admin = await panel(h);
      await pick(admin.locator('[data-admin-row="role"] button[role="combobox"]'), 'admin');
      assert.equal(sent.length, 0, 'changed the role without asking');
      await admin.locator('[data-action="admin-confirm"]').click();
      await until(() => sent.length === 1);
      assert.deepEqual(sent, [{ org_role: 'admin' }]);
      await until(() => reads === 2);
      assert.match(
        await admin.locator('.prof-admin-notice').innerText(),
        /Bea Builder is now Admin/,
      );
    } finally {
      await h.close();
    }
  });

  void test('on the owner’s profile an admin gets no role, deactivate or reset link (D-104)', async () => {
    const h = await open('/people?user=u1', stub(ADMIN));
    try {
      const admin = await panel(h);
      await admin.locator('[data-action="sign-out"]').waitFor();
      for (const sel of [
        '[data-admin-row="role"]',
        '[data-action="deactivate"]',
        '[data-action="reset-link"]',
      ]) {
        assert.equal(await admin.locator(sel).count(), 0, `admin offered ${sel} for the owner`);
      }
    } finally {
      await h.close();
    }
  });

  void test('a person’s own profile has no Admin panel', async () => {
    const h = await open('/people?user=u1', stub(OWNER));
    try {
      await h.page
        .locator('.prof-card[data-section="activity"], .prof-card')
        .first()
        .waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.prof-card[data-section="admin"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

// -------------------------------------------------------------- offboarding

void describe('deactivating asks about their open tasks', () => {
  void test('the 409 becomes the question, Unassign pre-selected, and the answer is sent', async () => {
    const sent: unknown[] = [];
    const h = await open(
      '/people?user=u2',
      stub(OWNER, {
        '/api/v1/users/u2': (call: StubCall) => {
          sent.push(call.body);
          const body = call.body as { open_tasks?: unknown };
          return body.open_tasks === undefined ? HOLDS_THREE : { ...PEOPLE[1]!, is_active: false };
        },
      }),
    );
    try {
      const admin = await panel(h);
      await admin.locator('[data-action="deactivate"]').click();
      const dialog = h.page.locator('.offb-dialog');
      await dialog.waitFor();
      assert.equal(await dialog.getAttribute('data-offboarding'), 'confirm');
      assert.match(await dialog.innerText(), /Every session and every token of theirs ends now/);
      assert.equal(sent.length, 0, 'deactivated without asking');

      await dialog.locator('[data-action="offboard-confirm"]').click();
      await until(async () => (await dialog.getAttribute('data-offboarding')) === 'open-tasks');
      assert.equal(
        await dialog.locator('[data-held]').innerText(),
        'They hold 3 open tasks: LC-1, LC-2 and 1 in a space you cannot see.',
      );
      assert.equal(await dialog.locator('input[value="unassign"]').isChecked(), true);
      assert.equal(
        (await dialog.locator('[data-action="offboard-confirm"]').innerText()).trim(),
        'Deactivate and unassign',
      );

      await dialog.locator('[data-action="offboard-confirm"]').click();
      await until(() => sent.length === 2);
      assert.deepEqual(sent, [{ is_active: false }, { is_active: false, open_tasks: 'unassign' }]);
      await dialog.waitFor({ state: 'detached' });
      assert.match(await admin.locator('.prof-admin-notice').innerText(), /has been deactivated/);
    } finally {
      await h.close();
    }
  });

  void test('a refused reassignment is said in the dialog, which keeps the choice; another person lands', async () => {
    const sent: unknown[] = [];
    const h = await open(
      '/people?user=u2',
      stub(OWNER, {
        '/api/v1/users/u2': (call: StubCall) => {
          sent.push(call.body);
          const body = call.body as { open_tasks?: { reassign_to?: string } | string };
          if (body.open_tasks === undefined) return HOLDS_THREE;
          if (typeof body.open_tasks === 'object' && body.open_tasks.reassign_to === 'u3') {
            return reply(422, {
              error: {
                code: 'unprocessable',
                message: 'That person cannot hold every one of these tasks; nothing was changed',
                details: {
                  field: 'open_tasks.reassign_to',
                  reason: 'cannot_hold',
                  tasks: [{ key: 'LC-2', reason: 'not_on_project' }],
                },
              },
            });
          }
          return { ...PEOPLE[1]!, is_active: false };
        },
      }),
    );
    try {
      const admin = await panel(h);
      await admin.locator('[data-action="deactivate"]').click();
      const dialog = h.page.locator('.offb-dialog');
      await dialog.locator('[data-action="offboard-confirm"]').click();
      await dialog.locator('input[value="reassign"]').waitFor();
      await dialog.locator('input[value="reassign"]').check();
      const confirm = dialog.locator('[data-action="offboard-confirm"]');
      assert.equal(await confirm.isDisabled(), true, 'reassign with nobody chosen was allowed');

      const picker = dialog.locator('button[role="combobox"]');
      await picker.waitFor();
      const { labels } = await optionsOf(picker);
      assert.ok(!labels.includes('Bea Builder'), 'offered the leaving person their own tasks');
      await pick(picker, 'u3');
      await confirm.click();
      await dialog.locator('.offb-error').waitFor();
      assert.match(await dialog.locator('.offb-error').innerText(), /not in the space of LC-2/);
      assert.equal(await dialog.locator('input[value="reassign"]').isChecked(), true);

      await pick(picker, 'u4');
      await confirm.click();
      await dialog.waitFor({ state: 'detached' });
      assert.deepEqual(sent.slice(1), [
        { is_active: false, open_tasks: { reassign_to: 'u3' } },
        { is_active: false, open_tasks: { reassign_to: 'u4' } },
      ]);
    } finally {
      await h.close();
    }
  });

  void test('Space settings → Members: Remove goes through the same dialog', async () => {
    const sent: { method: string; body: unknown }[] = [];
    let list = [
      { user_id: 'u1', name: 'Ada Owner', email: 'u1@example.com', role: 'lead', created_at: 1 },
      {
        user_id: 'u2',
        name: 'Bea Builder',
        email: 'u2@example.com',
        role: 'member',
        created_at: 1,
      },
    ];
    const h = await open(
      '/spaces/laika-core/settings?tab=members',
      stub(OWNER, {
        '/api/v1/projects/laika-core': SPACE('p1', 'laika-core', 'Laika Core', 'LC'),
        '/api/v1/projects/laika-core/members': { members: list },
        '/api/v1/projects/laika-core/members/u2': (call: StubCall) => {
          sent.push({ method: call.method, body: call.body });
          if (call.body === undefined) return HOLDS_THREE;
          list = list.filter((m) => m.user_id !== 'u2');
          return { members: list };
        },
      }),
    );
    try {
      const row = h.page.locator('[data-member="u2"]');
      await row.waitFor({ timeout: 20_000 });
      await row.locator('[data-action="remove"]').click();
      const dialog = h.page.locator('.offb-dialog');
      await dialog.waitFor();
      assert.match(
        await dialog.locator('#offb-title').innerText(),
        /Remove Bea Builder from Laika Core\?/,
      );
      await dialog.locator('[data-action="offboard-confirm"]').click();
      await dialog.locator('[data-held]').waitFor();
      await dialog.locator('[data-action="offboard-confirm"]').click();
      await h.page.locator('[data-member="u2"]').waitFor({ state: 'detached' });
      assert.deepEqual(sent, [
        { method: 'DELETE', body: undefined },
        { method: 'DELETE', body: { open_tasks: 'unassign' } },
      ]);
      assert.match(
        await h.page.locator('[data-toast]').innerText(),
        /Removed Bea Builder from Laika Core\./,
      );
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------ access, tokens

void describe('access', () => {
  void test('a reset link is shown once, copied, and gone once put away; the console never sees it', async () => {
    const URL_ = 'http://laika.test/reset-password?token=SECRET-TOKEN-0123456789';
    let issued = 0;
    const h = await open(
      '/people?user=u2',
      stub(OWNER, {
        '/api/v1/users/u2/reset-link': () => {
          issued += 1;
          return reply(201, { url: URL_, expires_at: NOW + 3_600_000 });
        },
      }),
    );
    const logged: string[] = [];
    h.page.on('console', (m) => logged.push(m.text()));
    try {
      const admin = await panel(h);
      await admin.locator('[data-action="reset-link"]').click();
      assert.equal(issued, 0, 'issued a link without asking');
      await admin.locator('[data-action="admin-confirm"]').click();
      await admin.locator('[data-reset-url]').waitFor();
      assert.equal(await admin.locator('[data-reset-url]').innerText(), URL_);
      assert.match(await admin.locator('[data-reset-link]').innerText(), /shown once/);
      await admin.locator('[data-reset-link]').getByRole('button', { name: /Copy/ }).waitFor();
      assert.equal(await admin.locator('[data-action="reset-link"]').isDisabled(), true);

      await admin.locator('[data-action="reset-done"]').click();
      await admin.locator('[data-reset-link]').waitFor({ state: 'detached' });
      assert.equal(
        await h.page
          .locator('body')
          .innerText()
          .then((t) => t.includes('SECRET-TOKEN')),
        false,
      );
      assert.equal(issued, 1);
      assert.equal(
        logged.filter((l) => l.includes('SECRET-TOKEN')).length,
        0,
        'the token was logged',
      );
    } finally {
      await h.close();
    }
  });

  void test('sign out everywhere asks, then says how many sessions ended', async () => {
    const calls: string[] = [];
    const h = await open(
      '/people?user=u2',
      stub(OWNER, {
        '/api/v1/users/u2/sign-out': (call: StubCall) => {
          calls.push(call.method);
          return { user_id: 'u2', sessions_ended: 2 };
        },
      }),
    );
    try {
      const admin = await panel(h);
      await admin.locator('[data-action="sign-out"]').click();
      assert.deepEqual(calls, []);
      await admin.locator('[data-action="admin-confirm"]').click();
      await admin.locator('.prof-admin-notice').waitFor();
      assert.deepEqual(calls, ['POST']);
      assert.match(await admin.locator('.prof-admin-notice').innerText(), /Ended 2 sessions/);
    } finally {
      await h.close();
    }
  });

  void test('their tokens: a working one is listed and revoked after asking', async () => {
    const calls: string[] = [];
    let revoked = false;
    const h = await open(
      '/people?user=u2',
      stub(OWNER, {
        '/api/v1/users/u2/tokens': () => ({
          data: [
            token('k1', 'Laptop Claude', revoked ? { revoked_at: NOW } : {}),
            token('k9', 'Old desk', { revoked_at: NOW - DAY }),
          ],
          next_cursor: null,
        }),
        '/api/v1/users/u2/tokens/k1': (call: StubCall) => {
          calls.push(call.method);
          revoked = true;
          return reply(204, null);
        },
      }),
    );
    try {
      const admin = await panel(h);
      await admin.locator('[data-token="k1"]').waitFor();
      assert.equal(
        await admin.locator('[data-token="k9"]').count(),
        0,
        'a revoked token is listed',
      );
      await admin.locator('[data-token="k1"] [data-action="revoke-token"]').click();
      await admin.locator('[data-token="k1"] [data-action="admin-confirm"]').click();
      await admin.locator('[data-token="k1"]').waitFor({ state: 'detached' });
      assert.deepEqual(calls, ['DELETE']);
      assert.match(await admin.locator('[data-admin="tokens"]').innerText(), /No working tokens/);
    } finally {
      await h.close();
    }
  });

  void test('spaces: removed through the dialog, added with a chosen role', async () => {
    const sent: string[] = [];
    let held = [membership('p1', 'laika-core', 'Laika Core', 'LC', 'member')];
    const h = await open(
      '/people?user=u2',
      stub(OWNER, {
        '/api/v1/users/u2/memberships': () => ({ data: held }),
        '/api/v1/projects/laika-core/members/u2': (call: StubCall) => {
          sent.push(`${call.method} ${JSON.stringify(call.body ?? null)}`);
          held = held.filter((m) => m.slug !== 'laika-core');
          return { members: [] };
        },
        '/api/v1/projects/orbit/members': (call: StubCall) => {
          sent.push(`${call.method} ${JSON.stringify(call.body ?? null)}`);
          held = [...held, membership('p2', 'orbit', 'Orbit', 'ORB', 'viewer')];
          return reply(201, { members: [] });
        },
      }),
    );
    try {
      const admin = await panel(h);
      const spaces = admin.locator('[data-admin="spaces"]');
      await spaces
        .locator('[data-membership="laika-core"] [data-action="remove-from-space"]')
        .click();
      await h.page.locator('.offb-dialog [data-action="offboard-confirm"]').click();
      await spaces.locator('[data-membership="laika-core"]').waitFor({ state: 'detached' });

      const add = spaces.locator('[data-admin-add]');
      await add.waitFor();
      const [space, role] = [
        add.locator('button[role="combobox"]').nth(0),
        add.locator('button[role="combobox"]').nth(1),
      ];
      await pick(space, 'orbit');
      await pick(role, 'viewer');
      await add.locator('[data-action="add-to-space"]').click();
      await spaces.locator('[data-membership="orbit"]').waitFor();
      assert.deepEqual(sent, ['DELETE null', 'POST {"user_id":"u2","role":"viewer"}']);
      assert.equal(
        await spaces.locator('[data-membership="orbit"] [data-membership-role]').innerText(),
        'Viewer',
      );
    } finally {
      await h.close();
    }
  });
});

// --------------------------------------------------------------- gates

const CONTROLS = [
  '[data-admin-row="role"]',
  '[data-action="deactivate"]',
  '[data-action="reactivate"]',
  '[data-action="sign-out"]',
  '[data-action="reset-link"]',
  '[data-action="revoke-token"]',
  '[data-admin="tokens"]',
  '[data-action="remove-from-space"]',
  '[data-admin-add]',
];

const permissions = (org_role: string, actions: readonly string[]) => ({
  org_roles: [],
  project_roles: [],
  permissions: [],
  me: {
    org_role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions,
    projects: [],
  },
});

void describe('every control is the server’s answer', () => {
  void test('an admin the owner withdrew every grant from is never shown one', async () => {
    const h = await open(
      '/people?user=u2',
      stub(ADMIN, {
        // Profiles are still theirs to open; nothing else about people is.
        '/api/v1/permissions': permissions('admin', [
          'org.read',
          'member_list.read',
          'token.read_own',
          'user.sign_out',
          'profile.read',
        ]),
      }),
      { before: (page: Page) => watchFor(page, CONTROLS) },
    );
    try {
      const admin = await panel(h);
      // The spaces list is a read every role holds; it is all that is left.
      await admin.locator('[data-membership="laika-core"]').waitFor();
      for (const sel of CONTROLS) {
        assert.equal(await everSeen(h.page, sel), false, `withdrawn admin was shown ${sel}`);
      }
    } finally {
      await h.close();
    }
  });

  void test('with no grant at all about people, there is no panel', async () => {
    const h = await open(
      '/people?user=u2',
      stub(ADMIN, { '/api/v1/permissions': permissions('admin', ['org.read', 'profile.read']) }),
      { before: (page: Page) => watchFor(page, ['.prof-card[data-section="admin"]']) },
    );
    try {
      await h.page.locator('.prof-card').first().waitFor({ timeout: 20_000 });
      assert.equal(await everSeen(h.page, '.prof-card[data-section="admin"]'), false);
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------- the reset page

void describe('/reset-password', () => {
  const ANON: ApiStub = {
    '/api/v1/me': refuse(401, 'unauthorized', 'Not signed in'),
    '/api/v1/setup/status': { setup_required: false },
  };

  async function fill(page: Page, password: string) {
    const fields = page.locator('input[type="password"]');
    await fields.nth(0).fill(password);
    await fields.nth(1).fill(password);
    await page.getByRole('button', { name: 'Set new password' }).click();
  }

  void test('sets the password with setup’s rule, posting the token in the body, then links to sign in', async () => {
    const sent: StubCall[] = [];
    const h = await open('/reset-password?token=tok-abc', {
      ...ANON,
      '/api/v1/password-resets/consume': (call: StubCall) => {
        sent.push(call);
        return { user_id: 'u2', sessions_ended: 1 };
      },
    });
    const logged: string[] = [];
    h.page.on('console', (m) => logged.push(m.text()));
    try {
      await h.page.locator('[data-reset-state="form"]').waitFor({ timeout: 20_000 });
      await fill(h.page, 'short');
      assert.match(
        await h.page.locator('[data-reset-state="form"]').innerText(),
        /at least 12 characters/,
      );
      assert.equal(sent.length, 0, 'posted a password setup would refuse');

      await fill(h.page, 'a-long-enough-password');
      await h.page.locator('[data-reset-state="done"]').waitFor();
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.path, '/api/v1/password-resets/consume');
      assert.deepEqual(sent[0]!.body, { token: 'tok-abc', new_password: 'a-long-enough-password' });
      assert.match(
        await h.page.locator('[data-reset-state="done"]').innerText(),
        /signed out of 1 other session/,
      );
      assert.equal(logged.filter((l) => l.includes('tok-abc')).length, 0, 'the token was logged');

      await h.page.getByRole('button', { name: 'Sign in' }).click();
      await until(() => h.page.url().endsWith('/login'));
      assert.ok(h.page.url().endsWith('/login'), h.page.url());
    } finally {
      await h.close();
    }
  });

  const REFUSALS: readonly (readonly [string, number, string, string, RegExp])[] = [
    ['used', 409, 'conflict', 'used', /already been used/],
    ['revoked', 409, 'conflict', 'revoked', /newer reset link replaced this one/],
    ['expired', 409, 'conflict', 'expired', /has expired/],
    ['unknown', 404, 'not_found', 'unknown', /not valid/],
    ['inactive', 403, 'forbidden', 'inactive', /has been deactivated/],
  ];

  for (const [state, status, code, reason, says] of REFUSALS) {
    void test(`a ${state} link says so, and offers sign in`, async () => {
      const h = await open('/reset-password?token=tok-x', {
        ...ANON,
        '/api/v1/password-resets/consume': reply(status, {
          error: { code, message: 'refused', details: { reason } },
        }),
      });
      try {
        await h.page.locator('[data-reset-state="form"]').waitFor({ timeout: 20_000 });
        await fill(h.page, 'a-long-enough-password');
        const card = h.page.locator(`[data-reset-state="${state}"]`);
        await card.waitFor();
        assert.match(await card.innerText(), says);
        await card.getByRole('button', { name: 'Go to sign in' }).waitFor();
      } finally {
        await h.close();
      }
    });
  }

  void test('too many attempts keeps the form, with the wait said', async () => {
    const h = await open('/reset-password?token=tok-x', {
      ...ANON,
      '/api/v1/password-resets/consume': reply(429, {
        error: {
          code: 'rate_limited',
          message: 'Too many attempts',
          details: { retry_after_seconds: 30 },
        },
      }),
    });
    try {
      await h.page.locator('[data-reset-state="form"]').waitFor({ timeout: 20_000 });
      await fill(h.page, 'a-long-enough-password');
      await h.page.locator('.auth-alert').waitFor();
      assert.match(await h.page.locator('.auth-alert').innerText(), /Wait a minute/);
      assert.equal(await h.page.locator('[data-reset-state="form"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('a link with no token says so and posts nothing', async () => {
    const h = await open('/reset-password', ANON);
    try {
      const card = h.page.locator('[data-reset-state="missing"]');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), /No reset link here/);
      assert.equal(h.calls.filter((c) => c.path.includes('password-resets')).length, 0);
    } finally {
      await h.close();
    }
  });
});
