/**
 * Load failures that say so and recover (LAI-1128; the UX audit's B5, B6, B15).
 *
 * - **B5** Calendar and Activity drew a failed task read as an empty calendar
 *   and "0 stale tasks", with no way to ask again.
 * - **B6** Capacity and Unlisted kept an error on screen after the next read
 *   succeeded, and offered no retry; a failed re-read is now a stale notice
 *   over the rows still on screen.
 * - **B15** Unlisted's promote took the space as free text with a fixture's
 *   slug for a placeholder, and Enter did nothing.
 * - Developer › Advanced's credentials error had no *Try again*.
 *
 * Every failure here is a `500 internal`, the one a retry can fix, served
 * until the test flips the server back. Set `LAIKA_SHOTS_DIR` to also save a
 * 1440px dark screenshot of each error and stale state.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { capacityFor, orgStub } from './capacity-org.ts';
import { optionsOf, pick } from './dropdown.ts';
import {
  closeBrowser,
  defaultPermissions,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

void after(async () => {
  await closeBrowser();
});

const DOWN = () => refuse(500, 'internal', 'The database is busy.');

/** A 1440px dark capture of the state on screen, when asked for. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.LAIKA_SHOTS_DIR;
  if (dir === undefined || dir === '') return;
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'dark');
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/** The error state's own retry, not any other "Try again" on the page. */
const errorRetry = (page: Page) => page.locator('.state-error .state-retry');

// ------------------------------------------------------------- Calendar, Activity

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const today = new Date();
const dueSoon = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 2);

const TASK = {
  id: 't1',
  key: 'LC-1',
  number: 1,
  project_id: 'laika-core',
  title: 'Task one',
  description_md: '',
  acceptance_md: '',
  status: 'todo',
  priority: 'p2',
  position: null,
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: dueSoon,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
  started_at: null,
  completed_at: null,
};

/** A space whose task list fails until `state.down` is cleared. */
function spaceStub(state: { down: boolean }): ApiStub {
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks': () =>
      state.down ? DOWN() : { data: [TASK], next_cursor: null },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/members': { members: [] },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
}

void describe('B5: Calendar and Activity say a failed read failed', () => {
  void test('Calendar: an error with Try again, not an empty month; Try again recovers', async () => {
    const state = { down: true };
    const h = await open('/calendar?project=laika-core', spaceStub(state));
    try {
      await errorRetry(h.page).waitFor({ timeout: 20_000 });
      assert.match(
        (await h.page.locator('.state-error .state-headline').textContent()) ?? '',
        /^Could not load this space’s tasks$/,
      );
      assert.equal(await h.page.locator('.cal-card').count(), 0, 'an empty calendar was drawn');
      assert.equal(await h.page.locator('.cal-note').count(), 0, 'it claimed nothing is due');
      await shot(h.page, 'calendar-error');

      state.down = false;
      await errorRetry(h.page).click();
      await h.page.locator('.cal-task', { hasText: 'LC-1' }).waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.state-error').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Activity: an error with Try again, not "0 stale tasks"; Try again recovers', async () => {
    const state = { down: true };
    const h = await open('/activity?project=laika-core', spaceStub(state));
    try {
      await errorRetry(h.page).waitFor({ timeout: 20_000 });
      assert.match(
        (await h.page.locator('.state-error .state-headline').textContent()) ?? '',
        /^Could not load this space’s tasks$/,
      );
      assert.doesNotMatch(
        (await h.page
          .locator('.space-context')
          .textContent()
          .catch(() => '')) ?? '',
        /stale task/,
        'the header counted tasks it never read',
      );
      await shot(h.page, 'activity-error');

      state.down = false;
      await errorRetry(h.page).click();
      await until(async () =>
        /0 stale tasks/.test((await h.page.locator('.space-context').textContent()) ?? ''),
      );
      assert.match((await h.page.locator('.space-context').textContent()) ?? '', /0 stale tasks/);
      assert.equal(await h.page.locator('.state-error').count(), 0);
    } finally {
      await h.close();
    }
  });
});

// ----------------------------------------------------------------------- Capacity

async function capacityCards(page: Page): Promise<number> {
  return page.locator('.cap-grid > .cap-card:not(.cap-card-skeleton)').count();
}

void describe('B6: Capacity recovers', () => {
  void test('a failed first read is an error with Try again, and Try again draws the cards', async () => {
    const state = { down: true };
    const h = await open('/insights?tab=capacity', {
      ...orgStub('owner'),
      '/api/v1/capacity': () => (state.down ? DOWN() : capacityFor('owner')),
    });
    try {
      await errorRetry(h.page).waitFor({ timeout: 20_000 });
      assert.match(
        (await h.page.locator('.state-error .state-headline').textContent()) ?? '',
        /^Could not load capacity$/,
      );
      await shot(h.page, 'capacity-error');

      state.down = false;
      await errorRetry(h.page).click();
      await h.page
        .locator('.cap-grid > .cap-card:not(.cap-card-skeleton)')
        .first()
        .waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.state-error').count(), 0, 'the error outlived the data');
    } finally {
      await h.close();
    }
  });

  void test('a failed re-read keeps the cards with a stale notice; the next good read clears it', async () => {
    const state = { down: false };
    const h = await open(
      '/insights?tab=capacity',
      {
        ...orgStub('owner'),
        '/api/v1/capacity': () => (state.down ? DOWN() : capacityFor('owner')),
      },
      {
        before: async (page) => {
          await page.clock.install();
        },
      },
    );
    try {
      await h.page
        .locator('.cap-grid > .cap-card:not(.cap-card-skeleton)')
        .first()
        .waitFor({ timeout: 20_000 });
      const cards = await capacityCards(h.page);
      assert.ok(cards > 0);

      state.down = true;
      const reads = () => h.calls.filter((c) => c.path === '/api/v1/capacity').length;
      const before = reads();
      await h.page.clock.fastForward(20_000);
      await until(() => reads() > before);
      const notice = h.page.locator('.state-stale');
      await notice.waitFor({ timeout: 10_000 });
      assert.match(
        (await notice.textContent()) ?? '',
        /^Could not refresh — showing what was read at/,
      );
      assert.equal(await capacityCards(h.page), cards, 'a failed re-read took the cards away');
      assert.equal(
        await h.page.locator('.state-error').count(),
        0,
        'a re-read became an error page',
      );
      assert.match((await h.page.locator('.cap-page').textContent()) ?? '', /refresh failed/);
      await shot(h.page, 'capacity-stale');

      state.down = false;
      await notice.getByRole('button', { name: 'Try again' }).click();
      await notice.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await capacityCards(h.page), cards);
      assert.match((await h.page.locator('.cap-page').textContent()) ?? '', /updated every 20s/);
    } finally {
      await h.close();
    }
  });
});

// ----------------------------------------------------------------------- Unlisted

const NOW = Date.now();

const NOTE = {
  id: 'n2',
  user_id: 'u2',
  token_id: 'tok1',
  repo: 'PawanSirsat/Laika',
  note: 'The release script skips the arm64 image.',
  promoted_task_id: null,
  dismissed_at: null,
  created_at: NOW - 3_600_000,
};

const OWNER = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [
    { project_id: 'p1', role: 'lead' },
    { project_id: 'p2', role: 'lead' },
    { project_id: 'p3', role: 'viewer' },
  ],
};

const space = (id: string, slug: string, name: string, prefix: string) => ({
  ...CORE,
  id,
  slug,
  name,
  prefix,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
});

/**
 * The owner's grants as the server reports them, with no implicit lead: they
 * may create tasks in `create` and nowhere else. A test about `task.create`
 * names its own `/permissions` (LAI-178).
 */
function permissionsFor(create: readonly string[]): unknown {
  const base = defaultPermissions(OWNER) as { me: Record<string, unknown> };
  return {
    ...base,
    me: {
      ...base.me,
      implicit_project_role: null,
      projects: ['p1', 'p2', 'p3'].map((id) => ({
        project_id: id,
        role: create.includes(id) ? 'lead' : 'viewer',
        actions: create.includes(id) ? ['task.create', 'task.write'] : [],
      })),
    },
  };
}

function unlistedStub(state: { down: boolean }, create: readonly string[] = ['p1', 'p2']) {
  return {
    '/api/v1/me': OWNER,
    '/api/v1/permissions': permissionsFor(create),
    '/api/v1/projects': {
      data: [
        space('p2', 'onroute', 'Onroute', 'ONR'),
        space('p1', 'laika-core', 'Laika Core', 'LC'),
        space('p3', 'archive', 'Archive', 'ARC'),
      ],
      next_cursor: null,
    },
    '/api/v1/users': {
      data: [
        { id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', org_role: 'owner' },
        { id: 'u2', name: 'Tomas Nel', email: 't@example.com', org_role: 'member' },
      ],
      next_cursor: null,
    },
    '/api/v1/unlisted': () => (state.down ? DOWN() : { data: [NOTE], next_cursor: null }),
    '/api/v1/unlisted/n2/promote': (call: StubCall) => ({
      unlisted: { ...NOTE, promoted_task_id: 'task-7' },
      task: { id: 'task-7', key: 'ONR-7', title: (call.body as { title: string }).title },
    }),
  } satisfies ApiStub;
}

void describe('B6: Unlisted recovers', () => {
  void test('a failed first read is an error with Try again, and Try again draws the queue', async () => {
    const state = { down: true };
    const h = await open('/inbox?tab=unlisted', unlistedStub(state));
    try {
      await errorRetry(h.page).waitFor({ timeout: 20_000 });
      assert.match(
        (await h.page.locator('.state-error .state-headline').textContent()) ?? '',
        /^Could not load the unlisted queue$/,
      );
      await shot(h.page, 'unlisted-error');

      state.down = false;
      await errorRetry(h.page).click();
      await h.page.locator('.unl-line').first().waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.state-error').count(), 0, 'the error outlived the data');
    } finally {
      await h.close();
    }
  });

  void test('a failed re-read keeps the rows with a stale notice; Try again clears it', async () => {
    const state = { down: false };
    const h = await open('/inbox?tab=unlisted', unlistedStub(state), {
      before: async (page) => {
        await page.clock.install();
      },
    });
    try {
      await h.page.locator('.unl-line').first().waitFor({ timeout: 20_000 });

      state.down = true;
      const reads = () => h.calls.filter((c) => c.path === '/api/v1/unlisted').length;
      const before = reads();
      await h.page.clock.fastForward(30_000);
      await until(() => reads() > before);
      const notice = h.page.locator('.state-stale');
      await notice.waitFor({ timeout: 10_000 });
      assert.match(
        (await notice.textContent()) ?? '',
        /^Could not refresh — showing what was read at/,
      );
      assert.equal(await h.page.locator('.unl-line').count(), 1, 'a failed re-read took the rows');
      assert.equal(
        await h.page.locator('.state-error').count(),
        0,
        'a re-read became an error page',
      );
      await shot(h.page, 'unlisted-stale');

      state.down = false;
      await notice.getByRole('button', { name: 'Try again' }).click();
      await notice.waitFor({ state: 'detached', timeout: 10_000 });
      assert.equal(await h.page.locator('.unl-line').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('B15: Unlisted promote picks a space', () => {
  async function openForm(page: Page): Promise<void> {
    await page.locator('.unl-line').first().waitFor({ timeout: 20_000 });
    await page.locator('.unl-line').first().click();
    await page.locator('.unl-promote').click();
    await page.locator('.unl-form').waitFor({ timeout: 10_000 });
  }

  void test('only the spaces the reader may create tasks in; Enter in the title submits', async () => {
    const h = await open('/inbox?tab=unlisted', unlistedStub({ down: false }));
    try {
      await openForm(h.page);
      const picker = h.page.locator('.unl-form [role="combobox"]');
      const create = h.page.getByRole('button', { name: 'Create task' });
      const hint = h.page.locator('.unl-hint');

      // No free text, and nothing fixture-shaped in it.
      assert.equal(await h.page.locator('.unl-form input[placeholder="laika-core"]').count(), 0);
      await until(async () => (await hint.textContent()) === 'Choose a space.');
      assert.equal(await hint.textContent(), 'Choose a space.');
      assert.equal(await create.isDisabled(), true);
      assert.equal(
        await create.getAttribute('aria-describedby'),
        await hint.getAttribute('id'),
        'the reason is not tied to the button',
      );

      // Laika Core and Onroute, by name; Archive (no task.create) is not offered.
      const { labels } = await optionsOf(picker);
      assert.deepEqual(labels, ['Laika Core', 'Onroute']);

      await pick(picker, 'onroute');
      await h.page.locator('.unl-form input').fill('');
      assert.equal(await hint.textContent(), 'Give the task a title.');
      assert.equal(await create.isDisabled(), true);
      await shot(h.page, 'unlisted-promote-disabled');

      await h.page.locator('.unl-form input').fill('Build the arm64 image');
      assert.equal(await hint.count(), 0, 'a reason was shown while nothing blocks');
      await h.page.locator('.unl-form input').press('Enter');

      await until(() => h.calls.some((c) => c.path === '/api/v1/unlisted/n2/promote'));
      const posted = h.calls.filter(
        (c) => c.method === 'POST' && c.path === '/api/v1/unlisted/n2/promote',
      );
      assert.equal(posted.length, 1, 'Enter did not submit');
      assert.deepEqual(posted[0]?.body, {
        project_slug: 'onroute',
        title: 'Build the arm64 image',
      });
    } finally {
      await h.close();
    }
  });

  void test('no space the reader may create in: the picker is off and the button says why', async () => {
    const h = await open('/inbox?tab=unlisted', unlistedStub({ down: false }, []));
    try {
      await openForm(h.page);
      const hint = h.page.locator('.unl-hint');
      await until(async () => /any space/.test((await hint.textContent()) ?? ''));
      assert.equal(
        await hint.textContent(),
        'You cannot create tasks in any space. A space lead can give you access.',
      );
      assert.equal(await h.page.getByRole('button', { name: 'Create task' }).isDisabled(), true);
      assert.equal(await h.page.locator('.unl-form [role="combobox"]').isDisabled(), true);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------ Developer › Advanced

const DEV_ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

void describe('Developer › Advanced recovers', () => {
  void test('a failed read of the credentials has Try again, and Try again lists them', async () => {
    const state = { down: true };
    const h = await open('/developer?tab=advanced', {
      '/api/v1/me': DEV_ME,
      '/api/v1/projects': { data: [], next_cursor: null },
      '/api/v1/tokens': () =>
        state.down
          ? DOWN()
          : {
              data: [
                {
                  id: 't1',
                  name: 'nightly-export',
                  prefix: 'lai_abcd',
                  scope: 'full',
                  project_ids: null,
                  last_used_at: null,
                  last_mcp_at: null,
                  last_client: null,
                  last_client_name: null,
                  expires_at: null,
                  revoked_at: null,
                  created_at: 1,
                  kind: 'personal',
                  agent_id: null,
                  agent_label: null,
                },
              ],
              next_cursor: null,
            },
      '/api/v1/presence': { enabled: true, present: [] },
      '/api/v1/agents': { data: [], next_cursor: null },
      '/api/v1/agents/devices': { data: [] },
      '/api/v1/org': {
        id: 'org1',
        name: 'Kvell Dynamics',
        presence_enabled: true,
        developer_insights: true,
        created_at: 1,
        updated_at: 1,
      },
      '/api/v1/developer/compatibility': {
        server: { version: '0.1.0', build_commit: null },
        protocol: { current: 1, min_client: 1 },
        features: {
          developer_access: 'v3',
          device_pairing: false,
          tool_setup_exchange: false,
          client_reports: false,
          project_setups: false,
        },
        cli: {},
        release_notes: { ref: null, whats_new: [] },
      },
    });
    try {
      await errorRetry(h.page).waitFor({ timeout: 20_000 });
      assert.match(
        (await h.page.locator('.state-error .state-headline').textContent()) ?? '',
        /^Could not load your credentials$/,
      );
      await shot(h.page, 'developer-advanced-error');

      state.down = false;
      await errorRetry(h.page).click();
      await h.page.getByText('nightly-export').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('.state-error').count(), 0);
    } finally {
      await h.close();
    }
  });
});
