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
  everSeen,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  watchFor,
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

/** The figures for the unfiltered page (LAI-974's `GET /tasks/summary`). */
const SUMMARY = {
  total: 142,
  by_status: { backlog: 40, todo: 31, in_progress: 25, review: 12, done: 33, cancelled: 1 },
  by_assignee: [
    { user_id: 'u1', name: 'Pawan Sirsat', count: 83 },
    { user_id: null, name: 'Unassigned', count: 50 },
    { user_id: 'u2', name: 'Bea Nkosi', count: 9 },
  ],
  overdue: 3,
  blocked: 0,
  unassigned: 50,
};

function shell(me: typeof OWNER | typeof MEMBER): Record<string, unknown> {
  return {
    '/api/v1/tasks/summary': SUMMARY,
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
/** The `GET /tasks/summary` reads, the same way. */
const COUNTED = new WeakMap<Page, URLSearchParams[]>();

function reads(h: Harness): URLSearchParams[] {
  return ASKED.get(h.page) ?? [];
}

function counts(h: Harness): URLSearchParams[] {
  return COUNTED.get(h.page) ?? [];
}

async function track(page: Page): Promise<void> {
  const asked: URLSearchParams[] = [];
  const counted: URLSearchParams[] = [];
  ASKED.set(page, asked);
  COUNTED.set(page, counted);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== 'GET') return;
    if (url.pathname === '/api/v1/tasks') asked.push(url.searchParams);
    if (url.pathname === '/api/v1/tasks/summary') counted.push(url.searchParams);
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
      assert.ok(
        await h.page.getByRole('button', { name: 'Next page' }).isDisabled(),
        'Next with nothing more',
      );
      const asked = reads(h);
      assert.equal(asked.length, 1);
      // Unfiltered: no project, no assignee — the server's whole answer.
      assert.deepEqual(Object.fromEntries(asked[0] ?? []), { fields: 'slim', limit: '25' });
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
        limit: '25',
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

/** `n` served rows, keyed `W-<from>`…, for a list long enough to page. */
function many(from: number, n: number) {
  return Array.from({ length: n }, (_, i) =>
    served(
      `w${String(from + i)}`,
      `W-${String(from + i)}`,
      `Task ${String(from + i)}`,
      'todo',
      LAIKA,
      null,
      null,
      'To do',
    ),
  );
}

const PAGED_STUB: ApiStub = {
  ...shell(OWNER),
  '/api/v1/tasks/summary': { ...SUMMARY, total: 30 },
  '/api/v1/tasks?fields=slim': { data: many(1, 25), next_cursor: 'P2' },
  '/api/v1/tasks?fields=slim&cursor=P2': { data: many(26, 5), next_cursor: null },
};

async function tile(page: Page, label: string) {
  const button = page.locator('.work-summary .work-tile').filter({ hasText: label });
  await button.first().waitFor({ timeout: 10_000 });
  return button.first();
}

void describe('Work: the header, the figures and the pages (LAI-975)', () => {
  void test('the page header the other pages have: title and its sentence', async () => {
    const h = await openWork('/work', OWNER_STUB);
    try {
      await keys(h.page);
      assert.equal(
        await h.page.locator('.work .screen-page .screen-page-title').innerText(),
        'Work',
      );
      assert.equal(
        await h.page.locator('.work .screen-bar').count(),
        0,
        'the old band is still drawn',
      );
      assert.ok(
        (await h.page.locator('.work .screen-page-desc').innerText()).includes('every space'),
      );
    } finally {
      await h.close();
    }
  });

  void test('the strip draws the server’s figures, and a tile is the status filter', async () => {
    const h = await openWork('/work', {
      ...OWNER_STUB,
      '/api/v1/tasks?fields=slim&status=review': { data: [PAGE_ONE[1]], next_cursor: null },
    });
    try {
      await keys(h.page);
      for (const [label, figure] of [
        ['Total', '142'],
        ['In progress', '25'],
        ['Review', '12'],
        ['To do', '31'],
        ['Backlog', '40'],
        ['Done', '33'],
        ['Overdue', '3'],
      ] as const) {
        const text = await (await tile(h.page, label)).innerText();
        assert.ok(text.includes(figure), `${label} reads ${text}, not ${figure}`);
      }
      // Blocked is zero, so it is not drawn.
      assert.equal(
        await h.page.locator('.work-summary .work-tile').filter({ hasText: 'Blocked' }).count(),
        0,
      );
      // The figures are asked with the page's filters — none here.
      assert.deepEqual(Object.fromEntries(counts(h)[0] ?? []), {});

      const review = await tile(h.page, 'Review');
      await review.click();
      await until(() => new URL(h.page.url()).searchParams.get('status') === 'review');
      assert.equal(await review.getAttribute('aria-pressed'), 'true');
      await until(async () => (await keys(h.page)).join() === 'LAI-12');
      assert.equal(reads(h).at(-1)?.get('status'), 'review');
      // The pager counts the chosen status: 12, not 142.
      await until(async () => (await h.page.locator('.work-range').innerText()) === '1–1 of 12');

      // Again clears it.
      await review.click();
      await until(() => new URL(h.page.url()).searchParams.get('status') === null);
      assert.equal(await review.getAttribute('aria-pressed'), 'false');
      // The figures never carry the status: the tiles stay the breakdown.
      assert.ok(counts(h).every((q) => q.get('status') === null));
    } finally {
      await h.close();
    }
  });

  void test('the figures follow the other filters', async () => {
    const h = await openWork('/work?space=laika&person=none', {
      ...OWNER_STUB,
      '/api/v1/tasks?fields=slim&assignee=none&project=laika': {
        data: [PAGE_ONE[2]],
        next_cursor: null,
      },
    });
    try {
      await keys(h.page);
      await until(() => counts(h).length > 0);
      assert.deepEqual(Object.fromEntries(counts(h)[0] ?? []), {
        assignee: 'none',
        project: 'laika',
      });
    } finally {
      await h.close();
    }
  });

  void test('an owner sees who holds the work, and a name filters to them', async () => {
    const h = await openWork('/work', {
      ...OWNER_STUB,
      // The server's ranking, with everyone past its top ten folded (LAI-974).
      '/api/v1/tasks/summary': {
        ...SUMMARY,
        by_assignee: [...SUMMARY.by_assignee, { user_id: 'others', name: 'Others', count: 4 }],
      },
      '/api/v1/tasks?fields=slim&assignee=u2': { data: [PAGE_ONE[1]], next_cursor: null },
    });
    try {
      await keys(h.page);
      const row = h.page.locator('.work-people');
      await row.waitFor({ timeout: 10_000 });
      const names = await row.locator('.work-person-chip').allInnerTexts();
      assert.deepEqual(
        names.map((n) => n.replace(/\s+/g, ' ').trim()),
        ['Pawan Sirsat 83', 'Unassigned 50', 'Bea Nkosi 9', 'Others 4'],
      );
      // Others is many people: a figure, not a filter.
      assert.equal(await row.locator('button').filter({ hasText: 'Others' }).count(), 0);
      await row.locator('.work-person-chip').filter({ hasText: 'Others' }).click();
      await h.page.waitForTimeout(200);
      assert.equal(new URL(h.page.url()).searchParams.get('person'), null);

      await row.locator('.work-person-chip').filter({ hasText: 'Bea Nkosi' }).click();
      await until(() => new URL(h.page.url()).searchParams.get('person') === 'u2');
      await until(async () => (await keys(h.page)).join() === 'LAI-12');
    } finally {
      await h.close();
    }
  });

  void test('a member sees the figures but no “by person” row', async () => {
    const h = await openWork('/work', {
      ...shell(MEMBER),
      '/api/v1/tasks?fields=slim': { data: MEMBER_PAGE, next_cursor: null },
    });
    try {
      await keys(h.page);
      await tile(h.page, 'Total');
      await h.page.waitForTimeout(200);
      assert.equal(await h.page.locator('.work-people').count(), 0);
    } finally {
      await h.close();
    }
  });

  /*
   * The row follows *See everyone's analytics* as the server reports it, not
   * the org role (LAI-970): the summary itself is served to every reader.
   */
  const analytics = (role: string, actions: readonly string[]) => ({
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

  void test('a member the owner granted everyone’s analytics sees the “by person” row', async () => {
    const h = await openWork('/work', {
      ...shell(MEMBER),
      '/api/v1/permissions': analytics('member', ['org.read', 'people.analytics.read']),
      '/api/v1/tasks?fields=slim': { data: MEMBER_PAGE, next_cursor: null },
    });
    try {
      await keys(h.page);
      await h.page.locator('.work-people').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('an admin the owner withdrew it from is never shown the row', async () => {
    const h = await open(
      '/work',
      {
        ...OWNER_STUB,
        '/api/v1/me': { ...OWNER, org_role: 'admin' },
        '/api/v1/permissions': analytics('admin', ['org.read', 'member_list.read']),
      },
      { before: (page) => watchFor(page, ['.work-people']) },
    );
    try {
      await keys(h.page);
      await tile(h.page, 'Total');
      await until(() => h.calls.some((c) => c.path === '/api/v1/permissions'));
      await h.page.waitForTimeout(400);
      assert.equal(await everSeen(h.page, '.work-people'), false, 'the admin was shown By person');
    } finally {
      await h.close();
    }
  });

  void test('Next, then Previous: page two’s rows, then page one’s again, counted', async () => {
    const h = await openWork('/work', PAGED_STUB);
    try {
      assert.equal((await keys(h.page)).length, 25);
      await until(async () => (await h.page.locator('.work-range').innerText()) === '1–25 of 30');
      assert.ok(await h.page.getByRole('button', { name: 'Previous page' }).isDisabled());

      await h.page.getByRole('button', { name: 'Next page' }).click();
      await until(async () => (await keys(h.page))[0] === 'W-26');
      assert.deepEqual(await keys(h.page), ['W-26', 'W-27', 'W-28', 'W-29', 'W-30']);
      assert.equal(reads(h).at(-1)?.get('cursor'), 'P2');
      // The last page: its count, and no Next.
      assert.equal(await h.page.locator('.work-range').innerText(), '26–30 of 30');
      assert.ok(await h.page.getByRole('button', { name: 'Next page' }).isDisabled());

      // Previous with the keyboard.
      await h.page.getByRole('button', { name: 'Previous page' }).focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await keys(h.page))[0] === 'W-1');
      assert.equal((await keys(h.page)).length, 25);
      assert.equal(reads(h).at(-1)?.get('cursor'), null);
      assert.equal(await h.page.locator('.work-range').innerText(), '1–25 of 30');
      assert.equal(await h.page.getByRole('button', { name: 'Load more' }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a filter change goes back to page one; the page size is the URL', async () => {
    const h = await openWork('/work', {
      ...PAGED_STUB,
      '/api/v1/tasks?fields=slim&status=todo': { data: many(1, 25), next_cursor: 'P2' },
      '/api/v1/tasks?fields=slim&limit=50': { data: many(1, 30), next_cursor: null },
    });
    try {
      await keys(h.page);
      await h.page.getByRole('button', { name: 'Next page' }).click();
      await until(async () => (await keys(h.page))[0] === 'W-26');

      await (await tile(h.page, 'To do')).click();
      await until(() => reads(h).at(-1)?.get('status') === 'todo');
      await until(async () => (await keys(h.page))[0] === 'W-1');
      assert.equal(reads(h).at(-1)?.get('cursor'), null, 'a new filter asked for page two');

      await (await tile(h.page, 'To do')).click();
      await until(() => new URL(h.page.url()).searchParams.get('status') === null);
      await h.page.getByRole('combobox', { name: 'Per page' }).click();
      await h.page.getByRole('option', { name: '50' }).click();
      await until(() => new URL(h.page.url()).searchParams.get('size') === '50');
      await until(() => reads(h).at(-1)?.get('limit') === '50');
      await until(async () => (await keys(h.page)).length === 30);
      assert.equal(await h.page.locator('.work-range').innerText(), '1–30 of 30');
    } finally {
      await h.close();
    }
  });

  void test('the strip has a loading state, then an empty one', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await open(
      '/work',
      {
        ...shell(OWNER),
        '/api/v1/tasks/summary': {
          ...SUMMARY,
          total: 0,
          by_status: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          by_assignee: [],
          overdue: 0,
          unassigned: 0,
        },
        '/api/v1/tasks?fields=slim': { data: [], next_cursor: null },
      },
      {
        before: async (page) => {
          await track(page);
          await page.route(/\/api\/v1\/tasks\/summary/, async (route) => {
            await gate;
            await route.continue();
          });
        },
      },
    );
    try {
      await h.page
        .locator('.work-summary[aria-busy="true"]')
        .waitFor({ state: 'attached', timeout: 20_000 });
      release();
      await h.page.locator('.work-summary-empty').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.work-summary .work-tile').count(), 0);
    } finally {
      release();
      await h.close();
    }
  });

  void test('a failed count leaves the list alone', async () => {
    const h = await openWork('/work', {
      ...OWNER_STUB,
      '/api/v1/tasks/summary': refuse(500, 'internal', 'the database is locked'),
    });
    try {
      assert.deepEqual(await keys(h.page), ['ONR-356', 'LAI-12', 'LAI-15']);
      await h.page.locator('.work-summary-error').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.work-range').innerText(), '1–3');
    } finally {
      await h.close();
    }
  });
});
