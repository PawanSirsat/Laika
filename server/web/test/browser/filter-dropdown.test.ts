/**
 * The Filter popover's six fields as the app's own dropdown (LAI-726).
 *
 * The owner's screenshot: the Label select opened the OS's grey menu, about 35
 * entries tall, past the popover and off the screen. Every test here drives
 * the custom control a person would — click, keys, search — and none can be
 * satisfied by a native `<select>`: there is no `role="listbox"` panel, no
 * search box and no `aria-activedescendant` on one. Each was run against the
 * code before LAI-726 and failed (the log records how).
 *
 * Driven on `/list` and `/board`: the toolbar is one component mounted by one
 * screen for both, and the Board's sits lower, under the sprint strip.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator } from 'playwright';
import { closeBrowser, open, setTheme, type ApiStub, type Harness } from './harness.ts';
import { pick, valueOf } from './dropdown.ts';

const DAY = 86_400_000;

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

/** About the owner's 35, alphabetical as the popover sorts them. */
const TAGS = [
  'ai',
  'ai-p1',
  'analytics',
  'api',
  'auth',
  'backend',
  'billing',
  'board',
  'bug',
  'cache',
  'chore',
  'ci',
  'design',
  'docs',
  'driver-app',
  'eta',
  'frontend',
  'geofence',
  'infra',
  'invoicing',
  'maps',
  'mobile',
  'notifications',
  'onboarding',
  'payments',
  'perf',
  'policy',
  'reports',
  'routing',
  'search',
  'security',
  'tracking',
  'ui',
  'ux',
  'warehouse',
];

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

// Seven tasks carrying five tags each: the labels the popover offers are the
// ones in use, so this is how the list reaches 35.
const TASK_LIST = Array.from({ length: 7 }, (_, i) =>
  task({
    id: `t${String(i + 1)}`,
    key: `LC-${String(i + 1)}`,
    number: i + 1,
    title: `Task ${String(i + 1)}`,
    status: ['backlog', 'todo', 'in_progress', 'review', 'done', 'todo', 'backlog'][i],
    tags: TAGS.slice(i * 5, i * 5 + 5),
  }),
);

const PEOPLE = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Linus Pauling',
  'Margaret Hamilton',
  'Edsger Dijkstra',
].map((name, i) => ({
  user_id: `u${String(i + 1)}`,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  role: i === 0 ? 'lead' : 'member',
  created_at: 1,
}));

const sprint = (n: number, status: string, start: number) => ({
  id: `s${String(n)}`,
  project_id: 'laika-core',
  name: ['Foundations', 'Routing', 'Billing', 'Tracking', 'Polish', 'Launch', 'Hardening'][n - 1],
  goal: null,
  status,
  starts_on: Date.now() + start * DAY,
  ends_on: Date.now() + (start + 13) * DAY,
  created_at: 1,
  updated_at: 1,
});

const TASKS = '/api/v1/projects/laika-core/tasks';

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: 2, todo: 2, in_progress: 1, review: 1, done: 1, cancelled: 0 },
        blocked_count: 0,
        member_count: PEOPLE.length,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  [`${TASKS}?limit=200`]: { data: TASK_LIST, next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: PEOPLE },
  // No sprint active, so the Board does not open itself on one (LAI-713) and
  // every field starts at "Any".
  '/api/v1/projects/laika-core/sprints': {
    data: [
      sprint(1, 'completed', -40),
      sprint(2, 'completed', -26),
      sprint(3, 'planned', 2),
      sprint(4, 'planned', 16),
      sprint(5, 'planned', 30),
      sprint(6, 'planned', 44),
      sprint(7, 'planned', 58),
    ],
    next_cursor: null,
  },
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

/** The same, with sprint 3 running: marked "Active" in the list. */
const WITH_ACTIVE: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/sprints': {
    data: [
      sprint(1, 'completed', -40),
      sprint(2, 'completed', -26),
      sprint(3, 'active', -3),
      sprint(4, 'planned', 16),
      sprint(5, 'planned', 30),
      sprint(6, 'planned', 44),
      sprint(7, 'planned', 58),
    ],
    next_cursor: null,
  },
};

void after(async () => {
  await closeBrowser();
});

const SCREENS = [
  { name: 'List', path: '/list?project=laika-core', ready: '.list tbody tr' },
  { name: 'Board', path: '/board?project=laika-core', ready: '.card' },
] as const;

const params = (h: Harness): URLSearchParams => new URL(h.page.url()).searchParams;

const openFilter = async (h: Harness): Promise<void> => {
  await h.page.getByRole('button', { name: /^Filter/ }).click();
  await h.page.locator('.bt-pop').waitFor({ timeout: 5_000 });
};

const field = (h: Harness, name: string): Locator =>
  h.page.locator('.bt-pop').getByRole('combobox', { name, exact: true });

const panel = (h: Harness) => h.page.locator('[data-dropdown-panel]');

/** What has focus, as something an assertion message can say. */
const focused = (h: Harness): Promise<string> =>
  h.page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'body';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
    return `${el.tagName.toLowerCase()}[role=${el.getAttribute('role') ?? ''}] "${name}"`;
  });

const isFocused = (l: Locator): Promise<boolean> =>
  l.evaluate((el) => el === document.activeElement);

const ready = async (h: Harness, selector: string): Promise<void> => {
  await h.page.locator(selector).first().waitFor({ timeout: 20_000 });
};

const waitParam = async (h: Harness, key: string, value: string | null): Promise<void> => {
  await h.page.waitForFunction(
    ([k, v]) => new URL(location.href).searchParams.get(k) === v,
    [key, value] as const,
    { timeout: 10_000 },
  );
};

for (const screen of SCREENS) {
  void describe(`the Filter popover's dropdowns on the ${screen.name} (LAI-726)`, () => {
    void test('are ARIA comboboxes over a listbox of options', async () => {
      const h = await open(screen.path, STUB);
      try {
        await ready(h, screen.ready);
        await openFilter(h);

        for (const name of [
          'Status',
          'Priority',
          'Assignee',
          'Label',
          'Sprint',
          'Updated within',
        ]) {
          const box = field(h, name);
          assert.equal(await box.count(), 1, `no combobox named "${name}"`);
          assert.equal(await box.getAttribute('aria-haspopup'), 'listbox', name);
          assert.equal(await box.getAttribute('aria-expanded'), 'false', name);
        }
        assert.equal(await h.page.locator('.bt-pop select').count(), 0, 'a native select is left');

        const status = field(h, 'Status');
        await status.click();
        assert.equal(await status.getAttribute('aria-expanded'), 'true');
        const listId = await status.getAttribute('aria-controls');
        assert.ok(listId !== null, 'aria-controls names no listbox');
        const list = h.page.locator(`[id="${listId}"]`);
        assert.equal(await list.getAttribute('role'), 'listbox');
        const options = list.getByRole('option');
        assert.deepEqual(
          (await options.locator('.dd-label').allInnerTexts()).map((t) => t.trim()),
          ['Any', 'Backlog', 'To do', 'In progress', 'Review', 'Done', 'Cancelled'],
        );
        // "Any" is the value, so it is the selected option and the active one.
        assert.equal(await options.first().getAttribute('aria-selected'), 'true');
        assert.equal(await options.nth(1).getAttribute('aria-selected'), 'false');
        const activeId = await status.getAttribute('aria-activedescendant');
        assert.equal(activeId, await options.first().getAttribute('id'));
        // The status's colour, as a dot.
        assert.equal(await options.nth(3).locator('.dd-dot-in_progress').count(), 1);

        // Clicking the trigger again closes it.
        await status.click();
        assert.equal(await panel(h).count(), 0, 'the panel outlived a second click');
        assert.equal(await status.getAttribute('aria-expanded'), 'false');
      } finally {
        await h.close();
      }
    });

    void test('Escape closes only the dropdown; a second Escape closes the popover', async () => {
      const h = await open(screen.path, STUB);
      try {
        await ready(h, screen.ready);
        await openFilter(h);
        const label = field(h, 'Label');
        await label.click();
        await panel(h).waitFor({ timeout: 5_000 });

        await h.page.keyboard.press('Escape');
        assert.equal(await panel(h).count(), 0, 'Escape left the dropdown open');
        assert.equal(await h.page.locator('.bt-pop').count(), 1, 'Escape closed the popover too');
        assert.equal(await isFocused(label), true, `focus went to ${await focused(h)}`);

        await h.page.keyboard.press('Escape');
        await h.page.locator('.bt-pop').waitFor({ state: 'detached', timeout: 5_000 });
        assert.equal(
          await isFocused(h.page.getByRole('button', { name: /^Filter/ })),
          true,
          `the second Escape left focus on ${await focused(h)}`,
        );
      } finally {
        await h.close();
      }
    });

    void test('a click in the panel or elsewhere in the popover closes only the panel', async () => {
      const h = await open(screen.path, STUB);
      try {
        await ready(h, screen.ready);
        await openFilter(h);

        // A click on the panel's own search box and padding is not "outside".
        await field(h, 'Label').click();
        await panel(h).locator('.dd-search-input').click();
        await panel(h).click({ position: { x: 3, y: 3 } });
        assert.equal(await panel(h).count(), 1, 'a click in the panel closed it');
        assert.equal(
          await h.page.locator('.bt-pop').count(),
          1,
          'a click in the panel closed the popover',
        );

        // A click on the popover's heading closes the panel and nothing else.
        await h.page.locator('.bt-pop-title').click();
        assert.equal(await panel(h).count(), 0, 'a click in the popover left the panel open');
        assert.equal(
          await h.page.locator('.bt-pop').count(),
          1,
          'the popover closed with the panel',
        );

        // Choosing an option closes the panel, and the popover stays.
        await pick(field(h, 'Priority'), 'p1');
        await waitParam(h, 'priority', 'p1');
        assert.equal(
          await h.page.locator('.bt-pop').count(),
          1,
          'choosing an option closed the popover',
        );
      } finally {
        await h.close();
      }
    });

    void test('each field writes the same URL parameter it always did', async () => {
      const h = await open(screen.path, STUB);
      try {
        await ready(h, screen.ready);
        await openFilter(h);
        const writes: [string, string, string, string][] = [
          ['Status', 'in_progress', 'status', 'in_progress'],
          ['Priority', 'p2', 'priority', 'p2'],
          ['Assignee', 'u3', 'assignee', 'u3'],
          ['Assignee', 'none', 'assignee', 'none'],
          ['Label', 'warehouse', 'tag', 'warehouse'],
          ['Sprint', 's4', 'sprint', 's4'],
          ['Sprint', 'none', 'sprint', 'none'],
          ['Updated within', '7d', 'updated', '7d'],
        ];
        for (const [name, value, key, written] of writes) {
          await pick(field(h, name), value);
          await waitParam(h, key, written);
          assert.equal(await valueOf(field(h, name)), value, `${name} does not show ${value}`);
        }
        // "Any" clears what the field wrote. Sprint's "Any" is `sprint=all` on
        // both screens — no `?sprint=` means "the active sprint" (LAI-713), and
        // `BoardScreen` writes the same for the List, as it did before.
        await pick(field(h, 'Status'), '');
        await waitParam(h, 'status', null);
        await pick(field(h, 'Sprint'), '');
        await waitParam(h, 'sprint', 'all');
        assert.equal(params(h).get('tag'), 'warehouse', 'Any on one field cleared another');
      } finally {
        await h.close();
      }
    });
  });
}

void describe('the Label dropdown with 35 labels (LAI-726)', () => {
  void test('scrolls inside an 18rem panel, with the chosen label in view', async () => {
    const h = await open('/board?project=laika-core&tag=warehouse', STUB);
    try {
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await ready(h, '.card');
      await openFilter(h);
      await field(h, 'Label').click();
      const g = await panel(h).evaluate((p) => {
        const list = p.querySelector('[role="listbox"]')!;
        const l = list.getBoundingClientRect();
        const chosen = list.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const r = p.getBoundingClientRect();
        return {
          options: list.querySelectorAll('[role="option"]').length,
          height: r.height,
          cap: 18 * rem,
          scrolls: list.scrollHeight > list.clientHeight,
          scrollTop: list.scrollTop,
          chosenTop: chosen.top,
          chosenBottom: chosen.bottom,
          listTop: l.top,
          listBottom: l.bottom,
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
        };
      });
      assert.equal(g.options, 36, 'positive control: Any and the 35 labels');
      assert.ok(g.height <= g.cap + 0.5, `taller than 18rem: ${String(g.height)}px`);
      assert.equal(g.scrolls, true, 'the list does not scroll inside the panel');
      assert.ok(g.scrollTop > 0, 'opened at the top with the chosen label 35 rows down');
      assert.ok(
        g.chosenTop >= g.listTop && g.chosenBottom <= g.listBottom,
        `the chosen label is out of view: ${String(g.chosenTop)}–${String(g.chosenBottom)} in ${String(g.listTop)}–${String(g.listBottom)}`,
      );
      assert.ok(
        g.top >= 0 && g.bottom <= 768,
        `off the screen vertically: ${String(g.top)}–${String(g.bottom)}`,
      );
      assert.ok(
        g.left >= 0 && g.right <= 1366,
        `off the screen sideways: ${String(g.left)}–${String(g.right)}`,
      );
      // Labels are chips, in the card's tag colours.
      assert.equal(await panel(h).locator('[data-value="bug"] .dd-tag.dd-tag-pink').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('search focuses on open, filters, highlights, and says when nothing fits', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await ready(h, '.list tbody tr');
      await openFilter(h);
      const label = field(h, 'Label');
      await label.click();
      /*
       * **The search box is itself a combobox** (review, round 1): it owns the
       * listbox while it has focus, so it says so — `aria-autocomplete`,
       * `aria-expanded`, `aria-controls` — rather than being a bare searchbox
       * carrying `aria-activedescendant`.
       */
      const search = panel(h).getByRole('combobox', { name: 'Search labels', exact: true });
      assert.equal(await isFocused(search), true, `focus went to ${await focused(h)}`);
      assert.equal(await search.getAttribute('aria-autocomplete'), 'list');
      assert.equal(await search.getAttribute('aria-expanded'), 'true');
      assert.equal(
        await search.getAttribute('aria-controls'),
        await panel(h).getByRole('listbox').getAttribute('id'),
        'the search box does not name the listbox it drives',
      );

      await h.page.keyboard.type('WARE');
      const values = await panel(h)
        .getByRole('option')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-value')));
      assert.deepEqual(values, ['', 'warehouse'], 'Any stays; only warehouse matches');
      assert.equal(
        (await panel(h).locator('[data-value="warehouse"] mark').innerText()).trim(),
        'ware',
        'the match is not highlighted',
      );
      // The search box names the active option, which is the first match.
      const active = await search.getAttribute('aria-activedescendant');
      assert.equal(active, await panel(h).locator('[data-value="warehouse"]').getAttribute('id'));

      await search.fill('zzz');
      assert.equal(await panel(h).getByText('No matches', { exact: true }).count(), 1);

      // A space is part of a search, not a choice.
      await search.fill('');
      await h.page.keyboard.type('ai p');
      assert.equal(await search.inputValue(), 'ai p');
      assert.equal(await panel(h).count(), 1, 'Space chose something in a search box');

      await search.fill('ai-');
      await h.page.keyboard.press('Enter');
      await waitParam(h, 'tag', 'ai-p1');
      assert.equal(await isFocused(label), true, `Enter left focus on ${await focused(h)}`);
    } finally {
      await h.close();
    }
  });

  void test('the panel stays inside a 900px-wide window', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 900, height: 700 });
      await ready(h, '.list tbody tr');
      await openFilter(h);
      for (const name of ['Label', 'Updated within', 'Sprint']) {
        await field(h, name).click();
        const r = await panel(h).evaluate((p) => {
          const b = p.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
        });
        assert.ok(
          r.left >= 0 && r.right <= 900,
          `${name}: off the side, ${String(r.left)}–${String(r.right)}`,
        );
        assert.ok(
          r.top >= 0 && r.bottom <= 700,
          `${name}: off the end, ${String(r.top)}–${String(r.bottom)}`,
        );
        await h.page.keyboard.press('Escape');
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown keyboard model (LAI-726)', () => {
  void test('arrows, Home, End, Enter, Space and type-ahead, with the active option named', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await ready(h, '.list tbody tr');
      await openFilter(h);
      const status = field(h, 'Status');
      await status.focus();

      const activeLabel = async (): Promise<string> => {
        const id = await status.getAttribute('aria-activedescendant');
        if (id === null) return '(none)';
        return (await h.page.locator(`[id="${id}"] .dd-label`).innerText()).trim();
      };

      await h.page.keyboard.press('ArrowDown');
      assert.equal(await status.getAttribute('aria-expanded'), 'true', 'ArrowDown did not open it');
      assert.equal(await activeLabel(), 'Any', 'did not open on the selected option');
      assert.equal(await isFocused(status), true, 'focus left the trigger');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await activeLabel(), 'Backlog');
      await h.page.keyboard.press('End');
      assert.equal(await activeLabel(), 'Cancelled');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await activeLabel(), 'Cancelled', 'Down at the end wrapped');
      await h.page.keyboard.press('Home');
      assert.equal(await activeLabel(), 'Any');
      // Type-ahead: "r" is Review.
      await h.page.keyboard.press('r');
      assert.equal(await activeLabel(), 'Review');
      // The active option is drawn as active.
      assert.match(
        (await h.page
          .locator(`[id="${(await status.getAttribute('aria-activedescendant'))!}"]`)
          .getAttribute('class')) ?? '',
        /dd-option-active/,
      );
      await h.page.keyboard.press('Enter');
      await waitParam(h, 'status', 'review');
      assert.equal(await status.getAttribute('aria-expanded'), 'false');
      assert.equal(await isFocused(status), true, `Enter left focus on ${await focused(h)}`);

      // Space opens, and Space chooses — exactly once each.
      await h.page.keyboard.press('Space');
      assert.equal(await status.getAttribute('aria-expanded'), 'true', 'Space did not open it');
      await h.page.keyboard.press('ArrowUp');
      assert.equal(await activeLabel(), 'In progress');
      await h.page.keyboard.press('Space');
      await waitParam(h, 'status', 'in_progress');
      assert.equal(await status.getAttribute('aria-expanded'), 'false', 'Space reopened it');
    } finally {
      await h.close();
    }
  });

  void test('Tab closes without choosing and moves on, from the trigger and from a search box', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await ready(h, '.list tbody tr');
      await openFilter(h);

      const status = field(h, 'Status');
      await status.focus();
      await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('Tab');
      assert.equal(await panel(h).count(), 0, 'Tab left it open');
      assert.equal(params(h).get('status'), null, 'Tab chose the active option');
      assert.equal(
        await isFocused(field(h, 'Priority')),
        true,
        `Tab from Status went to ${await focused(h)}`,
      );

      // From the search box, which lives at the end of <body>: Tab must carry
      // on from the trigger, not fall off the page.
      const label = field(h, 'Label');
      await label.click();
      await h.page.keyboard.type('bug');
      await h.page.keyboard.press('Tab');
      assert.equal(await panel(h).count(), 0, 'Tab left the search panel open');
      assert.equal(params(h).get('tag'), null, 'Tab chose the match');
      assert.equal(
        await isFocused(field(h, 'Sprint')),
        true,
        `Tab from Label's search went to ${await focused(h)}`,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('rich options (LAI-726)', () => {
  void test('priority icons, avatars, Anyone and Unassigned pinned, sprints with key, dates and Active', async () => {
    const h = await open('/board?project=laika-core&sprint=all', WITH_ACTIVE);
    try {
      await ready(h, '.card');
      await openFilter(h);

      await field(h, 'Priority').click();
      assert.equal(await panel(h).locator('[data-value="p1"] .priority-icon-p1').count(), 1);
      await h.page.keyboard.press('Escape');

      await field(h, 'Assignee').click();
      const people = panel(h).getByRole('option');
      assert.deepEqual(
        await people.evaluateAll((els) =>
          els.slice(0, 3).map((el) => el.getAttribute('data-value')),
        ),
        ['', 'none', 'u1'],
      );
      assert.match((await people.nth(1).getAttribute('class')) ?? '', /dd-option-pinned-last/);
      assert.equal(
        (await panel(h).locator('[data-value="u2"] .dd-avatar').innerText()).trim(),
        'GH',
        'Grace Hopper has no avatar',
      );
      // Search reaches a person's email too.
      await h.page.keyboard.type('edsger@');
      assert.deepEqual(
        await people.evaluateAll((els) => els.map((el) => el.getAttribute('data-value'))),
        ['', 'none', 'u7'],
      );
      await h.page.keyboard.press('Escape');

      await field(h, 'Sprint').click();
      const s3 = panel(h).locator('[data-value="s3"]');
      /*
       * **The key is part of the name** (review, round 1): it was drawn in an
       * `aria-hidden` icon, so a screen reader heard "Billing" for a sprint
       * the chips and the strip call "S3 · Billing".
       */
      assert.equal(
        await panel(h)
          .getByRole('option', { name: /^S3 · Billing\b/ })
          .count(),
        1,
        'the S3 option is not named "S3 · Billing"',
      );
      assert.equal((await s3.locator('.dd-label').innerText()).trim(), 'S3 · Billing');
      assert.equal((await s3.locator('.dd-badge').innerText()).trim(), 'Active');
      assert.notEqual((await s3.locator('.dd-detail').innerText()).trim(), '', 'no dates');
      assert.equal(
        await panel(h).locator('.dd-badge').count(),
        1,
        'more than one sprint is active',
      );
    } finally {
      await h.close();
    }
  });

  void test('the panel and its active option are drawn on the theme tokens, both ways', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await ready(h, '.list tbody tr');
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        await openFilter(h);
        await field(h, 'Status').focus();
        await h.page.keyboard.press('ArrowDown');
        const [panelBg, activeBg, card, column] = await panel(h).evaluate((p) => {
          const probe = (v: string) => {
            const d = document.createElement('div');
            d.style.background = `var(${v})`;
            document.body.append(d);
            const c = getComputedStyle(d).backgroundColor;
            d.remove();
            return c;
          };
          return [
            getComputedStyle(p).backgroundColor,
            getComputedStyle(p.querySelector('.dd-option-active')!).backgroundColor,
            probe('--bg-card'),
            probe('--bg-column'),
          ];
        });
        assert.equal(panelBg, card, `${theme}: the panel is not on --bg-card`);
        assert.equal(activeBg, column, `${theme}: the active option is not on --bg-column`);
        await h.page.keyboard.press('Escape');
        await h.page.keyboard.press('Escape');
      }
    } finally {
      await h.close();
    }
  });

  void test('option rows are tall enough to tap', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 390, height: 800 });
      await ready(h, '.list tbody tr');
      await openFilter(h);
      await field(h, 'Status').click();
      const heights = await panel(h)
        .getByRole('option')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      assert.ok(heights.length > 0, 'positive control');
      for (const height of heights) assert.ok(height >= 36, `a ${String(height)}px row`);
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown near the bottom of the window (LAI-726)', () => {
  void test('flips above its trigger and stays on screen', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.setViewportSize({ width: 1366, height: 768 });
      await ready(h, '.list tbody tr');
      await openFilter(h);
      // A window just tall enough for the popover, so the last row of fields
      // sits near the bottom with no room for a list under it.
      const fieldBottom = await field(h, 'Updated within').evaluate(
        (el) => el.getBoundingClientRect().bottom,
      );
      const height = Math.ceil(fieldBottom + 150);
      await h.page.setViewportSize({ width: 1366, height });
      await h.page.waitForFunction((want: number) => innerHeight === want, height);
      const updated = field(h, 'Updated within');
      const sprintField = field(h, 'Sprint');
      for (const box of [updated, sprintField]) {
        await box.click();
        const g = await panel(h).evaluate((p) => {
          const r = p.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, side: (p as HTMLElement).dataset.side };
        });
        const t = await box.evaluate((el) => el.getBoundingClientRect());
        assert.equal(
          g.side,
          'above',
          `did not flip: ${JSON.stringify(g)} in a ${String(height)}px window`,
        );
        assert.ok(
          g.bottom <= t.top,
          `overlaps its trigger: panel ends ${String(g.bottom)}, trigger starts ${String(t.top)}`,
        );
        assert.ok(g.top >= 0, `runs off the top: ${String(g.top)}`);
        await h.page.keyboard.press('Escape');
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown, round 1 of review (LAI-726)', () => {
  /*
   * **Safari's order** (review, round 1). Safari does not focus a button on
   * mousedown, so clicking the trigger of an open, searchable dropdown blurs
   * the search box with no `relatedTarget` *before* the click — and a blur
   * that closed the panel then let the click reopen it. Chromium focuses the
   * button and never shows the bug, so the events are dispatched in Safari's
   * order by hand.
   */
  void test('clicking the trigger closes a searchable dropdown, in Safari’s event order', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await ready(h, '.list tbody tr');
      await openFilter(h);
      const label = field(h, 'Label');
      await label.click();
      await panel(h).locator('.dd-search-input').waitFor();

      await label.evaluate(async (trigger) => {
        const tick = () => new Promise((done) => setTimeout(done, 0));
        const at = trigger.getBoundingClientRect();
        const xy = { bubbles: true, cancelable: true, clientX: at.left + 5, clientY: at.top + 5 };
        trigger.dispatchEvent(new PointerEvent('pointerdown', { ...xy, pointerType: 'mouse' }));
        trigger.dispatchEvent(new MouseEvent('mousedown', xy));
        await tick();
        // Safari: the search box loses focus to nothing.
        (document.activeElement as HTMLElement | null)?.blur();
        await tick();
        trigger.dispatchEvent(new PointerEvent('pointerup', { ...xy, pointerType: 'mouse' }));
        trigger.dispatchEvent(new MouseEvent('mouseup', xy));
        trigger.dispatchEvent(new MouseEvent('click', xy));
        await tick();
      });
      assert.equal(await panel(h).count(), 0, 'the click reopened the dropdown it was closing');
      assert.equal(await label.getAttribute('aria-expanded'), 'false');
    } finally {
      await h.close();
    }
  });

  /*
   * **Type-ahead on a closed trigger starts from the selected option**
   * (review, round 1), not from wherever the last session left the active
   * one. Updated within has two options starting "L".
   */
  void test('type-ahead on a closed trigger starts from the selected option', async () => {
    const h = await open('/list?project=laika-core&updated=7d', STUB);
    try {
      await ready(h, '.list tbody tr');
      await openFilter(h);
      const updated = field(h, 'Updated within');
      const activeLabel = async (): Promise<string> => {
        const id = await updated.getAttribute('aria-activedescendant');
        if (id === null) return '(none)';
        return (await h.page.locator(`[id="${id}"] .dd-label`).innerText()).trim();
      };
      await updated.focus();
      // A first session that moves the active option and chooses nothing.
      await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await activeLabel(), 'Last 30 days', 'positive control: the active one moved');
      await h.page.keyboard.press('Escape');

      // "L" from "Last 7 days", the value, is "Last 30 days".
      await h.page.keyboard.press('l');
      assert.equal(await activeLabel(), 'Last 30 days', 'type-ahead started from the old session');
      await h.page.keyboard.press('Escape');
      /*
       * **Closing resets the buffer** (review, round 2). Two different
       * letters across a close, inside the 600ms window: "a" lands on "Any
       * time"; then, at once, "l". A buffer that outlived the close reads
       * "al", matches nothing and leaves the active option on the value; a
       * fresh one reads "l" and moves on from the value to "Last 30 days".
       * (The same letter twice could not tell the two apart: "ll" is "l".)
       */
      await h.page.keyboard.press('a');
      assert.equal(await activeLabel(), 'Any time', 'positive control: "a" is Any time');
      await h.page.keyboard.press('Escape');
      await h.page.keyboard.press('l');
      assert.equal(await activeLabel(), 'Last 30 days', 'the buffer outlived the close');
    } finally {
      await h.close();
    }
  });

  /*
   * **A touch screen keeps its keyboard down** (review, round 1): focusing
   * the search box on open raises the on-screen keyboard over the list the
   * reader opened to look at. On a coarse pointer the search box is there but
   * not focused. `matchMedia` is answered by an init script — Chromium has no
   * switch for the pointer media feature.
   */
  void test('on a coarse pointer the search box is offered but not focused', async () => {
    const h = await open('/list?project=laika-core', STUB, {
      before: async (page) => {
        await page.addInitScript(() => {
          const real = window.matchMedia.bind(window);
          window.matchMedia = (query: string) => {
            const answer = real(query);
            if (!/pointer:\s*coarse/.test(query)) return answer;
            return Object.defineProperty(Object.create(answer) as MediaQueryList, 'matches', {
              value: true,
            });
          };
        });
      },
    });
    try {
      await ready(h, '.list tbody tr');
      assert.equal(
        await h.page.evaluate(() => matchMedia('(pointer: coarse)').matches),
        true,
        'positive control: the page sees a coarse pointer',
      );
      await openFilter(h);
      const label = field(h, 'Label');
      await label.click();
      await panel(h).locator('.dd-search-input').waitFor();
      assert.equal(
        await panel(h)
          .locator('.dd-search-input')
          .evaluate((el) => el === document.activeElement),
        false,
        'the search box took focus on a touch screen',
      );
      assert.equal(await isFocused(label), true, `focus went to ${await focused(h)}`);
    } finally {
      await h.close();
    }
  });

  void test('scrolling the list inside the panel keeps it open', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await ready(h, '.list tbody tr');
      await openFilter(h);
      await field(h, 'Label').click();
      const list = panel(h).getByRole('listbox');
      await list.hover();
      await h.page.mouse.wheel(0, 300);
      await h.page.waitForFunction(
        () =>
          (document.querySelector('[data-dropdown-panel] [role="listbox"]')?.scrollTop ?? 0) > 0,
        undefined,
        { timeout: 5_000 },
      );
      await h.page.waitForTimeout(150);
      assert.equal(await panel(h).count(), 1, 'scrolling its own list closed the panel');
    } finally {
      await h.close();
    }
  });
});
