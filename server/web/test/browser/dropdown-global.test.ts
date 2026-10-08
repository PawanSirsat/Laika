/**
 * The app's own dropdown everywhere a native `<select>` used to be (LAI-726).
 *
 * The Filter popover has its own file (`filter-dropdown.test.ts`). This one
 * drives the control in the other kinds of place it now lives, each of which
 * can break it differently:
 *
 * - **a modal dialog** that closes on Escape — Escape must close only the
 *   dropdown, and its portalled panel must draw above the dialog;
 * - **a composer inside a lane** that closes on Escape and posts what was
 *   chosen;
 * - **a board card**, whose keyboard-only move control is clipped until
 *   focused, and whose own click opens the task — an option's click must not;
 * - **a form field** (`Select`), named and opened by its `<label>`.
 *
 * Every test here fails on the code before LAI-726: there is no
 * `role="listbox"` panel to open, which the first step of each asserts.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator } from 'playwright';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';
import { pick, valueOf } from './dropdown.ts';

const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const FULL_PROJECT = {
  ...PROJECT,
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada' }],
  last_activity_at: 2,
};

const TASK = {
  id: 't1',
  key: 'LAI-1',
  project_id: 'p1',
  number: 1,
  title: 'Something already on the board',
  description_md: null,
  acceptance_md: null,
  status: 'todo',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: true,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: 1,
};

const column = (id: string, name: string, position: number, statuses: string[]) => ({
  id,
  project_id: 'p1',
  name,
  position,
  hidden: false,
  statuses,
  primary_status: statuses[0] ?? null,
});

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [FULL_PROJECT], next_cursor: null },
  '/api/v1/projects/laika-core': FULL_PROJECT,
  '/api/v1/projects/laika-core/board-columns': {
    columns: [
      column('c1', 'To do', 0, ['todo', 'backlog']),
      column('c2', 'In progress', 1, ['in_progress']),
      column('c3', 'Done', 2, ['done']),
    ],
  },
  '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
  '/api/v1/tasks/t1/status': { ...TASK, status: 'done' },
  // The task drawer, for the scroll and modal tests (review, round 1).
  '/api/v1/tasks/t1': TASK,
  '/api/v1/tasks/t1/comments': { data: [], next_cursor: null },
  '/api/v1/tasks/t1/watchers': { watchers: [] },
  '/api/v1/tasks/t1/dependencies': TASK,
  '/api/v1/projects/laika-core/mentionable': { users: [{ id: 'u1', name: 'Ada' }] },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada', email: 'a@example.com', role: 'lead', created_at: 1 }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/presence': { data: [], next_cursor: null },
};

void after(async () => {
  await closeBrowser();
});

const panel = (h: Harness) => h.page.locator('[data-dropdown-panel]');

const isFocused = (l: Locator): Promise<boolean> =>
  l.evaluate((el) => el === document.activeElement);

/** The panel is a listbox and is the thing actually drawn at its own centre. */
async function assertOnTop(h: Harness, what: string): Promise<void> {
  assert.equal(await panel(h).getByRole('listbox').count(), 1, `${what}: no listbox panel`);
  const onTop = await panel(h).evaluate((p) => {
    const r = p.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && p.contains(hit);
  });
  assert.equal(onTop, true, `${what}: the panel is drawn under something`);
}

/**
 * **Inside the modal, and still where it should be** (review, round 1). A
 * panel portalled to `<body>` sits outside an `aria-modal="true"` dialog,
 * which tells a screen reader to ignore everything outside it — the list
 * would be there for the eye and gone for the ear. Drawn inside the dialog,
 * it must still meet its trigger and not be clipped by it.
 */
async function assertInModalAndPlaced(h: Harness, trigger: Locator, what: string): Promise<void> {
  const g = await panel(h).evaluate((p) => {
    const modal = p.closest('[aria-modal="true"]');
    const r = p.getBoundingClientRect();
    return {
      inModal: modal !== null,
      side: (p as HTMLElement).dataset.side,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
    };
  });
  const t = await trigger.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, vw: innerWidth };
  });
  assert.equal(g.inModal, true, `${what}: the panel is outside the aria-modal dialog`);
  if (g.side === 'below') {
    assert.ok(
      Math.abs(g.top - (t.bottom + 4)) <= 1,
      `${what}: ${String(g.top)} is not under ${String(t.bottom)}`,
    );
  } else {
    assert.ok(
      Math.abs(g.bottom - (t.top - 4)) <= 1,
      `${what}: ${String(g.bottom)} is not over ${String(t.top)}`,
    );
  }
  /*
   * **Across, too** (review, round 2): left-aligned with the trigger, slid
   * back only as far as keeps it 8px inside the window. The panel's narrowest
   * is the trigger's width or 160px, whichever is wider. This used to accept
   * any left past 8px — a panel 300px off its trigger passed.
   */
  const narrowest = Math.min(Math.max(t.width, 160), t.vw - 16);
  const expected = Math.max(8, Math.min(t.left, t.vw - 8 - narrowest));
  assert.ok(
    Math.abs(g.left - expected) <= 1,
    `${what}: the panel's left is ${String(g.left)}, its trigger's ${String(t.left)} (expected ${String(expected)})`,
  );
  await assertOnTop(h, what);
}

void describe('the dropdown in a modal dialog (LAI-726)', () => {
  void test('Escape closes only the dropdown, and choosing keeps the dialog open', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.lane-title').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.lane-new').click();
      const dialog = h.page.getByRole('dialog', { name: 'Create status' });
      await dialog.waitFor({ timeout: 5_000 });

      // Named by its <label>, hint and all — as the <select> was.
      const category = dialog.getByRole('combobox', { name: /^Status category/ });
      await category.click();
      await assertOnTop(h, 'over the dialog');
      await assertInModalAndPlaced(h, category, 'the new-column dialog');

      await h.page.keyboard.press('Escape');
      assert.equal(await panel(h).count(), 0, 'Escape left the dropdown open');
      assert.equal(await dialog.count(), 1, 'Escape closed the dialog with the dropdown');
      assert.equal(await isFocused(category), true, 'focus did not return to the trigger');

      await pick(category, '');
      assert.equal(await valueOf(category), '');
      assert.equal((await category.innerText()).trim(), 'Nothing yet');
      assert.equal(await dialog.count(), 1, 'choosing an option closed the dialog');

      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown in a lane’s composer (LAI-726)', () => {
  void test('Escape keeps the composer, and the chosen priority is the one posted', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.lane-title').first().waitFor({ timeout: 20_000 });
      await h.page
        .locator('.lane', { has: h.page.locator('.lane-title', { hasText: 'Done' }) })
        .locator('.lane-add')
        .click();
      await h.page.locator('.composer-title').fill('A finished thing');

      const priority = h.page.locator('.composer-prio').getByRole('combobox');
      await priority.click();
      await assertOnTop(h, 'over the board');
      await h.page.keyboard.press('Escape');
      assert.equal(await panel(h).count(), 0, 'Escape left the dropdown open');
      assert.equal(
        await h.page.locator('.composer-title').count(),
        1,
        'Escape closed the composer',
      );

      await pick(priority, 'p1');
      await h.page.locator('.composer-submit').click();
      await h.page
        .waitForFunction(() => document.querySelector('.composer-title') === null, undefined, {
          timeout: 5_000,
        })
        .catch(() => undefined);
      const sent = h.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tasks'));
      assert.equal(sent.length, 1, 'no create was sent');
      assert.equal((sent[0]?.body as { priority?: string }).priority, 'p1');
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown on a board card (LAI-726)', () => {
  void test('the keyboard move control moves the task and does not open it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      const move = h.page.getByRole('combobox', { name: 'Move LAI-1 to', exact: true });

      // From the keyboard, the only way it is reached.
      await move.focus();
      await h.page.keyboard.press('ArrowDown');
      await assertOnTop(h, 'over the lanes');
      assert.equal(await isFocused(move), true, 'opening moved focus off the card control');

      // An option's click: the card's own click must not take it.
      await panel(h).locator('[role="option"][data-value="done"]').click();
      await h.page.waitForFunction(
        () => document.querySelector('[data-dropdown-panel]') === null,
        undefined,
        { timeout: 5_000 },
      );
      const moves = h.calls.filter(
        (c) => c.method === 'POST' && c.path === '/api/v1/tasks/t1/status',
      );
      assert.equal(moves.length, 1, 'no move was sent');
      assert.equal((moves[0]?.body as { status?: string }).status, 'done');
      assert.equal(
        new URL(h.page.url()).searchParams.get('task'),
        null,
        'choosing an option opened the task',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown as a form field (LAI-726)', () => {
  void test('its label names and opens it, and the choice is what the form sends', async () => {
    const h = await open('/projects', STUB);
    try {
      await h.page.getByRole('button', { name: 'New space' }).click();
      const visibility = h.page.getByRole('combobox', { name: 'Visibility', exact: true });
      await visibility.waitFor({ timeout: 10_000 });

      // A click on the words opens it, as it focused the <select>.
      await h.page.locator('label', { hasText: 'Visibility' }).click();
      await assertOnTop(h, 'in the form');
      await panel(h).locator('[role="option"][data-value="public"]').click();
      assert.equal(await valueOf(visibility), 'public');
      assert.match(await visibility.innerText(), /Public/);

      await h.page.getByRole('textbox', { name: 'Name', exact: true }).fill('Routing');
      await h.page.getByRole('button', { name: 'Create project' }).click();
      await h.page
        .waitForFunction(() => document.querySelector('[aria-busy="true"]') === null)
        .catch(() => undefined);
      const posted = h.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/projects');
      assert.equal(posted.length, 1, 'no project was posted');
      assert.equal((posted[0]?.body as { visibility?: string }).visibility, 'public');
    } finally {
      await h.close();
    }
  });
});

void describe('the dropdown in the task drawer (LAI-726 round 1)', () => {
  const openDrawer = async (h: Harness): Promise<Locator> => {
    await h.page.locator('.drawer').waitFor({ timeout: 20_000 });
    const status = h.page.locator('.drawer').getByRole('combobox', { name: 'Status', exact: true });
    await status.waitFor({ timeout: 10_000 });
    return status;
  };

  void test('opens inside the drawer’s modal panel, placed against its trigger', async () => {
    const h = await open('/board?project=laika-core&task=t1', STUB);
    try {
      const status = await openDrawer(h);
      await status.click();
      await assertInModalAndPlaced(h, status, 'the task drawer');
      /*
       * And once the drawer's 0.2s rise is over (round 2): the rise is a
       * transform, so a panel opened during it was placed inside a
       * containing block that then went away.
       */
      await h.page.waitForFunction(() => {
        const d = document.querySelector('.drawer');
        return d?.getAnimations().every((a) => a.playState === 'finished') === true;
      });
      assert.equal(
        await h.page.locator('.drawer').evaluate((d) => getComputedStyle(d).transform),
        'none',
        'the drawer kept a transform after its rise, and contains the panel',
      );
      await assertInModalAndPlaced(h, status, 'the task drawer, after its rise');
    } finally {
      await h.close();
    }
  });

  /*
   * **A scroll under the panel closes it** (review, round 1), as a native
   * select's does. It used to re-place itself on every scroll and follow the
   * trigger off the screen — measured at top: −234px in this drawer.
   */
  void test('closes when the drawer scrolls under it', async () => {
    const h = await open('/board?project=laika-core&task=t1', STUB);
    try {
      // Short enough that the drawer's content scrolls.
      await h.page.setViewportSize({ width: 1280, height: 420 });
      const status = await openDrawer(h);
      await status.click();
      await panel(h).waitFor({ timeout: 5_000 });

      const scrolled = await status.evaluate((el) => {
        let node: HTMLElement | null = el.parentElement;
        while (node !== null) {
          const style = getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
            const before = node.scrollTop;
            node.scrollTop = before + 120;
            return node.scrollTop - before;
          }
          node = node.parentElement;
        }
        return 0;
      });
      assert.ok(scrolled > 0, 'positive control: something under the trigger scrolled');
      await h.page
        .waitForFunction(
          () => document.querySelector('[data-dropdown-panel]') === null,
          undefined,
          {
            timeout: 3_000,
          },
        )
        .catch(() => undefined);
      const left = await h.page.evaluate(() => {
        const p = document.querySelector('[data-dropdown-panel]');
        return p === null ? null : p.getBoundingClientRect().top;
      });
      assert.equal(left, null, `the panel stayed open after the scroll, at top ${String(left)}`);
      assert.equal(await status.getAttribute('aria-expanded'), 'false');
    } finally {
      await h.close();
    }
  });
});

/*
 * **Both column dialogs are centred, and their scrims cover the window**
 * (review, round 2 — blocking). Round 1 centred `.column-dialog` with
 * `inset: 0; margin: auto`, and `NewColumnDialog` rendered as a child of
 * `.board`, whose children all get an 18px side margin that outranks
 * `margin: auto` — so "Create status" sat against the left edge (x=18 at
 * 1366, where ec1281a had 492) and its scrim left undimmed strips at both
 * sides. Measured at a laptop, a 900px window and a phone.
 */
void describe('the column dialogs (LAI-726 round 2)', () => {
  const DIALOGS = [
    {
      name: 'Create status',
      open: async (h: Harness) => {
        await h.page.locator('.lane-new').click();
      },
    },
    {
      name: 'Configure To do',
      open: async (h: Harness) => {
        const menu = h.page.getByRole('button', { name: 'Configure To do', exact: true });
        await menu.focus();
        await menu.click();
      },
    },
  ] as const;

  for (const [width, height] of [
    [1366, 768],
    [900, 700],
    [390, 800],
  ] as const) {
    void test(`are centred with a full-window scrim at ${String(width)}×${String(height)}`, async () => {
      const h = await open('/board?project=laika-core', STUB);
      try {
        await h.page.setViewportSize({ width, height });
        await h.page.locator('.lane-title').first().waitFor({ timeout: 20_000 });
        for (const dialog of DIALOGS) {
          await dialog.open(h);
          const box = h.page.getByRole('dialog', { name: dialog.name, exact: true });
          await box.waitFor({ timeout: 5_000 });
          const g = await box.evaluate((el) => {
            const r = el.getBoundingClientRect();
            // The scrim drawn with this dialog: its sibling.
            const scrim = el.parentElement?.querySelector('.column-dialog-scrim');
            const s = scrim?.getBoundingClientRect();
            return {
              left: r.left,
              right: innerWidth - r.right,
              top: r.top,
              bottom: innerHeight - r.bottom,
              scrim:
                s === undefined
                  ? null
                  : { left: s.left, top: s.top, right: s.right, bottom: s.bottom },
              vw: innerWidth,
              vh: innerHeight,
            };
          });
          const at = `${dialog.name} at ${String(width)}`;
          assert.ok(g.left >= 0 && g.right >= 0, `${at}: off the side, ${JSON.stringify(g)}`);
          assert.ok(
            Math.abs(g.left - g.right) <= 1,
            `${at}: not centred across — ${String(g.left)}px left, ${String(g.right)}px right`,
          );
          assert.ok(
            Math.abs(g.top - g.bottom) <= 1,
            `${at}: not centred down — ${String(g.top)}px above, ${String(g.bottom)}px below`,
          );
          assert.ok(g.scrim !== null, `${at}: no scrim beside the dialog`);
          assert.deepEqual(
            g.scrim,
            { left: 0, top: 0, right: g.vw, bottom: g.vh },
            `${at}: the scrim leaves part of the window undimmed`,
          );
          await h.page.keyboard.press('Escape');
          await box.waitFor({ state: 'detached', timeout: 5_000 });
        }
      } finally {
        await h.close();
      }
    });
  }
});

/*
 * **A press that drags off the trigger is over when the pointer lifts**
 * (review, round 2). `pressing` was cleared only by the search box's blur or
 * the trigger's click, so a press dragged off the trigger left it set, and
 * the next blur of the search box — focus going anywhere — was ignored and
 * left the panel open.
 */
void describe('a press dragged off the trigger (LAI-726 round 2)', () => {
  void test('does not stop the next blur from closing the panel', async () => {
    const h = await open('/board?project=laika-core&task=t1', {
      ...STUB,
      // Enough people that Assignee searches (more than eight options).
      '/api/v1/projects/laika-core/members': {
        members: Array.from({ length: 9 }, (_, i) => ({
          user_id: `u${String(i + 1)}`,
          name: `Person ${String(i + 1)}`,
          email: `p${String(i + 1)}@example.com`,
          role: i === 0 ? 'lead' : 'member',
          created_at: 1,
        })),
      },
    });
    try {
      await h.page.locator('.drawer').waitFor({ timeout: 20_000 });
      const assignee = h.page
        .locator('.drawer .meta-person')
        .getByRole('combobox', { name: 'Assignee', exact: true });
      await assignee.click();
      await panel(h).locator('.dd-search-input').waitFor({ timeout: 5_000 });

      await assignee.evaluate(async (trigger) => {
        const tick = () => new Promise((done) => setTimeout(done, 0));
        const at = trigger.getBoundingClientRect();
        const on = { bubbles: true, cancelable: true, clientX: at.left + 4, clientY: at.top + 4 };
        const off = { bubbles: true, cancelable: true, clientX: 2, clientY: 2 };
        // Pressed on the trigger, dragged away, released elsewhere: no click.
        trigger.dispatchEvent(new PointerEvent('pointerdown', { ...on, pointerType: 'mouse' }));
        trigger.dispatchEvent(new MouseEvent('mousedown', on));
        await tick();
        document.body.dispatchEvent(
          new PointerEvent('pointerup', { ...off, pointerType: 'mouse' }),
        );
        document.body.dispatchEvent(new MouseEvent('mouseup', off));
        await tick();
        // Later, focus leaves the search box for nowhere in particular.
        document.querySelector<HTMLElement>('[data-dropdown-panel] .dd-search-input')!.blur();
        await tick();
      });
      assert.equal(
        await panel(h).count(),
        0,
        'the panel stayed open: a press that never became a click still swallowed the blur',
      );
    } finally {
      await h.close();
    }
  });
});
