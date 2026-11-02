/**
 * Organisation → Overview names the board's build (LAI-1069, plan §J E3): the
 * server version, the commit and the helper protocol from
 * `GET /developer/compatibility`, as one quiet line, to owners and admins only.
 *
 * The figures are odd ones no fixture uses, so a hardcoded line cannot pass.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, setTheme, until, type ApiStub } from './harness.ts';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const permissions = (org_role: string) => ({
  org_roles: [],
  project_roles: [],
  permissions: [],
  me: {
    org_role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions: ['org.read'],
    projects: [],
  },
});

const COMMIT = '9c4e2b7a1d03f5e6a7b8c9d0e1f2a3b4c5d6e7f8';

const compat = (commit: string | null, current = 7, min_client = 3) => ({
  server: { version: '4.13.9', build_commit: commit },
  protocol: { current, min_client },
  features: { developer_access: 'classic' },
});

const stub = (org_role: string, compatibility: unknown = compat(COMMIT)): ApiStub => ({
  '/api/v1/me': { ...user('u1', 'Ada Lovelace', org_role), memberships: [] },
  '/api/v1/permissions': permissions(org_role),
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/users': { data: [user('u1', 'Ada Lovelace', org_role)], next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': { id: 'o1', name: 'Acme', presence_enabled: true, created_at: 1, updated_at: 2 },
  '/api/v1/org/overview': {
    people: { active: 1, seen_this_week: 1, since: 1 },
    tasks: { open: 0, in_review: 0, blocked: 0, overdue: 0 },
  },
  '/api/v1/developer/compatibility': compatibility,
});

const LINE = '[data-board-build]';

void after(async () => {
  await closeBrowser();
});

void describe('the board build line', () => {
  for (const role of ['owner', 'admin']) {
    void test(`${role}: version, commit and protocol, each the server’s`, async () => {
      const h = await open('/organisation', stub(role));
      try {
        const line = h.page.locator(LINE);
        await line.waitFor({ timeout: 20_000 });
        assert.equal(
          (await line.textContent())?.replace(/\s+/g, ' '),
          'Board build 4.13.9 · 9c4e2b7a1d03 · helper protocol 7 (accepts 3+)',
        );
        assert.equal(await line.locator('code').getAttribute('title'), COMMIT);
      } finally {
        await h.close();
      }
    });
  }

  for (const role of ['member', 'viewer']) {
    void test(`${role}: no line, though the page has the build in hand`, async () => {
      const h = await open('/organisation', stub(role));
      try {
        await h.page.locator('.org-stat', { hasText: 'Members' }).waitFor({ timeout: 20_000 });
        await h.page.locator('.org-pulse').waitFor({ timeout: 20_000 });
        // The shell reads the same answer for its own mode, so the build was
        // there to show: its absence is the role check, not a slow read.
        await until(() => h.calls.some((c) => c.path === '/api/v1/developer/compatibility'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(await h.page.locator(LINE).count(), 0);
      } finally {
        await h.close();
      }
    });
  }

  void test('a build that does not know its commit says so; one protocol has no range', async () => {
    const h = await open('/organisation', stub('owner', compat(null, 2, 2)));
    try {
      const line = h.page.locator(LINE);
      await line.waitFor({ timeout: 20_000 });
      assert.equal(
        (await line.textContent())?.replace(/\s+/g, ' '),
        'Board build 4.13.9 · commit not recorded · helper protocol 2',
      );
    } finally {
      await h.close();
    }
  });

  void test('a failed read shows no line, and the rest of Overview stands', async () => {
    const h = await open('/organisation', {
      ...stub('owner'),
      '/api/v1/developer/compatibility': refuse(500, 'internal', 'boom'),
    });
    try {
      await h.page.locator('.org-pulse').waitFor({ timeout: 20_000 });
      await until(() => h.calls.some((c) => c.path === '/api/v1/developer/compatibility'));
      assert.equal(await h.page.locator(LINE).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('fits', () => {
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      void test(`${String(width)}px, ${theme}: muted and inside the page`, async () => {
        const h = await open('/organisation', stub('owner'));
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await setTheme(h.page, theme);
          const line = h.page.locator(LINE);
          await line.waitFor({ timeout: 20_000 });
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 1, `the page scrolls sideways by ${String(overflow)}px`);
          const [quiet, body] = await Promise.all([
            line.evaluate((el) => getComputedStyle(el).color),
            h.page.evaluate(() => getComputedStyle(document.body).color),
          ]);
          assert.notEqual(quiet, body, 'the line is in body text colour, not muted');
        } finally {
          await h.close();
        }
      });
    }
  }
});
