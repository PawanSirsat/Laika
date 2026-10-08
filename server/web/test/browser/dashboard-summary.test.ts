/**
 * The Dashboard, the Jira way (LAI-711, D-072).
 *
 * The owner: *"I want what Jira uses, simplify everything, show the
 * person-wise task divide in a circle … alignment is also not properly
 * aligned."* These tests hold the page to that against a fixture shaped like
 * a real project: four members, an org owner who leads by role and has no
 * membership row, open and finished work, priorities, due dates, a blocked
 * task, and more stale work than the old panel could count.
 *
 * **Every expected number is counted from the fixture here**, by plain filters
 * written for this file — not by calling the code under test — so a wrong rule
 * in the app cannot agree with itself.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, fakeStream, open, setTheme, type ApiStub } from './harness.ts';

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

const NOW = Date.now();
const DAY = 86_400_000;
const TODAY = NOW - (NOW % DAY);
const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
/** u9 is the org owner: assigned work, mentionable, and not a member. */
const ASSIGNEES = ['u1', 'u2', 'u3', 'u9', null, 'u1'] as const;
const NAMES: Record<string, string> = {
  u1: 'Ada Lovelace',
  u2: 'Grace Hopper',
  u3: 'Alan Turing',
  u4: 'Katherine Johnson',
  u9: 'Pawan Owner',
};

interface FixtureTask {
  id: string;
  key: string;
  number: number;
  status: string;
  priority: string;
  assignee_id: string | null;
  blocked_by: string[];
  due_on: number | null;
  created_at: number;
  updated_at: number;
  [field: string]: unknown;
}

function makeTask(i: number): FixtureTask {
  return {
    id: `t${String(i)}`,
    key: `LC-${String(i)}`,
    number: i,
    project_id: 'laika-core',
    title: `Task number ${String(i)}`,
    description_md: '',
    acceptance_md: '',
    status: i >= 40 ? 'cancelled' : STATUSES[i % 5]!,
    priority: (['p1', 'p2', 'p3'] as const)[i % 3]!,
    position: null,
    assignee_id: ASSIGNEES[i % 6] ?? null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    sprint_id: null,
    tags: [],
    ready: false,
    comment_count: 0,
    blocked_by: i === 2 ? ['t3'] : [],
    blocks: i === 3 ? ['t2'] : [],
    discovered_from: null,
    parent_task_id: null,
    due_on: i % 7 === 1 ? TODAY + 2 * DAY : i % 11 === 1 ? TODAY - 3 * DAY : null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    created_at: NOW - i * DAY - 3_600_000,
    updated_at: NOW - (i % 10) * DAY - 3_600_000,
    started_at: null,
    completed_at: null,
  };
}

interface World {
  tasks: FixtureTask[];
  stub: ApiStub;
}

function world(): World {
  const tasks = Array.from({ length: 42 }, (_, i) => makeTask(i));
  return {
    tasks,
    stub: {
      '/api/v1/me': {
        id: 'u1',
        email: 'a@example.com',
        name: 'Ada Lovelace',
        org_role: 'member',
        is_active: true,
        memberships: [{ project_id: 'laika-core', role: 'lead' }],
      },
      '/api/v1/projects': {
        data: [
          {
            ...CORE,
            task_counts: { backlog: 8, todo: 8, in_progress: 8, review: 8, done: 8, cancelled: 2 },
            blocked_count: 1,
            member_count: 4,
            members: [],
            last_activity_at: 2,
          },
        ],
        next_cursor: null,
      },
      '/api/v1/projects/laika-core': CORE,
      '/api/v1/projects/laika-core/tasks': () => ({
        data: tasks.map((t) => ({ ...t })),
        next_cursor: null,
      }),
      '/api/v1/projects/laika-core/members': {
        members: ['u1', 'u2', 'u3', 'u4'].map((id) => ({
          user_id: id,
          name: NAMES[id],
          email: `${id}@example.com`,
          role: id === 'u1' ? 'lead' : 'member',
          created_at: 1,
        })),
      },
      '/api/v1/projects/laika-core/mentionable': {
        users: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
      },
      '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
      '/api/v1/projects/laika-core/activity': {
        data: Array.from({ length: 30 }, (_, i) => ({
          id: `e${String(i)}`,
          seq: i,
          project_id: 'laika-core',
          task_id: `t${String(i)}`,
          actor_id: i % 3 === 0 ? 'u9' : 'u2',
          actor_kind: i % 3 === 0 ? 'agent' : 'user',
          actor_token_id: null,
          type: 'task.updated',
          payload: null,
          created_at: NOW - i * 3 * 3_600_000,
        })),
        next_cursor: null,
      },
      '/api/v1/projects/laika-core/metrics': {
        since: NOW - 7 * DAY,
        throughput: [3, 0, 5, 2, 0, 4, 1, 6].map((completed, i) => ({
          day: new Date(TODAY - (7 - i) * DAY).toISOString().slice(0, 10),
          completed,
        })),
        cycle_time: {
          measured: 21,
          unmeasured: 0,
          p50_ms: 3 * DAY,
          p75_ms: 5 * DAY,
          p90_ms: 9 * DAY,
        },
      },
      '/api/v1/projects/laika-core/tags': { tags: [] },
      '/api/v1/org': {
        id: 'o',
        name: 'Borealis Labs',
        presence_enabled: false,
        created_at: 1,
        updated_at: 1,
      },
      '/api/v1/presence': { enabled: false, present: [] },
    },
  };
}

const open7 = (t: FixtureTask): boolean => t.status !== 'done' && t.status !== 'cancelled';

async function ready(page: Page): Promise<void> {
  await page.locator('.dash-people .dash-legend-row').first().waitFor({ timeout: 20_000 });
}

async function numberOf(page: Page, selector: string): Promise<number> {
  return Number((await page.locator(selector).first().textContent())?.trim());
}

void after(async () => {
  await closeBrowser();
});

void describe('the dashboard is aligned (LAI-711)', () => {
  for (const width of [1280, 1100]) {
    void test(`at ${String(width)}px nothing overflows and every row lines up`, async () => {
      const w = world();
      const h = await open('/dashboard?project=laika-core', w.stub);
      try {
        await h.page.setViewportSize({ width, height: 900 });
        await ready(h.page);
        await h.page.waitForTimeout(150);
        const m = await h.page.evaluate(() => {
          const main = document.querySelector('.shell-main') ?? document.scrollingElement!;
          const bar = document.querySelector('.space-bar');
          const barBox = bar?.getBoundingClientRect();
          const barPad = bar === null ? 0 : parseFloat(getComputedStyle(bar).paddingLeft);
          const box = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          };
          return {
            overflow: main.scrollWidth - main.clientWidth,
            viewport: window.innerWidth,
            barLeft: barBox === undefined ? null : barBox.left + barPad,
            barRight: barBox === undefined ? null : barBox.right - barPad,
            stats: [...document.querySelectorAll('.dash-stats > .dash-card')].map(box),
            cards: [...document.querySelectorAll('.dash-grid > .dash-card')].map(box),
          };
        });
        assert.ok(m.overflow <= 0, `the page scrolls sideways by ${String(m.overflow)}px`);
        assert.equal(m.stats.length, 4, 'four stat cards');
        assert.equal(m.cards.length, 6, 'six cards in the grid');
        for (const card of [...m.stats, ...m.cards]) {
          assert.ok(
            card.right <= m.viewport,
            `a card runs past the window: ${JSON.stringify(card)}`,
          );
        }
        // Cards that share a row share both edges.
        const rows = new Map<number, typeof m.cards>();
        for (const card of [...m.stats, ...m.cards]) {
          const key = Math.round(card.top);
          rows.set(key, [...(rows.get(key) ?? []), card]);
        }
        for (const row of rows.values()) {
          const bottoms = row.map((c) => c.bottom);
          assert.ok(
            Math.max(...bottoms) - Math.min(...bottoms) <= 1,
            `cards in one row end at different heights: ${JSON.stringify(row)}`,
          );
        }
        // Nothing overlaps the row below it.
        const sorted = [...m.stats, ...m.cards].sort((a, b) => a.top - b.top);
        for (let i = 1; i < sorted.length; i += 1) {
          const prev = sorted[i - 1]!;
          const cur = sorted[i]!;
          if (Math.round(cur.top) !== Math.round(prev.top)) {
            assert.ok(
              cur.top >= prev.bottom,
              `a card runs under the next row: ${JSON.stringify([prev, cur])}`,
            );
          }
        }
        // The gutters are the space bar's.
        assert.ok(m.barLeft !== null && m.barRight !== null, 'no space bar to align to');
        assert.ok(
          Math.abs((m.stats[0]?.left ?? 0) - m.barLeft) <= 1,
          `left gutter ${String(m.stats[0]?.left)} vs the bar's ${String(m.barLeft)}`,
        );
        assert.ok(
          Math.abs((m.stats.at(-1)?.right ?? 0) - m.barRight) <= 1,
          `right gutter ${String(m.stats.at(-1)?.right)} vs the bar's ${String(m.barRight)}`,
        );
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the numbers are the fixture’s (LAI-711)', () => {
  void test('the four stat cards', async () => {
    const w = world();
    const h = await open('/dashboard?project=laika-core', w.stub);
    try {
      await ready(h.page);
      const since = NOW - 7 * DAY;
      const expected = {
        done: 3 + 0 + 5 + 2 + 0 + 4 + 1 + 6,
        updated: w.tasks.filter((t) => t.updated_at >= since).length,
        created: w.tasks.filter((t) => t.created_at >= since).length,
        due: w.tasks.filter(
          (t) => open7(t) && t.due_on !== null && t.due_on >= TODAY && t.due_on < TODAY + 7 * DAY,
        ).length,
      };
      const overdue = w.tasks.filter(
        (t) => open7(t) && t.due_on !== null && t.due_on < TODAY,
      ).length;
      assert.ok(expected.due > 0 && overdue > 0, 'the fixture must exercise both');
      for (const [kind, value] of Object.entries(expected)) {
        assert.equal(await numberOf(h.page, `[data-stat="${kind}"]`), value, kind);
      }
      assert.match(
        (await h.page.locator('.dash-stat-overdue').textContent()) ?? '',
        new RegExp(`^${String(overdue)} overdue$`),
      );
    } finally {
      await h.close();
    }
  });

  void test('the status donut accounts for every live task, and says how much is done', async () => {
    const w = world();
    // **All time** (LAI-732): the range now reaches this card, counting tasks
    // updated within it, and All time is the whole project — what this pins.
    // The range itself is `dashboard-card-filters.test.ts`'s.
    const h = await open('/dashboard?project=laika-core&range=all', w.stub);
    try {
      await ready(h.page);
      const live = w.tasks.filter((t) => t.status !== 'cancelled');
      for (const status of STATUSES) {
        assert.equal(
          await numberOf(h.page, `.dash-status [data-status="${status}"]`),
          live.filter((t) => t.status === status).length,
          status,
        );
      }
      const done = live.filter((t) => t.status === 'done').length;
      assert.equal(
        (await h.page.locator('.dash-status .donut-value').textContent())?.trim(),
        `${String(Math.round((done / live.length) * 100))}%`,
      );
      assert.match(
        (await h.page.locator('.dash-status .dash-card-foot').textContent()) ?? '',
        /^2 cancelled/,
      );
    } finally {
      await h.close();
    }
  });

  void test('work by person: open work for every assignee, the owner named, Unassigned its own share', async () => {
    const w = world();
    // **All time** (LAI-732): the range now reaches this card, counting tasks
    // updated within it, and All time is the whole project — what this pins.
    // The range itself is `dashboard-card-filters.test.ts`'s.
    const h = await open('/dashboard?project=laika-core&range=all', w.stub);
    try {
      await ready(h.page);
      const openWork = w.tasks.filter(open7);
      for (const id of ['u1', 'u2', 'u3', 'u9']) {
        assert.equal(
          await numberOf(h.page, `.dash-people [data-person="${id}"]`),
          openWork.filter((t) => t.assignee_id === id).length,
          id,
        );
      }
      assert.equal(
        await numberOf(h.page, '.dash-people [data-person="unassigned"]'),
        openWork.filter((t) => t.assignee_id === null).length,
      );
      assert.equal(
        await numberOf(h.page, '.dash-people .donut-value'),
        openWork.length,
        'the centre is all open work',
      );
      const names = await h.page.locator('.dash-people .dash-legend-name').allTextContents();
      assert.ok(names.includes('Pawan Owner'), `the owner is not named: ${JSON.stringify(names)}`);
      assert.ok(!names.some((n) => /^u\d$/.test(n)), `a raw id is shown: ${JSON.stringify(names)}`);
      assert.equal(names.at(-1), 'Unassigned', 'Unassigned is last');
      // The ring has a slice per row, each drawn in a real colour.
      const strokes = await h.page
        .locator('.dash-people .donut-slice')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke));
      assert.equal(strokes.length, names.length);
      assert.ok(
        strokes.every((s) => s !== '' && s !== 'none'),
        JSON.stringify(strokes),
      );
      assert.equal(new Set(strokes).size, strokes.length, 'two slices share a colour');
    } finally {
      await h.close();
    }
  });

  void test('needs attention counts every stale task, not the first five', async () => {
    const w = world();
    const h = await open('/dashboard?project=laika-core', w.stub);
    try {
      await ready(h.page);
      const stale = w.tasks.filter((t) => open7(t) && NOW - t.updated_at > 5 * DAY).length;
      assert.ok(
        stale > 5,
        `the fixture must have more than five stale tasks, has ${String(stale)}`,
      );
      const tab = h.page.locator('.dash-tab', { hasText: 'Stale' });
      assert.equal(Number(await tab.locator('.dash-tab-count').textContent()), stale);
      await tab.click();
      assert.equal(await h.page.locator('.dash-attention .dash-att-row').count(), stale);
      const blocked = h.page.locator('.dash-tab', { hasText: 'Blocked' });
      assert.equal(Number(await blocked.locator('.dash-tab-count').textContent()), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('every row goes somewhere (LAI-711)', () => {
  void test('a person opens the board filtered to them; a blocked task opens its drawer', async () => {
    const w = world();
    const h = await open('/dashboard?project=laika-core', w.stub);
    try {
      await ready(h.page);
      await h.page.locator('.dash-people a.dash-legend-row', { hasText: 'Grace Hopper' }).click();
      await h.page.waitForURL(/\/board\?/, { timeout: 5000 });
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('assignee'), 'u2');
      assert.equal(url.searchParams.get('project'), 'laika-core');

      await h.page.goBack();
      await ready(h.page);
      await h.page.locator('.dash-attention a.dash-att-row', { hasText: 'LC-2' }).click();
      await h.page.waitForURL(/task=t2/, { timeout: 5000 });
    } finally {
      await h.close();
    }
  });
});

void describe('the page never blanks (LAI-711)', () => {
  void test('a range change swaps the numbers in place, with no skeleton', async () => {
    const w = world();
    const h = await open('/dashboard?project=laika-core', w.stub);
    try {
      await ready(h.page);
      await h.page.evaluate(() => {
        const win = window as Window & { __sk?: boolean; __card?: Element | null };
        win.__card = document.querySelector('.dash-people');
        win.__sk = false;
        new MutationObserver(() => {
          if (document.querySelector('.skeleton-card, .skeleton-list')) win.__sk = true;
        }).observe(document.body, { subtree: true, childList: true });
      });
      await h.page.route('**/api/v1/projects/laika-core/tasks**', async (route) => {
        await new Promise((done) => setTimeout(done, 700));
        await route.continue();
      });
      await h.page.locator('.dash-range', { hasText: 'Last 30 days' }).click();
      await h.page.waitForTimeout(300);
      const mid = await h.page.evaluate(() => {
        const win = window as Window & { __sk?: boolean; __card?: Element | null };
        return { skeleton: win.__sk === true, same: win.__card?.isConnected === true };
      });
      assert.equal(mid.skeleton, false, 'a skeleton replaced the page');
      assert.equal(mid.same, true, 'the cards were torn down');
      await h.page.waitForTimeout(700);
      const since = NOW - 30 * DAY;
      assert.equal(
        await numberOf(h.page, '[data-stat="created"]'),
        w.tasks.filter((t) => t.created_at >= since).length,
      );
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a live change updates the numbers in place', async () => {
    const w = world();
    const h = await open('/dashboard?project=laika-core', w.stub, { before: fakeStream });
    try {
      await ready(h.page);
      const before = await numberOf(h.page, '.dash-people [data-person="u3"]');
      const card = await h.page.locator('.dash-people').elementHandle();
      // An agent hands three unassigned tasks to Alan.
      let moved = 0;
      for (const t of w.tasks) {
        if (moved < 3 && open7(t) && t.assignee_id === null) {
          t.assignee_id = 'u3';
          moved += 1;
        }
      }
      await h.page.evaluate(() => {
        (
          window as unknown as {
            __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
          }
        ).__laikaStream.emit(
          'task.assigned',
          {
            id: 'live1',
            seq: 999,
            type: 'task.assigned',
            project_id: 'laika-core',
            task_id: 't4',
            actor_id: 'u9',
            actor_kind: 'agent',
            actor_token_id: null,
            payload: {},
            created_at: Date.now(),
          },
          '999',
        );
      });
      await h.page.waitForFunction(
        (want) =>
          Number(document.querySelector('.dash-people [data-person="u3"]')?.textContent?.trim()) ===
          want,
        before + 3,
        { timeout: 5000 },
      );
      assert.equal(
        await card?.evaluate((el) => el.isConnected),
        true,
        'the card was rebuilt rather than updated',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('both themes (LAI-711)', () => {
  void test('the donuts draw in light and in dark', async () => {
    const w = world();
    const h = await open('/dashboard?project=laika-core', w.stub);
    try {
      await ready(h.page);
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const strokes = await h.page
          .locator('.donut-slice')
          .evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke));
        assert.ok(strokes.length >= 8, `${theme}: ${String(strokes.length)} slices`);
        assert.ok(
          strokes.every((s) => s !== '' && s !== 'none' && !s.includes('var(')),
          `${theme}: ${JSON.stringify(strokes)}`,
        );
      }
    } finally {
      await h.close();
    }
  });
});
