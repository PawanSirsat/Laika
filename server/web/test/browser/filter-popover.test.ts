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
      const headline = h.page.locator('.state-headline', {
        hasText: 'Nothing here for this filter',
      });
      await headline.waitFor({ timeout: 20_000 });

      // The space the state has: its parent, down to the Create row when there
      // is one. Measured against the block of the state's own content — icon
      // to last line — rather than its box, which can stretch.
      const geometry = await h.page.evaluate(() => {
        const state = document.querySelector('.state-empty')!;
        const area = state.parentElement!.getBoundingClientRect();
        const create = state.parentElement!.querySelector('.list-create');
        const floor = create === null ? area.bottom : create.getBoundingClientRect().top;
        const parts = [...state.children].map((el) => el.getBoundingClientRect());
        const top = Math.min(...parts.map((r) => r.top));
        const bottom = Math.max(...parts.map((r) => r.bottom));
        const left = Math.min(...parts.map((r) => r.left));
        const right = Math.max(...parts.map((r) => r.right));
        return {
          areaX: area.left + area.width / 2,
          areaY: (area.top + floor) / 2,
          areaHeight: floor - area.top,
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
        Math.abs(geometry.x - geometry.areaX) <= 4,
        `off centre horizontally: content at ${String(Math.round(geometry.x))}, centre ${String(Math.round(geometry.areaX))}`,
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

      await dialog.getByRole('combobox', { name: 'Status' }).selectOption('in_progress');
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

      // Set: the accent token on the select. Unset: not.
      const accentBorder = await h.page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.borderColor = 'var(--accent-border)';
        probe.style.borderStyle = 'solid';
        document.body.append(probe);
        const value = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return value;
      });
      const borderOf = (label: string) =>
        cell(label)
          .locator('select')
          .evaluate((el) => getComputedStyle(el).borderTopColor);
      assert.equal(await borderOf('Status'), accentBorder, 'a set Status is not marked');
      assert.notEqual(await borderOf('Label'), accentBorder, 'an unset Label is marked');

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

  void test('fits a 1366×768 laptop screen without scrolling', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await rows(h).first().waitFor({ timeout: 20_000 });
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
    const h = await open('/list?project=laika-core', STUB);
    try {
      await rows(h).first().waitFor({ timeout: 20_000 });

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

  void test('every control is reached by Tab and has a name', async () => {
    const h = await open('/list?project=laika-core&status=in_progress', STUB);
    try {
      await waitForRows(h, 1);
      await openFilter(h);

      const expected = await h.page
        .locator('.bt-pop')
        .evaluate(
          (pop) =>
            [...pop.querySelectorAll('select, input, button')].filter(
              (el) => !(el as HTMLButtonElement).disabled,
            ).length,
        );
      // 6 selects, 5 toggles, Clear all and Status's reset.
      assert.equal(expected, 13, 'positive control: the controls are all there');

      const reached: string[] = [];
      for (let i = 0; i < 30; i += 1) {
        const step = await h.page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (el === null || !document.querySelector('.bt-pop')?.contains(el)) return null;
          // The name, by the route each control here gets one: a select or a
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
      // Backwards from the first field reaches the header.
      await h.page.locator('.bt-pop select').first().focus();
      await h.page.keyboard.press('Shift+Tab');
      const before = await focused(h);

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
});
