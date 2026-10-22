/**
 * Every gate follows the server's effective permissions, and **denies until
 * the server has answered** (LAI-970).
 *
 * The review that sent LAI-970 back found each gate written as
 * `holds(permissions, …) ?? <the old role check>`: while `/permissions` was in
 * flight or had failed, an admin the owner withdrew a grant from was offered
 * the control anyway. A test that waits *until the control is gone* passes on
 * that code — the control was there and then left. So these record whether a
 * control was **ever** in the document (`watchFor`), from before the app
 * boots, and assert it never was.
 *
 * And the store itself: a different user in the same tab never reads the last
 * one's answer, and a gate mounted after the first answer still hears a later
 * one.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  everSeen,
  navigateInApp,
  open,
  refuse,
  reply,
  type ApiStub,
  type StubCall,
  until,
  watchFor,
} from './harness.ts';

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

const me = (id: string, org_role: string) => ({
  ...(PEOPLE.find((p) => p.id === id) ?? user(id, 'Someone', org_role)),
  org_role,
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

/** What an admin keeps once the owner withdraws every grant (D-102 rule 6). */
const WITHDRAWN = ['org.read', 'member_list.read', 'token.read_own'];

const BASE: ApiStub = {
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Kvelld Dynamics',
    presence_enabled: true,
    developer_insights: true,
    created_at: 1,
    updated_at: 2,
  },
  '/api/v1/me/time-settings': {
    org_mode: 'manual',
    draft_my_time: false,
    drafting: false,
    min_sync_interval_s: 300,
    breaks: [],
  },
};

/** Every control an admin loses with their grants, on Overview and People. */
const GRANTED_CONTROLS = [
  '.org-invite-form',
  '.org-deactivate',
  '[data-fact="developer-insights"] [role="switch"]',
  '[data-fact="time"] .org-mode',
  '.page-tab[data-tab="activity"]',
  '.page-tab[data-tab="security"]',
] as const;

/** `GET /permissions` held until `release()`, then sent on to the stub. */
async function holdPermissions(page: Page): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/permissions', async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

/** No condition can end a window in which something must *not* happen. */
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertNeverSeen(page: Page, selectors: readonly string[], who: string) {
  for (const selector of selectors) {
    assert.equal(await everSeen(page, selector), false, `${who} was shown ${selector}`);
  }
}

void after(async () => {
  await closeBrowser();
});

void describe('a withdrawn admin is never shown a withdrawn control', () => {
  void test('while /permissions is slow, and after it answers', async () => {
    let release: (() => void) | undefined;
    const h = await open(
      '/organisation',
      {
        ...BASE,
        '/api/v1/me': me('u3', 'admin'),
        '/api/v1/permissions': permissions('admin', WITHDRAWN),
      },
      {
        before: async (page) => {
          await watchFor(page, GRANTED_CONTROLS);
          release = await holdPermissions(page);
        },
      },
    );
    try {
      // Overview is drawn while the answer is held: the old gates fell back
      // to the role here and offered an admin every switch.
      await h.page.locator('[data-fact="time"]').waitFor({ timeout: 20_000 });
      await settle(1_000);
      await assertNeverSeen(h.page, GRANTED_CONTROLS, 'an admin, before the answer');

      release?.();
      await until(() => h.calls.some((c) => c.path === '/api/v1/permissions'));
      await settle();

      await h.page.locator('.page-tab[data-tab="people"]').click();
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      await settle();
      await assertNeverSeen(h.page, GRANTED_CONTROLS, 'an admin the owner withdrew them from');
    } finally {
      await h.close();
    }
  });

  void test('when /permissions fails, nothing is offered and a retry is', async () => {
    let fail = true;
    const h = await open(
      '/organisation?tab=people',
      {
        ...BASE,
        '/api/v1/me': me('u1', 'owner'),
        // An owner, so a role fallback would have offered everything.
        '/api/v1/permissions': () =>
          fail
            ? reply(500, { error: { code: 'internal', message: 'down' } })
            : defaultPermissions(me('u1', 'owner')),
      },
      { before: (page) => watchFor(page, GRANTED_CONTROLS) },
    );
    try {
      const banner = h.page.locator('[data-state="permissions-failed"]');
      await banner.waitFor({ timeout: 20_000 });
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      await settle();
      await assertNeverSeen(h.page, GRANTED_CONTROLS, 'a reader whose /permissions failed');

      // Retry asks again; the answer reaches the gates already on screen.
      fail = false;
      await banner.getByRole('button', { name: 'Retry' }).click();
      await h.page.locator('.org-invite-form').waitFor({ timeout: 10_000 });
      assert.equal(await banner.count(), 0, 'the failure notice outlived the answer');
      assert.ok((await h.page.locator('.org-deactivate').count()) > 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the store follows the user and every publish', () => {
  void test('signing out and in as somebody else never shows the last person’s controls', async () => {
    // Two admins: the role is the same, so only the store can tell them apart.
    let who: 'u1' | 'u3' | undefined = 'u1';
    const h = await open('/organisation?tab=people', {
      ...BASE,
      '/api/v1/me': () =>
        who === undefined ? refuse(401, 'unauthorized', 'Sign in to continue.') : me(who, 'admin'),
      '/api/v1/permissions': () =>
        who === 'u1' ? defaultPermissions(me('u1', 'admin')) : permissions('admin', WITHDRAWN),
      '/api/v1/auth/sign-out': () => {
        who = undefined;
        return reply(200, {});
      },
      '/api/v1/auth/sign-in/email': (call: StubCall) => {
        who = (call.body as { email?: string }).email === 'u3@example.com' ? 'u3' : 'u1';
        return reply(200, {});
      },
    });
    try {
      await h.page.locator('.org-invite-form').waitFor({ timeout: 20_000 });

      await h.page.locator('.user-menu-trigger').dispatchEvent('click');
      await h.page.locator('.user-menu-signout').dispatchEvent('click');
      await h.page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 });

      await h.page.locator('input[type="email"]').fill('u3@example.com');
      await h.page.locator('input[type="password"]').fill('correct horse battery');
      await h.page.getByRole('button', { name: 'Sign in' }).click();
      await h.page.waitForURL((url) => url.pathname !== '/login', { timeout: 10_000 });

      // Watch from here: everything before this frame was the first person's.
      await h.page.evaluate((selectors) => {
        const seen: Record<string, boolean> = {};
        (window as unknown as { __laikaSeen: Record<string, boolean> }).__laikaSeen = seen;
        const check = () => {
          for (const s of selectors) if (document.querySelector(s)) seen[s] = true;
        };
        check();
        new MutationObserver(check).observe(document, { subtree: true, childList: true });
      }, GRANTED_CONTROLS);
      await navigateInApp(h.page, '/organisation?tab=people');
      await h.page.locator('.org-person').first().waitFor({ timeout: 20_000 });
      await until(() => h.calls.filter((c) => c.path === '/api/v1/permissions').length >= 2);
      await settle();
      await assertNeverSeen(h.page, GRANTED_CONTROLS, 'the second admin, in the first’s tab');
    } finally {
      await h.close();
    }
  });

  void test('a gate mounted after the first answer re-renders on a later one', async () => {
    // The first answer is read on My day; Organisation mounts afterwards.
    let actions = (defaultPermissions(me('u3', 'admin')) as { me: { actions: string[] } }).me
      .actions;
    const h = await open('/my-day', {
      ...BASE,
      '/api/v1/me': me('u3', 'admin'),
      '/api/v1/permissions': () => permissions('admin', actions),
    });
    try {
      await until(() => h.calls.some((c) => c.path === '/api/v1/permissions'));
      await settle();
      await navigateInApp(h.page, '/organisation?tab=people');
      const activity = h.page.locator('.page-tab[data-tab="activity"]');
      await activity.waitFor({ timeout: 20_000 });

      // The owner withdraws the history; opening Roles & permissions re-reads
      // `/permissions`, and the tab bar mounted before it must follow.
      actions = actions.filter((a) => a !== 'audit_log.export');
      await h.page.locator('.page-tab[data-tab="roles"]').click();
      await activity.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await activity.count(), 0);
    } finally {
      await h.close();
    }
  });
});
