/**
 * The List's empty state and the Filter popover, made readable (LAI-717).
 *
 * The owner's screenshot: "Filter 1" over an empty List, the empty state in
 * the bottom-left of a blank pane, and nothing saying which filter was hiding
 * the work. Every assertion here is one the code before LAI-717 fails — each
 * was run against it — so none of them can be satisfied by the old screen.
 *
 * Driven on `/list` and on `/board`, because the toolbar is one component
 * mounted by one screen for both.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, type ApiStub, type Harness } from './harness.ts';
import { pick } from './dropdown.ts';

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

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-9',
  number: 9,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: Date.now() - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

const LOGIN = task({
  id: 't1',
  key: 'LC-1',
  number: 1,
  title: 'Driver login',
  status: 'in_progress',
  priority: 'p1',
  assignee_id: 'u1',
});
const ROUTES = task({ id: 't2', key: 'LC-2', number: 2, title: 'Route planner', status: 'todo' });
const SHIPPED = task({ id: 't3', key: 'LC-3', number: 3, title: 'Shipped', status: 'backlog' });
const EVERY = [LOGIN, ROUTES, SHIPPED];

const TASKS = '/api/v1/projects/laika-core/tasks';

/*
 * Server-side filters are keyed by query, so a row disappears because the
 * request changed. Matching is by subset (the harness), so `?status=done`
 * also answers a request carrying `priority` or `assignee` beside it.
 * **`status=done` answers nothing**: that is the empty List under test.
 */
const STUB: ApiStub = {
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
        task_counts: { backlog: 1, todo: 1, in_progress: 1, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  [`${TASKS}?limit=200`]: { data: EVERY, next_cursor: null },
  [`${TASKS}?status=done&limit=200`]: { data: [], next_cursor: null },
  [`${TASKS}?status=in_progress&limit=200`]: { data: [LOGIN], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: true, present: [] },
};

void after(async () => {
  await closeBrowser();
});

const rows = (h: Harness) => h.page.locator('.list tbody tr');

const waitForRows = async (h: Harness, count: number): Promise<void> => {
  await h.page.waitForFunction(
    (n: number) => document.querySelectorAll('.list tbody tr').length === n,
    count,
    { timeout: 10_000 },
  );
};

const params = (h: Harness): URLSearchParams => new URL(h.page.url()).searchParams;

const filterButton = (h: Harness) => h.page.getByRole('button', { name: /^Filter/ });

const openFilter = async (h: Harness): Promise<void> => {
  await filterButton(h).click();
  await h.page.locator('.bt-pop').waitFor({ timeout: 5_000 });
};

/** What has focus, as something an assertion message can say. */
const focused = (h: Harness): Promise<string> =>
  h.page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'body';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
    return `${el.tagName.toLowerCase()}.${el.className} "${name}"`;
  });

void describe('the List’s empty state (LAI-717)', () => {
  void test('sits in the middle of the list area, both ways', async () => {
    const h = await open('/list?project=laika-core&status=done', STUB);
    try {
      // Wide enough for `board-rail.css`'s row layout, where the bug lived.
      await h.page.setViewportSize({ width: 1440, height: 900 });
      const headline = h.page.locator('.state-headline', {
        hasText: 'Nothing here for this filter',
      });
      await headline.waitFor({ timeout: 20_000 });

      /*
       * **Against the list area, not the card** (review, B1). The card is the
       * state's own parent, so a card that shrank to its content and pinned
       * left — the original bug, one level up — would centre the state in
       * itself and pass. So: the card must fill the pane, and the state is
       * centred on `.board-main` across and on the card's space above the
       * Create row down.
       */
      const geometry = await h.page.evaluate(() => {
        const main = document.querySelector('.board-main')!.getBoundingClientRect();
        const paneEl = document.querySelector('.list-pane')!;
        const pane = paneEl.getBoundingClientRect();
        const pad = getComputedStyle(paneEl);
        const paneContent = pane.width - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
        const card = document.querySelector('.list-scroll')!.getBoundingClientRect();
        const state = document.querySelector('.state-empty')!;
        const create = document.querySelector('.list-create');
        const floor = create === null ? card.bottom : create.getBoundingClientRect().top;
        const parts = [...state.children].map((el) => el.getBoundingClientRect());
        const top = Math.min(...parts.map((r) => r.top));
        const bottom = Math.max(...parts.map((r) => r.bottom));
        const left = Math.min(...parts.map((r) => r.left));
        const right = Math.max(...parts.map((r) => r.right));
        return {
          mainX: main.left + main.width / 2,
          paneWidth: pane.width,
          mainWidth: main.width,
          paneContent,
          cardWidth: card.width,
          areaY: (card.top + floor) / 2,
          areaHeight: floor - card.top,
          x: (left + right) / 2,
          y: (top + bottom) / 2,
          bottom,
          floor,
          create: create !== null,
        };
      });

      assert.ok(
        geometry.areaHeight > 300,
        `positive control: a tall area (${String(geometry.areaHeight)}px)`,
      );
      assert.ok(
        Math.abs(geometry.paneWidth - geometry.mainWidth) <= 1,
        `the pane does not fill the list area: ${String(geometry.paneWidth)} of ${String(geometry.mainWidth)}px`,
      );
      assert.ok(
        Math.abs(geometry.cardWidth - geometry.paneContent) <= 1,
        `the card does not fill the pane: ${String(geometry.cardWidth)} of ${String(geometry.paneContent)}px`,
      );
      assert.ok(
        Math.abs(geometry.x - geometry.mainX) <= 4,
        `off centre horizontally: content at ${String(Math.round(geometry.x))}, list area centre ${String(Math.round(geometry.mainX))}`,
      );
      assert.ok(
        Math.abs(geometry.y - geometry.areaY) <= 6,
        `off centre vertically: content at ${String(Math.round(geometry.y))}, centre ${String(Math.round(geometry.areaY))}`,
      );
      assert.equal(geometry.create, true, 'the empty List offers no Create row');
      assert.ok(geometry.bottom <= geometry.floor, 'the state runs into the Create row');
    } finally {
      await h.close();
    }
  });

  void test('offers Clear filters, which removes every filter and keeps the project', async () => {
    const h = await open('/list?project=laika-core&status=done&q=ship', STUB);
    try {
      const clear = h.page.getByRole('button', { name: 'Clear filters', exact: true });
      await clear.waitFor({ timeout: 20_000 });
      await clear.click();

      await waitForRows(h, 3);
      const after = params(h);
      assert.equal(after.get('status'), null, 'status survived Clear filters');
      assert.equal(after.get('q'), null, 'search survived Clear filters');
      assert.equal(after.get('project'), 'laika-core', 'the project went with the filters');
    } finally {
      await h.close();
    }
  });
});

void describe('the Filter popover (LAI-717)', () => {
  void test('has a header whose Clear all is disabled until something is set', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await rows(h).first().waitFor({ timeout: 20_000 });
      await openFilter(h);

      const dialog = h.page.getByRole('dialog', { name: 'Filters', exact: true });
      assert.equal(await dialog.count(), 1, 'no dialog named "Filters"');
      const clearAll = dialog.getByRole('button', { name: 'Clear all', exact: true });
      assert.equal(await clearAll.count(), 1, 'the header has no Clear all');
      assert.equal(await clearAll.isDisabled(), true, 'Clear all is live with nothing to clear');

      // The field is the app's dropdown now (LAI-726): chosen as a person does.
      await pick(dialog.getByRole('combobox', { name: 'Status', exact: true }), 'in_progress');
      await waitForRows(h, 1);
      assert.equal(await clearAll.isDisabled(), false, 'Clear all stayed disabled');

      await clearAll.click();
      await waitForRows(h, 3);
      assert.equal(params(h).get('status'), null);
      assert.equal(await clearAll.isDisabled(), true, 'Clear all is live again after clearing');
    } finally {
      await h.close();
    }
  });

  void test('marks a set field, resets it on its own, and lays the selects out two by two', async () => {
    const h = await open('/list?project=laika-core&status=in_progress&priority=p1', STUB);
    try {
      await waitForRows(h, 1);
      await openFilter(h);

      const cell = (label: string) =>
        h.page.locator('.bt-pop .bt-cell', {
          has: h.page.locator('.bt-label', { hasText: label }),
        });

      // A token's computed colour, through a probe element.
      const token = (name: string, property: 'borderTopColor' | 'backgroundColor') =>
        h.page.evaluate(
          ([n, prop]) => {
            const probe = document.createElement('div');
            probe.style.border = `1px solid var(${n})`;
            probe.style.background = `var(${n})`;
            document.body.append(probe);
            const value = getComputedStyle(probe)[prop];
            probe.remove();
            return value;
          },
          [name, property] as const,
        );
      // The field's own control — the dropdown's trigger since LAI-726.
      const style = (label: string) =>
        cell(label)
          .locator('[role="combobox"]')
          .evaluate((el) => {
            const cs = getComputedStyle(el);
            return { border: cs.borderTopColor, background: cs.backgroundColor };
          });

      // Set: the accent on the border. Unset: not.
      const accent = await token('--accent', 'borderTopColor');
      assert.equal((await style('Status')).border, accent, 'a set Status is not marked');
      assert.notEqual((await style('Label')).border, accent, 'an unset Label is marked');

      // **Opaque, set or not** (review): Chrome on Windows and Linux paints
      // the native option list from it, and a translucent tint made that list
      // unreadable in dark mode. The column step, as the owner chose.
      const column = await token('--bg-column', 'backgroundColor');
      assert.equal((await style('Status')).background, column, 'a set select is not opaque');
      assert.equal(
        (await style('Label')).background,
        column,
        'an unset select left the column step',
      );

      // Hovering an unset field must not look like setting it.
      await cell('Label').locator('[role="combobox"]').hover();
      const hovered = (await style('Label')).border;
      assert.notEqual(hovered, accent, 'hover on an unset field reads as set');
      assert.notEqual(
        hovered,
        await token('--accent-border', 'borderTopColor'),
        'hover on an unset field reads as set',
      );

      // One reset per set field, and it clears only its own.
      const resets = h.page.locator('.bt-pop .bt-reset');
      assert.equal(await resets.count(), 2, 'one reset for each of Status and Priority');
      await h.page.getByRole('button', { name: 'Reset Priority', exact: true }).click();
      await h.page.waitForFunction(() => !location.search.includes('priority='), undefined, {
        timeout: 10_000,
      });
      assert.equal(params(h).get('status'), 'in_progress', 'resetting Priority took Status too');

      // Two columns: Status and Priority share a row; Assignee starts the next.
      const top = async (label: string) => (await cell(label).boundingBox())?.y ?? -1;
      assert.equal(
        await top('Status'),
        await top('Priority'),
        'Status and Priority are not side by side',
      );
      assert.ok((await top('Assignee')) > (await top('Status')), 'Assignee is not on the next row');
    } finally {
      await h.close();
    }
  });

  void test('the yes/no options are one Quick filters group of pill toggles', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await rows(h).first().waitFor({ timeout: 20_000 });
      await openFilter(h);

      const group = h.page.getByRole('group', { name: 'Quick filters', exact: true });
      assert.equal(await group.count(), 1, 'no Quick filters group');
      const names = await group
        .getByRole('checkbox')
        .evaluateAll((boxes) => boxes.map((b) => b.closest('label')?.textContent?.trim() ?? ''));
      assert.deepEqual(names, [
        'Ready only',
        'Blocked only',
        'Top-level only',
        'Overdue',
        'Agent-created only',
      ]);

      // A click anywhere on the pill is the checkbox's click.
      const pill = group.locator('.bt-toggle', { hasText: 'Ready only' });
      const box = await pill.boundingBox();
      assert.ok(box !== null && box.height < 40, 'positive control: a compact pill');
      await h.page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
      await h.page.waitForURL(/ready=true/, { timeout: 10_000 });
      assert.match(
        (await pill.getAttribute('class')) ?? '',
        /bt-toggle-on/,
        'the pill is not drawn on',
      );
      assert.equal(await group.getByRole('checkbox', { name: 'Ready only' }).isChecked(), true);
    } finally {
      await h.close();
    }
  });

  void test('the Quick filters heading sits under the divider, not on it', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await rows(h).first().waitFor({ timeout: 20_000 });
      await openFilter(h);
      const g = await h.page.locator('.bt-quick').evaluate((set) => {
        const legend = set.querySelector('legend')!.getBoundingClientRect();
        const box = set.getBoundingClientRect();
        return {
          legendTop: legend.top,
          borderBottom: box.top + parseFloat(getComputedStyle(set).borderTopWidth),
        };
      });
      assert.ok(
        g.legendTop >= g.borderBottom,
        `the legend is drawn over the divider: legend top ${String(g.legendTop)}, divider ${String(g.borderBottom)}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('`ready=false` from a link shows as an on "Not ready" pill, and one click clears it', async () => {
    const h = await open('/list?project=laika-core&ready=false', STUB);
    try {
      await rows(h).first().waitFor({ timeout: 20_000 });
      await openFilter(h);
      const pill = h.page.locator('.bt-pop .bt-toggle').first();
      assert.equal((await pill.innerText()).trim(), 'Not ready');
      assert.match(
        (await pill.getAttribute('class')) ?? '',
        /bt-toggle-on/,
        'Not ready is not drawn on',
      );
      // From the keyboard: the label changes under the focused input, and the
      // input must survive it (review, round 2) — a remount drops focus.
      await pill.locator('input').focus();
      await h.page.keyboard.press('Space');
      await h.page.waitForFunction(() => !location.search.includes('ready='), undefined, {
        timeout: 10_000,
      });
      assert.equal((await pill.innerText()).trim(), 'Ready only');
      assert.equal(
        await pill.locator('input').evaluate((el) => el === document.activeElement),
        true,
        `toggling Not ready from the keyboard left focus on ${await focused(h)}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('slides back inside a window that narrows while it is open', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await rows(h).first().waitFor({ timeout: 20_000 });
      await openFilter(h);
      await h.page.setViewportSize({ width: 420, height: 800 });
      // Settled when it fits, or the timeout says it never did.
      await h.page
        .waitForFunction(
          () =>
            (document.querySelector('.bt-pop')?.getBoundingClientRect().right ?? 1e9) <= innerWidth,
          undefined,
          { timeout: 5_000 },
        )
        .catch(() => undefined);
      const r = await h.page.locator('.bt-pop').evaluate((pop) => {
        const b = pop.getBoundingClientRect();
        return { left: b.left, right: b.right, slide: pop.style.translate };
      });
      assert.ok(r.left >= 0, `slid off the left edge: ${String(r.left)} (${r.slide})`);
      assert.ok(r.right <= 420, `still overhangs the narrowed window: ${String(r.right)}`);
    } finally {
      await h.close();
    }
  });
});

/*
 * **On both screens that carry the toolbar** (review, should-fix 2). On the
 * Board it sits lower — under the sprint strip and WORKING NOW — so a fit
 * measured on the List says nothing about it.
 */
const DAY = 86_400_000;
/** The Board as LAI-713 opens it: an active sprint, so the strip is populated. */
const ACTIVE: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/sprints': {
    data: [
      {
        id: 's1',
        project_id: 'laika-core',
        name: 'Foundations',
        goal: null,
        status: 'active',
        starts_on: Date.now() - 3 * DAY,
        ends_on: Date.now() + 10 * DAY,
        created_at: 1,
        updated_at: 1,
      },
    ],
    next_cursor: null,
  },
};
const SCREENS = [
  { name: 'List', path: '/list?project=laika-core', ready: '.list tbody tr', stub: STUB },
  { name: 'Board', path: '/board?project=laika-core', ready: '.card', stub: STUB },
  {
    // The populated sprint strip sits above the toolbar (review, round 2).
    // Ready once its chip is drawn, not once `.strip` exists: the strip mounts
    // before its sprints arrive, and measuring then measured the short Board
    // (LAI-717 round 2, carried by LAI-726).
    name: 'Board with an active sprint',
    path: '/board?project=laika-core',
    ready: '.strip .strip-chip',
    stub: ACTIVE,
  },
] as const;

for (const screen of SCREENS) {
  void describe(`the Filter popover on the ${screen.name} (LAI-717)`, () => {
    void test('fits a 1366×768 laptop screen without scrolling', async () => {
      const h = await open(screen.path, screen.stub);
      try {
        await h.page.setViewportSize({ width: 1366, height: 768 });
        await h.page.locator(screen.ready).first().waitFor({ timeout: 20_000 });
        if (screen.stub === ACTIVE) {
          // …and the Board has opened itself on that sprint (LAI-713).
          await h.page.waitForFunction(() => location.search.includes('sprint=s1'), undefined, {
            timeout: 10_000,
          });
        }
        await openFilter(h);
        const fit = await h.page.locator('.bt-pop').evaluate((pop) => {
          const r = pop.getBoundingClientRect();
          return {
            bottom: r.bottom,
            right: r.right,
            left: r.left,
            scrolls: pop.scrollHeight > pop.clientHeight,
            grid: document.querySelector('.bt-pop .bt-grid') !== null,
          };
        });
        assert.equal(fit.grid, true, 'positive control: the two-column grid is drawn');
        assert.ok(fit.bottom <= 768, `runs off the bottom at ${String(fit.bottom)}px`);
        assert.ok(
          fit.left >= 0 && fit.right <= 1366,
          `runs off the side: ${String(fit.left)}–${String(fit.right)}`,
        );
        assert.equal(fit.scrolls, false, 'the popover scrolls inside itself');
      } finally {
        await h.close();
      }
    });

    void test('Escape closes it; focus goes in on open and back to Filter on close', async () => {
      const h = await open(screen.path, screen.stub);
      try {
        await h.page.locator(screen.ready).first().waitFor({ timeout: 20_000 });

        // Opened from the keyboard, as a keyboard reader would.
        await filterButton(h).focus();
        await h.page.keyboard.press('Enter');
        await h.page.locator('.bt-pop').waitFor({ timeout: 5_000 });
        assert.equal(
          await h.page.evaluate(() =>
            document.querySelector('.bt-pop')?.contains(document.activeElement),
          ),
          true,
          `focus stayed outside the popover: ${await focused(h)}`,
        );

        // Move within it, so "back to Filter" cannot be focus that never left.
        await h.page.keyboard.press('Tab');
        await h.page.keyboard.press('Escape');
        await h.page.locator('.bt-pop').waitFor({ state: 'detached', timeout: 5_000 });
        assert.equal(
          await filterButton(h).evaluate((b) => b === document.activeElement),
          true,
          `focus did not return to Filter: ${await focused(h)}`,
        );

        // A click outside closes it too, and focus comes back the same way.
        await openFilter(h);
        await h.page.mouse.click(1000, 700);
        await h.page.locator('.bt-pop').waitFor({ state: 'detached', timeout: 5_000 });
        assert.equal(
          await filterButton(h).evaluate((b) => b === document.activeElement),
          true,
          `a click outside left focus on ${await focused(h)}`,
        );
      } finally {
        await h.close();
      }
    });

    /*
     * **Focus never falls to `<body>`** when the control that had it removes
     * itself (review, should-fix 1). Each step names where it must land.
     */
    // The chip-by-chip walk counts three chips; the active sprint adds a
    // fourth, so it runs on the two screens without one.
    if (screen.stub === ACTIVE) return;

    void test('a reset or a removed chip hands focus on, never to <body>', async () => {
      const h = await open(
        `${screen.path}&status=in_progress&priority=p1&assignee=u1`,
        screen.stub,
      );
      try {
        await h.page.locator(screen.ready).first().waitFor({ timeout: 20_000 });
        // A field's reset → that field's control.
        await openFilter(h);
        await h.page.getByRole('button', { name: 'Reset Priority', exact: true }).click();
        await h.page.waitForFunction(() => !location.search.includes('priority='), undefined, {
          timeout: 10_000,
        });
        assert.equal(
          await h.page
            .locator('.bt-pop .bt-cell', {
              has: h.page.locator('.bt-label', { hasText: 'Priority' }),
            })
            .locator('[role="combobox"]')
            .evaluate((el) => el === document.activeElement),
          true,
          `Reset Priority left focus on ${await focused(h)}`,
        );
        await h.page.keyboard.press('Escape');

        // Chips now: Status, Assignee. Put Priority back for three.
        await h.page.goto(`${h.origin}${screen.path}&status=in_progress&priority=p1&assignee=u1`);
        const chips = h.page.locator('.bt-chips .bt-chip');
        await chips.nth(2).waitFor({ timeout: 10_000 });

        // The middle one → the next.
        await chips.filter({ hasText: 'Priority' }).click();
        await h.page.waitForFunction(() => document.querySelectorAll('.bt-chip').length === 2);
        assert.equal(
          await chips
            .filter({ hasText: 'Assignee' })
            .evaluate((el) => el === document.activeElement),
          true,
          `the middle chip's × left focus on ${await focused(h)}`,
        );

        // The last one → the one before.
        await chips.filter({ hasText: 'Assignee' }).click();
        await h.page.waitForFunction(() => document.querySelectorAll('.bt-chip').length === 1);
        assert.equal(
          await chips.filter({ hasText: 'Status' }).evaluate((el) => el === document.activeElement),
          true,
          `the last chip's × left focus on ${await focused(h)}`,
        );

        // The only one → the Filter button.
        await chips.filter({ hasText: 'Status' }).click();
        await h.page.waitForFunction(() => document.querySelectorAll('.bt-chip').length === 0);
        assert.equal(
          await filterButton(h).evaluate((b) => b === document.activeElement),
          true,
          `the only chip's × left focus on ${await focused(h)}`,
        );

        // The row's Clear all → the Filter button.
        await h.page.goto(`${h.origin}${screen.path}&status=in_progress&priority=p1`);
        await chips.first().waitFor({ timeout: 10_000 });
        await h.page.locator('.bt-chips-clear').click();
        await h.page.waitForFunction(() => document.querySelectorAll('.bt-chip').length === 0);
        assert.equal(
          await filterButton(h).evaluate((b) => b === document.activeElement),
          true,
          `the chips' Clear all left focus on ${await focused(h)}`,
        );
      } finally {
        await h.close();
      }
    });
  });
}

void describe('the empty List’s Clear filters (LAI-717)', () => {
  void test('hands focus to the Filter button, not <body>', async () => {
    const h = await open('/list?project=laika-core&status=done', STUB);
    try {
      const clear = h.page.getByRole('button', { name: 'Clear filters', exact: true });
      await clear.waitFor({ timeout: 20_000 });
      await clear.click();
      await waitForRows(h, 3);
      assert.equal(
        await filterButton(h).evaluate((b) => b === document.activeElement),
        true,
        `Clear filters left focus on ${await focused(h)}`,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Tab order in the Filter popover (LAI-717)', () => {
  void test('every control is reached by Tab and has a name', async () => {
    const h = await open('/list?project=laika-core&status=in_progress', STUB);
    try {
      await waitForRows(h, 1);
      await openFilter(h);

      const expected = await h.page
        .locator('.bt-pop')
        .evaluate(
          (pop) =>
            [...pop.querySelectorAll('[role="combobox"], input, button')].filter(
              (el) => !(el as HTMLButtonElement).disabled,
            ).length,
        );
      // 6 dropdowns, 5 toggles, Clear all and Status's reset.
      assert.equal(expected, 13, 'positive control: the controls are all there');

      const reached: string[] = [];
      for (let i = 0; i < 30; i += 1) {
        const step = await h.page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (el === null || !document.querySelector('.bt-pop')?.contains(el)) return null;
          // The name, by the route each control here gets one: a dropdown or a
          // checkbox from its <label> (the field's own words, not its options),
          // a button from its text.
          const label = (el as HTMLInputElement).labels?.[0];
          const name =
            label === undefined
              ? (el.getAttribute('aria-label') ?? el.textContent ?? '')
              : (label.querySelector('.bt-label')?.textContent ?? label.textContent ?? '');
          return `${el.tagName.toLowerCase()}|${name.trim()}`;
        });
        if (step === null) break;
        if (!reached.includes(step)) reached.push(step);
        await h.page.keyboard.press('Tab');
      }
      // Backwards from the first field reaches the header's Clear all.
      await h.page.locator('.bt-pop [role="combobox"]').first().focus();
      await h.page.keyboard.press('Shift+Tab');
      const before = await focused(h);
      assert.equal(
        await h.page.evaluate(() => {
          const el = document.activeElement;
          return (
            el !== null &&
            document.querySelector('.bt-pop')?.contains(el) === true &&
            el.tagName === 'BUTTON' &&
            el.textContent.trim() === 'Clear all'
          );
        }),
        true,
        `Shift+Tab from the first field landed on ${before}, not the popover's Clear all`,
      );

      assert.equal(
        reached.length + 1,
        expected,
        `Tab reached: ${reached.join(' / ')} and ${before}`,
      );
      for (const step of reached) {
        assert.notEqual(step.split('|')[1], '', `a control with no name: ${step}`);
      }
      assert.ok(
        reached.some((s) => s === 'button|Reset Status'),
        reached.join(' / '),
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the active-filter chips (LAI-717)', () => {
  void test('one per filter, named; removing one removes only that filter', async () => {
    const h = await open(
      '/list?project=laika-core&status=in_progress&priority=p1&assignee=u1',
      STUB,
    );
    try {
      await waitForRows(h, 1);
      const chips = h.page.getByRole('group', { name: 'Active filters' }).locator('.bt-chip');
      await chips.first().waitFor({ timeout: 10_000 });
      const labels = (await chips.locator('.bt-chip-text').allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(labels, ['Status: In progress', 'Priority: P1', 'Assignee: Ada Lovelace']);

      await chips.filter({ hasText: 'Priority: P1' }).click();
      await h.page.waitForFunction(() => !location.search.includes('priority='), undefined, {
        timeout: 10_000,
      });
      const after = params(h);
      assert.equal(after.get('status'), 'in_progress', 'removing Priority took Status');
      assert.equal(after.get('assignee'), 'u1', 'removing Priority took Assignee');
      assert.equal(await chips.count(), 2);

      // Clear all, from the row.
      await h.page
        .getByRole('group', { name: 'Active filters' })
        .getByRole('button', { name: 'Clear all' })
        .click();
      await waitForRows(h, 3);
      assert.equal(await h.page.locator('.bt-chips').count(), 0, 'the row outlived its filters');
      assert.equal(params(h).get('project'), 'laika-core');
    } finally {
      await h.close();
    }
  });

  void test('are hidden while the popover is open, without moving the table', async () => {
    const h = await open('/list?project=laika-core&status=in_progress', STUB);
    try {
      await waitForRows(h, 1);
      const chipRow = h.page.locator('.bt-chips');
      await chipRow.waitFor({ timeout: 10_000 });
      const tableTop = async () => (await h.page.locator('table.list').boundingBox())?.y ?? -1;
      const closedTop = await tableTop();

      await openFilter(h);
      assert.equal(await chipRow.isVisible(), false, 'the chips show through the open popover');
      assert.equal(await tableTop(), closedTop, 'the table moved when the popover opened');

      await h.page.keyboard.press('Escape');
      assert.equal(await chipRow.isVisible(), true);
    } finally {
      await h.close();
    }
  });

  void test('the Board carries the same row, in both themes, on the accent tokens', async () => {
    const h = await open('/board?project=laika-core&priority=p1', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      const chip = h.page.locator('.bt-chip', { hasText: 'Priority: P1' });
      await chip.waitFor({ timeout: 10_000 });

      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const [chipBg, tokenBg] = await chip.evaluate((el) => {
          const probe = document.createElement('div');
          probe.style.background = 'var(--accent-bg)';
          document.body.append(probe);
          const token = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return [getComputedStyle(el).backgroundColor, token];
        });
        assert.equal(chipBg, tokenBg, `${theme}: the chip is not on --accent-bg`);
      }

      await chip.click();
      await h.page.waitForFunction(() => !location.search.includes('priority='), undefined, {
        timeout: 10_000,
      });
      assert.equal(await h.page.locator('.bt-chips').count(), 0);
    } finally {
      await h.close();
    }
  });

  /*
   * **The Board with an active sprint** (review, should-fix 3). LAI-713 opens
   * it on `?sprint=<active>`, so the chip row always has a Sprint chip there,
   * and its × is the one removal that does not delete its key: no `?sprint=`
   * means "open on the active sprint" on re-entry, so "every sprint" is
   * `sprint=all` — what the popover's "Any" writes.
   */
  void test('on the Board an active sprint is a named chip, and its × writes sprint=all', async () => {
    const h = await open('/board?project=laika-core', ACTIVE);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(() => location.search.includes('sprint=s1'), undefined, {
        timeout: 10_000,
      });
      const chip = h.page.locator('.bt-chip', { hasText: 'Sprint: S1 · Foundations' });
      await chip.waitFor({ timeout: 10_000 });
      assert.equal(
        (await h.page.locator('.bt-badge').innerText()).trim(),
        '1',
        'the chip and the badge disagree',
      );

      await chip.click();
      await h.page.waitForFunction(() => location.search.includes('sprint=all'), undefined, {
        timeout: 10_000,
      });
      assert.equal(params(h).get('sprint'), 'all');
      assert.equal(await h.page.locator('.bt-chips').count(), 0, 'every sprint is still a chip');
    } finally {
      await h.close();
    }
  });
});
