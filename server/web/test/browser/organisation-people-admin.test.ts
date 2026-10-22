/**
 * LAI-987's People features, in LAI-893's tab (LAI-999, D-107): last sign-in,
 * the Deactivated and space filters, Transfer ownership with a typed email,
 * extra owners reported, the invite dialog's space, lifetime, per-address
 * results and Copy link, Re-issue and a confirmed Revoke on Pending, the
 * organisation's name on Overview — and the screen at 1440 and 390, light and
 * dark.
 *
 * Each reads what a person would see, or what the page sent.
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
  reply,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { capacityPerson } from './capacity-org.ts';
import { pick } from './dropdown.ts';

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const user = (
  id: string,
  name: string,
  org_role: string,
  extra: { is_active?: boolean; last_seen_at?: number | null } = {},
) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: extra.is_active ?? true,
  last_seen_at: extra.last_seen_at ?? null,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  user('u1', 'Ada Lovelace', 'owner', { last_seen_at: NOW - 5 * 60_000 }),
  user('u2', 'Tomas Nel', 'member', { last_seen_at: NOW - 3 * HOUR }),
  user('u3', 'Priya Raman', 'admin'),
  user('u4', 'Sam Okafor', 'viewer', { is_active: false }),
  user('u5', 'Grace Hopper', 'member'),
];

const PROJECT = {
  id: 'p1',
  slug: 'core',
  name: 'Core',
  prefix: 'COR',
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
  last_activity_at: null,
};

const coreSpace = {
  project_id: 'p1',
  slug: 'core',
  name: 'Core',
  load: 'light',
  in_progress: 0,
  todo: 0,
  backlog: 0,
  in_review: 0,
  committed: 0,
  overdue: 0,
  due_soon: 0,
  open: 0,
};

const CAPACITY = {
  enabled: true,
  people: PEOPLE.map((p) =>
    capacityPerson({
      user_id: p.id,
      name: p.name,
      status: 'offline',
      last_seen: null,
      spaces: p.id === 'u2' ? [coreSpace] : [],
      agents: [],
    }),
  ),
};

const ORG = {
  id: 'o1',
  name: 'Northwind',
  presence_enabled: true,
  developer_insights: false,
  created_at: 1,
  updated_at: 2,
};

const INVITE = {
  id: 'i1',
  email: 'lost@example.com',
  org_role: 'member',
  project_id: 'p1',
  project_role: 'member',
  created_by: 'u1',
  created_at: NOW - HOUR,
  expires_at: NOW + 3 * DAY,
  email_sent: false,
};

const me = (id: string, org_role: string) => ({
  ...user(id, PEOPLE.find((p) => p.id === id)?.name ?? 'Someone', org_role),
  memberships: [],
});

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

const OWNER_ACTIONS = [
  'user.invite',
  'user.deactivate',
  'user.set_role',
  'org.settings.edit',
  'org.transfer_ownership',
  'token.list_any',
];

const base = (meId: string, role: string, actions: readonly string[]): ApiStub => ({
  '/api/v1/projects': { data: [PROJECT], next_cursor: null },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: [INVITE], next_cursor: null },
  '/api/v1/capacity': CAPACITY,
  '/api/v1/org': ORG,
  '/api/v1/me': me(meId, role),
  '/api/v1/permissions': permissions(role, actions),
});

const OWNER = (): ApiStub => base('u1', 'owner', OWNER_ACTIONS);

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const rows = (page: Page) => page.locator('.org-person');

async function ready(page: Page): Promise<void> {
  await rows(page).first().waitFor({ timeout: 20_000 });
  await until(async () => (await rows(page).count()) === PEOPLE.length);
}

void after(async () => {
  await closeBrowser();
});

void describe('the table', () => {
  void test('each row says when they last signed in, or Never', async () => {
    const h = await open('/organisation?tab=people', OWNER());
    try {
      await ready(h.page);
      const signedIn = (name: string) =>
        h.page.locator('.org-person', { hasText: name }).locator('[data-last-sign-in]').innerText();
      assert.equal((await signedIn('Tomas Nel')).trim(), '3h ago');
      assert.equal((await signedIn('Priya Raman')).trim(), 'Never');
    } finally {
      await h.close();
    }
  });

  void test('Deactivated and a space each narrow the table', async () => {
    const h = await open('/organisation?tab=people', OWNER());
    try {
      await ready(h.page);
      await h.page.locator('[data-people-filter="off"]').click();
      await until(async () => (await rows(h.page).count()) === 1);
      assert.match(await rows(h.page).first().innerText(), /Sam Okafor/);

      await h.page.locator('[data-people-filter="all"]').click();
      await pick(h.page.locator('.org-people-space'), 'core');
      await until(async () => (await rows(h.page).count()) === 1);
      assert.match(await rows(h.page).first().innerText(), /Tomas Nel/);
    } finally {
      await h.close();
    }
  });

  void test('an owner row is text — no picker, no Deactivate — whoever reads it', async () => {
    const h = await open('/organisation?tab=people', {
      ...OWNER(),
      '/api/v1/users': {
        data: [...PEOPLE, user('u6', 'Old Owner', 'owner')],
        next_cursor: null,
      },
    });
    try {
      await rows(h.page).first().waitFor({ timeout: 20_000 });
      const old = h.page.locator('.org-person', { hasText: 'Old Owner' });
      await old.waitFor({ timeout: 20_000 });
      assert.equal(await old.locator('[role="combobox"], button, input').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('transfer ownership (D-104 item 2)', () => {
  void test('the owner names someone, types their email, and the server is asked', async () => {
    let body: unknown;
    const h = await open('/organisation?tab=people', {
      ...OWNER(),
      '/api/v1/org/transfer-ownership': (call: StubCall) => {
        body = call.body;
        return {
          owner: user('u3', 'Priya Raman', 'owner'),
          previous_owner: user('u1', 'Ada Lovelace', 'admin'),
        };
      },
    });
    try {
      const card = h.page.locator('.org-transfer');
      await card.waitFor({ timeout: 20_000 });
      const openIt = card.locator('[data-transfer-open] button');
      assert.equal(await openIt.isDisabled(), true, 'offered before anyone was chosen');

      await pick(card.getByRole('combobox'), 'u3');
      await openIt.click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 20_000 });
      const confirm = dialog.locator('[data-confirm-ok] button');
      assert.equal(await confirm.isDisabled(), true, 'confirmable without typing the email');

      await dialog.locator('input').fill('U3@example.com');
      assert.equal(await confirm.isDisabled(), false);
      await confirm.click();
      await until(() => body !== undefined);
      assert.deepEqual(body, { user_id: 'u3', confirm: 'U3@example.com' });
    } finally {
      await h.close();
    }
  });

  void test('a refused transfer shows the server’s sentence in the dialog', async () => {
    const MESSAGE = "Type the new owner's email to confirm.";
    const h = await open('/organisation?tab=people', {
      ...OWNER(),
      '/api/v1/org/transfer-ownership': refuse(422, 'unprocessable', MESSAGE),
    });
    try {
      const card = h.page.locator('.org-transfer');
      await card.waitFor({ timeout: 20_000 });
      await pick(card.getByRole('combobox'), 'u2');
      await card.locator('[data-transfer-open] button').click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.locator('input').fill('u2@example.com');
      await dialog.locator('[data-confirm-ok] button').click();
      const error = dialog.locator('.org-confirm-error');
      await error.waitFor({ timeout: 20_000 });
      assert.equal(await error.innerText(), MESSAGE);
    } finally {
      await h.close();
    }
  });

  void test('an admin is offered no transfer and no role picker', async () => {
    const h = await open(
      '/organisation?tab=people',
      base('u3', 'admin', ['user.invite', 'user.deactivate']),
    );
    try {
      await ready(h.page);
      await until(async () => (await h.page.locator('.org-deactivate').count()) > 0);
      assert.equal(await h.page.locator('.org-transfer').count(), 0);
      assert.equal(await h.page.locator('.org-person [role="combobox"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('extra owners from before D-104 are reported to the owner, with Make admin', async () => {
    const h = await open('/organisation?tab=people', {
      ...OWNER(),
      '/api/v1/org': {
        ...ORG,
        extra_owners: [{ id: 'u3', name: 'Priya Raman', email: 'u3@example.com' }],
      },
    });
    try {
      const card = h.page.locator('.org-extra-owners');
      await card.waitFor({ timeout: 20_000 });
      assert.match(await card.innerText(), /Priya Raman/);
      await card.locator('.org-make-admin').click();
      await h.page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();
      await until(() => h.calls.some((c) => c.method === 'PATCH'));
      const patch = h.calls.find((c) => c.method === 'PATCH');
      assert.equal(patch?.path, '/api/v1/users/u3');
      assert.deepEqual(patch?.body, { org_role: 'admin' });
    } finally {
      await h.close();
    }
  });
});

void describe('invites', () => {
  void test('the dialog sends a space and a lifetime, answers per address, and copies each link', async () => {
    const posted: unknown[] = [];
    const h = await open('/organisation?tab=people', {
      ...OWNER(),
      '/api/v1/invites': (call: StubCall) => {
        if (call.method !== 'POST') return { data: [INVITE], next_cursor: null };
        posted.push(call.body);
        const email = (call.body as { email: string }).email;
        if (email === 'taken@example.com') {
          return refuse(409, 'conflict', 'taken@example.com already has a pending invite');
        }
        return reply(201, {
          invite: { ...INVITE, id: `new-${String(posted.length)}`, email },
          token: 't',
          accept_url: `https://laika.test/invite/${email}`,
        });
      },
    });
    try {
      await h.page.locator('[data-invite-open]').click();
      const dialog = h.page.locator('[data-invite-dialog]');
      await dialog.waitFor({ timeout: 20_000 });

      const emails = dialog.locator('[data-invite-emails]');
      await emails.fill('one@example.com, nope');
      await dialog.locator('[data-invite-rejected]').waitFor({ timeout: 5_000 });
      assert.match(await dialog.locator('[data-invite-rejected]').innerText(), /nope/);
      assert.equal(await dialog.getByRole('button', { name: 'Send invite' }).isDisabled(), true);

      await emails.fill('one@example.com, taken@example.com');
      await pick(dialog.locator('.org-invite-space'), 'p1');
      await dialog.locator('[data-invite-expiry="30"]').click();
      await dialog.getByRole('button', { name: 'Send 2 invites' }).click();

      await until(() => posted.length === 2);
      assert.deepEqual(posted[0], {
        email: 'one@example.com',
        org_role: 'member',
        project_id: 'p1',
        project_role: 'member',
        expires_in_days: 30,
      });
      const ok = dialog.locator('[data-issued-ok="true"]');
      const refused = dialog.locator('[data-issued-ok="false"]');
      await ok.first().waitFor({ timeout: 20_000 });
      assert.equal(await ok.count(), 1);
      assert.match(await refused.innerText(), /already has a pending invite/);
      assert.equal(await ok.getByRole('button', { name: /copy/i }).count(), 1);
      assert.match(await dialog.innerText(), /1 of 2 invites created/);
    } finally {
      await h.close();
    }
  });

  void test('Pending says which space, Re-issue shows the new link once, Revoke asks first', async () => {
    const h = await open('/organisation?tab=people', {
      ...OWNER(),
      '/api/v1/invites/i1/reissue': reply(201, {
        invite: { ...INVITE, id: 'i2' },
        token: 't2',
        accept_url: 'https://laika.test/invite/new-link',
      }),
      '/api/v1/invites/i1': () => ({}),
    });
    try {
      await ready(h.page);
      await h.page.locator('[data-people-filter="pending"]').click();
      const pending = h.page.locator('[data-people-pending]');
      await pending.waitFor({ timeout: 20_000 });
      assert.match(await pending.locator('[data-invite="i1"]').innerText(), /into Core as member/);

      await pending.locator('[data-invite-reissue]').click();
      const issued = pending.locator('[data-invite-reissued]');
      await issued.waitFor({ timeout: 20_000 });
      assert.equal(
        await issued.locator('.org-issued-url').innerText(),
        'https://laika.test/invite/new-link',
      );
      assert.ok(
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/invites/i1/reissue'),
      );

      await pending.getByRole('button', { name: 'Revoke' }).click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      assert.match(await dialog.innerText(), /lost@example\.com/);
      await dialog.locator('[data-confirm-cancel] button').click();
      await h.page.waitForTimeout(300);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);

      await pending.getByRole('button', { name: 'Revoke' }).click();
      await h.page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();
      await until(() => h.calls.some((c) => c.method === 'DELETE'));
      assert.ok(h.calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/invites/i1'));
    } finally {
      await h.close();
    }
  });
});

void describe('the organisation’s name (D-104 item 7)', () => {
  void test('a holder of org.settings.edit renames it; a reader without it sees text', async () => {
    let body: unknown;
    const h = await open('/organisation', {
      ...OWNER(),
      '/api/v1/org': (call: StubCall) => {
        if (call.method === 'PATCH') {
          body = call.body;
          return { ...ORG, name: 'Southwind' };
        }
        return ORG;
      },
    });
    try {
      const input = h.page.locator('.org-name-input');
      await input.waitFor({ timeout: 20_000 });
      await input.fill('  Southwind ');
      await h.page.locator('[data-org-name-save] button').click();
      await until(() => body !== undefined);
      assert.deepEqual(body, { name: 'Southwind' });
    } finally {
      await h.close();
    }

    const member = await open('/organisation', base('u2', 'member', []));
    try {
      await member.page.locator('[data-fact="name"]').waitFor({ timeout: 20_000 });
      assert.equal(await member.page.locator('.org-name-input').count(), 0);
      assert.match(await member.page.locator('[data-fact="name"]').innerText(), /Northwind/);
    } finally {
      await member.close();
    }
  });
});

void describe('light and dark, wide and narrow', () => {
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: People stays inside the viewport`, async () => {
        const h = await open('/organisation?tab=people', OWNER());
        try {
          await h.page.setViewportSize({ width, height: 1000 });
          await ready(h.page);
          await setTheme(h.page, theme);
          await h.page.waitForTimeout(200);

          const sideways = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.equal(sideways, 0, `the page scrolls sideways by ${String(sideways)}px`);
          // Measured against the viewport: an ancestor's clipping would keep the
          // page from scrolling and still cut the cards off.
          for (const selector of ['.org-people-card', '.org-transfer']) {
            const box = await h.page.locator(selector).boundingBox();
            assert.ok(
              box !== null && box.x + box.width <= width + 1,
              `${selector} runs ${String(Math.round((box?.x ?? 0) + (box?.width ?? 0) - width))}px past the viewport`,
            );
          }

          await shoot(h.page, `people-${theme}-${String(width)}`);
          await h.page.locator('[data-invite-open]').click();
          await h.page.locator('[data-invite-dialog]').waitFor({ timeout: 20_000 });
          const dialog = await h.page.locator('[data-invite-dialog]').boundingBox();
          assert.ok(dialog !== null && dialog.x >= 0 && dialog.x + dialog.width <= width + 1);
          await shoot(h.page, `people-invite-${theme}-${String(width)}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});
