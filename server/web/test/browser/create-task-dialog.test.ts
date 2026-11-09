/**
 * The Create task dialog's ways in and its shape (LAI-1167, D-145): the
 * bar's *+ Create*, the List's *Create task* row and the `c` key each open
 * one labelled modal; the key defers to typing and to the gate; `?new=task`
 * is honoured and then taken out of the address; Tab stays inside; Escape
 * gives focus back; on a phone the box is the screen.
 *
 * With `LAIKA_SHOTS` set, the open dialog lands there light and dark at
 * 1440 and 390, with *More* unfolded.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  navigateInApp,
  open,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';
import { ADA, adminsOnly, CORE, DIALOG, stub, task, TOMAS } from './create-task-fixtures.ts';

const SHOTS = process.env.LAIKA_SHOTS;

void after(async () => {
  await closeBrowser();
});

async function at(path: string, fixtures: ApiStub, width = 1440, height = 900): Promise<Harness> {
  const h = await open(path, fixtures);
  await h.page.setViewportSize({ width, height });
  await h.page.locator('.space-bar').waitFor({ timeout: 20_000 });
  return h;
}

const dialog = (h: Harness) => h.page.locator(DIALOG);

/** The Title field holds focus — `useDialogFocus`'s `initial`. */
async function titleFocused(h: Harness): Promise<boolean> {
  return h.page.evaluate(() => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement && el.classList.contains('ct-title-input');
  });
}

void describe('the Create task dialog opens from', () => {
  void test('the bar’s + Create: a labelled modal, focus on the Title', async () => {
    const h = await at('/board?project=laika-core', stub(ADA));
    try {
      await h.page.locator('.space-create').click();
      const box = dialog(h);
      await box.waitFor({ timeout: 5_000 });
      assert.equal(await box.getAttribute('role'), 'dialog');
      assert.equal(await box.getAttribute('aria-modal'), 'true');
      const labelledBy = (await box.getAttribute('aria-labelledby')) ?? '';
      assert.equal(
        (await h.page.locator(`[id="${labelledBy}"]`).innerText()).trim(),
        'Create task',
      );
      await until(() => titleFocused(h));
      assert.equal(await titleFocused(h), true, 'focus is not on the Title');
      // The URL did not change: the dialog is an action, not content.
      assert.equal(new URL(h.page.url()).searchParams.get('new'), null);
    } finally {
      await h.close();
    }
  });

  void test('the List’s Create task row', async () => {
    const h = await at('/list?project=laika-core', stub(ADA));
    try {
      await h.page.locator('.list-create').waitFor({ timeout: 20_000 });
      await h.page.locator('.list-create').click();
      await dialog(h).waitFor({ timeout: 5_000 });
      // Only one inline form existed before; none now.
      assert.equal(await h.page.locator('form.new-task').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the c key — and not Cmd+C, not while typing in the search, not a second time over a modal', async () => {
    // The Calendar: the bar draws its search on a view that does not claim the
    // filters for itself, as the board and the List do (LAI-293).
    const h = await at('/calendar?project=laika-core', stub(ADA));
    try {
      await h.page.locator('.space-create').waitFor({ timeout: 5_000 });
      await h.page.locator('.space-search input').waitFor({ timeout: 5_000 });
      await h.page.locator('body').click({ position: { x: 5, y: 5 } });

      // Cmd/Ctrl+c is the browser's copy.
      await h.page.keyboard.press('Meta+c');
      await h.page.keyboard.press('Control+c');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await dialog(h).count(), 0, 'a modified c opened it');

      // Typing a c into the top bar's search is a letter.
      const search = h.page.locator('.space-search input');
      await search.click();
      await h.page.keyboard.type('c');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await dialog(h).count(), 0, 'c typed in the search opened it');
      assert.equal(await search.inputValue(), 'c');
      await search.fill('');
      await h.page.keyboard.press('Escape');

      // A bare c from the page opens it.
      await h.page.locator('body').click({ position: { x: 5, y: 5 } });
      await h.page.keyboard.press('c');
      await dialog(h).waitFor({ timeout: 5_000 });
      await until(() => titleFocused(h));
      assert.equal(await titleFocused(h), true);

      // A c inside the open dialog is a letter in the Title, not a second dialog.
      await h.page.keyboard.type('c');
      assert.equal(await dialog(h).count(), 1);
      assert.equal(await h.page.locator('.ct-title-input').inputValue(), 'c');
    } finally {
      await h.close();
    }
  });

  void test('?new=task — the old + Create’s address — opens it and leaves the address', async () => {
    const h = await at('/board?project=laika-core&new=task', stub(ADA));
    try {
      await dialog(h).waitFor({ timeout: 10_000 });
      await until(() => !new URL(h.page.url()).searchParams.has('new'));
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('new'), null, `the address kept new=: ${url.search}`);
      assert.equal(url.searchParams.get('project'), 'laika-core');
    } finally {
      await h.close();
    }
  });
});

void describe('who may create (task_create_min_role: lead)', () => {
  const gated = (person: typeof ADA) =>
    stub(person, {
      '/api/v1/projects/laika-core': {
        ...(stub(person)['/api/v1/projects/laika-core'] as object),
        task_create_min_role: 'lead',
      },
      '/api/v1/permissions': adminsOnly(person),
    });

  void test('a member gets nothing from c or from ?new=task, and the address is still cleaned', async () => {
    const h = await at('/board?project=laika-core&new=task', gated(TOMAS));
    try {
      await until(() => !new URL(h.page.url()).searchParams.has('new'));
      assert.equal(new URL(h.page.url()).searchParams.get('new'), null);
      assert.equal(await dialog(h).count(), 0, '?new=task opened the dialog for a member');
      assert.equal(await h.page.locator('.space-create').count(), 0, 'Create is drawn');

      await h.page.locator('body').click({ position: { x: 5, y: 5 } });
      await h.page.keyboard.press('c');
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(await dialog(h).count(), 0, 'c opened the dialog for a member');
    } finally {
      await h.close();
    }
  });

  void test('the lead still has all three', async () => {
    const h = await at('/board?project=laika-core', gated(ADA));
    try {
      await h.page.locator('body').click({ position: { x: 5, y: 5 } });
      await h.page.keyboard.press('c');
      await dialog(h).waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('the dialog’s keyboard and shape', () => {
  void test('Tab stays inside, forty times each way; Escape closes and gives focus back to + Create', async () => {
    const h = await at('/board?project=laika-core', stub(ADA));
    try {
      await h.page.locator('.space-create').focus();
      await h.page.keyboard.press('Enter');
      const box = dialog(h);
      await box.waitFor({ timeout: 5_000 });
      // The editors arrive as their own chunk; wait for the first one, so the
      // walk below covers the controls that exist at rest.
      await box.locator('.rich-editor').first().waitFor({ timeout: 10_000 });

      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 40; i += 1) {
          await h.page.keyboard.press(key);
          assert.equal(
            await box.evaluate((el) => el.contains(document.activeElement)),
            true,
            `${key} ×${String(i + 1)} left the dialog`,
          );
        }
      }

      await h.page.keyboard.press('Escape');
      await box.waitFor({ state: 'detached' });
      await h.page.waitForFunction(
        () => document.querySelector('.space-create') === document.activeElement,
        undefined,
        { timeout: 5_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('Escape from inside the Description editor asks before discarding what was typed; Keep editing keeps it, Discard closes', async () => {
    const h = await at('/board?project=laika-core', stub(ADA));
    try {
      await h.page.locator('.space-create').click();
      const box = dialog(h);
      await box.waitFor({ timeout: 5_000 });
      const doc = box.locator('.rich-editor-doc').first();
      await doc.waitFor({ timeout: 10_000 });
      await doc.click();
      await h.page.keyboard.type('hello');
      await h.page.keyboard.press('Escape');
      // Something was typed (review round 1): the question, not a silent loss.
      const ask = h.page.locator('[data-confirm-dialog]');
      await ask.waitFor({ timeout: 5_000 });
      assert.match(await ask.innerText(), /Discard this task\?/);
      await ask.getByRole('button', { name: 'Keep editing' }).click();
      await ask.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await box.count(), 1, 'Keep editing closed the dialog');
      assert.match(await doc.innerText(), /hello/);

      await h.page.locator('.ct-title-input').fill('Keep?');
      await h.page.keyboard.press('Escape');
      await ask.waitFor({ timeout: 5_000 });
      await ask.getByRole('button', { name: 'Discard' }).click();
      await box.waitFor({ state: 'detached', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('the scrim asks too when something is typed, and an empty draft closes at once', async () => {
    const h = await at('/board?project=laika-core', stub(ADA));
    try {
      await h.page.locator('.space-create').click();
      const box = dialog(h);
      await box.waitFor({ timeout: 5_000 });
      await h.page.locator('.ct-title-input').fill('Typed');
      await h.page.locator('.ct-scrim').click({ position: { x: 5, y: 5 } });
      const ask = h.page.locator('[data-confirm-dialog]');
      await ask.waitFor({ timeout: 5_000 });
      await ask.getByRole('button', { name: 'Keep editing' }).click();
      await ask.waitFor({ state: 'detached', timeout: 5_000 });
      await h.page.locator('.ct-title-input').fill('');
      await h.page.locator('.ct-scrim').click({ position: { x: 5, y: 5 } });
      await box.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await ask.count(), 0, 'an empty draft was asked about');
    } finally {
      await h.close();
    }
  });

  void test('a change of space closes it: the draft belonged to the space it opened in', async () => {
    const SHELL = {
      ...CORE,
      id: 'laika-shell',
      slug: 'laika-shell',
      name: 'Laika Shell',
      prefix: 'LS',
    };
    const extra: ApiStub = {
      // A lead in both spaces, so the second one offers Create as well.
      '/api/v1/me': {
        ...ADA,
        memberships: [
          { project_id: 'laika-core', role: 'lead' },
          { project_id: 'laika-shell', role: 'lead' },
        ],
      },
      '/api/v1/projects': {
        data: [CORE, SHELL].map((p) => ({
          ...p,
          task_counts: { backlog: 0, todo: 1, in_progress: 0, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 1,
          members: [{ user_id: 'u1', name: 'Ada Lovelace' }],
          last_activity_at: 2,
        })),
        next_cursor: null,
      },
      '/api/v1/projects/laika-shell': SHELL,
      '/api/v1/projects/laika-shell/tasks': {
        data: [task(9, { project_id: 'laika-shell', key: 'LS-9' })],
        next_cursor: null,
      },
      '/api/v1/projects/laika-shell/members': {
        members: [
          {
            user_id: 'u1',
            name: 'Ada Lovelace',
            email: 'u1@example.com',
            role: 'lead',
            created_at: 1,
          },
        ],
      },
      '/api/v1/projects/laika-shell/sprints': { data: [], next_cursor: null },
      '/api/v1/projects/laika-shell/activity': { data: [], next_cursor: null },
      '/api/v1/projects/laika-shell/tags': { tags: [] },
    };
    const h = await at('/board?project=laika-core', stub(ADA, extra));
    try {
      await h.page.locator('.space-create').click();
      const box = dialog(h);
      await box.waitFor({ timeout: 5_000 });
      await h.page.locator('.ct-title-input').fill('For Core');
      await navigateInApp(h.page, '/board?project=laika-shell');
      await box.waitFor({ state: 'detached', timeout: 5_000 });
      // And the next one is the new space's, from nothing.
      await h.page.locator('.space-create').waitFor({ timeout: 10_000 });
      await h.page.locator('.space-create').click();
      await box.waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('.ct-title-input').inputValue(), '');
    } finally {
      await h.close();
    }
  });

  void test('on a phone the box is the whole screen; both themes paint it from tokens', async () => {
    const h = await at('/board?project=laika-core', stub(ADA), 390, 800);
    try {
      await h.page.locator('.space-create').click();
      const box = dialog(h);
      await box.waitFor({ timeout: 5_000 });
      const size = await box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, x: r.left, y: r.top, iw: innerWidth, ih: innerHeight };
      });
      assert.equal(size.x, 0);
      assert.equal(size.y, 0);
      assert.equal(
        size.w,
        size.iw,
        `the sheet is ${String(size.w)} wide on a ${String(size.iw)} screen`,
      );
      assert.equal(
        size.h,
        size.ih,
        `the sheet is ${String(size.h)} tall on a ${String(size.ih)} screen`,
      );

      // The footer is pinned to the box's foot, under the scrolling body.
      const foot = await box
        .locator('.ct-foot')
        .evaluate((el) => el.getBoundingClientRect().bottom);
      assert.ok(Math.abs(foot - size.ih) <= 1, `the footer ends at ${String(foot)}`);

      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const bg = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
        assert.match(bg, /^rgb\(/, `${theme}: the box has no opaque background — ${bg}`);
      }
    } finally {
      await h.close();
    }
  });
});

if (SHOTS !== undefined) {
  void describe('screenshots', () => {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      void test(`the open dialog, More unfolded, at ${String(width)}`, async () => {
        const h = await at('/board?project=laika-core', stub(ADA), width, height);
        try {
          await h.page.locator('.space-create').click();
          const box = dialog(h);
          await box.waitFor({ timeout: 5_000 });
          await box.locator('.rich-editor').first().waitFor({ timeout: 10_000 });
          await box.locator('.ct-more-summary').click();
          await box.locator('.rich-editor').nth(1).waitFor({ timeout: 10_000 });
          await h.page.locator('.ct-title-input').fill('Ship the dialog');
          mkdirSync(SHOTS, { recursive: true });
          const body = box.locator('.ct-body');
          for (const theme of ['light', 'dark']) {
            await setTheme(h.page, theme);
            // The editor box fades its background over `--transition` (120ms);
            // a shot taken at once catches it half-way between the themes.
            await new Promise((r) => setTimeout(r, 300));
            // The top of the form, then the fold and the foot.
            await body.evaluate((el) => {
              el.scrollTop = 0;
            });
            await h.page.screenshot({
              path: join(SHOTS, `create-task-${String(width)}-${theme}.png`),
              fullPage: false,
            });
            await body.evaluate((el) => {
              el.scrollTop = el.scrollHeight;
            });
            await h.page.screenshot({
              path: join(SHOTS, `create-task-${String(width)}-${theme}-more.png`),
              fullPage: false,
            });
          }
        } finally {
          await h.close();
        }
      });
    }
  });
}
