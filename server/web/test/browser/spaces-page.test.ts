/**
 * The Spaces page (D-103 item 12, LAI-978), in a real browser: search, the
 * four chips and their counts, Grid / List kept in the URL, one card height
 * whatever the description, a list whose columns never run into each other,
 * the archived list with Restore, and controls shown only to whoever holds
 * them. The rules themselves are unit-tested in
 * `test/routes/screens/projects/spaces-model.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  open,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';

const NOW = Date.now();

const space = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: id,
  prefix: id.toUpperCase().slice(0, 4),
  name: id[0]!.toUpperCase() + id.slice(1),
  description: null,
  repo: null,
  visibility: 'private',
  color: null,
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 4, todo: 2, in_progress: 1, review: 1, done: 2, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [
    { user_id: 'u1', name: 'Ada Lovelace' },
    { user_id: 'u2', name: 'Grace Hopper' },
  ],
  last_activity_at: NOW - 3 * 60_000,
  ...over,
});

const LAIKA = space('laika', {
  name: 'Laika',
  prefix: 'LAIKA',
  repo: 'PawanSirsat/Laika',
  color: 'violet',
  description: 'The board.',
  task_counts: { backlog: 300, todo: 10, in_progress: 10, review: 42, done: 358, cancelled: 0 },
  blocked_count: 38,
  member_count: 7,
  members: ['Ada', 'Grace', 'Linus', 'Ken', 'Dennis'].map((name, i) => ({
    user_id: `m${String(i)}`,
    name,
  })),
});
const LONG = space('longdesc', {
  name: 'Long description',
  color: 'teal',
  description:
    'A description that goes on far longer than two lines of a card can hold, so the card would grow to fit it if nothing held it to the shape every other card has. '.repeat(
      4,
    ),
});
const BARE = space('bare', {
  name: 'Bare',
  color: 'amber',
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
});
const MINE_PUBLIC = space('rocket', {
  name: 'Rocket',
  visibility: 'public',
  repo: 'acme/rocket',
  color: 'blue',
});
const OPEN = space('commons', {
  name: 'Commons',
  visibility: 'public',
  color: 'green',
  member_count: 4,
});
const SECRET = space('secret', { name: 'Secret' });
const GONE = space('gone', { name: 'Gone', archived_at: NOW - 86_400_000, color: 'red' });

const MINE = [LAIKA, LONG, BARE, MINE_PUBLIC];

function permissions(role: 'owner' | 'member') {
  const settingsRow = {
    action: 'project.settings.edit',
    scope: 'project',
    label: 'Edit project settings',
    session_only: false,
    read_only: false,
    condition: null,
    roles: { lead: 'yes', member: 'no', viewer: 'no' },
  };
  return role === 'owner'
    ? {
        org_roles: ['owner', 'admin', 'member', 'viewer'],
        project_roles: ['lead', 'member', 'viewer'],
        permissions: [settingsRow],
        me: {
          org_role: 'owner',
          credential: 'session',
          project_scope: 'all',
          implicit_project_role: 'lead',
          actions: ['project.create', 'project.archive'],
          projects: [],
        },
      }
    : {
        org_roles: ['owner', 'admin', 'member', 'viewer'],
        project_roles: ['lead', 'member', 'viewer'],
        permissions: [settingsRow],
        me: {
          org_role: 'member',
          credential: 'session',
          project_scope: 'all',
          implicit_project_role: null,
          actions: [],
          projects: [
            {
              project_id: 'laika',
              role: 'lead',
              actions: ['project.read', 'project.settings.edit'],
            },
            { project_id: 'longdesc', role: 'member', actions: ['project.read'] },
          ],
        },
      };
}

function stub(role: 'owner' | 'member'): ApiStub {
  const archived = [GONE];
  const live = [...MINE, OPEN, SECRET];
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      org_role: role,
      is_active: true,
      memberships: [...MINE, GONE].map((s) => ({
        project_id: s.id,
        role: s.id === 'laika' ? 'lead' : 'member',
      })),
    },
    '/api/v1/permissions': permissions(role),
    '/api/v1/projects?limit=50&archived=only': () => ({ data: [...archived], next_cursor: null }),
    '/api/v1/projects?limit=50': () => ({
      data: role === 'owner' ? live : live.filter((s) => s.id !== 'secret'),
      next_cursor: null,
    }),
    '/api/v1/projects/gone': (call: StubCall) => {
      if (call.method === 'PATCH') {
        archived.length = 0;
        live.push({ ...GONE, archived_at: null });
      }
      return { ...GONE, archived_at: null };
    },
  };
}

const cards = (h: Harness) => h.page.locator('.projects-list .project-card');
const names = async (h: Harness): Promise<string[]> =>
  (await h.page.locator('.project-card-name').allInnerTexts()).map((t) => t.trim());
const param = (h: Harness, key: string): string | null =>
  new URL(h.page.url()).searchParams.get(key);

async function ready(h: Harness): Promise<void> {
  await h.page.locator('.project-card').first().waitFor({ timeout: 20_000 });
}

after(async () => {
  await closeBrowser();
});

void describe('the header and the chips', () => {
  void test('a member: the count, the counts on each chip, and no New space', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await ready(h);
      assert.match(await h.page.locator('.screen-page-context').innerText(), /^5 spaces$/);
      assert.match(
        await h.page.locator('.screen-page-desc').innerText(),
        /Spaces you can see\. Opening one loads its board; the choice lives in the URL\./,
      );
      const chip = (f: string) => h.page.locator(`.spaces-chip[data-filter="${f}"]`);
      await until(async () => (await chip('archived').innerText()).includes('1'));
      const chips = await Promise.all(
        ['all', 'yours', 'public', 'archived'].map((f) => chip(f).innerText()),
      );
      assert.deepEqual(
        chips.map((t) => t.replace(/\s+/g, ' ').trim()),
        ['All 5', 'Yours 4', 'Public 2', 'Archived 1'],
      );
      assert.equal(await chip('all').getAttribute('aria-pressed'), 'true');
      assert.equal(
        await h.page.getByRole('button', { name: 'New space' }).count(),
        0,
        'a member without project.create is offered New space',
      );

      assert.deepEqual(await names(h), ['Bare', 'Laika', 'Long description', 'Rocket', 'Commons']);
      assert.equal(await h.page.getByText('PUBLIC IN THIS ORG', { exact: true }).count(), 1);
      assert.equal(await h.page.getByRole('button', { name: 'Join', exact: true }).count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('an owner: New space, every space under Yours, never Join', async () => {
    const h = await open('/projects', stub('owner'));
    try {
      await ready(h);
      await h.page.getByRole('button', { name: 'New space' }).waitFor({ timeout: 10_000 });
      assert.equal(await h.page.getByText('PUBLIC IN THIS ORG', { exact: true }).count(), 0);
      assert.equal(await h.page.getByRole('button', { name: 'Join', exact: true }).count(), 0);
      assert.match(await h.page.locator('.screen-page-context').innerText(), /^6 spaces$/);
      assert.ok((await names(h)).includes('Secret'), 'an owner sees a space they never joined');
    } finally {
      await h.close();
    }
  });

  void test('Public narrows to public spaces, and the choice is in the URL', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await ready(h);
      await h.page.locator('.spaces-chip[data-filter="public"]').click();
      await until(async () => (await names(h)).length === 2);
      assert.deepEqual(await names(h), ['Rocket', 'Commons']);
      assert.equal(param(h, 'filter'), 'public');
      await h.page.locator('.spaces-chip[data-filter="yours"]').click();
      await until(async () => (await names(h)).length === 4);
      assert.equal(await h.page.getByText('PUBLIC IN THIS ORG', { exact: true }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('search', () => {
  void test('narrows by name, key or repository, keeps the counts, and lives in the URL', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await ready(h);
      const box = h.page.getByRole('searchbox', { name: 'Search spaces' });
      await box.fill('acme/rocket');
      await until(async () => (await names(h)).length === 1);
      assert.deepEqual(await names(h), ['Rocket']);
      assert.equal(param(h, 'q'), 'acme/rocket');
      assert.match(await h.page.locator('.spaces-chip[data-filter="all"]').innerText(), /5/);

      await box.fill('no such space');
      await h.page.locator('.projects-none').waitFor();
      assert.match(
        await h.page.locator('.projects-none').innerText(),
        /No spaces match “no such space”/,
      );

      await h.page.goto(`${h.origin}/projects?q=laika`);
      await ready(h);
      assert.deepEqual(await names(h), ['Laika']);
      assert.equal(await box.inputValue(), 'laika');
    } finally {
      await h.close();
    }
  });
});

void describe('the grid card', () => {
  void test('every card is one height, whatever its description', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await h.page.setViewportSize({ width: 1440, height: 1000 });
      await ready(h);
      const heights = await cards(h).evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().height)),
      );
      assert.equal(heights.length, 5);
      assert.equal(new Set(heights).size, 1, `card heights differ: ${heights.join(', ')}`);

      // And not by stretching to the tallest: the long one is clamped.
      const desc = h.page.locator('[data-space="longdesc"] .project-card-desc');
      const clamped = await desc.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
      assert.ok(clamped, 'the long description is not clamped');
      const lines = await desc.evaluate(
        (el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight),
      );
      assert.ok(Math.abs(lines - 2) < 0.2, `description shows ${lines.toFixed(2)} lines`);
      assert.equal(
        await h.page.locator('[data-space="bare"] .project-card-desc').innerText(),
        'No description yet.',
      );
    } finally {
      await h.close();
    }
  });

  void test('a card carries the served numbers, colour, key · repo and avatars', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await ready(h);
      const card = h.page.locator('[data-space="laika"]');
      assert.equal(
        await card.locator('.project-card-sub').innerText(),
        'LAIKA-1 · PawanSirsat/Laika',
      );
      assert.equal(await card.locator('.project-chip').innerText(), 'PRIVATE');
      assert.equal(await card.locator('.project-card-updated').innerText(), 'updated 3m ago');
      assert.equal(
        (await card.locator('.space-counts').innerText()).replace(/\s+/g, ' '),
        '358/720 done · 10 active · 38 blocked',
      );
      const [blockedInk, countsInk] = await Promise.all(
        ['.space-blocked', '.space-counts'].map((sel) =>
          card.locator(sel).evaluate((el) => getComputedStyle(el).color),
        ),
      );
      assert.notEqual(blockedInk, countsInk, 'blocked is not drawn in its own colour');
      // The bar draws the same served counts: done is 358 of 720.
      const share = await card
        .locator('.spaces-progress-done')
        .evaluate(
          (el) =>
            el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width,
        );
      assert.ok(Math.abs(share - 358 / 720) < 0.01, `done fills ${share.toFixed(3)} of the bar`);
      assert.equal(await card.locator('.space-avatar').getAttribute('data-color'), 'violet');
      assert.equal(await card.locator('.space-avatar').innerText(), 'L');
      assert.equal(await card.locator('.space-face').count(), 5, 'four faces and a +n');
      assert.equal(await card.locator('.space-face-more').innerText(), '+3');

      assert.equal(
        await h.page.locator('[data-space="bare"] .space-counts').innerText(),
        '0/0 done',
        'nothing active or blocked says nothing about it',
      );
      assert.equal(
        await h.page.locator('[data-space="rocket"] .project-chip').innerText(),
        'PUBLIC',
      );
    } finally {
      await h.close();
    }
  });

  void test('settings shows only where the reader holds project.settings.edit', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await ready(h);
      await h.page.locator('[data-space="laika"] .space-gear').waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page.locator('.space-gear').count(),
        1,
        'a gear on a space they do not lead',
      );
      assert.equal(
        await h.page.locator('[data-space="laika"] .space-gear').getAttribute('href'),
        '/spaces/laika/settings',
      );
      await h.page.locator('[data-space="laika"] .space-gear').click();
      await until(() => new URL(h.page.url()).pathname === '/spaces/laika/settings');
    } finally {
      await h.close();
    }

    const owner = await open('/projects', stub('owner'));
    try {
      await ready(owner);
      await until(async () => (await owner.page.locator('.space-gear').count()) === 6);
    } finally {
      await owner.close();
    }
  });
});

void describe('archived', () => {
  void test('the chip lists archived spaces, muted, with Restore for an owner', async () => {
    const h = await open('/projects?filter=archived', stub('owner'));
    try {
      const card = h.page.locator('[data-space="gone"]');
      await card.waitFor({ timeout: 20_000 });
      assert.deepEqual(await names(h), ['Gone']);
      assert.match((await card.getAttribute('class')) ?? '', /project-card-archived/);
      assert.ok(
        Number(await card.evaluate((el) => getComputedStyle(el).opacity)) < 1,
        'an archived card is not muted',
      );
      await card.getByRole('button', { name: 'Restore' }).click();
      await until(() =>
        h.calls.some((c) => c.method === 'PATCH' && c.path === '/api/v1/projects/gone'),
      );
      const patch = h.calls.find((c) => c.method === 'PATCH' && c.path === '/api/v1/projects/gone');
      assert.deepEqual(patch?.body, { archived: false });
      await h.page.locator('.projects-none').waitFor({ timeout: 10_000 });
      assert.match(await h.page.locator('.spaces-chip[data-filter="archived"]').innerText(), /0/);
      assert.match(await h.page.locator('.spaces-chip[data-filter="all"]').innerText(), /7/);
    } finally {
      await h.close();
    }
  });

  void test('a member sees an archived space they were in, and no Restore', async () => {
    const h = await open('/projects?filter=archived', stub('member'));
    try {
      await h.page.locator('[data-space="gone"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('button', { name: 'Restore' }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the list view', () => {
  void test('the toggle switches to a table, is kept in the URL and survives a reload', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await ready(h);
      await h.page.locator('.spaces-seg-btn[data-view="list"]').click();
      await h.page.locator('.spaces-table').first().waitFor();
      assert.equal(param(h, 'view'), 'list');
      assert.equal(await cards(h).count(), 0);
      await h.page.reload();
      await h.page.locator('.spaces-table').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.spaces-seg-btn[data-view="list"]').getAttribute('aria-pressed'),
        'true',
      );
      const heads = await h.page.locator('.spaces-table').first().locator('th').allInnerTexts();
      assert.deepEqual(
        heads.map((t) => t.trim().toUpperCase()),
        ['SPACE', 'ACCESS', 'PROGRESS', 'BLOCKED', 'MEMBERS', 'UPDATED', 'ACTIONS'],
      );
      // Two sections, two tables; the public one offers Join.
      assert.equal(await h.page.locator('.spaces-table').count(), 2);
      assert.equal(
        await h.page.locator('.spaces-table').nth(1).getByRole('button', { name: 'Join' }).count(),
        1,
      );
    } finally {
      await h.close();
    }
  });

  void test('at 1440 no cell runs into the next — "4 people" stays clear of "2h ago"', async () => {
    const h = await open('/projects?view=list', stub('member'));
    try {
      await h.page.setViewportSize({ width: 1440, height: 1000 });
      await h.page.locator('.space-row').first().waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const report = await h.page.locator('.space-row').evaluateAll((rows) =>
          rows.flatMap((row) => {
            const cells = [...row.querySelectorAll('td')];
            const problems: string[] = [];
            const slug = row.getAttribute('data-space') ?? '?';
            // Every visible piece of text sits inside its own cell.
            for (const cell of cells) {
              const box = cell.getBoundingClientRect();
              for (const el of cell.querySelectorAll('*')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0) continue;
                if (r.right > box.right + 0.5 || r.left < box.left - 0.5) {
                  problems.push(`${slug}: ${el.className} leaves its cell`);
                }
              }
            }
            const people = row.querySelector('.space-cell-people');
            if (people !== null && people.scrollWidth > people.clientWidth) {
              problems.push(`${slug}: "${people.textContent ?? ''}" is cut`);
            }
            return problems;
          }),
        );
        assert.deepEqual(report, [], `${theme}: ${report.join('; ')}`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('fits a phone', () => {
  void test('390 wide, grid and list, light and dark: nothing scrolls sideways', async () => {
    const h = await open('/projects', stub('member'));
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await ready(h);
      for (const view of ['grid', 'list']) {
        for (const theme of ['light', 'dark']) {
          await h.page.goto(`${h.origin}/projects${view === 'list' ? '?view=list' : ''}`);
          await h.page
            .locator(view === 'list' ? '.space-row' : '.project-card')
            .first()
            .waitFor({ timeout: 20_000 });
          await setTheme(h.page, theme);
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(overflow <= 1, `${view} ${theme}: scrolls sideways by ${String(overflow)}px`);
          if (view === 'list') {
            const display = await h.page
              .locator('.space-row td')
              .first()
              .evaluate((el) => getComputedStyle(el).display);
            assert.notEqual(display, 'table-cell', 'the list is not stacked at 390');
          }
        }
      }
    } finally {
      await h.close();
    }
  });
});
