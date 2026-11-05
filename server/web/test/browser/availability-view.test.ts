/**
 * Insights → Time → Availability, in a real browser (LAI-1139; frames 2g–2l,
 * 2n–2o; D-131, D-137, D-088).
 *
 * The server decides who is listed, in what order, and which columns each
 * reader is sent (LAI-1130). What is left to prove is the page: it keeps the
 * server's A–Z and offers no sort; it draws a column only when its field came;
 * the filters go to the server as its three parameters; *Add to project…*
 * offers a space admin only the spaces they lead, posts once with the message
 * and the card, and says *✓ Added…*; a `409` and a `422 user_deactivated`
 * read as what they are; and there is no free-hours column anywhere.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { NOW, open } from './my-day-clock.ts';

const DAY = 86_400_000;
const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

void after(async () => {
  await closeBrowser();
});

const project = (id: string, slug: string, name: string) => ({
  id,
  slug,
  prefix: slug.slice(0, 3).toUpperCase(),
  name,
  archived_at: null,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  member_count: 1,
  members: [],
});

const SAUCE = project('p1', 'sauce', 'Sauce');
const SYNQ = project('p2', 'synq', 'SynQ');
const ONROUTE = project('p3', 'onroute', 'OnRoute');
const ref = (p: { id: string; slug: string; name: string }) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
});

/** What an owner is sent: the whole record, In progress and Last 2 weeks. */
const OWNER_ROWS = [
  {
    user: { id: 'u2', name: 'Amara Okafor' },
    availability: {
      status: 'open',
      note: 'Happy to pick up front-end work',
      tags: ['Front-end', 'Maps'],
      away: null,
      hours_per_week: 10,
      away_periods: [],
      work_week: null,
      updated_at: NOW - 3 * DAY,
    },
    spaces: [ref(ONROUTE)],
    in_progress: 3,
    last_2_weeks_minutes: 2480,
  },
  {
    user: { id: 'u3', name: 'Lindiwe Dube' },
    availability: {
      status: 'capacity',
      note: null,
      tags: ['Back-end'],
      away: null,
      hours_per_week: null,
      away_periods: [],
      work_week: null,
      updated_at: NOW - 40 * DAY,
    },
    spaces: [ref(SYNQ)],
    // The busiest person, listed where A–Z puts them and nowhere else.
    in_progress: 9,
    last_2_weeks_minutes: 4265,
  },
  {
    user: { id: 'u4', name: 'Riya Menon' },
    availability: {
      status: 'open',
      note: 'Back on the 16th',
      tags: ['Accessibility'],
      away: { until: '2026-11-16' },
      hours_per_week: null,
      away_periods: [{ from: '2026-11-02', to: '2026-11-16' }],
      work_week: null,
      updated_at: NOW - 5 * DAY,
    },
    spaces: [ref(SAUCE), ref(ONROUTE)],
    in_progress: 1,
    last_2_weeks_minutes: 2330,
  },
];

/** What a space admin is sent (D-137 item 2): no hours tracked, no working week. */
const LEAD_ROWS = OWNER_ROWS.map(({ last_2_weeks_minutes: _, availability, ...row }) => ({
  ...row,
  availability: {
    status: availability.status,
    note: availability.note,
    tags: availability.tags,
    away: availability.away,
    hours_per_week: availability.hours_per_week,
    away_periods: availability.away_periods,
  },
}));

function permissions(role: string, leads: readonly string[]): unknown {
  const adminUp = role === 'owner' || role === 'admin';
  return {
    org_roles: ['owner', 'admin', 'member', 'viewer'],
    project_roles: ['lead', 'member', 'viewer'],
    permissions: [],
    me: {
      org_role: role,
      credential: 'session',
      project_scope: 'all',
      implicit_project_role: adminUp ? 'lead' : null,
      actions: [
        'project.read',
        ...(adminUp ? ['time.report.read', 'people.analytics.read', 'audit_log.export'] : []),
      ],
      projects: adminUp
        ? []
        : [SAUCE, SYNQ, ONROUTE].map((p) => ({
            project_id: p.id,
            role: leads.includes(p.id) ? 'lead' : 'member',
            actions: leads.includes(p.id)
              ? ['project.read', 'time.report.read_project', 'project.members.manage']
              : ['project.read'],
          })),
    },
  };
}

interface Options {
  readonly role: 'owner' | 'member';
  readonly leads?: readonly string[];
  readonly rows?: (call: StubCall) => unknown;
  readonly add?: (call: StubCall) => unknown;
  readonly calls?: StubCall[];
}

function stub(opts: Options): ApiStub {
  const owner = opts.role === 'owner';
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      org_role: opts.role,
      is_active: true,
      memberships: (opts.leads ?? []).map((id) => ({ project_id: id, role: 'lead' })),
    },
    '/api/v1/permissions': permissions(opts.role, opts.leads ?? []),
    '/api/v1/projects': { data: [ONROUTE, SAUCE, SYNQ], next_cursor: null },
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis Labs',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/unlisted': { data: [], next_cursor: null },
    '/api/v1/people/availability': (call: StubCall) => {
      opts.calls?.push(call);
      return opts.rows?.(call) ?? { data: owner ? OWNER_ROWS : LEAD_ROWS };
    },
    '/api/v1/projects/sauce/tasks': { data: [], next_cursor: null },
    '/api/v1/projects/synq/tasks?status=todo': {
      data: [
        {
          id: 't97',
          key: 'SYNQ-97',
          title: 'Conflict banner on mobile',
          status: 'todo',
          project_id: 'p2',
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/synq/tasks?status=backlog': { data: [], next_cursor: null },
    '/api/v1/projects/onroute/tasks': { data: [], next_cursor: null },
    '/api/v1/projects/synq/members': (call: StubCall) => {
      opts.calls?.push(call);
      return opts.add?.(call) ?? reply(201, { members: [] });
    },
    '/api/v1/projects/sauce/members': (call: StubCall) => {
      opts.calls?.push(call);
      return opts.add?.(call) ?? reply(201, { members: [] });
    },
  };
}

async function view(opts: Options, width = 1440): Promise<Harness> {
  const h = await open('/insights?tab=time&view=availability', stub(opts));
  await h.page.setViewportSize({ width, height: 900 });
  await h.page.locator('[data-availability-view]').waitFor({ timeout: 20_000 });
  return h;
}

const rowNames = (page: Page) =>
  page.locator('.avail-table tbody tr .avail-person-name').allInnerTexts();
const headers = (page: Page) => page.locator('.avail-table thead th').allInnerTexts();

void describe('who has room (frames 2g–2i)', () => {
  for (const theme of ['Light', 'Dark'] as const) {
    void test(`an owner: A–Z as sent, every column the server sent, no free hours (${theme})`, async () => {
      const h = await view({ role: 'owner' });
      try {
        await setTheme(h.page, theme);
        assert.deepEqual(await rowNames(h.page), ['Amara Okafor', 'Lindiwe Dube', 'Riya Menon']);
        const cols = (await headers(h.page)).map((c) => c.trim());
        assert.deepEqual(cols.slice(0, 6), [
          'PERSON',
          'AVAILABILITY',
          'CAN TAKE',
          'PROJECTS',
          'IN PROGRESS',
          'LAST 2 WEEKS',
        ]);
        const text = await h.page.locator('[data-availability-view]').innerText();
        assert.doesNotMatch(text, /free/i, 'frame 2m (free hours) is absent');
        assert.match(text, /3 people · sorted A–Z, never by how busy someone is/);
        assert.match(
          text,
          /Owners, admins and space admins · read-only · people can see who looked/,
        );
        // Away wins over the status; a month-old record says so.
        const riya = h.page.locator('tr[data-person="u4"]');
        assert.match(await riya.innerText(), /◐\s*Away until Mon 16 Nov/);
        const lindiwe = h.page.locator('tr[data-person="u3"]');
        assert.match(await lindiwe.innerText(), /may be out of date/);
        assert.match(await lindiwe.innerText(), /71h 5m/);
        // No sort control: the list is A–Z and the page asks for nothing else.
        assert.equal(await h.page.locator('[aria-sort], [data-sort]').count(), 0);
        await shoot(h.page, `availability-owner-${theme}`);
      } finally {
        await h.close();
      }
    });
  }

  void test('a space admin: no Last 2 weeks column, because the server sent no such field', async () => {
    const h = await view({ role: 'member', leads: ['p1'] });
    try {
      const cols = (await headers(h.page)).map((c) => c.trim());
      assert.ok(cols.includes('IN PROGRESS'));
      assert.ok(cols.includes('CAN TAKE'));
      assert.ok(!cols.includes('LAST 2 WEEKS'), `columns: ${cols.join(', ')}`);
    } finally {
      await h.close();
    }
  });

  void test('the filters are the server’s three parameters, and the empty states are worded as drawn', async () => {
    const calls: StubCall[] = [];
    const h = await view({
      role: 'owner',
      calls,
      rows: () => (calls.length > 1 ? { data: [] } : { data: OWNER_ROWS }),
    });
    try {
      const asked: string[] = [];
      h.page.on('request', (r) => {
        if (r.url().includes('/api/v1/people/availability')) asked.push(new URL(r.url()).search);
      });
      await h.page.getByRole('switch', { name: 'Open to more work only' }).click();
      const empty = h.page.locator('[data-availability-empty]');
      await empty.waitFor({ timeout: 10_000 });
      assert.deepEqual(asked, ['?open_only=true']);
      assert.match(
        await empty.innerText(),
        /Nobody has marked themselves open to more work in any space\./,
      );
      assert.match(
        await empty.innerText(),
        /Availability is set by each person from My day\. People at capacity or away are still listed when the filter is off\./,
      );
      await shoot(h.page, 'availability-empty');
      await empty.getByRole('button', { name: 'Show everyone in all spaces' }).click();
      await until(async () => (await h.page.locator('[data-availability-empty]').count()) === 1);
      assert.match(
        await h.page.locator('[data-availability-empty]').innerText(),
        /Nobody matches these filters\./,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('who may look', () => {
  void test('a member who leads nothing is refused the address, and nothing asks for anyone', async () => {
    const h = await open('/insights?tab=time&view=availability', stub({ role: 'member' }));
    try {
      await h.page
        .getByText(/You do not have access to the Time report/)
        .waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-availability-view]').count(), 0);
      assert.equal(
        h.calls.some((c) => c.path === '/api/v1/people/availability' || c.path.endsWith('/load')),
        false,
        'a member session asked for availability or load',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Add to project… (frames 2j–2l)', () => {
  void test('a space admin is offered only the spaces they lead; one POST with message and card, then ✓ Added', async () => {
    const calls: StubCall[] = [];
    const h = await view({ role: 'member', leads: ['p2'], calls });
    try {
      await h.page.getByRole('button', { name: 'Add Amara Okafor to a project' }).click();
      const dialog = h.page.getByRole('dialog', { name: 'Add Amara to a project' });
      await dialog.waitFor({ timeout: 10_000 });
      // Only SynQ, the one space they lead: not Sauce, not OnRoute.
      const spaces = await dialog.locator('fieldset').first().locator('label').allInnerTexts();
      assert.deepEqual(
        spaces.map((s) => s.trim()),
        ['SynQ'],
      );
      await dialog.getByRole('radio', { name: /SYNQ-97/ }).check();
      await dialog
        .getByRole('textbox', { name: /Message to Amara/ })
        .fill('**Welcome** <b>aboard</b>');
      assert.match(
        await dialog.locator('[data-add-summary]').innerText(),
        /Amara joins SynQ as Member and gets SYNQ-97\. They are notified, and it shows up in their My day\./,
      );
      await shoot(h.page, 'availability-add');
      await dialog.getByRole('button', { name: 'Add to SynQ' }).click();
      await until(() => calls.some((c) => c.method === 'POST'));
      const posts = calls.filter((c) => c.method === 'POST');
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0], {
        method: 'POST',
        path: '/api/v1/projects/synq/members',
        body: {
          user_id: 'u2',
          role: 'member',
          message: '**Welcome** <b>aboard</b>',
          assign_task_id: 't97',
        },
      });
      const done = h.page.locator('tr[data-person="u2"] .avail-done');
      await done.waitFor({ timeout: 10_000 });
      assert.equal(await done.innerText(), '✓ Added to SynQ as Member · Amara was notified');
    } finally {
      await h.close();
    }
  });

  void test('a 422 user_deactivated says so, and a 409 takes the space off the list', async () => {
    let answer: unknown = reply(422, {
      error: {
        code: 'unprocessable',
        message: 'That person is deactivated',
        details: { reason: 'user_deactivated' },
      },
    });
    const h = await view({ role: 'member', leads: ['p2'], add: () => answer });
    try {
      await h.page.getByRole('button', { name: 'Add Amara Okafor to a project' }).click();
      const dialog = h.page.getByRole('dialog', { name: 'Add Amara to a project' });
      await dialog.getByRole('button', { name: 'Add to SynQ' }).click();
      const alert = dialog.getByRole('alert');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(
        await alert.innerText(),
        'Amara Okafor is deactivated and can’t be added to a space.',
      );

      answer = reply(409, {
        error: { code: 'conflict', message: 'That user is already a member of this project' },
      });
      await dialog.getByRole('button', { name: 'Add to SynQ' }).click();
      await until(async () => (await alert.innerText()).includes('already a member of SynQ'));
      assert.equal(await alert.innerText(), 'Amara is already a member of SynQ.');
      assert.match(await dialog.innerText(), /already a member/);
      assert.equal(await dialog.getByRole('button', { name: 'Add to SynQ' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('a card that can no longer be handed over', () => {
  void test('422 task_not_assignable says so and reads the cards again', async () => {
    const calls: StubCall[] = [];
    const h = await view({
      role: 'member',
      leads: ['p2'],
      calls,
      add: () =>
        reply(422, {
          error: {
            code: 'unprocessable',
            message: 'That card cannot be assigned',
            details: { reason: 'task_not_assignable' },
          },
        }),
    });
    try {
      await h.page.getByRole('button', { name: 'Add Amara Okafor to a project' }).click();
      const dialog = h.page.getByRole('dialog', { name: 'Add Amara to a project' });
      await dialog.getByRole('radio', { name: /SYNQ-97/ }).check();
      const before = h.calls.filter((c) => c.path === '/api/v1/projects/synq/tasks').length;
      await dialog.getByRole('button', { name: 'Add to SynQ' }).click();
      const alert = dialog.getByRole('alert');
      await alert.waitFor({ timeout: 10_000 });
      assert.equal(
        await alert.innerText(),
        'That card can no longer be handed over. Pick another, or no card.',
      );
      await until(
        () => h.calls.filter((c) => c.path === '/api/v1/projects/synq/tasks').length > before,
      );
      assert.ok(
        h.calls.filter((c) => c.path === '/api/v1/projects/synq/tasks').length > before,
        'the cards were not read again',
      );
      // Still open, nothing marked added.
      assert.equal(await h.page.locator('tr[data-person="u2"] .avail-done').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('a space admin’s filter', () => {
  void test('Space offers only the spaces they lead', async () => {
    const h = await view({ role: 'member', leads: ['p2'] });
    try {
      await h.page.locator('[data-availability-view] .avail-filter-pick').first().click();
      const options = await h.page.getByRole('option').allInnerTexts();
      assert.deepEqual(
        options.map((o) => o.trim()),
        ['All spaces', 'SynQ'],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('on a phone (frame 2i)', () => {
  void test('at 390 the people are cards, inside the screen', async () => {
    const h = await view({ role: 'owner' }, 390);
    try {
      const cards = h.page.locator('.avail-cards [data-person-card]');
      await until(async () => (await cards.count()) === 3);
      assert.equal(await cards.count(), 3);
      assert.equal(await h.page.locator('.avail-table').isVisible(), false);
      const width = await h.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 390, `the page scrolls sideways: ${String(width)}px`);
      await shoot(h.page, 'availability-390');
    } finally {
      await h.close();
    }
  });
});
