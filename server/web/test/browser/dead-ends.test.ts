/**
 * Small dead ends the UX audit found (LAI-1141): the Insights badge counted
 * token alerts and opened Capacity (B8); an organisation with no space hid
 * SPACES and gave the empty board no way forward (B21); a profile refused
 * with *needs admin* where the gate is a grant; the auth pages left focus on
 * `<body>`.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, setTheme, until, type ApiStub } from './harness.ts';

const SHOTS = process.env.LAIKA_SHOTS;

const me = (role: 'owner' | 'member') => ({
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: role,
  is_active: true,
  memberships: [],
});

const ALERT = (id: string) => ({
  id,
  kind: 'budget',
  scope: 'task',
  threshold: 80,
  tokens: 2_100_000,
  limit_tokens: 2_500_000,
  created_at: 1,
  project: { slug: 'laika', name: 'Laika' },
  task: { id: 't2', key: 'LAI-770', title: 'Attribution' },
  sprint: null,
});

/** An organisation with no space at all. */
function emptyOrg(role: 'owner' | 'member', extra: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': me(role),
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/org': { id: 'o1', name: 'Kvelld', presence_enabled: true, created_at: 1 },
    ...extra,
  };
}

after(async () => {
  await closeBrowser();
});

void describe('the Insights badge is token alerts (LAI-1141, B8)', () => {
  void test('it leads to Usage, says alerts to a screen reader, and Usage shows the count', async () => {
    const h = await open(
      '/projects',
      emptyOrg('owner', { '/api/v1/me/token-alerts': { alerts: [ALERT('a1'), ALERT('a2')] } }),
    );
    try {
      const link = h.page.locator('#sidebar a.sidebar-link', { hasText: 'Insights' });
      await link.locator('.sidebar-count').waitFor({ timeout: 20_000 });
      assert.equal(await link.getAttribute('href'), '/insights?tab=usage');
      const count = link.locator('.sidebar-count');
      assert.equal((await count.innerText()).replace(/\s+/g, ' ').trim(), '2 token alerts');
      assert.doesNotMatch(await count.innerText(), /waiting/);
      if (SHOTS !== undefined) {
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(h.page, theme);
          await h.page
            .locator('#sidebar')
            .screenshot({ path: `${SHOTS}/insights-badge-${theme}.png` });
        }
      }

      await link.click();
      await h.page.waitForURL(
        (url) => url.pathname === '/insights' && url.searchParams.get('tab') === 'usage',
        { timeout: 10_000 },
      );
      const tab = h.page.locator('.page-tab[data-tab="usage"]');
      await tab.locator('.page-tab-count').waitFor({ timeout: 10_000 });
      assert.equal(
        (await tab.locator('.page-tab-count').innerText()).replace(/\s+/g, ' ').trim(),
        '2 token alerts',
      );
      assert.equal(await tab.getAttribute('aria-current'), 'page');
    } finally {
      await h.close();
    }
  });

  void test('with no alerts the link is the page itself, and no tab counts', async () => {
    const h = await open('/projects', emptyOrg('owner'));
    try {
      const link = h.page.locator('#sidebar a.sidebar-link', { hasText: 'Insights' });
      await link.waitFor({ timeout: 20_000 });
      assert.equal(await link.getAttribute('href'), '/insights');
      assert.equal(await link.locator('.sidebar-count').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the first space (LAI-1141, B21)', () => {
  void test('a reader who may create one sees SPACES with Create a space, and so does the empty board', async () => {
    const h = await open('/board', emptyOrg('owner'));
    try {
      const create = h.page.locator('#sidebar [data-create-first-space]');
      await create.waitFor({ timeout: 20_000 });
      assert.equal(await create.innerText(), 'Create a space');
      assert.equal(await create.getAttribute('href'), '/projects?new=1');
      if (SHOTS !== undefined) {
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(h.page, theme);
          await h.page.screenshot({ path: `${SHOTS}/empty-org-${theme}.png` });
        }
      }

      const board = h.page.locator('.board .state');
      await board.getByRole('button', { name: 'Create a space' }).click();
      await h.page.waitForURL(
        (url) => url.pathname === '/projects' && url.searchParams.get('new') === '1',
        { timeout: 10_000 },
      );
      // The form is open, so the click went somewhere that creates.
      await h.page.locator('form.projects-form').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('a reader who may not create one sees neither', async () => {
    const h = await open('/board', emptyOrg('member'));
    try {
      await h.page.locator('.board .state').waitFor({ timeout: 20_000 });
      // Permissions have answered: the member's own entries are drawn.
      await until(async () => (await h.page.locator('#sidebar a.sidebar-link').count()) > 0);
      assert.equal(await h.page.locator('#sidebar [data-create-first-space]').count(), 0);
      assert.equal(
        await h.page
          .locator('.board .state')
          .getByRole('button', { name: 'Create a space' })
          .count(),
        0,
      );
      assert.match(await h.page.locator('.board .state').innerText(), /Ask an owner or admin/);
    } finally {
      await h.close();
    }
  });

  void test('?new=1 opens no form for a reader who may not create', async () => {
    const h = await open('/projects?new=1', emptyOrg('member'));
    try {
      await h.page.locator('.state').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('form.projects-form').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('profile and the auth pages (LAI-1141)', () => {
  void test('a refused profile names the grant, not a role', async () => {
    const h = await open('/people?user=u2', emptyOrg('member'));
    try {
      const refused = h.page.locator('.state-forbidden');
      await refused.waitFor({ timeout: 20_000 });
      assert.match(await refused.innerText(), /See everyone’s analytics/);
      assert.doesNotMatch(await refused.innerText(), /\badmin\b/);
    } finally {
      await h.close();
    }
  });

  void test('sign in focuses its first field', async () => {
    const h = await open('/login', {
      '/api/v1/me': refuse(401, 'unauthorized', 'Sign in to continue.'),
    });
    try {
      const email = h.page.getByLabel('Email');
      await email.waitFor({ timeout: 20_000 });
      await until(async () => email.evaluate((el) => el === document.activeElement));
      assert.equal(await email.evaluate((el) => el === document.activeElement), true);
    } finally {
      await h.close();
    }
  });
});
