/**
 * The Work page in a real browser (LAI-952): everyone's work across every
 * space, from `GET /tasks` (LAI-887).
 *
 * **The server decides whose work is on the page.** The stub plays it: an
 * owner is sent tasks from both spaces, a member only Laika's. What is
 * asserted is that the page draws exactly the rows it was sent, in the order
 * sent — nothing widened, filtered away or reordered on the client — and that
 * every filter it shows is a question put to the server, kept in the URL.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { LAIKA, ONROUTE, task } from './capacity-org.ts';
import {
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';

const NOW = Date.now();

const OWNER = {
  id: 'u1',
  email: 'pawan@kvelld.example',
  name: 'Pawan Sirsat',
  org_role: 'owner',
  is_active: true,
  memberships: [],
};

const MEMBER = {
  id: 'u2',
  email: 'bea@kvelld.example',
  name: 'Bea Nkosi',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

const USERS = {
  data: [
    { ...OWNER, created_at: 1, updated_at: 1 },
    { ...MEMBER, created_at: 1, updated_at: 1 },
  ],
  next_cursor: null,
};

function served(
  id: string,
  key: string,
  title: string,
  status: string,
  project: { id: string },
  assignee: string | null,
  sprint: string | null,
  status_name: string,
) {
  return {
    ...task(id, key, title, status, project, assignee ?? ''),
    assignee_id: assignee,
    sprint_id: sprint,
    status_id: `st-${status}`,
    status_name,
    updated_at: NOW - 3 * 3_600_000,
  };
}

/** The owner's first page: both spaces, oldest change first, and more to come. */
const PAGE_ONE = [
  served(
    't6',
    'ONR-356',
    'Route planner caches its tiles',
    'in_progress',
    ONROUTE,
    'u1',
    's9',
    'Building',
  ),
  served('t2', 'LAI-12', 'Heartbeat retention job', 'review', LAIKA, 'u2', 's1', 'QA'),
  served('t3', 'LAI-15', 'Rate limit headers', 'todo', LAIKA, null, null, 'To do'),
];
const PAGE_TWO = [
  served('t7', 'ONR-360', 'Driver app offline queue', 'backlog', ONROUTE, null, null, 'Backlog'),
  served('t4', 'LAI-18', 'Capacity redesign', 'done', LAIKA, 'u1', 's1', 'Done'),
];
/** What a member is sent: Laika's tasks only. Onroute is not theirs to read. */
const MEMBER_PAGE = [PAGE_ONE[1], PAGE_ONE[2]];

const SPRINTS = {
  laika: [{ id: 's1', project_id: 'p1', name: 'Sprint 14', status: 'active' }],
  onroute: [{ id: 's9', project_id: 'p2', name: 'Tiles', status: 'active' }],
};

function sprintPage(slug: 'laika' | 'onroute') {
  return {
    data: SPRINTS[slug].map((s) => ({
      goal: null,
      starts_on: 1,
      ends_on: 2,
      created_at: 1,
      updated_at: 1,
      ...s,
    })),
    next_cursor: null,
  };
}

function shell(me: typeof OWNER | typeof MEMBER): Record<string, unknown> {
  return {
    '/api/v1/me': me,
    '/api/v1/projects': {
      data: me.org_role === 'owner' ? [LAIKA, ONROUTE] : [LAIKA],
      next_cursor: null,
    },
    '/api/v1/users': USERS,
    '/api/v1/projects/laika/sprints': sprintPage('laika'),
    '/api/v1/projects/onroute/sprints': sprintPage('onroute'),
    '/api/v1/presence': { enabled: false, present: [] },
  };
}

const OWNER_STUB: ApiStub = {
  ...shell(OWNER),
  '/api/v1/tasks?fields=slim': { data: PAGE_ONE, next_cursor: 'C2' },
  '/api/v1/tasks?fields=slim&cursor=C2': { data: PAGE_TWO, next_cursor: null },
};

/**
 * The `GET /tasks` reads each page made, as their query parameters, in order.
 * The stub records paths only; the browser's own request log has the query.
 */
const ASKED = new WeakMap<Page, URLSearchParams[]>();

function reads(h: Harness): URLSearchParams[] {
  return ASKED.get(h.page) ?? [];
}

async function track(page: Page): Promise<void> {
  const asked: URLSearchParams[] = [];
  ASKED.set(page, asked);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/tasks') {
      asked.push(url.searchParams);
    }
  });
  return Promise.resolve();
}

async function openWork(path: string, stub: ApiStub, width = 1440): Promise<Harness> {
  const h = await open(path, stub, {
    before: async (page) => {
      await track(page);
      await page.setViewportSize({ width, height: 900 });
    },
  });
  await h.page.locator('.work').waitFor({ timeout: 20_000 });
  return h;
}

async function keys(page: Page): Promise<string[]> {
  await page.locator('.work-row').first().waitFor({ timeout: 10_000 });
  return page.locator('.work-row .work-key').allInnerTexts();
}

after(async () => {
  await closeBrowser();
});

void describe('Work: everyone’s work across every space (LAI-952)', () => {
  for (const theme of ['Light', 'Dark']) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: the rows served, each column named, no sideways scroll`, async () => {
        const h = await openWork('/work', OWNER_STUB, width);
        try {
          await setTheme(h.page, theme);
          assert.deepEqual(await keys(h.page), ['ONR-356', 'LAI-12', 'LAI-15']);
          await until(async () =>
            (await h.page.locator('.work-row').first().innerText()).includes('Tiles'),
          );

          const first = await h.page.locator('.work-row').first().innerText();
          for (const text of [
            'ONR-356',
            'Route planner caches its tiles',
            'Onroute',
            'Building',
            'Pawan Sirsat',
            'Tiles',
            '3 h ago',
          ]) {
            assert.ok(first.includes(text), `the first row does not say ${text}: ${first}`);
          }
          const third = await h.page.locator('.work-row').nth(2).innerText();
          assert.ok(third.includes('Unassigned') && third.includes('No sprint'), third);

          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 0, `the page scrolls sideways by ${String(overflow)}px`);

          // Every cell is drawn inside the card, with width: text that is in
          // the DOM but clipped off the row's edge still passes `innerText`.
          const cells = await h.page
            .locator('.work-row')
            .first()
            .evaluate((row) => {
              const card = row.closest('.work-list')?.getBoundingClientRect();
              return [
                '.work-key',
                '.work-title',
                '.work-space',
                '.work-status',
                '.work-assignee',
                '.work-sprint',
                '.work-updated',
              ].map((selector) => {
                const box = row.querySelector(selector)?.getBoundingClientRect();
                return {
                  selector,
                  inside:
                    box !== undefined &&
                    card !== undefined &&
                    box.width > 0 &&
                    box.left >= card.left - 0.5 &&
                    box.right <= card.right + 0.5,
                };
              });
            });
          assert.deepEqual(
            cells.filter((c) => !c.inside).map((c) => c.selector),
            [],
            'cells drawn outside the card',
          );

          const colours = await h.page.locator('.work-list').evaluate((el) => {
            const style = getComputedStyle(el);
            return { bg: style.backgroundColor, text: getComputedStyle(document.body).color };
          });
          assert.notEqual(colours.bg, 'rgba(0, 0, 0, 0)', 'the list has no card behind it');
          assert.notEqual(colours.bg, colours.text, 'the rows would be unreadable');
        } finally {
          await h.close();
        }
      });
    }
  }

  void test('Work is in the sidebar for every signed-in role', async () => {
    for (const me of [OWNER, MEMBER]) {
      const h = await openWork('/work', {
        ...shell(me),
        '/api/v1/tasks?fields=slim': { data: [], next_cursor: null },
      });
      try {
        const link = h.page.locator('a[href="/work"]');
        await link.first().waitFor({ state: 'attached', timeout: 10_000 });
        assert.ok((await link.count()) > 0, `no Work entry for a ${me.org_role}`);
      } finally {
        await h.close();
      }
    }
  });

  void test('a member sees exactly the rows the server sent, and asked for no more', async () => {
    const h = await openWork('/work', {
      ...shell(MEMBER),
      '/api/v1/tasks?fields=slim': { data: MEMBER_PAGE, next_cursor: null },
    });
    try {
      assert.deepEqual(await keys(h.page), ['LAI-12', 'LAI-15']);
      assert.equal(await h.page.locator('.work-more').count(), 0, 'Load more with nothing more');
      const asked = reads(h);
      assert.equal(asked.length, 1);
      // Unfiltered: no project, no assignee — the server's whole answer.
      assert.deepEqual(Object.fromEntries(asked[0] ?? []), { fields: 'slim', limit: '50' });
    } finally {
      await h.close();
    }
  });

  void test('Load more walks next_cursor and adds the next page under the first', async () => {
    const h = await openWork('/work', OWNER_STUB);
    try {
      await keys(h.page);
      await h.page.getByRole('button', { name: 'Load more' }).click();
      await until(async () => (await h.page.locator('.work-row').count()) === 5);
      assert.deepEqual(await keys(h.page), ['ONR-356', 'LAI-12', 'LAI-15', 'ONR-360', 'LAI-18']);
      assert.equal(await h.page.locator('.work-more').count(), 0, 'Load more after the last page');
      assert.equal(reads(h)[1]?.get('cursor'), 'C2');
    } finally {
      await h.close();
    }
  });

  void test('the filters are the URL, and each is sent to the server', async () => {
    const h = await openWork('/work?person=none&status=todo&space=laika&sprint=none', {
      ...OWNER_STUB,
      '/api/v1/tasks?fields=slim&assignee=none&status=todo&project=laika&sprint=none': {
        data: [PAGE_ONE[2]],
        next_cursor: null,
      },
      '/api/v1/tasks?fields=slim&assignee=u1': { data: [PAGE_ONE[0]], next_cursor: null },
    });
    try {
      assert.deepEqual(await keys(h.page), ['LAI-15']);
      assert.deepEqual(Object.fromEntries(reads(h)[0] ?? []), {
        fields: 'slim',
        assignee: 'none',
        status: 'todo',
        project: 'laika',
        sprint: 'none',
        limit: '50',
      });

      // Me: the person filter is the reader, in the URL and in the request.
      await h.page.getByRole('button', { name: 'Me', exact: true }).click();
      await until(() => new URL(h.page.url()).searchParams.get('person') === 'u1');
      assert.equal(new URL(h.page.url()).searchParams.get('person'), 'u1');
      await until(() => reads(h).some((q) => q.get('assignee') === 'u1'));
      assert.ok(
        reads(h).some((q) => q.get('assignee') === 'u1'),
        'Me did not ask for my work',
      );
      assert.equal(
        await h.page.getByRole('button', { name: 'Me', exact: true }).getAttribute('aria-pressed'),
        'true',
      );

      // Everyone: no person at all.
      await h.page.getByRole('button', { name: 'Everyone', exact: true }).click();
      await until(() => new URL(h.page.url()).searchParams.get('person') === null);
      assert.equal(new URL(h.page.url()).searchParams.get('person'), null);
      assert.equal(new URL(h.page.url()).searchParams.get('status'), 'todo', 'another filter lost');
    } finally {
      await h.close();
    }
  });

  void test('an assignee is a link to their profile for a holder, and plain text for anyone else (LAI-959)', async () => {
    const permissions = (role: string, actions: readonly string[]) => ({
      org_roles: [],
      project_roles: [],
      permissions: [],
      me: {
        org_role: role,
        credential: 'session',
        project_scope: 'all',
        implicit_project_role: null,
        actions,
        projects: [],
      },
    });
    const owner = await openWork('/work', {
      ...OWNER_STUB,
      '/api/v1/permissions': permissions('owner', ['people.analytics.read', 'profile.read']),
    });
    try {
      await keys(owner.page);
      const link = owner.page.locator('.work-row a.work-person[data-person-link="u2"]');
      await link.waitFor({ timeout: 10_000 });
      assert.equal((await link.innerText()).trim(), 'Bea Nkosi');
      // The name opens the person, not the task the row opens.
      await link.click();
      await until(() => new URL(owner.page.url()).pathname === '/people');
      const url = new URL(owner.page.url());
      assert.equal(url.pathname, '/people');
      assert.equal(url.searchParams.get('user'), 'u2');
    } finally {
      await owner.close();
    }

    // A member the owner granted nothing: the name, and no link.
    const member = await openWork('/work', {
      ...shell(MEMBER),
      '/api/v1/tasks?fields=slim': { data: MEMBER_PAGE, next_cursor: null },
      '/api/v1/permissions': permissions('member', ['local_activity.read_own']),
    });
    try {
      await keys(member.page);
      await until(() => member.calls.some((c) => c.path === '/api/v1/permissions'));
      await member.page.waitForTimeout(200);
      assert.equal(await member.page.locator('.work-row a[data-person-link]').count(), 0);
      assert.ok((await member.page.locator('.work-row').first().innerText()).includes('Bea Nkosi'));
    } finally {
      await member.close();
    }
  });

  void test('a row opens the task in its own space’s drawer', async () => {
    const h = await openWork('/work', {
      ...OWNER_STUB,
      '/api/v1/projects/onroute': ONROUTE,
      '/api/v1/projects/onroute/tasks': { data: [PAGE_ONE[0]], next_cursor: null },
      '/api/v1/projects/onroute/members': { members: [] },
      '/api/v1/projects/onroute/activity': { data: [], next_cursor: null },
      '/api/v1/projects/onroute/tags': { tags: [] },
      '/api/v1/projects/onroute/mentionable': { users: [] },
      '/api/v1/tasks/t6/comments': { data: [], next_cursor: null },
      '/api/v1/tasks/t6/watchers': { watchers: [] },
      '/api/v1/org': {
        id: 'o',
        name: 'Kvelld',
        presence_enabled: false,
        created_at: 1,
        updated_at: 1,
      },
    });
    try {
      await keys(h.page);
      await h.page.locator('.work-row').first().click();
      await until(() => new URL(h.page.url()).pathname === '/board');
      const url = new URL(h.page.url());
      assert.equal(url.pathname, '/board');
      assert.equal(url.searchParams.get('project'), 'onroute');
      assert.equal(url.searchParams.get('task'), 't6');
      await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
      assert.ok(
        (await h.page.locator('.drawer').innerText()).includes('Route planner caches its tiles'),
      );
    } finally {
      await h.close();
    }
  });

  void test('loading, then empty: nothing in any space says so', async () => {
    const h = await openWork(
      '/work',
      {
        ...shell(OWNER),
        '/api/v1/tasks?fields=slim': { data: [], next_cursor: null },
      },
      1440,
    );
    try {
      await h.page.locator('.state-empty').waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page.locator('.state-headline').innerText(),
        'No work in your spaces yet',
      );
    } finally {
      await h.close();
    }
  });

  void test('shows a loading state while the first page is on its way', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await open('/work', OWNER_STUB, {
      before: async (page) => {
        await track(page);
        await page.route(/\/api\/v1\/tasks\?/, async (route) => {
          await gate;
          await route.continue();
        });
      },
    });
    try {
      const loading = h.page.getByRole('status').filter({ hasText: 'Loading everyone’s work' });
      await loading.waitFor({ state: 'attached', timeout: 20_000 });
      release();
      assert.deepEqual(await keys(h.page), ['ONR-356', 'LAI-12', 'LAI-15']);
    } finally {
      release();
      await h.close();
    }
  });

  void test('filtered to nothing: says so and offers to clear the filters', async () => {
    const h = await openWork('/work?status=cancelled', {
      ...OWNER_STUB,
      '/api/v1/tasks?fields=slim&status=cancelled': { data: [], next_cursor: null },
    });
    try {
      await h.page.locator('.state-empty').waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page.locator('.state-headline').innerText(),
        'No work matches these filters',
      );
      await h.page.getByRole('button', { name: 'Clear filters' }).click();
      await until(() => new URL(h.page.url()).search === '');
      assert.equal(new URL(h.page.url()).search, '');
      assert.deepEqual(await keys(h.page), ['ONR-356', 'LAI-12', 'LAI-15']);
    } finally {
      await h.close();
    }
  });

  void test('a failed read shows an error, not an empty list', async () => {
    const h = await openWork('/work', {
      ...shell(OWNER),
      '/api/v1/tasks?fields=slim': refuse(500, 'internal', 'the database is locked'),
    });
    try {
      await h.page.locator('.state-error, [role="alert"]').first().waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.work-row').count(), 0);
      assert.equal(await h.page.locator('.state-empty').count(), 0, 'an error read as empty');
    } finally {
      await h.close();
    }
  });
});
