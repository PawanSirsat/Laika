/**
 * The shared `⋯` menu and status chip (LAI-1044), in a real browser, on their
 * `/design/states` specimen.
 *
 * What is asserted is where focus is after each key, because that is what a
 * keyboard reader lives with: on an item while the menu is open, back on the
 * `⋯` button after `Escape` or a choice, and moved on — not stranded on
 * `body` — after `Tab`. The arithmetic of which item is next is pinned in
 * `test/components/wizard/overflow-menu-model.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, setTheme, type Harness } from './harness.ts';

async function gallery(): Promise<Harness> {
  const h = await open('/design/states', {});
  await h.page.locator('[data-wizard-gallery]').waitFor({ timeout: 20_000 });
  return h;
}

const BUTTON = 'More actions for the example row';

/** What has focus, in words a failure can be read by. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'body';
    const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
    return `${el.getAttribute('role') ?? el.tagName.toLowerCase()}:${name}`;
  });
}

async function focusButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: BUTTON }).focus();
}

const menu = (page: Page) => page.getByRole('menu', { name: BUTTON });

after(async () => {
  await closeBrowser();
});

void describe('the overflow menu (LAI-1044)', () => {
  void test('Enter opens it on the first item and says it is expanded', async () => {
    const h = await gallery();
    try {
      const button = h.page.getByRole('button', { name: BUTTON });
      assert.equal(await button.getAttribute('aria-haspopup'), 'menu');
      assert.equal(await button.getAttribute('aria-expanded'), 'false');
      await focusButton(h.page);
      await h.page.keyboard.press('Enter');
      await menu(h.page).waitFor();
      assert.equal(await button.getAttribute('aria-expanded'), 'true');
      assert.equal(
        await button.getAttribute('aria-controls'),
        await menu(h.page).getAttribute('id'),
      );
      assert.equal(await focused(h.page), 'menuitem:Reconnect');
    } finally {
      await h.close();
    }
  });

  void test('Space opens it too, and ArrowUp on the button opens it on the last item', async () => {
    const h = await gallery();
    try {
      await focusButton(h.page);
      await h.page.keyboard.press(' ');
      await menu(h.page).waitFor();
      assert.equal(await focused(h.page), 'menuitem:Reconnect');
      await h.page.keyboard.press('Escape');
      await h.page.keyboard.press('ArrowUp');
      await menu(h.page).waitFor();
      assert.equal(await focused(h.page), 'menuitem:Disconnect');
    } finally {
      await h.close();
    }
  });

  void test('the arrows walk the enabled items, skip the disabled one, and wrap', async () => {
    const h = await gallery();
    try {
      await focusButton(h.page);
      await h.page.keyboard.press('ArrowDown');
      await menu(h.page).waitFor();
      const seen: string[] = [await focused(h.page)];
      for (let i = 0; i < 3; i++) {
        await h.page.keyboard.press('ArrowDown');
        seen.push(await focused(h.page));
      }
      assert.deepEqual(seen, [
        'menuitem:Reconnect',
        'menuitem:Show details',
        'menuitem:Disconnect',
        'menuitem:Reconnect',
      ]);
      await h.page.keyboard.press('ArrowUp');
      assert.equal(await focused(h.page), 'menuitem:Disconnect');
      await h.page.keyboard.press('Home');
      assert.equal(await focused(h.page), 'menuitem:Reconnect');
      await h.page.keyboard.press('End');
      assert.equal(await focused(h.page), 'menuitem:Disconnect');
      assert.equal(
        await h.page.getByRole('menuitem', { name: 'Rename' }).isDisabled(),
        true,
        'the disabled item is not disabled',
      );
    } finally {
      await h.close();
    }
  });

  void test('Escape closes it and gives focus back to the button', async () => {
    const h = await gallery();
    try {
      await focusButton(h.page);
      await h.page.keyboard.press('ArrowDown');
      await menu(h.page).waitFor();
      await h.page.keyboard.press('ArrowDown');
      await h.page.keyboard.press('Escape');
      await menu(h.page).waitFor({ state: 'detached' });
      assert.equal(await focused(h.page), `button:${BUTTON}`);
      assert.equal(
        await h.page.getByRole('button', { name: BUTTON }).getAttribute('aria-expanded'),
        'false',
      );
    } finally {
      await h.close();
    }
  });

  void test('Tab closes it and moves on to the next control, not to the page body', async () => {
    const h = await gallery();
    try {
      await focusButton(h.page);
      await h.page.keyboard.press('ArrowDown');
      await menu(h.page).waitFor();
      await h.page.keyboard.press('Tab');
      await menu(h.page).waitFor({ state: 'detached' });
      assert.equal(await focused(h.page), 'button:After the menu');
    } finally {
      await h.close();
    }
  });

  void test('choosing an item runs it, closes the menu and returns focus', async () => {
    const h = await gallery();
    try {
      await focusButton(h.page);
      await h.page.keyboard.press('ArrowDown');
      await menu(h.page).waitFor();
      await h.page.keyboard.press('End');
      await h.page.keyboard.press('Enter');
      await menu(h.page).waitFor({ state: 'detached' });
      assert.equal(await h.page.locator('[data-chosen]').innerText(), 'Chosen: Disconnect');
      assert.equal(await focused(h.page), `button:${BUTTON}`);
    } finally {
      await h.close();
    }
  });

  void test('a click outside closes it', async () => {
    const h = await gallery();
    try {
      await h.page.getByRole('button', { name: BUTTON }).click();
      await menu(h.page).waitFor();
      await h.page.locator('#wizard-gallery-heading').click();
      await menu(h.page).waitFor({ state: 'detached' });
      assert.equal(await h.page.locator('[data-chosen]').innerText(), 'Nothing chosen yet');
    } finally {
      await h.close();
    }
  });
});

void describe('the status chip (LAI-1044)', () => {
  for (const theme of ['light', 'dark']) {
    void test(`every tone carries its word, and its own token colours, in ${theme}`, async () => {
      const h = await gallery();
      try {
        await setTheme(h.page, theme);
        const chips = await h.page.locator('.status-chip').evaluateAll((els) =>
          els.map((el) => {
            const dot = el.querySelector('.status-chip-dot');
            return {
              tone: el.getAttribute('data-tone'),
              word: el.querySelector('.status-chip-word')?.textContent ?? '',
              background: getComputedStyle(el).backgroundColor,
              dot: dot === null ? '' : getComputedStyle(dot).backgroundColor,
              dotHidden: dot?.getAttribute('aria-hidden') === 'true',
            };
          }),
        );
        assert.deepEqual(
          chips.map((c) => c.tone),
          ['ok', 'waiting', 'warn', 'danger', 'neutral'],
        );
        for (const c of chips) {
          assert.ok(c.word.trim() !== '', `the ${String(c.tone)} chip has no word`);
          assert.ok(c.dotHidden, `the ${String(c.tone)} dot is announced`);
        }

        /*
         * Each tone's colours are the tokens it names, read off this theme's
         * root — not a colour typed into the stylesheet.
         */
        const tokens = await h.page.evaluate(() => {
          const probe = document.createElement('span');
          document.body.append(probe);
          const read = (name: string): string => {
            probe.style.backgroundColor = `var(${name})`;
            return getComputedStyle(probe).backgroundColor;
          };
          const out = {
            ok: [read('--chip-green-bg'), read('--chip-green')],
            waiting: [read('--chip-blue-bg'), read('--chip-blue')],
            warn: [read('--chip-orange-bg'), read('--chip-orange')],
            danger: [read('--blocked-bg'), read('--overdue')],
            neutral: [read('--chip-neutral-bg'), read('--chip-neutral')],
          };
          probe.remove();
          return out;
        });
        for (const c of chips) {
          const [bg, dot] = tokens[c.tone as keyof typeof tokens];
          assert.equal(c.background, bg, `${String(c.tone)} background is not its token`);
          assert.equal(c.dot, dot, `${String(c.tone)} dot is not its token`);
        }
        assert.equal(
          new Set(chips.map((c) => c.dot)).size,
          chips.length,
          'two tones share a dot colour',
        );
      } finally {
        await h.close();
      }
    });
  }
});
