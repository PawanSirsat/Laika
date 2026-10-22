/**
 * Organisation → People, overhauled (LAI-987): search and chips with counts,
 * a space filter, last sign-in, Transfer ownership with a typed confirmation,
 * extra owners reported, bulk invites with a result per address, Re-issue,
 * a confirmed Revoke, and the organisation's name on Overview.
 *
 * Each drives the built SPA and reads what a person would see, or what the
 * page sent — the request body is the claim, not a class name.
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
import { pick } from './dropdown.ts';

const NOW = Date.now();

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
  user('u2', 'Tomas Nel', 'member', { last_seen_at: NOW - 3 * 3_600_000 }),
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

const ORG = {
  id: 'o1',
  name: 'Northwind',
  presence_enabled: true,
  developer_insights: false,
  created_at: 1,
  updated_at: 2,
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
];

const INVITE = {
  id: 'i1',
  email: 'lost@example.com',
  org_role: 'member',
  project_id: 'p1',
  project_role: 'member',
  created_by: 'u1',
  created_at: 1,
  expires_at: NOW + 3 * 86_400_000,
  email_sent: false,
};

const base = (meId: string, role: string, actions: readonly string[]): ApiStub => ({
  '/api/v1/projects': { data: [PROJECT], next_cursor: null },
  '/api/v1/projects/core/members': {
    members: [
      { user_id: 'u2', name: 'Tomas Nel', email: 'u2@example.com', role: 'member', created_at: 1 },
    ],
  },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: [INVITE], next_cursor: null },
  '/api/v1/org': ORG,
  '/api/v1/me': me(meId, role),
  '/api/v1/permissions': permissions(role, actions),
});

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const rows = (page: Page) => page.locator('.org-people-card .org-person');

void after(async () => {
  await closeBrowser();
});

void describe('search and chips', () => {
  void test('search narrows by name or email, and lives in the address', async () => {
    const h = await open('/organisation?tab=people', base('u1', 'owner', OWNER_ACTIONS));
    try {
      await rows(h.page).first().waitFor({ timeout: 20_000 });
      await until(async () => (await rows(h.page).count()) === PEOPLE.length);

      await h.page.getByRole('searchbox', { name: 'Search people' }).fill('u5@');
      await until(async () => (await rows(h.page).count()) === 1);
      assert.equal(await rows(h.page).count(), 1);
      assert.match(await rows(h.page).first().innerText(), /Grace Hopper/);
      assert.equal(new URL(h.page.url()).searchParams.get('q'), 'u5@');
    } finally {
      await h.close();
    }
  });

  void test('role and status chips carry counts and filter the list', async () => {
    const h = await open('/organisation?tab=people', base('u1', 'owner', OWNER_ACTIONS));
    try {
      await rows(h.page).first().waitFor({ timeout: 20_000 });
      const members = h.page.locator('[data-role-filter="member"]');
      assert.match(await members.innerText(), /Members\s*2/);
      assert.match(
        await h.page.locator('[data-status-filter="off"]').innerText(),
        /Deactivated\s*1/,
      );

      await members.click();
      await until(async () => (await rows(h.page).count()) === 2);
      assert.equal(await rows(h.page).count(), 2);
      assert.equal(await members.getAttribute('aria-pressed'), 'true');
      assert.equal(new URL(h.page.url()).searchParams.get('role'), 'member');

      // Status counts honour the role chip: no deactivated member.
      assert.match(
        await h.page.locator('[data-status-filter="off"]').innerText(),
        /Deactivated\s*0/,
      );
      await h.page.locator('[data-status-filter="off"]').click();
      await h.page.locator('.org-people-none').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.org-people-none').innerText(), /Nobody matches/);
    } finally {
      await h.close();
    }
  });

  void test('a space filter shows that space’s members only', async () => {
    const h = await open('/organisation?tab=people&space=core', base('u1', 'owner', OWNER_ACTIONS));
    try {
      await rows(h.page).first().waitFor({ timeout: 20_000 });
      await until(async () => (await rows(h.page).count()) === 1);
      assert.equal(await rows(h.page).count(), 1);
      assert.match(await rows(h.page).first().innerText(), /Tomas Nel/);
      assert.ok(
        h.calls.some((c) => c.method === 'GET' && c.path === '/api/v1/projects/core/members'),
        'the space’s members were never read',
      );
    } finally {
      await h.close();
    }
  });

  void test('each row says when they last signed in, or that they never have', async () => {
    const h = await open('/organisation?tab=people', base('u1', 'owner', OWNER_ACTIONS));
    try {
      await rows(h.page).first().waitFor({ timeout: 20_000 });
      const seen = (name: string) =>
        h.page.locator('.org-person', { hasText: name }).locator('.org-person-seen').innerText();
      assert.match(await seen('Tomas Nel'), /3 h ago/);
      assert.match(await seen('Priya Raman'), /Never signed in/);
    } finally {
      await h.close();
    }
  });
});

void describe('transfer ownership (D-104 item 2)', () => {
  void test('the owner names someone, types their email, and the server is asked', async () => {
    let body: unknown;
    const stub: ApiStub = {
      ...base('u1', 'owner', OWNER_ACTIONS),
      '/api/v1/org/transfer-ownership': (call: StubCall) => {
        body = call.body;
        return {
          owner: user('u3', 'Priya Raman', 'owner'),
          previous_owner: user('u1', 'Ada Lovelace', 'admin'),
        };
      },
    };
    const h = await open('/organisation?tab=people', stub);
    try {
      const card = h.page.locator('.org-transfer');
      await card.waitFor({ timeout: 20_000 });
      const open_ = card.locator('.org-transfer-open');
      assert.equal(await open_.isDisabled(), true, 'offered before anyone was chosen');

      // Admins first, then members — never a viewer or a deactivated person.
      await pick(card.getByRole('combobox'), 'u3');
      await open_.click();
      const dialog = h.page.getByRole('alertdialog');
      await dialog.waitFor({ timeout: 20_000 });
      const confirm = dialog.locator('.org-dialog-confirm');
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
      ...base('u1', 'owner', OWNER_ACTIONS),
      '/api/v1/org/transfer-ownership': refuse(422, 'unprocessable', MESSAGE),
    });
    try {
      const card = h.page.locator('.org-transfer');
      await card.waitFor({ timeout: 20_000 });
      await pick(card.getByRole('combobox'), 'u2');
      await card.locator('.org-transfer-open').click();
      const dialog = h.page.getByRole('alertdialog');
      await dialog.locator('input').fill('u2@example.com');
      await dialog.locator('.org-dialog-confirm').click();
      const error = dialog.locator('.org-dialog-error');
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
      await rows(h.page).first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.org-deactivate').count()) > 0);
      assert.equal(await h.page.locator('.org-transfer').count(), 0);
      assert.equal(await h.page.locator('.org-person [role="combobox"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('extra owners from before D-104 are reported to the owner, with Make admin', async () => {
    const h = await open('/organisation?tab=people', {
      ...base('u1', 'owner', OWNER_ACTIONS),
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
      await h.page.getByRole('alertdialog').locator('.org-dialog-confirm').click();
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
  void test('a bulk paste creates one invite per address, into a space, with the chosen lifetime', async () => {
    const posted: unknown[] = [];
    const stub: ApiStub = {
      ...base('u1', 'owner', OWNER_ACTIONS),
      '/api/v1/invites': (call: StubCall) => {
        if (call.method !== 'POST') return { data: [], next_cursor: null };
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
    };
    const h = await open('/organisation?tab=people', stub);
    try {
      const box = h.page.locator('.org-invite-emails');
      await box.waitFor({ timeout: 20_000 });

      await box.fill('one@example.com, nope');
      await h.page.locator('.org-field-error').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.org-field-error').innerText(), /nope/);
      assert.equal(await h.page.locator('.org-invite-send').isDisabled(), true);

      await box.fill('one@example.com\ntaken@example.com; Two <two@example.com>');
      await pick(h.page.locator('.org-invite-space'), 'p1');
      await pick(h.page.locator('.org-invite-expiry'), '30');
      assert.match(await h.page.locator('.org-invite-send').innerText(), /Create 3 invites/);
      await h.page.locator('.org-invite-send').click();

      await until(() => posted.length === 3);
      assert.deepEqual(posted[0], {
        email: 'one@example.com',
        org_role: 'member',
        project_id: 'p1',
        project_role: 'member',
        expires_in_days: 30,
      });
      const rowsOut = h.page.locator('.org-issued-row');
      await until(async () => (await rowsOut.count()) === 3);
      assert.equal(await rowsOut.count(), 3);
      // Two links to copy, and the refused one says why in the server's words.
      assert.equal(await h.page.locator('.org-issued-row[data-ok="true"]').count(), 2);
      assert.match(
        await h.page.locator('.org-issued-row[data-ok="false"]').innerText(),
        /already has a pending invite/,
      );
      assert.equal(
        await h.page.locator('.org-issued-row').getByRole('button', { name: /copy/i }).count(),
        2,
      );
      // What failed stays in the box for a retry.
      assert.equal(await box.inputValue(), 'taken@example.com');
    } finally {
      await h.close();
    }
  });

  void test('Re-issue asks the server for a new link and shows it once', async () => {
    const h = await open('/organisation?tab=people', {
      ...base('u1', 'owner', OWNER_ACTIONS),
      '/api/v1/invites/i1/reissue': reply(201, {
        invite: { ...INVITE, id: 'i2' },
        token: 't2',
        accept_url: 'https://laika.test/invite/new-link',
      }),
    });
    try {
      const reissue = h.page.locator('.org-reissue');
      await reissue.waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.org-invites').innerText(), /into Core as member/);
      await reissue.click();
      await h.page.locator('.org-issued-url').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.org-issued-url').innerText(),
        'https://laika.test/invite/new-link',
      );
      assert.ok(
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/invites/i1/reissue'),
      );
    } finally {
      await h.close();
    }
  });

  void test('Revoke asks first, and Cancel sends nothing', async () => {
    const h = await open('/organisation?tab=people', base('u1', 'owner', OWNER_ACTIONS));
    try {
      const revoke = h.page.locator('.org-revoke');
      await revoke.waitFor({ timeout: 20_000 });
      await revoke.click();
      const dialog = h.page.getByRole('alertdialog');
      assert.match(await dialog.innerText(), /lost@example\.com/);
      await dialog.locator('.org-dialog-cancel').click();
      await h.page.waitForTimeout(300);
      assert.equal(h.calls.filter((c) => c.method === 'DELETE').length, 0);

      await revoke.click();
      await h.page.getByRole('alertdialog').locator('.org-dialog-confirm').click();
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
      ...base('u1', 'owner', OWNER_ACTIONS),
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
      await h.page.locator('.org-name-save').click();
      await until(() => body !== undefined);
      assert.deepEqual(body, { name: 'Southwind' });
    } finally {
      await h.close();
    }

    const viewer = await open('/organisation', base('u2', 'member', []));
    try {
      await viewer.page.locator('[data-fact="name"]').waitFor({ timeout: 20_000 });
      assert.equal(await viewer.page.locator('.org-name-input').count(), 0);
      assert.match(await viewer.page.locator('[data-fact="name"]').innerText(), /Northwind/);
    } finally {
      await viewer.close();
    }
  });
});

void describe('light and dark, wide and narrow', () => {
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: People fits without a sideways scroll`, async () => {
        const h = await open('/organisation?tab=people', base('u1', 'owner', OWNER_ACTIONS));
        try {
          await h.page.setViewportSize({ width, height: 1000 });
          await rows(h.page).first().waitFor({ timeout: 20_000 });
          await until(async () => (await rows(h.page).count()) === PEOPLE.length);
          await setTheme(h.page, theme);
          await h.page.waitForTimeout(200);

          const sideways = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.equal(sideways, 0, `the page scrolls sideways by ${String(sideways)}px`);

          // The card is inside the viewport — an ancestor clipping it would
          // keep the page from scrolling and still cut the controls off.
          const card = await h.page.locator('.org-people-card').boundingBox();
          assert.ok(
            card !== null && card.x + card.width <= width + 1,
            `the People card runs ${String(Math.round((card?.x ?? 0) + (card?.width ?? 0) - width))}px past the viewport`,
          );
          // Every row's controls are inside its card.
          for (const box of await h.page.locator('.org-people-card .org-deactivate').all()) {
            const b = await box.boundingBox();
            assert.ok(
              card && b && b.x + b.width <= card.x + card.width + 1,
              'a control spills out',
            );
          }
          // The chosen chip is distinguishable from the rest in this theme.
          const [on, off] = await Promise.all([
            h.page
              .locator('[data-role-filter="all"]')
              .evaluate((el) => getComputedStyle(el).backgroundColor),
            h.page
              .locator('[data-role-filter="admin"]')
              .evaluate((el) => getComputedStyle(el).backgroundColor),
          ]);
          assert.notEqual(on, off, 'the pressed chip looks like the others');

          await shoot(h.page, `people-${theme}-${String(width)}`);
          await h.page
            .locator('.org-person', { hasText: 'Tomas Nel' })
            .locator('.org-deactivate')
            .click();
          await h.page.getByRole('alertdialog').waitFor({ timeout: 20_000 });
          await shoot(h.page, `people-deactivate-${theme}-${String(width)}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});
