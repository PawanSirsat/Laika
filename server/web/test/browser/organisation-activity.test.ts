/**
 * Organisation → Activity (LAI-951): everything that happened across the
 * organisation, for an owner or an admin, over `GET /activity/history`.
 *
 * ## Why a browser
 *
 * The things that can be wrong are all on the rendered page or the wire: a tab
 * a member is offered, a filter that changes the screen but not the request (or
 * the request but not the address), a *Load more* that starts over instead of
 * walking `next_cursor`, and a row that names a database value where a person
 * expects a sentence.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, setTheme, until, type ApiStub } from './harness.ts';
import { pick } from './dropdown.ts';

const user = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [user('u1', 'Ada Lovelace', 'owner'), user('u2', 'Tomas Nel', 'member')];

const project = (id: string, slug: string, name: string, prefix: string) => ({
  id,
  slug,
  prefix,
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
});

const now = Date.now();

const row = (
  seq: number,
  type: string,
  extra: {
    project_id?: string | null;
    task_id?: string | null;
    actor_id?: string | null;
    actor_kind?: 'user' | 'agent' | 'system';
    payload?: unknown;
  } = {},
) => ({
  id: `a${String(seq)}`,
  seq,
  type,
  project_id: 'p1',
  task_id: null,
  actor_id: 'u1',
  actor_kind: 'user',
  actor_token_id: null,
  payload: null,
  created_at: now - seq * 60_000,
  ...extra,
});

const FIRST = [
  row(1, 'task.created', {
    task_id: 't1',
    actor_id: 'u2',
    actor_kind: 'agent',
    payload: { key: 'ATL-7' },
  }),
  row(2, 'comment.added', { project_id: 'p2', task_id: 't9', actor_id: 'u1' }),
  row(3, 'token.created', { project_id: null }),
];

const SECOND = [row(4, 'sprint.created', { actor_id: null, actor_kind: 'system' })];

const me = (org_role: string) => ({ ...user('u1', 'Ada Lovelace', org_role), memberships: [] });
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

const BASE: ApiStub = {
  '/api/v1/projects': {
    data: [project('p1', 'atlas', 'Atlas', 'ATL'), project('p2', 'borealis', 'Borealis', 'BOR')],
    next_cursor: null,
  },
  '/api/v1/users': { data: PEOPLE, next_cursor: null },
  '/api/v1/invites': { data: [], next_cursor: null },
  '/api/v1/org': { id: 'o1', name: 'Acme', presence_enabled: true, created_at: 1, updated_at: 2 },
  '/api/v1/me': me('owner'),
  '/api/v1/permissions': permissions('owner', ['audit_log.export', 'token.list_any']),
  '/api/v1/activity/history?limit=50': { data: FIRST, next_cursor: 'c1' },
  '/api/v1/activity/history?limit=50&cursor=c1': { data: SECOND, next_cursor: null },
};

const historyCalls = (calls: readonly { path: string }[]) =>
  calls.filter((c) => c.path === '/api/v1/activity/history');

void after(async () => {
  await closeBrowser();
});

void describe('who is offered it', () => {
  for (const role of ['owner', 'admin']) {
    void test(`an ${role} gets an Activity tab beside the others`, async () => {
      const h = await open('/organisation', {
        ...BASE,
        '/api/v1/me': me(role),
        '/api/v1/permissions': permissions(role, ['audit_log.export', 'token.list_any']),
      });
      try {
        await h.page.locator('.page-tab[data-tab="activity"]').waitFor({ timeout: 20_000 });
        const tabs = await h.page
          .locator('.page-tab')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-tab')));
        assert.deepEqual(tabs.slice(-2), ['security', 'activity']);
      } finally {
        await h.close();
      }
    });
  }

  void test('a member is not offered it, and its address says they may not see it', async () => {
    const h = await open('/organisation?tab=activity', {
      ...BASE,
      '/api/v1/me': me('member'),
      '/api/v1/permissions': permissions('member', []),
    });
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.page-tab[data-tab="activity"]').count(), 0);
      assert.equal(await h.page.locator('.oh-row').count(), 0);
      await h.page.waitForTimeout(300);
      assert.equal(historyCalls(h.calls).length, 0, 'asked the server for what it refuses');
    } finally {
      await h.close();
    }
  });

  void test('the Activity tab follows the live audit grant, with owner unchanged', async () => {
    for (const [role, actions, offered] of [
      ['admin', [], false],
      ['member', ['audit_log.export'], true],
      ['owner', ['audit_log.export'], true],
    ] as const) {
      const h = await open('/organisation?tab=activity', {
        ...BASE,
        '/api/v1/me': me(role),
        '/api/v1/permissions': permissions(role, actions),
      });
      try {
        if (offered) await h.page.locator('.oh-row').first().waitFor({ timeout: 20_000 });
        else await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
        assert.equal(
          await h.page.locator('.page-tab[data-tab="activity"]').count(),
          offered ? 1 : 0,
        );
      } finally {
        await h.close();
      }
    }
  });
});

void describe('the rows', () => {
  void test('when, who, what in the existing wording, and which space and task, linked', async () => {
    const h = await open('/organisation?tab=activity', BASE);
    try {
      await h.page.locator('.oh-row').first().waitFor({ timeout: 20_000 });
      const rows = h.page.locator('.oh-row');
      assert.equal(await rows.count(), 3);

      const first = rows.nth(0);
      assert.match(await first.locator('.oh-who').innerText(), /Tomas Nel/);
      assert.match(await first.locator('.oh-who').innerText(), /agent/i);
      // `describeEvent`'s line — the one map, not a second copy.
      assert.equal((await first.locator('.oh-what').innerText()).trim(), 'created this task');
      assert.equal(await first.locator('a.oh-space').getAttribute('href'), '/board?project=atlas');
      assert.equal(
        await first.locator('a.oh-task').getAttribute('href'),
        '/board?project=atlas&task=t1',
      );
      assert.equal((await first.locator('a.oh-task').innerText()).trim(), 'ATL-7');
      assert.ok((await first.locator('time.oh-when').getAttribute('datetime')) !== null);

      const second = rows.nth(1);
      assert.match(await second.locator('.oh-who').innerText(), /Ada Lovelace/);
      assert.equal((await second.locator('.oh-what').innerText()).trim(), 'commented');
      assert.equal((await second.locator('a.oh-space').innerText()).trim(), 'Borealis');
      assert.equal(
        await second.locator('a.oh-task').getAttribute('href'),
        '/board?project=borealis&task=t9',
      );

      // An organisation row has no space and no task, and says so plainly.
      const third = rows.nth(2);
      assert.equal(await third.locator('a.oh-space').count(), 0);
      assert.equal(await third.locator('a.oh-task').count(), 0);
      assert.match(await third.locator('.oh-where').innerText(), /Organisation/);
      assert.equal((await third.locator('.oh-what').innerText()).trim(), 'created an agent token');
    } finally {
      await h.close();
    }
  });

  void test('Load more walks next_cursor and appends, then stops', async () => {
    const h = await open('/organisation?tab=activity', BASE);
    try {
      await h.page.locator('.oh-more').waitFor({ timeout: 20_000 });
      await h.page.locator('.oh-more').click();
      await until(async () => (await h.page.locator('.oh-row').count()) === 4);
      assert.equal(await h.page.locator('.oh-row').count(), 4);
      assert.match(await h.page.locator('.oh-row').nth(3).locator('.oh-who').innerText(), /Laika/);
      assert.equal(await h.page.locator('.oh-more').count(), 0);
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });
});

void describe('the filters', () => {
  void test('an address with filters asks the server for exactly those', async () => {
    const h = await open(
      '/organisation?tab=activity&actor=u2&project=atlas&type=task.created&from=2026-10-01&to=2026-10-02',
      {
        ...BASE,
        '/api/v1/activity/history?limit=50&actor=u2&project=atlas&type=task.created': {
          data: [FIRST[0]],
          next_cursor: null,
        },
      },
    );
    try {
      await h.page.locator('.oh-row').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(h.unmatched, []);
      const asked = await h.page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => n.includes('/api/v1/activity/history')),
      );
      const query = new URL(asked.at(-1) ?? '').searchParams;
      assert.equal(query.get('since'), String(new Date(2026, 9, 1).getTime()));
      // The browser's own zone, so compute the expected bound in it.
      const until = await h.page.evaluate(() => new Date(2026, 9, 3).getTime() - 1);
      assert.equal(query.get('until'), String(until));
      assert.equal(await h.page.locator('#oh-from').inputValue(), '2026-10-01');
    } finally {
      await h.close();
    }
  });

  void test('choosing one rewrites the address, keeps the tab, and re-asks', async () => {
    const h = await open('/organisation?tab=activity', {
      ...BASE,
      '/api/v1/activity/history?limit=50&project=borealis': {
        data: [FIRST[1]],
        next_cursor: null,
      },
    });
    try {
      await h.page.locator('.oh-row').first().waitFor({ timeout: 20_000 });
      await pick(h.page.locator('#oh-space'), 'borealis');
      await until(async () => (await h.page.locator('.oh-row').count()) === 1);
      assert.equal(await h.page.locator('.oh-row').count(), 1);
      const search = new URLSearchParams(await h.page.evaluate(() => window.location.search));
      assert.equal(search.get('tab'), 'activity');
      assert.equal(search.get('project'), 'borealis');

      await pick(h.page.locator('#oh-type'), 'comment.added');
      const after = new URLSearchParams(await h.page.evaluate(() => window.location.search));
      assert.equal(after.get('type'), 'comment.added');
      assert.equal(after.get('project'), 'borealis');
    } finally {
      await h.close();
    }
  });
});

void describe('states', () => {
  void test('a page containing only reorder rows is still the full audit history', async () => {
    const h = await open('/organisation?tab=activity', {
      ...BASE,
      '/api/v1/activity/history?limit=50': {
        data: [row(9, 'task.updated', { payload: { field: 'position', key: 'ATL-7' } })],
        next_cursor: null,
      },
    });
    try {
      await h.page.locator('.oh-row').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.oh-row').count(), 1);
    } finally {
      await h.close();
    }
  });
  void test('nothing matching says so, rather than an empty box', async () => {
    const h = await open('/organisation?tab=activity', {
      ...BASE,
      '/api/v1/activity/history?limit=50': { data: [], next_cursor: null },
    });
    try {
      await h.page.locator('.org-body[data-tab="activity"] .state').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.org-body').innerText(), /No activity/i);
      assert.equal(await h.page.locator('.oh-more').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a failed read is an error with a retry, not an empty list', async () => {
    const h = await open('/organisation?tab=activity', {
      ...BASE,
      '/api/v1/activity/history?limit=50': refuse(500, 'internal', 'boom'),
    });
    try {
      await h.page.locator('.org-body[data-tab="activity"] .state').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.org-body').innerText(), /Could not load/i);
      assert.equal(await h.page.locator('.oh-row').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('fits', () => {
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      void test(`${String(width)}px, ${theme}: no sideways scroll`, async () => {
        const h = await open('/organisation?tab=activity', BASE);
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await h.page.locator('.oh-row').first().waitFor({ timeout: 20_000 });
          await setTheme(h.page, theme);
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 1, `the page scrolls sideways by ${String(overflow)}px`);
          const list = await h.page
            .locator('.oh-list')
            .evaluate((el) => el.scrollWidth - el.clientWidth);
          assert.ok(list <= 1, `the list scrolls sideways by ${String(list)}px`);
        } finally {
          await h.close();
        }
      });
    }
  }
});
