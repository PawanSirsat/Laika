/**
 * The board's members popover and a Spaces popover that scrolls (LAI-1146).
 *
 * The owner, from production screenshots of a space with twelve members and a
 * workspace with many spaces: the member stack's `+8` did nothing, and the
 * Spaces popover ran off the bottom of the window with a list that would not
 * scroll.
 *
 * What only a browser can show: that the `+N` opens a list of **every**
 * member (not the four faces), that a row writes the same `?assignee=` the
 * faces do — so the *Filtered by* chip appears — and that the Spaces list is
 * its own scroll container, reaching its last row, inside the window in both
 * themes and at a phone's width.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';

const project = (i: number) => {
  const n = String(i).padStart(2, '0');
  return {
    // ULIDs sort by creation; the first three are the rail's recent ones.
    id: `01P${n}`,
    slug: `space-${n}`,
    prefix: `S${n}`,
    name: `Space ${n}`,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
    task_counts: { backlog: i, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
    blocked_count: 0,
    member_count: 2,
    members: [],
    last_activity_at: 2,
  };
};

const PROJECTS = Array.from({ length: 30 }, (_, i) => project(i + 1));
const HOME = PROJECTS[0]!;

const MEMBERS = [
  ['u1', 'Ada Lovelace', 'ada@example.com', 'lead'],
  ['u2', 'Grace Hopper', 'grace@example.com', 'member'],
  ['u3', 'Tomas Nel', 'tomas@example.com', 'member'],
  ['u4', 'Priya Raman', 'priya@example.com', 'member'],
  ['u5', 'Kenji Sato', 'kenji@example.com', 'member'],
  ['u6', 'Lena Fischer', 'lena@example.com', 'member'],
  ['u7', 'Mosa Dlamini', 'mosa@example.com', 'viewer'],
] as const;

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: HOME.slug, role: 'lead' }],
  },
  '/api/v1/projects': { data: PROJECTS, next_cursor: null },
  [`/api/v1/projects/${HOME.slug}`]: HOME,
  [`/api/v1/projects/${HOME.slug}/tasks`]: { data: [], next_cursor: null },
  [`/api/v1/projects/${HOME.slug}/sprints`]: { data: [], next_cursor: null },
  [`/api/v1/projects/${HOME.slug}/members`]: {
    members: MEMBERS.map(([user_id, name, email, role]) => ({
      user_id,
      name,
      email,
      role,
      created_at: 1,
    })),
  },
  [`/api/v1/projects/${HOME.slug}/mentionable`]: { users: [] },
  [`/api/v1/projects/${HOME.slug}/activity`]: { data: [], next_cursor: null },
  [`/api/v1/projects/${HOME.slug}/tags`]: { tags: [] },
  [`/api/v1/projects/${HOME.slug}/meeting-reviews`]: { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the member stack’s +N (LAI-1146)', () => {
  void test('opens every member; search narrows; Escape closes and returns focus', async () => {
    const h = await open(`/board?project=${HOME.slug}`, STUB);
    try {
      const more = h.page.locator('button.bt-member-more');
      await more.waitFor({ timeout: 20_000 });
      assert.equal((await more.innerText()).split('\n')[0]?.trim(), '+3');
      assert.equal(await more.getAttribute('aria-expanded'), 'false');

      await more.click();
      const pop = h.page.getByRole('dialog', { name: 'Members' });
      await pop.waitFor({ timeout: 5000 });
      assert.equal(await more.getAttribute('aria-expanded'), 'true');

      // Every member, not the four faces — with name and role.
      const names = await pop.locator('.bt-mp-name').allInnerTexts();
      assert.deepEqual(
        names,
        MEMBERS.map((m) => m[1]),
      );
      assert.match(
        await pop.locator('.bt-mp-row').last().innerText(),
        /Mosa Dlamini[\s\S]*viewer/i,
      );

      // Focus lands in the search; it filters by name or email, any case.
      const search = pop.getByRole('textbox', { name: 'Search members' });
      assert.equal(await search.evaluate((el) => el === document.activeElement), true);
      await search.fill('PRIYA');
      assert.deepEqual(await pop.locator('.bt-mp-name').allInnerTexts(), ['Priya Raman']);
      await search.fill('kenji@');
      assert.deepEqual(await pop.locator('.bt-mp-name').allInnerTexts(), ['Kenji Sato']);
      await search.fill('nobody');
      assert.match(await pop.innerText(), /No member matches “nobody”/);
      await search.fill('');

      // The keyboard walks from the search into the rows.
      await h.page.keyboard.press('ArrowDown');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent ?? ''),
        await pop.locator('.bt-mp-row').first().textContent(),
      );

      await h.page.keyboard.press('Escape');
      await until(async () => (await pop.count()) === 0);
      assert.equal(
        await more.evaluate((el) => el === document.activeElement),
        true,
        'focus did not return to the +N',
      );

      // A click outside closes it too.
      await more.click();
      await pop.waitFor({ timeout: 5000 });
      await h.page.mouse.click(700, 600);
      await until(async () => (await pop.count()) === 0);
    } finally {
      await h.close();
    }
  });

  void test('a row applies the assignee filter the faces use, with its chip', async () => {
    const h = await open(`/board?project=${HOME.slug}`, STUB);
    try {
      const more = h.page.locator('button.bt-member-more');
      await more.waitFor({ timeout: 20_000 });
      await more.click();
      const pop = h.page.getByRole('dialog', { name: 'Members' });
      await pop.locator('.bt-mp-row', { hasText: 'Mosa Dlamini' }).click();

      await h.page.waitForURL(/assignee=u7/, { timeout: 5000 });
      await until(async () => (await pop.count()) === 0);
      const chips = h.page.locator('.bt-chips');
      await chips.waitFor({ timeout: 5000 });
      assert.match(await chips.innerText(), /Mosa Dlamini/);

      // Reopened, the filtered person reads as pressed; clicking clears it.
      await more.click();
      const row = pop.locator('.bt-mp-row', { hasText: 'Mosa Dlamini' });
      assert.equal(await row.getAttribute('aria-pressed'), 'true');
      await row.click();
      await until(() => !h.page.url().includes('assignee='));
    } finally {
      await h.close();
    }
  });
});

void describe('the Spaces popover scrolls (LAI-1146)', () => {
  for (const theme of ['Light', 'Dark']) {
    void test(`${theme}: 30 spaces — the list scrolls to its last row, inside the window`, async () => {
      const h = await open(`/board?project=${HOME.slug}`, STUB, {
        before: async (page) => page.setViewportSize({ width: 1280, height: 720 }),
      });
      try {
        const moreSpaces = h.page.locator('.sidebar-link-button', { hasText: 'More spaces' });
        await moreSpaces.waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        await moreSpaces.click();
        const pop = h.page.locator('.spaces-pop');
        await pop.waitFor({ timeout: 5000 });
        const list = pop.locator('.spaces-pop-list');
        await until(async () => (await list.locator('.spaces-pop-row').count()) >= 27);

        const m = await list.evaluate((el) => ({
          scroll: el.scrollHeight,
          client: el.clientHeight,
          overflow: getComputedStyle(el).overflowY,
          contain: getComputedStyle(el).overscrollBehaviorY,
        }));
        assert.ok(m.scroll > m.client, `the list does not overflow: ${JSON.stringify(m)}`);
        assert.equal(m.overflow, 'auto');
        assert.equal(m.contain, 'contain');

        // The panel stays inside the window, head and search included.
        const box = await pop.boundingBox();
        assert.ok(
          box !== null && box.y + box.height <= 720,
          `panel runs off: ${JSON.stringify(box)}`,
        );

        // One height for every row.
        const heights = new Set(
          await list
            .locator('.spaces-pop-row')
            .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height))),
        );
        assert.equal(heights.size, 1, `rows of ${[...heights].join(', ')}px`);

        // Scrolled to the end, the last row is visible inside the list.
        await list.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        const last = list.locator('.spaces-pop-row').last();
        const lastName = (await list.locator('.spaces-pop-name').allInnerTexts()).at(-1);
        const [lastBox, listBox] = await Promise.all([last.boundingBox(), list.boundingBox()]);
        assert.ok(lastBox !== null && listBox !== null);
        assert.ok(
          lastBox.y + lastBox.height <= listBox.y + listBox.height + 1,
          'the last row is not reachable',
        );
        assert.ok(lastName !== undefined && (await last.innerText()).includes(lastName));
        // The search stays put while the list scrolls.
        assert.ok(await pop.locator('.spaces-pop-search input').isVisible());
      } finally {
        await h.close();
      }
    });
  }

  void test('at 390px the panel fits the phone and still scrolls', async () => {
    const h = await open(`/board?project=${HOME.slug}`, STUB, {
      before: async (page) => page.setViewportSize({ width: 390, height: 844 }),
    });
    try {
      const toggle = h.page.locator('.shell-navtoggle');
      await toggle.waitFor({ timeout: 20_000 });
      await toggle.click();
      const moreSpaces = h.page.locator('.sidebar-link-button', { hasText: 'More spaces' });
      await moreSpaces.click();
      const pop = h.page.locator('.spaces-pop');
      await pop.waitFor({ timeout: 5000 });
      const box = await pop.boundingBox();
      assert.ok(box !== null);
      assert.ok(box.x >= 0 && box.x + box.width <= 390, `overhangs: ${JSON.stringify(box)}`);
      assert.ok(box.y + box.height <= 844, `runs off the bottom: ${JSON.stringify(box)}`);
      const list = pop.locator('.spaces-pop-list');
      await until(async () => (await list.locator('.spaces-pop-row').count()) >= 27);
      assert.ok(await list.evaluate((el) => el.scrollHeight > el.clientHeight));
    } finally {
      await h.close();
    }
  });
});
