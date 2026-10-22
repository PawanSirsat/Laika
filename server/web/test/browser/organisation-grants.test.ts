/**
 * Organisation → Roles & permissions: the owner decides who can do what
 * (LAI-960, D-102 rule 6), from `GET` and `PUT /api/v1/org/permissions`.
 *
 * ## Why a browser
 *
 * Who is offered a switch, and what a save sends and re-reads, are properties
 * of the rendered page. The fixture's capabilities, roles and labels are
 * **invented** — *Fly the kite*, a `steward` — so a client that knew LAI-958's
 * five capabilities would render those and fail.
 *
 * Who may edit is the server's answer too: `org.permissions.manage` in the
 * caller's `me.actions`, which `GET /permissions` computes. The role on `/me`
 * decides only the People tab, and these fixtures keep the two in step.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { offered } from './dropdown.ts';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  user('u1', 'Ada Lovelace', 'owner'),
  user('u2', 'Tomas Nel', 'member'),
  user('u3', 'Priya Raman', 'admin'),
];

/** `GET /permissions`, with the actions the caller holds — the edit right among them or not. */
const catalogue = (org_role: string, actions: readonly string[]) => ({
  org_roles: ['owner', 'admin', 'member', 'steward'],
  project_roles: ['lead', 'member', 'viewer'],
  permissions: [
    {
      action: 'kite.fly',
      scope: 'org',
      label: 'Fly the organisation kite',
      session_only: false,
      read_only: false,
      condition: null,
      roles: { owner: 'yes', admin: 'yes', member: 'no', steward: 'no' },
    },
  ],
  me: {
    org_role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions,
    projects: [],
  },
});

/** `GET /org/permissions` — every word invented. */
const GRANTS = {
  roles: ['admin', 'member', 'steward'],
  capabilities: [
    { id: 'fly_kites', label: 'Fly the kite', actions: ['kite.fly'] },
    { id: 'mend_kites', label: 'Mend the kite', actions: ['kite.mend'] },
  ],
  grants: {
    admin: { fly_kites: true, mend_kites: true },
    member: { fly_kites: false, mend_kites: false },
    steward: { fly_kites: false, mend_kites: true },
  },
  owner_locked: [
    { action: 'kite.burn', label: 'Burn the kite' },
    { action: 'kite.sell', label: null },
  ],
  updated_at: null,
  updated_by: null,
};

const OWNER_ACTIONS = ['org.read', 'org.permissions.manage', 'user.set_role', 'kite.fly'];
const ADMIN_ACTIONS = ['org.read', 'user.invite', 'kite.fly'];

const stub = (
  id: string,
  org_role: string,
  actions: readonly string[],
  orgPermissions: unknown = GRANTS,
): ApiStub => ({
  '/api/v1/me': {
    ...user(id, PEOPLE.find((p) => p.id === id)?.name ?? '', org_role),
    memberships: [],
  },
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Kite Club',
    presence_enabled: true,
    created_at: 1,
    updated_at: 2,
  },
  '/api/v1/permissions': catalogue(org_role, actions),
  '/api/v1/org/permissions': orgPermissions,
});

const grid = '.perm-card[data-card="grants"]';

const ready = async (h: Awaited<ReturnType<typeof open>>) => {
  await h.page.locator(`${grid} .perm-table`).waitFor({ timeout: 20_000 });
};

void after(async () => {
  await closeBrowser();
});

void describe('the owner switches capabilities on and off', () => {
  void test('rows, columns and locked items are the response, the Owner column on and locked', async () => {
    const h = await open('/organisation?tab=roles', stub('u1', 'owner', OWNER_ACTIONS));
    try {
      await ready(h);
      const table = h.page.locator(`${grid} .perm-table`);
      assert.deepEqual(await table.locator('thead th.perm-role').allTextContents(), [
        'owner',
        'admin',
        'member',
        'steward',
      ]);
      assert.deepEqual(await table.locator('tbody .perm-action-name').allTextContents(), [
        'Fly the kite',
        'Mend the kite',
      ]);

      const owner = table.locator('td[data-role="owner"] [role="switch"]');
      assert.equal(await owner.count(), 2);
      for (const cell of await owner.all()) {
        assert.equal(await cell.getAttribute('aria-checked'), 'true');
        assert.equal(await cell.isDisabled(), true, 'the Owner column can be switched');
      }

      const steward = table.locator('tr[data-capability="mend_kites"] td[data-role="steward"]');
      assert.equal(await steward.getByRole('switch').getAttribute('aria-checked'), 'true');
      assert.equal(await steward.getByRole('switch').isDisabled(), false);

      // Owner-locked items, by their §3.1 row or their action id when there is none.
      assert.deepEqual(await h.page.locator(`${grid} .perm-locked li`).allTextContents(), [
        'Burn the kite',
        'kite.sell',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('Save PUTs the whole matrix, shows the answer and re-reads the tables', async () => {
    const saved = {
      ...GRANTS,
      grants: { ...GRANTS.grants, member: { fly_kites: true, mend_kites: false } },
      updated_at: Date.UTC(2026, 9, 22, 12),
      updated_by: 'u1',
    };
    const h = await open(
      '/organisation?tab=roles',
      stub('u1', 'owner', OWNER_ACTIONS, (call: StubCall) =>
        call.method === 'PUT' ? saved : GRANTS,
      ),
    );
    try {
      await ready(h);
      const save = h.page.locator(`${grid} button`, { hasText: 'Save' });
      assert.equal(await save.isDisabled(), true, 'Save is offered before anything changed');

      const reads = () =>
        h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/permissions').length;
      const before = reads();

      await h.page
        .locator(`${grid} tr[data-capability="fly_kites"] td[data-role="member"] [role="switch"]`)
        .click();
      await save.click();

      await until(() => h.calls.some((c) => c.method === 'PUT'));
      const put = h.calls.find((c) => c.method === 'PUT');
      assert.ok(put, 'no PUT was sent');
      assert.equal(put.path, '/api/v1/org/permissions');
      assert.deepEqual(put.body, {
        grants: {
          admin: { fly_kites: true, mend_kites: true },
          member: { fly_kites: true, mend_kites: false },
          steward: { fly_kites: false, mend_kites: true },
        },
      });

      // The matrices below are `can()`'s answer, so they are asked again.
      await until(() => reads() > before, 10_000);
      assert.ok(reads() > before, 'GET /permissions was not re-read after the save');

      await h.page.locator(`${grid} [data-fact="updated"]`).waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page
          .locator(`${grid} tr[data-capability="fly_kites"] td[data-role="member"] [role="switch"]`)
          .getAttribute('aria-checked'),
        'true',
      );
      assert.equal(await save.isDisabled(), true, 'Save stays enabled after saving');
    } finally {
      await h.close();
    }
  });

  void test("a refusal is shown in the grid, in the server's words", async () => {
    const h = await open(
      '/organisation?tab=roles',
      stub('u1', 'owner', OWNER_ACTIONS, (call: StubCall) =>
        call.method === 'PUT'
          ? refuse(422, 'unprocessable', '"kite.burn" is the owner\'s alone and cannot be granted')
          : GRANTS,
      ),
    );
    try {
      await ready(h);
      await h.page
        .locator(`${grid} tr[data-capability="mend_kites"] td[data-role="member"] [role="switch"]`)
        .click();
      await h.page.locator(`${grid} button`, { hasText: 'Save' }).click();
      const alert = h.page.locator(`${grid} [role="alert"]`);
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(
        await alert.innerText(),
        '"kite.burn" is the owner\'s alone and cannot be granted',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('everyone else reads it', () => {
  for (const [who, id, role, actions] of [
    ['an admin', 'u3', 'admin', ADMIN_ACTIONS],
    ['a member', 'u2', 'member', ['org.read']],
  ] as const) {
    void test(`${who} sees the grid read-only: no switch, no Save`, async () => {
      const h = await open('/organisation?tab=roles', stub(id, role, actions));
      try {
        await ready(h);
        assert.equal(await h.page.locator(`${grid} [role="switch"]`).count(), 0);
        assert.equal(await h.page.locator(`${grid} button`).count(), 0);
        const cell = h.page.locator(
          `${grid} tr[data-capability="mend_kites"] td[data-role="steward"]`,
        );
        assert.equal(await cell.getAttribute('data-holding'), 'yes');
        assert.equal(
          await h.page
            .locator(`${grid} tr[data-capability="fly_kites"] td[data-role="member"]`)
            .getAttribute('data-holding'),
          'no',
        );
        // No link to a role picker they do not have.
        assert.equal(
          await h.page.locator('.perm-card a[href="/organisation?tab=people"]').count(),
          0,
        );
      } finally {
        await h.close();
      }
    });
  }
});

void describe('People: only the owner changes a role', () => {
  void test('an admin sees roles as text and keeps Deactivate', async () => {
    const h = await open('/organisation?tab=people', stub('u3', 'admin', ADMIN_ACTIONS));
    try {
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.org-person').count()) === 3);
      assert.equal(await h.page.locator('.org-person [role="combobox"]').count(), 0);
      const tomas = h.page.locator('.org-person', { hasText: 'Tomas Nel' });
      assert.equal(await tomas.locator('.org-person-role').innerText(), 'Member');
      assert.equal(await tomas.locator('button.org-deactivate').count(), 1);
    } finally {
      await h.close();
    }
  });

  for (const [who, id, role, actions, expected] of [
    ['an admin', 'u3', 'admin', ADMIN_ACTIONS, ['Member', 'Viewer']],
    ['the owner', 'u1', 'owner', OWNER_ACTIONS, ['Admin', 'Member', 'Viewer']],
  ] as const) {
    void test(`${who} is offered only the roles the server lets them invite as`, async () => {
      const h = await open('/organisation?tab=people', stub(id, role, actions));
      try {
        const select = h.page.locator('.org-invite-role [role="combobox"]');
        await select.waitFor({ timeout: 20_000 });
        assert.deepEqual(await offered(select), expected);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('light and dark, wide and narrow', () => {
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: the grid stays inside its card`, async () => {
        const h = await open('/organisation?tab=roles', stub('u1', 'owner', OWNER_ACTIONS));
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await ready(h);
          await setTheme(h.page, theme);
          const measured = await h.page.evaluate((selector) => {
            const doc = document.documentElement;
            const card = document.querySelector(selector);
            const sw = card?.querySelector('[role="switch"]:not([disabled])');
            return {
              sideways: doc.scrollWidth - doc.clientWidth,
              overflowing: card === null ? -1 : card.scrollWidth - card.clientWidth,
              switchWidth: sw === null || sw === undefined ? 0 : sw.getBoundingClientRect().width,
            };
          }, grid);
          assert.equal(
            measured.sideways,
            0,
            `the page scrolls sideways by ${String(measured.sideways)}px`,
          );
          assert.ok(
            measured.overflowing <= 1,
            `the grid overflows its card by ${String(measured.overflowing)}px`,
          );
          assert.ok(measured.switchWidth > 0, 'no switch was painted');
        } finally {
          await h.close();
        }
      });
    }
  }
});
