/**
 * Organisation → Roles & permissions renders what `GET /permissions` says
 * (LAI-950).
 *
 * ## Why a browser
 *
 * The task's central promise is that **no role, action or label lives in the
 * client**, and the only proof of that is a page fed a response no client
 * could have guessed. So the fixture invents an action (`kite.fly`), a role
 * (`steward`), a label-less row and a condition, and the assertions read them
 * back off the rendered page. A client that knew §3 would render §3 and fail.
 *
 * The layout half — both themes, 1440 and 390, nothing sideways — is a property
 * of the painted page and has no other instrument.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub, setTheme } from './harness.ts';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const project = (id: string, slug: string, name: string) => ({
  id,
  slug,
  prefix: 'KT',
  name,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
});

/** A catalogue no server serves: every word in it is invented. */
const CATALOGUE = {
  org_roles: ['owner', 'admin', 'member', 'viewer', 'steward'],
  project_roles: ['lead', 'member', 'viewer'],
  permissions: [
    {
      action: 'kite.fly',
      scope: 'org',
      label: 'Fly the organisation kite',
      session_only: true,
      read_only: false,
      condition: null,
      roles: { owner: 'yes', admin: 'yes', member: 'no', viewer: 'no', steward: 'yes' },
    },
    {
      action: 'kite.mend',
      scope: 'org',
      label: null,
      session_only: false,
      read_only: true,
      condition: 'Only kites they flew',
      roles: {
        owner: 'yes',
        admin: 'conditional',
        member: 'conditional',
        viewer: 'no',
        steward: 'no',
      },
    },
    {
      action: 'rope.coil',
      scope: 'project',
      label: 'Coil the project rope',
      session_only: false,
      read_only: false,
      condition: 'Rope they laid only',
      roles: { lead: 'yes', member: 'conditional', viewer: 'no' },
    },
  ],
  me: {
    org_role: 'member',
    credential: 'token',
    project_scope: ['p1'],
    implicit_project_role: null,
    actions: ['kite.mend', 'kite.unheard-of'],
    projects: [{ project_id: 'p1', role: 'member', actions: ['rope.coil'] }],
  },
};

const stub = (org_role: string, catalogue: unknown = CATALOGUE): ApiStub => ({
  '/api/v1/me': { ...user('u1', 'Ada Lovelace', org_role), memberships: [] },
  '/api/v1/projects': { data: [project('p1', 'kites', 'Kite works')], next_cursor: null },
  '/api/v1/users': { data: [user('u1', 'Ada Lovelace', org_role)], next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Kite Club',
    presence_enabled: true,
    created_at: 1,
    updated_at: 2,
  },
  '/api/v1/permissions': catalogue,
});

const ready = async (h: Awaited<ReturnType<typeof open>>) => {
  await h.page.locator('.perm-table[data-scope="org"]').waitFor({ timeout: 20_000 });
};

void after(async () => {
  await closeBrowser();
});

void describe('every string comes from the response', () => {
  void test('an invented action, role, label-less row and condition render as sent', async () => {
    const h = await open('/organisation?tab=roles', stub('member'));
    try {
      await ready(h);
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/permissions'),
        'the tab never asked the server',
      );

      const org = h.page.locator('.perm-table[data-scope="org"]');
      assert.deepEqual(await org.locator('thead th.perm-role').allTextContents(), [
        'owner',
        'admin',
        'member',
        'viewer',
        'steward',
      ]);

      const fly = org.locator('tr[data-action="kite.fly"]');
      assert.match(
        await fly.locator('.perm-action-name').innerText(),
        /^Fly the organisation kite$/,
      );
      assert.equal(await fly.locator('[data-mark="session-only"]').count(), 1);
      assert.equal(await fly.locator('[data-mark="read-only"]').count(), 0);
      assert.equal(
        await fly.locator('td[data-role="steward"]').getAttribute('data-holding'),
        'yes',
      );

      // No label: the action's name, not text the client made up.
      const mend = org.locator('tr[data-action="kite.mend"]');
      assert.equal(await mend.locator('.perm-action-name').innerText(), 'kite.mend');
      assert.equal(await mend.locator('[data-mark="read-only"]').count(), 1);
      const conditional = mend.locator('td[data-role="admin"]');
      assert.equal(await conditional.getAttribute('data-holding'), 'conditional');
      assert.equal(
        await conditional.locator('.perm-cell-value').innerText(),
        'Only kites they flew',
      );
      assert.equal(await mend.locator('td[data-role="viewer"] .perm-cell-value').innerText(), 'No');

      const coil = h.page.locator('.perm-table[data-scope="project"] tr[data-action="rope.coil"]');
      assert.equal(
        await coil.locator('td[data-role="member"] .perm-cell-value').innerText(),
        'Rope they laid only',
      );
    } finally {
      await h.close();
    }
  });

  void test('"What you can do" is the me block, token scope included', async () => {
    const h = await open('/organisation?tab=roles', stub('member'));
    try {
      await ready(h);
      const fact = (name: string) =>
        h.page.locator(`.perm-me-fact[data-fact="${name}"] dd`).textContent();
      assert.equal(await fact('org-role'), 'member');
      assert.equal(await fact('credential'), 'token');
      // The whitelist, named by the project it is.
      assert.equal(await fact('project-scope'), 'Kite works');
      assert.equal(await h.page.locator('[data-fact="implicit-project-role"]').count(), 0);

      assert.deepEqual(await h.page.locator('[data-held="org"] li').allTextContents(), [
        'kite.mend',
        'kite.unheard-of',
      ]);
      const mine = h.page.locator('.perm-project[data-project="p1"]');
      assert.equal(await mine.locator('.perm-project-name').innerText(), 'Kite works');
      assert.deepEqual(await mine.locator('.perm-held li').allTextContents(), [
        'Coil the project rope',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('an owner sees the implicit project role and "all" as the server says', async () => {
    const h = await open(
      '/organisation?tab=roles',
      stub('owner', {
        ...CATALOGUE,
        me: {
          ...CATALOGUE.me,
          org_role: 'owner',
          credential: 'session',
          project_scope: 'all',
          implicit_project_role: 'lead',
          projects: [],
        },
      }),
    );
    try {
      await ready(h);
      const fact = (name: string) =>
        h.page.locator(`.perm-me-fact[data-fact="${name}"] dd`).textContent();
      assert.equal(await fact('project-scope'), 'all');
      assert.equal(await fact('implicit-project-role'), 'lead');
    } finally {
      await h.close();
    }
  });
});

void describe('roles are changed where they always were', () => {
  void test('an owner is linked to People; project roles to that project’s Members', async () => {
    const h = await open('/organisation?tab=roles', stub('owner'));
    try {
      await ready(h);
      const people = h.page.locator('#perm-org').locator('..').locator('a.org-head-action');
      assert.equal(await people.innerText(), 'Change someone’s role');
      assert.equal(await people.getAttribute('href'), '/organisation?tab=people');

      const members = h.page.locator('.perm-members a');
      assert.equal(await members.getAttribute('href'), '/members?project=kites');

      await people.click();
      await h.page.locator('.org-body[data-tab="people"]').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('a member is offered the tab and no role-changing link', async () => {
    const h = await open('/organisation?tab=roles', stub('member'));
    try {
      await ready(h);
      assert.equal(await h.page.locator('.page-tab[data-tab="roles"]').count(), 1);
      // The People tab itself is everyone's; the role-changing link is not.
      assert.equal(
        await h.page.locator('.perm-card a[href="/organisation?tab=people"]').count(),
        0,
      );
      // Their own project's Members, which is where a project role is set.
      assert.equal(
        await h.page.locator('.perm-members a').getAttribute('href'),
        '/members?project=kites',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('light and dark, wide and narrow', () => {
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: nothing scrolls sideways`, async () => {
        const h = await open('/organisation?tab=roles', stub('owner'));
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await ready(h);
          await setTheme(h.page, theme);
          const measured = await h.page.evaluate(() => {
            const doc = document.documentElement;
            const table = document.querySelector('.perm-table');
            const card = table?.closest('.org-card');
            return {
              sideways: doc.scrollWidth - doc.clientWidth,
              overflowing: [...document.querySelectorAll('.perm-card')].filter(
                (el) => el.scrollWidth > el.clientWidth + 1,
              ).length,
              tableInside:
                table !== null && card !== null && card !== undefined
                  ? table.getBoundingClientRect().right <= card.getBoundingClientRect().right + 1
                  : false,
              stacked:
                table === null ? null : getComputedStyle(table.querySelector('thead')!).display,
            };
          });
          assert.equal(
            measured.sideways,
            0,
            `the page scrolls sideways by ${String(measured.sideways)}px`,
          );
          assert.equal(measured.overflowing, 0, 'a card overflows its width');
          assert.ok(measured.tableInside, 'the table runs out of its card');
          // On a phone the matrix stacks; on a laptop it is a table.
          assert.equal(measured.stacked, width === 390 ? 'none' : 'table-header-group');
        } finally {
          await h.close();
        }
      });
    }
  }
});
