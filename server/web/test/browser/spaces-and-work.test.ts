/**
 * The Spaces directory and Work, as interactions (LAI-1196): making a space
 * and landing in it, archiving one only after saying what that does, every
 * choice on both pages surviving a reload, a failed refresh on Work keeping
 * the rows it had with Retry above them, and the tables saying when they
 * scroll sideways.
 *
 * The rules behind each are unit-tested beside their modules
 * (`spaces-model.test.ts`, `work-derive.test.ts`); this file is what a person
 * does with them.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { LAIKA, ONROUTE, task } from './capacity-org.ts';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';

/**
 * Which edges of a ScrollCue have columns past them, from the shared
 * component's attributes (LAI-1201's `data-more-start` / `data-more-end`,
 * which the merge train kept over LAI-1196's `data-scroll`). `start` means
 * scrolled to the start with more to the right, as LAI-1196 named it.
 */
const scrollEdge = async (cue: Locator): Promise<'none' | 'start' | 'middle' | 'end'> => {
  const moreBefore = (await cue.getAttribute('data-more-start')) === 'true';
  const moreAfter = (await cue.getAttribute('data-more-end')) === 'true';
  return moreBefore && moreAfter ? 'middle' : moreAfter ? 'start' : moreBefore ? 'end' : 'none';
};

/** The ScrollCue wrapping the scroller with this class. */
const cueOf = (page: Page, scroller: string): Locator =>
  page.locator('.scroll-cue', { has: page.locator(scroller) }).first();

const NOW = Date.now();

after(async () => {
  await closeBrowser();
});

/* ------------------------------------------------------------------ spaces */

const space = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  prefix: id.toUpperCase().slice(0, 4),
  name: id[0]!.toUpperCase() + id.slice(1),
  description: null,
  repo: null,
  visibility: 'private',
  color: 'violet',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 1, todo: 1, in_progress: 1, review: 0, done: 1, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada Lovelace' }],
  last_activity_at: NOW - 60_000,
  ...over,
});

const OWNER_PERMISSIONS = {
  org_roles: ['owner', 'admin', 'member', 'viewer'],
  project_roles: ['lead', 'member', 'viewer'],
  permissions: [
    {
      action: 'project.settings.edit',
      scope: 'project',
      label: 'Edit project settings',
      session_only: false,
      read_only: false,
      condition: null,
      roles: { lead: 'yes', member: 'no', viewer: 'no' },
    },
  ],
  me: {
    org_role: 'owner',
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: 'lead',
    actions: ['project.create', 'project.archive'],
    projects: [],
  },
};

interface SpacesWorld {
  readonly stub: ApiStub;
  /** What `POST /projects` answers next; a 201 with the body sent by default. */
  createAnswer: ((call: StubCall) => unknown) | undefined;
}

/**
 * An owner with three spaces. One path-only route answers both list reads
 * (the page holds each list to its own `archived_at`), the create, and the
 * archive `PATCH`, so what the server holds changes as the page acts.
 */
function spacesWorld(): SpacesWorld {
  const held = [
    space('zeta', {
      name: 'Zeta',
      prefix: 'ZE',
      last_activity_at: NOW - 86_400_000,
      task_counts: { backlog: 5, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
    }),
    space('alpha', {
      name: 'Alpha',
      prefix: 'AL',
      repo: 'acme/alpha',
      last_activity_at: NOW - 3_600_000,
      task_counts: { backlog: 9, todo: 9, in_progress: 2, review: 0, done: 0, cancelled: 0 },
    }),
    space('mid-space', { name: 'Middle', prefix: 'MID', last_activity_at: NOW - 60_000 }),
  ];
  const world: SpacesWorld = {
    createAnswer: undefined,
    stub: {
      '/api/v1/me': {
        id: 'u1',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        org_role: 'owner',
        is_active: true,
        memberships: held.map((s) => ({ project_id: s.id, role: 'lead' })),
      },
      '/api/v1/permissions': OWNER_PERMISSIONS,
      '/api/v1/projects': (call: StubCall) => {
        if (call.method === 'POST') {
          if (world.createAnswer !== undefined) return world.createAnswer(call);
          const body = call.body as { name: string; slug: string; prefix: string };
          const made = space(body.slug, { name: body.name, prefix: body.prefix });
          held.push(made);
          return reply(201, made);
        }
        return { data: [...held], next_cursor: null };
      },
      ...Object.fromEntries(
        held.map((s) => [
          `/api/v1/projects/${s.slug}`,
          (call: StubCall) => {
            if (call.method === 'PATCH') {
              const archived = (call.body as { archived?: boolean }).archived === true;
              Object.assign(s, { archived_at: archived ? NOW : null });
            }
            return s;
          },
        ]),
      ),
    },
  };
  return world;
}

const cardNames = async (page: Page): Promise<string[]> =>
  (await page.locator('.projects-list .project-card-name').allInnerTexts()).map((t) => t.trim());

async function spacesReady(h: Harness): Promise<void> {
  await h.page.locator('.project-card').first().waitFor({ timeout: 20_000 });
}

void describe('Spaces: create a space (LAI-1196)', () => {
  void test('New space opens the form in the URL; a reload keeps it; Cancel closes it', async () => {
    const h = await open('/projects', spacesWorld().stub);
    try {
      await spacesReady(h);
      await h.page.getByRole('button', { name: '+ New space' }).click();
      await h.page.locator('form.projects-form').waitFor({ timeout: 10_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('new'), '1');
      // The cursor is in Name — the one field nothing suggests.
      await until(async () =>
        h.page
          .locator('form.projects-form')
          .getByRole('textbox', { name: 'Name', exact: true })
          .evaluate((el) => el === document.activeElement),
      );
      assert.equal(
        await h.page
          .locator('form.projects-form')
          .getByRole('textbox', { name: 'Name', exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
        'opening the form leaves the cursor elsewhere',
      );

      await h.page.reload();
      await h.page.locator('form.projects-form').waitFor({ timeout: 20_000 });

      await h.page.locator('form.projects-form').getByRole('button', { name: 'Cancel' }).click();
      await until(async () => (await h.page.locator('form.projects-form').count()) === 0);
      assert.equal(await h.page.locator('form.projects-form').count(), 0);
      assert.equal(new URL(h.page.url()).searchParams.get('new'), null);
    } finally {
      await h.close();
    }
  });

  void test('names each problem beside its field, sends nothing, then creates and lands in it', async () => {
    const world = spacesWorld();
    const h = await open('/projects?new=1', world.stub);
    try {
      const form = h.page.locator('form.projects-form');
      await form.waitFor({ timeout: 20_000 });
      await form.getByRole('button', { name: 'Create space' }).click();
      assert.match(await form.innerText(), /Name is required\./);
      assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0, 'an empty form was sent');

      await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Payments core');
      // Suggested from the name, both still editable.
      assert.equal(
        await form.getByRole('textbox', { name: 'Slug', exact: true }).inputValue(),
        'payments-core',
      );
      await form.getByRole('textbox', { name: 'Key prefix', exact: true }).fill('9x');
      await form.getByRole('button', { name: 'Create space' }).click();
      assert.match(
        await form.innerText(),
        /Use 2–8 letters and digits, starting with a letter\./,
        'a prefix the server would refuse is not named before the round trip',
      );
      assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);

      await form.getByRole('textbox', { name: 'Key prefix', exact: true }).fill('pay');
      assert.match(await form.innerText(), /Task keys will look like PAY-42\./);
      await form.getByRole('button', { name: 'Create space' }).click();

      await h.page.waitForURL(
        (url) => url.pathname === '/board' && url.searchParams.get('project') === 'payments-core',
        { timeout: 10_000 },
      );
      const posted = h.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/projects');
      assert.deepEqual(posted?.body, {
        name: 'Payments core',
        slug: 'payments-core',
        prefix: 'PAY',
        visibility: 'private',
      });
    } finally {
      await h.close();
    }
  });

  void test('a refusal from the server is shown on its field and the form stays', async () => {
    const world = spacesWorld();
    world.createAnswer = () =>
      reply(422, {
        error: {
          code: 'unprocessable',
          message: 'Invalid request',
          details: { issues: [{ path: 'slug', message: 'That slug is taken' }] },
        },
      });
    const h = await open('/projects?new=1', world.stub);
    try {
      const form = h.page.locator('form.projects-form');
      await form.waitFor({ timeout: 20_000 });
      await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Alpha');
      await form.getByRole('button', { name: 'Create space' }).click();
      await until(() => h.calls.some((c) => c.method === 'POST'));
      await until(async () => (await form.innerText()).includes('That slug is taken'));
      assert.match(await form.innerText(), /That slug is taken/);
      assert.match(
        await form.locator('[role="alert"]').first().innerText(),
        /The space was not created\. Fix the fields marked below/,
      );
      assert.equal(
        await form.getByRole('textbox', { name: 'Name', exact: true }).inputValue(),
        'Alpha',
        'what was typed is lost',
      );
      assert.equal(new URL(h.page.url()).pathname, '/projects');
      assert.equal(new URL(h.page.url()).searchParams.get('new'), '1');
    } finally {
      await h.close();
    }
  });
});

void describe('Spaces: archive asks first (LAI-1196)', () => {
  void test('the dialog says what archiving does; Cancel sends nothing; Archive does and says so', async () => {
    const h = await open('/projects', spacesWorld().stub);
    try {
      await spacesReady(h);
      const archive = h.page.locator('[data-space="alpha"] [data-action="archive"]');
      assert.equal(await archive.getAttribute('aria-label'), 'Archive Alpha');

      await archive.click();
      const dialog = h.page.locator('[data-confirm-dialog]');
      await dialog.waitFor({ timeout: 10_000 });
      const said = await dialog.innerText();
      assert.match(said, /Archive Alpha\?/);
      assert.match(said, /board becomes read-only/);
      assert.match(said, /Nothing is deleted/);
      assert.match(said, /can be restored/);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await until(async () => (await dialog.count()) === 0);
      assert.equal(
        h.calls.filter((c) => c.method === 'PATCH').length,
        0,
        'Cancel archived the space anyway',
      );

      await archive.click();
      await dialog.getByRole('button', { name: 'Archive space' }).click();
      await until(() => h.calls.some((c) => c.method === 'PATCH'));
      const patch = h.calls.find((c) => c.method === 'PATCH');
      assert.equal(patch?.path, '/api/v1/projects/alpha');
      assert.deepEqual(patch?.body, { archived: true });

      const notice = h.page.locator('.projects-notice');
      await until(async () => (await notice.innerText()).includes('archived'));
      assert.equal(await notice.getAttribute('role'), 'status');
      assert.match(await notice.innerText(), /Alpha is archived\. Find it under Archived/);
      await until(async () => !(await cardNames(h.page)).includes('Alpha'));
      assert.ok(!(await cardNames(h.page)).includes('Alpha'), 'the archived space is still listed');
    } finally {
      await h.close();
    }
  });
});

void describe('Spaces: the page is its URL (LAI-1196)', () => {
  void test('sort, search and the list view survive a reload', async () => {
    const h = await open('/projects', spacesWorld().stub);
    try {
      await spacesReady(h);
      assert.deepEqual(await cardNames(h.page), ['Alpha', 'Middle', 'Zeta'], 'name is the default');

      await h.page.getByRole('combobox', { name: 'Sort spaces' }).click();
      await h.page.getByRole('option', { name: 'Sort: Recently active' }).click();
      await until(() => new URL(h.page.url()).searchParams.get('sort') === 'updated');
      assert.deepEqual(await cardNames(h.page), ['Middle', 'Alpha', 'Zeta']);

      await h.page.reload();
      await spacesReady(h);
      assert.deepEqual(await cardNames(h.page), ['Middle', 'Alpha', 'Zeta'], 'the order was lost');

      await h.page.goto(`${h.origin}/projects?sort=open&view=list`);
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      const listed = async () =>
        (await h.page.locator('.space-row .space-cell-name').allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(await listed(), ['Alpha', 'Zeta', 'Middle'], 'most open work first');

      await h.page.getByRole('searchbox', { name: 'Search spaces' }).fill('l');
      await until(() => new URL(h.page.url()).searchParams.get('q') === 'l');
      await h.page.reload();
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await listed(), ['Alpha', 'Middle'], 'the search or the order was lost');
      assert.equal(
        await h.page.getByRole('searchbox', { name: 'Search spaces' }).inputValue(),
        'l',
      );
    } finally {
      await h.close();
    }
  });

  void test('a card names its key and repository, never its slug', async () => {
    const h = await open('/projects', spacesWorld().stub);
    try {
      await spacesReady(h);
      assert.equal(
        await h.page.locator('[data-space="alpha"] .project-card-sub').innerText(),
        'AL · acme/alpha',
      );
      const bare = await h.page.locator('[data-space="mid-space"] .project-card-sub').innerText();
      assert.equal(bare, 'MID');
      assert.ok(!(await h.page.locator('.projects-list').innerText()).includes('mid-space'));
    } finally {
      await h.close();
    }
  });

  void test('at 768 the list scrolls sideways and says so; at 1440 it does not', async () => {
    const h = await open('/projects?view=list', spacesWorld().stub, {
      before: async (page) => {
        await page.setViewportSize({ width: 768, height: 900 });
      },
    });
    try {
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const wrap = cueOf(h.page, '.spaces-table-wrap');
        await until(async () => (await scrollEdge(wrap)) === 'start');
        assert.equal(await scrollEdge(wrap), 'start', `${theme}: no cue at 768`);
        // Read once the fade has finished, not part-way through it.
        const cue = () =>
          wrap.locator('.scroll-cue-edge-end').evaluate((el) => getComputedStyle(el).opacity);
        await until(async () => (await cue()) === '1');
        const shadow = await cue();
        assert.equal(shadow, '1', `${theme}: the right-edge cue is not drawn`);
        assert.ok(await h.page.locator('.scroll-cue-hint').first().isVisible());
        const page = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.ok(page <= 1, `${theme}: the page itself scrolls sideways by ${String(page)}px`);
      }
      const region = h.page.locator('.spaces-table-wrap').first();
      assert.equal(
        await region.getAttribute('tabindex'),
        '0',
        'the hidden columns are unreachable',
      );
      await region.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      const wrap = cueOf(h.page, '.spaces-table-wrap');
      await until(async () => (await scrollEdge(wrap)) === 'end');
      assert.equal(await scrollEdge(wrap), 'end');

      await h.page.setViewportSize({ width: 1440, height: 900 });
      await until(async () => (await scrollEdge(wrap)) === 'none');
      assert.equal(await scrollEdge(wrap), 'none', 'a cue where nothing is hidden');
      assert.equal(await region.getAttribute('tabindex'), null);
    } finally {
      await h.close();
    }
  });
});

/* -------------------------------------------------------------------- work */

const OWNER = {
  id: 'u1',
  email: 'pawan@kvelld.example',
  name: 'Pawan Sirsat',
  org_role: 'owner',
  is_active: true,
  memberships: [],
};
const BEA = {
  id: 'u2',
  email: 'bea@kvelld.example',
  name: 'Bea Nkosi',
  org_role: 'member',
  is_active: true,
  memberships: [],
};

function served(
  id: string,
  key: string,
  title: string,
  status: string,
  project: { id: string },
  assignee: string | null,
  statusName: string,
) {
  return {
    ...task(id, key, title, status, project, assignee ?? ''),
    assignee_id: assignee,
    sprint_id: null,
    status_id: `st-${status}`,
    status_name: statusName,
    updated_at: NOW - 3_600_000,
  };
}

const ROWS = [
  served('t1', 'ONR-1', 'Route planner caches its tiles', 'in_progress', ONROUTE, 'u1', 'Building'),
  served('t2', 'LAI-2', 'Heartbeat retention job', 'review', LAIKA, 'u2', 'QA'),
  served('t3', 'LAI-3', 'Rate limit headers', 'todo', LAIKA, null, 'To do'),
  served('t4', 'ONR-4', 'Driver app offline queue', 'todo', ONROUTE, 'u2', 'To do'),
];

interface WorkWorld {
  readonly stub: ApiStub;
  /** While true, every `GET /tasks` is refused `503`. */
  failing: boolean;
}

function workWorld(): WorkWorld {
  const world: WorkWorld = {
    failing: false,
    stub: {
      '/api/v1/me': OWNER,
      '/api/v1/projects': { data: [LAIKA, ONROUTE], next_cursor: null },
      '/api/v1/users': {
        data: [OWNER, BEA].map((u) => ({ ...u, created_at: 1, updated_at: 1 })),
        next_cursor: null,
      },
      '/api/v1/presence': { enabled: false, present: [] },
      '/api/v1/tasks/summary': {
        total: 4,
        by_status: { backlog: 0, todo: 2, in_progress: 1, review: 1, done: 0, cancelled: 0 },
        by_assignee: [],
        overdue: 0,
        blocked: 0,
        unassigned: 1,
      },
      '/api/v1/tasks?fields=slim': () =>
        world.failing
          ? refuse(503, 'unavailable', 'The board is restarting')
          : { data: ROWS, next_cursor: null },
    },
  };
  return world;
}

async function openWork(path: string, world: WorkWorld, width = 1440): Promise<Harness> {
  const h = await open(path, world.stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
  await h.page.locator('.work').waitFor({ timeout: 20_000 });
  return h;
}

const workKeys = async (page: Page): Promise<string[]> => {
  await page.locator('.work-row').first().waitFor({ timeout: 10_000 });
  return page.locator('.work-row .work-key').allInnerTexts();
};

void describe('Work (Organisation tab): filters and grouping are the URL (LAI-1196)', () => {
  void test('space, status, assignee and grouping survive a reload, and each is sent to the server', async () => {
    const h = await openWork('/organisation?tab=work', workWorld());
    try {
      await workKeys(h.page);
      await h.page.getByRole('combobox', { name: 'Group by' }).click();
      await h.page.getByRole('option', { name: 'Group: Space' }).click();
      await until(() => new URL(h.page.url()).searchParams.get('group') === 'space');
      const titles = async () =>
        (await h.page.locator('.work-group-title').allInnerTexts()).map((t) =>
          t.replace(/\s+/g, ' ').trim(),
        );
      assert.deepEqual(await titles(), ['LAIKA 2', 'ONROUTE 2']);
      // Each group is its own named list, for a screen reader.
      assert.deepEqual(
        await h.page
          .locator('.work-list')
          .evaluateAll((lists) => lists.map((l) => l.getAttribute('aria-label'))),
        ['Laika', 'Onroute'],
      );

      await h.page.goto(
        `${h.origin}/organisation?tab=work&space=laika&status=todo&person=none&group=status`,
      );
      await h.page.locator('.work-row').first().waitFor({ timeout: 20_000 });
      await h.page.reload();
      await h.page.locator('.work-row').first().waitFor({ timeout: 20_000 });
      const url = new URL(h.page.url()).searchParams;
      assert.deepEqual(
        ['space', 'status', 'person', 'group'].map((k) => url.get(k)),
        ['laika', 'todo', 'none', 'status'],
        'a filter was lost on reload',
      );
      const asked = h.calls.filter((c) => c.path === '/api/v1/tasks');
      assert.ok(asked.length > 0);
      const shown = await h.page.locator('.work-filters').innerText();
      for (const label of ['Laika', 'To do', 'Unassigned', 'Group: Status']) {
        assert.ok(shown.includes(label), `the filter bar does not show ${label}: ${shown}`);
      }

      await h.page.getByRole('button', { name: 'Clear filters' }).click();
      await until(() => new URL(h.page.url()).searchParams.get('space') === null);
      const cleared = new URL(h.page.url()).searchParams;
      assert.deepEqual(
        ['space', 'status', 'person', 'group'].map((k) => cleared.get(k)),
        [null, null, null, 'status'],
        'Clear filters clears the filters and keeps the grouping',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Work: a failed refresh keeps the last rows (LAI-1196)', () => {
  void test('the rows stay, marked, with Retry; Retry brings the list back', async () => {
    const world = workWorld();
    const h = await openWork('/organisation?tab=work', world);
    try {
      assert.deepEqual(await workKeys(h.page), ['ONR-1', 'LAI-2', 'LAI-3', 'ONR-4']);
      world.failing = true;
      await h.page.locator('.work-tile[data-status="todo"]').click();

      const banner = h.page.locator('.work-stale');
      await banner.waitFor({ timeout: 10_000 });
      assert.equal(await banner.getAttribute('role'), 'alert');
      assert.match(await banner.innerText(), /did not refresh.*last that loaded/s);
      assert.deepEqual(
        await h.page.locator('.work-row .work-key').allInnerTexts(),
        ['ONR-1', 'LAI-2', 'LAI-3', 'ONR-4'],
        'the last rows were thrown away',
      );
      assert.equal(await h.page.locator('.state-error, [data-api-error]').count(), 0);

      world.failing = false;
      await banner.getByRole('button', { name: 'Retry' }).click();
      await until(async () => (await banner.count()) === 0);
      assert.equal(await banner.count(), 0, 'Retry did not clear the failure');
      assert.equal(new URL(h.page.url()).searchParams.get('status'), 'todo');
    } finally {
      await h.close();
    }
  });

  void test('a first read that fails has nothing to keep: the error, with Retry', async () => {
    const world = workWorld();
    world.failing = true;
    const h = await openWork('/organisation?tab=work', world);
    try {
      const retry = h.page.getByRole('button', { name: /Retry|Try again/ });
      await retry.first().waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.work-row').count(), 0);
      assert.equal(await h.page.locator('.work-stale').count(), 0);
      world.failing = false;
      await retry.first().click();
      assert.deepEqual(await workKeys(h.page), ['ONR-1', 'LAI-2', 'LAI-3', 'ONR-4']);
    } finally {
      await h.close();
    }
  });
});

void describe('Work: the table at tablet width (LAI-1196)', () => {
  void test('at 768 it keeps its columns and scrolls with a cue; at 390 it stacks', async () => {
    const h = await openWork('/organisation?tab=work', workWorld(), 768);
    try {
      await workKeys(h.page);
      const wrap = cueOf(h.page, '.work-table');
      await until(async () => (await scrollEdge(wrap)) === 'start');
      assert.equal(await scrollEdge(wrap), 'start');
      assert.ok(await h.page.locator('.work-head').isVisible(), 'the column names are gone at 768');
      const page = await h.page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(page <= 1, `the page itself scrolls sideways by ${String(page)}px`);

      await h.page.setViewportSize({ width: 390, height: 844 });
      await until(async () => (await scrollEdge(wrap)) === 'none');
      assert.equal(await scrollEdge(wrap), 'none', 'a phone scrolls the table');
      assert.equal(await h.page.locator('.work-head').isVisible(), false);
    } finally {
      await h.close();
    }
  });
});
