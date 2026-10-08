/**
 * Priority is drawn as Jira draws it (LAI-705, D-070).
 *
 * The owner's crops of Jira, 2026-10-07: *"for priority use this kind of icon
 * properly"*. One `PriorityIcon` in three places — the board card, the List's
 * PRI column, the task view's Details card — drawing **P1 a red up chevron,
 * P2 an orange equals sign, P3 a blue down chevron**.
 *
 * What is asserted is what a person sees, read off the rendered page:
 *  - **the shape**, from the path's own geometry rather than its `d` string,
 *    so a level drawing another level's glyph fails however it is written;
 *  - **the name**, in `aria-label` and the `<title>`, so colour is never the
 *    only signal;
 *  - **the colour**, as computed, equal to that level's token and different
 *    from the other two, in dark and in light.
 *
 * And one absence behind a positive control: a card no longer draws the dot.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';
import { valueOf } from './dropdown.ts';

const NOW = Date.now();
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

const task = (n: number, priority: string) => ({
  id: `t${String(n)}`,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task ${String(n)}`,
  description_md: '',
  acceptance_md: '',
  status: 'in_progress',
  priority,
  position: `a${String(n)}`,
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked: false,
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
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
});

const LEVELS = [
  { level: 'p1', key: 'LC-1', id: 't1', name: 'High', shape: 'up', token: '--overdue' },
  { level: 'p2', key: 'LC-2', id: 't2', name: 'Medium', shape: 'equals', token: '--chip-orange' },
  { level: 'p3', key: 'LC-3', id: 't3', name: 'Low', shape: 'down', token: '--chip-blue' },
] as const;

const TASKS = LEVELS.map((l, i) => task(i + 1, l.level));

const perTask: Record<string, unknown> = Object.fromEntries(
  TASKS.flatMap((t): [string, unknown][] => [
    [`/api/v1/tasks/${t.id}`, t],
    [`/api/v1/tasks/${t.id}/comments`, { data: [], next_cursor: null }],
    [`/api/v1/tasks/${t.id}/watchers`, { watchers: [] }],
    [`/api/v1/projects/laika-core/tasks?parent=${t.id}&limit=200`, { data: [], next_cursor: null }],
  ]),
);

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
        task_counts: { backlog: 0, todo: 0, in_progress: 3, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  // Query-keyed, so the Subtasks section's `?parent=` is not answered with
  // every task on the page (task-panel.test.ts's shape).
  '/api/v1/projects/laika-core/tasks?limit=200': { data: TASKS, next_cursor: null },
  ...perTask,
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada Lovelace' }] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
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

interface Drawn {
  readonly level: string | null;
  readonly label: string | null;
  readonly title: string;
  readonly shape: string;
  readonly color: string;
  readonly stroke: string;
}

/**
 * Read one rendered icon. The shape comes from the path's geometry: its start,
 * middle and end points, and how many subpaths it has. An up chevron's middle
 * is above both ends; a down chevron's is below; an equals sign is two
 * horizontal strokes at different heights.
 */
async function drawn(icon: Locator): Promise<Drawn> {
  assert.equal(await icon.count(), 1, 'expected exactly one priority icon here');
  return icon.evaluate((svg) => {
    const path = svg.querySelector('path');
    if (path === null) throw new Error('the icon has no path');
    const length = path.getTotalLength();
    const a = path.getPointAtLength(0);
    const m = path.getPointAtLength(length / 2);
    const b = path.getPointAtLength(length);
    const moves = (path.getAttribute('d') ?? '').match(/M/gi)?.length ?? 0;
    let shape = 'other';
    if (moves === 2 && a.y === m.y && Math.abs(a.y - b.y) >= 3) shape = 'equals';
    else if (moves === 1 && m.y < Math.min(a.y, b.y) - 2) shape = 'up';
    else if (moves === 1 && m.y > Math.max(a.y, b.y) + 2) shape = 'down';
    return {
      level: svg.getAttribute('data-priority'),
      label: svg.getAttribute('aria-label'),
      title: svg.querySelector('title')?.textContent ?? '',
      shape,
      color: getComputedStyle(svg).color,
      stroke: getComputedStyle(path).stroke,
    };
  });
}

/** A token as the browser resolves it right now, in the current theme. */
async function resolved(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

/** Every level, in one place, in one theme: shape, name and colour. */
async function checkAll(
  page: Page,
  iconFor: (l: (typeof LEVELS)[number]) => Locator,
  where: string,
) {
  const colours = new Set<string>();
  for (const l of LEVELS) {
    const icon = await drawn(iconFor(l));
    const at = `${where}, ${l.key}`;
    assert.equal(icon.level, l.level, `${at}: wrong level`);
    assert.equal(
      icon.shape,
      l.shape,
      `${at}: ${l.level} should draw ${l.shape}, drew ${icon.shape}`,
    );
    assert.equal(icon.label, `Priority: ${l.name}`, `${at}: wrong accessible name`);
    assert.equal(icon.title, `Priority: ${l.name}`, `${at}: wrong <title>`);
    const want = await resolved(page, l.token);
    assert.notEqual(want, '', `${l.token} resolved to nothing`);
    assert.equal(icon.color, want, `${at}: ${l.level} is not ${l.token}`);
    assert.equal(icon.stroke, want, `${at}: the stroke is not the icon's colour`);
    colours.add(icon.color);
  }
  assert.equal(colours.size, 3, `${where}: two levels share a colour (${[...colours].join(', ')})`);
}

async function inBothThemes(page: Page, run: (theme: string) => Promise<void>) {
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await run(theme);
  }
}

void after(async () => {
  await closeBrowser();
});

void describe('the board card draws Jira’s priority icon (LAI-705)', () => {
  void test('each level its own glyph, name and colour, in both themes; no dot', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('article.card').first().waitFor({ timeout: 20_000 });
      // Positive control: every card is on the page, so the absence below is
      // about the card and not about an empty board.
      assert.equal(await h.page.locator('article.card').count(), 3, 'all three cards must render');

      const card = (key: string) =>
        h.page
          .locator('article.card')
          .filter({ has: h.page.locator('.card-key', { hasText: new RegExp(`^${key}\\b`) }) });

      await inBothThemes(h.page, async (theme) => {
        await checkAll(
          h.page,
          (l) => card(l.key).locator('.card-foot .priority-icon'),
          `card, ${theme}`,
        );
      });

      assert.equal(await h.page.locator('.card-dot').count(), 0, 'a card still draws the dot');
      assert.equal(
        await card('LC-3').locator('.card-foot > span:not([class])').count(),
        0,
        'a P3 card still draws an unclassed dot',
      );
      // The old hidden label is gone too: the icon's name replaces it.
      assert.doesNotMatch(
        await card('LC-1').locator('.card-foot').innerText(),
        /Priority p1/,
        'the old visually-hidden "Priority p1" is still there',
      );

      // On the key's line: the icon's middle within 2px of the key's, read in
      // one frame.
      const gap = await card('LC-1')
        .locator('.card-foot')
        .evaluate((foot) => {
          const mid = (sel: string) => {
            const r = foot.querySelector(sel)?.getBoundingClientRect();
            if (r === undefined) throw new Error(`no ${sel}`);
            return r.top + r.height / 2;
          };
          return Math.abs(mid('.priority-icon') - mid('.card-key'));
        });
      assert.ok(gap <= 2, `the icon sits ${String(gap)}px off the key's centre line`);
    } finally {
      await h.close();
    }
  });
});

void describe('the List draws the icon before P1 (LAI-705)', () => {
  void test('each row its own glyph, name and colour, beside its text, on one line', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.list-row').count(), 3, 'all three rows must render');

      const row = (key: string) =>
        h.page.locator('.list-row').filter({ has: h.page.locator('.list-key', { hasText: key }) });

      await inBothThemes(h.page, async (theme) => {
        await checkAll(
          h.page,
          (l) => row(l.key).locator('.list-pri .priority-icon'),
          `List, ${theme}`,
        );
      });

      for (const l of LEVELS) {
        // The design's text is still there, and the icon adds nothing to it.
        assert.equal(await row(l.key).locator('.list-pri').innerText(), l.level.toUpperCase());
        const cell = await row(l.key).locator('.list-pri-cell').boundingBox();
        assert.ok(cell !== null && cell.height <= 16, `${l.key}: the PRI cell wrapped`);
      }

      // The column grew by the icon and its gap: 42px → 58px (re-aims the
      // design's PRI 42 named in list-view.test.ts).
      const width = Math.round(
        (await h.page.locator('.list-pri').first().boundingBox())?.width ?? -1,
      );
      assert.equal(width, 58, 'PRI');
    } finally {
      await h.close();
    }
  });
});

void describe('the List’s DUE column paints no box (LAI-710)', () => {
  void test('the DUE cell is transparent in both themes; the status pill keeps its box', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      const first = h.page.locator('.list-row').first();
      const bg = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
      for (const theme of ['Dark', 'Light']) {
        await setTheme(h.page, theme);
        await h.page.waitForTimeout(200);
        assert.equal(
          await bg(first.locator('.list-due')),
          'rgba(0, 0, 0, 0)',
          `${theme}: the DUE cell paints the pill's box down the column`,
        );
        // Positive control: the tone class is still painting where it should.
        assert.notEqual(
          await bg(first.locator('.list-status')),
          'rgba(0, 0, 0, 0)',
          `${theme}: the status pill lost its box — this proves nothing`,
        );
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the task view draws the icon beside the priority control (LAI-705)', () => {
  void test('each level its own glyph, name and colour, before the select, in both themes', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      for (const theme of ['dark', 'light']) {
        // The task view covers the theme switch, so the theme is set on the
        // board and the task opened after (task-panel.test.ts's pattern).
        await h.page.goto(`${h.origin}/board?project=laika-core`);
        await h.page.locator('article.card').first().waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);

        for (const l of LEVELS) {
          const at = `task view, ${theme}, ${l.key}`;
          await h.page.goto(`${h.origin}/board?project=laika-core&task=${l.id}`);
          await h.page.locator('.panel-meta').waitFor({ timeout: 20_000 });
          const value = h.page.locator('.meta-value-prio');
          // The control is the app's dropdown since LAI-726.
          assert.equal(
            await valueOf(value.locator('[role="combobox"]')),
            l.level,
            `${at}: wrong value`,
          );

          const icon = await drawn(value.locator('.priority-icon'));
          assert.equal(icon.level, l.level, `${at}: wrong level`);
          assert.equal(
            icon.shape,
            l.shape,
            `${at}: ${l.level} should draw ${l.shape}, drew ${icon.shape}`,
          );
          assert.equal(icon.label, `Priority: ${l.name}`, `${at}: wrong accessible name`);
          assert.equal(icon.title, `Priority: ${l.name}`, `${at}: wrong <title>`);
          assert.equal(icon.color, await resolved(h.page, l.token), `${at}: not ${l.token}`);

          // The select is still labelled "Priority" alone: the icon sits
          // outside the <label>, so its own name does not join the control's.
          assert.equal(
            await h.page.getByRole('combobox', { name: 'Priority', exact: true }).count(),
            1,
            `${at}: the priority select lost its name`,
          );

          // Before the select, and on its line. Both boxes in one frame: the
          // drawer may still be sliding in, and two reads would straddle it.
          // And the select is exactly as wide as the same control with no
          // icon beside it, which is what it was before LAI-705: a flex row
          // here once clipped `P2` to `P` and every other check stayed green.
          const { before, gap, width, natural } = await value.evaluate((el) => {
            const i = el.querySelector('.priority-icon')?.getBoundingClientRect();
            const s = el.querySelector('[role="combobox"]')?.getBoundingClientRect();
            const label = el.querySelector('label');
            if (i === undefined || s === undefined || label === null)
              throw new Error('not laid out');
            const probe = document.createElement('div');
            probe.className = 'meta-value';
            probe.append(label.cloneNode(true));
            el.after(probe);
            const alone =
              probe.querySelector('[role="combobox"]')?.getBoundingClientRect().width ?? -1;
            probe.remove();
            return {
              before: i.right <= s.left + 1,
              gap: Math.abs(i.top + i.height / 2 - (s.top + s.height / 2)),
              width: s.width,
              natural: alone,
            };
          });
          assert.ok(before, `${at}: the icon is not before the select`);
          assert.ok(gap <= 2, `${at}: the icon sits ${String(gap)}px off the select's centre`);
          assert.ok(
            Math.abs(width - natural) < 0.5,
            `${at}: the select is ${String(width)}px beside the icon, ${String(natural)}px alone`,
          );
        }
      }
    } finally {
      await h.close();
    }
  });
});
