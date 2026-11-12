/**
 * Dialogs with names, tooltips and reasons (LAI-1209), in a real browser and
 * under a strict CSP (`style-src-attr 'none'`):
 *
 * - every icon-only control in the Create task dialog and the Add column
 *   dialog has a name **and** the shared tooltip, shown on hover after the
 *   delay and on keyboard focus, with its shortcut where it has one;
 * - Escape closes the tooltip first and the dialog only on the next press;
 * - a disabled Create says why, in words linked to the button;
 * - info hints are described-by, pin on a click, and leave the essential
 *   line under Agent on screen;
 * - a long press on a touch screen shows the tooltip and swallows the click;
 * - typing hides a tooltip; the editor toolbar is one row at 1440 and 390,
 *   with the rest under *More formatting*, a menu the keyboard can drive.
 *
 * With `LAIKA_SHOTS` set, the Create task dialog — Create off with its
 * reason, the Agent hint pinned — lands there light and dark at 1440 and 390.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type Harness } from './harness.ts';
import { ADA, CORE, DIALOG, stub } from './create-task-fixtures.ts';

const SHOTS = process.env.LAIKA_SHOTS;

/** The server's policy with `style-src-attr` tightened to `'none'` (as tabs-tooltip.test.ts). */
const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

async function strictCsp(p: Page): Promise<void> {
  await p.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(
        `${event.violatedDirective} ${event.sourceFile}:${String(event.lineNumber)} ${event.sample}`,
      );
    });
  });
  await p.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': STRICT_CSP },
    });
  });
}

void after(async () => {
  await closeBrowser();
});

async function board(
  width: number,
  height: number,
  extra: Parameters<typeof stub>[1] = {},
): Promise<Harness> {
  const h = await open('/board?project=laika-core', stub(ADA, extra), {
    before: async (p) => {
      await p.setViewportSize({ width, height });
      await strictCsp(p);
    },
  });
  try {
    await h.page.locator('.space-bar').waitFor({ timeout: 20_000 });
  } catch (cause) {
    await h.close();
    throw cause;
  }
  return h;
}

/** The board with the Create task dialog open and its editor loaded. */
async function createTask(
  width = 1440,
  height = 900,
  extra: Parameters<typeof stub>[1] = {},
): Promise<Harness> {
  const h = await board(width, height, extra);
  try {
    await h.page.locator('.space-create').click();
    await h.page.locator(DIALOG).waitFor({ timeout: 5_000 });
    await h.page.locator(`${DIALOG} .rte-toolbar`).first().waitFor({ timeout: 10_000 });
  } catch (cause) {
    await h.close();
    throw cause;
  }
  return h;
}

/** The tooltip a control is described by — the one id of its `aria-describedby` that is a tooltip. */
async function tooltipOf(control: Locator): Promise<Locator> {
  const ids = ((await control.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const el = control.page().locator(`[id="${id}"]`);
    if ((await el.getAttribute('role')) === 'tooltip') return el;
  }
  throw new Error(`no tooltip describes ${await control.evaluate((el) => el.outerHTML)}`);
}

/**
 * Every visible control in `box` whose words are not its name — an icon, a
 * glyph, a `B` named *Bold* — that has no name, carries a bare `title`, or
 * has no tooltip. Comboboxes are named by their value and are left out.
 */
function unnamedOrUntipped(box: Locator): Promise<string[]> {
  return box.evaluate((root) =>
    [...root.querySelectorAll('button')]
      .filter((b) => b.getClientRects().length > 0 && b.getAttribute('role') !== 'combobox')
      .filter((b) => {
        const words = (b.textContent ?? '').trim();
        const named = b.getAttribute('aria-label') ?? '';
        return !/[\p{L}\p{N}]{2,}/u.test(words) || (named !== '' && named !== words);
      })
      .filter((b) => {
        const name = (b.getAttribute('aria-label') ?? '').trim();
        const tip = (b.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .some((id) => document.getElementById(id)?.getAttribute('role') === 'tooltip');
        return name === '' || b.hasAttribute('title') || !tip;
      })
      .map((b) => b.outerHTML.slice(0, 120)),
  );
}

const SHORTCUT = /^(⌘|Ctrl\+)/;

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

void describe('the Create task dialog (LAI-1209)', () => {
  void test('every icon-only control is named and tooltipped; hover after the delay, focus at once after it, with its shortcut', async () => {
    const h = await createTask();
    try {
      const box = h.page.locator(DIALOG);
      assert.deepEqual(
        await unnamedOrUntipped(box),
        [],
        'an icon-only control lacks a name or tooltip',
      );
      // The census saw the controls it is about — a broken page cannot pass it.
      for (const name of ['Close', 'Bold', 'Markdown source', 'More formatting', 'About Agent']) {
        assert.equal(await box.getByRole('button', { name, exact: true }).count(), 1, `no ${name}`);
      }

      // Hover: not at once, then after the delay — the name and its key.
      const close = box.getByRole('button', { name: 'Close', exact: true });
      const closeTip = await tooltipOf(close);
      assert.equal(await closeTip.isVisible(), false, 'shown before anyone asked');
      await close.hover();
      await h.page.waitForTimeout(150);
      assert.equal(await closeTip.isVisible(), false, 'shown before the delay');
      await closeTip.waitFor({ state: 'visible', timeout: 2_000 });
      assert.equal(await closeTip.locator('.tip-words').innerText(), 'Close');
      assert.equal(await closeTip.locator('.tip-kbd').innerText(), 'Esc');
      assert.equal(await close.getAttribute('aria-keyshortcuts'), 'Escape');
      // Above the dialog it describes: the element at its centre is the tooltip.
      const onTop = await closeTip.evaluate((tip) => {
        const r = tip.getBoundingClientRect();
        return tip.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      assert.equal(onTop, true, 'the tooltip is drawn under the dialog');

      // Keyboard focus shows a toolbar tool's tooltip, with the editor's own shortcut.
      await h.page.mouse.move(5, 5);
      const bold = box.getByRole('button', { name: 'Bold', exact: true });
      await bold.focus();
      const boldTip = await tooltipOf(bold);
      await boldTip.waitFor({ state: 'visible', timeout: 2_000 });
      assert.equal(await boldTip.locator('.tip-words').innerText(), 'Bold');
      assert.match(await boldTip.locator('.tip-kbd').innerText(), SHORTCUT);
      assert.match((await bold.getAttribute('aria-keyshortcuts')) ?? '', /^(Meta|Control)\+B$/);
      // Above the toolbar, so it never sits over the text being written.
      const [tipBox, barBox] = await Promise.all([
        boldTip.boundingBox(),
        box.locator('.rte-toolbar').first().boundingBox(),
      ]);
      assert.ok(tipBox !== null && barBox !== null);
      assert.ok(tipBox.y + tipBox.height <= barBox.y + 1, 'the tool tooltip covers the editor');

      assert.deepEqual(await violations(h.page), [], 'the dialog broke the strict CSP');
    } finally {
      await h.close();
    }
  });

  void test('Escape closes the tooltip first and the dialog on the next press', async () => {
    const h = await createTask();
    try {
      const box = h.page.locator(DIALOG);
      const close = box.getByRole('button', { name: 'Close', exact: true });
      const tip = await tooltipOf(close);
      // Past the Tooltip's arrival window (LAI-1214), as for Add column below.
      await h.page.waitForTimeout(400);
      await close.focus();
      await tip.waitFor({ state: 'visible', timeout: 2_000 });

      await h.page.keyboard.press('Escape');
      await tip.waitFor({ state: 'hidden', timeout: 2_000 });
      await h.page.waitForTimeout(300);
      assert.equal(await box.count(), 1, 'the first Escape closed the dialog, not the tooltip');
      assert.equal(await tip.isVisible(), false, 'the tooltip came back without leaving');

      await h.page.keyboard.press('Escape');
      await box.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await box.count(), 0, 'the second Escape did not close the dialog');
    } finally {
      await h.close();
    }
  });

  void test('a disabled Create says why, in words linked to it, and stops saying so once it can', async () => {
    const h = await createTask();
    try {
      const box = h.page.locator(DIALOG);
      const create = box.getByRole('button', { name: 'Create', exact: true });
      assert.equal(await create.getAttribute('aria-disabled'), 'true');
      // Reachable: a natively disabled button would be skipped by Tab.
      assert.equal(await create.evaluate((el) => (el as HTMLButtonElement).disabled), false);
      const ids = ((await create.getAttribute('aria-describedby')) ?? '').split(/\s+/);
      const reasons = await Promise.all(
        ids.map((id) =>
          h.page
            .locator(`[id="${id}"]`)
            .innerText()
            .catch(() => ''),
        ),
      );
      assert.ok(
        reasons.includes('Add a title to create'),
        `described by ${JSON.stringify(reasons)}`,
      );
      assert.equal(await box.getByText('Add a title to create', { exact: true }).isVisible(), true);

      await create.click({ force: true });
      await h.page.waitForTimeout(200);
      assert.equal(
        h.calls.some((c) => c.method === 'POST' && c.path.endsWith('/tasks')),
        false,
        'a disabled Create still created',
      );

      await h.page.locator('.ct-title-input').fill('Ship the dialog');
      await until(async () => (await create.getAttribute('aria-disabled')) === null);
      assert.equal(await box.getByText('Add a title to create', { exact: true }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('info hints are described-by, pin on a click, close on Escape before the dialog; the Agent line stays', async () => {
    const h = await createTask();
    try {
      const box = h.page.locator(DIALOG);
      // The essential line is still on screen, not moved into a hint.
      assert.equal(
        await box
          .getByText('Picking an agent sends it a work request.', { exact: false })
          .isVisible(),
        true,
      );

      for (const [name, words] of [
        ['About Agent', /coding agent you ask to do the work/],
        ['About Assignee', /accountable/],
        ['About Create another', /Keeps this dialog open after Create/],
      ] as const) {
        const hint = box.getByRole('button', { name, exact: true });
        assert.match((await (await tooltipOf(hint)).textContent()) ?? '', words, `${name} says`);
      }

      const hint = box.getByRole('button', { name: 'About Agent', exact: true });
      const tip = await tooltipOf(hint);
      await hint.click();
      await tip.waitFor({ state: 'visible', timeout: 2_000 });
      // Pinned: the pointer leaving does not close it.
      await h.page.mouse.move(5, 5);
      await h.page.waitForTimeout(500);
      assert.equal(await tip.isVisible(), true, 'a clicked hint closed when the pointer left');

      await h.page.keyboard.press('Escape');
      await tip.waitFor({ state: 'hidden', timeout: 2_000 });
      assert.equal(await box.count(), 1, 'Escape on a hint closed the dialog');

      // A second click on the hint puts it away again.
      await hint.click();
      await tip.waitFor({ state: 'visible', timeout: 2_000 });
      await hint.click();
      await tip.waitFor({ state: 'hidden', timeout: 2_000 });
    } finally {
      await h.close();
    }
  });

  void test('a long press on a touch screen shows the tooltip and swallows the click', async () => {
    const h = await createTask();
    try {
      const box = h.page.locator(DIALOG);
      const close = box.getByRole('button', { name: 'Close', exact: true });
      const tip = await tooltipOf(close);
      const touch = (type: string) =>
        close.evaluate((el, t) => {
          const r = el.getBoundingClientRect();
          const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true };
          if (t === 'click') el.dispatchEvent(new MouseEvent('click', at));
          else el.dispatchEvent(new PointerEvent(t, { ...at, pointerType: 'touch' }));
        }, type);

      await touch('pointerenter');
      await touch('pointerdown');
      await h.page.waitForTimeout(250);
      assert.equal(await tip.isVisible(), false, 'shown before the press was long');
      await tip.waitFor({ state: 'visible', timeout: 2_000 });
      await touch('pointerup');
      await touch('click');
      await h.page.waitForTimeout(300);
      assert.equal(await box.count(), 1, 'the lift after a long press closed the dialog');

      // A tap is still a tap.
      await touch('pointerdown');
      await touch('pointerup');
      await touch('click');
      await box.waitFor({ state: 'detached', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('typing into a field hides a tooltip the pointer left open', async () => {
    const h = await createTask();
    try {
      const box = h.page.locator(DIALOG);
      const close = box.getByRole('button', { name: 'Close', exact: true });
      const tip = await tooltipOf(close);
      await close.hover();
      await tip.waitFor({ state: 'visible', timeout: 2_000 });
      await h.page.locator('.ct-title-input').focus();
      await h.page.keyboard.type('a');
      await tip.waitFor({ state: 'hidden', timeout: 2_000 });
      assert.equal(await h.page.locator('.ct-title-input').inputValue(), 'a');
    } finally {
      await h.close();
    }
  });
  void test('Escape typed in a field is the field’s: the tooltip closes and the dialog gets the key', async () => {
    const h = await createTask();
    try {
      const box = h.page.locator(DIALOG);
      const close = box.getByRole('button', { name: 'Close', exact: true });
      const tip = await tooltipOf(close);
      await close.hover();
      await tip.waitFor({ state: 'visible', timeout: 2_000 });
      await h.page.locator('.ct-title-input').focus();
      await h.page.keyboard.press('Escape');
      // An empty draft closes at once: the dialog saw this Escape.
      await box.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await tip.isVisible(), false);
    } finally {
      await h.close();
    }
  });
});

/** The vertical centres of the toolbar's visible items, rounded: one value is one row. */
function rows(toolbar: Locator): Promise<number[]> {
  return toolbar.evaluate((bar) => [
    ...new Set(
      [...bar.children]
        .filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return Math.round((r.top + r.height / 2) / 8);
        }),
    ),
  ]);
}

void describe('the worst case (LAI-1209, break-ui)', () => {
  void test('a very long space name is cut in the header at 390; its colour and key stay', async () => {
    const name =
      'The Extraordinarily Long Space Name That Nobody Would Choose But Somebody Did Anyway 2026';
    const long = { ...CORE, name };
    const h = await createTask(390, 844, {
      '/api/v1/projects/laika-core': long,
      '/api/v1/projects': { data: [{ ...long, task_counts: {}, members: [] }], next_cursor: null },
    });
    try {
      const chip = h.page.locator(`${DIALOG} [data-space-chip]`);
      await chip.locator('.ct-space-key').waitFor({ timeout: 5_000 });
      const fit = await h.page.locator(`${DIALOG} .ct-head`).evaluate((head) => {
        const key = head.querySelector('.ct-space-key')?.getBoundingClientRect();
        const mark = head.querySelector('.ct-space-mark')?.getBoundingClientRect();
        const words = head.querySelector('.ct-space');
        return {
          overflows: head.scrollWidth > head.clientWidth,
          keyInside: key !== undefined && key.right <= head.getBoundingClientRect().right,
          markDrawn: mark !== undefined && mark.width > 0,
          cut: words !== null && words.scrollWidth > words.clientWidth,
        };
      });
      assert.deepEqual(fit, { overflows: false, keyInside: true, markDrawn: true, cut: true });
      assert.equal(
        await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        'the page scrolls sideways',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the editor toolbar fits (LAI-1209)', () => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    void test(`one row at ${String(width)}, the rest under More formatting`, async () => {
      const h = await createTask(width, height);
      try {
        // The Description's editor; Acceptance's sits folded under More.
        const toolbar = h.page.locator(`${DIALOG} .rte-toolbar`).first();
        assert.equal((await rows(toolbar)).length, 1, `the toolbar wraps at ${String(width)}`);
        const more = toolbar.getByRole('button', { name: 'More formatting', exact: true });
        await more.waitFor({ state: 'visible', timeout: 2_000 });
        await more.click();
        const menu = toolbar.getByRole('menu', { name: 'More formatting' });
        await menu.waitFor({ timeout: 2_000 });
        const names = (
          await menu.locator('[role^="menuitem"]:visible .rte-menu-label').allInnerTexts()
        ).map((t) => t.trim());
        // Nothing is in both places, and nothing in neither.
        for (const name of ['Table', 'Mention someone', 'Link a card']) {
          assert.ok(names.includes(name), `${name} is not under More at ${String(width)}`);
          assert.equal(
            await toolbar.getByRole('button', { name, exact: true }).count(),
            0,
            `${name} is on the bar and in the menu`,
          );
        }
        if (width === 390) {
          for (const name of ['Strikethrough', 'Quote', 'Code block', 'Checklist']) {
            assert.ok(names.includes(name), `${name} is not under More at 390`);
          }
        }
        await h.page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached', timeout: 2_000 });
      } finally {
        await h.close();
      }
    });
  }

  void test('More formatting by keyboard: opens on Enter with an item focused, arrows move, a choice formats, Escape closes only the menu', async () => {
    const h = await createTask(390, 844);
    try {
      const box = h.page.locator(DIALOG);
      const toolbar = box.locator('.rte-toolbar').first();
      const more = toolbar.getByRole('button', { name: 'More formatting', exact: true });
      await more.focus();
      await h.page.keyboard.press('Enter');
      const menu = toolbar.getByRole('menu', { name: 'More formatting' });
      await menu.waitFor({ timeout: 2_000 });
      await until(() => menu.evaluate((m) => m.contains(document.activeElement)));
      const first = await h.page.evaluate(() => document.activeElement?.textContent ?? '');
      await h.page.keyboard.press('ArrowDown');
      const second = await h.page.evaluate(() => document.activeElement?.textContent ?? '');
      assert.notEqual(first, second, 'ArrowDown did not move');

      // Escape: the menu closes, focus is back on ⋯, the dialog stays.
      await h.page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached', timeout: 2_000 });
      assert.equal(await more.evaluate((el) => el === document.activeElement), true);
      assert.equal(await box.count(), 1, 'Escape in the menu closed the dialog');

      // A choice from the menu formats the document.
      await box.locator('.rich-editor-doc').first().click();
      await h.page.keyboard.type('first item');
      await more.click();
      await menu.waitFor({ timeout: 2_000 });
      await menu.getByRole('menuitemcheckbox', { name: /Checklist/ }).click();
      await box.locator('.rich-editor-doc ul[data-type="taskList"]').waitFor({ timeout: 2_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('the shared Dialog (LAI-1209)', () => {
  void test('Add column: the close is named and tooltipped, Escape takes the tooltip first, a disabled Add says why', async () => {
    const h = await board(1440, 900);
    try {
      await h.page.locator('.lane-new').click();
      const dialog = h.page.getByRole('dialog', { name: 'Add column', exact: true });
      await dialog.waitFor({ timeout: 5_000 });
      assert.deepEqual(await unnamedOrUntipped(dialog), []);

      const add = dialog.getByRole('button', { name: 'Add column', exact: true });
      const reason = (await add.getAttribute('aria-describedby')) ?? '';
      assert.equal(
        await h.page.locator(`[id="${reason}"]`).innerText(),
        'Name the column to add it',
      );

      const close = dialog.getByRole('button', { name: 'Close', exact: true });
      const tip = await tooltipOf(close);
      // Past the Tooltip's arrival window (LAI-1214): focus that lands as the
      // dialog opens is its first focus, not the reader's, and shows nothing.
      await h.page.waitForTimeout(400);
      await close.focus();
      await tip.waitFor({ state: 'visible', timeout: 2_000 });
      assert.match(await tip.innerText(), /Close\s*Esc/);
      await h.page.keyboard.press('Escape');
      await tip.waitFor({ state: 'hidden', timeout: 2_000 });
      await h.page.waitForTimeout(300);
      assert.equal(await dialog.count(), 1, 'the first Escape closed the dialog');
      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5_000 });

      assert.deepEqual(await violations(h.page), [], 'the dialog broke the strict CSP');
    } finally {
      await h.close();
    }
  });
});

void describe('screenshots', () => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    void test(
      `Create task with its reason and a hint, both themes, at ${String(width)}`,
      {
        skip: SHOTS === undefined,
      },
      async () => {
        const h = await createTask(width, height);
        try {
          const box = h.page.locator(DIALOG);
          mkdirSync(SHOTS ?? '', { recursive: true });
          for (const theme of ['light', 'dark']) {
            await setTheme(h.page, theme);
            await new Promise((r) => setTimeout(r, 300));
            const hint = box.getByRole('button', { name: 'About Agent', exact: true });
            await hint.scrollIntoViewIfNeeded();
            await hint.click();
            await (await tooltipOf(hint)).waitFor({ state: 'visible', timeout: 2_000 });
            // Past its 120ms fade, so the shot shows it as it settles.
            await new Promise((r) => setTimeout(r, 300));
            await h.page.screenshot({
              path: join(SHOTS ?? '', `create-task-hint-${String(width)}-${theme}.png`),
            });
            await h.page.keyboard.press('Escape');
          }
        } finally {
          await h.close();
        }
      },
    );
  }
});
