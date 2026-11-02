/**
 * What every status on Tools and Devices means (LAI-1086), in a real browser
 * against a stubbed board — the owner's own Tools tab: Claude Code · Belka
 * *Ready*, Codex · Belka and Omnigent · Belka *Connected*, one revoked.
 *
 * - *What do these statuses mean?* beside the Connected tools and Devices
 *   headings opens a legend of every status, in the vocabulary's own words
 *   and order (`status-vocabulary.ts`), the tab's own group first.
 * - The legend is a modal: focus moves in, Tab stays in, Escape closes it,
 *   and focus returns to the link.
 * - Every chip on a row is focusable and described by that row's own
 *   evidence, shown on hover and on focus; Escape hides it and closes
 *   nothing.
 * - 390 px, both themes: no sideways scroll, and a tooltip stays on screen.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save screenshots, light and dark, at 1440
 * and 390 px.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  DEVICE_ORDER,
  DEVICE_STATUS,
  DUPLICATE,
  TOOL_ORDER,
  TOOL_STATUS,
  UPDATE_ORDER,
  UPDATE_STATUS,
  type StatusCopy,
} from '../../src/routes/screens/developer/v3/status-vocabulary.ts';
import { stub } from './developer-v3-fixtures.ts';
import { closeBrowser, open, setTheme, until, type Harness, type OpenOptions } from './harness.ts';

after(async () => {
  await closeBrowser();
});

const tool = (page: Page, id: string) => page.locator(`.dv3-tool[data-agent="${id}"]`);
const legend = (page: Page) => page.getByRole('dialog', { name: 'What these statuses mean' });

async function openTab(tab: 'tools' | 'devices', options: OpenOptions = {}): Promise<Harness> {
  const h = await open(`/developer?tab=${tab}`, stub(), options);
  const row =
    tab === 'tools' ? tool(h.page, 'a1') : h.page.locator('.dv3-device[data-device="d1"]');
  await row.waitFor({ timeout: 20_000 });
  if (tab === 'tools') {
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      await until(async () => {
        const key = await tool(h.page, id).getAttribute('data-update');
        return key !== null && key !== 'checking';
      }, 15_000);
    }
    await until(
      async () => (await tool(h.page, 'a1').getAttribute('data-status')) === 'ready',
      15_000,
    );
  } else {
    await h.page
      .locator('.dv3-device[data-device="d1"] [data-device-version]')
      .waitFor({ timeout: 15_000 });
  }
  return h;
}

/** A chip's description, through its `aria-describedby`. */
async function description(anchor: Locator): Promise<string> {
  const id = await anchor.getAttribute('aria-describedby');
  assert.ok(id !== null, 'the chip has no aria-describedby');
  const tip = anchor.page().locator(`[id="${id}"]`);
  assert.equal(await tip.getAttribute('role'), 'tooltip');
  return ((await tip.textContent()) ?? '').trim();
}

const anchorIn = (scope: Locator) => scope.locator('.dv3-hint-anchor');
const focusedIn = (page: Page, selector: string) =>
  page.evaluate(
    (s) => document.querySelector(s)?.contains(document.activeElement) ?? false,
    selector,
  );

const expected = (keys: readonly string[], copy: Readonly<Record<string, StatusCopy>>) =>
  keys.map((key) => [key, copy[key]] as const);

async function assertGroup(
  dialog: Locator,
  group: string,
  entries: readonly (readonly [string, StatusCopy | undefined])[],
): Promise<void> {
  const rows = dialog.locator(`[data-legend-group="${group}"] [data-legend]`);
  assert.deepEqual(
    await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-legend'))),
    entries.map(([key]) => key),
    `${group}: every status, in order`,
  );
  for (const [key, copy] of entries) {
    assert.ok(copy !== undefined, key);
    const row = dialog.locator(`[data-legend-group="${group}"] [data-legend="${key}"]`);
    assert.equal(await row.locator('dt').innerText(), copy.word, key);
    assert.equal(await row.locator('.dv3-legend-meaning').innerText(), copy.meaning, key);
    assert.equal(
      await row.locator('.dv3-legend-todo').innerText(),
      `What to do: ${copy.todo}`,
      key,
    );
  }
}

void describe('the legend', () => {
  void test('beside Connected tools: every status in the vocabulary’s words, tools first', async () => {
    const h = await openTab('tools');
    try {
      const link = h.page.locator('[data-legend-link="tools"]');
      // In the heading's row, beside Connected tools.
      assert.equal(
        await link.evaluate(
          (el) => el.closest('.dx-section-title')?.querySelector('h2')?.textContent,
        ),
        'Connected tools',
      );
      assert.equal(await link.innerText(), 'What do these statuses mean?');
      assert.equal(await link.getAttribute('aria-haspopup'), 'dialog');
      await link.click();
      const dialog = legend(h.page);
      await dialog.waitFor();
      assert.equal(await dialog.getAttribute('aria-modal'), 'true');
      assert.deepEqual(
        await dialog
          .locator('[data-legend-group]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-legend-group'))),
        ['dv3-legend-tools', 'dv3-legend-helper', 'dv3-legend-devices'],
      );
      await assertGroup(dialog, 'dv3-legend-tools', [
        ...expected(TOOL_ORDER, TOOL_STATUS),
        ['duplicate', DUPLICATE],
      ]);
      await assertGroup(dialog, 'dv3-legend-helper', expected(UPDATE_ORDER, UPDATE_STATUS));
      await assertGroup(dialog, 'dv3-legend-devices', expected(DEVICE_ORDER, DEVICE_STATUS));
      // The thresholds, as the code has them.
      assert.match(await dialog.innerText(), /in the last 15 minutes/);
      assert.match(await dialog.innerText(), /between 15 minutes and 7 days ago/);
    } finally {
      await h.close();
    }
  });

  void test('beside Devices: the same legend, the device group first', async () => {
    const h = await openTab('devices');
    try {
      const link = h.page.locator('[data-legend-link="devices"]');
      assert.equal(
        await link.evaluate(
          (el) => el.closest('.dx-section-title')?.querySelector('h2')?.textContent,
        ),
        'Devices',
      );
      await link.click();
      const dialog = legend(h.page);
      await dialog.waitFor();
      assert.deepEqual(
        await dialog
          .locator('[data-legend-group]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-legend-group'))),
        ['dv3-legend-devices', 'dv3-legend-helper', 'dv3-legend-tools'],
      );
      await assertGroup(dialog, 'dv3-legend-devices', expected(DEVICE_ORDER, DEVICE_STATUS));
    } finally {
      await h.close();
    }
  });

  void test('keyboard: Enter opens it, focus moves in, Tab stays in, Escape closes it, focus returns', async () => {
    const h = await openTab('tools');
    try {
      const link = h.page.locator('[data-legend-link="tools"]');
      await link.focus();
      await h.page.keyboard.press('Enter');
      await legend(h.page).waitFor();
      assert.equal(await focusedIn(h.page, '.side-panel[data-panel="status-legend"]'), true);
      assert.equal(await link.getAttribute('aria-expanded'), 'true');
      for (let i = 0; i < 12; i += 1) {
        await h.page.keyboard.press('Tab');
        assert.equal(
          await focusedIn(h.page, '.side-panel[data-panel="status-legend"]'),
          true,
          `Tab ${String(i + 1)} left it`,
        );
      }
      await h.page.keyboard.press('Shift+Tab');
      assert.equal(await focusedIn(h.page, '.side-panel[data-panel="status-legend"]'), true);
      await h.page.keyboard.press('Escape');
      await legend(h.page).waitFor({ state: 'detached' });
      await until(async () => link.evaluate((el) => el === document.activeElement));
      assert.equal(await link.evaluate((el) => el === document.activeElement), true);
      assert.equal(await link.getAttribute('aria-expanded'), 'false');
      // The scrim closes it too.
      await link.click();
      await legend(h.page).waitFor();
      await h.page.locator('.side-panel-scrim').click({ position: { x: 5, y: 5 } });
      await legend(h.page).waitFor({ state: 'detached' });
    } finally {
      await h.close();
    }
  });
});

void describe('each chip explains its own row', () => {
  void test('Tools: Ready, Connected not Ready with what is missing, and the helper chip', async () => {
    const h = await openTab('tools');
    try {
      const ready = anchorIn(tool(h.page, 'a1').locator('[data-readiness]'));
      assert.equal(await ready.innerText(), 'Ready');
      assert.equal(
        await description(ready),
        'Ready: Claude Code · Belka. Claude Code is using its own credential. Nothing to do.',
      );

      const codex = anchorIn(tool(h.page, 'a2').locator('[data-readiness]'));
      assert.equal(await codex.innerText(), 'Connected');
      const said = await description(codex);
      assert.match(
        said,
        /^Connected, not Ready: Codex · Belka\. The credential reached the board; Codex itself has not called it yet\./,
      );
      assert.match(said, /Its credential last reached the board 31 min ago\./);
      assert.match(
        said,
        /To make it Ready: The credential reached the board, but not from Codex itself\./,
      );

      // Review round 1, B1: on imported Strelka the checklist's Device paired fails, and
      // readiness() never asks for it — the next step is the tool's own request.
      const strelka = await description(anchorIn(tool(h.page, 'a4').locator('[data-readiness]')));
      assert.match(
        strelka,
        /^Connected, not Ready: Claude Code · Strelka\. The credential reached the board; Claude Code itself has not called it yet\./,
      );
      assert.match(
        strelka,
        /To make it Ready: The credential reached the board, but not from Claude Code itself\./,
      );
      assert.doesNotMatch(strelka, /[Pp]air|no key of its own/);

      // A button, so a screen reader announces its name and its description.
      const asButton = tool(h.page, 'a2').getByRole('button', { name: 'Connected', exact: true });
      assert.equal(await asButton.count(), 1);
      assert.equal(await asButton.evaluate((el) => el.tagName), 'BUTTON');
      assert.equal(await description(asButton), said);

      const omnigent = anchorIn(tool(h.page, 'a3').locator('[data-readiness]'));
      // LAI-1088: its MCP client names no tool, so what is missing is the helper's report.
      const omni = await description(omnigent);
      assert.match(
        omni,
        /^Connected, not Ready: Omnigent · Belka\. The credential is in use; the helper has not yet reported that it is Omnigent’s\./,
      );
      assert.match(
        omni,
        /To make it Ready: Omnigent runs other tools as its workers[\s\S]*What is missing is the helper’s report from this credential saying it is Omnigent\. Reconnect Omnigent from here and run the command on Belka: `laika tool add` sends it\.$/,
      );

      // The helper chip: updateStatus's own reason for this row.
      const update = anchorIn(tool(h.page, 'a2').locator('[data-update-chip]'));
      assert.equal(await update.innerText(), 'Update required');
      assert.match(
        await description(update),
        /^Update required for .+: Codex · Belka\. .*this one speaks 1\. What it does now keeps working\. Update the Laika CLI on that device/,
      );
      assert.match(
        await description(anchorIn(tool(h.page, 'a3').locator('[data-update-chip]'))),
        /^Version unknown: Omnigent · Belka\. Its helper has not reported a version to this board/,
      );
    } finally {
      await h.close();
    }
  });

  void test('shown on focus and on hover; Escape hides it and closes nothing', async () => {
    const h = await openTab('tools');
    try {
      const chip = tool(h.page, 'a2').locator('[data-readiness]');
      const tip = chip.locator('[role="tooltip"]');
      assert.equal(await tip.isVisible(), false);
      await anchorIn(chip).focus();
      await until(() => tip.isVisible());
      assert.equal(await tip.isVisible(), true, 'focus shows it');
      await h.page.keyboard.press('Escape');
      await until(async () => !(await tip.isVisible()));
      assert.equal(await tip.isVisible(), false, 'Escape hides it');
      assert.equal(await anchorIn(chip).evaluate((el) => el === document.activeElement), true);
      assert.equal(
        await h.page.locator('.side-panel').count(),
        0,
        'Escape opened or closed nothing',
      );
      await h.page.keyboard.press('Enter');
      await until(() => tip.isVisible());
      assert.equal(await tip.isVisible(), true, 'Enter shows it again');
      await h.page.locator('.dx-section-heading').first().click();
      await anchorIn(tool(h.page, 'a1').locator('[data-readiness]')).hover();
      await until(() => tool(h.page, 'a1').locator('[role="tooltip"]').first().isVisible());
      assert.equal(await tool(h.page, 'a1').locator('[role="tooltip"]').first().isVisible(), true);

      // The last row's tooltip is not cut off by the card, which clips what overflows it.
      const last = tool(h.page, 'a4').locator('[data-readiness]');
      await anchorIn(last).focus();
      const tip3 = last.locator('[role="tooltip"]');
      await until(() => tip3.isVisible());
      const box = await tip3.boundingBox();
      assert.ok(box !== null);
      const hit = await tip3.evaluate(
        (el, at) => el.contains(document.elementFromPoint(at.x, at.y)),
        { x: box.x + box.width / 2, y: box.y + box.height - 4 },
      );
      assert.equal(hit, true, 'the bottom of the last row’s tooltip is hidden');
    } finally {
      await h.close();
    }
  });

  void test('Devices: the device chip and its helpers’ chip say the row’s own facts', async () => {
    const h = await openTab('devices');
    try {
      const row = h.page.locator('.dv3-device[data-device="d1"]');
      const paired = anchorIn(row.locator('[data-device-chip]'));
      assert.equal(await paired.innerText(), 'Paired');
      assert.match(
        await description(paired),
        /^Paired: Belka holds a key this board approved .+\. Nothing\. Add tool → puts a coding tool on it\.$/,
      );
      const imported = anchorIn(h.page.locator('.dv3-device[data-device="d2"] [data-device-chip]'));
      assert.equal(await imported.innerText(), 'Imported');
      assert.equal(
        await description(imported),
        'Imported: Laika made Strelka from the name your tools reported; it was confirmed, and never paired with a key. Nothing. Its tools keep working.',
      );
      const helpers = anchorIn(row.locator('[data-device-version]'));
      assert.equal(await helpers.innerText(), 'Update required');
      assert.equal(
        await description(helpers),
        `Belka: Helper updates: 1 update required, 1 version unknown, 1 up to date. ${UPDATE_STATUS.required.todo}`,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('390 px, both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the legend and a tooltip stay on screen`, async () => {
      const h = await openTab('tools');
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await setTheme(h.page, theme);
        const wide = () =>
          h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
        const chip = tool(h.page, 'a2').locator('[data-readiness]');
        await anchorIn(chip).focus();
        const tip = chip.locator('[role="tooltip"]');
        await until(() => tip.isVisible());
        const box = await tip.boundingBox();
        assert.ok(box !== null);
        assert.ok(
          box.x >= 0 && box.x + box.width <= 390,
          `the tooltip runs off screen: ${JSON.stringify(box)}`,
        );
        assert.ok((await wide()) <= 0, 'the page scrolls sideways with a tooltip open');
        await h.page.locator('[data-legend-link="tools"]').click();
        await legend(h.page).waitFor();
        assert.ok((await wide()) <= 0, 'the legend scrolls sideways at 390 px');
        const over = await legend(h.page).evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(over <= 0, `the legend overflows by ${String(over)}px`);
      } finally {
        await h.close();
      }
    });
  }
});

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

void describe(
  'evidence: the legend and a chip’s description',
  { skip: EVIDENCE === undefined },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          const tag = `${theme}-${String(width)}`;
          const size = { width, height: width === 390 ? 844 : 900 };
          for (const tab of ['tools', 'devices'] as const) {
            // Review round 1, N5: the page opens at this size, so a 390 px shot is a
            // real 390 px layout with its navigation drawer closed.
            const h = await openTab(tab, {
              before: async (page) => {
                await page.setViewportSize(size);
              },
            });
            try {
              await setTheme(h.page, theme);
              assert.equal(await h.page.evaluate(() => window.innerWidth), width);
              const chip =
                tab === 'tools'
                  ? tool(h.page, 'a2').locator('[data-readiness]')
                  : h.page.locator('.dv3-device[data-device="d1"] [data-device-version]');
              await anchorIn(chip).focus();
              await until(() => chip.locator('[role="tooltip"]').isVisible());
              await h.page.screenshot({ path: join(dir, `${tab}-chip-description-${tag}.png`) });
              await h.page.locator(`[data-legend-link="${tab}"]`).click();
              await legend(h.page).waitFor();
              await legend(h.page).screenshot({ path: join(dir, `${tab}-legend-${tag}.png`) });
            } finally {
              await h.close();
            }
          }
        }
      }
    });
  },
);
