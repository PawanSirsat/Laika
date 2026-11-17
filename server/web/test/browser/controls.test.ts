/**
 * Button, IconButton, the fields and Icon in a real browser (LAI-1204), on
 * their `/design/states` specimen.
 *
 * What is asserted is what only a browser can show: a height, where the focus
 * is after a press, a click that did or did not land, a hit area, a colour in
 * each theme. The rules behind them are pinned without a browser in
 * `test/components/forms/button-model.test.ts` and `field-model.test.ts`.
 *
 * `until` returns quietly on timeout, so every wait is followed by the
 * assertion it was waiting for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, open, setTheme, until, type Harness } from './harness.ts';

async function gallery(width = 1440): Promise<Harness> {
  const h = await open('/design/states', {});
  await h.page.setViewportSize({ width, height: 900 });
  await h.page.locator('[data-controls-gallery]').waitFor({ timeout: 20_000 });
  return h;
}

const cg = (page: Page, name: string): Locator => page.locator(`[data-cg="${name}"]`);

async function height(l: Locator): Promise<number> {
  const box = await l.boundingBox();
  assert.ok(box !== null, 'not laid out');
  return Math.round(box.height);
}

async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'body';
    return el.getAttribute('data-cg') ?? el.id ?? el.tagName.toLowerCase();
  });
}

async function presses(page: Page): Promise<number> {
  return Number(await page.locator('[data-cg-presses]').getAttribute('data-cg-presses'));
}

after(async () => {
  await closeBrowser();
});

void describe('sizes and density', () => {
  void test('a md button is a text field’s height; sm and compact step down', async () => {
    const h = await gallery();
    try {
      const md = h.page.locator('[data-cg-size="md"] .button').first();
      const sm = h.page.locator('[data-cg-size="sm"] .button').first();
      const input = h.page.locator('#cg-name');
      assert.equal(await height(md), 36);
      assert.equal(await height(input), 36, 'the field and the button no longer line up');
      assert.equal(await height(sm), 28);

      const compact = h.page.locator('[data-cg-density="compact"]');
      assert.equal(await height(compact.locator('.button-md').first()), 32);
      assert.equal(await height(compact.locator('.button-sm').first()), 24);

      // Icon-only is square at each size.
      for (const name of ['Close (md)', 'Close (sm)', 'Close (compact)']) {
        const box = await h.page.getByRole('button', { name }).boundingBox();
        assert.ok(box !== null);
        assert.equal(Math.round(box.width), Math.round(box.height), `${name} is not square`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('states', () => {
  void test('hover tints a primary button, and the press scales it — unless motion is reduced', async () => {
    const h = await gallery();
    try {
      const primary = h.page.locator('[data-cg-size="md"] .button-primary').first();
      const bg = () => primary.evaluate((el) => getComputedStyle(el).backgroundColor);
      const rest = await bg();
      await primary.hover();
      await until(async () => (await bg()) !== rest);
      assert.notEqual(await bg(), rest, 'hover changed nothing');

      const transform = () => primary.evaluate((el) => getComputedStyle(el).transform);
      await h.page.mouse.down();
      // The press eases in over 140ms; wait for where it lands, not the first frame.
      await until(async () => (await transform()).startsWith('matrix(0.98'));
      assert.match(await transform(), /^matrix\(0\.98/, 'no press feedback');
      await h.page.mouse.up();

      await h.page.emulateMedia({ reducedMotion: 'reduce' });
      await primary.hover();
      await h.page.mouse.down();
      // A fixed window: nothing should move, so there is no condition to end on.
      await h.page.waitForTimeout(200);
      assert.equal(await transform(), 'none', 'the press still moves under reduced motion');
      await h.page.mouse.up();
    } finally {
      await h.close();
    }
  });

  void test('Tab shows the accent ring on a button', async () => {
    const h = await gallery();
    try {
      await cg(h.page, 'settle').focus();
      await h.page.keyboard.press('Shift+Tab');
      await h.page.keyboard.press('Tab');
      assert.equal(await focused(h.page), 'settle');
      const ring = await cg(h.page, 'settle').evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.outlineStyle, width: s.outlineWidth };
      });
      assert.deepEqual(ring, { style: 'solid', width: '2px' });
    } finally {
      await h.close();
    }
  });

  void test('busy: the spinner shows, the label stays, focus stays, a second press does nothing', async () => {
    const h = await gallery();
    try {
      const save = cg(h.page, 'busy');
      await save.focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await save.getAttribute('aria-busy')) === 'true');
      assert.equal(await save.getAttribute('aria-busy'), 'true');
      assert.equal(await presses(h.page), 1);
      assert.equal((await save.innerText()).trim(), 'Save changes', 'the label swapped');
      assert.equal(await save.locator('.spinner').count(), 1, 'no spinner');
      assert.equal(await focused(h.page), 'busy', 'the press threw the focus away');
      assert.equal(await save.getAttribute('aria-disabled'), 'true');

      // Keyboard and pointer, both refused while it works.
      await h.page.keyboard.press('Enter');
      await h.page.keyboard.press(' ');
      await save.click({ force: true });
      assert.equal(await presses(h.page), 1, 'a busy button took another press');

      // The icon-only form keeps its size when its glyph becomes the spinner.
      const remove = cg(h.page, 'icon-busy');
      const before = await remove.boundingBox();
      await remove.click();
      await until(async () => (await remove.getAttribute('aria-busy')) === 'true');
      assert.equal(await remove.getAttribute('aria-busy'), 'true');
      const during = await remove.boundingBox();
      assert.ok(before !== null && during !== null);
      assert.equal(during.width, before.width, 'the icon button resized when it went busy');

      await cg(h.page, 'settle').click();
      await until(async () => (await save.getAttribute('aria-busy')) === null);
      assert.equal(await save.getAttribute('aria-busy'), null);
      await save.click();
      assert.equal(await presses(h.page), 2, 'it did not come back after the work finished');
    } finally {
      await h.close();
    }
  });

  void test('disabled with a reason: reachable by Tab, described by the reason, and inert', async () => {
    const h = await gallery();
    try {
      const del = cg(h.page, 'reason');
      assert.equal(await del.getAttribute('disabled'), null, 'native disabled hides the reason');
      assert.equal(await del.getAttribute('aria-disabled'), 'true');

      // Reached by the keyboard, from the control before it.
      await cg(h.page, 'disabled').evaluate((el) => {
        (el.previousElementSibling as HTMLElement | null)?.focus();
      });
      await h.page.keyboard.press('Tab');
      assert.equal(await focused(h.page), 'reason', 'Tab skipped the reasoned button');

      const ids = (await del.getAttribute('aria-describedby')) ?? '';
      assert.ok(ids !== '', 'no aria-describedby');
      const reason = h.page.locator(`[id="${ids}"]`);
      assert.equal(await reason.innerText(), 'Only the space owner can delete it.');
      assert.ok(await reason.isVisible(), 'the reason is not on screen');

      const before = await presses(h.page);
      await del.click({ force: true });
      await h.page.keyboard.press('Enter');
      assert.equal(await presses(h.page), before, 'a disabled button acted');

      // Disabled with no reason is the native attribute, and out of the tab order.
      assert.equal(await cg(h.page, 'disabled').getAttribute('disabled'), '');
    } finally {
      await h.close();
    }
  });
});

void describe('hit area', () => {
  void test('on a coarse pointer a 28px button takes a tap 44px wide, without drawing bigger', async () => {
    const h = await gallery(390);
    try {
      // Touch emulation is what makes Chromium report `(pointer: coarse)`;
      // `setEmulatedMedia` cannot emulate that feature (measured: it stays fine).
      const cdp = await h.page.context().newCDPSession(h.page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await h.page.reload();
      await h.page.locator('[data-controls-gallery]').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.evaluate(() => matchMedia('(pointer: coarse)').matches),
        true,
        'positive control: the page does not see a coarse pointer',
      );

      for (const name of ['Close (sm)', 'Close (compact)']) {
        const button = h.page.getByRole('button', { name });
        // `elementFromPoint` sees only the viewport, so bring the whole target in.
        await button.evaluate((el) => {
          el.scrollIntoView({ block: 'center' });
        });
        const box = await button.boundingBox();
        assert.ok(box !== null);
        assert.ok(box.height < 44, `${name} drew itself bigger: ${String(box.height)}px`);
        // 4px outside the drawn edge: inside the 44px target for both the 28px
        // and the 32px (compact md) button, outside the box either draws.
        const outside = { x: box.x + box.width / 2, y: box.y + box.height + 4 };
        const hit = await h.page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
          outside,
        );
        assert.equal(hit, name, `a tap just below ${name} missed it`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('fields', () => {
  void test('a refused submit puts the focus on the first wrong field, described by its error', async () => {
    const h = await gallery();
    try {
      await cg(h.page, 'submit').click();
      const prefix = h.page.locator('#cg-prefix');
      await until(async () => (await focused(h.page)) === 'cg-prefix');
      assert.equal(await focused(h.page), 'cg-prefix', 'focus did not move to the first error');
      assert.equal(await prefix.getAttribute('aria-invalid'), 'true');
      const described = (await prefix.getAttribute('aria-describedby')) ?? '';
      assert.ok(described.split(' ').includes('cg-prefix-error'), described);
      assert.equal(
        await h.page.locator('#cg-prefix-error').innerText(),
        'A key is 2–8 letters and digits.',
      );
      // The error lives inside a polite live region that was there before it.
      assert.equal(
        await h.page
          .locator('#cg-prefix-error')
          .evaluate((el) => el.parentElement?.getAttribute('aria-live')),
        'polite',
      );
      // The second error is marked too, but did not take the focus.
      assert.equal(await h.page.locator('#cg-about').getAttribute('aria-invalid'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('the count is in graphemes, goes red past the limit, and marks the field invalid', async () => {
    const h = await gallery();
    try {
      const name = h.page.locator('#cg-name');
      const count = h.page.locator('#cg-name-count');
      assert.equal(await count.locator('[aria-hidden="true"]').innerText(), '31 / 40');
      assert.ok(((await name.getAttribute('aria-describedby')) ?? '').includes('cg-name-count'));
      assert.equal(await name.getAttribute('aria-invalid'), null);

      await name.fill('👩‍💻'.repeat(41));
      await until(async () => (await name.getAttribute('aria-invalid')) === 'true');
      assert.equal(await count.locator('[aria-hidden="true"]').innerText(), '41 / 40');
      assert.equal(await name.getAttribute('aria-invalid'), 'true');
      assert.match((await count.getAttribute('class')) ?? '', /field-count-over/);
    } finally {
      await h.close();
    }
  });

  void test('the label is always visible, read-only stays readable, disabled is refused', async () => {
    const h = await gallery();
    try {
      for (const id of ['cg-name', 'cg-prefix', 'cg-about', 'cg-email', 'cg-off']) {
        const label = h.page.locator(`label[for="${id}"]`);
        assert.ok(await label.isVisible(), `${id} has no visible label`);
      }
      const email = h.page.locator('#cg-email');
      assert.equal(await email.getAttribute('readonly'), '');
      assert.equal(await email.isEditable(), false);
      assert.equal(await h.page.locator('#cg-off').isDisabled(), true);
      // The settings row stacks its label beside the control on a laptop.
      const label = await h.page.locator('label[for="cg-row-name"]').boundingBox();
      const input = await h.page.locator('#cg-row-name').boundingBox();
      assert.ok(label !== null && input !== null);
      assert.ok(input.x > label.x + label.width, 'the row layout is not side by side');
    } finally {
      await h.close();
    }
  });
});

void describe('icons', () => {
  void test('decorative by default; a labelled one is a named image', async () => {
    const h = await gallery();
    try {
      const icons = h.page.locator('[data-controls-gallery] svg.icon');
      const total = await icons.count();
      assert.ok(total > 40, `only ${String(total)} icons drew`);
      const unhidden = await h.page
        .locator('[data-controls-gallery] svg.icon:not([aria-hidden="true"])')
        .count();
      assert.equal(unhidden, 1, 'only the labelled icon may be exposed');
      assert.equal(await h.page.getByRole('img', { name: 'Warning' }).count(), 1);

      // Sizes follow the type scale: 12, 16, 20, 24.
      for (const [size, px] of [
        ['tiny', 12],
        ['small', 16],
        ['body', 20],
        ['reading', 24],
      ] as const) {
        const box = await h.page.locator(`[data-cg-icons="${size}"] svg`).first().boundingBox();
        assert.ok(box !== null);
        assert.equal(Math.round(box.width), px, `${size} is not ${String(px)}px`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('worst case, themes and widths', () => {
  for (const width of [390, 768, 1440]) {
    void test(`at ${String(width)}px nothing overflows, long labels included`, async () => {
      const h = await gallery(width);
      try {
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.equal(overflow, 0, 'the page scrolls sideways');
        const spill = await h.page
          .locator('[data-cg-narrow] .button')
          .evaluateAll((els) =>
            els
              .filter((el) => el.scrollWidth > el.clientWidth + 1)
              .map((el) => el.textContent ?? ''),
          );
        assert.deepEqual(spill, [], 'a label spills out of its button');
        // A wrapped label grows the button rather than clipping it.
        const tall = await h.page
          .locator('[data-cg-narrow] .button-block')
          .evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(tall >= 36);
      } finally {
        await h.close();
      }
    });
  }

  for (const theme of ['dark', 'light']) {
    void test(`${theme}: every variant’s label reads against its fill (≥ 4.5:1)`, async () => {
      const h = await gallery();
      try {
        await setTheme(h.page, theme);
        // Colours ease between themes (`--transition`): read them once every
        // transition on the page has finished, not halfway from the old theme.
        await h.page.waitForFunction(
          () =>
            document
              .getAnimations()
              .every(
                (a) =>
                  a.playState !== 'running' ||
                  a.effect?.getComputedTiming().iterations === Infinity,
              ),
          undefined,
          { timeout: 5_000 },
        );
        const ratios = await h.page
          .locator('[data-cg-size="md"] .button:not(.button-icon)')
          .evaluateAll((els) => {
            const rgb = (c: string): number[] => {
              const m = /rgba?\(([^)]+)\)/.exec(c);
              return (m?.[1] ?? '0,0,0').split(',').map((v) => Number(v.trim()));
            };
            const lum = (c: number[]): number => {
              const [r, g, b] = c.slice(0, 3).map((v) => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              });
              return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
            };
            // A transparent fill shows what is under it: the page.
            const ground = (el: Element | null): number[] => {
              for (let e = el; e !== null; e = e.parentElement) {
                const c = rgb(getComputedStyle(e).backgroundColor);
                if ((c[3] ?? 1) > 0.5) return c;
              }
              return rgb(getComputedStyle(document.body).backgroundColor);
            };
            return els.map((el) => {
              const fg = lum(rgb(getComputedStyle(el).color));
              const bg = lum(ground(el));
              const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
              return { label: el.textContent ?? '', ratio: Math.round(ratio * 10) / 10 };
            });
          });
        const low = ratios.filter((r) => r.ratio < 4.5);
        assert.deepEqual(low, [], `low contrast in ${theme}`);
      } finally {
        await h.close();
      }
    });
  }
});
